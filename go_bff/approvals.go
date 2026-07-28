package main

// Maker-checker (4-eyes) approval queue + GL trial-balance verifier (Phase 6,
// CBS hardening). High-value teller actions are enqueued instead of executed; a
// manager approves or rejects. On approval the original action runs through its
// shared core (e.g. withdrawCore), so the same validation applies. Approvals are
// gated by branch.manage; the trial balance by hq.audit.

import (
	"database/sql"
	"encoding/json"

	"github.com/gin-gonic/gin"
)

func initApprovals() {
	if db == nil {
		return
	}
	db.Exec(`CREATE TABLE IF NOT EXISTS approval_requests (
		id TEXT PRIMARY KEY,
		kind TEXT NOT NULL,
		payload TEXT NOT NULL,
		requested_by TEXT,
		branch_id TEXT,
		amount REAL,
		status TEXT NOT NULL DEFAULT 'PENDING',
		reviewed_by TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		reviewed_at DATETIME
	)`)
}

func enqueueApproval(kind, by, branch string, amount float64, payload map[string]interface{}) string {
	id := newUUID()
	b, _ := json.Marshal(payload)
	db.Exec(`INSERT INTO approval_requests (id,kind,payload,requested_by,branch_id,amount) VALUES (?,?,?,?,?,?)`,
		id, kind, string(b), by, branch, amount)
	return id
}

func handleApprovalsList(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	rows, _ := db.Query(`SELECT id,kind,requested_by,branch_id,amount,created_at
		FROM approval_requests WHERE status='PENDING' ORDER BY created_at`)
	out := []gin.H{}
	if rows != nil {
		for rows.Next() {
			var id, kind, by, branch, at string
			var amt float64
			rows.Scan(&id, &kind, &by, &branch, &amt, &at)
			out = append(out, gin.H{"id": id, "kind": kind, "requested_by": by,
				"branch_id": branch, "amount": amt, "created_at": at})
		}
		rows.Close()
	}
	c.JSON(200, gin.H{"approvals": out})
}

// executeApproval runs the queued action. Returns (httpCode, message); code 0 = ok.
func executeApproval(kind, payload string) (int, string) {
	var p map[string]interface{}
	json.Unmarshal([]byte(payload), &p)
	switch kind {
	case "teller_withdraw":
		acct, _ := p["account_number"].(string)
		amount, _ := p["amount"].(float64)
		remarks, _ := p["remarks"].(string)
		_, _, code, msg := withdrawCore(acct, amount, remarks, "approved")
		return code, msg
	}
	return 400, "unknown approval kind"
}

func approvalDecision(c *gin.Context, approve bool) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	id := c.Param("id")
	reviewer, _ := c.MustGet("claims").(map[string]interface{})["sub"].(string)

	var kind, payload, status, requestedBy string
	err := db.QueryRow(`SELECT kind,payload,status,requested_by FROM approval_requests WHERE id=?`, id).
		Scan(&kind, &payload, &status, &requestedBy)
	if err == sql.ErrNoRows {
		c.JSON(404, gin.H{"detail": "Approval request not found"})
		return
	}
	if status != "PENDING" {
		c.JSON(409, gin.H{"detail": "Already " + status})
		return
	}
	// Four-eyes: the maker cannot be the checker.
	if reviewer == requestedBy {
		c.JSON(403, gin.H{"detail": "Maker cannot approve their own request"})
		return
	}

	if !approve {
		db.Exec(`UPDATE approval_requests SET status='REJECTED', reviewed_by=?, reviewed_at=CURRENT_TIMESTAMP WHERE id=?`, reviewer, id)
		c.JSON(200, gin.H{"status": "REJECTED"})
		return
	}
	if code, msg := executeApproval(kind, payload); code != 0 {
		db.Exec(`UPDATE approval_requests SET status='FAILED', reviewed_by=?, reviewed_at=CURRENT_TIMESTAMP WHERE id=?`, reviewer, id)
		c.JSON(code, gin.H{"detail": msg})
		return
	}
	db.Exec(`UPDATE approval_requests SET status='APPROVED', reviewed_by=?, reviewed_at=CURRENT_TIMESTAMP WHERE id=?`, reviewer, id)
	c.JSON(200, gin.H{"status": "APPROVED"})
}

func handleApprove(c *gin.Context) { approvalDecision(c, true) }
func handleReject(c *gin.Context)  { approvalDecision(c, false) }

// handleTrialBalance proves the double-entry GL nets to zero (debits == credits).
func handleTrialBalance(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	glSync()
	var debit, credit sql.NullFloat64
	db.QueryRow(`SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0) FROM gl_entries`).Scan(&debit, &credit)
	d, cr := math_round(debit.Float64, 2), math_round(credit.Float64, 2)
	c.JSON(200, gin.H{"total_debit": d, "total_credit": cr, "balanced": d == cr,
		"difference": math_round(d-cr, 2)})
}

func registerApprovalRoutes(auth *gin.RouterGroup) {
	auth.GET("/api/approvals", requirePermission("branch.manage"), handleApprovalsList)
	auth.POST("/api/approvals/:id/approve", requirePermission("branch.manage"), handleApprove)
	auth.POST("/api/approvals/:id/reject", requirePermission("branch.manage"), handleReject)
	auth.GET("/api/hq/trial-balance", requirePermission("hq.audit"), handleTrialBalance)
}
