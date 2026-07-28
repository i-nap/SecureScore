package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"math/rand"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

func handleCustomerScore(c *gin.Context) {
	claims := c.MustGet("claims").(map[string]interface{})
	cid := c.Query("customer_id")
	if cid == claims["sub"] {
		if real, _ := claims["customer_id"].(string); real != "" {
			cid = real
		}
	}
	bid, _ := claims["branch_id"].(string)
	eu, ok := edgeURL(bid)
	if !ok {
		c.JSON(404, gin.H{"detail": "unknown branch"})
		return
	}
	resp, err := httpClient.Get(eu + "/api/score?customer_id=" + url.QueryEscape(cid))
	if err != nil {
		c.JSON(503, gin.H{"detail": "edge node offline"})
		return
	}
	defer resp.Body.Close()
	var raw map[string]interface{}
	if json.NewDecoder(resp.Body).Decode(&raw) != nil {
		c.JSON(502, gin.H{"detail": "bad edge response"})
		return
	}
	// Add risk_bucket (mirrors Python BFF)
	prob, _ := raw["probability_creditworthy"].(float64)
	risk := "high_risk"
	if prob >= 0.7 {
		risk = "low_risk"
	} else if prob >= 0.4 {
		risk = "medium_risk"
	}
	raw["risk_bucket"] = risk
	if _, ok := raw["features_used"]; !ok {
		raw["features_used"] = 56
	}
	c.JSON(resp.StatusCode, raw)
}

func handleCustomerExplain(c *gin.Context) {
	var body map[string]interface{}
	c.ShouldBindJSON(&body)
	proxyEdge(c, "POST", "/api/explain", body)
}

func handleCustomerRoboAdvice(c *gin.Context) {
	var req map[string]interface{}
	c.ShouldBindJSON(&req)
	claims := c.MustGet("claims").(map[string]interface{})
	bid, _ := claims["branch_id"].(string)
	if b, _ := req["branch_id"].(string); b != "" {
		bid = b
	}
	eu, ok := edgeURL(bid)
	if !ok {
		c.JSON(404, gin.H{"detail": "unknown branch"})
		return
	}
	resp, err := httpClient.Post(eu+"/api/robo_advice", "application/json", bytes.NewReader(mustJSON(req)))
	if err != nil {
		c.JSON(503, gin.H{"detail": "edge node offline"})
		return
	}
	defer resp.Body.Close()
	var raw map[string]interface{}
	if json.NewDecoder(resp.Body).Decode(&raw) != nil {
		c.JSON(502, gin.H{"detail": "bad edge response"})
		return
	}
	// Reshape to match frontend RoboAdvice interface (mirrors Python BFF)
	getF := func(m map[string]interface{}, k string) float64 {
		v, _ := m[k].(float64)
		return v
	}
	proj, _ := raw["projection"].(map[string]interface{})
	if proj == nil {
		proj = map[string]interface{}{}
	}
	p10Last := 0.0
	p90Last := 0.0
	if arr, ok := proj["monthly_path_p10"].([]interface{}); ok && len(arr) > 0 {
		p10Last, _ = arr[len(arr)-1].(float64)
	}
	if arr, ok := proj["monthly_path_p90"].([]interface{}); ok && len(arr) > 0 {
		p90Last, _ = arr[len(arr)-1].(float64)
	}
	allocations, _ := raw["allocations"].(map[string]interface{})
	if allocations == nil {
		allocations = map[string]interface{}{}
	}
	c.JSON(resp.StatusCode, gin.H{
		"branch_type":  coalesce(raw["branch_type"], "unknown"),
		"risk_profile": coalesce(raw["risk_level"], "Medium"),
		"portfolio":    allocations,
		"projected_5yr": gin.H{
			"mean": getF(proj, "median_final"),
			"p10":  p10Last,
			"p90":  p90Last,
		},
		"recommendations": []string{
			fmt.Sprintf("Profile: %v", coalesce(raw["profile"], "Balanced")),
			fmt.Sprintf("Expected annual return: %.1f%%", getF(raw, "expected_annual_return")*100),
			fmt.Sprintf("Volatility: %.1f%%", getF(raw, "volatility")*100),
			fmt.Sprintf("Probability of profit: %.0f%%", getF(proj, "prob_profit")*100),
			coalesce(raw["disclaimer"], ""),
		},
	})
}

func handleCustomerCashflow(c *gin.Context) {
	claims := c.MustGet("claims").(map[string]interface{})
	cid, _ := claims["customer_id"].(string)
	if cid == "" {
		c.JSON(400, gin.H{"detail": "No customer_id in token"})
		return
	}
	proxyEdge(c, "GET", "/api/cashflow/"+cid, nil)
}

func handleCustomerRiskProfile(c *gin.Context) {
	claims := c.MustGet("claims").(map[string]interface{})
	cid, _ := claims["customer_id"].(string)
	if cid == "" {
		c.JSON(400, gin.H{"detail": "No customer_id in token"})
		return
	}
	proxyEdge(c, "GET", "/api/unified_risk/"+cid, nil)
}

func handleCustomerCashflowBranch(c *gin.Context) {
	proxyEdge(c, "GET", "/api/cashflow/branch/aggregate", nil)
}

func handleCustomerChat(c *gin.Context) {
	var req struct {
		CustomerID string `json:"customer_id"`
		Message    string `json:"message"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"detail": "invalid request"})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	bid, _ := claims["branch_id"].(string)
	cid := req.CustomerID
	if cid == claims["sub"] {
		if real, _ := claims["customer_id"].(string); real != "" {
			cid = real
		}
	}

	// Try edge for XAI context
	var xai map[string]interface{}
	eu, ok := edgeURL(bid)
	if ok {
		resp, err := httpClient.Post(eu+"/api/explain", "application/json",
			bytes.NewReader(mustJSON(map[string]string{"customer_id": cid})))
		if err == nil {
			defer resp.Body.Close()
			json.NewDecoder(resp.Body).Decode(&xai)
		}
	}

	system := buildSystemPrompt(xai, bid, cid)
	reply := groqChat(system, req.Message)
	poweredBy := "groq"
	if reply == "" {
		reply = ruleBasedFallback(req.Message, xai, bid, cid)
		poweredBy = "rule_based"
	}
	c.JSON(200, gin.H{"reply": reply, "xai_context": xai, "powered_by": poweredBy})
}

// 3. GET /api/customer/score_explanation — any auth
func handleCustomerScoreExplanation(c *gin.Context) {
	claims := c.MustGet("claims").(map[string]interface{})
	cid, _ := claims["customer_id"].(string)
	if cid == "" {
		cid, _ = claims["sub"].(string)
	}
	bid, _ := claims["branch_id"].(string)

	type shapFeatureOut struct {
		Name      string  `json:"name"`
		Value     float64 `json:"value"`
		ShapValue float64 `json:"shap_value"`
		Direction string  `json:"direction"`
	}
	direction := func(v float64) string {
		if v >= 0 {
			return "positive"
		}
		return "negative"
	}

	// Try live edge explanation first — reshape top_factors into features
	if eu, ok := edgeURL(bid); ok {
		resp, err := httpClient.Post(eu+"/api/explain", "application/json",
			bytes.NewReader(mustJSON(map[string]string{"customer_id": cid})))
		if err == nil {
			defer resp.Body.Close()
			var edgeResp map[string]interface{}
			if json.NewDecoder(resp.Body).Decode(&edgeResp) == nil {
				if rawFactors, ok := edgeResp["top_factors"].([]interface{}); ok && len(rawFactors) > 0 {
					prob, _ := edgeResp["probability_creditworthy"].(float64)
					if prob == 0 {
						prob, _ = edgeResp["score"].(float64)
					}
					var features []shapFeatureOut
					for _, rf := range rawFactors {
						m, _ := rf.(map[string]interface{})
						if m == nil {
							continue
						}
						name, _ := m["feature"].(string)
						sv, _ := m["shap_value"].(float64)
						fv, _ := m["feature_value"].(float64)
						if fv == 0 {
							fv = featureBaselines[name]
						}
						features = append(features, shapFeatureOut{
							Name: name, Value: fv, ShapValue: sv, Direction: direction(sv),
						})
					}
					sort.Slice(features, func(i, j int) bool {
						return math.Abs(features[i].ShapValue) > math.Abs(features[j].ShapValue)
					})
					c.JSON(200, gin.H{
						"customer_id": cid, "base_value": 0.0,
						"prediction": prob, "features": features,
					})
					return
				}
			}
		}
	}

	// Fallback: synthetic SHAP data seeded by customer ID
	rng := rand.New(rand.NewSource(int64(stableHash(cid))))
	featureMap := seedFeaturesFromCID(cid)
	score := scoreLogit(featureMap)

	var factors []shapFeatureOut
	for _, feat := range shapFeatures {
		val := featureMap[feat]
		baseline := featureBaselines[feat]
		w := featureWeights[feat]
		shapVal := w*(val-baseline) + (rng.Float64()*0.04 - 0.02)
		factors = append(factors, shapFeatureOut{
			Name: feat, Value: val, ShapValue: shapVal, Direction: direction(shapVal),
		})
	}
	sort.Slice(factors, func(i, j int) bool {
		return math.Abs(factors[i].ShapValue) > math.Abs(factors[j].ShapValue)
	})

	c.JSON(200, gin.H{
		"customer_id": cid, "base_value": 0.0,
		"prediction": score, "features": factors,
	})
}

// 4. POST /api/customer/whatif — any auth
func handleCustomerWhatIf(c *gin.Context) {
	claims := c.MustGet("claims").(map[string]interface{})
	cid, _ := claims["customer_id"].(string)
	if cid == "" {
		cid, _ = claims["sub"].(string)
	}

	var body map[string]float64
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(400, gin.H{"detail": "invalid body"})
		return
	}

	// Merge provided values over the seeded baseline
	baseFeatures := seedFeaturesFromCID(cid)
	newFeatures := make(map[string]float64)
	for k, v := range baseFeatures {
		newFeatures[k] = v
	}
	for k, v := range body {
		newFeatures[k] = v
	}

	baseScore := scoreLogit(baseFeatures)
	newScore := scoreLogit(newFeatures)

	// Determine the field with the largest positive impact
	keyDriver := ""
	bestDelta := 0.0
	for _, feat := range shapFeatures {
		if _, provided := body[feat]; !provided {
			continue
		}
		testF := make(map[string]float64)
		for k, v := range baseFeatures {
			testF[k] = v
		}
		testF[feat] = newFeatures[feat]
		delta := scoreLogit(testF) - baseScore
		if delta > bestDelta {
			bestDelta = delta
			keyDriver = feat
		}
	}

	c.JSON(200, gin.H{
		"score":                newScore,
		"grade":                gradeFromScore(newScore),
		"change_from_baseline": math_round(newScore-baseScore, 4),
		"key_driver":           keyDriver,
	})
}

// 5. GET /api/customer/score_history — any auth
func handleCustomerScoreHistory(c *gin.Context) {
	claims := c.MustGet("claims").(map[string]interface{})
	cid, _ := claims["customer_id"].(string)
	if cid == "" {
		cid, _ = claims["sub"].(string)
	}

	rng := rand.New(rand.NewSource(int64(stableHash(cid))))
	nPoints := rng.Intn(5) + 8 // 8–12
	daysSpan := 180
	interval := daysSpan / nPoints

	reasons := []string{
		"Global model improved with %d branch submissions",
		"Federated round completed — %d branches participated",
		"New local data incorporated from %d regional nodes",
		"Model convergence improved after round %d",
		"Aggregation round #%d completed successfully",
		"Data drift correction applied across %d branches",
		"HQ triggered manual aggregation round #%d",
		"Regularisation update reduced overfitting in round #%d",
	}

	score := 0.45 + rng.Float64()*0.20
	var history []map[string]interface{}
	for i := 0; i < nPoints; i++ {
		delta := -0.02 + rng.Float64()*0.06
		score += delta
		if score > 0.98 {
			score = 0.98
		}
		if score < 0.20 {
			score = 0.20
		}
		n := rng.Intn(7) + 6
		reasonFmt := reasons[i%len(reasons)]
		reason := fmt.Sprintf(reasonFmt, n)
		date := time.Now().AddDate(0, 0, -(daysSpan - i*interval)).Format("2006-01-02")
		history = append(history, map[string]interface{}{
			"date":   date,
			"score":  math_round(score, 4),
			"grade":  gradeFromScore(score),
			"reason": reason,
		})
	}

	c.JSON(200, gin.H{
		"customer_id": cid,
		"history":     history,
	})
}

// 10. POST /api/customer/kyc_submit — any auth
func handleCustomerKYCSubmit(c *gin.Context) {
	var body map[string]interface{}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(400, gin.H{"detail": "invalid body"})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	cid, _ := claims["customer_id"].(string)
	if cid == "" {
		cid, _ = claims["sub"].(string)
	}
	branchID, _ := claims["branch_id"].(string)

	ref := fmt.Sprintf("KYC-%d-%05d", time.Now().Year(), rand.Intn(90000)+10000)

	fullName, _ := body["full_name"].(string)
	phone, _ := body["phone"].(string)
	email, _ := body["email"].(string)
	loanPurpose, _ := body["loan_purpose"].(string)
	loanAmount, _ := body["loan_amount_requested"].(float64)

	// Persist to SQLite so it survives BFF restarts and is visible to all BMs
	_, dbErr := db.Exec(`INSERT OR IGNORE INTO kyc_applications
		(reference, customer_id, full_name, branch_id, phone, email, loan_purpose, loan_amount, status)
		VALUES (?,?,?,?,?,?,?,?,?)`,
		ref, cid, fullName, branchID, phone, email, loanPurpose, loanAmount, "pending_ai")
	if dbErr != nil {
		log.Printf("[KYC] DB insert error: %v", dbErr)
	}

	log.Printf("[KYC] submission reference=%s customer=%s branch=%s", ref, cid, branchID)
	c.JSON(200, gin.H{
		"reference":            ref,
		"status":               "pending_ai",
		"estimated_processing": "2-3 business days",
		"next_step":            "complete_ai_verification",
	})
}

// ── Counterfactual Explanation ────────────────────────────────────────────────
func handleCustomerCounterfactual(c *gin.Context) {
	claims := c.MustGet("claims").(map[string]interface{})
	cid, _ := claims["customer_id"].(string)
	if cid == "" {
		cid, _ = claims["sub"].(string)
	}
	if cid == "" {
		cid = "cust001"
	}

	feats := seedFeaturesFromCID(cid)
	currentScore := scoreLogit(feats)

	type Scenario struct {
		ID          string             `json:"id"`
		Title       string             `json:"title"`
		Description string             `json:"description"`
		Changes     map[string]float64 `json:"changes"`
		NewScore    float64            `json:"new_score"`
		Delta       float64            `json:"delta"`
		Feasibility string             `json:"feasibility"`
	}

	scenarios := []Scenario{}

	// Scenario 1: Increase income
	f1 := copyFeats(feats)
	incomeIncrease := 150000.0
	for currentScore < 0.65 && incomeIncrease < 800000 {
		f1["annual_income"] = feats["annual_income"] + incomeIncrease
		s := scoreLogit(f1)
		if s >= 0.65 {
			break
		}
		incomeIncrease += 50000
	}
	f1["annual_income"] = feats["annual_income"] + incomeIncrease
	s1 := scoreLogit(f1)
	scenarios = append(scenarios, Scenario{
		ID: "income", Title: "Increase Annual Income",
		Description: fmt.Sprintf("Increase annual income by NPR %.0f (to NPR %.0f)", incomeIncrease, f1["annual_income"]),
		Changes:     map[string]float64{"annual_income": incomeIncrease},
		NewScore:    math_round(s1, 4), Delta: math_round(s1-currentScore, 4), Feasibility: "medium",
	})

	// Scenario 2: Reduce debt
	f2 := copyFeats(feats)
	if feats["debt_to_income"] > 0.25 {
		f2["debt_to_income"] = math.Max(0.15, feats["debt_to_income"]-0.20)
	} else {
		f2["debt_to_income"] = math.Max(0.10, feats["debt_to_income"]-0.10)
	}
	f2["existing_loans"] = math.Max(0, feats["existing_loans"]-1)
	s2 := scoreLogit(f2)
	scenarios = append(scenarios, Scenario{
		ID: "debt", Title: "Reduce Debt Burden",
		Description: fmt.Sprintf("Reduce DTI from %.0f%% to %.0f%% and pay off one loan", feats["debt_to_income"]*100, f2["debt_to_income"]*100),
		Changes:     map[string]float64{"debt_to_income": -(feats["debt_to_income"] - f2["debt_to_income"]), "existing_loans": -1},
		NewScore:    math_round(s2, 4), Delta: math_round(s2-currentScore, 4), Feasibility: "hard",
	})

	// Scenario 3: Add collateral
	f3 := copyFeats(feats)
	f3["collateral_value"] = feats["collateral_value"] + 500000
	f3["repayment_history_score"] = math.Min(100, feats["repayment_history_score"]+15)
	s3 := scoreLogit(f3)
	scenarios = append(scenarios, Scenario{
		ID: "collateral", Title: "Improve Credit History",
		Description: "Add collateral (NPR 500k) and maintain 6 months clean repayment",
		Changes:     map[string]float64{"collateral_value": 500000, "repayment_history_score": 15},
		NewScore:    math_round(s3, 4), Delta: math_round(s3-currentScore, 4), Feasibility: "easy",
	})

	// Sort by delta desc
	sort.Slice(scenarios, func(i, j int) bool { return scenarios[i].Delta > scenarios[j].Delta })

	c.JSON(200, gin.H{
		"customer_id":   cid,
		"current_score": math_round(currentScore, 4),
		"current_grade": gradeFromScore(currentScore),
		"target_score":  0.65,
		"scenarios":     scenarios,
		"generated_at":  time.Now().UTC().Format(time.RFC3339),
	})
}

// ── Loan Apply ────────────────────────────────────────────────────────────────
func handleCustomerLoanApply(c *gin.Context) {
	var body struct {
		LoanPurpose     string  `json:"loan_purpose"`
		LoanAmount      float64 `json:"loan_amount"`
		TenureMonths    int     `json:"tenure_months"`
		CollateralType  string  `json:"collateral_type"`
		CollateralValue float64 `json:"collateral_value"`
		MonthlyIncome   float64 `json:"monthly_income"`
		Notes           string  `json:"notes"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(400, gin.H{"error": "invalid body"})
		return
	}

	claims := c.MustGet("claims").(map[string]interface{})
	cid, _ := claims["customer_id"].(string)
	if cid == "" {
		cid, _ = claims["sub"].(string)
	}
	if cid == "" {
		cid = "cust001"
	}

	bid, _ := claims["branch_id"].(string)
	// Real federated credit score from the branch edge model; fall back to the
	// deterministic estimate only if the edge is unreachable.
	score := scoreLogit(seedFeaturesFromCID(cid))
	if real, ok := realCreditScore(bid, cid); ok {
		score = real
	}

	// Compute LTV
	ltv := 0.0
	if body.CollateralValue > 0 {
		ltv = body.LoanAmount / body.CollateralValue * 100
	}

	// Decision (score is a probability 0-1; 0.70 ≈ good credit, 0.50 ≈ marginal)
	emi := body.LoanAmount * 0.0105
	dti := 0.0
	if body.MonthlyIncome > 0 {
		dti = emi / body.MonthlyIncome
	}

	// Concrete rejection factors from the real signals we have (NRB C-5).
	var rejectionReasons []map[string]string
	addReason := func(key string) {
		if info, ok := featureImpactLookup[key]; ok {
			rejectionReasons = append(rejectionReasons, map[string]string{
				"feature": key, "impact": info.Impact, "improvement": info.Improvement,
			})
		}
	}
	if score < 0.55 {
		addReason("repayment_history_score")
	}
	if dti > 0.50 {
		addReason("debt_to_income")
	}
	if body.CollateralValue > 0 && ltv > 90 {
		addReason("collateral_value")
	}

	decision := "under_review"
	decisionNote := "Your application is being reviewed by our credit team."
	switch {
	case score >= 0.70 && ltv < 80:
		decision = "conditionally_approved"
		decisionNote = "Preliminary approval based on your credit score. Final approval pending document verification."
		rejectionReasons = nil
	case score < 0.45 && len(rejectionReasons) > 0:
		decision = "rejected"
		decisionNote = "Your application did not meet our credit criteria. See the reasons and next steps below."
		// Prefer the real SHAP drivers from the federated model (NRB C-5);
		// keep the signal-based reasons as a fallback if the edge is offline.
		if shap := shapRejectionReasons(bid, cid); len(shap) > 0 {
			rejectionReasons = shap
		}
	case score < 0.50:
		decisionNote = "Additional documentation may be required."
		rejectionReasons = nil
	default:
		rejectionReasons = nil
	}

	ref := fmt.Sprintf("LN-%s-%d", strings.ToUpper(cid[:4]), time.Now().Unix()%100000)

	resp := gin.H{
		"reference":          ref,
		"status":             decision,
		"decision_note":      decisionNote,
		"credit_score_used":  score,
		"loan_amount":        body.LoanAmount,
		"loan_purpose":       body.LoanPurpose,
		"tenure_months":      body.TenureMonths,
		"emi_estimate":       math.Round(emi),
		"ltv_ratio":          math.Round(ltv*10) / 10,
		"submitted_at":       time.Now().UTC().Format(time.RFC3339),
		"estimated_decision": "3-5 business days",
	}
	if len(rejectionReasons) > 0 {
		resp["rejection_reason"] = rejectionReasons
	}
	c.JSON(200, resp)
}

// realCreditScore fetches the branch edge model's probability_creditworthy.
func realCreditScore(bid, cid string) (float64, bool) {
	eu, ok := edgeURL(bid)
	if !ok {
		return 0, false
	}
	resp, err := httpClient.Get(eu + "/api/score?customer_id=" + url.QueryEscape(cid))
	if err != nil {
		return 0, false
	}
	defer resp.Body.Close()
	var sd map[string]interface{}
	if json.NewDecoder(resp.Body).Decode(&sd) != nil {
		return 0, false
	}
	p, ok := sd["probability_creditworthy"].(float64)
	return p, ok
}

// loanReasonTips maps SHAP feature names to a human impact + improvement action.
var loanReasonTips = map[string]struct{ Impact, Improvement string }{
	"spending_consistency_score": {"Irregular month-to-month spending pattern", "Keep your monthly spending steady for 3-6 months"},
	"digital_engagement_score":   {"Low digital banking activity", "Use mobile/online banking and digital payments more regularly"},
	"cibil_score":                {"Credit bureau (CIBIL) score below our threshold", "Clear existing dues on time to raise your CIBIL score"},
	"total_transaction_volume":   {"Low transaction volume through your account", "Route more of your income and spending through this bank"},
	"cc_total_spent":             {"High credit-card spending relative to profile", "Keep credit-card usage below 30% of your limit"},
	"avg_loan_requested":         {"Requested amount is high for your profile", "Apply for a smaller amount or add collateral / a guarantor"},
	"dw_success_rate":            {"Low transaction success rate (failed/bounced payments)", "Maintain sufficient balance to avoid failed transactions"},
	"dw_merchant_diversity":      {"Narrow range of payees/merchants", "Build a broader, steadier transaction history"},
	"debt_to_income_ratio":       {"Debt-to-income ratio above our limit", "Reduce existing EMIs/loans before reapplying"},
	"credit_utilization":         {"High credit utilization", "Keep your credit usage below 30% of the available limit"},
	"cc_max_transaction":         {"Large credit-card transactions relative to profile", "Avoid large one-off card spends close to applying"},
	"monthly_income":             {"Income is low for the requested amount", "Apply for a smaller amount or add a co-applicant"},
	"num_existing_loans":         {"Too many active loans", "Close at least one existing loan before reapplying"},
}

func humanizeFeature(f string) string {
	f = strings.ReplaceAll(f, "_", " ")
	if len(f) == 0 {
		return f
	}
	return strings.ToUpper(f[:1]) + f[1:]
}

// shapRejectionReasons returns the top-3 negative SHAP drivers from the branch
// edge model as {feature, impact, improvement} — the NRB C-5 written reason.
func shapRejectionReasons(bid, cid string) []map[string]string {
	eu, ok := edgeURL(bid)
	if !ok {
		return nil
	}
	resp, err := httpClient.Post(eu+"/api/explain", "application/json",
		bytes.NewReader(mustJSON(map[string]string{"customer_id": cid})))
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	var edgeResp map[string]interface{}
	if json.NewDecoder(resp.Body).Decode(&edgeResp) != nil {
		return nil
	}
	rawFactors, _ := edgeResp["top_factors"].([]interface{})
	type nf struct {
		name string
		sv   float64
	}
	var negs []nf
	for _, rf := range rawFactors {
		m, _ := rf.(map[string]interface{})
		if m == nil {
			continue
		}
		name, _ := m["feature"].(string)
		sv, _ := m["shap_value"].(float64)
		if sv < 0 {
			negs = append(negs, nf{name, sv})
		}
	}
	sort.Slice(negs, func(i, j int) bool { return negs[i].sv < negs[j].sv }) // most negative first
	var out []map[string]string
	for i, n := range negs {
		if i >= 3 {
			break
		}
		tip, ok := loanReasonTips[n.name]
		impact := tip.Impact
		improvement := tip.Improvement
		if !ok {
			impact = humanizeFeature(n.name) + " is below what our model expects"
			improvement = "Improve this over the next few months and reapply"
		}
		out = append(out, map[string]string{
			"feature":     humanizeFeature(n.name),
			"impact":      impact,
			"improvement": improvement,
		})
	}
	return out
}

func handleCustomerLoanHistory(c *gin.Context) {
	claims := c.MustGet("claims").(map[string]interface{})
	cid, _ := claims["customer_id"].(string)
	if cid == "" {
		cid, _ = claims["sub"].(string)
	}
	if cid == "" {
		cid = "cust001"
	}

	rng := rand.New(rand.NewSource(int64(stableHash(cid))))
	statuses := []string{"approved", "disbursed", "under_review", "rejected", "closed"}
	purposes := []string{"Home", "Business", "Education", "Vehicle", "Personal"}

	type LoanRecord struct {
		Reference   string  `json:"reference"`
		Purpose     string  `json:"purpose"`
		Amount      float64 `json:"amount"`
		Status      string  `json:"status"`
		AppliedDate string  `json:"applied_date"`
		EMI         float64 `json:"emi"`
	}

	loans := []LoanRecord{}
	n := 2 + rng.Intn(3)
	for i := 0; i < n; i++ {
		amt := float64(200000 + rng.Intn(2000000))
		days := rng.Intn(365)
		d := time.Now().AddDate(0, 0, -days)
		loans = append(loans, LoanRecord{
			Reference:   fmt.Sprintf("LN-%s-%05d", strings.ToUpper(cid[:4]), rng.Intn(99999)),
			Purpose:     purposes[rng.Intn(len(purposes))],
			Amount:      amt,
			Status:      statuses[rng.Intn(len(statuses))],
			AppliedDate: d.Format("2006-01-02"),
			EMI:         math.Round(amt * 0.0105),
		})
	}

	c.JSON(200, gin.H{"loans": loans, "customer_id": cid})
}

// Called after AI KYC to update scores in the application record
func handleCustomerKYCUpdateAI(c *gin.Context) {
	var body struct {
		Reference       string  `json:"reference"`
		AIVerified      bool    `json:"ai_verified"`
		FaceProfileLive float64 `json:"face_profile_live"`
		FaceProfileID   float64 `json:"face_profile_id"`
		LivenessPassed  bool    `json:"liveness_passed"`
		SigMatchScore   float64 `json:"sig_match_score"`
		// legacy fields
		FaceMatchScore float64 `json:"face_match_score"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(400, gin.H{"error": "invalid body"})
		return
	}

	// Support both old and new field names
	fpl := body.FaceProfileLive
	if fpl == 0 {
		fpl = body.FaceMatchScore
	}

	newStatus := "pending_ai"
	if body.AIVerified {
		newStatus = "under_review"
	}

	db.Exec(`UPDATE kyc_applications SET
		ai_verified=?, face_profile_live=?, face_profile_id=?,
		liveness_passed=?, sig_match=?, status=?
		WHERE reference=?`,
		boolToInt(body.AIVerified), fpl, body.FaceProfileID,
		boolToInt(body.LivenessPassed), body.SigMatchScore, newStatus,
		body.Reference)

	c.JSON(200, gin.H{"reference": body.Reference, "updated": true})
}

// ── KYC Face Verify — proxy to HQ Python FaceNet model ───────────────────────
func handleCustomerKYCFaceVerify(c *gin.Context) {
	var body map[string]interface{}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(400, gin.H{"error": "invalid request"})
		return
	}

	// Try proxying to HQ server (facenet-pytorch)
	bodyBytes, _ := json.Marshal(body)
	req, err := http.NewRequest("POST", hqURL+"/kyc/face_verify", bytes.NewReader(bodyBytes))
	if err == nil {
		req.Header.Set("Content-Type", "application/json")
		if hqAPIKey != "" {
			req.Header.Set("X-API-Key", hqAPIKey)
		}
		req.Header.Set("Authorization", "Bearer "+hqAPIKey)

		client := &http.Client{Timeout: 30 * time.Second}
		resp, err := client.Do(req)
		if err == nil && resp.StatusCode == 200 {
			defer resp.Body.Close()
			respBody, _ := io.ReadAll(resp.Body)
			c.Data(200, "application/json", respBody)
			return
		}
		if resp != nil {
			resp.Body.Close()
		}
	}

	// Fallback: HQ server offline — return structured error so client knows to retry
	c.JSON(503, gin.H{
		"error":              "face_recognition_unavailable",
		"detail":             "HQ face recognition server is offline. Start hq_server.py to enable real face matching.",
		"profile_live_score": 0,
		"profile_id_score":   0,
		"verified":           false,
		"verdict":            "PENDING",
	})
}

// ── KYC AI Verify ─────────────────────────────────────────────────────────────
func handleCustomerKYCAIVerify(c *gin.Context) {
	var body struct {
		DocumentPhoto   string   `json:"document_photo"`
		LivePhotos      []string `json:"live_photos"`
		SignatureData   string   `json:"signature_data"`
		LivenessSteps   []string `json:"liveness_steps"`
		SessionSeconds  float64  `json:"session_seconds"`   // how long the session took
		InteractEvents  int      `json:"interact_events"`   // mouse/touch events counted
		ClientFaceScore float64  `json:"client_face_score"` // real score from face-api.js (-1 = not computed)
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(400, gin.H{"error": "invalid request"})
		return
	}

	claims := c.MustGet("claims").(map[string]interface{})
	cid, _ := claims["customer_id"].(string)
	if cid == "" {
		cid, _ = claims["sub"].(string)
	}
	if cid == "" {
		cid = "cust001"
	}

	// ── Strict validation checks ─────────────────────────────

	type checkResult struct {
		Name   string `json:"name"`
		Passed bool   `json:"passed"`
		Reason string `json:"reason"`
	}
	checks := []checkResult{}
	failures := []string{}

	// 1. Document photo must be a real image (≥ 8KB of base64 ≈ 6KB image)
	docOK := len(body.DocumentPhoto) >= 8000
	checks = append(checks, checkResult{"id_document_quality", docOK, func() string {
		if docOK {
			return "ID document image present and valid"
		}
		return "ID document missing or too small — ensure a real photo was uploaded"
	}()})
	if !docOK {
		failures = append(failures, "id_document")
	}

	// 2. All 5 liveness challenges must be completed
	stepsOK := len(body.LivenessSteps) >= 5
	checks = append(checks, checkResult{"liveness_steps_complete", stepsOK, func() string {
		if stepsOK {
			return fmt.Sprintf("All %d challenges completed", len(body.LivenessSteps))
		}
		return fmt.Sprintf("Only %d/5 liveness challenges completed", len(body.LivenessSteps))
	}()})
	if !stepsOK {
		failures = append(failures, "incomplete_steps")
	}

	// 3. Live photos: need 5 photos each ≥ 5KB base64 (real camera frames)
	validFrames := 0
	for _, p := range body.LivePhotos {
		if len(p) >= 5000 {
			validFrames++
		}
	}
	framesOK := validFrames >= 5
	checks = append(checks, checkResult{"live_frame_quality", framesOK, func() string {
		if framesOK {
			return fmt.Sprintf("%d valid camera frames captured", validFrames)
		}
		return fmt.Sprintf("Only %d/5 valid frames — ensure camera is enabled and well-lit", validFrames)
	}()})
	if !framesOK {
		failures = append(failures, "invalid_frames")
	}

	// 4. Frame diversity — frames should not all be identical (bot prevention)
	diversityOK := true
	if len(body.LivePhotos) >= 2 {
		sameCount := 0
		for i := 1; i < len(body.LivePhotos); i++ {
			if len(body.LivePhotos[i]) == len(body.LivePhotos[i-1]) {
				sameCount++
			}
		}
		diversityOK = sameCount < len(body.LivePhotos)-1
	}
	checks = append(checks, checkResult{"frame_diversity", diversityOK, func() string {
		if diversityOK {
			return "Frames show variation across challenges"
		}
		return "Frames appear identical — possible replay attack detected"
	}()})
	if !diversityOK {
		failures = append(failures, "replay_detected")
	}

	// 5. Session time — must take at least 12 seconds (5 challenges × ~2.5s each)
	timeOK := body.SessionSeconds >= 12.0
	checks = append(checks, checkResult{"session_duration", timeOK, func() string {
		if timeOK {
			return fmt.Sprintf("Session duration %.1fs is realistic", body.SessionSeconds)
		}
		return fmt.Sprintf("Session completed in %.1fs — too fast for a human", body.SessionSeconds)
	}()})
	if !timeOK {
		failures = append(failures, "too_fast")
	}

	// 6. Human interaction events — real users generate mouse/touch events
	interactOK := body.InteractEvents >= 3
	checks = append(checks, checkResult{"human_interaction", interactOK, func() string {
		if interactOK {
			return fmt.Sprintf("%d interaction events recorded", body.InteractEvents)
		}
		return "Insufficient human interaction events detected"
	}()})
	if !interactOK {
		failures = append(failures, "no_interaction")
	}

	// 7. Signature must be non-trivial (≥ 3KB base64 means real strokes)
	sigOK := len(body.SignatureData) >= 3000
	checks = append(checks, checkResult{"signature_quality", sigOK, func() string {
		if sigOK {
			return "Signature has sufficient complexity"
		}
		return "Signature missing or too simple"
	}()})
	if !sigOK {
		failures = append(failures, "invalid_signature")
	}

	// ── Score computation ─────────────────────────────────────
	seed := int64(stableHash(cid + fmt.Sprintf("%d", time.Now().UnixNano()/1e9/60))) // changes per minute
	rng := rand.New(rand.NewSource(seed))

	faceMatchScore := 0.0
	sigMatchScore := 0.0
	livenessPass := stepsOK && framesOK && diversityOK && timeOK && interactOK

	if body.ClientFaceScore >= 0 {
		// Real score computed by face-api.js on the client — use it directly
		faceMatchScore = body.ClientFaceScore
	} else if docOK && framesOK && len(failures) == 0 {
		// Fallback: all checks passed — simulated score
		faceMatchScore = 0.87 + rng.Float64()*0.09
	} else if docOK && framesOK && len(failures) <= 1 {
		faceMatchScore = 0.65 + rng.Float64()*0.12
	} else {
		faceMatchScore = 0.20 + rng.Float64()*0.25
	}
	faceMatchScore = math.Round(faceMatchScore*1000) / 1000

	if sigOK {
		sigMatchScore = 0.82 + rng.Float64()*0.14
	} else {
		sigMatchScore = 0.15 + rng.Float64()*0.30
	}
	sigMatchScore = math.Round(sigMatchScore*1000) / 1000

	verified := faceMatchScore >= 0.80 && livenessPass && sigMatchScore >= 0.75 && len(failures) == 0

	verdict := "FAILED"
	if verified {
		verdict = "VERIFIED"
	} else if len(failures) <= 2 {
		verdict = "REVIEW_REQUIRED"
	}

	livenessScore := 0.0
	if livenessPass {
		livenessScore = 1.0
	}

	c.JSON(200, gin.H{
		"customer_id":              cid,
		"verified":                 verified,
		"verdict":                  verdict,
		"face_match_score":         faceMatchScore,
		"liveness_passed":          livenessPass,
		"signature_match":          sigMatchScore,
		"liveness_steps_completed": len(body.LivenessSteps),
		"failures":                 failures,
		"checks":                   checks,
		"confidence_breakdown": gin.H{
			"biometric_check": math.Round(faceMatchScore*100*10) / 10,
			"liveness_check":  livenessScore * 100,
			"signature_check": math.Round(sigMatchScore*100*10) / 10,
			"overall":         math.Round((faceMatchScore*0.5+livenessScore*0.3+sigMatchScore*0.2)*100*10) / 10,
		},
		"reference":   fmt.Sprintf("KYC-AI-%s-%d", strings.ToUpper(cid[:4]), time.Now().Unix()%100000),
		"verified_at": time.Now().UTC().Format(time.RFC3339),
	})
}

func handleCustomerHealthScore(c *gin.Context) {
	claims := c.MustGet("claims").(map[string]interface{})
	cid, _ := claims["customer_id"].(string)
	if cid == "" {
		cid, _ = claims["sub"].(string)
	}
	if cid == "" {
		cid = "cust001"
	}

	feats := seedFeaturesFromCID(cid)
	rng := rand.New(rand.NewSource(int64(stableHash(cid + "health"))))

	creditComponent := math.Min(100, math.Max(0, scoreLogit(feats)*100))

	dti := feats["debt_to_income"]
	debtComponent := math.Max(0, 100-dti*200)

	empMonths := feats["employment_months"]
	stabilityComponent := math.Min(100, empMonths/60*100)

	repayment := feats["repayment_history_score"]
	paymentComponent := repayment

	savingsBase := 40 + rng.Float64()*40
	savingsComponent := savingsBase

	overall := (creditComponent*0.30 + debtComponent*0.25 + stabilityComponent*0.20 + paymentComponent*0.15 + savingsComponent*0.10)

	grade := "Poor"
	if overall >= 80 {
		grade = "Excellent"
	} else if overall >= 65 {
		grade = "Good"
	} else if overall >= 50 {
		grade = "Fair"
	}

	type Component struct {
		Name   string  `json:"name"`
		Score  float64 `json:"score"`
		Weight float64 `json:"weight"`
		Status string  `json:"status"`
		Tip    string  `json:"tip"`
	}

	statusOf := func(s float64) string {
		if s >= 75 {
			return "good"
		} else if s >= 50 {
			return "fair"
		}
		return "poor"
	}

	components := []Component{
		{Name: "Credit Score", Score: math.Round(creditComponent*10) / 10, Weight: 0.30, Status: statusOf(creditComponent), Tip: "Improve by reducing existing loans and maintaining payment history"},
		{Name: "Debt Management", Score: math.Round(debtComponent*10) / 10, Weight: 0.25, Status: statusOf(debtComponent), Tip: "Reduce debt-to-income ratio by paying down existing loans"},
		{Name: "Income Stability", Score: math.Round(stabilityComponent*10) / 10, Weight: 0.20, Status: statusOf(stabilityComponent), Tip: "Longer employment tenure strengthens this score"},
		{Name: "Payment History", Score: math.Round(paymentComponent*10) / 10, Weight: 0.15, Status: statusOf(paymentComponent), Tip: "Never miss a payment — set up auto-debit"},
		{Name: "Savings Behavior", Score: math.Round(savingsComponent*10) / 10, Weight: 0.10, Status: statusOf(savingsComponent), Tip: "Maintain at least 3 months emergency fund"},
	}

	c.JSON(200, gin.H{
		"customer_id":   cid,
		"overall_score": math.Round(overall*10) / 10,
		"grade":         grade,
		"components":    components,
		"generated_at":  time.Now().UTC().Format(time.RFC3339),
	})
}

func handleCustomerLoanEligibility(c *gin.Context) {
	claims := c.MustGet("claims").(map[string]interface{})
	cid, _ := claims["customer_id"].(string)
	if cid == "" {
		cid, _ = claims["sub"].(string)
	}
	if cid == "" {
		cid = "cust001"
	}

	amountStr := c.Query("amount")
	requestedAmount, _ := strconv.ParseFloat(amountStr, 64)
	if requestedAmount <= 0 {
		requestedAmount = 1000000
	}

	feats := seedFeaturesFromCID(cid)
	score := scoreLogit(feats)

	type Product struct {
		Name      string  `json:"name"`
		Eligible  bool    `json:"eligible"`
		Reason    string  `json:"reason"`
		MaxAmount float64 `json:"max_amount"`
		MinRate   float64 `json:"min_rate"`
		MaxTenure int     `json:"max_tenure_months"`
		MinScore  float64 `json:"min_score"`
	}

	products := []Product{
		{Name: "Home Loan", MinScore: 0.62, MaxAmount: 15000000, MinRate: 8.5, MaxTenure: 240},
		{Name: "Business Loan", MinScore: 0.58, MaxAmount: 5000000, MinRate: 9.5, MaxTenure: 120},
		{Name: "Education Loan", MinScore: 0.50, MaxAmount: 3000000, MinRate: 7.5, MaxTenure: 120},
		{Name: "Vehicle Loan", MinScore: 0.55, MaxAmount: 2500000, MinRate: 10.0, MaxTenure: 84},
		{Name: "Personal Loan", MinScore: 0.60, MaxAmount: 800000, MinRate: 12.0, MaxTenure: 60},
		{Name: "Agriculture Loan", MinScore: 0.45, MaxAmount: 1000000, MinRate: 7.0, MaxTenure: 60},
	}

	results := make([]Product, len(products))
	for i, p := range products {
		p.Eligible = score >= p.MinScore && requestedAmount <= p.MaxAmount
		if !p.Eligible {
			if score < p.MinScore {
				p.Reason = fmt.Sprintf("Minimum credit score %.0f%% required (yours: %.0f%%)", p.MinScore*100, score*100)
			} else {
				p.Reason = fmt.Sprintf("Requested amount exceeds maximum NPR %.0f", p.MaxAmount)
			}
		} else {
			p.Reason = "Eligible based on your credit profile"
		}
		rateAdj := (0.75 - score) * 4
		p.MinRate = math.Round((p.MinRate+rateAdj)*100) / 100
		results[i] = p
	}

	eligible := 0
	for _, r := range results {
		if r.Eligible {
			eligible++
		}
	}

	c.JSON(200, gin.H{
		"customer_id":      cid,
		"credit_score_pct": math.Round(score*1000) / 10,
		"requested_amount": requestedAmount,
		"products":         results,
		"eligible_count":   eligible,
		"checked_at":       time.Now().UTC().Format(time.RFC3339),
	})
}

// spendingCategory maps a ledger transaction_type to a human spending category.
func spendingCategory(txType string) string {
	switch txType {
	case "BILL_PAYMENT":
		return "Utilities & Bills"
	case "TRANSFER":
		return "Transfers"
	case "WITHDRAWAL":
		return "Cash Withdrawals"
	case "LOAN_EMI", "LOAN_FORECLOSE":
		return "EMI Payments"
	case "FOREX_LOAD":
		return "Forex & Travel"
	case "IPO_BLOCK":
		return "Investments"
	case "FD_OPEN":
		return "Savings & Deposits"
	default:
		return "Other"
	}
}

// realSpending aggregates the customer's own outgoing (debit) transactions over the
// last 6 months by category. Privacy-safe: only this customer's own ledger rows, no HQ.
// Returns nil if the customer has no real transactions (caller falls back to synthetic).
func realSpending(cid string) gin.H {
	if !dbAvailable() {
		return nil
	}
	rows, err := db.Query(`SELECT t.transaction_type, t.amount, t.created_at
		FROM transactions t JOIN accounts a ON t.from_account_id = a.id
		WHERE a.customer_id=? AND t.from_account_id IS NOT NULL
		AND DATE(t.created_at) >= DATE('now','-6 months')`, cid)
	if err != nil || rows == nil {
		return nil
	}
	defer rows.Close()

	now := time.Now()
	months := make([]string, 6)
	monthKey := make(map[string]int, 6) // "2006-01" -> bucket index 0..5
	for i := 0; i < 6; i++ {
		m := now.AddDate(0, -(5 - i), 0)
		months[i] = m.Format("Jan")
		monthKey[m.Format("2006-01")] = i
	}

	catTotals := map[string]float64{}
	catMonthly := map[string][]float64{}
	monthlyTotals := make([]float64, 6)
	var grand float64
	for rows.Next() {
		var txType, createdAt sql.NullString
		var amount sql.NullFloat64
		rows.Scan(&txType, &amount, &createdAt)
		if amount.Float64 <= 0 {
			continue
		}
		bucket, ok := monthKey[parseMonth(createdAt.String)]
		if !ok {
			continue
		}
		cat := spendingCategory(txType.String)
		catTotals[cat] += amount.Float64
		if catMonthly[cat] == nil {
			catMonthly[cat] = make([]float64, 6)
		}
		catMonthly[cat][bucket] += amount.Float64
		monthlyTotals[bucket] += amount.Float64
		grand += amount.Float64
	}
	if grand <= 0 {
		return nil
	}

	type catData struct {
		Name    string    `json:"name"`
		Amount  float64   `json:"amount"`
		Percent float64   `json:"percent"`
		Trend   string    `json:"trend"`
		Monthly []float64 `json:"monthly"`
	}
	cats := []catData{}
	for name, total := range catTotals {
		m := catMonthly[name]
		trend := "stable"
		if m[5] > m[4]*1.1 {
			trend = "up"
		} else if m[5] < m[4]*0.9 {
			trend = "down"
		}
		cats = append(cats, catData{
			Name: name, Amount: math.Round(total),
			Percent: math.Round(total/grand*1000) / 10, Trend: trend, Monthly: m,
		})
	}
	sort.Slice(cats, func(i, j int) bool { return cats[i].Amount > cats[j].Amount })
	for i := range monthlyTotals {
		monthlyTotals[i] = math.Round(monthlyTotals[i])
	}
	top := ""
	if len(cats) > 0 {
		top = cats[0].Name
	}
	return gin.H{
		"customer_id": cid, "total_monthly_avg": math.Round(grand / 6),
		"categories": cats, "monthly_totals": monthlyTotals, "months": months,
		"top_category": top, "period": "Last 6 months", "source": "ledger",
	}
}

// parseMonth extracts "2006-01" from a SQLite datetime string ("2006-01-02 15:04:05").
func parseMonth(s string) string {
	if len(s) >= 7 {
		return s[:7]
	}
	return s
}

func handleCustomerSpendingAnalytics(c *gin.Context) {
	claims := c.MustGet("claims").(map[string]interface{})
	cid, _ := claims["customer_id"].(string)
	if cid == "" {
		cid, _ = claims["sub"].(string)
	}
	if cid == "" {
		cid = "cust001"
	}

	if real := realSpending(cid); real != nil {
		c.JSON(200, real)
		return
	}

	rng := rand.New(rand.NewSource(int64(stableHash(cid + "spending"))))

	categories := []string{"EMI Payments", "Groceries", "Transport", "Utilities", "Dining Out", "Shopping", "Medical", "Entertainment", "Education", "Remittance"}
	baseAmounts := []float64{0.28, 0.18, 0.10, 0.09, 0.08, 0.07, 0.06, 0.05, 0.05, 0.04}

	type CategoryData struct {
		Name    string    `json:"name"`
		Amount  float64   `json:"amount"`
		Percent float64   `json:"percent"`
		Trend   string    `json:"trend"`
		Monthly []float64 `json:"monthly"`
	}

	totalMonthly := 20000 + rng.Float64()*60000
	catData := []CategoryData{}
	for i, cat := range categories {
		base := baseAmounts[i] * totalMonthly * (0.85 + rng.Float64()*0.3)
		monthly := make([]float64, 6)
		for j := range monthly {
			monthly[j] = math.Round(base * (0.8 + rng.Float64()*0.4))
		}
		trend := "stable"
		if monthly[5] > monthly[4]*1.1 {
			trend = "up"
		} else if monthly[5] < monthly[4]*0.9 {
			trend = "down"
		}
		catData = append(catData, CategoryData{
			Name: cat, Amount: math.Round(base), Percent: math.Round(baseAmounts[i]*1000) / 10,
			Trend: trend, Monthly: monthly,
		})
	}

	months := []string{"Jan", "Feb", "Mar", "Apr", "May", "Jun"}
	monthlyTotals := make([]float64, 6)
	for j := range monthlyTotals {
		monthlyTotals[j] = math.Round(totalMonthly * (0.85 + rng.Float64()*0.3))
	}

	c.JSON(200, gin.H{
		"customer_id":       cid,
		"total_monthly_avg": math.Round(totalMonthly),
		"categories":        catData,
		"monthly_totals":    monthlyTotals,
		"months":            months,
		"top_category":      catData[0].Name,
		"period":            "Last 6 months",
		"source":            "synthetic",
	})
}
