package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

func handleBankingAccounts(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	cid := coalesce(claims["customer_id"], claims["sub"])
	rows, err := db.Query(
		"SELECT id, account_number, account_type, balance, currency, interest_rate, opened_at FROM accounts WHERE customer_id=? AND is_active=1",
		cid)
	if err != nil {
		c.JSON(500, gin.H{"detail": err.Error()})
		return
	}
	defer rows.Close()
	var accounts []map[string]interface{}
	for rows.Next() {
		var id, accNum, accType, currency, openedAt sql.NullString
		var balance, rate sql.NullFloat64
		rows.Scan(&id, &accNum, &accType, &balance, &currency, &rate, &openedAt)
		accounts = append(accounts, map[string]interface{}{
			"id": id.String, "account_number": accNum.String, "account_type": accType.String,
			"balance": balance.Float64, "currency": currency.String,
			"interest_rate": rate.Float64, "opened_at": openedAt.String,
		})
	}
	if accounts == nil {
		accounts = []map[string]interface{}{}
	}
	c.JSON(200, gin.H{"accounts": accounts})
}

func handleBankingAccountsSearch(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	q := strings.TrimSpace(c.Query("q"))
	if q == "" {
		c.JSON(400, gin.H{"detail": "q parameter required"})
		return
	}
	var results []map[string]interface{}
	row := db.QueryRow("SELECT account_number, customer_id, balance, account_type FROM accounts WHERE account_number=?", q)
	var accNum, custID, accType sql.NullString
	var bal sql.NullFloat64
	if err := row.Scan(&accNum, &custID, &bal, &accType); err == nil {
		results = append(results, map[string]interface{}{
			"match_type": "account_number", "account_number": accNum.String,
			"customer_id": custID.String, "balance": bal.Float64, "account_type": accType.String,
		})
	}
	c.JSON(200, gin.H{"results": results, "query": q})
}

func handleBankingTransfer(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	var req struct {
		FromAccountNumber string  `json:"from_account_number"`
		ToAccountNumber   string  `json:"to_account_number"`
		Amount            float64 `json:"amount"`
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
	claims := c.MustGet("claims").(map[string]interface{})
	cid := coalesce(claims["customer_id"], claims["sub"])
	role, _ := claims["role"].(string)

	tx, _ := db.Begin()
	defer tx.Rollback()

	var fromID, toCid, fromBranchID sql.NullString
	var fromBalance, fromMinBal sql.NullFloat64
	err := tx.QueryRow("SELECT id, customer_id, balance, minimum_balance, branch_id FROM accounts WHERE account_number=?", req.FromAccountNumber).
		Scan(&fromID, &toCid, &fromBalance, &fromMinBal, &fromBranchID)
	if err == sql.ErrNoRows {
		c.JSON(404, gin.H{"detail": "Source account not found"})
		return
	}
	if role == "customer" && toCid.String != cid {
		c.JSON(403, gin.H{"detail": "Cannot transfer from another customer's account"})
		return
	}

	var toID sql.NullString
	var toBalance sql.NullFloat64
	err = tx.QueryRow("SELECT id, balance FROM accounts WHERE account_number=?", req.ToAccountNumber).
		Scan(&toID, &toBalance)
	if err == sql.ErrNoRows {
		c.JSON(404, gin.H{"detail": "Destination account not found"})
		return
	}

	fee := 0.0
	if req.Amount > 10000 {
		fee = math_round(req.Amount*0.001, 2)
	}
	totalDebit := req.Amount + fee
	if fromBalance.Float64 < totalDebit {
		c.JSON(400, gin.H{"detail": fmt.Sprintf("Insufficient balance. Available: NPR %.2f", fromBalance.Float64)})
		return
	}
	if fromBalance.Float64-totalDebit < fromMinBal.Float64 {
		c.JSON(400, gin.H{"detail": fmt.Sprintf("Transfer would breach minimum balance of NPR %.2f", fromMinBal.Float64)})
		return
	}

	newFrom := fromBalance.Float64 - totalDebit
	newTo := toBalance.Float64 + req.Amount
	tx.Exec("UPDATE accounts SET balance=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", newFrom, fromID.String)
	tx.Exec("UPDATE accounts SET balance=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", newTo, toID.String)

	desc := req.Description
	if desc == "" {
		desc = "Online fund transfer"
	}
	ref := txRef()
	txnID := newUUID()
	createdAt := time.Now().UTC().Format(time.RFC3339)
	tx.Exec(`INSERT INTO transactions (id,reference_number,from_account_id,to_account_id,from_account_number,to_account_number,amount,fee,transaction_type,description,status,balance_after,initiated_by,channel,branch_id)
		VALUES (?,?,?,?,?,?,?,?,'TRANSFER',?,'COMPLETED',?,?,?,?)`,
		txnID, ref, fromID.String, toID.String, req.FromAccountNumber, req.ToAccountNumber,
		req.Amount, fee, desc, newFrom, cid, "online", fromBranchID.String)

	tx.Commit()
	enqueueFraudEvent(fraudTxnEvent{
		TransactionID:     txnID,
		ReferenceNumber:   ref,
		CustomerID:        cid,
		BranchID:          fromBranchID.String,
		FromAccountNumber: req.FromAccountNumber,
		ToAccountNumber:   req.ToAccountNumber,
		Amount:            req.Amount,
		Fee:               fee,
		Channel:           "online",
		CreatedAt:         createdAt,
	})
	notify(cid, "transfer", fmt.Sprintf("NPR %.2f sent to %s · ref %s", req.Amount, req.ToAccountNumber, ref))
	c.JSON(200, gin.H{
		"status": "success", "reference_number": ref, "amount": req.Amount, "fee": fee,
		"from_balance_after": math_round(newFrom, 2),
		"message":            fmt.Sprintf("NPR %.2f transferred successfully", req.Amount),
	})
}

// handleChequeScan forwards an uploaded cheque image to the customer's branch
// edge for on-device OCR. The image goes Browser -> BFF -> edge (branch) and is
// never persisted or sent to HQ — only the extracted fields are returned.
// forwardEdgeOCR streams an uploaded image to the customer's branch edge for
// on-device OCR. The image goes Browser -> BFF -> edge and is never persisted or
// sent to HQ — only the extracted fields/text come back.
func forwardEdgeOCR(c *gin.Context, edgePath string) {
	claims := c.MustGet("claims").(map[string]interface{})
	bid, _ := claims["branch_id"].(string)
	eu, ok := edgeURL(bid)
	if !ok {
		c.JSON(404, gin.H{"detail": "unknown branch"})
		return
	}
	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(400, gin.H{"detail": "no image uploaded (form field 'file')"})
		return
	}
	if fileHeader.Size > 8<<20 {
		c.JSON(413, gin.H{"detail": "image too large (max 8MB)"})
		return
	}
	src, err := fileHeader.Open()
	if err != nil {
		c.JSON(400, gin.H{"detail": "cannot read upload"})
		return
	}
	defer src.Close()

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	fw, _ := w.CreateFormFile("file", fileHeader.Filename)
	io.Copy(fw, src)
	w.Close()

	req, _ := http.NewRequest("POST", eu+edgePath, &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	// The first call loads the OCR model(s) — allow generous time.
	ocrClient := &http.Client{Timeout: 240 * time.Second}
	resp, err := ocrClient.Do(req)
	if err != nil {
		c.JSON(503, gin.H{"detail": "edge OCR unavailable"})
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	c.Data(resp.StatusCode, "application/json", body)
}

func handleChequeScan(c *gin.Context)      { forwardEdgeOCR(c, "/api/ocr/cheque") }
func handleHandwritingScan(c *gin.Context) { forwardEdgeOCR(c, "/api/ocr/handwriting") }

// handleChequeDeposit credits a customer's account from a (confirmed) cheque scan.
// The same cheque number cannot be deposited twice (domain-level idempotency).
func handleChequeDeposit(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	var req struct {
		AccountNumber string  `json:"account_number"`
		Amount        float64 `json:"amount"`
		ChequeNumber  string  `json:"cheque_number"`
		Payee         string  `json:"payee"`
		DrawerBank    string  `json:"drawer_bank"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"detail": "invalid request"})
		return
	}
	if req.Amount <= 0 {
		c.JSON(400, gin.H{"detail": "Amount must be positive"})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	cid := coalesce(claims["customer_id"], claims["sub"])
	role, _ := claims["role"].(string)

	tx, _ := db.Begin()
	defer tx.Rollback()

	var accID, accCid, branchID sql.NullString
	var bal sql.NullFloat64
	err := tx.QueryRow("SELECT id, customer_id, balance, branch_id FROM accounts WHERE account_number=?", req.AccountNumber).
		Scan(&accID, &accCid, &bal, &branchID)
	if err == sql.ErrNoRows {
		c.JSON(404, gin.H{"detail": "Account not found"})
		return
	}
	if role == "customer" && accCid.String != cid {
		c.JSON(403, gin.H{"detail": "Cannot deposit into another customer's account"})
		return
	}

	// Prevent the same cheque from being deposited twice.
	if req.ChequeNumber != "" {
		var cnt int
		tx.QueryRow("SELECT COUNT(*) FROM transactions WHERE transaction_type='CHEQUE_DEPOSIT' AND description LIKE ?",
			"%cheque "+req.ChequeNumber+"%").Scan(&cnt)
		if cnt > 0 {
			c.JSON(409, gin.H{"detail": "This cheque has already been deposited"})
			return
		}
	}

	newBal := bal.Float64 + req.Amount
	tx.Exec("UPDATE accounts SET balance=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", newBal, accID.String)

	ref := txRef()
	txnID := newUUID()
	desc := fmt.Sprintf("Cheque deposit (cheque %s", req.ChequeNumber)
	if req.DrawerBank != "" {
		desc += ", " + req.DrawerBank
	}
	desc += ")"
	tx.Exec(`INSERT INTO transactions (id,reference_number,to_account_id,to_account_number,amount,fee,transaction_type,description,status,balance_after,initiated_by,channel,branch_id)
		VALUES (?,?,?,?,?,0,'CHEQUE_DEPOSIT',?,'COMPLETED',?,?,?,?)`,
		txnID, ref, accID.String, req.AccountNumber, req.Amount, desc, newBal, cid, "cheque", branchID.String)

	tx.Commit()
	c.JSON(200, gin.H{
		"status": "success", "reference_number": ref, "amount": req.Amount,
		"balance_after": math_round(newBal, 2),
		"message":       fmt.Sprintf("Cheque of NPR %.2f deposited successfully", req.Amount),
	})
}

func handleBankingTransactions(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	accNum := c.Query("account_number")
	if accNum == "" {
		c.JSON(400, gin.H{"detail": "account_number required"})
		return
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	perPage, _ := strconv.Atoi(c.DefaultQuery("per_page", "20"))
	if page < 1 {
		page = 1
	}
	if perPage < 5 {
		perPage = 5
	}
	if perPage > 100 {
		perPage = 100
	}
	claims := c.MustGet("claims").(map[string]interface{})
	cid := coalesce(claims["customer_id"], claims["sub"])
	role, _ := claims["role"].(string)

	var accID, accCid sql.NullString
	err := db.QueryRow("SELECT id, customer_id FROM accounts WHERE account_number=?", accNum).Scan(&accID, &accCid)
	if err == sql.ErrNoRows {
		c.JSON(404, gin.H{"detail": "Account not found"})
		return
	}
	if role == "customer" && accCid.String != cid {
		c.JSON(403, gin.H{"detail": "Access denied"})
		return
	}

	var total int
	db.QueryRow("SELECT COUNT(*) FROM transactions WHERE from_account_id=? OR to_account_id=?", accID.String, accID.String).Scan(&total)

	offset := (page - 1) * perPage
	rows, err := db.Query(`SELECT id, reference_number, transaction_type, amount, fee, description, status, from_account_id, to_account_id, to_account_number, from_account_number, balance_after, created_at
		FROM transactions WHERE from_account_id=? OR to_account_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
		accID.String, accID.String, perPage, offset)
	if err != nil {
		c.JSON(500, gin.H{"detail": err.Error()})
		return
	}
	defer rows.Close()

	var txs []map[string]interface{}
	for rows.Next() {
		var id, ref, txType, desc, status, fromID, toID, toNum, fromNum, createdAt sql.NullString
		var amount, fee, balAfter sql.NullFloat64
		rows.Scan(&id, &ref, &txType, &amount, &fee, &desc, &status, &fromID, &toID, &toNum, &fromNum, &balAfter, &createdAt)
		direction := "credit"
		otherParty := fromNum.String
		if fromID.String == accID.String {
			direction = "debit"
			otherParty = toNum.String
		}
		txs = append(txs, map[string]interface{}{
			"id": id.String, "reference_number": ref.String, "type": txType.String,
			"amount": amount.Float64, "fee": fee.Float64, "description": desc.String,
			"status": status.String, "direction": direction, "other_party": otherParty,
			"balance_after": balAfter.Float64, "created_at": createdAt.String,
		})
	}
	if txs == nil {
		txs = []map[string]interface{}{}
	}
	totalPages := (total + perPage - 1) / perPage
	c.JSON(200, gin.H{
		"account_number": accNum, "transactions": txs,
		"total": total, "page": page, "total_pages": totalPages,
	})
}

func handleBankingProfile(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	cid := coalesce(claims["customer_id"], claims["sub"])
	row := db.QueryRow(`SELECT id,full_name,username,date_of_birth,gender,nationality,national_id,address,district,province,occupation,annual_income,role,is_active,last_login,created_at FROM user_profiles WHERE customer_id=?`, cid)
	var id, full, user, dob, gender, nat, natID, addr, dist, prov, occ, rol, lastLogin, createdAt sql.NullString
	var annIncome sql.NullFloat64
	var isActive sql.NullInt64
	if err := row.Scan(&id, &full, &user, &dob, &gender, &nat, &natID, &addr, &dist, &prov, &occ, &annIncome, &rol, &isActive, &lastLogin, &createdAt); err != nil {
		c.JSON(404, gin.H{"detail": "Profile not found"})
		return
	}
	c.JSON(200, gin.H{
		"id": id.String, "full_name": full.String, "username": user.String,
		"date_of_birth": dob.String, "gender": gender.String, "nationality": nat.String,
		"national_id": natID.String, "address": addr.String, "district": dist.String,
		"province": prov.String, "occupation": occ.String, "annual_income": annIncome.Float64,
		"role": rol.String, "is_active": isActive.Int64 == 1,
		"last_login": lastLogin.String, "created_at": createdAt.String,
	})
}

func handleBankingProfileUpdate(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	var req map[string]interface{}
	c.ShouldBindJSON(&req)
	claims := c.MustGet("claims").(map[string]interface{})
	cid := coalesce(claims["customer_id"], claims["sub"])
	fields := []string{}
	args := []interface{}{}
	for _, f := range []string{"full_name", "address", "district", "province", "occupation"} {
		if v, ok := req[f]; ok && v != nil {
			fields = append(fields, f+"=?")
			args = append(args, v)
		}
	}
	if len(fields) == 0 {
		c.JSON(200, gin.H{"status": "no_changes"})
		return
	}
	args = append(args, cid)
	db.Exec("UPDATE user_profiles SET "+strings.Join(fields, ",")+" WHERE customer_id=?", args...)
	c.JSON(200, gin.H{"status": "updated", "message": "Profile updated successfully"})
}

func handleBankingChangePassword(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	var req struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	c.ShouldBindJSON(&req)
	if len(req.NewPassword) < 8 {
		c.JSON(400, gin.H{"detail": "New password must be at least 8 characters"})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	cid := coalesce(claims["customer_id"], claims["sub"])
	var storedHash sql.NullString
	db.QueryRow("SELECT password_hash FROM user_profiles WHERE customer_id=?", cid).Scan(&storedHash)
	if !verifyStoredPassword(req.CurrentPassword, storedHash.String) {
		c.JSON(403, gin.H{"detail": "Current password is incorrect"})
		return
	}
	newHash := hashPassword(req.NewPassword)
	db.Exec("UPDATE user_profiles SET password_hash=? WHERE customer_id=?", newHash, cid)
	c.JSON(200, gin.H{"status": "success", "message": "Password changed successfully"})
}

func handleBankingFDCreate(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	var req struct {
		AccountNumber string  `json:"account_number"`
		Principal     float64 `json:"principal"`
		TenureMonths  int     `json:"tenure_months"`
		AutoRenew     bool    `json:"auto_renew"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"detail": "invalid request"})
		return
	}
	if req.Principal < 1000 {
		c.JSON(400, gin.H{"detail": "Minimum FD amount is NPR 1,000"})
		return
	}
	rate, ok := fdRates[req.TenureMonths]
	if !ok {
		c.JSON(400, gin.H{"detail": "Tenure must be one of: 3, 6, 12, 24, 36, 60 months"})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	cid := coalesce(claims["customer_id"], claims["sub"])

	var accID, accBranch, accCid sql.NullString
	var accBal sql.NullFloat64
	err := db.QueryRow("SELECT id, customer_id, balance, branch_id FROM accounts WHERE account_number=?", req.AccountNumber).
		Scan(&accID, &accCid, &accBal, &accBranch)
	if err == sql.ErrNoRows {
		c.JSON(404, gin.H{"detail": "Account not found"})
		return
	}
	if accCid.String != cid {
		c.JSON(403, gin.H{"detail": "Account does not belong to you"})
		return
	}
	if accBal.Float64 < req.Principal {
		c.JSON(400, gin.H{"detail": fmt.Sprintf("Insufficient balance. Available: NPR %.2f", accBal.Float64)})
		return
	}

	interest := req.Principal * (rate / 100) * (float64(req.TenureMonths) / 12)
	maturityAmount := math_round(req.Principal+interest, 2)
	maturityDate := time.Now().UTC().Add(time.Duration(req.TenureMonths*30*24) * time.Hour).Format(time.RFC3339)

	tx, _ := db.Begin()
	defer tx.Rollback()
	tx.Exec("UPDATE accounts SET balance=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", accBal.Float64-req.Principal, accID.String)
	fdNum := fdNumber()
	autoRenewInt := 0
	if req.AutoRenew {
		autoRenewInt = 1
	}
	tx.Exec(`INSERT INTO fixed_deposits (id,fd_number,customer_id,account_id,branch_id,principal,interest_rate,tenure_months,maturity_date,maturity_amount,status,auto_renew)
		VALUES (?,?,?,?,?,?,?,?,?,?,'ACTIVE',?)`,
		newUUID(), fdNum, cid, accID.String, accBranch.String,
		req.Principal, rate, req.TenureMonths, maturityDate, maturityAmount, autoRenewInt)
	ref := txRef()
	tx.Exec(`INSERT INTO transactions (id,reference_number,from_account_id,from_account_number,amount,transaction_type,description,status,balance_after,initiated_by,channel,branch_id)
		VALUES (?,?,?,?,?,'FD_OPEN',?,'COMPLETED',?,?,?,?)`,
		newUUID(), ref, accID.String, req.AccountNumber, req.Principal,
		fmt.Sprintf("Fixed deposit opened — %d months @ %.1f%%", req.TenureMonths, rate),
		accBal.Float64-req.Principal, cid, "online", accBranch.String)
	tx.Commit()

	c.JSON(200, gin.H{
		"status": "success", "fd_number": fdNum, "principal": req.Principal,
		"interest_rate": rate, "tenure_months": req.TenureMonths,
		"maturity_amount": maturityAmount, "maturity_date": maturityDate,
		"account_balance_after": math_round(accBal.Float64-req.Principal, 2),
	})
}

func handleBankingFDList(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	cid := coalesce(claims["customer_id"], claims["sub"])
	rows, err := db.Query("SELECT id,fd_number,principal,interest_rate,tenure_months,maturity_date,maturity_amount,status,auto_renew,opened_at FROM fixed_deposits WHERE customer_id=?", cid)
	if err != nil {
		c.JSON(500, gin.H{"detail": err.Error()})
		return
	}
	defer rows.Close()
	var fds []map[string]interface{}
	for rows.Next() {
		var id, fdNum, matDate, status, openedAt sql.NullString
		var principal, rate, matAmount sql.NullFloat64
		var tenure, autoRenew sql.NullInt64
		rows.Scan(&id, &fdNum, &principal, &rate, &tenure, &matDate, &matAmount, &status, &autoRenew, &openedAt)
		fds = append(fds, map[string]interface{}{
			"id": id.String, "fd_number": fdNum.String, "principal": principal.Float64,
			"interest_rate": rate.Float64, "tenure_months": tenure.Int64,
			"maturity_date": matDate.String, "maturity_amount": matAmount.Float64,
			"status": status.String, "auto_renew": autoRenew.Int64 == 1, "opened_at": openedAt.String,
		})
	}
	if fds == nil {
		fds = []map[string]interface{}{}
	}
	c.JSON(200, gin.H{"fixed_deposits": fds})
}

func handleBankingFDBreak(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	fdNum := c.Param("fd_number")
	claims := c.MustGet("claims").(map[string]interface{})
	cid := coalesce(claims["customer_id"], claims["sub"])

	var fdID, fdAccID, fdBranch, fdStatus sql.NullString
	var principal sql.NullFloat64
	err := db.QueryRow("SELECT id, account_id, branch_id, principal, status FROM fixed_deposits WHERE fd_number=? AND customer_id=?", fdNum, cid).
		Scan(&fdID, &fdAccID, &fdBranch, &principal, &fdStatus)
	if err == sql.ErrNoRows {
		c.JSON(404, gin.H{"detail": "FD not found or does not belong to you"})
		return
	}
	if fdStatus.String != "ACTIVE" {
		c.JSON(400, gin.H{"detail": fmt.Sprintf("FD is already %s", fdStatus.String)})
		return
	}

	penalty := math_round(principal.Float64*0.01, 2)
	refund := math_round(principal.Float64-penalty, 2)

	tx, _ := db.Begin()
	defer tx.Rollback()

	var accNum sql.NullString
	var accBal sql.NullFloat64
	tx.QueryRow("SELECT account_number, balance FROM accounts WHERE id=?", fdAccID.String).Scan(&accNum, &accBal)
	newBal := accBal.Float64 + refund
	tx.Exec("UPDATE accounts SET balance=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", newBal, fdAccID.String)
	tx.Exec("UPDATE fixed_deposits SET status='BROKEN', broken_at=CURRENT_TIMESTAMP, penalty_applied=? WHERE id=?", penalty, fdID.String)
	ref := txRef()
	tx.Exec(`INSERT INTO transactions (id,reference_number,to_account_id,to_account_number,amount,fee,transaction_type,description,status,balance_after,initiated_by,channel,branch_id)
		VALUES (?,?,?,?,?,?,'FD_OPEN',?,'COMPLETED',?,?,?,?)`,
		newUUID(), ref, fdAccID.String, accNum.String, refund, penalty,
		fmt.Sprintf("FD %s broken early. Penalty: NPR %.2f", fdNum, penalty),
		newBal, cid, "online", fdBranch.String)
	tx.Commit()

	c.JSON(200, gin.H{
		"status": "broken", "fd_number": fdNum, "principal_returned": refund,
		"penalty": penalty, "message": fmt.Sprintf("FD broken. NPR %.2f credited after 1%% penalty.", refund),
	})
}

func handleBankingSecurityAudit(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	cid := coalesce(claims["customer_id"], claims["sub"])
	rows, err := db.Query("SELECT id FROM accounts WHERE customer_id=?", cid)
	if err != nil {
		c.JSON(500, gin.H{"detail": err.Error()})
		return
	}
	var accIDs []string
	for rows.Next() {
		var id sql.NullString
		rows.Scan(&id)
		accIDs = append(accIDs, id.String)
	}
	rows.Close()
	if len(accIDs) == 0 {
		c.JSON(200, gin.H{
			"alerts": []interface{}{},
			"status": "CLEAN",
			"summary": gin.H{
				"total_transactions_30d": 0, "total_debits_30d": 0,
				"large_transactions": 0, "failed_transactions": 0,
				"off_hours_transactions": 0, "accounts_reviewed": 0,
				"audit_date": time.Now().UTC().Format(time.RFC3339),
			},
		})
		return
	}
	cutoff := time.Now().UTC().Add(-30 * 24 * time.Hour).Format(time.RFC3339)
	placeholders := "?" + strings.Repeat(",?", len(accIDs)-1)
	args := make([]interface{}, len(accIDs)*2)
	for i, id := range accIDs {
		args[i] = id
		args[i+len(accIDs)] = id
	}
	args = append(args, cutoff)
	txRows, _ := db.Query(fmt.Sprintf(
		"SELECT amount, from_account_id, status, created_at FROM transactions WHERE (from_account_id IN (%s) OR to_account_id IN (%s)) AND created_at>=?",
		placeholders, placeholders), args...)
	var totalDebits, largeTxCount, nightTxCount, failedCount int
	for txRows.Next() {
		var fromID, status, createdAt sql.NullString
		var amount sql.NullFloat64
		txRows.Scan(&amount, &fromID, &status, &createdAt)
		isDebit := false
		for _, id := range accIDs {
			if fromID.String == id {
				isDebit = true
				break
			}
		}
		if isDebit {
			totalDebits += int(amount.Float64)
		}
		if amount.Float64 > 100000 {
			largeTxCount++
		}
		if t, err := time.Parse(time.RFC3339, createdAt.String); err == nil {
			if t.Hour() < 6 || t.Hour() > 22 {
				nightTxCount++
			}
		}
		if status.String == "FAILED" {
			failedCount++
		}
	}
	txRows.Close()
	var alerts []map[string]interface{}
	if largeTxCount > 0 {
		alerts = append(alerts, map[string]interface{}{
			"level": "warning", "type": "large_transaction",
			"message": fmt.Sprintf("%d transaction(s) above NPR 1,00,000 in last 30 days", largeTxCount),
			"count":   largeTxCount,
		})
	}
	if nightTxCount > 0 {
		alerts = append(alerts, map[string]interface{}{
			"level": "info", "type": "off_hours_activity",
			"message": fmt.Sprintf("%d transaction(s) during off-hours (10PM–6AM)", nightTxCount),
			"count":   nightTxCount,
		})
	}
	if failedCount > 0 {
		alerts = append(alerts, map[string]interface{}{
			"level": "warning", "type": "failed_transactions",
			"message": fmt.Sprintf("%d failed transaction(s) in last 30 days", failedCount),
			"count":   failedCount,
		})
	}
	if alerts == nil {
		alerts = []map[string]interface{}{}
	}
	riskStatus := "CLEAN"
	if len(alerts) > 2 {
		riskStatus = "HIGH_RISK"
	} else if len(alerts) > 0 {
		riskStatus = "MEDIUM_RISK"
	}
	// count total transactions for the summary
	totalTxCount := 0
	txCountRow := db.QueryRow(fmt.Sprintf(
		"SELECT COUNT(*) FROM transactions WHERE (from_account_id IN (%s) OR to_account_id IN (%s)) AND created_at>=?",
		placeholders, placeholders), args...)
	txCountRow.Scan(&totalTxCount)

	c.JSON(200, gin.H{
		"alerts": alerts,
		"status": riskStatus,
		"summary": gin.H{
			"total_transactions_30d": totalTxCount, "total_debits_30d": totalDebits,
			"large_transactions": largeTxCount, "failed_transactions": failedCount,
			"off_hours_transactions": nightTxCount, "accounts_reviewed": len(accIDs),
			"audit_date": time.Now().UTC().Format(time.RFC3339),
		},
	})
}

func handleApplyAccount(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	var req struct {
		AccountType    string  `json:"account_type"`
		Purpose        string  `json:"purpose"`
		InitialDeposit float64 `json:"initial_deposit"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.AccountType == "" {
		c.JSON(400, gin.H{"detail": "account_type required"})
		return
	}
	validTypes := map[string]bool{"savings": true, "current": true, "salary": true, "fd": true}
	if !validTypes[req.AccountType] {
		c.JSON(400, gin.H{"detail": "account_type must be savings, current, salary, or fd"})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	custID := coalesce(claims["customer_id"], claims["sub"])
	branchID, _ := claims["branch_id"].(string)

	res, err := db.Exec(`INSERT INTO account_applications (customer_id,branch_id,account_type,purpose,initial_deposit) VALUES (?,?,?,?,?)`,
		custID, branchID, req.AccountType, req.Purpose, req.InitialDeposit)
	if err != nil {
		c.JSON(500, gin.H{"detail": err.Error()})
		return
	}
	id, _ := res.LastInsertId()
	c.JSON(201, gin.H{
		"application_id": id,
		"status":         "pending",
		"account_type":   req.AccountType,
		"branch_id":      branchID,
		"message":        "Application submitted. A branch officer will review it shortly.",
	})
}

// Billers the demo supports. Key -> display label. Identifier is the consumer
// number / phone the bill is paid against.
var billers = map[string]string{
	"nea_electricity": "NEA Electricity",
	"khanepani_water": "Khanepani Water",
	"ntc_topup":       "NTC Mobile Topup",
	"ncell_topup":     "Ncell Mobile Topup",
	"worldlink_net":   "WorldLink Internet",
	"vianet_net":      "Vianet Internet",
	"dishhome_tv":     "DishHome TV",
	"khanepani_sewer": "Khanepani Sewerage",
}

// handleBillPay debits a customer's account to pay a utility biller.
func handleBillPay(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	var req struct {
		AccountNumber string  `json:"account_number"`
		Biller        string  `json:"biller"`
		Identifier    string  `json:"identifier"`
		Amount        float64 `json:"amount"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"detail": "invalid request"})
		return
	}
	label, ok := billers[req.Biller]
	if !ok {
		c.JSON(400, gin.H{"detail": "Unknown biller"})
		return
	}
	if req.Amount <= 0 {
		c.JSON(400, gin.H{"detail": "Amount must be positive"})
		return
	}
	if strings.TrimSpace(req.Identifier) == "" {
		c.JSON(400, gin.H{"detail": "Consumer number / identifier is required"})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	cid := coalesce(claims["customer_id"], claims["sub"])
	role, _ := claims["role"].(string)

	tx, _ := db.Begin()
	defer tx.Rollback()

	var accID, accCid, branchID sql.NullString
	var bal, minBal sql.NullFloat64
	err := tx.QueryRow("SELECT id, customer_id, balance, minimum_balance, branch_id FROM accounts WHERE account_number=?", req.AccountNumber).
		Scan(&accID, &accCid, &bal, &minBal, &branchID)
	if err == sql.ErrNoRows {
		c.JSON(404, gin.H{"detail": "Account not found"})
		return
	}
	if role == "customer" && accCid.String != cid {
		c.JSON(403, gin.H{"detail": "Cannot pay from another customer's account"})
		return
	}
	if bal.Float64 < req.Amount {
		c.JSON(400, gin.H{"detail": fmt.Sprintf("Insufficient balance. Available: NPR %.2f", bal.Float64)})
		return
	}
	if bal.Float64-req.Amount < minBal.Float64 {
		c.JSON(400, gin.H{"detail": fmt.Sprintf("Payment would breach minimum balance of NPR %.2f", minBal.Float64)})
		return
	}

	newBal := math_round(bal.Float64-req.Amount, 2)
	tx.Exec("UPDATE accounts SET balance=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", newBal, accID.String)
	ref := txRef()
	tx.Exec(`INSERT INTO transactions (id,reference_number,from_account_id,from_account_number,amount,transaction_type,description,status,balance_after,initiated_by,channel,branch_id)
		VALUES (?,?,?,?,?,'BILL_PAYMENT',?,'COMPLETED',?,?,?,?)`,
		newUUID(), ref, accID.String, req.AccountNumber, req.Amount,
		fmt.Sprintf("Bill payment — %s (%s)", label, req.Identifier), newBal, cid, "online", branchID.String)
	tx.Commit()

	notify(cid, "bill", fmt.Sprintf("%s bill of NPR %.2f paid · ref %s", label, req.Amount, ref))
	c.JSON(200, gin.H{
		"status": "success", "reference_number": ref, "biller": label,
		"identifier": req.Identifier, "amount": req.Amount, "balance_after": newBal,
		"message": fmt.Sprintf("%s bill of NPR %.2f paid successfully", label, req.Amount),
	})
}

func handleBankingStatement(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	accNum := c.Query("account_number")
	fromDate := c.DefaultQuery("from", time.Now().AddDate(0, -1, 0).Format("2006-01-02"))
	toDate := c.DefaultQuery("to", time.Now().Format("2006-01-02"))
	if accNum == "" {
		c.JSON(400, gin.H{"detail": "account_number required"})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	custID := coalesce(claims["customer_id"], claims["sub"])
	role, _ := claims["role"].(string)

	var accID, accCid sql.NullString
	var openBal sql.NullFloat64
	err := db.QueryRow("SELECT id,customer_id,balance FROM accounts WHERE account_number=?", accNum).Scan(&accID, &accCid, &openBal)
	if err == sql.ErrNoRows {
		c.JSON(404, gin.H{"detail": "Account not found"})
		return
	}
	if role == "customer" && accCid.String != custID {
		c.JSON(403, gin.H{"detail": "Access denied"})
		return
	}

	rows, err := db.Query(`SELECT id,reference_number,transaction_type,amount,fee,description,status,from_account_id,to_account_id,to_account_number,from_account_number,balance_after,created_at
		FROM transactions WHERE (from_account_id=? OR to_account_id=?) AND DATE(created_at) BETWEEN DATE(?) AND DATE(?) ORDER BY created_at ASC`,
		accID.String, accID.String, fromDate, toDate)
	if err != nil {
		c.JSON(500, gin.H{"detail": err.Error()})
		return
	}
	defer rows.Close()

	var txs []map[string]interface{}
	var totalDebit, totalCredit float64
	for rows.Next() {
		var id, ref, txType, desc, status, fromID, toID, toNum, fromNum, createdAt sql.NullString
		var amount, fee, balAfter sql.NullFloat64
		rows.Scan(&id, &ref, &txType, &amount, &fee, &desc, &status, &fromID, &toID, &toNum, &fromNum, &balAfter, &createdAt)
		direction := "credit"
		if fromID.String == accID.String {
			direction = "debit"
			totalDebit += amount.Float64
		} else {
			totalCredit += amount.Float64
		}
		otherParty := fromNum.String
		if direction == "debit" {
			otherParty = toNum.String
		}
		txs = append(txs, map[string]interface{}{
			"id": id.String, "reference_number": ref.String, "type": txType.String,
			"amount": amount.Float64, "fee": fee.Float64, "description": desc.String,
			"status": status.String, "direction": direction, "other_party": otherParty,
			"balance_after": balAfter.Float64, "created_at": createdAt.String,
		})
	}
	if txs == nil {
		txs = []map[string]interface{}{}
	}
	c.JSON(200, gin.H{
		"account_number":  accNum,
		"from":            fromDate,
		"to":              toDate,
		"transactions":    txs,
		"total_count":     len(txs),
		"total_debit":     math_round(totalDebit, 2),
		"total_credit":    math_round(totalCredit, 2),
		"closing_balance": math_round(openBal.Float64, 2),
	})
}

// handleBankingMerkleProof builds a verifiable daily Merkle root over the
// canonical transaction ledger for an HQ/branch scope.
func handleBankingMerkleProof(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}

	claims := c.MustGet("claims").(map[string]interface{})
	role := coalesce(claims["role"])
	branchID := strings.TrimSpace(c.Query("branch_id"))
	if role == "branch_manager" {
		branchID = coalesce(claims["branch_id"])
	} else if role != "admin" {
		c.JSON(403, gin.H{"detail": "Only HQ admins and branch managers can verify transaction Merkle proofs"})
		return
	}

	date := strings.TrimSpace(c.DefaultQuery("date", time.Now().UTC().Format("2006-01-02")))
	if _, err := time.Parse("2006-01-02", date); err != nil {
		c.JSON(400, gin.H{"detail": "date must use YYYY-MM-DD"})
		return
	}
	txID := strings.TrimSpace(c.Query("transaction_id"))
	ref := strings.TrimSpace(c.Query("reference_number"))

	leaves, err := loadMerkleTxnLeaves(branchID, date)
	if err != nil {
		c.JSON(500, gin.H{"detail": err.Error()})
		return
	}
	if len(leaves) == 0 {
		c.JSON(404, gin.H{"detail": "No transactions found for the selected scope", "date": date, "branch_id": branchID})
		return
	}

	leafHashes := make([]string, 0, len(leaves))
	targetIndex := -1
	for i, leaf := range leaves {
		hash, err := canonicalTxnLeafHash(leaf)
		if err != nil {
			c.JSON(500, gin.H{"detail": err.Error()})
			return
		}
		leafHashes = append(leafHashes, hash)
		if txID != "" && leaf.ID == txID {
			targetIndex = i
		}
		if ref != "" && leaf.ReferenceNumber == ref {
			targetIndex = i
		}
	}
	if targetIndex == -1 {
		targetIndex = 0
	}

	root, proof, err := buildMerkleProof(leafHashes, targetIndex)
	if err != nil {
		c.JSON(500, gin.H{"detail": err.Error()})
		return
	}
	leafHash := leafHashes[targetIndex]

	response := gin.H{
		"algorithm":            "SHA-256 Merkle tree",
		"hash_domain":          gin.H{"leaf": "txn:<canonical-json>", "parent": "node:<left>:<right>"},
		"date":                 date,
		"branch_id":            branchID,
		"transaction_count":    len(leaves),
		"root_hash":            root,
		"target_index":         targetIndex,
		"target_leaf_hash":     leafHash,
		"target_transaction":   leaves[targetIndex],
		"proof":                proof,
		"server_side_verified": verifyMerkleProof(leafHash, root, proof),
	}
	if txID == "" && ref == "" {
		response["note"] = "No transaction_id or reference_number supplied; returning a proof for the first transaction in the scoped ledger."
	}
	c.JSON(200, response)
}

func handleBankingMerkleAnchorCreate(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}

	claims := c.MustGet("claims").(map[string]interface{})
	role := coalesce(claims["role"])
	branchID := strings.TrimSpace(c.Query("branch_id"))
	if role == "branch_manager" {
		branchID = coalesce(claims["branch_id"])
	} else if role != "admin" {
		c.JSON(403, gin.H{"detail": "Only HQ admins and branch managers can create audit anchors"})
		return
	}
	date := strings.TrimSpace(c.DefaultQuery("date", time.Now().UTC().Format("2006-01-02")))
	if _, err := time.Parse("2006-01-02", date); err != nil {
		c.JSON(400, gin.H{"detail": "date must use YYYY-MM-DD"})
		return
	}

	root, count, _, err := merkleRootForScope(branchID, date)
	if err != nil {
		c.JSON(404, gin.H{"detail": err.Error(), "date": date, "branch_id": branchID})
		return
	}
	createdBy := coalesce(claims["sub"], claims["customer_id"])
	_, err = db.Exec(`INSERT INTO merkle_audit_anchors
		(anchor_date, branch_id, root_hash, transaction_count, created_by)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(anchor_date, branch_id) DO UPDATE SET
			root_hash=excluded.root_hash,
			transaction_count=excluded.transaction_count,
			created_by=excluded.created_by,
			created_at=CURRENT_TIMESTAMP`,
		date, branchID, root, count, createdBy)
	if err != nil {
		c.JSON(500, gin.H{"detail": err.Error()})
		return
	}
	c.JSON(200, gin.H{
		"status":            "anchored",
		"date":              date,
		"branch_id":         branchID,
		"root_hash":         root,
		"transaction_count": count,
		"created_by":        createdBy,
		"algorithm":         "SHA-256 Merkle tree",
	})
}

func handleBankingMerkleAnchors(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	role := coalesce(claims["role"])
	branchID := strings.TrimSpace(c.Query("branch_id"))
	if role == "branch_manager" {
		branchID = coalesce(claims["branch_id"])
	} else if role != "admin" {
		c.JSON(403, gin.H{"detail": "Only HQ admins and branch managers can view audit anchors"})
		return
	}

	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if limit < 1 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}

	q := `SELECT anchor_date, branch_id, root_hash, transaction_count, algorithm, created_by, created_at
		FROM merkle_audit_anchors`
	args := []interface{}{}
	if branchID != "" {
		q += " WHERE branch_id=?"
		args = append(args, branchID)
	}
	q += " ORDER BY anchor_date DESC, created_at DESC LIMIT ?"
	args = append(args, limit)

	rows, err := db.Query(q, args...)
	if err != nil {
		c.JSON(500, gin.H{"detail": err.Error()})
		return
	}
	defer rows.Close()
	anchors := []gin.H{}
	for rows.Next() {
		var date, branch, root, algorithm, createdBy, createdAt sql.NullString
		var count sql.NullInt64
		rows.Scan(&date, &branch, &root, &count, &algorithm, &createdBy, &createdAt)
		anchors = append(anchors, gin.H{
			"date":              date.String,
			"branch_id":         branch.String,
			"root_hash":         root.String,
			"transaction_count": count.Int64,
			"algorithm":         algorithm.String,
			"created_by":        createdBy.String,
			"created_at":        createdAt.String,
		})
	}
	c.JSON(200, gin.H{"anchors": anchors, "count": len(anchors)})
}

func handleBankingMerkleProofExport(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}

	claims := c.MustGet("claims").(map[string]interface{})
	role := coalesce(claims["role"])
	branchID := strings.TrimSpace(c.Query("branch_id"))
	if role == "branch_manager" {
		branchID = coalesce(claims["branch_id"])
	} else if role != "admin" {
		c.JSON(403, gin.H{"detail": "Only HQ admins and branch managers can export audit reports"})
		return
	}

	date := strings.TrimSpace(c.DefaultQuery("date", time.Now().UTC().Format("2006-01-02")))
	if _, err := time.Parse("2006-01-02", date); err != nil {
		c.JSON(400, gin.H{"detail": "date must use YYYY-MM-DD"})
		return
	}
	format := strings.ToLower(strings.TrimSpace(c.DefaultQuery("format", "json")))
	if format != "json" && format != "html" {
		c.JSON(400, gin.H{"detail": "format must be json or html"})
		return
	}

	leaves, err := loadMerkleTxnLeaves(branchID, date)
	if err != nil {
		c.JSON(500, gin.H{"detail": err.Error()})
		return
	}
	if len(leaves) == 0 {
		c.JSON(404, gin.H{"detail": "No transactions found for the selected scope", "date": date, "branch_id": branchID})
		return
	}

	leafHashes := make([]string, len(leaves))
	for i, leaf := range leaves {
		h, err := canonicalTxnLeafHash(leaf)
		if err != nil {
			c.JSON(500, gin.H{"detail": err.Error()})
			return
		}
		leafHashes[i] = h
	}

	// Build a full proof for every transaction in the ledger.
	txEntries := make([]merkleAuditTransaction, len(leaves))
	var root string
	for i := range leaves {
		r, proof, err := buildMerkleProof(leafHashes, i)
		if err != nil {
			c.JSON(500, gin.H{"detail": err.Error()})
			return
		}
		root = r
		txEntries[i] = merkleAuditTransaction{
			Index:          i,
			Leaf:           leaves[i],
			LeafHash:       leafHashes[i],
			InclusionProof: proof,
			ServerVerified: verifyMerkleProof(leafHashes[i], r, proof),
		}
	}

	// Check whether a stored anchor matches.
	anchoredAt := ""
	if db != nil {
		var storedAt sql.NullString
		db.QueryRow(
			`SELECT created_at FROM merkle_audit_anchors WHERE anchor_date=? AND branch_id=? LIMIT 1`,
			date, branchID,
		).Scan(&storedAt)
		anchoredAt = storedAt.String
	}

	generatedBy := coalesce(claims["sub"], claims["customer_id"])
	report := merkleAuditReport{
		SchemaVersion:    "1.0",
		GeneratedAt:      time.Now().UTC().Format(time.RFC3339),
		GeneratedBy:      generatedBy,
		BranchID:         branchID,
		Date:             date,
		Algorithm:        "SHA-256 Merkle tree",
		TransactionCount: len(leaves),
		MerkleRoot:       root,
		AnchoredAt:       anchoredAt,
		Transactions:     txEntries,
		ReportHMACAlg:    "HMAC-SHA256",
	}

	// Sign the report body (everything except the signature field).
	bodyBytes, _ := json.Marshal(struct {
		SchemaVersion    string                   `json:"schema_version"`
		GeneratedAt      string                   `json:"generated_at"`
		GeneratedBy      string                   `json:"generated_by"`
		BranchID         string                   `json:"branch_id"`
		Date             string                   `json:"date"`
		Algorithm        string                   `json:"algorithm"`
		TransactionCount int                      `json:"transaction_count"`
		MerkleRoot       string                   `json:"merkle_root"`
		AnchoredAt       string                   `json:"anchored_at,omitempty"`
		Transactions     []merkleAuditTransaction `json:"transactions"`
		ReportHMACAlg    string                   `json:"report_hmac_alg"`
	}{
		SchemaVersion:    report.SchemaVersion,
		GeneratedAt:      report.GeneratedAt,
		GeneratedBy:      report.GeneratedBy,
		BranchID:         report.BranchID,
		Date:             report.Date,
		Algorithm:        report.Algorithm,
		TransactionCount: report.TransactionCount,
		MerkleRoot:       report.MerkleRoot,
		AnchoredAt:       report.AnchoredAt,
		Transactions:     report.Transactions,
		ReportHMACAlg:    report.ReportHMACAlg,
	})
	mac := hmac.New(sha256.New, []byte(bffSecret))
	mac.Write(bodyBytes)
	report.ReportSignature = hex.EncodeToString(mac.Sum(nil))

	if format == "html" {
		html := buildMerkleAuditHTML(report)
		c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="audit-%s-%s.html"`, branchID, date))
		c.Data(200, "text/html; charset=utf-8", []byte(html))
		return
	}

	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="audit-%s-%s.json"`, branchID, date))
	c.JSON(200, report)
}

func handleEODPreview(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	branchID, _ := claims["branch_id"].(string)

	// Count accounts eligible for interest
	var interestEligible int
	var projectedInterest float64
	rows, _ := db.Query(`SELECT balance,interest_rate FROM accounts WHERE branch_id=? AND is_active=1 AND account_type IN ('savings','salary') AND (account_status='active' OR account_status IS NULL)`, branchID)
	for rows.Next() {
		var bal, rate sql.NullFloat64
		rows.Scan(&bal, &rate)
		interestEligible++
		projectedInterest += bal.Float64 * (rate.Float64 / 100.0) / 365.0
	}
	rows.Close()

	// Count dormant candidates (no tx in last 365 days)
	cutoff := time.Now().AddDate(-1, 0, 0).Format("2006-01-02")
	var dormantCandidates int
	db.QueryRow(`SELECT COUNT(*) FROM accounts WHERE branch_id=? AND is_active=1 AND (account_status='active' OR account_status IS NULL) AND id NOT IN (SELECT DISTINCT COALESCE(from_account_id,'') FROM transactions WHERE DATE(created_at)>=? UNION SELECT DISTINCT COALESCE(to_account_id,'') FROM transactions WHERE DATE(created_at)>=?)`,
		branchID, cutoff, cutoff).Scan(&dormantCandidates)

	// Count FDs maturing today
	today := time.Now().Format("2006-01-02")
	var maturingFDs int
	var maturingTotal float64
	fdRows, _ := db.Query(`SELECT maturity_amount FROM fixed_deposits WHERE branch_id=? AND status='ACTIVE' AND DATE(maturity_date)<=DATE(?)`, branchID, today)
	for fdRows.Next() {
		var amt sql.NullFloat64
		fdRows.Scan(&amt)
		maturingFDs++
		maturingTotal += amt.Float64
	}
	fdRows.Close()

	// FDs maturing next 7 days
	next7 := time.Now().AddDate(0, 0, 7).Format("2006-01-02")
	var upcoming7FDs int
	db.QueryRow(`SELECT COUNT(*) FROM fixed_deposits WHERE branch_id=? AND status='ACTIVE' AND DATE(maturity_date) BETWEEN DATE(?) AND DATE(?)`, branchID, today, next7).Scan(&upcoming7FDs)

	c.JSON(200, gin.H{
		"branch_id":                  branchID,
		"as_of":                      time.Now().Format("2006-01-02"),
		"interest_eligible_accounts": interestEligible,
		"projected_interest_npr":     math_round(projectedInterest, 2),
		"dormant_candidates":         dormantCandidates,
		"fds_maturing_today":         maturingFDs,
		"fds_maturing_today_value":   math_round(maturingTotal, 2),
		"fds_maturing_next_7_days":   upcoming7FDs,
	})
}

func handleRunEOD(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	branchID, _ := claims["branch_id"].(string)
	runBy, _ := claims["sub"].(string)
	startedAt := time.Now()

	var interestCount int
	var interestTotal float64
	var dormantCount int
	var fdMaturedCount int
	var fdMaturedTotal float64
	var errMsg string

	// 1. Post daily interest on savings/salary accounts
	accRows, err := db.Query(`SELECT id,account_number,balance,interest_rate,branch_id FROM accounts WHERE branch_id=? AND is_active=1 AND account_type IN ('savings','salary') AND (account_status='active' OR account_status IS NULL)`, branchID)
	if err == nil {
		txOuter, _ := db.Begin()
		for accRows.Next() {
			var accID, accNum, accBranch sql.NullString
			var balance, rate sql.NullFloat64
			accRows.Scan(&accID, &accNum, &balance, &rate, &accBranch)
			dailyInterest := balance.Float64 * (rate.Float64 / 100.0) / 365.0
			if dailyInterest < 0.01 {
				continue
			}
			dailyInterest = math_round(dailyInterest, 2)
			newBalance := balance.Float64 + dailyInterest
			ref := txRef()
			txOuter.Exec(`UPDATE accounts SET balance=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`, newBalance, accID.String)
			txOuter.Exec(`INSERT INTO transactions (id,reference_number,to_account_id,to_account_number,amount,transaction_type,description,status,balance_after,channel,branch_id) VALUES (?,?,?,?,?,'INTEREST','Daily interest posted','COMPLETED',?,?,?)`,
				newUUID(), ref, accID.String, accNum.String, dailyInterest, newBalance, "system", accBranch.String)
			interestCount++
			interestTotal += dailyInterest
		}
		accRows.Close()
		txOuter.Commit()
	} else {
		errMsg = err.Error()
	}

	// 2. Mark dormant accounts (no transaction in 365 days)
	cutoff := time.Now().AddDate(-1, 0, 0).Format("2006-01-02")
	dormantRes, _ := db.Exec(`UPDATE accounts SET account_status='dormant', dormant_since=CURRENT_TIMESTAMP WHERE branch_id=? AND is_active=1 AND (account_status='active' OR account_status IS NULL) AND id NOT IN (SELECT DISTINCT COALESCE(from_account_id,'x') FROM transactions WHERE DATE(created_at)>=? UNION SELECT DISTINCT COALESCE(to_account_id,'x') FROM transactions WHERE DATE(created_at)>=?)`,
		branchID, cutoff, cutoff)
	if dormantRes != nil {
		n, _ := dormantRes.RowsAffected()
		dormantCount = int(n)
	}

	// 3. Mature FDs that are due
	today := time.Now().Format("2006-01-02")
	fdRows, _ := db.Query(`SELECT fd.id,fd.fd_number,fd.customer_id,fd.account_id,fd.maturity_amount,fd.branch_id FROM fixed_deposits fd WHERE fd.branch_id=? AND fd.status='ACTIVE' AND DATE(fd.maturity_date)<=DATE(?)`, branchID, today)
	if fdRows != nil {
		fdTx, _ := db.Begin()
		for fdRows.Next() {
			var fdID, fdNum, custID, accID, fdBranch sql.NullString
			var matAmt sql.NullFloat64
			fdRows.Scan(&fdID, &fdNum, &custID, &accID, &matAmt, &fdBranch)
			// Credit maturity amount to linked account
			var accNum sql.NullString
			var curBal sql.NullFloat64
			db.QueryRow("SELECT account_number,balance FROM accounts WHERE id=?", accID.String).Scan(&accNum, &curBal)
			newBal := curBal.Float64 + matAmt.Float64
			fdTx.Exec("UPDATE accounts SET balance=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", newBal, accID.String)
			fdTx.Exec(`INSERT INTO transactions (id,reference_number,to_account_id,to_account_number,amount,transaction_type,description,status,balance_after,channel,branch_id) VALUES (?,?,?,?,?,'FD_MATURITY',?,'COMPLETED',?,?,?)`,
				newUUID(), txRef(), accID.String, accNum.String, matAmt.Float64,
				fmt.Sprintf("FD %s maturity credit", fdNum.String), newBal, "system", fdBranch.String)
			fdTx.Exec("UPDATE fixed_deposits SET status='MATURED',matured_at=CURRENT_TIMESTAMP WHERE id=?", fdID.String)
			fdMaturedCount++
			fdMaturedTotal += matAmt.Float64
		}
		fdRows.Close()
		fdTx.Commit()
	}

	// 4. Flag loan installments now past their due date as overdue.
	var loansOverdue int
	overdueRes, _ := db.Exec(`UPDATE loan_schedule SET status='OVERDUE'
		WHERE status='PENDING' AND DATE(due_date) < DATE(?)
		AND loan_id IN (SELECT id FROM loans WHERE branch_id=? AND status='ACTIVE')`,
		time.Now().Format("2006-01-02"), branchID)
	if overdueRes != nil {
		n, _ := overdueRes.RowsAffected()
		loansOverdue = int(n)
	}

	// Log the EOD
	logStatus := "success"
	if errMsg != "" {
		logStatus = "partial"
	}
	db.Exec(`INSERT INTO eod_logs (process_type,run_by,branch_id,interest_posted_count,interest_posted_total,dormant_marked_count,fd_matured_count,fd_matured_total,status,error_message,completed_at) VALUES ('EOD',?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
		runBy, branchID, interestCount, math_round(interestTotal, 2), dormantCount, fdMaturedCount, math_round(fdMaturedTotal, 2), logStatus, errMsg)

	c.JSON(200, gin.H{
		"process_type":          "EOD",
		"run_by":                runBy,
		"branch_id":             branchID,
		"started_at":            startedAt.Format(time.RFC3339),
		"completed_at":          time.Now().Format(time.RFC3339),
		"interest_posted_count": interestCount,
		"interest_posted_total": math_round(interestTotal, 2),
		"dormant_marked_count":  dormantCount,
		"fd_matured_count":      fdMaturedCount,
		"fd_matured_total":      math_round(fdMaturedTotal, 2),
		"loans_overdue_marked":  loansOverdue,
		"status":                logStatus,
	})
}

func handleRunBOD(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	branchID, _ := claims["branch_id"].(string)
	runBy, _ := claims["sub"].(string)

	// BOD: reactivate dormant accounts that have had recent activity (edge case)
	// and preview upcoming FD maturities in next 7 days
	today := time.Now().Format("2006-01-02")
	next7 := time.Now().AddDate(0, 0, 7).Format("2006-01-02")
	var upcoming []map[string]interface{}
	rows, _ := db.Query(`SELECT fd.fd_number,COALESCE(up.full_name,'Unknown'),fd.principal,fd.maturity_date,fd.maturity_amount FROM fixed_deposits fd LEFT JOIN user_profiles up ON up.customer_id=fd.customer_id WHERE fd.branch_id=? AND fd.status='ACTIVE' AND DATE(fd.maturity_date) BETWEEN DATE(?) AND DATE(?) ORDER BY fd.maturity_date ASC`,
		branchID, today, next7)
	if rows != nil {
		for rows.Next() {
			var fdNum, fullName, matDate sql.NullString
			var principal, matAmt sql.NullFloat64
			rows.Scan(&fdNum, &fullName, &principal, &matDate, &matAmt)
			upcoming = append(upcoming, map[string]interface{}{
				"fd_number": fdNum.String, "customer": fullName.String,
				"principal": principal.Float64, "maturity_date": matDate.String,
				"maturity_amount": matAmt.Float64,
			})
		}
		rows.Close()
	}
	if upcoming == nil {
		upcoming = []map[string]interface{}{}
	}

	// Process due standing instructions (recurring auto-pay) for this branch.
	siCount, siTotal := processDueStandingInstructions(branchID)

	// Pending applications count
	var pendingApps int
	db.QueryRow("SELECT COUNT(*) FROM account_applications WHERE branch_id=? AND status='pending'", branchID).Scan(&pendingApps)

	db.Exec(`INSERT INTO eod_logs (process_type,run_by,branch_id,status,completed_at) VALUES ('BOD',?,?,'success',CURRENT_TIMESTAMP)`, runBy, branchID)

	c.JSON(200, gin.H{
		"process_type":                "BOD",
		"run_by":                      runBy,
		"branch_id":                   branchID,
		"completed_at":                time.Now().Format(time.RFC3339),
		"fds_maturing_7_days":         upcoming,
		"pending_applications":        pendingApps,
		"standing_instructions_run":   siCount,
		"standing_instructions_total": siTotal,
		"status":                      "success",
	})
}

func handleEODLogs(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	if !dbAvailable() {
		c.JSON(200, gin.H{"logs": []interface{}{}})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	branchID, _ := claims["branch_id"].(string)
	limit := safeLimit(c.DefaultQuery("limit", "50"), 50)

	rows, err := db.Query(`SELECT id,process_type,run_by,interest_posted_count,interest_posted_total,dormant_marked_count,fd_matured_count,fd_matured_total,status,started_at,completed_at FROM eod_logs WHERE branch_id=? ORDER BY started_at DESC LIMIT ?`, branchID, limit)
	if err != nil {
		c.JSON(500, gin.H{"detail": err.Error()})
		return
	}
	defer rows.Close()
	var logs []map[string]interface{}
	for rows.Next() {
		var id, iCount, dormCount, fdCount int
		var processType, runBy, status, startedAt, completedAt sql.NullString
		var iTotal, fdTotal sql.NullFloat64
		rows.Scan(&id, &processType, &runBy, &iCount, &iTotal, &dormCount, &fdCount, &fdTotal, &status, &startedAt, &completedAt)
		logs = append(logs, map[string]interface{}{
			"id": id, "process_type": processType.String, "run_by": runBy.String,
			"interest_posted_count": iCount, "interest_posted_total": iTotal.Float64,
			"dormant_marked_count": dormCount, "fd_matured_count": fdCount,
			"fd_matured_total": fdTotal.Float64, "status": status.String,
			"started_at": startedAt.String, "completed_at": completedAt.String,
		})
	}
	if logs == nil {
		logs = []map[string]interface{}{}
	}
	c.JSON(200, gin.H{"logs": logs, "total": len(logs)})
}
