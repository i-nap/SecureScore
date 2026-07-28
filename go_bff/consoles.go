package main

// CEO and IT department consoles. Read-only aggregate views over the BFF DB,
// gated by the ceo.executive / it.system permissions (not role==admin), so the
// RBAC matrix governs access. Self-contained — no dependency on the HQ service.

import (
	"time"

	"github.com/gin-gonic/gin"
)

func handleCEOOverview(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	var accounts, txns, branches, users, loans, fds int
	var deposits, fdTotal float64
	db.QueryRow("SELECT COUNT(*) FROM accounts").Scan(&accounts)
	db.QueryRow("SELECT COALESCE(SUM(balance),0) FROM accounts").Scan(&deposits)
	db.QueryRow("SELECT COUNT(*) FROM transactions").Scan(&txns)
	db.QueryRow("SELECT COUNT(*) FROM rbac_branches").Scan(&branches)
	db.QueryRow("SELECT COUNT(*) FROM rbac_users").Scan(&users)
	db.QueryRow("SELECT COUNT(*), COALESCE(SUM(principal),0) FROM fixed_deposits WHERE status='ACTIVE'").Scan(&fds, &fdTotal)
	db.QueryRow("SELECT COUNT(*) FROM loans").Scan(&loans)

	// Branch deposit leaderboard (top 5 by deposit balance).
	rows, _ := db.Query(`SELECT COALESCE(branch_id,'—'), COUNT(*), COALESCE(SUM(balance),0)
		FROM accounts GROUP BY branch_id ORDER BY SUM(balance) DESC LIMIT 5`)
	board := []gin.H{}
	if rows != nil {
		for rows.Next() {
			var b string
			var cnt int
			var bal float64
			rows.Scan(&b, &cnt, &bal)
			board = append(board, gin.H{"branch": b, "accounts": cnt, "deposits": math_round(bal, 2)})
		}
		rows.Close()
	}

	c.JSON(200, gin.H{
		"total_deposits": math_round(deposits, 2), "total_accounts": accounts,
		"total_transactions": txns, "branches": branches, "users": users,
		"active_loans": loans, "active_fds": fds, "fd_book": math_round(fdTotal, 2),
		"branch_leaderboard": board,
	})
}

func handleITSystem(c *gin.Context) {
	dbOK := dbAvailable() && db.Ping() == nil
	var users, activeUsers, txns24 int
	if dbOK {
		db.QueryRow("SELECT COUNT(*) FROM rbac_users").Scan(&users)
		db.QueryRow("SELECT COUNT(*) FROM rbac_users WHERE active=1").Scan(&activeUsers)
		db.QueryRow("SELECT COUNT(*) FROM transactions WHERE date(created_at)=date('now')").Scan(&txns24)
	}
	idsMu.Lock()
	bannedIPs := 0
	for _, v := range idsMap {
		if v.bannedUntil.After(time.Now()) {
			bannedIPs++
		}
	}
	trackedIPs := len(idsMap)
	idsMu.Unlock()

	status := "operational"
	if !dbOK {
		status = "degraded"
	}
	c.JSON(200, gin.H{
		"status": status, "db_ok": dbOK,
		"total_users": users, "active_users": activeUsers,
		"transactions_today": txns24,
		"tracked_ips": trackedIPs, "banned_ips": bannedIPs,
	})
}

func registerConsoleRoutes(auth *gin.RouterGroup) {
	auth.GET("/api/ceo/overview", requirePermission("ceo.executive"), handleCEOOverview)
	auth.GET("/api/it/system", requirePermission("it.system"), handleITSystem)
}
