package main

// In-app notifications (Phase 7, NEO banking). Key flows call notify() to push a
// message to a customer; the customer portal reads the feed and marks it read.
// Gated by customer.banking.

import "github.com/gin-gonic/gin"

func initNotifications() {
	if db == nil {
		return
	}
	db.Exec(`CREATE TABLE IF NOT EXISTS notifications (
		id TEXT PRIMARY KEY,
		customer_id TEXT NOT NULL,
		type TEXT NOT NULL,
		message TEXT NOT NULL,
		read INTEGER NOT NULL DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`)
}

// notify pushes a message to a customer. Best-effort; never blocks the caller.
func notify(customerID, ntype, message string) {
	if db == nil || customerID == "" {
		return
	}
	db.Exec(`INSERT INTO notifications (id, customer_id, type, message) VALUES (?,?,?,?)`,
		newUUID(), customerID, ntype, message)
}

func handleNotificationsList(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	cid := coalesce(c.MustGet("claims").(map[string]interface{})["customer_id"], c.MustGet("claims").(map[string]interface{})["sub"])
	rows, _ := db.Query(`SELECT id, type, message, read, created_at FROM notifications
		WHERE customer_id=? ORDER BY created_at DESC LIMIT 50`, cid)
	out := []gin.H{}
	unread := 0
	if rows != nil {
		for rows.Next() {
			var id, t, m, at string
			var read int
			rows.Scan(&id, &t, &m, &read, &at)
			if read == 0 {
				unread++
			}
			out = append(out, gin.H{"id": id, "type": t, "message": m, "read": read == 1, "created_at": at})
		}
		rows.Close()
	}
	c.JSON(200, gin.H{"notifications": out, "unread": unread})
}

func handleNotificationsRead(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	cid := coalesce(c.MustGet("claims").(map[string]interface{})["customer_id"], c.MustGet("claims").(map[string]interface{})["sub"])
	db.Exec(`UPDATE notifications SET read=1 WHERE customer_id=?`, cid)
	c.JSON(200, gin.H{"status": "ok"})
}

func registerNotificationRoutes(auth *gin.RouterGroup) {
	auth.GET("/api/customer/notifications", requirePermission("customer.banking"), handleNotificationsList)
	auth.POST("/api/customer/notifications/read", requirePermission("customer.banking"), handleNotificationsRead)
}
