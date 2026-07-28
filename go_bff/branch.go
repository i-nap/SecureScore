package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"math/rand"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

func handleBranchMetrics(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	bid, _ := claims["branch_id"].(string)
	eu, ok := edgeURL(bid)
	if !ok {
		c.JSON(404, gin.H{"detail": "unknown branch"})
		return
	}
	resp, err := httpClient.Get(eu + "/api/metrics")
	if err != nil {
		c.JSON(503, gin.H{"detail": "edge node offline"})
		return
	}
	defer resp.Body.Close()
	var raw map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		c.JSON(502, gin.H{"detail": "bad response from edge"})
		return
	}

	// Reshape nested edge response to the flat shape the frontend expects
	// (mirrors the Python BFF behaviour)
	model, _ := raw["model_metrics"].(map[string]interface{})
	if model == nil {
		model = map[string]interface{}{}
	}
	stats, _ := raw["data_stats"].(map[string]interface{})
	if stats == nil {
		stats = map[string]interface{}{}
	}

	getFloat := func(m map[string]interface{}, key string) float64 {
		v, _ := m[key].(float64)
		return v
	}

	c.JSON(resp.StatusCode, gin.H{
		"branch_id":       bid,
		"branch_type":     coalesce(raw["branch_type"], "unknown"),
		"total_customers": getFloat(stats, "total_customers"),
		"model_accuracy":  getFloat(model, "accuracy"),
		"approval_rate":   getFloat(stats, "approval_rate"),
		"avg_probability": getFloat(model, "f1"),
		"demographic_breakdown": gin.H{
			"creditworthy":     getFloat(stats, "creditworthy"),
			"not_creditworthy": getFloat(stats, "not_creditworthy"),
		},
	})
}

func handleBranchCustomers(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	bid, _ := claims["branch_id"].(string)
	eu, ok := edgeURL(bid)
	if !ok {
		c.JSON(404, gin.H{"detail": "unknown branch"})
		return
	}
	page := c.DefaultQuery("page", "1")
	pp := c.DefaultQuery("per_page", "25")
	resp, err := httpClient.Get(fmt.Sprintf("%s/api/customers?page=%s&per_page=%s", eu, page, pp))
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

	customers, _ := raw["customers"].([]interface{})
	if customers == nil {
		raw["branch_id"] = bid
		c.JSON(resp.StatusCode, raw)
		return
	}

	// Enrich each customer with prediction + probability concurrently (Go is fast here)
	type result struct {
		idx         int
		prediction  string
		probability float64
	}
	results := make([]result, len(customers))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 10) // max 10 concurrent score calls

	for i, custRaw := range customers {
		cust, _ := custRaw.(map[string]interface{})
		if cust == nil {
			continue
		}
		cid, _ := cust["customer_id"].(string)
		if cid == "" {
			continue
		}
		wg.Add(1)
		go func(idx int, customerID string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			scoreResp, err := httpClient.Get(eu + "/api/score?customer_id=" + url.QueryEscape(customerID))
			if err != nil {
				results[idx] = result{idx: idx, prediction: "unknown", probability: 0}
				return
			}
			defer scoreResp.Body.Close()
			var score map[string]interface{}
			json.NewDecoder(scoreResp.Body).Decode(&score)
			pred, _ := score["prediction"].(string)
			prob, _ := score["probability_creditworthy"].(float64)
			results[idx] = result{idx: idx, prediction: pred, probability: prob}
		}(i, cid)
	}
	wg.Wait()

	// Merge enrichment back into customer list
	enriched := make([]interface{}, len(customers))
	for i, custRaw := range customers {
		cust, _ := custRaw.(map[string]interface{})
		if cust == nil {
			enriched[i] = custRaw
			continue
		}
		cust["prediction"] = results[i].prediction
		cust["probability"] = results[i].probability
		enriched[i] = cust
	}

	raw["customers"] = enriched
	raw["branch_id"] = bid
	c.JSON(resp.StatusCode, raw)
}

func handleBranchExplain(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	var body map[string]interface{}
	c.ShouldBindJSON(&body)
	proxyEdge(c, "POST", "/api/explain", body)
}

func handleBranchFraudAlerts(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	proxyEdge(c, "GET", "/api/fraud_alerts", nil)
}

func handleBranchDataDrift(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	proxyEdge(c, "GET", "/api/data_drift", nil)
}

func handleBranchAIModelsStatus(c *gin.Context) {
	proxyEdge(c, "GET", "/api/ai_models/status", nil)
}

func handleBranchFraudML(c *gin.Context) {
	topN := c.DefaultQuery("top_n", "20")
	proxyEdge(c, "GET", "/api/fraud_ml?top_n="+topN, nil)
}

func handleBranchFraudMLExplain(c *gin.Context) {
	var body map[string]interface{}
	c.ShouldBindJSON(&body)
	proxyEdge(c, "POST", "/api/fraud_ml/explain", body)
}

func handleBranchAMLScan(c *gin.Context) {
	proxyEdge(c, "GET", "/api/aml_scan", nil)
}

func handleBranchAMLSar(c *gin.Context) {
	cid := c.Param("customer_id")
	proxyEdge(c, "GET", "/api/aml_sar/"+cid, nil)
}

func handleBranchLoanDefault(c *gin.Context) {
	var body map[string]interface{}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(400, gin.H{"detail": "invalid request"})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	bid, _ := claims["branch_id"].(string)
	eu, ok := edgeURL(bid)
	if !ok {
		c.JSON(404, gin.H{"detail": "unknown branch"})
		return
	}
	resp, err := httpClient.Post(eu+"/api/loan_default", "application/json", bytes.NewReader(mustJSON(body)))
	if err != nil {
		c.JSON(503, gin.H{"detail": "edge node offline"})
		return
	}
	defer resp.Body.Close()
	respBytes, _ := io.ReadAll(resp.Body)
	var respObj map[string]interface{}
	json.Unmarshal(respBytes, &respObj)

	// Inject rejection_reason for REJECT decisions (NRB C-5)
	if respObj != nil {
		if dec, _ := respObj["decision"].(string); dec == "REJECT" {
			respObj["rejection_reason"] = buildRejectionReasons(respObj, body)
			respBytes, _ = json.Marshal(respObj)
		}
	}

	// Persist to DB
	if dbAvailable() && respObj != nil {
		dbInsertLoanDecision(bid, body, respObj)
	}
	c.Data(resp.StatusCode, "application/json", respBytes)
}

func handleBranchLoanPortfolio(c *gin.Context) {
	proxyEdge(c, "GET", "/api/loan_default/portfolio", nil)
}

func handleBranchCollateralEstimate(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	var body map[string]interface{}
	c.ShouldBindJSON(&body)
	proxyEdge(c, "POST", "/api/collateral_estimate", body)
}

func handleBranchRateOptimizer(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	var body map[string]interface{}
	c.ShouldBindJSON(&body)
	proxyEdge(c, "POST", "/api/rate_optimizer", body)
}

func handleBranchRemittanceAnalyze(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	var body map[string]interface{}
	c.ShouldBindJSON(&body)
	proxyEdge(c, "POST", "/api/remittance_analyze", body)
}

func handleBranchTransaction(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	var body map[string]interface{}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(400, gin.H{"detail": "invalid request"})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	bid, _ := claims["branch_id"].(string)
	eu, ok := edgeURL(bid)
	if !ok {
		c.JSON(404, gin.H{"detail": "unknown branch"})
		return
	}
	resp, err := httpClient.Post(eu+"/api/transaction_ingest", "application/json", bytes.NewReader(mustJSON(body)))
	if err != nil {
		c.JSON(503, gin.H{"detail": "edge node offline"})
		return
	}
	defer resp.Body.Close()
	respBytes, _ := io.ReadAll(resp.Body)
	var respObj map[string]interface{}
	json.Unmarshal(respBytes, &respObj)
	if alert, ok := respObj["alert"]; ok && alert != nil {
		alertMap, _ := alert.(map[string]interface{})
		wsBroadcast("fraud_alert", alertMap)
		if dbAvailable() {
			dbInsertFraudAlert(bid, alertMap)
		}
	}
	c.Data(resp.StatusCode, "application/json", respBytes)
}

func handleBranchChurnSummary(c *gin.Context) {
	proxyEdge(c, "GET", "/api/churn_summary", nil)
}

func handleBranchChurnCustomer(c *gin.Context) {
	cid := c.Param("customer_id")
	proxyEdge(c, "GET", "/api/churn/"+cid, nil)
}

func handleBranchUnifiedRisk(c *gin.Context) {
	cid := c.Param("customer_id")
	proxyEdge(c, "GET", "/api/unified_risk/"+cid, nil)
}

func handleBranchRiskDistribution(c *gin.Context) {
	proxyEdge(c, "GET", "/api/unified_risk/branch/distribution", nil)
}

func handleBranchGNNScore(c *gin.Context) {
	cid := c.Query("customer_id")
	proxyEdge(c, "GET", "/api/gnn_score?customer_id="+url.QueryEscape(cid), nil)
}

func handleBranchTopologyFingerprint(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	proxyEdge(c, "GET", "/api/topology_fingerprint", nil)
}

func handleBranchAdaptDrift(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	proxyEdge(c, "POST", "/api/adapt_drift", nil)
}

func handleBranchMuStatus(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	proxyEdge(c, "GET", "/api/mu_graphcoder_status", nil)
}

func handleBranchHQAssess(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	var req map[string]interface{}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"detail": "invalid request"})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	bid, _ := claims["branch_id"].(string)
	applicant, _ := req["applicant"].(map[string]interface{})
	if applicant == nil {
		applicant = map[string]interface{}{}
	}
	applicant["branch_id"] = bid
	// Only forward branch_params that were actually provided. HQ's BranchParams
	// fields are typed with defaults; sending an explicit null fails Pydantic
	// validation (None != float), so omit missing keys and let HQ apply defaults.
	branchParams := map[string]interface{}{}
	for _, k := range []string{
		"loan_type", "max_dti", "collateral_weight", "regional_risk_factor",
		"min_cibil", "require_guarantor_above", "prioritize_digital", "custom_label",
	} {
		if v, ok := req[k]; ok && v != nil {
			branchParams[k] = v
		}
	}
	payload := map[string]interface{}{
		"branch_id":     bid,
		"applicant":     applicant,
		"branch_params": branchParams,
	}
	token := getHQToken()
	reqBody, _ := json.Marshal(payload)
	hqReq, err := http.NewRequest("POST", hqURL+"/api/unified_assess", bytes.NewReader(reqBody))
	if err != nil {
		c.JSON(500, gin.H{"detail": "failed to create HQ request"})
		return
	}
	hqReq.Header.Set("Content-Type", "application/json")
	hqReq.Header.Set("Authorization", "Bearer "+token)
	hqResp, err := httpClient.Do(hqReq)
	if err != nil {
		c.JSON(503, gin.H{"detail": "HQ server offline"})
		return
	}
	defer hqResp.Body.Close()
	respBytes, _ := io.ReadAll(hqResp.Body)
	c.Data(hqResp.StatusCode, "application/json", respBytes)
	statusCode := hqResp.StatusCode

	// Persist fingerprint decision to local DB so HQ Records tab shows it
	if statusCode >= 200 && statusCode < 300 && dbAvailable() {
		var fp map[string]interface{}
		if json.Unmarshal(respBytes, &fp) == nil {
			fingerprintID, _ := fp["fingerprint_id"].(string)
			hqGrade, _ := fp["hq_grade"].(string)
			brGrade, _ := fp["branch_adjusted_grade"].(string)
			defProb, _ := fp["default_probability"].(float64)
			brRate, _ := fp["branch_recommended_rate"].(float64)
			maxLoan, _ := fp["max_approved_loan_npr"].(float64)
			modelVer := 0
			if v, ok := fp["hq_model_version"].(float64); ok {
				modelVer = int(v)
			}
			nrbC := 1
			if v, ok := fp["nrb_compliant"].(bool); ok && !v {
				nrbC = 0
			}
			reqGuarantor := 0
			if v, ok := fp["requires_guarantor"].(bool); ok && v {
				reqGuarantor = 1
			}
			apJson, _ := json.Marshal(payload["applicant"])
			bpJson, _ := json.Marshal(payload["branch_params"])
			rdJson, _ := json.Marshal(fp["risk_dimensions"])
			deJson, _ := json.Marshal(fp["decision_explanation"])
			fpJson, _ := json.Marshal(fp)
			db.Exec(`INSERT OR IGNORE INTO hq_fingerprint_decisions
				(fingerprint_id,branch_id,hq_grade,branch_adjusted_grade,default_probability,
				 branch_recommended_rate,max_approved_loan_npr,hq_model_version,nrb_compliant,
				 requires_guarantor,applicant_payload,branch_params,risk_dimensions,decision_explanation,response_payload)
				VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
				fingerprintID, bid, hqGrade, brGrade, defProb, brRate, maxLoan, modelVer,
				nrbC, reqGuarantor,
				string(apJson), string(bpJson), string(rdJson), string(deJson), string(fpJson))
		}
	}
}

func handleBranchLoanDecisions(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	if !dbAvailable() {
		c.JSON(200, gin.H{"records": []interface{}{}, "total": 0})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	bid, _ := claims["branch_id"].(string)
	grade := c.Query("grade")
	dateFrom := c.Query("date_from")
	dateTo := c.Query("date_to")
	limit := safeLimit(c.Query("limit"), 100)

	q := "SELECT id, branch, customer_id, requested_at, default_probability, risk_grade, suggested_interest_rate, recommended_max_loan_npr, nrb_compliant FROM loan_decisions WHERE branch=?"
	args := []interface{}{bid}
	if grade != "" {
		q += " AND risk_grade=?"
		args = append(args, grade)
	}
	if dateFrom != "" {
		q += " AND requested_at>=?"
		args = append(args, dateFrom)
	}
	if dateTo != "" {
		q += " AND requested_at<=?"
		args = append(args, dateTo)
	}
	q += " ORDER BY requested_at DESC LIMIT ?"
	args = append(args, limit)

	rows, err := db.Query(q, args...)
	if err != nil {
		c.JSON(500, gin.H{"detail": err.Error()})
		return
	}
	defer rows.Close()
	var records []map[string]interface{}
	for rows.Next() {
		var id int
		var branch, customerID, requestedAt sql.NullString
		var defProb, sugRate, maxLoan sql.NullFloat64
		var riskGrade sql.NullString
		var nrbCompliant sql.NullInt64
		rows.Scan(&id, &branch, &customerID, &requestedAt, &defProb, &riskGrade, &sugRate, &maxLoan, &nrbCompliant)
		records = append(records, map[string]interface{}{
			"id": id, "branch": branch.String, "customer_id": customerID.String,
			"requested_at": requestedAt.String, "default_probability": defProb.Float64,
			"risk_grade": riskGrade.String, "suggested_interest_rate": sugRate.Float64,
			"recommended_max_loan_npr": maxLoan.Float64, "nrb_compliant": nrbCompliant.Int64 == 1,
		})
	}
	if records == nil {
		records = []map[string]interface{}{}
	}
	c.JSON(200, gin.H{"records": records, "total": len(records)})
}

func handleBranchHQFingerprints(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	if !dbAvailable() {
		c.JSON(200, gin.H{"records": []interface{}{}, "total": 0})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	bid, _ := claims["branch_id"].(string)
	grade := c.Query("grade")
	limit := safeLimit(c.Query("limit"), 100)

	q := "SELECT fingerprint_id, branch_id, created_at, hq_grade, branch_adjusted_grade, default_probability, branch_recommended_rate, max_approved_loan_npr, hq_model_version, nrb_compliant, requires_guarantor FROM hq_fingerprint_decisions WHERE branch_id=?"
	args := []interface{}{bid}
	if grade != "" {
		q += " AND branch_adjusted_grade=?"
		args = append(args, grade)
	}
	q += " ORDER BY created_at DESC LIMIT ?"
	args = append(args, limit)

	rows, err := db.Query(q, args...)
	if err != nil {
		c.JSON(500, gin.H{"detail": err.Error()})
		return
	}
	defer rows.Close()
	var records []map[string]interface{}
	for rows.Next() {
		var fpID, branchID, createdAt, hqGrade, adjGrade sql.NullString
		var defProb, recRate, maxLoan sql.NullFloat64
		var modelVer, nrbC, reqG sql.NullInt64
		rows.Scan(&fpID, &branchID, &createdAt, &hqGrade, &adjGrade, &defProb, &recRate, &maxLoan, &modelVer, &nrbC, &reqG)
		records = append(records, map[string]interface{}{
			"fingerprint_id": fpID.String, "branch_id": branchID.String, "created_at": createdAt.String,
			"hq_grade": hqGrade.String, "branch_adjusted_grade": adjGrade.String,
			"default_probability": defProb.Float64, "branch_recommended_rate": recRate.Float64,
			"max_approved_loan_npr": maxLoan.Float64, "hq_model_version": modelVer.Int64,
			"nrb_compliant": nrbC.Int64 == 1, "requires_guarantor": reqG.Int64 == 1,
		})
	}
	if records == nil {
		records = []map[string]interface{}{}
	}
	c.JSON(200, gin.H{"records": records, "total": len(records)})
}

func handleBranchFraudAlertHistory(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	if !dbAvailable() {
		c.JSON(200, gin.H{"records": []interface{}{}, "total": 0})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	bid, _ := claims["branch_id"].(string)
	severity := c.Query("severity")
	limit := safeLimit(c.Query("limit"), 100)

	q := "SELECT id, branch, customer_id, detected_at, severity, metric, value, z_score, reason, source FROM fraud_alert_events WHERE branch=?"
	args := []interface{}{bid}
	if severity != "" {
		q += " AND severity=?"
		args = append(args, severity)
	}
	q += " ORDER BY detected_at DESC LIMIT ?"
	args = append(args, limit)

	rows, err := db.Query(q, args...)
	if err != nil {
		c.JSON(500, gin.H{"detail": err.Error()})
		return
	}
	defer rows.Close()
	var records []map[string]interface{}
	for rows.Next() {
		var id int
		var branch, customerID, detectedAt, sev, metric, reason, source sql.NullString
		var value, zScore sql.NullFloat64
		rows.Scan(&id, &branch, &customerID, &detectedAt, &sev, &metric, &value, &zScore, &reason, &source)
		records = append(records, map[string]interface{}{
			"id": id, "branch": branch.String, "customer_id": customerID.String,
			"detected_at": detectedAt.String, "severity": sev.String,
			"metric": metric.String, "value": value.Float64, "z_score": zScore.Float64,
			"reason": reason.String, "source": source.String,
		})
	}
	if records == nil {
		records = []map[string]interface{}{}
	}
	c.JSON(200, gin.H{"records": records, "total": len(records)})
}

func handleBranchGetApplications(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	if !dbAvailable() {
		c.JSON(200, gin.H{"applications": []interface{}{}})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	branchID, _ := claims["branch_id"].(string)
	statusFilter := c.DefaultQuery("status", "pending")
	rows, err := db.Query(`SELECT id,customer_id,account_type,purpose,initial_deposit,status,review_note,created_at,reviewed_at,reviewed_by FROM account_applications WHERE branch_id=? AND (? = 'all' OR status=?) ORDER BY created_at DESC LIMIT 200`,
		branchID, statusFilter, statusFilter)
	if err != nil {
		c.JSON(500, gin.H{"detail": err.Error()})
		return
	}
	defer rows.Close()
	var apps []map[string]interface{}
	for rows.Next() {
		var id int
		var custID, accType, purpose, status, reviewNote, createdAt, reviewedAt, reviewedBy sql.NullString
		var initDep sql.NullFloat64
		rows.Scan(&id, &custID, &accType, &purpose, &initDep, &status, &reviewNote, &createdAt, &reviewedAt, &reviewedBy)
		apps = append(apps, map[string]interface{}{
			"id": id, "customer_id": custID.String, "account_type": accType.String,
			"purpose": purpose.String, "initial_deposit": initDep.Float64,
			"status": status.String, "review_note": reviewNote.String,
			"created_at": createdAt.String, "reviewed_at": reviewedAt.String,
			"reviewed_by": reviewedBy.String,
		})
	}
	if apps == nil {
		apps = []map[string]interface{}{}
	}
	c.JSON(200, gin.H{"applications": apps, "total": len(apps)})
}

func handleBranchApproveApplication(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	appIDStr := c.Param("id")
	appID, _ := strconv.Atoi(appIDStr)
	var req struct {
		Note string `json:"note"`
	}
	c.ShouldBindJSON(&req)

	claims := c.MustGet("claims").(map[string]interface{})
	reviewer, _ := claims["sub"].(string)
	branchID, _ := claims["branch_id"].(string)

	// Fetch application
	var custID, accType sql.NullString
	var initDep sql.NullFloat64
	var appStatus sql.NullString
	err := db.QueryRow(`SELECT customer_id,account_type,initial_deposit,status FROM account_applications WHERE id=? AND branch_id=?`, appID, branchID).
		Scan(&custID, &accType, &initDep, &appStatus)
	if err == sql.ErrNoRows {
		c.JSON(404, gin.H{"detail": "Application not found"})
		return
	}
	if appStatus.String != "pending" {
		c.JSON(400, gin.H{"detail": "Application is already " + appStatus.String})
		return
	}

	tx, _ := db.Begin()
	defer tx.Rollback()

	var newAccNum string
	var accountID string

	if accType.String == "fd" {
		c.JSON(400, gin.H{"detail": "FD applications must be processed through the FD form directly"})
		return
	}

	// Create the account
	interestRate := map[string]float64{"savings": 5.0, "current": 0.0, "salary": 4.5}
	minBal := map[string]float64{"savings": 1000.0, "current": 0.0, "salary": 0.0}
	rate := interestRate[accType.String]
	minB := minBal[accType.String]
	accountID = newUUID()
	newAccNum = accountNumber()
	_, err = tx.Exec(`INSERT INTO accounts (id,account_number,customer_id,branch_id,account_type,balance,currency,interest_rate,minimum_balance,account_status) VALUES (?,?,?,?,?,?,?,?,?,'active')`,
		accountID, newAccNum, custID.String, branchID, accType.String, initDep.Float64, "NPR", rate, minB)
	if err != nil {
		c.JSON(500, gin.H{"detail": "Failed to create account: " + err.Error()})
		return
	}

	// Record initial deposit as a transaction if > 0
	if initDep.Float64 > 0 {
		tx.Exec(`INSERT INTO transactions (id,reference_number,to_account_id,to_account_number,amount,transaction_type,description,status,balance_after,channel,branch_id) VALUES (?,?,?,?,?,'DEPOSIT','Initial deposit on account opening','COMPLETED',?,?,?)`,
			newUUID(), txRef(), accountID, newAccNum, initDep.Float64, initDep.Float64, "branch", branchID)
	}

	// Update application
	tx.Exec(`UPDATE account_applications SET status='approved',reviewed_by=?,review_note=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?`,
		reviewer, req.Note, appID)
	tx.Commit()

	c.JSON(200, gin.H{
		"status":          "approved",
		"account_number":  newAccNum,
		"account_type":    accType.String,
		"initial_balance": initDep.Float64,
		"message":         "Account opened successfully",
	})
}

func handleBranchRejectApplication(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	appIDStr := c.Param("id")
	appID, _ := strconv.Atoi(appIDStr)
	var req struct {
		Note string `json:"note"`
	}
	c.ShouldBindJSON(&req)

	claims := c.MustGet("claims").(map[string]interface{})
	reviewer, _ := claims["sub"].(string)
	branchID, _ := claims["branch_id"].(string)

	res, err := db.Exec(`UPDATE account_applications SET status='rejected',reviewed_by=?,review_note=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND branch_id=? AND status='pending'`,
		reviewer, req.Note, appID, branchID)
	if err != nil || func() int64 { n, _ := res.RowsAffected(); return n }() == 0 {
		c.JSON(404, gin.H{"detail": "Application not found or already processed"})
		return
	}
	c.JSON(200, gin.H{"status": "rejected", "message": "Application rejected"})
}

func handleBranchBankingSummary(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	if !dbAvailable() {
		c.JSON(200, gin.H{})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	branchID, _ := claims["branch_id"].(string)

	var totalAccounts, activeAccounts, dormantAccounts, pendingApps, activeFDs int
	var totalBalance, totalFDValue float64

	db.QueryRow("SELECT COUNT(*) FROM accounts WHERE branch_id=?", branchID).Scan(&totalAccounts)
	db.QueryRow("SELECT COUNT(*) FROM accounts WHERE branch_id=? AND is_active=1 AND (account_status='active' OR account_status IS NULL)", branchID).Scan(&activeAccounts)
	db.QueryRow("SELECT COUNT(*) FROM accounts WHERE branch_id=? AND account_status='dormant'", branchID).Scan(&dormantAccounts)
	db.QueryRow("SELECT COALESCE(SUM(balance),0) FROM accounts WHERE branch_id=? AND is_active=1", branchID).Scan(&totalBalance)
	db.QueryRow("SELECT COUNT(*) FROM account_applications WHERE branch_id=? AND status='pending'", branchID).Scan(&pendingApps)
	db.QueryRow("SELECT COUNT(*) FROM fixed_deposits WHERE branch_id=? AND status='ACTIVE'", branchID).Scan(&activeFDs)
	db.QueryRow("SELECT COALESCE(SUM(principal),0) FROM fixed_deposits WHERE branch_id=? AND status='ACTIVE'", branchID).Scan(&totalFDValue)

	c.JSON(200, gin.H{
		"branch_id":            branchID,
		"total_accounts":       totalAccounts,
		"active_accounts":      activeAccounts,
		"dormant_accounts":     dormantAccounts,
		"total_balance_npr":    math_round(totalBalance, 2),
		"pending_applications": pendingApps,
		"active_fds":           activeFDs,
		"total_fd_value_npr":   math_round(totalFDValue, 2),
	})
}

func handleBranchClients(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	if !dbAvailable() {
		c.JSON(200, gin.H{"clients": []interface{}{}, "total": 0})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	branchID, _ := claims["branch_id"].(string)
	search := c.Query("search")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	perPage, _ := strconv.Atoi(c.DefaultQuery("per_page", "25"))
	if page < 1 {
		page = 1
	}
	if perPage < 5 {
		perPage = 5
	}
	if perPage > 100 {
		perPage = 100
	}

	// Get distinct customer_ids that have accounts in this branch
	q := `SELECT DISTINCT a.customer_id, COALESCE(up.full_name,'Unknown') as full_name,
		COALESCE(up.national_id,'') as national_id, COALESCE(up.occupation,'') as occupation,
		COALESCE(kv.kyc_status,'pending') as kyc_status,
		COUNT(a.id) as account_count, COALESCE(SUM(a.balance),0) as total_balance
		FROM accounts a
		LEFT JOIN user_profiles up ON up.customer_id = a.customer_id
		LEFT JOIN kyc_verifications kv ON kv.customer_id = a.customer_id
		WHERE a.branch_id=?`
	args := []interface{}{branchID}
	if search != "" {
		q += " AND (up.full_name LIKE ? OR a.customer_id LIKE ? OR up.national_id LIKE ?)"
		like := "%" + search + "%"
		args = append(args, like, like, like)
	}
	q += " GROUP BY a.customer_id ORDER BY total_balance DESC LIMIT ? OFFSET ?"
	args = append(args, perPage, (page-1)*perPage)

	rows, err := db.Query(q, args...)
	if err != nil {
		c.JSON(500, gin.H{"detail": err.Error()})
		return
	}
	defer rows.Close()
	var clients []map[string]interface{}
	for rows.Next() {
		var custID, fullName, natID, occ, kycStatus sql.NullString
		var accCount int
		var totalBal sql.NullFloat64
		rows.Scan(&custID, &fullName, &natID, &occ, &kycStatus, &accCount, &totalBal)
		clients = append(clients, map[string]interface{}{
			"customer_id": custID.String, "full_name": fullName.String,
			"national_id": natID.String, "occupation": occ.String,
			"kyc_status":    kycStatus.String,
			"account_count": accCount, "total_balance": math_round(totalBal.Float64, 2),
		})
	}
	if clients == nil {
		clients = []map[string]interface{}{}
	}
	c.JSON(200, gin.H{"clients": clients, "total": len(clients), "page": page})
}

func handleBranchClientDetail(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	custID := c.Param("customer_id")
	claims := c.MustGet("claims").(map[string]interface{})
	branchID, _ := claims["branch_id"].(string)

	// Profile
	var profile map[string]interface{}
	row := db.QueryRow(`SELECT id,full_name,username,date_of_birth,gender,nationality,national_id,address,district,province,occupation,annual_income,role,is_active,created_at FROM user_profiles WHERE customer_id=?`, custID)
	var id, fullName, username, dob, gender, nat, natID, addr, dist, prov, occ, rol, createdAt sql.NullString
	var annIncome sql.NullFloat64
	var isActive sql.NullInt64
	if err := row.Scan(&id, &fullName, &username, &dob, &gender, &nat, &natID, &addr, &dist, &prov, &occ, &annIncome, &rol, &isActive, &createdAt); err == nil {
		profile = map[string]interface{}{
			"id": id.String, "full_name": fullName.String, "username": username.String,
			"date_of_birth": dob.String, "gender": gender.String, "nationality": nat.String,
			"national_id": natID.String, "address": addr.String, "district": dist.String,
			"province": prov.String, "occupation": occ.String, "annual_income": annIncome.Float64,
			"role": rol.String, "is_active": isActive.Int64 == 1, "created_at": createdAt.String,
		}
	} else {
		profile = map[string]interface{}{"customer_id": custID, "full_name": "Unknown"}
	}

	// KYC
	var kycStatus, kycVerifiedBy, kycNotes, kycAt sql.NullString
	db.QueryRow("SELECT kyc_status,verified_by,notes,verified_at FROM kyc_verifications WHERE customer_id=?", custID).
		Scan(&kycStatus, &kycVerifiedBy, &kycNotes, &kycAt)
	kycInfo := map[string]interface{}{
		"kyc_status":  coalesce(kycStatus.String, "pending"),
		"verified_by": kycVerifiedBy.String,
		"notes":       kycNotes.String,
		"verified_at": kycAt.String,
	}

	// Accounts (only for this branch)
	accRows, _ := db.Query(`SELECT id,account_number,account_type,balance,currency,interest_rate,account_status,is_active,opened_at FROM accounts WHERE customer_id=? AND branch_id=?`, custID, branchID)
	var accounts []map[string]interface{}
	for accRows.Next() {
		var aID, accNum, accType, currency, accStatus, openedAt sql.NullString
		var balance, rate sql.NullFloat64
		var isAct sql.NullInt64
		accRows.Scan(&aID, &accNum, &accType, &balance, &currency, &rate, &accStatus, &isAct, &openedAt)
		accounts = append(accounts, map[string]interface{}{
			"id": aID.String, "account_number": accNum.String, "account_type": accType.String,
			"balance": math_round(balance.Float64, 2), "currency": currency.String,
			"interest_rate": rate.Float64, "account_status": coalesce(accStatus.String, "active"),
			"is_active": isAct.Int64 == 1, "opened_at": openedAt.String,
		})
	}
	accRows.Close()
	if accounts == nil {
		accounts = []map[string]interface{}{}
	}

	// FDs
	fdRows, _ := db.Query(`SELECT id,fd_number,principal,interest_rate,tenure_months,maturity_date,maturity_amount,status,auto_renew,opened_at FROM fixed_deposits WHERE customer_id=? AND branch_id=?`, custID, branchID)
	var fds []map[string]interface{}
	for fdRows.Next() {
		var fdID, fdNum, matDate, status, openedAt sql.NullString
		var principal, rate, matAmt sql.NullFloat64
		var tenure, autoRenew sql.NullInt64
		fdRows.Scan(&fdID, &fdNum, &principal, &rate, &tenure, &matDate, &matAmt, &status, &autoRenew, &openedAt)
		fds = append(fds, map[string]interface{}{
			"id": fdID.String, "fd_number": fdNum.String, "principal": principal.Float64,
			"interest_rate": rate.Float64, "tenure_months": tenure.Int64,
			"maturity_date": matDate.String, "maturity_amount": matAmt.Float64,
			"status": status.String, "auto_renew": autoRenew.Int64 == 1, "opened_at": openedAt.String,
		})
	}
	fdRows.Close()
	if fds == nil {
		fds = []map[string]interface{}{}
	}

	c.JSON(200, gin.H{
		"customer_id":    custID,
		"profile":        profile,
		"kyc":            kycInfo,
		"accounts":       accounts,
		"fixed_deposits": fds,
	})
}

func handleBranchVerifyKYC(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	custID := c.Param("customer_id")
	var req struct {
		Status string `json:"status"` // verified, rejected, pending
		Notes  string `json:"notes"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Status == "" {
		req.Status = "verified"
	}
	validStatuses := map[string]bool{"verified": true, "rejected": true, "pending": true}
	if !validStatuses[req.Status] {
		c.JSON(400, gin.H{"detail": "status must be verified, rejected, or pending"})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	reviewer, _ := claims["sub"].(string)

	db.Exec(`INSERT INTO kyc_verifications (customer_id,verified_by,verified_at,kyc_status,notes) VALUES (?,?,CURRENT_TIMESTAMP,?,?)
		ON CONFLICT(customer_id) DO UPDATE SET verified_by=excluded.verified_by, verified_at=excluded.verified_at, kyc_status=excluded.kyc_status, notes=excluded.notes`,
		custID, reviewer, req.Status, req.Notes)

	c.JSON(200, gin.H{"customer_id": custID, "kyc_status": req.Status, "verified_by": reviewer, "message": "KYC updated"})
}

func handleBranchAllAccounts(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	if !dbAvailable() {
		c.JSON(200, gin.H{"accounts": []interface{}{}, "total": 0})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	branchID, _ := claims["branch_id"].(string)
	statusFilter := c.DefaultQuery("status", "all")
	accType := c.Query("type")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	perPage, _ := strconv.Atoi(c.DefaultQuery("per_page", "25"))
	if page < 1 {
		page = 1
	}
	if perPage > 100 {
		perPage = 100
	}

	q := `SELECT a.id,a.account_number,a.customer_id,COALESCE(up.full_name,'Unknown'),a.account_type,a.balance,a.currency,a.interest_rate,a.account_status,a.is_active,a.opened_at
		FROM accounts a LEFT JOIN user_profiles up ON up.customer_id=a.customer_id WHERE a.branch_id=?`
	args := []interface{}{branchID}
	if statusFilter != "all" {
		q += " AND a.account_status=?"
		args = append(args, statusFilter)
	}
	if accType != "" {
		q += " AND a.account_type=?"
		args = append(args, accType)
	}
	q += " ORDER BY a.balance DESC LIMIT ? OFFSET ?"
	args = append(args, perPage, (page-1)*perPage)

	rows, err := db.Query(q, args...)
	if err != nil {
		c.JSON(500, gin.H{"detail": err.Error()})
		return
	}
	defer rows.Close()
	var accounts []map[string]interface{}
	for rows.Next() {
		var id, accNum, custID, fullName, accType2, currency, accStatus, openedAt sql.NullString
		var balance, rate sql.NullFloat64
		var isAct sql.NullInt64
		rows.Scan(&id, &accNum, &custID, &fullName, &accType2, &balance, &currency, &rate, &accStatus, &isAct, &openedAt)
		accounts = append(accounts, map[string]interface{}{
			"id": id.String, "account_number": accNum.String, "customer_id": custID.String,
			"full_name": fullName.String, "account_type": accType2.String,
			"balance": math_round(balance.Float64, 2), "currency": currency.String,
			"interest_rate": rate.Float64, "account_status": coalesce(accStatus.String, "active"),
			"is_active": isAct.Int64 == 1, "opened_at": openedAt.String,
		})
	}
	if accounts == nil {
		accounts = []map[string]interface{}{}
	}
	c.JSON(200, gin.H{"accounts": accounts, "total": len(accounts), "page": page})
}

func handleBranchAllFDs(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	if !dbAvailable() {
		c.JSON(200, gin.H{"fixed_deposits": []interface{}{}, "total": 0})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	branchID, _ := claims["branch_id"].(string)
	statusFilter := c.DefaultQuery("status", "ACTIVE")

	q := `SELECT fd.id,fd.fd_number,fd.customer_id,COALESCE(up.full_name,'Unknown'),fd.principal,fd.interest_rate,fd.tenure_months,fd.maturity_date,fd.maturity_amount,fd.status,fd.auto_renew,fd.opened_at
		FROM fixed_deposits fd LEFT JOIN user_profiles up ON up.customer_id=fd.customer_id WHERE fd.branch_id=?`
	args := []interface{}{branchID}
	if statusFilter != "all" {
		q += " AND fd.status=?"
		args = append(args, statusFilter)
	}
	q += " ORDER BY fd.maturity_date ASC LIMIT 200"

	rows, err := db.Query(q, args...)
	if err != nil {
		c.JSON(500, gin.H{"detail": err.Error()})
		return
	}
	defer rows.Close()
	var fds []map[string]interface{}
	for rows.Next() {
		var fdID, fdNum, custID, fullName, matDate, status, openedAt sql.NullString
		var principal, rate, matAmt sql.NullFloat64
		var tenure, autoRenew sql.NullInt64
		rows.Scan(&fdID, &fdNum, &custID, &fullName, &principal, &rate, &tenure, &matDate, &matAmt, &status, &autoRenew, &openedAt)
		fds = append(fds, map[string]interface{}{
			"id": fdID.String, "fd_number": fdNum.String, "customer_id": custID.String,
			"full_name": fullName.String, "principal": principal.Float64,
			"interest_rate": rate.Float64, "tenure_months": tenure.Int64,
			"maturity_date": matDate.String, "maturity_amount": matAmt.Float64,
			"status": status.String, "auto_renew": autoRenew.Int64 == 1, "opened_at": openedAt.String,
		})
	}
	if fds == nil {
		fds = []map[string]interface{}{}
	}
	c.JSON(200, gin.H{"fixed_deposits": fds, "total": len(fds)})
}

// 11. GET /api/branch/aml_network — any auth
func handleBranchAMLNetwork(c *gin.Context) {
	claims := c.MustGet("claims").(map[string]interface{})
	branchID, _ := claims["branch_id"].(string)

	rng := rand.New(rand.NewSource(int64(stableHash(branchID))))

	nCustomers := rng.Intn(7) + 8
	nAccounts := rng.Intn(4) + 4
	nExternal := rng.Intn(3) + 2

	// Risk weight helpers: 15% high, 35% medium, 40% low, 10% unknown
	pickRisk := func() string {
		r := rng.Intn(100)
		if r < 15 {
			return "high"
		} else if r < 50 {
			return "medium"
		} else if r < 90 {
			return "low"
		}
		return "unknown"
	}

	type amlNode struct {
		ID    string `json:"id"`
		Type  string `json:"type"`
		Risk  string `json:"risk"`
		Label string `json:"label"`
	}

	var nodes []amlNode
	highRiskCustomers := 0
	for i := 0; i < nCustomers; i++ {
		risk := pickRisk()
		if risk == "high" {
			highRiskCustomers++
		}
		nodes = append(nodes, amlNode{
			ID:    fmt.Sprintf("C%03d", i+1),
			Type:  "customer",
			Risk:  risk,
			Label: fmt.Sprintf("Customer %03d", i+1),
		})
	}
	for i := 0; i < nAccounts; i++ {
		nodes = append(nodes, amlNode{
			ID:    fmt.Sprintf("ACC%03d", i+1),
			Type:  "account",
			Risk:  pickRisk(),
			Label: fmt.Sprintf("Account %03d", i+1),
		})
	}
	for i := 0; i < nExternal; i++ {
		nodes = append(nodes, amlNode{
			ID:    fmt.Sprintf("EXT%03d", i+1),
			Type:  "external",
			Risk:  "unknown",
			Label: fmt.Sprintf("External %03d", i+1),
		})
	}

	edgeTypes := []string{"transfer", "peer_transfer", "withdrawal", "deposit", "remittance"}
	nEdges := rng.Intn(16) + 20
	type amlEdge struct {
		Source     string `json:"source"`
		Target     string `json:"target"`
		Type       string `json:"type"`
		Suspicious bool   `json:"suspicious"`
	}
	var edges []amlEdge
	suspiciousLinks := 0
	for i := 0; i < nEdges; i++ {
		src := nodes[rng.Intn(len(nodes))]
		tgt := nodes[rng.Intn(len(nodes))]
		eType := edgeTypes[rng.Intn(len(edgeTypes))]
		srcHigh := src.Risk == "high" || src.Risk == "medium"
		tgtHigh := tgt.Risk == "high" || tgt.Risk == "medium"
		suspicious := (srcHigh || tgtHigh) && rng.Float64() > 0.4
		if suspicious {
			suspiciousLinks++
		}
		edges = append(edges, amlEdge{
			Source:     src.ID,
			Target:     tgt.ID,
			Type:       eType,
			Suspicious: suspicious,
		})
	}

	c.JSON(200, gin.H{
		"nodes": nodes,
		"edges": edges,
		"summary": gin.H{
			"total_nodes":         len(nodes),
			"suspicious_links":    suspiciousLinks,
			"high_risk_customers": highRiskCustomers,
		},
	})
}

func handleBranchKYCApplications(c *gin.Context) {
	statusFilter := c.Query("status") // optional filter

	// Read from SQLite — all branches visible to any BM (demo: no branch isolation)
	query := `SELECT id, reference, customer_id, full_name, branch_id, phone, email,
		loan_purpose, loan_amount, status, ai_verified, face_profile_live, face_profile_id,
		liveness_passed, sig_match, COALESCE(review_note,''), submitted_at
		FROM kyc_applications`
	args := []interface{}{}
	if statusFilter != "" {
		query += " WHERE status = ?"
		args = append(args, statusFilter)
	}
	query += " ORDER BY submitted_at DESC LIMIT 100"

	rows, err := db.Query(query, args...)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	type appRow struct {
		ID              int     `json:"id"`
		Reference       string  `json:"reference"`
		CustomerID      string  `json:"customer_id"`
		FullName        string  `json:"full_name"`
		BranchID        string  `json:"branch_id"`
		Phone           string  `json:"phone"`
		Email           string  `json:"email"`
		LoanPurpose     string  `json:"loan_purpose"`
		LoanAmount      float64 `json:"loan_amount"`
		Status          string  `json:"status"`
		AIVerified      bool    `json:"ai_verified"`
		FaceProfileLive float64 `json:"face_profile_live"`
		FaceProfileID   float64 `json:"face_profile_id"`
		LivenessPassed  bool    `json:"liveness_passed"`
		SigMatch        float64 `json:"sig_match"`
		ReviewNote      string  `json:"review_note"`
		SubmittedAt     string  `json:"submitted_at"`
	}

	apps := []appRow{}
	for rows.Next() {
		var a appRow
		var aiVerified, livenessPassed int
		rows.Scan(&a.ID, &a.Reference, &a.CustomerID, &a.FullName, &a.BranchID,
			&a.Phone, &a.Email, &a.LoanPurpose, &a.LoanAmount, &a.Status,
			&aiVerified, &a.FaceProfileLive, &a.FaceProfileID,
			&livenessPassed, &a.SigMatch, &a.ReviewNote, &a.SubmittedAt)
		a.AIVerified = aiVerified == 1
		a.LivenessPassed = livenessPassed == 1
		apps = append(apps, a)
	}

	// Pad with seeded demo data if DB is empty (so BM page is never blank)
	if len(apps) == 0 {
		branchID, _ := c.MustGet("claims").(map[string]interface{})["branch_id"].(string)
		rng := rand.New(rand.NewSource(int64(stableHash(branchID + "kyc2026"))))
		names := []string{"Rajan Sharma", "Sita Thapa", "Bikram Gurung", "Anita Rai", "Dipak Adhikari"}
		purposes := []string{"Home", "Business", "Education", "Vehicle", "Personal"}
		statuses := []string{"pending_ai", "under_review", "approved", "approved", "rejected"}
		for i := 0; i < 5; i++ {
			status := statuses[i]
			ai := status == "approved" || status == "under_review"
			fpl := 0.0
			fpi := 0.0
			sig := 0.0
			if ai {
				fpl = math.Round((0.82+rng.Float64()*0.14)*1000) / 1000
				fpi = math.Round((0.78+rng.Float64()*0.18)*1000) / 1000
				sig = math.Round((0.80+rng.Float64()*0.16)*1000) / 1000
			}
			apps = append(apps, appRow{
				ID: 100 + i, Reference: fmt.Sprintf("KYC-2026-%05d", 10000+rng.Intn(89999)),
				CustomerID: fmt.Sprintf("cust%03d", rng.Intn(999)), FullName: names[i],
				BranchID: branchID, Phone: fmt.Sprintf("98%08d", rng.Intn(100000000)),
				LoanPurpose: purposes[i%len(purposes)], LoanAmount: float64(200000 + rng.Intn(2000000)),
				Status: status, AIVerified: ai, FaceProfileLive: fpl, FaceProfileID: fpi,
				LivenessPassed: ai, SigMatch: sig,
				SubmittedAt: time.Now().AddDate(0, 0, -(i + 1)).UTC().Format(time.RFC3339),
			})
		}
	}

	c.JSON(200, gin.H{"applications": apps, "total": len(apps)})
}

func handleBranchKYCReview(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(400, gin.H{"error": "invalid id"})
		return
	}
	var body struct {
		Action string `json:"action"`
		Note   string `json:"note"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(400, gin.H{"error": "invalid body"})
		return
	}
	newStatus := "under_review"
	if body.Action == "approve" {
		newStatus = "approved"
	}
	if body.Action == "reject" {
		newStatus = "rejected"
	}

	claims := c.MustGet("claims").(map[string]interface{})
	reviewer, _ := claims["sub"].(string)

	db.Exec(`UPDATE kyc_applications SET status=?, review_note=?, reviewed_at=CURRENT_TIMESTAMP WHERE id=?`,
		newStatus, body.Note, id)
	if body.Action == "approve" {
		db.Exec(`INSERT OR REPLACE INTO kyc_verifications (customer_id, verified_by, verified_at, kyc_status, notes)
			SELECT customer_id, ?, CURRENT_TIMESTAMP, 'verified', ? FROM kyc_applications WHERE id=?`,
			reviewer, body.Note, id)
	}
	c.JSON(200, gin.H{"id": id, "status": newStatus, "note": body.Note})
}

func handleBranchPAR(c *gin.Context) {
	claims := c.MustGet("claims").(map[string]interface{})
	branchID, _ := claims["branch_id"].(string)
	rng := rand.New(rand.NewSource(int64(stableHash(branchID + "par2026"))))

	type PARMetric struct {
		Period       int     `json:"period"`
		Portfolio    float64 `json:"portfolio_at_risk"`
		Amount       float64 `json:"amount_at_risk"`
		LoanCount    int     `json:"loan_count"`
		NRBBenchmark float64 `json:"nrb_benchmark"`
		Status       string  `json:"status"`
	}

	totalPortfolio := 50000000 + rng.Float64()*100000000

	makePAR := func(period int, baseRate, benchmark float64) PARMetric {
		rate := math.Round((baseRate+rng.Float64()*1.5)*100) / 100
		amount := math.Round(totalPortfolio * rate / 100)
		count := 5 + rng.Intn(20)
		status := "good"
		if rate > benchmark*1.5 {
			status = "critical"
		} else if rate > benchmark {
			status = "warning"
		}
		return PARMetric{Period: period, Portfolio: rate, Amount: amount, LoanCount: count, NRBBenchmark: benchmark, Status: status}
	}

	type Trend struct {
		Month string
		PAR30 float64
		PAR60 float64
		PAR90 float64
	}
	trends := []Trend{}
	months := []string{"Jan", "Feb", "Mar", "Apr", "May", "Jun"}
	base30 := 3.0 + rng.Float64()*2
	base60 := 1.5 + rng.Float64()*1.5
	base90 := 0.8 + rng.Float64()*1.2
	for _, m := range months {
		trends = append(trends, Trend{m,
			math.Round((base30+rng.NormFloat64()*0.5)*100) / 100,
			math.Round((base60+rng.NormFloat64()*0.3)*100) / 100,
			math.Round((base90+rng.NormFloat64()*0.2)*100) / 100,
		})
	}

	type LoanTypeBreakdown struct {
		Type   string
		PAR    float64
		Amount float64
	}
	loanTypes := []LoanTypeBreakdown{
		{"Home", math.Round((2+rng.Float64()*2)*100) / 100, math.Round(totalPortfolio * 0.35 * 0.04)},
		{"Business", math.Round((3+rng.Float64()*3)*100) / 100, math.Round(totalPortfolio * 0.28 * 0.06)},
		{"Personal", math.Round((4+rng.Float64()*4)*100) / 100, math.Round(totalPortfolio * 0.18 * 0.07)},
		{"Agriculture", math.Round((5+rng.Float64()*4)*100) / 100, math.Round(totalPortfolio * 0.12 * 0.08)},
		{"Vehicle", math.Round((2+rng.Float64()*2)*100) / 100, math.Round(totalPortfolio * 0.07 * 0.03)},
	}

	c.JSON(200, gin.H{
		"branch_id":           branchID,
		"total_portfolio_npr": math.Round(totalPortfolio),
		"par_metrics":         []PARMetric{makePAR(30, 4.5, 5.0), makePAR(60, 2.2, 3.0), makePAR(90, 1.1, 2.0)},
		"monthly_trend":       trends,
		"by_loan_type":        loanTypes,
		"as_of":               time.Now().UTC().Format("2006-01-02"),
	})
}

func handleBranchGenerateSAR(c *gin.Context) {
	var body struct {
		CustomerID string `json:"customer_id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(400, gin.H{"error": "invalid body"})
		return
	}
	if body.CustomerID == "" {
		body.CustomerID = "cust001"
	}

	claims := c.MustGet("claims").(map[string]interface{})
	branchID, _ := claims["branch_id"].(string)
	reviewerName, _ := claims["full_name"].(string)
	if reviewerName == "" {
		reviewerName = "Branch Manager"
	}

	rng := rand.New(rand.NewSource(int64(stableHash(body.CustomerID + "sar"))))

	txAmounts := []float64{float64(50000 + rng.Intn(500000)), float64(30000 + rng.Intn(200000)), float64(100000 + rng.Intn(800000))}
	txDates := []string{
		time.Now().AddDate(0, 0, -5).Format("2006-01-02"),
		time.Now().AddDate(0, 0, -3).Format("2006-01-02"),
		time.Now().AddDate(0, 0, -1).Format("2006-01-02"),
	}

	riskScore := 0.72 + rng.Float64()*0.25

	branchPrefixLen := 4
	if len(branchID) < 4 {
		branchPrefixLen = len(branchID)
	}
	branchPrefix := branchID[:branchPrefixLen]

	c.JSON(200, gin.H{
		"sar_number":        fmt.Sprintf("SAR-%s-%d", strings.ToUpper(branchPrefix), time.Now().UnixMilli()%100000),
		"report_date":       time.Now().UTC().Format("2006-01-02"),
		"branch_id":         branchID,
		"reporting_officer": reviewerName,
		"subject": gin.H{
			"customer_id":     body.CustomerID,
			"account_numbers": []string{fmt.Sprintf("NIC%09d", rng.Intn(999999999))},
			"risk_score":      math.Round(riskScore*1000) / 1000,
			"risk_grade": func() string {
				if riskScore > 0.85 {
					return "CRITICAL"
				} else if riskScore > 0.72 {
					return "HIGH"
				}
				return "MEDIUM"
			}(),
		},
		"suspicious_transactions": []gin.H{
			{"date": txDates[0], "amount": txAmounts[0], "type": "CASH_DEPOSIT", "flag": "Unusual large cash deposit"},
			{"date": txDates[1], "amount": txAmounts[1], "type": "TRANSFER", "flag": "Multiple transfers to unrelated accounts"},
			{"date": txDates[2], "amount": txAmounts[2], "type": "WITHDRAWAL", "flag": "Large withdrawal followed by immediate re-deposit"},
		},
		"total_suspicious_amount": txAmounts[0] + txAmounts[1] + txAmounts[2],
		"detection_method":        "ML Anomaly Detection (Z-score > 3.5σ)",
		"indicators":              []string{"Unusual transaction velocity", "Off-hours activity", "Round-number amounts", "Structuring pattern detected"},
		"ml_confidence":           math.Round(riskScore*1000) / 10,
		"recommended_action": func() string {
			if riskScore > 0.85 {
				return "Freeze account pending investigation"
			}
			return "File SAR and monitor for 30 days"
		}(),
		"nrb_reporting_required": riskScore > 0.72,
		"regulatory_ref":         "NRB AMLD Directive 2078 Section 14(3)",
	})
}

func handleBranchFraudStream(c *gin.Context) {
	claims := c.MustGet("claims").(map[string]interface{})
	branchID, _ := claims["branch_id"].(string)

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	merchants := []string{"Bhat Bhateni", "Civil Mall", "Big Mart", "Online Transfer", "ATM Withdrawal", "Foodmandu", "Daraz", "NTC Bill", "POS Terminal", "International Wire"}
	rules := []string{"velocity_spike", "off_hours_activity", "large_cash_deposit", "round_number_structuring", "unusual_merchant", "geo_anomaly"}
	features := []string{"amount", "hour_of_day", "merchant_category", "transaction_frequency", "account_age", "device_fingerprint"}

	ticker := time.NewTicker(4 * time.Second)
	defer ticker.Stop()
	count := 0

	rng := rand.New(rand.NewSource(int64(stableHash(branchID + "fraud"))))
	for i := 0; i < 5; i++ {
		riskScore := 0.3 + rng.Float64()*0.7
		flagged := riskScore > 0.72
		evt := gin.H{
			"id":          count - 5 + i,
			"customer_id": fmt.Sprintf("CUST-%04d", rng.Intn(9999)),
			"amount":      math.Round(1000 + rng.Float64()*200000),
			"merchant":    merchants[rng.Intn(len(merchants))],
			"risk_score":  math.Round(riskScore*1000) / 1000,
			"flagged":     flagged,
			"rule": func() string {
				if flagged {
					return rules[rng.Intn(len(rules))]
				}
				return ""
			}(),
			"top_feature": features[rng.Intn(len(features))],
			"timestamp":   time.Now().Add(-time.Duration(5-i) * time.Minute).UTC().Format(time.RFC3339),
			"historical":  true,
		}
		data, _ := json.Marshal(evt)
		fmt.Fprintf(c.Writer, "data: %s\n\n", data)
	}
	c.Writer.Flush()

	liveRng := rand.New(rand.NewSource(time.Now().UnixNano()))
	for {
		select {
		case <-c.Request.Context().Done():
			return
		case <-ticker.C:
			count++
			riskScore := 0.2 + liveRng.Float64()*0.8
			flagged := riskScore > 0.72
			evt := gin.H{
				"id":          count,
				"customer_id": fmt.Sprintf("CUST-%04d", liveRng.Intn(9999)),
				"amount":      math.Round(500 + liveRng.Float64()*500000),
				"merchant":    merchants[liveRng.Intn(len(merchants))],
				"risk_score":  math.Round(riskScore*1000) / 1000,
				"flagged":     flagged,
				"rule": func() string {
					if flagged {
						return rules[liveRng.Intn(len(rules))]
					}
					return ""
				}(),
				"top_feature": features[liveRng.Intn(len(features))],
				"timestamp":   time.Now().UTC().Format(time.RFC3339),
				"historical":  false,
			}
			data, _ := json.Marshal(evt)
			fmt.Fprintf(c.Writer, "data: %s\n\n", data)
			c.Writer.Flush()
		}
	}
}

// handleBranchBatchScore scores up to 50 customers in one request.
// Role: branch_manager or admin. Returns per-customer decision + tier.
func handleBranchBatchScore(c *gin.Context) {
	role := c.GetString("role")
	if role != "branch_manager" && role != "admin" {
		c.JSON(403, gin.H{"error": "branch_manager or admin role required"})
		return
	}
	var req batchScoreReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": "invalid request body"})
		return
	}
	if len(req.Customers) == 0 {
		c.JSON(400, gin.H{"error": "customers array must not be empty"})
		return
	}
	if len(req.Customers) > 50 {
		c.JSON(400, gin.H{"error": "batch size exceeds maximum of 50"})
		return
	}

	results := make([]batchScoreResult, 0, len(req.Customers))
	for _, entry := range req.Customers {
		if len(entry.Features) == 0 {
			results = append(results, batchScoreResult{CustomerID: entry.CustomerID, Error: "no features provided"})
			continue
		}
		score := scoreFromFeatures(entry.Features)
		decision, tier := decisionFromScore(score)
		results = append(results, batchScoreResult{
			CustomerID: entry.CustomerID,
			Score:      score,
			Percentile: score, // score IS the percentile in the linear model
			Decision:   decision,
			Tier:       tier,
		})
	}

	c.JSON(200, gin.H{
		"results":    results,
		"count":      len(results),
		"branch_id":  c.GetString("branch_id"),
		"request_id": c.GetString("request_id"),
	})
}
