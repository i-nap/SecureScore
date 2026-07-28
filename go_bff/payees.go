package main

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// ── Beneficiaries (saved payees) ─────────────────────────────

func handleBeneficiaryList(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	cid := coalesce(claims["customer_id"], claims["sub"])
	rows, err := db.Query("SELECT id,nickname,account_number,bank_name,created_at FROM beneficiaries WHERE customer_id=? ORDER BY created_at DESC", cid)
	if err != nil {
		c.JSON(500, gin.H{"detail": err.Error()})
		return
	}
	defer rows.Close()
	items := []map[string]interface{}{}
	for rows.Next() {
		var id, nick, accNum, bank, createdAt sql.NullString
		rows.Scan(&id, &nick, &accNum, &bank, &createdAt)
		items = append(items, map[string]interface{}{
			"id": id.String, "nickname": nick.String, "account_number": accNum.String,
			"bank_name": bank.String, "created_at": createdAt.String,
		})
	}
	c.JSON(200, gin.H{"beneficiaries": items})
}

func handleBeneficiaryAdd(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	var req struct {
		Nickname      string `json:"nickname"`
		AccountNumber string `json:"account_number"`
		BankName      string `json:"bank_name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"detail": "invalid request"})
		return
	}
	if strings.TrimSpace(req.AccountNumber) == "" || strings.TrimSpace(req.Nickname) == "" {
		c.JSON(400, gin.H{"detail": "nickname and account_number are required"})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	cid := coalesce(claims["customer_id"], claims["sub"])
	bank := req.BankName
	if bank == "" {
		bank = "SecureScore Bank"
	}
	id := newUUID()
	_, err := db.Exec("INSERT INTO beneficiaries (id,customer_id,nickname,account_number,bank_name) VALUES (?,?,?,?,?)",
		id, cid, req.Nickname, req.AccountNumber, bank)
	if err != nil {
		c.JSON(500, gin.H{"detail": err.Error()})
		return
	}
	c.JSON(201, gin.H{"status": "added", "id": id, "nickname": req.Nickname, "account_number": req.AccountNumber, "bank_name": bank})
}

func handleBeneficiaryDelete(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	cid := coalesce(claims["customer_id"], claims["sub"])
	res, _ := db.Exec("DELETE FROM beneficiaries WHERE id=? AND customer_id=?", c.Param("id"), cid)
	if n, _ := res.RowsAffected(); n == 0 {
		c.JSON(404, gin.H{"detail": "Beneficiary not found"})
		return
	}
	c.JSON(200, gin.H{"status": "removed"})
}

// ── Standing instructions (recurring auto-pay) ───────────────

func nextRun(from time.Time, freq string) time.Time {
	if freq == "weekly" {
		return from.AddDate(0, 0, 7)
	}
	return from.AddDate(0, 1, 0) // monthly default
}

func handleStandingList(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	cid := coalesce(claims["customer_id"], claims["sub"])
	rows, err := db.Query(`SELECT id,from_account_number,to_account_number,amount,frequency,next_run,status,description,last_run
		FROM standing_instructions WHERE customer_id=? ORDER BY created_at DESC`, cid)
	if err != nil {
		c.JSON(500, gin.H{"detail": err.Error()})
		return
	}
	defer rows.Close()
	items := []map[string]interface{}{}
	for rows.Next() {
		var id, fromAcc, toAcc, freq, nextR, status, desc, lastR sql.NullString
		var amount sql.NullFloat64
		rows.Scan(&id, &fromAcc, &toAcc, &amount, &freq, &nextR, &status, &desc, &lastR)
		items = append(items, map[string]interface{}{
			"id": id.String, "from_account_number": fromAcc.String, "to_account_number": toAcc.String,
			"amount": amount.Float64, "frequency": freq.String, "next_run": nextR.String,
			"status": status.String, "description": desc.String, "last_run": lastR.String,
		})
	}
	c.JSON(200, gin.H{"standing_instructions": items})
}

func handleStandingCreate(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	var req struct {
		FromAccountNumber string  `json:"from_account_number"`
		ToAccountNumber   string  `json:"to_account_number"`
		Amount            float64 `json:"amount"`
		Frequency         string  `json:"frequency"`
		StartDate         string  `json:"start_date"`
		Description       string  `json:"description"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"detail": "invalid request"})
		return
	}
	if req.Amount <= 0 {
		c.JSON(400, gin.H{"detail": "Amount must be positive"})
		return
	}
	if req.FromAccountNumber == req.ToAccountNumber {
		c.JSON(400, gin.H{"detail": "Source and destination must differ"})
		return
	}
	if req.Frequency != "weekly" && req.Frequency != "monthly" {
		c.JSON(400, gin.H{"detail": "frequency must be weekly or monthly"})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	cid := coalesce(claims["customer_id"], claims["sub"])
	role, _ := claims["role"].(string)

	// The source account must belong to the customer.
	var ownerID sql.NullString
	err := db.QueryRow("SELECT customer_id FROM accounts WHERE account_number=?", req.FromAccountNumber).Scan(&ownerID)
	if err == sql.ErrNoRows {
		c.JSON(404, gin.H{"detail": "Source account not found"})
		return
	}
	if role == "customer" && ownerID.String != cid {
		c.JSON(403, gin.H{"detail": "Source account does not belong to you"})
		return
	}

	start := strings.TrimSpace(req.StartDate)
	if start == "" {
		start = time.Now().Format("2006-01-02") // due from today; BOD runs it on the next start-of-day
	} else if _, perr := time.Parse("2006-01-02", start); perr != nil {
		c.JSON(400, gin.H{"detail": "start_date must use YYYY-MM-DD"})
		return
	}

	id := newUUID()
	_, err = db.Exec(`INSERT INTO standing_instructions (id,customer_id,from_account_number,to_account_number,amount,frequency,next_run,status,description)
		VALUES (?,?,?,?,?,?,?,'ACTIVE',?)`,
		id, cid, req.FromAccountNumber, req.ToAccountNumber, req.Amount, req.Frequency, start, req.Description)
	if err != nil {
		c.JSON(500, gin.H{"detail": err.Error()})
		return
	}
	c.JSON(201, gin.H{"status": "scheduled", "id": id, "next_run": start, "frequency": req.Frequency})
}

func handleStandingCancel(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	cid := coalesce(claims["customer_id"], claims["sub"])
	res, _ := db.Exec("UPDATE standing_instructions SET status='CANCELLED' WHERE id=? AND customer_id=? AND status='ACTIVE'", c.Param("id"), cid)
	if n, _ := res.RowsAffected(); n == 0 {
		c.JSON(404, gin.H{"detail": "Active standing instruction not found"})
		return
	}
	c.JSON(200, gin.H{"status": "cancelled"})
}

// processDueStandingInstructions runs every ACTIVE instruction whose next_run is
// due, for accounts in the given branch. Called by BOD. Skips (does not advance)
// any payment that can't clear, so it retries on the next BOD. Returns the count
// executed and the total moved.
func processDueStandingInstructions(branchID string) (int, float64) {
	if !dbAvailable() {
		return 0, 0
	}
	today := time.Now().Format("2006-01-02")
	rows, err := db.Query(`SELECT si.id,si.customer_id,si.from_account_number,si.to_account_number,si.amount,si.frequency,si.description
		FROM standing_instructions si
		JOIN accounts a ON a.account_number=si.from_account_number
		WHERE si.status='ACTIVE' AND DATE(si.next_run)<=DATE(?) AND a.branch_id=?`, today, branchID)
	if err != nil {
		return 0, 0
	}
	type si struct {
		id, cid, from, to, freq, desc string
		amount                        float64
	}
	var due []si
	for rows.Next() {
		var id, cid, from, to, freq, desc sql.NullString
		var amount sql.NullFloat64
		rows.Scan(&id, &cid, &from, &to, &amount, &freq, &desc)
		due = append(due, si{id.String, cid.String, from.String, to.String, freq.String, desc.String, amount.Float64})
	}
	rows.Close()

	count := 0
	total := 0.0
	for _, s := range due {
		tx, _ := db.Begin()
		var fromID, fromBranch sql.NullString
		var fromBal, fromMin sql.NullFloat64
		if tx.QueryRow("SELECT id,balance,minimum_balance,branch_id FROM accounts WHERE account_number=?", s.from).
			Scan(&fromID, &fromBal, &fromMin, &fromBranch) != nil {
			tx.Rollback()
			continue
		}
		var toID sql.NullString
		var toBal sql.NullFloat64
		if tx.QueryRow("SELECT id,balance FROM accounts WHERE account_number=?", s.to).Scan(&toID, &toBal) != nil {
			tx.Rollback()
			continue
		}
		// Skip (retry next BOD) if it can't clear without breaching minimum balance.
		if fromBal.Float64-s.amount < fromMin.Float64 {
			tx.Rollback()
			continue
		}
		newFrom := math_round(fromBal.Float64-s.amount, 2)
		newTo := math_round(toBal.Float64+s.amount, 2)
		tx.Exec("UPDATE accounts SET balance=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", newFrom, fromID.String)
		tx.Exec("UPDATE accounts SET balance=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", newTo, toID.String)
		desc := s.desc
		if desc == "" {
			desc = "Standing instruction"
		}
		tx.Exec(`INSERT INTO transactions (id,reference_number,from_account_id,to_account_id,from_account_number,to_account_number,amount,transaction_type,description,status,balance_after,initiated_by,channel,branch_id)
			VALUES (?,?,?,?,?,?,?,'STANDING_INSTRUCTION',?,'COMPLETED',?,?,?,?)`,
			newUUID(), txRef(), fromID.String, toID.String, s.from, s.to, s.amount,
			fmt.Sprintf("Auto-pay: %s", desc), newFrom, s.cid, "system", fromBranch.String)
		nr := nextRun(time.Now(), s.freq).Format("2006-01-02")
		tx.Exec("UPDATE standing_instructions SET next_run=?,last_run=? WHERE id=?", nr, today, s.id)
		tx.Commit()
		count++
		total += s.amount
	}
	return count, math_round(total, 2)
}
