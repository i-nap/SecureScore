package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/gin-gonic/gin"
)

func handleLogin(c *gin.Context) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
		BranchID string `json:"branch_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"detail": "invalid request"})
		return
	}
	user, ok := authenticate(req.Username, req.Password)
	if !ok {
		c.JSON(401, gin.H{"detail": "Invalid credentials"})
		return
	}
	branchID := user.BranchID
	if req.BranchID != "" && req.BranchID != branchID && user.Role != "admin" {
		c.JSON(403, gin.H{"detail": fmt.Sprintf("Your account is bound to %s", branchID)})
		return
	}
	if user.Role == "admin" && req.BranchID != "" {
		branchID = req.BranchID
	}
	const accessTTL = 900 // 15 minutes — aligned with JWT_EXPIRY_SECONDS in hq_server.py
	token := createBFFJWT(map[string]interface{}{
		"sub":         req.Username,
		"role":        user.Role,
		"branch_id":   branchID,
		"full_name":   user.FullName,
		"customer_id": user.CustomerID,
	}, accessTTL)

	// Issue a long-lived refresh token stored in SQLite.
	refreshToken := issueRefreshToken(req.Username)

	c.JSON(200, gin.H{
		"token":         token,
		"refresh_token": refreshToken,
		"expires_in":    accessTTL,
		"user": gin.H{
			"username":    req.Username,
			"role":        user.Role,
			"branch_id":   branchID,
			"full_name":   user.FullName,
			"branch_type": branchType[branchID],
			"customer_id": user.CustomerID,
		},
	})
}

// handleRefreshToken validates a refresh token and issues a new access token.
func handleRefreshToken(c *gin.Context) {
	var req struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.RefreshToken == "" {
		c.JSON(400, gin.H{"error": "refresh_token required"})
		return
	}
	h := sha256.Sum256([]byte(req.RefreshToken))
	tokenHash := hex.EncodeToString(h[:])

	var username string
	var expiresAt string
	var revoked int
	err := db.QueryRow(
		`SELECT username, expires_at, revoked FROM refresh_tokens WHERE token_hash = ?`,
		tokenHash,
	).Scan(&username, &expiresAt, &revoked)
	if err != nil {
		c.JSON(401, gin.H{"error": "invalid or unknown refresh token"})
		return
	}
	if revoked == 1 {
		c.JSON(401, gin.H{"error": "refresh token has been revoked"})
		return
	}
	exp, err := time.Parse(time.RFC3339, expiresAt)
	if err != nil || time.Now().After(exp) {
		c.JSON(401, gin.H{"error": "refresh token expired"})
		return
	}

	user, ok := lookupUser(username)
	if !ok {
		c.JSON(401, gin.H{"error": "user not found"})
		return
	}
	const accessTTL = 900
	newToken := createBFFJWT(map[string]interface{}{
		"sub":         username,
		"role":        user.Role,
		"branch_id":   user.BranchID,
		"full_name":   user.FullName,
		"customer_id": user.CustomerID,
	}, accessTTL)

	c.JSON(200, gin.H{
		"token":      newToken,
		"expires_in": accessTTL,
	})
}

func handleMFASetup(c *gin.Context) {
	// HQ guards /api/auth/mfa/setup as admin-only; mirror that here now that the
	// service token is admin and no longer bounces non-admin callers at HQ.
	if !requireAdmin(c) {
		return
	}
	var body map[string]interface{}
	c.ShouldBindJSON(&body)
	proxyHQ(c, "POST", "/api/auth/mfa/setup", body, nil)
}

func handleMFAVerify(c *gin.Context) {
	var body map[string]interface{}
	c.ShouldBindJSON(&body)
	proxyHQ(c, "POST", "/api/auth/mfa/verify", body, nil)
}

func handleMFAStatus(c *gin.Context) {
	proxyHQ(c, "GET", "/api/auth/mfa/status", nil, nil)
}
