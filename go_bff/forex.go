package main

// Dollar / forex (USD) prepaid card. A customer issues one USD card, then loads
// it from an NPR account at the demo FX rate (NPR debited, USD credited to the
// card's prepaid balance) and can unload back to NPR. Money movement is recorded
// in the transactions ledger (FOREX_LOAD / FOREX_UNLOAD) and booked by the GL.
// Gated by customer.cards.

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/gin-gonic/gin"
)

const usdNprRate = 133.50 // demo FX rate: NPR per 1 USD

func handleForexRate(c *gin.Context) {
	c.JSON(200, gin.H{"base": "USD", "quote": "NPR", "rate": usdNprRate})
}

func forexCard(cid string) (cardNum string, balance float64, found bool) {
	var num sql.NullString
	var bal sql.NullFloat64
	err := db.QueryRow(`SELECT card_number, balance FROM cards WHERE customer_id=? AND card_type='FOREX' AND status!='CANCELLED'`, cid).
		Scan(&num, &bal)
	if err != nil {
		return "", 0, false
	}
	return num.String, bal.Float64, true
}

func handleForexCards(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	cid := coalesce(c.MustGet("claims").(map[string]interface{})["customer_id"], c.MustGet("claims").(map[string]interface{})["sub"])
	num, bal, ok := forexCard(cid)
	if !ok {
		c.JSON(200, gin.H{"has_card": false, "rate": usdNprRate})
		return
	}
	c.JSON(200, gin.H{"has_card": true, "masked_number": maskCard(num),
		"usd_balance": math_round(bal, 2), "npr_equivalent": math_round(bal*usdNprRate, 2), "rate": usdNprRate})
}

func handleForexIssue(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	var req struct {
		AccountNumber string `json:"account_number"`
	}
	c.ShouldBindJSON(&req)
	cid := coalesce(c.MustGet("claims").(map[string]interface{})["customer_id"], c.MustGet("claims").(map[string]interface{})["sub"])

	if _, _, ok := forexCard(cid); ok {
		c.JSON(409, gin.H{"detail": "You already have a dollar card"})
		return
	}
	num := cardNumber()
	expiry := time.Now().AddDate(5, 0, 0).Format("01/06")
	_, err := db.Exec(`INSERT INTO cards (id,customer_id,account_number,card_number,network,status,daily_limit,expiry,currency,balance,card_type)
		VALUES (?,?,?,?,'VISA','ACTIVE',5000,?,'USD',0,'FOREX')`,
		newUUID(), cid, req.AccountNumber, num, expiry)
	if err != nil {
		c.JSON(500, gin.H{"detail": err.Error()})
		return
	}
	c.JSON(201, gin.H{"status": "issued", "masked_number": maskCard(num), "currency": "USD", "expiry": expiry})
}

func forexMove(c *gin.Context, load bool) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	var req struct {
		AccountNumber string  `json:"account_number"`
		USDAmount     float64 `json:"usd_amount"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.USDAmount <= 0 || req.AccountNumber == "" {
		c.JSON(400, gin.H{"detail": "account_number and positive usd_amount required"})
		return
	}
	cid := coalesce(c.MustGet("claims").(map[string]interface{})["customer_id"], c.MustGet("claims").(map[string]interface{})["sub"])
	npr := math_round(req.USDAmount*usdNprRate, 2)

	tx, _ := db.Begin()
	defer tx.Rollback()
	accID, accCid, branchID, accBal, ok := tellerLookupAccount(tx, req.AccountNumber)
	if !ok {
		c.JSON(404, gin.H{"detail": "Account not found"})
		return
	}
	if accCid != cid {
		c.JSON(403, gin.H{"detail": "Account does not belong to you"})
		return
	}
	var cardNum string
	var cardBal float64
	if err := tx.QueryRow(`SELECT card_number, balance FROM cards WHERE customer_id=? AND card_type='FOREX' AND status!='CANCELLED'`, cid).Scan(&cardNum, &cardBal); err != nil {
		c.JSON(404, gin.H{"detail": "No dollar card — issue one first"})
		return
	}

	var newAcc, newCard float64
	var txnType, desc string
	if load {
		if accBal < npr {
			c.JSON(400, gin.H{"detail": fmt.Sprintf("Insufficient NPR funds: need %.2f", npr)})
			return
		}
		newAcc, newCard = accBal-npr, cardBal+req.USDAmount
		txnType, desc = "FOREX_LOAD", fmt.Sprintf("Dollar card load USD %.2f @ %.2f", req.USDAmount, usdNprRate)
	} else {
		if cardBal < req.USDAmount {
			c.JSON(400, gin.H{"detail": fmt.Sprintf("Insufficient card balance: have USD %.2f", cardBal)})
			return
		}
		newAcc, newCard = accBal+npr, cardBal-req.USDAmount
		txnType, desc = "FOREX_UNLOAD", fmt.Sprintf("Dollar card unload USD %.2f @ %.2f", req.USDAmount, usdNprRate)
	}
	tx.Exec("UPDATE accounts SET balance=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", newAcc, accID)
	tx.Exec("UPDATE cards SET balance=? WHERE customer_id=? AND card_type='FOREX'", newCard, cid)
	ref := txRef()
	tx.Exec(`INSERT INTO transactions (id,reference_number,from_account_id,from_account_number,amount,fee,transaction_type,description,status,balance_after,initiated_by,channel,branch_id)
		VALUES (?,?,?,?,?,0,?,?,'COMPLETED',?,?,'online',?)`,
		newUUID(), ref, accID, req.AccountNumber, npr, txnType, desc, newAcc, cid, branchID)
	tx.Commit()
	c.JSON(200, gin.H{"status": "success", "reference_number": ref,
		"usd_card_balance": math_round(newCard, 2), "npr_account_balance": math_round(newAcc, 2),
		"npr_amount": npr, "rate": usdNprRate})
}

func handleForexLoad(c *gin.Context)   { forexMove(c, true) }
func handleForexUnload(c *gin.Context) { forexMove(c, false) }

func registerForexRoutes(auth *gin.RouterGroup) {
	auth.GET("/api/customer/forex/rate", requirePermission("customer.cards"), handleForexRate)
	auth.GET("/api/customer/forex/card", requirePermission("customer.cards"), handleForexCards)
	auth.POST("/api/customer/forex/issue", requirePermission("customer.cards"), handleForexIssue)
	auth.POST("/api/customer/forex/load", requirePermission("customer.cards"), handleForexLoad)
	auth.POST("/api/customer/forex/unload", requirePermission("customer.cards"), handleForexUnload)
}
