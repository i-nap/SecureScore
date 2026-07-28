package main

import (
	"database/sql"
	"fmt"
	"math/rand"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

func cardNumber() string {
	// 16 digits, grouped. Demo-only — not a real PAN.
	return fmt.Sprintf("4%03d %04d %04d %04d",
		rand.Intn(1000), rand.Intn(10000), rand.Intn(10000), rand.Intn(10000))
}

func maskCard(n string) string {
	digits := strings.ReplaceAll(n, " ", "")
	if len(digits) < 4 {
		return n
	}
	return "**** **** **** " + digits[len(digits)-4:]
}

// ── Debit cards ──────────────────────────────────────────────

func handleCardList(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	cid := coalesce(claims["customer_id"], claims["sub"])
	rows, err := db.Query("SELECT id,account_number,card_number,network,status,daily_limit,expiry,issued_at FROM cards WHERE customer_id=? ORDER BY issued_at DESC", cid)
	if err != nil {
		c.JSON(500, gin.H{"detail": err.Error()})
		return
	}
	defer rows.Close()
	items := []map[string]interface{}{}
	for rows.Next() {
		var id, accNum, cardNum, network, status, expiry, issuedAt sql.NullString
		var limit sql.NullFloat64
		rows.Scan(&id, &accNum, &cardNum, &network, &status, &limit, &expiry, &issuedAt)
		items = append(items, map[string]interface{}{
			"id": id.String, "account_number": accNum.String, "masked_number": maskCard(cardNum.String),
			"network": network.String, "status": status.String, "daily_limit": limit.Float64,
			"expiry": expiry.String, "issued_at": issuedAt.String,
		})
	}
	c.JSON(200, gin.H{"cards": items})
}

func handleCardIssue(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	var req struct {
		AccountNumber string  `json:"account_number"`
		Network       string  `json:"network"`
		DailyLimit    float64 `json:"daily_limit"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"detail": "invalid request"})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	cid := coalesce(claims["customer_id"], claims["sub"])

	var accCid sql.NullString
	err := db.QueryRow("SELECT customer_id FROM accounts WHERE account_number=?", req.AccountNumber).Scan(&accCid)
	if err == sql.ErrNoRows {
		c.JSON(404, gin.H{"detail": "Account not found"})
		return
	}
	if accCid.String != cid {
		c.JSON(403, gin.H{"detail": "Account does not belong to you"})
		return
	}
	// One active card per account keeps the demo tidy.
	var existing int
	db.QueryRow("SELECT COUNT(*) FROM cards WHERE account_number=? AND status!='CANCELLED'", req.AccountNumber).Scan(&existing)
	if existing > 0 {
		c.JSON(409, gin.H{"detail": "This account already has a card"})
		return
	}

	network := strings.ToUpper(strings.TrimSpace(req.Network))
	if network != "VISA" && network != "MASTERCARD" {
		network = "NPI" // Nepal Payment Interface (NPS) by default
	}
	limit := req.DailyLimit
	if limit <= 0 {
		limit = 100000
	}
	id := newUUID()
	num := cardNumber()
	expiry := time.Now().AddDate(5, 0, 0).Format("01/06")
	_, err = db.Exec(`INSERT INTO cards (id,customer_id,account_number,card_number,network,status,daily_limit,expiry) VALUES (?,?,?,?,?,'ACTIVE',?,?)`,
		id, cid, req.AccountNumber, num, network, limit, expiry)
	if err != nil {
		c.JSON(500, gin.H{"detail": err.Error()})
		return
	}
	c.JSON(201, gin.H{"status": "issued", "id": id, "masked_number": maskCard(num), "network": network, "daily_limit": limit, "expiry": expiry})
}

func handleCardStatus(c *gin.Context, status string) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	cid := coalesce(claims["customer_id"], claims["sub"])
	res, _ := db.Exec("UPDATE cards SET status=? WHERE id=? AND customer_id=? AND status!='CANCELLED'", status, c.Param("id"), cid)
	if n, _ := res.RowsAffected(); n == 0 {
		c.JSON(404, gin.H{"detail": "Card not found"})
		return
	}
	c.JSON(200, gin.H{"status": "ok", "card_status": status})
}

func handleCardBlock(c *gin.Context)   { handleCardStatus(c, "BLOCKED") }
func handleCardFreeze(c *gin.Context)  { handleCardStatus(c, "FROZEN") }
func handleCardUnblock(c *gin.Context) { handleCardStatus(c, "ACTIVE") }

func handleCardLimit(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	var req struct {
		DailyLimit float64 `json:"daily_limit"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.DailyLimit <= 0 {
		c.JSON(400, gin.H{"detail": "daily_limit must be positive"})
		return
	}
	if req.DailyLimit > 1000000 {
		c.JSON(400, gin.H{"detail": "Daily limit cannot exceed NPR 10,00,000"})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	cid := coalesce(claims["customer_id"], claims["sub"])
	res, _ := db.Exec("UPDATE cards SET daily_limit=? WHERE id=? AND customer_id=?", req.DailyLimit, c.Param("id"), cid)
	if n, _ := res.RowsAffected(); n == 0 {
		c.JSON(404, gin.H{"detail": "Card not found"})
		return
	}
	c.JSON(200, gin.H{"status": "ok", "daily_limit": req.DailyLimit})
}

// ── Cheque-book requests ─────────────────────────────────────

func handleChequeBookRequest(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	var req struct {
		AccountNumber string `json:"account_number"`
		Leaves        int    `json:"leaves"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"detail": "invalid request"})
		return
	}
	if req.Leaves != 10 && req.Leaves != 25 && req.Leaves != 50 {
		req.Leaves = 25
	}
	claims := c.MustGet("claims").(map[string]interface{})
	cid := coalesce(claims["customer_id"], claims["sub"])
	branchID, _ := claims["branch_id"].(string)

	var accCid sql.NullString
	err := db.QueryRow("SELECT customer_id FROM accounts WHERE account_number=?", req.AccountNumber).Scan(&accCid)
	if err == sql.ErrNoRows {
		c.JSON(404, gin.H{"detail": "Account not found"})
		return
	}
	if accCid.String != cid {
		c.JSON(403, gin.H{"detail": "Account does not belong to you"})
		return
	}
	id := newUUID()
	db.Exec("INSERT INTO cheque_book_requests (id,customer_id,account_number,branch_id,leaves,status) VALUES (?,?,?,?,?,'REQUESTED')",
		id, cid, req.AccountNumber, branchID, req.Leaves)
	c.JSON(201, gin.H{"status": "requested", "id": id, "leaves": req.Leaves})
}

func handleChequeBookList(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	cid := coalesce(claims["customer_id"], claims["sub"])
	rows, _ := db.Query("SELECT id,account_number,leaves,status,requested_at,updated_at FROM cheque_book_requests WHERE customer_id=? ORDER BY requested_at DESC", cid)
	defer rows.Close()
	items := []map[string]interface{}{}
	for rows.Next() {
		var id, accNum, status, reqAt, updAt sql.NullString
		var leaves sql.NullInt64
		rows.Scan(&id, &accNum, &leaves, &status, &reqAt, &updAt)
		items = append(items, map[string]interface{}{
			"id": id.String, "account_number": accNum.String, "leaves": leaves.Int64,
			"status": status.String, "requested_at": reqAt.String, "updated_at": updAt.String,
		})
	}
	c.JSON(200, gin.H{"cheque_books": items})
}

// Branch side: list pending requests and advance them.

func handleBranchChequeBookList(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	branchID, _ := claims["branch_id"].(string)
	rows, _ := db.Query(`SELECT cb.id,cb.account_number,COALESCE(up.full_name,''),cb.leaves,cb.status,cb.requested_at
		FROM cheque_book_requests cb LEFT JOIN user_profiles up ON up.customer_id=cb.customer_id
		WHERE cb.branch_id=? ORDER BY cb.requested_at DESC`, branchID)
	defer rows.Close()
	items := []map[string]interface{}{}
	for rows.Next() {
		var id, accNum, name, status, reqAt sql.NullString
		var leaves sql.NullInt64
		rows.Scan(&id, &accNum, &name, &leaves, &status, &reqAt)
		items = append(items, map[string]interface{}{
			"id": id.String, "account_number": accNum.String, "customer": name.String,
			"leaves": leaves.Int64, "status": status.String, "requested_at": reqAt.String,
		})
	}
	c.JSON(200, gin.H{"cheque_books": items})
}

func handleBranchChequeBookAdvance(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	branchID, _ := claims["branch_id"].(string)
	// REQUESTED -> APPROVED -> DISPATCHED
	var cur sql.NullString
	err := db.QueryRow("SELECT status FROM cheque_book_requests WHERE id=? AND branch_id=?", c.Param("id"), branchID).Scan(&cur)
	if err == sql.ErrNoRows {
		c.JSON(404, gin.H{"detail": "Request not found"})
		return
	}
	next := map[string]string{"REQUESTED": "APPROVED", "APPROVED": "DISPATCHED"}[cur.String]
	if next == "" {
		c.JSON(400, gin.H{"detail": fmt.Sprintf("Request already %s", cur.String)})
		return
	}
	db.Exec("UPDATE cheque_book_requests SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", next, c.Param("id"))
	c.JSON(200, gin.H{"status": "ok", "request_status": next})
}
