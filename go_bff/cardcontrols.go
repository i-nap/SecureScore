package main

// Card controls (Phase 7): set/reset a card PIN (Argon2id-hashed) and toggle the
// online / POS / ATM channels. Operates on a card the caller owns, identified by
// card_id. Gated by customer.cards.

import (
	"database/sql"
	"fmt"
	"regexp"

	"github.com/gin-gonic/gin"
)

var pinRe = regexp.MustCompile(`^\d{4,6}$`)

func ownsCard(cid, cardNumber string) bool {
	var n int
	db.QueryRow(`SELECT COUNT(*) FROM cards WHERE customer_id=? AND id=? AND status!='CANCELLED'`, cid, cardNumber).Scan(&n)
	return n > 0
}

func handleCardSetPIN(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	var req struct {
		CardID string `json:"card_id"`
		PIN        string `json:"pin"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || !pinRe.MatchString(req.PIN) {
		c.JSON(400, gin.H{"detail": "card_id and a 4–6 digit pin required"})
		return
	}
	cid := coalesce(c.MustGet("claims").(map[string]interface{})["customer_id"], c.MustGet("claims").(map[string]interface{})["sub"])
	if !ownsCard(cid, req.CardID) {
		c.JSON(403, gin.H{"detail": "Card not found or not yours"})
		return
	}
	db.Exec(`UPDATE cards SET pin_hash=? WHERE customer_id=? AND id=?`, argon2Hash(req.PIN), cid, req.CardID)
	c.JSON(200, gin.H{"status": "pin_set"})
}

func handleCardControls(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	cid := coalesce(c.MustGet("claims").(map[string]interface{})["customer_id"], c.MustGet("claims").(map[string]interface{})["sub"])
	cardNumber := c.Query("card_id")
	var pinHash string
	var online, pos, atm int
	err := db.QueryRow(`SELECT pin_hash, ch_online, ch_pos, ch_atm FROM cards WHERE customer_id=? AND id=?`, cid, cardNumber).
		Scan(&pinHash, &online, &pos, &atm)
	if err != nil {
		c.JSON(404, gin.H{"detail": "Card not found"})
		return
	}
	c.JSON(200, gin.H{"pin_set": pinHash != "", "online": online == 1, "pos": pos == 1, "atm": atm == 1})
}

func handleCardChannel(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	var req struct {
		CardID string `json:"card_id"`
		Channel    string `json:"channel"`
		Enabled    bool   `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"detail": "invalid request"})
		return
	}
	col := map[string]string{"online": "ch_online", "pos": "ch_pos", "atm": "ch_atm"}[req.Channel]
	if col == "" {
		c.JSON(400, gin.H{"detail": "channel must be online, pos, or atm"})
		return
	}
	cid := coalesce(c.MustGet("claims").(map[string]interface{})["customer_id"], c.MustGet("claims").(map[string]interface{})["sub"])
	if !ownsCard(cid, req.CardID) {
		c.JSON(403, gin.H{"detail": "Card not found or not yours"})
		return
	}
	v := 0
	if req.Enabled {
		v = 1
	}
	db.Exec(`UPDATE cards SET `+col+`=? WHERE customer_id=? AND id=?`, v, cid, req.CardID)
	c.JSON(200, gin.H{"status": "updated", "channel": req.Channel, "enabled": req.Enabled})
}

// handleCardPurchase simulates a card-present transaction at a POS/ATM. It enforces
// PIN-at-use: the card's channel must be enabled, the PIN must match (Argon2id), and
// the amount must be within the daily limit before the linked account is debited.
func handleCardPurchase(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	var req struct {
		CardID   string  `json:"card_id"`
		PIN      string  `json:"pin"`
		Amount   float64 `json:"amount"`
		Merchant string  `json:"merchant"`
		Channel  string  `json:"channel"` // "pos" (default) or "atm"
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Amount <= 0 || !pinRe.MatchString(req.PIN) {
		c.JSON(400, gin.H{"detail": "card_id, amount, and a 4–6 digit pin required"})
		return
	}
	chanCol, txType := "ch_pos", "CARD_POS"
	if req.Channel == "atm" {
		chanCol, txType = "ch_atm", "CARD_ATM"
	}
	cid := coalesce(c.MustGet("claims").(map[string]interface{})["customer_id"], c.MustGet("claims").(map[string]interface{})["sub"])

	var accNum, status, pinHash sql.NullString
	var chOn sql.NullInt64
	var limit sql.NullFloat64
	err := db.QueryRow(`SELECT account_number,status,pin_hash,daily_limit,`+chanCol+`
		FROM cards WHERE customer_id=? AND id=?`, cid, req.CardID).
		Scan(&accNum, &status, &pinHash, &limit, &chOn)
	if err != nil {
		c.JSON(404, gin.H{"detail": "Card not found or not yours"})
		return
	}
	if status.String != "ACTIVE" {
		c.JSON(409, gin.H{"detail": fmt.Sprintf("Card is %s", status.String)})
		return
	}
	if chOn.Int64 != 1 {
		c.JSON(409, gin.H{"detail": "This channel is disabled on the card"})
		return
	}
	if pinHash.String == "" || !argon2Verify(req.PIN, pinHash.String) {
		c.JSON(401, gin.H{"detail": "Incorrect PIN"})
		return
	}
	if limit.Float64 > 0 && req.Amount > limit.Float64 {
		c.JSON(409, gin.H{"detail": fmt.Sprintf("Amount exceeds daily limit of NPR %.2f", limit.Float64)})
		return
	}

	newBal, ref, code, msg := cardDebit(accNum.String, req.Amount, txType, req.Merchant, cid)
	if code != 0 {
		c.JSON(code, gin.H{"detail": msg})
		return
	}
	notify(cid, "card", fmt.Sprintf("Card spend NPR %.2f at %s · ref %s", req.Amount, req.Merchant, ref))
	c.JSON(200, gin.H{"status": "approved", "reference_number": ref, "amount": req.Amount,
		"merchant": req.Merchant, "balance_after": newBal})
}

// cardDebit posts a card transaction against the linked account. Mirrors withdrawCore
// but tags the transaction_type so the GL and statement reflect card activity.
func cardDebit(accountNumber string, amount float64, txType, merchant, by string) (float64, string, int, string) {
	tx, _ := db.Begin()
	defer tx.Rollback()
	accID, _, branchID, bal, ok := tellerLookupAccount(tx, accountNumber)
	if !ok {
		return 0, "", 404, "Linked account not found"
	}
	if bal < amount {
		return 0, "", 402, fmt.Sprintf("Insufficient funds: balance NPR %.2f", bal)
	}
	newBal := bal - amount
	tx.Exec("UPDATE accounts SET balance=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", newBal, accID)
	ref := txRef()
	tx.Exec(`INSERT INTO transactions (id,reference_number,from_account_id,from_account_number,amount,fee,transaction_type,description,status,balance_after,initiated_by,channel,branch_id)
		VALUES (?,?,?,?,?,0,?,?,'COMPLETED',?,?,'card',?)`,
		newUUID(), ref, accID, accountNumber, amount, txType,
		fmt.Sprintf("Card purchase — %s", merchant), newBal, by, branchID)
	tx.Commit()
	return newBal, ref, 0, ""
}

func registerCardControlRoutes(auth *gin.RouterGroup) {
	auth.GET("/api/customer/card/controls", requirePermission("customer.cards"), handleCardControls)
	auth.POST("/api/customer/card/pin", requirePermission("customer.cards"), handleCardSetPIN)
	auth.POST("/api/customer/card/channel", requirePermission("customer.cards"), handleCardChannel)
	auth.POST("/api/customer/card/purchase", requirePermission("customer.cards"), handleCardPurchase)
}
