package main

// Dynamic RBAC + user/branch management.
// Roles, a fixed permission catalog, an editable role->permission matrix, and
// optional per-user overrides. New user-managed accounts hash with Argon2id
// (CLAUDE.md S-9); seeded demo accounts keep their legacy SHA-256 hash via the
// hash_alg column so existing logins keep working and still appear in the
// admin user list. Admin bypasses all checks; everyone else is gated by
// effective permissions = role_permissions ∪ granted overrides − revoked overrides.

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/argon2"
)

// ── Argon2id ────────────────────────────────────────────────────────────────

const (
	argonTime    = 3
	argonMemory  = 64 * 1024 // 64 MB
	argonThreads = 4
	argonKeyLen  = 32
	argonSaltLen = 16
)

func argon2Hash(pw string) string {
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		panic("rbac: cannot read crypto/rand for salt")
	}
	key := argon2.IDKey([]byte(pw), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return fmt.Sprintf("$argon2id$v=19$m=%d,t=%d,p=%d$%s$%s",
		argonMemory, argonTime, argonThreads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key),
	)
}

func argon2Verify(pw, encoded string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false
	}
	var m, t uint32
	var p uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &m, &t, &p); err != nil {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false
	}
	got := argon2.IDKey([]byte(pw), salt, t, m, p, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1
}

// ── Permission catalog ──────────────────────────────────────────────────────

type permDef struct{ Key, Label, Category string }

var permissionCatalog = []permDef{
	// Banking / teller
	{"teller.deposit", "Cash deposit", "Teller"},
	{"teller.withdraw", "Cash withdrawal", "Teller"},
	{"teller.cheque_deposit", "Cheque deposit", "Teller"},
	{"teller.enquiry", "Account enquiry", "Teller"},
	{"teller.eod", "Teller cash reconciliation", "Teller"},
	// Branch
	{"branch.manage", "Branch operations", "Branch"},
	{"branch.loans", "Loan assessment & decisions", "Branch"},
	{"branch.kyc", "KYC review", "Branch"},
	{"branch.reports", "Branch reports", "Branch"},
	// Customer
	{"customer.banking", "Customer banking", "Customer"},
	{"customer.cards", "Cards & payments", "Customer"},
	{"customer.invest", "Capital markets (MeroShare/IPO)", "Customer"},
	// HQ / FL
	{"hq.aggregation", "Trigger FL aggregation", "HQ"},
	{"hq.audit", "Audit & compliance", "HQ"},
	{"hq.models", "Model registry & governance", "HQ"},
	{"hq.analytics", "HQ analytics", "HQ"},
	// Admin
	{"admin.users.manage", "Create/edit users", "Admin"},
	{"admin.branches.manage", "Create/edit branches", "Admin"},
	{"admin.roles.manage", "Edit role permissions", "Admin"},
	{"markets.allot", "Run IPO allotment", "Admin"},
	// IT
	{"it.system", "System health & sessions", "IT"},
	{"it.security", "IDS / threat / cert management", "IT"},
	// CEO
	{"ceo.executive", "Executive dashboards (read-only)", "CEO"},
}

// Default role -> permission keys. Admin is implicit superuser (not listed).
var defaultRolePerms = map[string][]string{
	"ceo":            {"ceo.executive", "hq.analytics", "hq.audit", "branch.reports"},
	"it_admin":       {"it.system", "it.security", "hq.audit"},
	"branch_manager": {"branch.manage", "branch.loans", "branch.kyc", "branch.reports", "teller.enquiry"},
	"cashier":        {"teller.deposit", "teller.withdraw", "teller.cheque_deposit", "teller.enquiry", "teller.eod"},
	"customer":       {"customer.banking", "customer.cards", "customer.invest"},
	"viewer":         {"hq.analytics", "branch.reports"},
}

var seedRoles = []struct{ Name, Desc string }{
	{"admin", "Full system administrator"},
	{"ceo", "Chief Executive — read-only executive view"},
	{"it_admin", "IT department — system & security"},
	{"branch_manager", "Branch manager"},
	{"cashier", "Teller / cashier"},
	{"customer", "Retail banking customer"},
	{"viewer", "Read-only HQ viewer"},
}

// ── Schema + seed ───────────────────────────────────────────────────────────

func initRBAC() {
	if db == nil {
		return
	}
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS rbac_users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT UNIQUE NOT NULL,
			password_hash TEXT NOT NULL,
			hash_alg TEXT NOT NULL DEFAULT 'argon2id',
			role TEXT NOT NULL,
			branch_id TEXT DEFAULT '',
			full_name TEXT DEFAULT '',
			email TEXT DEFAULT '',
			customer_id TEXT DEFAULT '',
			active INTEGER NOT NULL DEFAULT 1,
			created_by TEXT DEFAULT 'system',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS rbac_roles (
			name TEXT PRIMARY KEY,
			description TEXT DEFAULT '',
			is_system INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE TABLE IF NOT EXISTS rbac_role_permissions (
			role TEXT NOT NULL,
			perm_key TEXT NOT NULL,
			PRIMARY KEY (role, perm_key)
		)`,
		`CREATE TABLE IF NOT EXISTS rbac_user_overrides (
			username TEXT NOT NULL,
			perm_key TEXT NOT NULL,
			granted INTEGER NOT NULL DEFAULT 1,
			PRIMARY KEY (username, perm_key)
		)`,
		`CREATE TABLE IF NOT EXISTS rbac_branches (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT UNIQUE NOT NULL,
			branch_type TEXT DEFAULT 'urban',
			district TEXT DEFAULT '',
			active INTEGER NOT NULL DEFAULT 1,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
	}
	for _, s := range stmts {
		if _, err := db.Exec(s); err != nil {
			logf("[RBAC] schema warning: %v", err)
		}
	}

	for _, r := range seedRoles {
		db.Exec(`INSERT OR IGNORE INTO rbac_roles (name, description, is_system) VALUES (?, ?, 1)`, r.Name, r.Desc)
	}
	for role, keys := range defaultRolePerms {
		for _, k := range keys {
			db.Exec(`INSERT OR IGNORE INTO rbac_role_permissions (role, perm_key) VALUES (?, ?)`, role, k)
		}
	}
	// Seed demo accounts into the user table (legacy sha256) so they are manageable.
	for username, u := range demoUsers {
		db.Exec(`INSERT OR IGNORE INTO rbac_users
			(username, password_hash, hash_alg, role, branch_id, full_name, customer_id, created_by)
			VALUES (?, ?, 'sha256', ?, ?, ?, ?, 'seed')`,
			username, u.PasswordHash, u.Role, u.BranchID, u.FullName, u.CustomerID)
	}
	// Seed the 13 known branches.
	for name, btype := range branchType {
		if name == "" || name == "hq" {
			continue
		}
		db.Exec(`INSERT OR IGNORE INTO rbac_branches (name, branch_type) VALUES (?, ?)`, name, btype)
	}
}

// ── Authentication (used by auth.go) ────────────────────────────────────────

type authUser struct {
	Username, Role, BranchID, FullName, CustomerID string
}

// authenticate verifies credentials against rbac_users (Argon2id or legacy
// sha256), falling back to the static demoUsers map if the DB has no row.
func authenticate(username, password string) (*authUser, bool) {
	if db != nil {
		var role, branch, fullName, customerID, hash, alg string
		var active int
		err := db.QueryRow(
			`SELECT role, branch_id, full_name, customer_id, password_hash, hash_alg, active
			 FROM rbac_users WHERE username = ?`, username,
		).Scan(&role, &branch, &fullName, &customerID, &hash, &alg, &active)
		if err == nil {
			if active == 0 {
				return nil, false
			}
			ok := false
			if alg == "argon2id" {
				ok = argon2Verify(password, hash)
			} else {
				ok = subtle.ConstantTimeCompare([]byte(sha256hex(password)), []byte(hash)) == 1
			}
			if ok {
				return &authUser{username, role, branch, fullName, customerID}, true
			}
			return nil, false
		}
	}
	if u, ok := demoUsers[username]; ok &&
		subtle.ConstantTimeCompare([]byte(sha256hex(password)), []byte(u.PasswordHash)) == 1 {
		return &authUser{username, u.Role, u.BranchID, u.FullName, u.CustomerID}, true
	}
	return nil, false
}

// lookupUser resolves a username (no password) for refresh-token reissue.
func lookupUser(username string) (*authUser, bool) {
	if db != nil {
		var role, branch, fullName, customerID string
		var active int
		err := db.QueryRow(
			`SELECT role, branch_id, full_name, customer_id, active FROM rbac_users WHERE username = ?`, username,
		).Scan(&role, &branch, &fullName, &customerID, &active)
		if err == nil && active == 1 {
			return &authUser{username, role, branch, fullName, customerID}, true
		}
	}
	if u, ok := demoUsers[username]; ok {
		return &authUser{username, u.Role, u.BranchID, u.FullName, u.CustomerID}, true
	}
	return nil, false
}

// ── Effective permissions + middleware ──────────────────────────────────────

func effectivePermissions(username, role string) map[string]bool {
	perms := map[string]bool{}
	if role == "admin" {
		for _, p := range permissionCatalog {
			perms[p.Key] = true
		}
		return perms
	}
	if db == nil {
		for _, k := range defaultRolePerms[role] {
			perms[k] = true
		}
		return perms
	}
	rows, err := db.Query(`SELECT perm_key FROM rbac_role_permissions WHERE role = ?`, role)
	if err == nil {
		for rows.Next() {
			var k string
			rows.Scan(&k)
			perms[k] = true
		}
		rows.Close()
	}
	orows, err := db.Query(`SELECT perm_key, granted FROM rbac_user_overrides WHERE username = ?`, username)
	if err == nil {
		for orows.Next() {
			var k string
			var g int
			orows.Scan(&k, &g)
			if g == 1 {
				perms[k] = true
			} else {
				delete(perms, k)
			}
		}
		orows.Close()
	}
	return perms
}

func requirePermission(key string) gin.HandlerFunc {
	return func(c *gin.Context) {
		claims := c.MustGet("claims").(map[string]interface{})
		role, _ := claims["role"].(string)
		username, _ := claims["sub"].(string)
		if role == "admin" {
			c.Next()
			return
		}
		if effectivePermissions(username, role)[key] {
			c.Next()
			return
		}
		c.AbortWithStatusJSON(403, gin.H{"error": "missing permission: " + key})
	}
}

// ── Admin handlers ──────────────────────────────────────────────────────────

func handleMyPermissions(c *gin.Context) {
	claims := c.MustGet("claims").(map[string]interface{})
	role, _ := claims["role"].(string)
	username, _ := claims["sub"].(string)
	perms := effectivePermissions(username, role)
	keys := make([]string, 0, len(perms))
	for k := range perms {
		keys = append(keys, k)
	}
	c.JSON(200, gin.H{"role": role, "permissions": keys})
}

func handlePermCatalog(c *gin.Context) { c.JSON(200, gin.H{"permissions": permissionCatalog}) }

func handleListUsers(c *gin.Context) {
	rows, err := db.Query(`SELECT username, role, branch_id, full_name, email, customer_id, active, created_by, created_at
		FROM rbac_users ORDER BY created_at DESC`)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	out := []gin.H{}
	for rows.Next() {
		var u, role, branch, fn, email, cid, cb, ca string
		var active int
		rows.Scan(&u, &role, &branch, &fn, &email, &cid, &active, &cb, &ca)
		out = append(out, gin.H{"username": u, "role": role, "branch_id": branch, "full_name": fn,
			"email": email, "customer_id": cid, "active": active == 1, "created_by": cb, "created_at": ca})
	}
	c.JSON(200, gin.H{"users": out})
}

func handleCreateUser(c *gin.Context) {
	var req struct {
		Username   string `json:"username"`
		Password   string `json:"password"`
		Role       string `json:"role"`
		BranchID   string `json:"branch_id"`
		FullName   string `json:"full_name"`
		Email      string `json:"email"`
		CustomerID string `json:"customer_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Username == "" || req.Password == "" || req.Role == "" {
		c.JSON(400, gin.H{"error": "username, password, role required"})
		return
	}
	var roleExists int
	db.QueryRow(`SELECT COUNT(*) FROM rbac_roles WHERE name = ?`, req.Role).Scan(&roleExists)
	if roleExists == 0 {
		c.JSON(400, gin.H{"error": "unknown role: " + req.Role})
		return
	}
	// Email stays optional, but a supplied one must be valid — otherwise it is
	// stored unusable and the welcome mail silently never arrives.
	if req.Email != "" && !validEmail(req.Email) {
		c.JSON(400, gin.H{"error": "invalid email: " + req.Email})
		return
	}
	creator, _ := c.MustGet("claims").(map[string]interface{})["sub"].(string)
	_, err := db.Exec(`INSERT INTO rbac_users
		(username, password_hash, hash_alg, role, branch_id, full_name, email, customer_id, created_by)
		VALUES (?, ?, 'argon2id', ?, ?, ?, ?, ?, ?)`,
		req.Username, argon2Hash(req.Password), req.Role, req.BranchID, req.FullName, req.Email, req.CustomerID, creator)
	if err != nil {
		c.JSON(409, gin.H{"error": "user exists or invalid: " + err.Error()})
		return
	}
	sendWelcomeEmail(req.Email, req.FullName, req.Username)
	c.JSON(201, gin.H{"status": "created", "username": req.Username})
}

func handleUpdateUser(c *gin.Context) {
	username := c.Param("username")
	var req struct {
		Role     *string `json:"role"`
		BranchID *string `json:"branch_id"`
		FullName *string `json:"full_name"`
		Email    *string `json:"email"`
		Active   *bool   `json:"active"`
		Password *string `json:"password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": "invalid body"})
		return
	}
	sets := []string{}
	args := []interface{}{}
	if req.Role != nil {
		sets, args = append(sets, "role = ?"), append(args, *req.Role)
	}
	if req.BranchID != nil {
		sets, args = append(sets, "branch_id = ?"), append(args, *req.BranchID)
	}
	if req.FullName != nil {
		sets, args = append(sets, "full_name = ?"), append(args, *req.FullName)
	}
	if req.Email != nil {
		sets, args = append(sets, "email = ?"), append(args, *req.Email)
	}
	if req.Active != nil {
		v := 0
		if *req.Active {
			v = 1
		}
		sets, args = append(sets, "active = ?"), append(args, v)
	}
	if req.Password != nil && *req.Password != "" {
		sets = append(sets, "password_hash = ?", "hash_alg = 'argon2id'")
		args = append(args, argon2Hash(*req.Password))
	}
	if len(sets) == 0 {
		c.JSON(400, gin.H{"error": "no fields to update"})
		return
	}
	args = append(args, username)
	res, err := db.Exec(`UPDATE rbac_users SET `+strings.Join(sets, ", ")+` WHERE username = ?`, args...)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		c.JSON(404, gin.H{"error": "user not found"})
		return
	}
	c.JSON(200, gin.H{"status": "updated"})
}

func handleListBranches(c *gin.Context) {
	rows, err := db.Query(`SELECT name, branch_type, district, active FROM rbac_branches ORDER BY name`)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	out := []gin.H{}
	for rows.Next() {
		var n, t, d string
		var a int
		rows.Scan(&n, &t, &d, &a)
		out = append(out, gin.H{"name": n, "branch_type": t, "district": d, "active": a == 1})
	}
	c.JSON(200, gin.H{"branches": out})
}

func handleCreateBranch(c *gin.Context) {
	var req struct {
		Name       string `json:"name"`
		BranchType string `json:"branch_type"`
		District   string `json:"district"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Name == "" {
		c.JSON(400, gin.H{"error": "name required"})
		return
	}
	if req.BranchType == "" {
		req.BranchType = "urban"
	}
	_, err := db.Exec(`INSERT INTO rbac_branches (name, branch_type, district) VALUES (?, ?, ?)`,
		req.Name, req.BranchType, req.District)
	if err != nil {
		c.JSON(409, gin.H{"error": "branch exists or invalid: " + err.Error()})
		return
	}
	c.JSON(201, gin.H{"status": "created", "name": req.Name})
}

func handleGetRolePerms(c *gin.Context) {
	role := c.Param("role")
	rows, err := db.Query(`SELECT perm_key FROM rbac_role_permissions WHERE role = ?`, role)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	keys := []string{}
	for rows.Next() {
		var k string
		rows.Scan(&k)
		keys = append(keys, k)
	}
	c.JSON(200, gin.H{"role": role, "permissions": keys})
}

func handleSetRolePerms(c *gin.Context) {
	role := c.Param("role")
	var req struct {
		Permissions []string `json:"permissions"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": "permissions array required"})
		return
	}
	if role == "admin" {
		c.JSON(400, gin.H{"error": "admin role is a fixed superuser; cannot edit"})
		return
	}
	tx, err := db.Begin()
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	tx.Exec(`DELETE FROM rbac_role_permissions WHERE role = ?`, role)
	for _, k := range req.Permissions {
		tx.Exec(`INSERT OR IGNORE INTO rbac_role_permissions (role, perm_key) VALUES (?, ?)`, role, k)
	}
	if err := tx.Commit(); err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, gin.H{"status": "updated", "role": role, "count": len(req.Permissions)})
}

func registerRBACRoutes(auth *gin.RouterGroup) {
	auth.GET("/api/auth/my-permissions", handleMyPermissions)
	auth.GET("/api/admin/permissions", requirePermission("admin.roles.manage"), handlePermCatalog)
	auth.GET("/api/admin/users", requirePermission("admin.users.manage"), handleListUsers)
	auth.POST("/api/admin/users", requirePermission("admin.users.manage"), handleCreateUser)
	auth.PATCH("/api/admin/users/:username", requirePermission("admin.users.manage"), handleUpdateUser)
	auth.GET("/api/admin/branches", requirePermission("admin.branches.manage"), handleListBranches)
	auth.POST("/api/admin/branches", requirePermission("admin.branches.manage"), handleCreateBranch)
	auth.GET("/api/admin/roles/:role/permissions", requirePermission("admin.roles.manage"), handleGetRolePerms)
	auth.PUT("/api/admin/roles/:role/permissions", requirePermission("admin.roles.manage"), handleSetRolePerms)
}

// logf is a thin wrapper so this file doesn't import "log" directly if the
// project later swaps logging; falls back to fmt for safety.
func logf(format string, args ...interface{}) {
	fmt.Printf(time.Now().Format(time.RFC3339)+" "+format+"\n", args...)
}
