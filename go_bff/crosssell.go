package main

import (
	"database/sql"
	"sort"

	"github.com/gin-gonic/gin"
)

// Cross-sell / next-best-product recommender. Branch-local: it reads only this
// branch's own account holdings, deposits, loans, cards, and income on file —
// nothing leaves the branch. Rule-based propensity scoring (no model needed).
// ponytail: a scorecard, not an ML model — holdings + balance + income are the
// only signals that matter here and they're deterministic.

type recommendation struct {
	CustomerID string  `json:"customer_id"`
	Name       string  `json:"name"`
	Product    string  `json:"product"`
	Reason     string  `json:"reason"`
	Propensity int     `json:"propensity"` // 0–100
	Value      float64 `json:"est_value"`  // indicative NPR opportunity
}

func handleBranchCrossSell(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	branchID, _ := claims["branch_id"].(string)
	if !dbAvailable() {
		c.JSON(200, gin.H{"recommendations": []recommendation{}})
		return
	}

	rows, err := db.Query(`SELECT a.customer_id, COALESCE(up.full_name,a.customer_id), COALESCE(up.annual_income,0),
			COALESCE(SUM(a.balance),0),
			(SELECT COUNT(*) FROM fixed_deposits f WHERE f.customer_id=a.customer_id AND f.status='ACTIVE'),
			(SELECT COUNT(*) FROM loans l WHERE l.customer_id=a.customer_id AND l.status='ACTIVE'),
			(SELECT COUNT(*) FROM cards cd WHERE cd.customer_id=a.customer_id AND cd.status!='CANCELLED')
		FROM accounts a LEFT JOIN user_profiles up ON up.customer_id=a.customer_id
		WHERE a.branch_id=? AND a.is_active=1
		GROUP BY a.customer_id`, branchID)
	if err != nil {
		c.JSON(500, gin.H{"detail": err.Error()})
		return
	}
	defer rows.Close()

	recs := []recommendation{}
	for rows.Next() {
		var cid, name sql.NullString
		var income, balance sql.NullFloat64
		var hasFD, hasLoan, hasCard sql.NullInt64
		rows.Scan(&cid, &name, &income, &balance, &hasFD, &hasLoan, &hasCard)

		best := pickProduct(balance.Float64, income.Float64, hasFD.Int64 > 0, hasLoan.Int64 > 0, hasCard.Int64 > 0)
		if best == nil {
			continue
		}
		best.CustomerID = cid.String
		best.Name = name.String
		recs = append(recs, *best)
	}

	sort.Slice(recs, func(i, j int) bool { return recs[i].Propensity > recs[j].Propensity })
	if len(recs) > 50 {
		recs = recs[:50]
	}
	c.JSON(200, gin.H{
		"branch_id":       branchID,
		"recommendations": recs,
		"count":           len(recs),
		"method":          "rule-based propensity scorecard (branch-local holdings, no data leaves the branch)",
	})
}

// pickProduct returns the single best next product for a customer, or nil if
// they already hold everything relevant.
func pickProduct(balance, income float64, hasFD, hasLoan, hasCard bool) *recommendation {
	type cand struct {
		product, reason string
		score           int
		value           float64
	}
	var cands []cand

	// Fixed deposit — idle balance sitting in savings.
	if !hasFD && balance >= 100000 {
		score := 55 + int(minF(balance/200000*10, 35))
		cands = append(cands, cand{"Fixed Deposit", "High idle savings balance earning low interest", score, math_round(balance*0.6, 0)})
	}
	// Debit card — no card on file.
	if !hasCard {
		cands = append(cands, cand{"Debit Card", "No active card — drives digital engagement", 60, 0})
	}
	// Personal/Home loan — good income, no active loan, healthy balance.
	if !hasLoan && income >= 600000 {
		score := 50 + int(minF(income/200000*8, 35))
		cands = append(cands, cand{"Personal / Home Loan", "Strong income with no active borrowing", score, math_round(income*1.5, 0)})
	}
	// Salary / premium account — high income but modest balance.
	if income >= 1200000 && balance < income*0.2 {
		cands = append(cands, cand{"Premium Salary Account", "High earner with low parked balance", 48, 0})
	}

	if len(cands) == 0 {
		return nil
	}
	best := cands[0]
	for _, x := range cands[1:] {
		if x.score > best.score {
			best = x
		}
	}
	p := best.score
	if p > 99 {
		p = 99
	}
	return &recommendation{Product: best.product, Reason: best.reason, Propensity: p, Value: best.value}
}

func minF(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}
