package main

// Capital markets — MeroShare/CDS demat linkage and IPO (ASBA) applications.
// Nepal-specific: a customer links a demat (gets a 16-digit BOID), then applies
// to open IPO issues. Applying blocks (debits) the application amount from the
// funding account (ASBA) and records an IPO_BLOCK transaction; the GL books it
// via glPostingsFor. Allotment/refund are admin/batch actions (seeded demo
// allotment for illustration). Gated by the customer.invest permission.

import (
	"database/sql"
	"fmt"
	"math/rand"

	"github.com/gin-gonic/gin"
)

func initMarkets() {
	if db == nil {
		return
	}
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS demat_accounts (
			customer_id TEXT PRIMARY KEY,
			boid TEXT UNIQUE NOT NULL,
			dp_id TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'ACTIVE',
			linked_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS ipo_issues (
			id TEXT PRIMARY KEY,
			symbol TEXT UNIQUE NOT NULL,
			company TEXT NOT NULL,
			price REAL NOT NULL DEFAULT 100,
			min_units INTEGER NOT NULL DEFAULT 10,
			max_units INTEGER NOT NULL DEFAULT 100,
			status TEXT NOT NULL DEFAULT 'OPEN',
			close_date TEXT
		)`,
		`CREATE TABLE IF NOT EXISTS ipo_applications (
			id TEXT PRIMARY KEY,
			customer_id TEXT NOT NULL,
			issue_id TEXT NOT NULL,
			account_number TEXT NOT NULL,
			units INTEGER NOT NULL,
			amount REAL NOT NULL,
			status TEXT NOT NULL DEFAULT 'APPLIED',
			applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(customer_id, issue_id)
		)`,
		`CREATE TABLE IF NOT EXISTS holdings (
			customer_id TEXT NOT NULL,
			symbol TEXT NOT NULL,
			units INTEGER NOT NULL DEFAULT 0,
			avg_price REAL NOT NULL DEFAULT 0,
			PRIMARY KEY (customer_id, symbol)
		)`,
	}
	for _, s := range stmts {
		if _, err := db.Exec(s); err != nil {
			logf("[markets] schema warning: %v", err)
		}
	}
	seed := []struct {
		Sym, Co, Close string
		Price          float64
		Max            int
	}{
		{"NABIL", "Nabil Bank Ltd", "2026-07-15", 100, 100},
		{"UPPER", "Upper Tamakoshi Hydropower", "2026-07-20", 100, 200},
		{"NLIC", "Nepal Life Insurance Co", "2026-07-12", 100, 50},
	}
	for _, s := range seed {
		db.Exec(`INSERT OR IGNORE INTO ipo_issues (id,symbol,company,price,min_units,max_units,status,close_date)
			VALUES (?,?,?,?,10,?,'OPEN',?)`, newUUID(), s.Sym, s.Co, s.Price, s.Max, s.Close)
	}
}

func sixteenDigits() string {
	// Demo BOID — 16 digits beginning "13". Not security-sensitive.
	return fmt.Sprintf("13%07d%07d", rand.Intn(10000000), rand.Intn(10000000))
}

func handleDematGet(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	cid := coalesce(c.MustGet("claims").(map[string]interface{})["customer_id"], c.MustGet("claims").(map[string]interface{})["sub"])
	var boid, dp, status string
	err := db.QueryRow(`SELECT boid, dp_id, status FROM demat_accounts WHERE customer_id=?`, cid).Scan(&boid, &dp, &status)
	if err == sql.ErrNoRows {
		c.JSON(200, gin.H{"linked": false})
		return
	}
	c.JSON(200, gin.H{"linked": true, "boid": boid, "dp_id": dp, "status": status})
}

func handleDematLink(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	cid := coalesce(c.MustGet("claims").(map[string]interface{})["customer_id"], c.MustGet("claims").(map[string]interface{})["sub"])
	var exists int
	db.QueryRow(`SELECT COUNT(*) FROM demat_accounts WHERE customer_id=?`, cid).Scan(&exists)
	if exists > 0 {
		c.JSON(409, gin.H{"detail": "Demat already linked"})
		return
	}
	boid := sixteenDigits()
	dpID := "130" + boid[3:8]
	if _, err := db.Exec(`INSERT INTO demat_accounts (customer_id,boid,dp_id) VALUES (?,?,?)`, cid, boid, dpID); err != nil {
		c.JSON(500, gin.H{"detail": err.Error()})
		return
	}
	c.JSON(201, gin.H{"status": "linked", "boid": boid, "dp_id": dpID})
}

func handleIPOList(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	cid := coalesce(c.MustGet("claims").(map[string]interface{})["customer_id"], c.MustGet("claims").(map[string]interface{})["sub"])
	rows, _ := db.Query(`SELECT id,symbol,company,price,min_units,max_units,status,close_date FROM ipo_issues WHERE status='OPEN'`)
	issues := []gin.H{}
	if rows != nil {
		for rows.Next() {
			var id, sym, co, status, closeD string
			var price float64
			var minU, maxU int
			rows.Scan(&id, &sym, &co, &price, &minU, &maxU, &status, &closeD)
			var applied int
			db.QueryRow(`SELECT COUNT(*) FROM ipo_applications WHERE customer_id=? AND issue_id=?`, cid, id).Scan(&applied)
			issues = append(issues, gin.H{"id": id, "symbol": sym, "company": co, "price": price,
				"min_units": minU, "max_units": maxU, "close_date": closeD, "already_applied": applied > 0})
		}
		rows.Close()
	}
	c.JSON(200, gin.H{"issues": issues})
}

func handleIPOApply(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	var req struct {
		IssueID       string `json:"issue_id"`
		AccountNumber string `json:"account_number"`
		Units         int    `json:"units"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Units <= 0 {
		c.JSON(400, gin.H{"detail": "issue_id, account_number, positive units required"})
		return
	}
	cid := coalesce(c.MustGet("claims").(map[string]interface{})["customer_id"], c.MustGet("claims").(map[string]interface{})["sub"])

	var demat int
	db.QueryRow(`SELECT COUNT(*) FROM demat_accounts WHERE customer_id=?`, cid).Scan(&demat)
	if demat == 0 {
		c.JSON(400, gin.H{"detail": "Link a demat/MeroShare account first"})
		return
	}

	var price float64
	var minU, maxU int
	var status string
	err := db.QueryRow(`SELECT price,min_units,max_units,status FROM ipo_issues WHERE id=?`, req.IssueID).Scan(&price, &minU, &maxU, &status)
	if err == sql.ErrNoRows || status != "OPEN" {
		c.JSON(404, gin.H{"detail": "IPO not open"})
		return
	}
	if req.Units < minU || req.Units > maxU {
		c.JSON(400, gin.H{"detail": fmt.Sprintf("Units must be between %d and %d", minU, maxU)})
		return
	}
	amount := float64(req.Units) * price

	tx, _ := db.Begin()
	defer tx.Rollback()
	accID, accCid, branchID, bal, ok := tellerLookupAccount(tx, req.AccountNumber)
	if !ok {
		c.JSON(404, gin.H{"detail": "Account not found"})
		return
	}
	if accCid != cid {
		c.JSON(403, gin.H{"detail": "Account does not belong to you"})
		return
	}
	if bal < amount {
		c.JSON(400, gin.H{"detail": fmt.Sprintf("Insufficient funds: need NPR %.0f", amount)})
		return
	}
	var dup int
	tx.QueryRow(`SELECT COUNT(*) FROM ipo_applications WHERE customer_id=? AND issue_id=?`, cid, req.IssueID).Scan(&dup)
	if dup > 0 {
		c.JSON(409, gin.H{"detail": "Already applied to this IPO"})
		return
	}

	newBal := bal - amount
	tx.Exec("UPDATE accounts SET balance=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", newBal, accID)
	ref := txRef()
	tx.Exec(`INSERT INTO transactions (id,reference_number,from_account_id,from_account_number,amount,fee,transaction_type,description,status,balance_after,initiated_by,channel,branch_id)
		VALUES (?,?,?,?,?,0,'IPO_BLOCK',?,'COMPLETED',?,?,'online',?)`,
		newUUID(), ref, accID, req.AccountNumber, amount,
		fmt.Sprintf("IPO application blocked (%d units)", req.Units), newBal, cid, branchID)
	tx.Exec(`INSERT INTO ipo_applications (id,customer_id,issue_id,account_number,units,amount,status)
		VALUES (?,?,?,?,?,?,'APPLIED')`, newUUID(), cid, req.IssueID, req.AccountNumber, req.Units, amount)
	tx.Commit()

	c.JSON(201, gin.H{"status": "APPLIED", "units": req.Units, "amount_blocked": amount,
		"reference_number": ref, "balance_after": math_round(newBal, 2)})
}

func handleIPOApplications(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	cid := coalesce(c.MustGet("claims").(map[string]interface{})["customer_id"], c.MustGet("claims").(map[string]interface{})["sub"])
	rows, _ := db.Query(`SELECT a.units,a.amount,a.status,a.applied_at,i.symbol,i.company
		FROM ipo_applications a JOIN ipo_issues i ON i.id=a.issue_id WHERE a.customer_id=? ORDER BY a.applied_at DESC`, cid)
	apps := []gin.H{}
	if rows != nil {
		for rows.Next() {
			var units int
			var amount float64
			var status, at, sym, co string
			rows.Scan(&units, &amount, &status, &at, &sym, &co)
			apps = append(apps, gin.H{"symbol": sym, "company": co, "units": units,
				"amount": amount, "status": status, "applied_at": at})
		}
		rows.Close()
	}
	c.JSON(200, gin.H{"applications": apps})
}

// handleIPOAllot runs a simple pro-rata allotment for one issue: every APPLIED
// application is allotted min_units; any excess is refunded to the funding
// account (IPO_REFUND). Allotted units are added to the customer's holdings and
// the issue is closed. Idempotent per issue (no-op once CLOSED).
func handleIPOAllot(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	issueID := c.Param("id")
	var symbol, status string
	var price float64
	var minU int
	err := db.QueryRow(`SELECT symbol, price, min_units, status FROM ipo_issues WHERE id=?`, issueID).Scan(&symbol, &price, &minU, &status)
	if err == sql.ErrNoRows {
		c.JSON(404, gin.H{"detail": "Issue not found"})
		return
	}
	if status == "CLOSED" {
		c.JSON(409, gin.H{"detail": "Already allotted"})
		return
	}

	rows, _ := db.Query(`SELECT id, customer_id, account_number, units FROM ipo_applications WHERE issue_id=? AND status='APPLIED'`, issueID)
	type app struct {
		id, cid, acct string
		units         int
	}
	apps := []app{}
	for rows != nil && rows.Next() {
		var a app
		rows.Scan(&a.id, &a.cid, &a.acct, &a.units)
		apps = append(apps, a)
	}
	if rows != nil {
		rows.Close()
	}

	allotted := 0
	for _, a := range apps {
		grant := minU
		if a.units < grant {
			grant = a.units
		}
		refund := float64(a.units-grant) * price

		tx, _ := db.Begin()
		tx.Exec(`UPDATE ipo_applications SET status='ALLOTTED', units=? WHERE id=?`, grant, a.id)
		tx.Exec(`INSERT INTO holdings (customer_id, symbol, units, avg_price) VALUES (?,?,?,?)
			ON CONFLICT(customer_id, symbol) DO UPDATE SET units = units + ?`, a.cid, symbol, grant, price, grant)
		if refund > 0 {
			var accID, branchID sql.NullString
			var bal sql.NullFloat64
			if tx.QueryRow(`SELECT id, balance, branch_id FROM accounts WHERE account_number=?`, a.acct).Scan(&accID, &bal, &branchID) == nil {
				newBal := bal.Float64 + refund
				tx.Exec(`UPDATE accounts SET balance=? WHERE id=?`, newBal, accID.String)
				tx.Exec(`INSERT INTO transactions (id,reference_number,to_account_id,to_account_number,amount,fee,transaction_type,description,status,balance_after,initiated_by,channel,branch_id)
					VALUES (?,?,?,?,?,0,'IPO_REFUND','IPO un-allotted refund','COMPLETED',?,?,'system',?)`,
					newUUID(), txRef(), accID.String, a.acct, refund, newBal, a.cid, branchID.String)
			}
		}
		tx.Commit()
		allotted++
	}
	db.Exec(`UPDATE ipo_issues SET status='CLOSED' WHERE id=?`, issueID)
	c.JSON(200, gin.H{"status": "allotted", "symbol": symbol, "applications": allotted, "units_each": minU})
}

func handlePortfolio(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	cid := coalesce(c.MustGet("claims").(map[string]interface{})["customer_id"], c.MustGet("claims").(map[string]interface{})["sub"])
	rows, _ := db.Query(`SELECT symbol, units, avg_price FROM holdings WHERE customer_id=? AND units>0 ORDER BY symbol`, cid)
	holdings := []gin.H{}
	var total float64
	if rows != nil {
		for rows.Next() {
			var sym string
			var units int
			var price float64
			rows.Scan(&sym, &units, &price)
			val := float64(units) * price
			total += val
			holdings = append(holdings, gin.H{"symbol": sym, "units": units, "avg_price": price, "value": math_round(val, 2)})
		}
		rows.Close()
	}
	c.JSON(200, gin.H{"holdings": holdings, "total_value": math_round(total, 2)})
}

func registerMarketsRoutes(auth *gin.RouterGroup) {
	auth.GET("/api/customer/demat", requirePermission("customer.invest"), handleDematGet)
	auth.POST("/api/customer/demat/link", requirePermission("customer.invest"), handleDematLink)
	auth.GET("/api/customer/ipo", requirePermission("customer.invest"), handleIPOList)
	auth.POST("/api/customer/ipo/apply", requirePermission("customer.invest"), handleIPOApply)
	auth.GET("/api/customer/ipo/applications", requirePermission("customer.invest"), handleIPOApplications)
	auth.GET("/api/customer/portfolio", requirePermission("customer.invest"), handlePortfolio)
	auth.POST("/api/admin/ipo/:id/allot", requirePermission("markets.allot"), handleIPOAllot)
}
