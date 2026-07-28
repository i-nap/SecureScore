package main

// Teller / cashier operations. Cash deposit and withdrawal write into the
// canonical `transactions` ledger with channel='teller'; the double-entry GL
// (gl.go) auto-reconciles them on the next glSync(), so no separate GL posting
// is needed here. All routes are gated by teller.* permissions via the RBAC
// engine (rbac.go). Cheque deposit reuses handleChequeDeposit.

import (
	"database/sql"
	"fmt"

	"github.com/gin-gonic/gin"
)

func tellerLookupAccount(tx *sql.Tx, accountNumber string) (id, cid, branch string, bal float64, found bool) {
	var aID, aCid, aBranch sql.NullString
	var aBal sql.NullFloat64
	err := tx.QueryRow("SELECT id, customer_id, balance, branch_id FROM accounts WHERE account_number=?", accountNumber).
		Scan(&aID, &aCid, &aBal, &aBranch)
	if err != nil {
		return "", "", "", 0, false
	}
	return aID.String, aCid.String, aBranch.String, aBal.Float64, true
}

func handleTellerDeposit(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	var req struct {
		AccountNumber string  `json:"account_number"`
		Amount        float64 `json:"amount"`
		Remarks       string  `json:"remarks"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Amount <= 0 || req.AccountNumber == "" {
		c.JSON(400, gin.H{"detail": "account_number and positive amount required"})
		return
	}
	cashier, _ := c.MustGet("claims").(map[string]interface{})["sub"].(string)

	tx, _ := db.Begin()
	defer tx.Rollback()
	accID, accCid, branchID, bal, ok := tellerLookupAccount(tx, req.AccountNumber)
	if !ok {
		c.JSON(404, gin.H{"detail": "Account not found"})
		return
	}
	newBal := bal + req.Amount
	tx.Exec("UPDATE accounts SET balance=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", newBal, accID)
	ref := txRef()
	desc := "Cash deposit (teller)"
	if req.Remarks != "" {
		desc += ": " + req.Remarks
	}
	tx.Exec(`INSERT INTO transactions (id,reference_number,to_account_id,to_account_number,amount,fee,transaction_type,description,status,balance_after,initiated_by,channel,branch_id)
		VALUES (?,?,?,?,?,0,'DEPOSIT',?,'COMPLETED',?,?,'teller',?)`,
		newUUID(), ref, accID, req.AccountNumber, req.Amount, desc, newBal, cashier, branchID)
	tx.Commit()
	notify(accCid, "DEPOSIT", fmt.Sprintf("NPR %.2f deposited to %s. New balance NPR %.2f.", req.Amount, req.AccountNumber, newBal))
	c.JSON(200, gin.H{"status": "success", "reference_number": ref, "amount": req.Amount,
		"balance_after": math_round(newBal, 2), "message": fmt.Sprintf("Deposited NPR %.2f", req.Amount)})
}

func handleTellerWithdraw(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	var req struct {
		AccountNumber string  `json:"account_number"`
		Amount        float64 `json:"amount"`
		Remarks       string  `json:"remarks"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Amount <= 0 || req.AccountNumber == "" {
		c.JSON(400, gin.H{"detail": "account_number and positive amount required"})
		return
	}
	cashier, _ := c.MustGet("claims").(map[string]interface{})["sub"].(string)
	branch, _ := c.MustGet("claims").(map[string]interface{})["branch_id"].(string)

	// Maker-checker: high-value cash-out is queued for manager approval.
	if req.Amount > tellerAutoLimit {
		id := enqueueApproval("teller_withdraw", cashier, branch, req.Amount,
			map[string]interface{}{"account_number": req.AccountNumber, "amount": req.Amount, "remarks": req.Remarks})
		c.JSON(202, gin.H{"status": "PENDING_APPROVAL", "request_id": id,
			"message": fmt.Sprintf("Withdrawal of NPR %.2f exceeds the auto limit; sent for manager approval", req.Amount)})
		return
	}

	newBal, ref, code, msg := withdrawCore(req.AccountNumber, req.Amount, req.Remarks, cashier)
	if code != 0 {
		c.JSON(code, gin.H{"detail": msg})
		return
	}
	c.JSON(200, gin.H{"status": "success", "reference_number": ref, "amount": req.Amount,
		"balance_after": math_round(newBal, 2), "message": fmt.Sprintf("Withdrew NPR %.2f", req.Amount)})
}

// tellerAutoLimit — cash withdrawals above this (NPR) require manager approval.
const tellerAutoLimit = 100000.0

// withdrawCore performs a teller withdrawal. Returns (newBalance, reference,
// httpCode, message); httpCode 0 means success. Shared by the handler and the
// maker-checker approval executor.
func withdrawCore(accountNumber string, amount float64, remarks, by string) (float64, string, int, string) {
	tx, _ := db.Begin()
	defer tx.Rollback()
	accID, _, branchID, bal, ok := tellerLookupAccount(tx, accountNumber)
	if !ok {
		return 0, "", 404, "Account not found"
	}
	if bal < amount {
		return 0, "", 400, fmt.Sprintf("Insufficient funds: balance NPR %.2f", bal)
	}
	newBal := bal - amount
	tx.Exec("UPDATE accounts SET balance=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", newBal, accID)
	ref := txRef()
	desc := "Cash withdrawal (teller)"
	if remarks != "" {
		desc += ": " + remarks
	}
	tx.Exec(`INSERT INTO transactions (id,reference_number,from_account_id,from_account_number,amount,fee,transaction_type,description,status,balance_after,initiated_by,channel,branch_id)
		VALUES (?,?,?,?,?,0,'WITHDRAWAL',?,'COMPLETED',?,?,'teller',?)`,
		newUUID(), ref, accID, accountNumber, amount, desc, newBal, by, branchID)
	tx.Commit()
	return newBal, ref, 0, ""
}

func handleTellerEnquiry(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	accountNumber := c.Query("account_number")
	if accountNumber == "" {
		c.JSON(400, gin.H{"detail": "account_number required"})
		return
	}
	var customerID, accType, branch sql.NullString
	var bal sql.NullFloat64
	err := db.QueryRow(`SELECT customer_id, account_type, balance, branch_id
		FROM accounts WHERE account_number=?`, accountNumber).
		Scan(&customerID, &accType, &bal, &branch)
	if err != nil {
		c.JSON(404, gin.H{"detail": "Account not found"})
		return
	}
	// Enrich with the holder's name from user_profiles if present (no customers table).
	holder := customerID.String
	var fn sql.NullString
	if db.QueryRow(`SELECT full_name FROM user_profiles WHERE customer_id=?`, customerID.String).Scan(&fn) == nil && fn.String != "" {
		holder = fn.String
	}
	rows, _ := db.Query(`SELECT reference_number, transaction_type, amount, balance_after, created_at
		FROM transactions WHERE from_account_number=? OR to_account_number=?
		ORDER BY created_at DESC LIMIT 5`, accountNumber, accountNumber)
	mini := []gin.H{}
	if rows != nil {
		for rows.Next() {
			var ref, ttype, ts string
			var amt, after sql.NullFloat64
			rows.Scan(&ref, &ttype, &amt, &after, &ts)
			mini = append(mini, gin.H{"reference_number": ref, "type": ttype,
				"amount": amt.Float64, "balance_after": after.Float64, "at": ts})
		}
		rows.Close()
	}
	c.JSON(200, gin.H{"account_number": accountNumber, "holder": holder,
		"account_type": accType.String, "balance": math_round(bal.Float64, 2),
		"branch_id": branch.String, "mini_statement": mini})
}

func handleTellerCashPosition(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	cashier, _ := c.MustGet("claims").(map[string]interface{})["sub"].(string)
	var deposits, withdrawals, chequeIn sql.NullFloat64
	var dCount, wCount int
	db.QueryRow(`SELECT COALESCE(SUM(amount),0), COUNT(*) FROM transactions
		WHERE initiated_by=? AND transaction_type='DEPOSIT' AND date(created_at)=date('now')`, cashier).Scan(&deposits, &dCount)
	db.QueryRow(`SELECT COALESCE(SUM(amount),0), COUNT(*) FROM transactions
		WHERE initiated_by=? AND transaction_type='WITHDRAWAL' AND date(created_at)=date('now')`, cashier).Scan(&withdrawals, &wCount)
	db.QueryRow(`SELECT COALESCE(SUM(amount),0) FROM transactions
		WHERE initiated_by=? AND transaction_type='CHEQUE_DEPOSIT' AND date(created_at)=date('now')`, cashier).Scan(&chequeIn)
	net := deposits.Float64 + chequeIn.Float64 - withdrawals.Float64
	c.JSON(200, gin.H{
		"cashier": cashier, "date": "today",
		"cash_deposits": math_round(deposits.Float64, 2), "deposit_count": dCount,
		"cash_withdrawals": math_round(withdrawals.Float64, 2), "withdrawal_count": wCount,
		"cheque_deposits": math_round(chequeIn.Float64, 2),
		"net_cash_position": math_round(net, 2),
	})
}

func registerTellerRoutes(auth *gin.RouterGroup) {
	auth.POST("/api/teller/deposit", requirePermission("teller.deposit"), handleTellerDeposit)
	auth.POST("/api/teller/withdraw", requirePermission("teller.withdraw"), handleTellerWithdraw)
	auth.POST("/api/teller/cheque-deposit", requirePermission("teller.cheque_deposit"), handleChequeDeposit)
	auth.GET("/api/teller/enquiry", requirePermission("teller.enquiry"), handleTellerEnquiry)
	auth.GET("/api/teller/cash-position", requirePermission("teller.eod"), handleTellerCashPosition)
}
