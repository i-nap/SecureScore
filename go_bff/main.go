// go_bff/main.go — SecureScore BFF Gateway (Go)
//
// Drop-in replacement for bff_gateway.py.
// Identical JWT format, identical routes, identical CORS policy.
// HQ server (port 5050) and Edge nodes (7050/7257/7115) remain Python.
//
// Usage:
//   go run . [--port 4000]
//   go build -o bff_gateway.exe && ./bff_gateway.exe --port 4000

package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/hmac"
	crand "crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"math/rand"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/getsentry/sentry-go"
	sentrygin "github.com/getsentry/sentry-go/gin"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/joho/godotenv"
	_ "modernc.org/sqlite"
)

// ═══════════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════════

var (
	bffSecret        string
	hqURL            string
	hqAPIKey         string
	groqAPIKey       string
	groqModel        string
	groqCopilotModel string
	corsOrigins      []string
	branchEdgeMap    map[string]string
	db               *sql.DB
)

// ═══════════════════════════════════════════════════════════
//  SCORING CONSTANTS (used by score_explanation / whatif)
// ═══════════════════════════════════════════════════════════

var featureWeights = map[string]float64{
	"annual_income":           0.0000025,
	"debt_to_income":          -1.8,
	"employment_months":       0.018,
	"credit_history_months":   0.012,
	"existing_loans":          -0.22,
	"loan_amount_requested":   -0.0000008,
	"collateral_value":        0.0000006,
	"repayment_history_score": 0.03,
}

// featureImpactLookup provides human-readable rejection explanations per SHAP feature (NRB C-5).
var featureImpactLookup = map[string]struct{ Impact, Improvement string }{
	"debt_to_income":          {"High debt load relative to income", "Reduce existing EMIs before reapplying"},
	"employment_months":       {"Short employment history", "Wait for 12+ months of stable employment"},
	"credit_history_months":   {"Limited credit history", "Build credit with a small secured loan first"},
	"existing_loans":          {"Too many active loans", "Close at least one existing loan before applying"},
	"collateral_value":        {"Insufficient collateral value", "Provide additional collateral or a co-applicant"},
	"repayment_history_score": {"Poor repayment history", "Maintain 6 consecutive on-time payments"},
	"annual_income":           {"Income below minimum threshold for requested amount", "Reduce the loan amount or increase income documentation"},
	"loan_amount_requested":   {"Requested amount exceeds approved ceiling for risk tier", "Apply for a lower amount or improve credit profile first"},
}

var featureBaselines = map[string]float64{
	"annual_income":           600000,
	"debt_to_income":          0.40,
	"employment_months":       36,
	"credit_history_months":   48,
	"existing_loans":          1,
	"loan_amount_requested":   400000,
	"collateral_value":        500000,
	"repayment_history_score": 70,
}

var shapFeatures = []string{
	"annual_income", "debt_to_income", "employment_months",
	"credit_history_months", "existing_loans", "loan_amount_requested",
	"collateral_value", "repayment_history_score",
}

var branchType = map[string]string{
	"kathmandu": "urban", "lalitpur": "urban", "pokhara": "urban",
	"bharatpur": "semi_urban", "biratnagar": "semi_urban", "butwal": "semi_urban",
	"hetauda": "semi_urban", "itahari": "semi_urban", "dharan": "semi_urban",
	"janakpur": "rural", "birgunj": "rural", "nepalgunj": "rural", "sarlahi": "rural",
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func randSecret() string {
	b := make([]byte, 32)
	if _, err := crand.Read(b); err != nil {
		log.Fatalf("crypto/rand unavailable: %v", err)
	}
	return hex.EncodeToString(b)
}

func initConfig() {
	// Try .env in current dir, then parent dir (project root)
	if err := godotenv.Load(); err != nil {
		_ = godotenv.Load("../.env")
	}

	bffSecret = getEnv("BFF_SECRET_KEY", "")
	if bffSecret == "" {
		log.Fatal("[FATAL] BFF_SECRET_KEY is not set. Aborting startup to prevent ephemeral token signing. Set BFF_SECRET_KEY in .env or environment.")
	}
	hqURL = getEnv("HQ_URL", "http://127.0.0.1:5050")
	hqAPIKey = getEnv("HQ_BRANCH_API_KEY", "")
	groqAPIKey = getEnv("GROQ_API_KEY", "")
	groqModel = getEnv("GROQ_MODEL", "llama-3.1-8b-instant")
	// A larger model for the branch analytics copilot (heavier reasoning than chat).
	groqCopilotModel = getEnv("GROQ_COPILOT_MODEL", "llama-3.3-70b-versatile")

	raw := getEnv("CORS_ALLOWED_ORIGINS", "")
	if raw != "" {
		for _, o := range strings.Split(raw, ",") {
			o = strings.TrimSpace(o)
			if o != "" {
				corsOrigins = append(corsOrigins, o)
			}
		}
	} else {
		corsOrigins = []string{
			"http://localhost:3000", "http://localhost:3001",
			"http://localhost:3002", "http://127.0.0.1:3000",
			"https://securescore.example.com",
		}
	}

	branchEdgeMap = make(map[string]string)
	branches := []string{"kathmandu", "lalitpur", "pokhara", "bharatpur", "biratnagar",
		"butwal", "hetauda", "itahari", "dharan", "janakpur", "birgunj", "nepalgunj", "sarlahi"}
	for _, b := range branches {
		port := 7000 + stableHash(b)%1000
		envKey := "EDGE_URL_" + strings.ToUpper(b)
		branchEdgeMap[b] = getEnv(envKey, fmt.Sprintf("http://127.0.0.1:%d", port))
	}
}

func stableHash(s string) int {
	h := 0
	for _, c := range s {
		h = h*31 + int(c)
	}
	if h < 0 {
		h = -h
	}
	return h
}

// ═══════════════════════════════════════════════════════════
//  DEMO USERS (same as Python BFF)
// ═══════════════════════════════════════════════════════════

type demoUser struct {
	PasswordHash string
	Role         string
	BranchID     string
	FullName     string
	CustomerID   string
}

func sha256hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

var demoUsers = map[string]demoUser{
	"admin":         {sha256hex("admin123"), "admin", "hq", "System Admin", ""},
	"kathmandu_mgr": {sha256hex("branch123"), "branch_manager", "kathmandu", "Ram Sharma", ""},
	"sarlahi_mgr":   {sha256hex("branch123"), "branch_manager", "sarlahi", "Sita Devi", ""},
	"pokhara_mgr":   {sha256hex("branch123"), "branch_manager", "pokhara", "Bikash Gurung", ""},
	"cust001":       {sha256hex("customer123"), "customer", "kathmandu", "Aarav Thapa", "CUST100005"},
	"cust002":       {sha256hex("customer123"), "customer", "sarlahi", "Priya Yadav", "CUST100004"},
	"cust003":       {sha256hex("customer123"), "customer", "pokhara", "Bibek Magar", "CUST100002"},
	"cashier1":      {sha256hex("cashier123"), "cashier", "kathmandu", "Maya Shrestha", ""},
	"ceo":           {sha256hex("ceo123"), "ceo", "hq", "Rajesh Koirala", ""},
	"it_admin":      {sha256hex("it123"), "it_admin", "hq", "Nabin Adhikari", ""},
}

// ═══════════════════════════════════════════════════════════
//  CUSTOM JWT (must match Python bff_gateway.py exactly)
//
//  Python uses:
//    sig = hmac.new(secret, f"{header_b64}.{payload_b64}".encode(), sha256).hexdigest()
//  i.e. signature is hex-encoded HMAC, NOT base64url — non-standard but we match it.
// ═══════════════════════════════════════════════════════════

func b64url(data []byte) string {
	return strings.TrimRight(base64.URLEncoding.EncodeToString(data), "=")
}

func createBFFJWT(claims map[string]interface{}, seconds int) string {
	header := map[string]string{"alg": "HS256", "typ": "JWT"}
	hBytes, _ := json.Marshal(header)
	now := time.Now().Unix()
	claims["iat"] = now
	claims["exp"] = now + int64(seconds)
	pBytes, _ := json.Marshal(claims)

	h := b64url(hBytes)
	p := b64url(pBytes)
	msg := h + "." + p

	mac := hmac.New(sha256.New, []byte(bffSecret))
	mac.Write([]byte(msg))
	sig := hex.EncodeToString(mac.Sum(nil))
	return msg + "." + sig
}

func verifyBFFJWT(token string) (map[string]interface{}, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("malformed token")
	}
	h, p, sig := parts[0], parts[1], parts[2]
	msg := h + "." + p

	mac := hmac.New(sha256.New, []byte(bffSecret))
	mac.Write([]byte(msg))
	expected := hex.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(expected), []byte(sig)) {
		return nil, fmt.Errorf("invalid signature")
	}

	// Decode payload — add padding if needed
	padded := p
	switch len(padded) % 4 {
	case 2:
		padded += "=="
	case 3:
		padded += "="
	}
	raw, err := base64.URLEncoding.DecodeString(padded)
	if err != nil {
		return nil, fmt.Errorf("invalid payload encoding")
	}
	var payload map[string]interface{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("invalid payload json")
	}
	exp, _ := payload["exp"].(float64)
	if float64(time.Now().Unix()) > exp {
		return nil, fmt.Errorf("token expired")
	}
	return payload, nil
}

// ═══════════════════════════════════════════════════════════
//  IDS — in-memory IP rate limiter / ban list
// ═══════════════════════════════════════════════════════════

type idsEntry struct {
	count       int
	failedAuth  int
	bannedUntil time.Time
	events      []idsEvent
}

type idsEvent struct {
	IP       string    `json:"ip"`
	Type     string    `json:"type"`
	At       time.Time `json:"at"`
	Username string    `json:"username,omitempty"`
}

var (
	idsMu      sync.Mutex
	idsMap     = map[string]*idsEntry{}
	idsLog     []idsEvent
	idsMaxReq  = 200 // per minute
	idsBanSec  = 300 // 5 min ban
	idsFailMax = 10
)

func idsGet(ip string) *idsEntry {
	if e, ok := idsMap[ip]; ok {
		return e
	}
	e := &idsEntry{}
	idsMap[ip] = e
	return e
}

func idsBanned(ip string) bool {
	idsMu.Lock()
	defer idsMu.Unlock()
	e := idsGet(ip)
	return time.Now().Before(e.bannedUntil)
}

func idsRecord(ip string) {
	idsMu.Lock()
	defer idsMu.Unlock()
	e := idsGet(ip)
	e.count++
	if e.count > idsMaxReq {
		e.bannedUntil = time.Now().Add(time.Duration(idsBanSec) * time.Second)
		ev := idsEvent{IP: ip, Type: "rate_limit_ban", At: time.Now()}
		idsLog = append(idsLog, ev)
		if len(idsLog) > 2000 {
			idsLog = idsLog[len(idsLog)-2000:]
		}
	}
}

func idsRecordFailedAuth(ip, username string) {
	idsMu.Lock()
	defer idsMu.Unlock()
	e := idsGet(ip)
	e.failedAuth++
	ev := idsEvent{IP: ip, Type: "failed_auth", At: time.Now(), Username: username}
	idsLog = append(idsLog, ev)
	if len(idsLog) > 2000 {
		idsLog = idsLog[len(idsLog)-2000:]
	}
	if e.failedAuth >= idsFailMax {
		e.bannedUntil = time.Now().Add(time.Duration(idsBanSec) * time.Second)
	}
}

func idsActiveBans() []map[string]interface{} {
	idsMu.Lock()
	defer idsMu.Unlock()
	var out []map[string]interface{}
	for ip, e := range idsMap {
		if time.Now().Before(e.bannedUntil) {
			out = append(out, map[string]interface{}{
				"ip": ip, "banned_until": e.bannedUntil,
			})
		}
	}
	return out
}

func idsStats() map[string]interface{} {
	idsMu.Lock()
	defer idsMu.Unlock()
	bans := 0
	for _, e := range idsMap {
		if time.Now().Before(e.bannedUntil) {
			bans++
		}
	}
	return map[string]interface{}{"tracked_ips": len(idsMap), "active_bans": bans, "log_entries": len(idsLog)}
}

func idsGetLog(n int) []idsEvent {
	idsMu.Lock()
	defer idsMu.Unlock()
	if n > len(idsLog) {
		n = len(idsLog)
	}
	return idsLog[len(idsLog)-n:]
}

// Periodically reset per-minute counters
func idsResetLoop() {
	for {
		time.Sleep(60 * time.Second)
		idsMu.Lock()
		for _, e := range idsMap {
			e.count = 0
		}
		idsMu.Unlock()
	}
}

// ═══════════════════════════════════════════════════════════
//  THREAT DETECTOR — simplified in-memory version
// ═══════════════════════════════════════════════════════════

type threatEntry struct {
	UserID    string
	Score     float64
	Suspended bool
	Reason    string
	Events    []threatEvent
}

type threatEvent struct {
	UserID   string    `json:"user_id"`
	Endpoint string    `json:"endpoint"`
	Method   string    `json:"method"`
	Status   int       `json:"status_code"`
	At       time.Time `json:"at"`
	Action   string    `json:"action"`
}

var (
	tdMu  sync.Mutex
	tdMap = map[string]*threatEntry{}
	tdLog []threatEvent
)

func tdGet(userID string) *threatEntry {
	if e, ok := tdMap[userID]; ok {
		return e
	}
	e := &threatEntry{UserID: userID}
	tdMap[userID] = e
	return e
}

func tdIsSuspended(userID string) bool {
	tdMu.Lock()
	defer tdMu.Unlock()
	e := tdGet(userID)
	return e.Suspended
}

type tdResult struct {
	Action string
}

func tdRecord(userID, role, endpoint, method string, status int, branchID string) tdResult {
	tdMu.Lock()
	defer tdMu.Unlock()
	e := tdGet(userID)
	if e.Suspended {
		return tdResult{"revoke"}
	}
	ev := threatEvent{UserID: userID, Endpoint: endpoint, Method: method, Status: status, At: time.Now(), Action: "allow"}
	e.Events = append(e.Events, ev)
	if len(e.Events) > 500 {
		e.Events = e.Events[len(e.Events)-500:]
	}
	tdLog = append(tdLog, ev)
	if len(tdLog) > 5000 {
		tdLog = tdLog[len(tdLog)-5000:]
	}

	// Simple heuristic: >50 4xx in last 100 events → increment score
	recent4xx := 0
	start := len(e.Events) - 100
	if start < 0 {
		start = 0
	}
	for _, ev2 := range e.Events[start:] {
		if ev2.Status >= 400 && ev2.Status < 500 {
			recent4xx++
		}
	}
	if recent4xx > 40 {
		e.Score += 10
	}
	if e.Score > 100 {
		e.Suspended = true
		e.Reason = "auto_threat_score"
		return tdResult{"revoke"}
	}
	return tdResult{"allow"}
}

func tdSuspend(userID, reason string) {
	tdMu.Lock()
	defer tdMu.Unlock()
	e := tdGet(userID)
	e.Suspended = true
	e.Reason = reason
}

func tdUnsuspend(userID string) bool {
	tdMu.Lock()
	defer tdMu.Unlock()
	e, ok := tdMap[userID]
	if !ok {
		return false
	}
	e.Suspended = false
	e.Score = 0
	return true
}

func tdAllThreats() []map[string]interface{} {
	tdMu.Lock()
	defer tdMu.Unlock()
	var out []map[string]interface{}
	for uid, e := range tdMap {
		out = append(out, map[string]interface{}{
			"user_id": uid, "score": e.Score, "suspended": e.Suspended,
		})
	}
	return out
}

func tdSuspendedUsers() []string {
	tdMu.Lock()
	defer tdMu.Unlock()
	var out []string
	for uid, e := range tdMap {
		if e.Suspended {
			out = append(out, uid)
		}
	}
	return out
}

func tdGetLog(n int) []threatEvent {
	tdMu.Lock()
	defer tdMu.Unlock()
	if n > len(tdLog) {
		n = len(tdLog)
	}
	return tdLog[len(tdLog)-n:]
}

func tdStats() map[string]interface{} {
	tdMu.Lock()
	defer tdMu.Unlock()
	sus := 0
	for _, e := range tdMap {
		if e.Suspended {
			sus++
		}
	}
	return map[string]interface{}{"tracked_users": len(tdMap), "suspended": sus, "log_entries": len(tdLog)}
}

// ═══════════════════════════════════════════════════════════
//  WEBSOCKET HUB
// ═══════════════════════════════════════════════════════════

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

var (
	wsMu    sync.Mutex
	wsConns []*websocket.Conn
)

func wsBroadcast(eventType string, payload interface{}) {
	msg := map[string]interface{}{
		"type": eventType,
		"data": payload,
		"ts":   time.Now().UTC().Format(time.RFC3339),
	}
	data, _ := json.Marshal(msg)
	wsMu.Lock()
	defer wsMu.Unlock()
	var alive []*websocket.Conn
	for _, conn := range wsConns {
		if err := conn.WriteMessage(websocket.TextMessage, data); err == nil {
			alive = append(alive, conn)
		} else {
			conn.Close()
		}
	}
	wsConns = alive
}

// ═══════════════════════════════════════════════════════════
//  HTTP PROXY HELPERS
// ═══════════════════════════════════════════════════════════

var httpClient = &http.Client{Timeout: 30 * time.Second}

func proxyRequest(c *gin.Context, method, targetURL string, body interface{}, params map[string]string, extraHeaders map[string]string) {
	var reqBody io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		reqBody = bytes.NewReader(b)
	}

	if len(params) > 0 {
		vals := url.Values{}
		for k, v := range params {
			vals.Set(k, v)
		}
		targetURL += "?" + vals.Encode()
	}

	req, err := http.NewRequest(method, targetURL, reqBody)
	if err != nil {
		c.JSON(500, gin.H{"detail": "proxy request creation failed"})
		return
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	// Propagate W3C trace context and request correlation ID on every upstream call.
	if rid := c.GetString("request_id"); rid != "" {
		req.Header.Set("X-Request-ID", rid)
	}
	if tp := c.GetHeader("traceparent"); tp != "" {
		req.Header.Set("traceparent", tp)
	}
	if ts := c.GetHeader("tracestate"); ts != "" {
		req.Header.Set("tracestate", ts)
	}
	for k, v := range extraHeaders {
		req.Header.Set(k, v)
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		if strings.Contains(err.Error(), "connection refused") || strings.Contains(err.Error(), "dial") {
			c.JSON(503, gin.H{"detail": "upstream service is offline"})
		} else {
			c.JSON(503, gin.H{"detail": fmt.Sprintf("upstream error: %v", err)})
		}
		return
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	c.Data(resp.StatusCode, "application/json", respBody)
}

func edgeURL(branchID string) (string, bool) {
	bid := strings.ToLower(strings.ReplaceAll(branchID, " ", "_"))
	u, ok := branchEdgeMap[bid]
	return u, ok
}

func proxyEdge(c *gin.Context, method, path string, body interface{}) {
	claims := c.MustGet("claims").(map[string]interface{})
	bid, _ := claims["branch_id"].(string)
	eu, ok := edgeURL(bid)
	if !ok {
		c.JSON(404, gin.H{"detail": fmt.Sprintf("unknown branch: %s", bid)})
		return
	}
	proxyRequest(c, method, eu+path, body, nil, nil)
}

func proxyHQ(c *gin.Context, method, path string, body interface{}, params map[string]string) {
	// HQ only accepts a Bearer JWT — it ignores X-API-Key entirely, so sending the
	// raw API key here made every JWT-guarded HQ route fail with "Malformed token".
	// Mint/reuse the service JWT instead. Per-user RBAC is enforced by the BFF
	// handlers before they reach this point.
	headers := map[string]string{}
	if token := getHQToken(); token != "" {
		headers["Authorization"] = "Bearer " + token
	}
	proxyRequest(c, method, hqURL+path, body, params, headers)
}

// ═══════════════════════════════════════════════════════════
//  HQ TOKEN CACHE (BFF → HQ service token)
// ═══════════════════════════════════════════════════════════

var (
	hqTokenMu    sync.Mutex
	hqTokenCache string
	hqTokenExp   float64
)

func getHQToken() string {
	hqTokenMu.Lock()
	defer hqTokenMu.Unlock()
	if float64(time.Now().Unix()) < hqTokenExp-60 {
		return hqTokenCache
	}
	// Register with HQ
	// The BFF is the RBAC gate: handlers check the caller's role before proxying,
	// so the service identity needs admin to reach HQ's admin-only routes.
	// A branch_operator token 403s on every one of them.
	payload := map[string]interface{}{
		"branch": "BFF-Gateway", "api_key": hqAPIKey, "role": "admin",
	}
	body, _ := json.Marshal(payload)
	resp, err := httpClient.Post(hqURL+"/api/register", "application/json", bytes.NewReader(body))
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	var result map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&result)
	token, _ := result["token"].(string)
	expStr, _ := result["expires_at"].(string)
	exp := float64(time.Now().Unix() + 3600)
	if t, err := time.Parse(time.RFC3339, expStr); err == nil {
		exp = float64(t.Unix())
	}
	hqTokenCache = token
	hqTokenExp = exp
	return token
}

// ═══════════════════════════════════════════════════════════
//  DATABASE
// ═══════════════════════════════════════════════════════════

func initDB() {
	dbURL := getEnv("DATABASE_URL", "sqlite:///./securescore.db")
	// Convert SQLAlchemy URL to Go sqlite path
	dbPath := "./securescore.db"
	if strings.HasPrefix(dbURL, "sqlite:///") {
		dbPath = strings.TrimPrefix(dbURL, "sqlite:///")
		if strings.HasPrefix(dbPath, "./") {
			dbPath = dbPath[2:]
		}
	}

	var err error
	db, err = sql.Open("sqlite", dbPath)
	if err != nil {
		log.Printf("[WARN] SQLite open failed: %v — DB endpoints disabled", err)
		db = nil
		return
	}
	db.SetMaxOpenConns(1) // SQLite single writer
	if err := db.Ping(); err != nil {
		log.Printf("[WARN] SQLite ping failed: %v — DB endpoints disabled", err)
		db = nil
		return
	}
	ensureSchema()
	// Demo seeding runs only on the real startup path (not in tests, which call
	// ensureSchema directly). Both are idempotent and non-destructive.
	seedDemoBanking()
	seedBulkPortfolio()
	log.Printf("[DB] SQLite connected (%s)", dbPath)
}

func ensureSchema() {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS account_applications (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			customer_id TEXT NOT NULL,
			branch_id TEXT NOT NULL,
			account_type TEXT NOT NULL,
			purpose TEXT,
			initial_deposit REAL DEFAULT 0,
			status TEXT DEFAULT 'pending',
			reviewed_by TEXT,
			review_note TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			reviewed_at DATETIME
		)`,
		`CREATE TABLE IF NOT EXISTS eod_logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			process_type TEXT NOT NULL,
			run_by TEXT,
			branch_id TEXT,
			interest_posted_count INTEGER DEFAULT 0,
			interest_posted_total REAL DEFAULT 0.0,
			dormant_marked_count INTEGER DEFAULT 0,
			fd_matured_count INTEGER DEFAULT 0,
			fd_matured_total REAL DEFAULT 0.0,
			status TEXT DEFAULT 'success',
			error_message TEXT,
			started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			completed_at DATETIME
		)`,
		`CREATE TABLE IF NOT EXISTS kyc_verifications (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			customer_id TEXT UNIQUE NOT NULL,
			verified_by TEXT,
			verified_at DATETIME,
			kyc_status TEXT DEFAULT 'pending',
			notes TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS kyc_applications (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			reference TEXT UNIQUE NOT NULL,
			customer_id TEXT NOT NULL,
			full_name TEXT,
			branch_id TEXT,
			phone TEXT,
			email TEXT,
			loan_purpose TEXT,
			loan_amount REAL DEFAULT 0,
			status TEXT DEFAULT 'pending_ai',
			ai_verified INTEGER DEFAULT 0,
			face_profile_live REAL DEFAULT 0,
			face_profile_id REAL DEFAULT 0,
			liveness_passed INTEGER DEFAULT 0,
			sig_match REAL DEFAULT 0,
			review_note TEXT,
			submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			reviewed_at DATETIME
		)`,
		`CREATE TABLE IF NOT EXISTS loan_decisions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			branch TEXT NOT NULL,
			customer_id TEXT,
			requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			request_payload TEXT,
			response_payload TEXT,
			default_probability REAL,
			risk_grade TEXT,
			suggested_interest_rate REAL,
			recommended_max_loan_npr REAL,
			nrb_compliant INTEGER DEFAULT 1
		)`,
		`CREATE TABLE IF NOT EXISTS hq_fingerprint_decisions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			fingerprint_id TEXT UNIQUE,
			branch_id TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			hq_grade TEXT,
			branch_adjusted_grade TEXT,
			default_probability REAL,
			branch_recommended_rate REAL,
			max_approved_loan_npr REAL,
			hq_model_version INTEGER,
			nrb_compliant INTEGER DEFAULT 1,
			requires_guarantor INTEGER DEFAULT 0,
			applicant_payload TEXT,
			branch_params TEXT,
			response_payload TEXT
		)`,
		`CREATE TABLE IF NOT EXISTS fraud_alert_events (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			branch TEXT NOT NULL,
			customer_id TEXT,
			detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			severity TEXT,
			metric TEXT,
			value REAL,
			z_score REAL,
			reason TEXT,
			source TEXT DEFAULT 'transaction_ingest',
			payload TEXT
		)`,
		`CREATE TABLE IF NOT EXISTS merkle_audit_anchors (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			anchor_date TEXT NOT NULL,
			branch_id TEXT NOT NULL DEFAULT '',
			root_hash TEXT NOT NULL,
			transaction_count INTEGER NOT NULL,
			algorithm TEXT NOT NULL DEFAULT 'SHA-256 Merkle tree',
			created_by TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(anchor_date, branch_id)
		)`,
		`CREATE TABLE IF NOT EXISTS accounts (
			id TEXT PRIMARY KEY,
			account_number TEXT UNIQUE NOT NULL,
			customer_id TEXT NOT NULL,
			branch_id TEXT,
			account_type TEXT NOT NULL DEFAULT 'savings',
			balance REAL NOT NULL DEFAULT 0.0,
			currency TEXT DEFAULT 'NPR',
			is_active INTEGER DEFAULT 1,
			interest_rate REAL DEFAULT 5.0,
			minimum_balance REAL DEFAULT 1000.0,
			opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS transactions (
			id TEXT PRIMARY KEY,
			reference_number TEXT UNIQUE NOT NULL,
			from_account_id TEXT,
			to_account_id TEXT,
			from_account_number TEXT,
			to_account_number TEXT,
			amount REAL NOT NULL,
			currency TEXT DEFAULT 'NPR',
			transaction_type TEXT NOT NULL,
			description TEXT,
			status TEXT DEFAULT 'COMPLETED',
			balance_after REAL,
			fee REAL DEFAULT 0.0,
			initiated_by TEXT,
			channel TEXT DEFAULT 'online',
			branch_id TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS fixed_deposits (
			id TEXT PRIMARY KEY,
			fd_number TEXT UNIQUE NOT NULL,
			customer_id TEXT NOT NULL,
			account_id TEXT NOT NULL,
			branch_id TEXT,
			principal REAL NOT NULL,
			interest_rate REAL NOT NULL,
			tenure_months INTEGER NOT NULL,
			maturity_date DATETIME NOT NULL,
			maturity_amount REAL NOT NULL,
			status TEXT DEFAULT 'ACTIVE',
			auto_renew INTEGER DEFAULT 0,
			opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			broken_at DATETIME,
			penalty_applied REAL DEFAULT 0.0
		)`,
		`CREATE TABLE IF NOT EXISTS loans (
			id TEXT PRIMARY KEY,
			loan_number TEXT UNIQUE NOT NULL,
			customer_id TEXT NOT NULL,
			account_id TEXT NOT NULL,
			branch_id TEXT,
			loan_type TEXT NOT NULL,
			principal REAL NOT NULL,
			interest_rate REAL NOT NULL,
			tenure_months INTEGER NOT NULL,
			emi REAL NOT NULL,
			outstanding REAL NOT NULL,
			purpose TEXT,
			collateral_value REAL DEFAULT 0,
			has_guarantor INTEGER DEFAULT 0,
			total_interest REAL DEFAULT 0,
			risk_grade TEXT,
			status TEXT DEFAULT 'ACTIVE',
			disbursed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			closed_at DATETIME
		)`,
		`CREATE TABLE IF NOT EXISTS loan_schedule (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			loan_id TEXT NOT NULL,
			installment_no INTEGER NOT NULL,
			due_date TEXT NOT NULL,
			emi REAL NOT NULL,
			principal_component REAL NOT NULL,
			interest_component REAL NOT NULL,
			balance_after REAL NOT NULL,
			status TEXT DEFAULT 'PENDING',
			paid_at DATETIME
		)`,
		`CREATE TABLE IF NOT EXISTS loan_payments (
			id TEXT PRIMARY KEY,
			loan_id TEXT NOT NULL,
			installment_no INTEGER NOT NULL,
			amount REAL NOT NULL,
			reference_number TEXT,
			paid_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS beneficiaries (
			id TEXT PRIMARY KEY,
			customer_id TEXT NOT NULL,
			nickname TEXT NOT NULL,
			account_number TEXT NOT NULL,
			bank_name TEXT DEFAULT 'SecureScore Bank',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS standing_instructions (
			id TEXT PRIMARY KEY,
			customer_id TEXT NOT NULL,
			from_account_number TEXT NOT NULL,
			to_account_number TEXT NOT NULL,
			amount REAL NOT NULL,
			frequency TEXT NOT NULL,
			next_run TEXT NOT NULL,
			status TEXT DEFAULT 'ACTIVE',
			description TEXT,
			last_run TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS cards (
			id TEXT PRIMARY KEY,
			customer_id TEXT NOT NULL,
			account_number TEXT NOT NULL,
			card_number TEXT NOT NULL,
			network TEXT DEFAULT 'NPI',
			status TEXT DEFAULT 'ACTIVE',
			daily_limit REAL DEFAULT 100000,
			expiry TEXT,
			issued_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS cheque_book_requests (
			id TEXT PRIMARY KEY,
			customer_id TEXT NOT NULL,
			account_number TEXT NOT NULL,
			branch_id TEXT,
			leaves INTEGER DEFAULT 25,
			status TEXT DEFAULT 'REQUESTED',
			requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME
		)`,
		// ── General ledger (double-entry) ───────────────────────
		`CREATE TABLE IF NOT EXISTS gl_accounts (
			code TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			type TEXT NOT NULL,          -- ASSET / LIABILITY / EQUITY / INCOME / EXPENSE
			normal_side TEXT NOT NULL    -- debit / credit
		)`,
		`CREATE TABLE IF NOT EXISTS gl_entries (
			id TEXT PRIMARY KEY,
			txn_ref TEXT NOT NULL,
			line_no INTEGER NOT NULL,
			account_code TEXT NOT NULL,
			debit REAL DEFAULT 0,
			credit REAL DEFAULT 0,
			branch_id TEXT,
			memo TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(txn_ref, line_no)
		)`,
		`CREATE TABLE IF NOT EXISTS gl_meta (key TEXT PRIMARY KEY, value TEXT)`,
		// ── Transaction blockchain (private, hash-linked block ledger) ──
		`CREATE TABLE IF NOT EXISTS blocks (
			idx INTEGER PRIMARY KEY,
			prev_hash TEXT NOT NULL,
			merkle_root TEXT NOT NULL,
			tx_count INTEGER DEFAULT 0,
			nonce INTEGER DEFAULT 0,
			difficulty INTEGER DEFAULT 0,
			ts TEXT NOT NULL,
			hash TEXT NOT NULL
		)`,
		// Chart of accounts (seed once; INSERT OR IGNORE keeps it idempotent).
		`INSERT OR IGNORE INTO gl_accounts (code,name,type,normal_side) VALUES
			('1000','Cash & Vault','ASSET','debit'),
			('1100','Loans Receivable','ASSET','debit'),
			('2000','Customer Deposits','LIABILITY','credit'),
			('2100','Fixed Deposits','LIABILITY','credit'),
			('3000','Opening Equity','EQUITY','credit'),
			('4000','Fee Income','INCOME','credit'),
			('4100','Interest Income','INCOME','credit'),
			('5000','Interest Expense','EXPENSE','debit')`,
		`CREATE TABLE IF NOT EXISTS user_profiles (
			id TEXT PRIMARY KEY,
			customer_id TEXT UNIQUE NOT NULL,
			full_name TEXT NOT NULL,
			date_of_birth TEXT,
			gender TEXT,
			nationality TEXT DEFAULT 'Nepali',
			national_id TEXT UNIQUE,
			address TEXT,
			district TEXT,
			province TEXT,
			occupation TEXT,
			annual_income REAL,
			username TEXT UNIQUE NOT NULL,
			password_hash TEXT NOT NULL,
			role TEXT DEFAULT 'customer',
			is_active INTEGER DEFAULT 1,
			last_login DATETIME,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS refresh_tokens (
			id TEXT PRIMARY KEY,
			username TEXT NOT NULL,
			token_hash TEXT NOT NULL UNIQUE,
			expires_at DATETIME NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			revoked INTEGER DEFAULT 0
		)`,
		// dp_budget_ledger: one row per FL round; survives BFF restarts (Issue D-2/5).
		`CREATE TABLE IF NOT EXISTS dp_budget_ledger (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			round_number INTEGER NOT NULL,
			epsilon_used REAL NOT NULL,
			clip_norm REAL NOT NULL DEFAULT 1.0,
			branches_included INTEGER NOT NULL DEFAULT 0,
			triggered_by TEXT NOT NULL DEFAULT 'admin',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		// idempotency_keys: cache POST mutation results for 24h to prevent double-processing.
		// key_hash is SHA-256 of the client-supplied Idempotency-Key header.
		`CREATE TABLE IF NOT EXISTS idempotency_keys (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			key_hash TEXT NOT NULL UNIQUE,
			response_status INTEGER NOT NULL,
			response_body TEXT NOT NULL,
			expires_at DATETIME NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		// erasure_log: immutable record of GDPR/right-to-erasure requests (C-2).
		`CREATE TABLE IF NOT EXISTS erasure_log (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			customer_id TEXT NOT NULL,
			requested_by TEXT NOT NULL,
			request_id TEXT NOT NULL,
			tables_affected TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
	}
	for _, s := range stmts {
		if _, err := db.Exec(s); err != nil {
			log.Printf("[DB] schema warning: %v", err)
		}
	}
	// Add columns idempotently (SQLite ALTER TABLE ADD COLUMN is safe if column doesn't exist)
	safeCols := []string{
		"ALTER TABLE accounts ADD COLUMN account_status TEXT DEFAULT 'active'",
		"ALTER TABLE accounts ADD COLUMN dormant_since DATETIME",
		"ALTER TABLE accounts ADD COLUMN last_transaction_date DATETIME",
		"ALTER TABLE cards ADD COLUMN currency TEXT DEFAULT 'NPR'",
		"ALTER TABLE cards ADD COLUMN balance REAL DEFAULT 0",
		"ALTER TABLE cards ADD COLUMN card_type TEXT DEFAULT 'DEBIT'",
		"ALTER TABLE cards ADD COLUMN pin_hash TEXT DEFAULT ''",
		"ALTER TABLE cards ADD COLUMN ch_online INTEGER DEFAULT 1",
		"ALTER TABLE cards ADD COLUMN ch_pos INTEGER DEFAULT 1",
		"ALTER TABLE cards ADD COLUMN ch_atm INTEGER DEFAULT 1",
	}
	for _, s := range safeCols {
		db.Exec(s) // ignore error if column already exists
	}
	initRBAC()
	initMarkets()
	initApprovals()
	initNotifications()
}

func dbAvailable() bool { return db != nil }

type fraudTxnEvent struct {
	TransactionID     string  `json:"transaction_id"`
	ReferenceNumber   string  `json:"reference_number"`
	CustomerID        string  `json:"customer_id"`
	BranchID          string  `json:"branch_id"`
	FromAccountNumber string  `json:"from_account_number"`
	ToAccountNumber   string  `json:"to_account_number"`
	Amount            float64 `json:"amount"`
	Fee               float64 `json:"fee"`
	Channel           string  `json:"channel"`
	CreatedAt         string  `json:"created_at"`
}

type fraudWorkerSnapshot struct {
	QueueDepth       int       `json:"queue_depth"`
	Processed        int64     `json:"processed"`
	Flagged          int64     `json:"flagged"`
	LastEventAt      string    `json:"last_event_at,omitempty"`
	LastReference    string    `json:"last_reference,omitempty"`
	LastRiskScore    float64   `json:"last_risk_score"`
	LastWorkerStatus string    `json:"status"`
	StartedAt        time.Time `json:"started_at"`
}

var (
	fraudEvents = make(chan fraudTxnEvent, 512)
	fraudStats  = struct {
		sync.Mutex
		processed     int64
		flagged       int64
		lastEventAt   string
		lastReference string
		lastRiskScore float64
		startedAt     time.Time
	}{startedAt: time.Now().UTC()}
)

type merkleTxnLeaf struct {
	ID                string  `json:"id"`
	ReferenceNumber   string  `json:"reference_number"`
	FromAccountID     string  `json:"from_account_id,omitempty"`
	ToAccountID       string  `json:"to_account_id,omitempty"`
	FromAccountNumber string  `json:"from_account_number,omitempty"`
	ToAccountNumber   string  `json:"to_account_number,omitempty"`
	Amount            float64 `json:"amount"`
	Currency          string  `json:"currency"`
	TransactionType   string  `json:"transaction_type"`
	Status            string  `json:"status"`
	Fee               float64 `json:"fee"`
	InitiatedBy       string  `json:"initiated_by,omitempty"`
	Channel           string  `json:"channel"`
	BranchID          string  `json:"branch_id,omitempty"`
	CreatedAt         string  `json:"created_at"`
}

type merkleProofStep struct {
	Level       int    `json:"level"`
	Side        string `json:"side"`
	SiblingHash string `json:"sibling_hash"`
}

func hashHex(data string) string {
	sum := sha256.Sum256([]byte(data))
	return hex.EncodeToString(sum[:])
}

func canonicalTxnLeafHash(leaf merkleTxnLeaf) (string, error) {
	raw, err := json.Marshal(leaf)
	if err != nil {
		return "", err
	}
	return hashHex("txn:" + string(raw)), nil
}

func merkleParentHash(left, right string) string {
	return hashHex("node:" + left + ":" + right)
}

func buildMerkleProof(leaves []string, target int) (string, []merkleProofStep, error) {
	if len(leaves) == 0 {
		return "", nil, fmt.Errorf("no leaves")
	}
	if target < 0 || target >= len(leaves) {
		return "", nil, fmt.Errorf("target leaf out of range")
	}

	level := append([]string(nil), leaves...)
	index := target
	var proof []merkleProofStep
	for depth := 0; len(level) > 1; depth++ {
		if len(level)%2 == 1 {
			level = append(level, level[len(level)-1])
		}

		siblingIndex := index ^ 1
		side := "right"
		if siblingIndex < index {
			side = "left"
		}
		proof = append(proof, merkleProofStep{
			Level:       depth,
			Side:        side,
			SiblingHash: level[siblingIndex],
		})

		next := make([]string, 0, len(level)/2)
		for i := 0; i < len(level); i += 2 {
			next = append(next, merkleParentHash(level[i], level[i+1]))
		}
		index /= 2
		level = next
	}
	return level[0], proof, nil
}

func verifyMerkleProof(leafHash, root string, proof []merkleProofStep) bool {
	current := leafHash
	for _, step := range proof {
		if step.Side == "left" {
			current = merkleParentHash(step.SiblingHash, current)
		} else {
			current = merkleParentHash(current, step.SiblingHash)
		}
	}
	return hmac.Equal([]byte(current), []byte(root))
}

func merkleRootForScope(branchID, date string) (string, int, []string, error) {
	leaves, err := loadMerkleTxnLeaves(branchID, date)
	if err != nil {
		return "", 0, nil, err
	}
	if len(leaves) == 0 {
		return "", 0, nil, fmt.Errorf("no transactions found for selected scope")
	}
	hashes := make([]string, 0, len(leaves))
	for _, leaf := range leaves {
		hash, err := canonicalTxnLeafHash(leaf)
		if err != nil {
			return "", 0, nil, err
		}
		hashes = append(hashes, hash)
	}
	root, _, err := buildMerkleProof(hashes, 0)
	return root, len(hashes), hashes, err
}

func loadMerkleTxnLeaves(branchID, date string) ([]merkleTxnLeaf, error) {
	q := `SELECT id, reference_number, from_account_id, to_account_id, from_account_number, to_account_number,
		amount, currency, transaction_type, status, fee, initiated_by, channel, branch_id, created_at
		FROM transactions WHERE DATE(created_at)=DATE(?)`
	args := []interface{}{date}
	if branchID != "" {
		q += " AND branch_id=?"
		args = append(args, branchID)
	}
	q += " ORDER BY created_at ASC, id ASC"

	rows, err := db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var leaves []merkleTxnLeaf
	for rows.Next() {
		var leaf merkleTxnLeaf
		var fromID, toID, fromNum, toNum, initiatedBy, branch, createdAt sql.NullString
		var currency, status, channel sql.NullString
		if err := rows.Scan(
			&leaf.ID, &leaf.ReferenceNumber, &fromID, &toID, &fromNum, &toNum,
			&leaf.Amount, &currency, &leaf.TransactionType, &status, &leaf.Fee,
			&initiatedBy, &channel, &branch, &createdAt,
		); err != nil {
			return nil, err
		}
		leaf.FromAccountID = fromID.String
		leaf.ToAccountID = toID.String
		leaf.FromAccountNumber = fromNum.String
		leaf.ToAccountNumber = toNum.String
		leaf.Currency = currency.String
		if leaf.Currency == "" {
			leaf.Currency = "NPR"
		}
		leaf.Status = status.String
		if leaf.Status == "" {
			leaf.Status = "COMPLETED"
		}
		leaf.InitiatedBy = initiatedBy.String
		leaf.Channel = channel.String
		if leaf.Channel == "" {
			leaf.Channel = "online"
		}
		leaf.BranchID = branch.String
		leaf.CreatedAt = createdAt.String
		leaves = append(leaves, leaf)
	}
	return leaves, rows.Err()
}

func enqueueFraudEvent(event fraudTxnEvent) {
	select {
	case fraudEvents <- event:
	default:
		log.Printf("[FRAUD] worker queue full; dropped transaction %s", event.ReferenceNumber)
	}
}

func scoreFraudEvent(event fraudTxnEvent) (float64, string, string) {
	score := 0.05
	reasons := []string{}

	switch {
	case event.Amount >= 500000:
		score += 0.75
		reasons = append(reasons, "very_large_transfer")
	case event.Amount >= 100000:
		score += 0.45
		reasons = append(reasons, "large_transfer")
	case event.Amount >= 50000:
		score += 0.22
		reasons = append(reasons, "elevated_transfer")
	}
	if event.Fee > 250 {
		score += 0.15
		reasons = append(reasons, "high_fee_signal")
	}
	if t, err := time.Parse(time.RFC3339, event.CreatedAt); err == nil {
		hour := t.Hour()
		if hour < 6 || hour >= 22 {
			score += 0.18
			reasons = append(reasons, "off_hours_activity")
		}
	}
	if event.FromAccountNumber == event.ToAccountNumber {
		score += 0.5
		reasons = append(reasons, "same_account_anomaly")
	}
	if score > 0.99 {
		score = 0.99
	}
	severity := "low"
	if score >= 0.85 {
		severity = "critical"
	} else if score >= 0.65 {
		severity = "high"
	} else if score >= 0.45 {
		severity = "medium"
	}
	if len(reasons) == 0 {
		reasons = append(reasons, "baseline_monitoring")
	}
	return math_round(score, 3), severity, strings.Join(reasons, ",")
}

func startFraudWorker() {
	go func() {
		log.Printf("[FRAUD] Go fraud event worker started")
		for event := range fraudEvents {
			score, severity, reason := scoreFraudEvent(event)
			flagged := score >= 0.45

			fraudStats.Lock()
			fraudStats.processed++
			fraudStats.lastEventAt = time.Now().UTC().Format(time.RFC3339)
			fraudStats.lastReference = event.ReferenceNumber
			fraudStats.lastRiskScore = score
			if flagged {
				fraudStats.flagged++
			}
			fraudStats.Unlock()

			if !flagged || !dbAvailable() {
				continue
			}
			payload, _ := json.Marshal(event)
			_, err := db.Exec(`INSERT INTO fraud_alert_events
				(branch, customer_id, severity, metric, value, z_score, reason, source, payload)
				VALUES (?, ?, ?, ?, ?, ?, ?, 'go_fraud_worker', ?)`,
				event.BranchID, event.CustomerID, severity, "risk_score", event.Amount, score, reason, string(payload))
			if err != nil {
				log.Printf("[FRAUD] persist alert failed: %v", err)
				continue
			}
			wsBroadcast("fraud_alert", gin.H{
				"reference_number": event.ReferenceNumber,
				"customer_id":      event.CustomerID,
				"branch_id":        event.BranchID,
				"amount":           event.Amount,
				"risk_score":       score,
				"severity":         severity,
				"reason":           reason,
				"source":           "go_fraud_worker",
			})
		}
	}()
}

func fraudWorkerStatus() fraudWorkerSnapshot {
	fraudStats.Lock()
	defer fraudStats.Unlock()
	return fraudWorkerSnapshot{
		QueueDepth:       len(fraudEvents),
		Processed:        fraudStats.processed,
		Flagged:          fraudStats.flagged,
		LastEventAt:      fraudStats.lastEventAt,
		LastReference:    fraudStats.lastReference,
		LastRiskScore:    fraudStats.lastRiskScore,
		LastWorkerStatus: "running",
		StartedAt:        fraudStats.startedAt,
	}
}

func txRef() string {
	return fmt.Sprintf("TXN%012d", rand.Int63n(1_000_000_000_000))
}

func fdNumber() string {
	return fmt.Sprintf("FD%010d", rand.Int63n(10_000_000_000))
}

func newUUID() string {
	b := make([]byte, 16)
	if _, err := crand.Read(b); err != nil {
		log.Fatalf("crypto/rand unavailable: %v", err)
	}
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func accountNumber() string {
	return fmt.Sprintf("NB%014d", rand.Int63n(100_000_000_000_000-10_000_000_000_000)+10_000_000_000_000)
}

// ═══════════════════════════════════════════════════════════
//  MIDDLEWARE
// ═══════════════════════════════════════════════════════════

func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")
		allowed := false
		for _, o := range corsOrigins {
			if o == origin {
				allowed = true
				break
			}
		}
		if allowed {
			c.Header("Access-Control-Allow-Origin", origin)
		} else if len(corsOrigins) > 0 {
			c.Header("Access-Control-Allow-Origin", corsOrigins[0])
		}
		c.Header("Access-Control-Allow-Credentials", "true")
		c.Header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,PATCH,OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Authorization,Content-Type,X-Request-ID")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	}
}

// maxBodyMiddleware limits the request body to prevent DoS via oversized payloads.
// The limit is 50 MB for model-weight routes; 1 MB for everything else.
func maxBodyMiddleware() gin.HandlerFunc {
	const defaultMaxBytes = 1 << 20  // 1 MB
	const weightsMaxBytes = 50 << 20 // 50 MB — matches MAX_PAYLOAD_BYTES in hq_server.py
	weightsRoutes := map[string]bool{
		"/api/v1/gradients/upload": true,
		"/api/v1/aggregate":        true,
		"/api/branch/hq_assess":    true,
		"/api/banking/cheque/scan": true, // cheque image upload (up to 8 MB)
	}
	return func(c *gin.Context) {
		limit := int64(defaultMaxBytes)
		if weightsRoutes[c.Request.URL.Path] {
			limit = weightsMaxBytes
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, limit)
		c.Next()
		// MaxBytesReader sets an error on the body; gin's ShouldBindJSON will surface it as 400.
	}
}

// securityHeadersMiddleware adds OWASP-recommended security response headers.
func securityHeadersMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Header("X-XSS-Protection", "0") // modern browsers use CSP; disable legacy XSS auditor
		c.Header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		// HSTS: 1 year, include subdomains. Only effective over HTTPS (nginx terminates TLS in prod).
		c.Header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		// CSP: allow same origin + the Next.js dev server. Tighten in production.
		c.Header("Content-Security-Policy",
			"default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; font-src 'self'")
		c.Next()
	}
}

// requestIDMiddleware generates or propagates a unique request ID for distributed tracing (S-15).
// Inbound X-Request-ID is accepted as-is (proxy-safe). If absent, a crypto-random 32-hex-char ID
// is generated. The ID is set on every response and stored in the Gin context under "request_id".
func requestIDMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		rid := c.GetHeader("X-Request-ID")
		if rid == "" {
			b := make([]byte, 16)
			_, _ = crand.Read(b)
			rid = hex.EncodeToString(b)
		}
		c.Set("request_id", rid)
		c.Header("X-Request-ID", rid)
		c.Next()
	}
}

// idempotencyWriter wraps gin.ResponseWriter to capture status + body for the idempotency cache.
type idempotencyWriter struct {
	gin.ResponseWriter
	body   *bytes.Buffer
	status int
}

func (w *idempotencyWriter) Write(b []byte) (int, error) {
	w.body.Write(b)
	return w.ResponseWriter.Write(b)
}

func (w *idempotencyWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

// idempotencyMiddleware enforces once-only semantics on POST mutation requests (S-18 complement).
// Clients supply an Idempotency-Key header; a SHA-256 hash of it is the DB key.
// Successful 2xx responses are cached for 24 h. Replayed requests return the cached body
// with Idempotency-Replayed: true. Only active when the header is present and DB is available.
func idempotencyMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Method != "POST" || !dbAvailable() {
			c.Next()
			return
		}
		rawKey := c.GetHeader("Idempotency-Key")
		if rawKey == "" {
			c.Next()
			return
		}
		h := sha256.Sum256([]byte(rawKey))
		keyHash := hex.EncodeToString(h[:])

		var respStatus int
		var respBody string
		err := db.QueryRow(
			`SELECT response_status, response_body FROM idempotency_keys WHERE key_hash = ? AND expires_at > datetime('now')`,
			keyHash,
		).Scan(&respStatus, &respBody)
		if err == nil {
			c.Header("Idempotency-Replayed", "true")
			c.AbortWithStatusJSON(respStatus, json.RawMessage(respBody))
			return
		}

		blw := &idempotencyWriter{ResponseWriter: c.Writer, body: &bytes.Buffer{}, status: 200}
		c.Writer = blw
		c.Next()

		if blw.status >= 200 && blw.status < 300 {
			db.Exec(
				`INSERT OR IGNORE INTO idempotency_keys (key_hash, response_status, response_body, expires_at) VALUES (?, ?, ?, datetime('now', '+24 hours'))`,
				keyHash, blw.status, blw.body.String(),
			)
		}
	}
}

func idsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		ip := c.ClientIP()
		if idsBanned(ip) {
			c.AbortWithStatusJSON(403, gin.H{"detail": "Your IP has been temporarily blocked."})
			return
		}
		idsRecord(ip)
		c.Next()

		// Track failed auth for banning
		if c.Writer.Status() == 401 && strings.HasPrefix(c.Request.URL.Path, "/api/auth") {
			idsRecordFailedAuth(ip, "")
		}
	}
}

func authMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// EventSource (SSE) cannot send headers, so we also accept ?token=<jwt>
		// as a fallback. Header takes precedence when both are present.
		rawToken := ""
		authHeader := c.GetHeader("Authorization")
		if strings.HasPrefix(authHeader, "Bearer ") {
			rawToken = authHeader[7:]
		} else if t := c.Query("token"); t != "" {
			rawToken = t
		}
		if rawToken == "" {
			c.AbortWithStatusJSON(401, gin.H{"detail": "Missing or invalid Authorization header"})
			return
		}
		claims, err := verifyBFFJWT(rawToken)
		if err != nil {
			c.AbortWithStatusJSON(401, gin.H{"detail": err.Error()})
			return
		}

		userID, _ := claims["sub"].(string)
		role, _ := claims["role"].(string)
		branchID, _ := claims["branch_id"].(string)

		if tdIsSuspended(userID) {
			c.AbortWithStatusJSON(403, gin.H{"detail": "Your account has been suspended due to suspicious activity."})
			return
		}

		c.Set("claims", claims)
		c.Next()

		result := tdRecord(userID, role, c.Request.URL.Path, c.Request.Method, c.Writer.Status(), branchID)
		if result.Action == "revoke" {
			// Can't abort after Next(), but next request will be blocked
		}
	}
}

func requireManager(c *gin.Context) bool {
	claims := c.MustGet("claims").(map[string]interface{})
	role, _ := claims["role"].(string)
	if role != "branch_manager" && role != "admin" {
		c.JSON(403, gin.H{"detail": "Branch Manager or Admin access required"})
		return false
	}
	return true
}

func requireAdmin(c *gin.Context) bool {
	claims := c.MustGet("claims").(map[string]interface{})
	role, _ := claims["role"].(string)
	if role != "admin" {
		c.JSON(403, gin.H{"detail": "Admin access required"})
		return false
	}
	return true
}

// ═══════════════════════════════════════════════════════════
//  AUTH HANDLERS
// ═══════════════════════════════════════════════════════════

// issueRefreshToken generates a secure random token, stores its SHA-256 hash in
// the refresh_tokens table (7-day TTL), and returns the raw token to the caller.
func issueRefreshToken(username string) string {
	raw := make([]byte, 32)
	if _, err := crand.Read(raw); err != nil {
		log.Fatalf("crypto/rand unavailable: %v", err)
	}
	rawHex := hex.EncodeToString(raw)
	h := sha256.Sum256([]byte(rawHex))
	tokenHash := hex.EncodeToString(h[:])
	expiresAt := time.Now().Add(7 * 24 * time.Hour)
	id := newUUID()
	db.Exec(
		`INSERT INTO refresh_tokens (id, username, token_hash, expires_at) VALUES (?, ?, ?, ?)`,
		id, username, tokenHash, expiresAt.UTC().Format(time.RFC3339),
	)
	return rawHex
}

func handleGetMe(c *gin.Context) {
	claims := c.MustGet("claims").(map[string]interface{})
	bid, _ := claims["branch_id"].(string)
	c.JSON(200, gin.H{
		"username":    claims["sub"],
		"role":        claims["role"],
		"branch_id":   bid,
		"full_name":   claims["full_name"],
		"branch_type": branchType[bid],
		"customer_id": claims["customer_id"],
	})
}

// ═══════════════════════════════════════════════════════════
//  CUSTOMER HANDLERS
// ═══════════════════════════════════════════════════════════

// ─── Chat ────────────────────────────────────────────────

var regionalCtx = map[string]map[string]string{
	"urban": {
		"economy":        "metropolitan service economy with diverse digital payment adoption",
		"typical_income": "NPR 65,000-85,000/month",
		"advice_prefix":  "In the Kathmandu Valley's competitive market",
	},
	"semi_urban": {
		"economy":        "growing trade corridor with expanding digital infrastructure",
		"typical_income": "NPR 38,000-45,000/month",
		"advice_prefix":  "In your developing regional market",
	},
	"rural": {
		"economy":        "agriculture-based economy with seasonal income patterns",
		"typical_income": "NPR 22,000-28,000/month",
		"advice_prefix":  "In your agricultural community",
	},
}

func buildSystemPrompt(xai map[string]interface{}, branchID, customerID string) string {
	region := branchType[branchID]
	if region == "" {
		region = "urban"
	}
	ctx := regionalCtx[region]
	bl := strings.ReplaceAll(strings.Title(branchID), "_", " ")
	p := "You are SecureScore AI, a friendly banking assistant for " + bl + " branch in Nepal. " +
		"You specialize in credit scoring, loan eligibility, and financial health guidance.\n" +
		"Branch context: " + ctx["economy"] + ". Typical income: " + ctx["typical_income"] + ".\n\n" +
		"Guidelines: be warm, clear, concise (2-3 paragraphs max). Reference only the data provided. " +
		"If asked outside banking/finance, politely redirect."
	if xai != nil {
		pred, _ := xai["prediction"].(string)
		prob, _ := xai["probability_creditworthy"].(float64)
		p += fmt.Sprintf("\nCustomer %s: prediction=%s, creditworthiness=%.1f%%.\n", customerID, pred, prob*100)
	} else {
		p += "\nNo credit data available for customer " + customerID + ".\n"
	}
	return p
}

func groqChat(system, message string) string {
	return groqChatWith(groqModel, system, message, 512)
}

// groqChatWith calls a specific Groq model — lets the copilot use a larger model
// than the customer chatbot.
func groqChatWith(model, system, message string, maxTokens int) string {
	if groqAPIKey == "" {
		return ""
	}
	body := map[string]interface{}{
		"model": model,
		"messages": []map[string]string{
			{"role": "system", "content": system},
			{"role": "user", "content": message},
		},
		"max_tokens":  maxTokens,
		"temperature": 0.4,
	}
	req, _ := http.NewRequest("POST", "https://api.groq.com/openai/v1/chat/completions",
		bytes.NewReader(mustJSON(body)))
	req.Header.Set("Authorization", "Bearer "+groqAPIKey)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	var result map[string]interface{}
	if json.NewDecoder(resp.Body).Decode(&result) != nil {
		return ""
	}
	choices, _ := result["choices"].([]interface{})
	if len(choices) == 0 {
		return ""
	}
	ch, _ := choices[0].(map[string]interface{})
	msg, _ := ch["message"].(map[string]interface{})
	content, _ := msg["content"].(string)
	return strings.TrimSpace(content)
}

func ruleBasedFallback(message string, xai map[string]interface{}, branchID, customerID string) string {
	ml := strings.ToLower(message)
	if strings.ContainsAny(ml, "why") || strings.Contains(ml, "reject") || strings.Contains(ml, "denied") {
		if xai == nil {
			return "I need your credit assessment data first. Please check your score on the dashboard."
		}
		pred, _ := xai["prediction"].(string)
		prob, _ := xai["probability_creditworthy"].(float64)
		return fmt.Sprintf("Your profile at %s was assessed as %s (creditworthiness: %.0f%%).",
			strings.Title(branchID), pred, prob*100)
	}
	if strings.Contains(ml, "score") || strings.Contains(ml, "credit") {
		if xai != nil {
			pred, _ := xai["prediction"].(string)
			prob, _ := xai["probability_creditworthy"].(float64)
			return fmt.Sprintf("Credit assessment at %s: %s (%.1f%% creditworthy).", strings.Title(branchID), pred, prob*100)
		}
		return "Please check your score on the dashboard first."
	}
	return "Hello! I am SecureScore AI for " + strings.Title(branchID) + " branch. Ask me about your credit score, loan eligibility, or how to improve!"
}

// ═══════════════════════════════════════════════════════════
//  BRANCH HANDLERS
// ═══════════════════════════════════════════════════════════

// buildRejectionReasons selects the top-3 negative SHAP features and returns human-readable reasons.
func buildRejectionReasons(resp map[string]interface{}, req map[string]interface{}) []map[string]string {
	type featureScore struct {
		name  string
		score float64
	}
	var candidates []featureScore

	// Try to read SHAP values from response
	if shap, ok := resp["shap_values"].(map[string]interface{}); ok {
		for feat, val := range shap {
			if v, ok := val.(float64); ok && v < 0 {
				if _, known := featureImpactLookup[feat]; known {
					candidates = append(candidates, featureScore{feat, v})
				}
			}
		}
	}

	// Fall back to heuristic from request fields if no SHAP
	if len(candidates) == 0 {
		heuristics := []struct {
			feat  string
			check func() bool
		}{
			{"debt_to_income", func() bool {
				v, _ := req["debt_to_income"].(float64)
				return v > 0.5
			}},
			{"employment_months", func() bool {
				v, _ := req["employment_months"].(float64)
				return v < 12
			}},
			{"existing_loans", func() bool {
				v, _ := req["existing_loans"].(float64)
				return v >= 3
			}},
			{"repayment_history_score", func() bool {
				v, _ := req["repayment_history_score"].(float64)
				return v < 0.6
			}},
			{"collateral_value", func() bool {
				loan, _ := req["loan_amount_requested"].(float64)
				col, _ := req["collateral_value"].(float64)
				return loan > 0 && col < loan*0.8
			}},
		}
		for _, h := range heuristics {
			if h.check() {
				candidates = append(candidates, featureScore{h.feat, -1.0})
			}
		}
	}

	// Sort most negative first
	for i := 0; i < len(candidates); i++ {
		for j := i + 1; j < len(candidates); j++ {
			if candidates[j].score < candidates[i].score {
				candidates[i], candidates[j] = candidates[j], candidates[i]
			}
		}
	}

	// Build top-3 reasons
	var reasons []map[string]string
	for i, c := range candidates {
		if i >= 3 {
			break
		}
		info := featureImpactLookup[c.name]
		reasons = append(reasons, map[string]string{
			"feature":     c.name,
			"impact":      info.Impact,
			"improvement": info.Improvement,
		})
	}

	if len(reasons) == 0 {
		reasons = []map[string]string{
			{"feature": "overall_risk", "impact": "Risk profile does not meet current lending criteria",
				"improvement": "Contact your branch manager for a detailed assessment"},
		}
	}
	return reasons
}

// ─── Branch DB-backed routes ──────────────────────────────

// ═══════════════════════════════════════════════════════════
//  HQ HANDLERS
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
//  SPEC V1 HANDLERS (forward to branch/hq spec services)
// ═══════════════════════════════════════════════════════════

func specBranchURL() string { return getEnv("BRANCH_SPEC_URL", "http://127.0.0.1:6050") }
func specHQURL() string     { return getEnv("HQ_SPEC_URL", "http://127.0.0.1:6051") }

func handleSpecScoring(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	var body map[string]interface{}
	c.ShouldBindJSON(&body)
	proxyRequest(c, "POST", specBranchURL()+"/api/v1/scoring", body, nil, nil)
}

func handleSpecGradientsUpload(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	var body map[string]interface{}
	c.ShouldBindJSON(&body)
	proxyRequest(c, "POST", specBranchURL()+"/api/v1/gradients/upload", body, nil, nil)
}

func handleSpecModelWeights(c *gin.Context) {
	proxyRequest(c, "GET", specBranchURL()+"/api/v1/models/weights", nil, nil, nil)
}

func handleSpecAggregate(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	proxyRequest(c, "POST", specHQURL()+"/api/v1/aggregate", nil, nil, nil)
}

func handleSpecHypernetworkPersonalize(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	proxyRequest(c, "POST", specHQURL()+"/api/v1/hypernetwork/personalize", nil, nil, nil)
}

func handleSpecVerifyBackground(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	var body map[string]interface{}
	c.ShouldBindJSON(&body)
	proxyRequest(c, "POST", specHQURL()+"/api/v1/verify/background", body, nil, nil)
}

func handleSpecVerifyResults(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	url := specHQURL() + "/api/v1/verify/results?branch_id=" + c.Query("branch_id") + "&limit=" + c.Query("limit")
	proxyRequest(c, "GET", url, nil, nil, nil)
}

// ═══════════════════════════════════════════════════════════
//  MFA HANDLERS (forward to HQ)
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
//  WEBHOOK HANDLERS
// ═══════════════════════════════════════════════════════════

// verifyWebhookSignature checks HMAC-SHA256 signature from X-Webhook-Signature header.
// Signature format: "sha256=<hex>". Returns false if WEBHOOK_SECRET is unset.
func verifyWebhookSignature(c *gin.Context, body []byte) bool {
	secret := os.Getenv("WEBHOOK_SECRET")
	if secret == "" {
		return false
	}
	sig := c.GetHeader("X-Webhook-Signature")
	if !strings.HasPrefix(sig, "sha256=") {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	expected := "sha256=" + hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(sig), []byte(expected))
}

// ═══════════════════════════════════════════════════════════
//  WEBSOCKET HANDLER
// ═══════════════════════════════════════════════════════════

func handleWebSocket(c *gin.Context) {
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	wsMu.Lock()
	wsConns = append(wsConns, conn)
	wsMu.Unlock()
	log.Printf("[WS] client connected (total: %d)", len(wsConns))
	defer func() {
		conn.Close()
		wsMu.Lock()
		var alive []*websocket.Conn
		for _, co := range wsConns {
			if co != conn {
				alive = append(alive, co)
			}
		}
		wsConns = alive
		wsMu.Unlock()
	}()
	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			break
		}
		if string(msg) == "ping" {
			conn.WriteJSON(map[string]string{"type": "pong", "ts": time.Now().UTC().Format(time.RFC3339)})
		}
	}
}

// ═══════════════════════════════════════════════════════════
//  BANKING HANDLERS
// ═══════════════════════════════════════════════════════════

var fdRates = map[int]float64{3: 6.5, 6: 7.0, 12: 8.0, 24: 8.5, 36: 9.0, 60: 9.5}

// ═══════════════════════════════════════════════════════════
//  CORE BANKING — ACCOUNT APPLICATIONS
// ═══════════════════════════════════════════════════════════

func handleMyApplications(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(200, gin.H{"applications": []interface{}{}})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	custID := coalesce(claims["customer_id"], claims["sub"])
	rows, err := db.Query(`SELECT id,account_type,purpose,initial_deposit,status,review_note,created_at,reviewed_at FROM account_applications WHERE customer_id=? ORDER BY created_at DESC`, custID)
	if err != nil {
		c.JSON(500, gin.H{"detail": err.Error()})
		return
	}
	defer rows.Close()
	var apps []map[string]interface{}
	for rows.Next() {
		var id int
		var accType, purpose, status sql.NullString
		var reviewNote, createdAt, reviewedAt sql.NullString
		var initDep sql.NullFloat64
		rows.Scan(&id, &accType, &purpose, &initDep, &status, &reviewNote, &createdAt, &reviewedAt)
		apps = append(apps, map[string]interface{}{
			"id": id, "account_type": accType.String, "purpose": purpose.String,
			"initial_deposit": initDep.Float64, "status": status.String,
			"review_note": reviewNote.String, "created_at": createdAt.String,
			"reviewed_at": reviewedAt.String,
		})
	}
	if apps == nil {
		apps = []map[string]interface{}{}
	}
	c.JSON(200, gin.H{"applications": apps, "total": len(apps)})
}

// ═══════════════════════════════════════════════════════════
//  CORE BANKING — STATEMENT
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
//  CORE BANKING — BRANCH CLIENT MANAGEMENT
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
//  MERKLE PROOF EXPORT — tamper-evident audit report
// ═══════════════════════════════════════════════════════════

// merkleAuditReport is the canonical signed report structure returned by the
// export endpoint. Every field is included in the HMAC signature so any
// alteration — even whitespace — invalidates it.
type merkleAuditReport struct {
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
	ReportSignature  string                   `json:"report_signature"`
}

type merkleAuditTransaction struct {
	Index          int               `json:"index"`
	Leaf           merkleTxnLeaf     `json:"leaf"`
	LeafHash       string            `json:"leaf_hash"`
	InclusionProof []merkleProofStep `json:"inclusion_proof"`
	ServerVerified bool              `json:"server_verified"`
}

// buildMerkleAuditHTML produces a printable HTML audit report.
func buildMerkleAuditHTML(r merkleAuditReport) string {
	var sb strings.Builder
	branchLabel := r.BranchID
	if branchLabel == "" {
		branchLabel = "All Branches (HQ)"
	}
	anchorRow := ""
	if r.AnchoredAt != "" {
		anchorRow = fmt.Sprintf(`<tr><td>Anchored At</td><td>%s</td></tr>`, r.AnchoredAt)
	}
	sb.WriteString(fmt.Sprintf(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8">
<title>SecureScore Merkle Audit Report — %s %s</title>
<style>
  body{font-family:monospace;margin:32px;color:#1a1a2e;background:#fff}
  h1{font-size:20px;border-bottom:3px solid #4f46e5;padding-bottom:8px}
  h2{font-size:14px;color:#4f46e5;margin-top:28px}
  table{border-collapse:collapse;width:100%%;font-size:12px;margin-top:8px}
  th{background:#4f46e5;color:#fff;padding:6px 10px;text-align:left}
  td{border:1px solid #d1d5db;padding:5px 10px;word-break:break-all}
  tr:nth-child(even) td{background:#f5f5ff}
  .root{font-size:11px;background:#f0fdf4;border:1px solid #86efac;padding:8px 12px;
        border-radius:4px;word-break:break-all;margin:8px 0}
  .sig{font-size:10px;background:#fefce8;border:1px solid #fde047;padding:8px 12px;
       border-radius:4px;word-break:break-all;margin:8px 0}
  .ok{color:#16a34a;font-weight:bold} .fail{color:#dc2626;font-weight:bold}
  @media print{body{margin:16px}}
</style>
</head>
<body>
<h1>SecureScore — Merkle Ledger Audit Report</h1>
<table>
  <tr><td><b>Branch</b></td><td>%s</td></tr>
  <tr><td><b>Date</b></td><td>%s</td></tr>
  <tr><td><b>Transactions</b></td><td>%d</td></tr>
  <tr><td><b>Algorithm</b></td><td>%s</td></tr>
  <tr><td><b>Generated At</b></td><td>%s</td></tr>
  <tr><td><b>Generated By</b></td><td>%s</td></tr>
  %s
</table>
<h2>Merkle Root</h2>
<div class="root">%s</div>
<h2>Report Integrity Signature (HMAC-SHA256)</h2>
<div class="sig">%s</div>
<h2>Transaction Ledger with Inclusion Proofs</h2>
<table>
  <tr>
    <th>#</th><th>Reference</th><th>Type</th><th>Amount (NPR)</th>
    <th>From</th><th>To</th><th>Status</th><th>Created At</th>
    <th>Leaf Hash (first 16)</th><th>Proof Steps</th><th>Verified</th>
  </tr>`,
		branchLabel, r.Date,
		branchLabel, r.Date, r.TransactionCount, r.Algorithm, r.GeneratedAt, r.GeneratedBy,
		anchorRow,
		r.MerkleRoot,
		r.ReportSignature,
	))

	for _, t := range r.Transactions {
		verifiedCell := `<span class="ok">✓ OK</span>`
		if !t.ServerVerified {
			verifiedCell = `<span class="fail">✗ FAIL</span>`
		}
		shortHash := t.LeafHash
		if len(shortHash) > 16 {
			shortHash = shortHash[:16] + "…"
		}
		sb.WriteString(fmt.Sprintf(`
  <tr>
    <td>%d</td>
    <td>%s</td>
    <td>%s</td>
    <td>%.2f</td>
    <td>%s</td>
    <td>%s</td>
    <td>%s</td>
    <td>%s</td>
    <td title="%s">%s</td>
    <td>%d</td>
    <td>%s</td>
  </tr>`,
			t.Index+1,
			t.Leaf.ReferenceNumber,
			t.Leaf.TransactionType,
			t.Leaf.Amount,
			t.Leaf.FromAccountNumber,
			t.Leaf.ToAccountNumber,
			t.Leaf.Status,
			t.Leaf.CreatedAt,
			t.LeafHash, shortHash,
			len(t.InclusionProof),
			verifiedCell,
		))
	}
	sb.WriteString(`
</table>
<p style="font-size:10px;color:#6b7280;margin-top:24px">
  This report was generated by the SecureScore BFF Gateway. The HMAC-SHA256
  signature covers all fields above it. Any modification — including to
  transaction amounts, hashes, or timestamps — will invalidate the signature.
  Verify offline: HMAC-SHA256(report_body_json, BFF_SECRET_KEY).
</p>
</body></html>`)
	return sb.String()
}

func handleFraudWorkerStatus(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	c.JSON(200, fraudWorkerStatus())
}

// ═══════════════════════════════════════════════════════════
//  CORE BANKING — EOD / BOD PROCESSES
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
//  HEALTH + ROOT
// ═══════════════════════════════════════════════════════════

func handleHealth(c *gin.Context) {
	dbOK := db != nil && db.Ping() == nil

	hqOK := false
	resp, err := httpClient.Get(hqURL + "/api/health")
	if err == nil {
		resp.Body.Close()
		hqOK = resp.StatusCode < 500
	}

	status := "ok"
	code := 200
	if !dbOK || !hqOK {
		status = "degraded"
		code = 503
	}

	c.JSON(code, gin.H{
		"status":  status,
		"version": "2.0.0",
		"role":    "bff_gateway_go",
		"db":      dbOK,
		"hq":      hqOK,
	})
}

func handleRoot(c *gin.Context) {
	c.JSON(200, gin.H{"service": "SecureScore BFF Gateway (Go)", "docs": "/docs"})
}

// ═══════════════════════════════════════════════════════════
//  DB INSERT HELPERS
// ═══════════════════════════════════════════════════════════

func dbInsertLoanDecision(branch string, req, resp map[string]interface{}) {
	if db == nil {
		return
	}
	reqJSON, _ := json.Marshal(req)
	respJSON, _ := json.Marshal(resp)
	defProb, _ := resp["default_probability"].(float64)
	riskGrade, _ := resp["risk_grade"].(string)
	sugRate, _ := resp["suggested_interest_rate"].(float64)
	maxLoan, _ := resp["recommended_max_loan_npr"].(float64)
	nrbC := 1
	if v, ok := resp["nrb_compliant"].(bool); ok && !v {
		nrbC = 0
	}
	custID, _ := req["customer_id"].(string)
	db.Exec(`INSERT INTO loan_decisions (branch,customer_id,request_payload,response_payload,default_probability,risk_grade,suggested_interest_rate,recommended_max_loan_npr,nrb_compliant)
		VALUES (?,?,?,?,?,?,?,?,?)`,
		branch, custID, string(reqJSON), string(respJSON), defProb, riskGrade, sugRate, maxLoan, nrbC)
}

func dbInsertFraudAlert(branch string, alert map[string]interface{}) {
	if db == nil {
		return
	}
	payload, _ := json.Marshal(alert)
	custID, _ := alert["customer_id"].(string)
	sev, _ := alert["severity"].(string)
	metric, _ := alert["metric"].(string)
	val, _ := alert["value"].(float64)
	zScore, _ := alert["z_score"].(float64)
	reason, _ := alert["reason"].(string)
	detAt, _ := alert["detected_at"].(string)
	if detAt == "" {
		detAt = time.Now().UTC().Format(time.RFC3339)
	}
	db.Exec(`INSERT INTO fraud_alert_events (branch,customer_id,detected_at,severity,metric,value,z_score,reason,source,payload)
		VALUES (?,?,?,?,?,?,?,?,'transaction_ingest',?)`,
		branch, custID, detAt, sev, metric, val, zScore, reason, string(payload))
}

// ═══════════════════════════════════════════════════════════
//  UTILITY
// ═══════════════════════════════════════════════════════════

func mustJSON(v interface{}) []byte {
	b, _ := json.Marshal(v)
	return b
}

func coalesce(vals ...interface{}) string {
	for _, v := range vals {
		if s, ok := v.(string); ok && s != "" {
			return s
		}
	}
	return ""
}

func safeLimit(s string, def int) int {
	n, err := strconv.Atoi(s)
	if err != nil || n < 1 {
		return def
	}
	if n > 500 {
		return 500
	}
	return n
}

func math_round(x float64, decimals int) float64 {
	factor := 1.0
	for i := 0; i < decimals; i++ {
		factor *= 10
	}
	return float64(int(x*factor+0.5)) / factor
}

func hashPassword(pw string) string {
	salt := hex.EncodeToString(randBytes(16))
	h := sha256.Sum256([]byte(salt + pw))
	return salt + "$" + hex.EncodeToString(h[:])
}

func verifyStoredPassword(pw, stored string) bool {
	parts := strings.SplitN(stored, "$", 2)
	if len(parts) != 2 {
		return false
	}
	h := sha256.Sum256([]byte(parts[0] + pw))
	return hex.EncodeToString(h[:]) == parts[1]
}

func randBytes(n int) []byte {
	b := make([]byte, n)
	if _, err := crand.Read(b); err != nil {
		log.Fatalf("crypto/rand unavailable: %v", err)
	}
	return b
}

// ═══════════════════════════════════════════════════════════
//  NEW FEATURE HANDLERS (ported from bff_gateway.py)
// ═══════════════════════════════════════════════════════════

// scoreLogit computes a sigmoid credit probability from raw feature values.
func scoreLogit(features map[string]float64) float64 {
	logit := -0.5
	for feat, w := range featureWeights {
		v, ok := features[feat]
		if !ok {
			v = featureBaselines[feat]
		}
		logit += w * v
	}
	if logit > 10 {
		logit = 10
	}
	if logit < -10 {
		logit = -10
	}
	return 1.0 / (1.0 + math.Exp(-logit))
}

func gradeFromScore(score float64) string {
	if score >= 0.80 {
		return "A"
	}
	if score >= 0.65 {
		return "B"
	}
	if score >= 0.50 {
		return "C"
	}
	if score >= 0.35 {
		return "D"
	}
	return "F"
}

// seedFeaturesFromCID generates a deterministic feature map seeded by customer ID.
func seedFeaturesFromCID(cid string) map[string]float64 {
	rng := rand.New(rand.NewSource(int64(stableHash(cid))))
	return map[string]float64{
		"annual_income":           float64(rng.Intn(1800000) + 200000),
		"debt_to_income":          0.15 + rng.Float64()*0.55,
		"employment_months":       float64(rng.Intn(114) + 6),
		"credit_history_months":   float64(rng.Intn(108) + 12),
		"existing_loans":          float64(rng.Intn(5)),
		"loan_amount_requested":   float64(rng.Intn(1900000) + 100000),
		"collateral_value":        float64(rng.Intn(3000000)),
		"repayment_history_score": float64(rng.Intn(60) + 40),
	}
}

// dpTotalBudget returns the configured total DP budget from env (default 10.0).
func dpTotalBudget() float64 {
	v, err := strconv.ParseFloat(getEnv("DP_TOTAL_BUDGET", "10.0"), 64)
	if err != nil {
		return 10.0
	}
	return v
}

// dpPerRoundEpsilon returns the per-round DP epsilon from env (default 1.0).
func dpPerRoundEpsilon() float64 {
	v, err := strconv.ParseFloat(getEnv("DP_EPSILON", "1.0"), 64)
	if err != nil {
		return 1.0
	}
	return v
}

// dpRecordRound writes a new ledger entry after a successful FL aggregation.
func dpRecordRound(roundNumber, branchesIncluded int, triggeredBy string) {
	eps := dpPerRoundEpsilon()
	clipNorm, _ := strconv.ParseFloat(getEnv("DP_CLIP_NORM", "1.0"), 64)
	db.Exec(
		`INSERT INTO dp_budget_ledger (round_number, epsilon_used, clip_norm, branches_included, triggered_by)
		 VALUES (?, ?, ?, ?, ?)`,
		roundNumber, eps, clipNorm, branchesIncluded, triggeredBy,
	)
}

type dpLedgerRow struct {
	Round       int     `json:"round"`
	Epsilon     float64 `json:"epsilon"`
	Cumulative  float64 `json:"cumulative"`
	Branches    int     `json:"branches"`
	NoiseStd    float64 `json:"noise_std"`
	TriggeredBy string  `json:"triggered_by"`
}

// dpReadLedger reads all rows from dp_budget_ledger ordered by round.
func dpReadLedger() ([]dpLedgerRow, float64) {
	rows, err := db.Query(
		`SELECT round_number, epsilon_used, clip_norm, branches_included, triggered_by
		 FROM dp_budget_ledger ORDER BY round_number ASC`,
	)
	if err != nil {
		return nil, 0
	}
	defer rows.Close()

	var entries []dpLedgerRow
	cumulative := 0.0
	for rows.Next() {
		var r dpLedgerRow
		var clipNorm float64
		rows.Scan(&r.Round, &r.Epsilon, &clipNorm, &r.Branches, &r.TriggeredBy)
		cumulative = math_round(cumulative+r.Epsilon, 6)
		r.Cumulative = cumulative
		r.NoiseStd = math_round(clipNorm/math.Sqrt(float64(r.Round)*r.Epsilon+0.001)*0.1, 4)
		entries = append(entries, r)
	}
	return entries, cumulative
}

// ═══════════════════════════════════════════════════════════
//  RESEARCH FEATURE HANDLERS — privacy attacks, benchmark, watermarking
// ═══════════════════════════════════════════════════════════

func copyFeats(in map[string]float64) map[string]float64 {
	out := make(map[string]float64, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

// ── Branch KYC Applications ───────────────────────────────────────────────────

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// ═══════════════════════════════════════════════════════════
//  WAVE 3 — New Feature Handlers
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════════
//  BATCH SCORING
// ═══════════════════════════════════════════════════════════

type batchScoreEntry struct {
	CustomerID string             `json:"customer_id"`
	Features   map[string]float64 `json:"features"`
}

type batchScoreReq struct {
	Customers []batchScoreEntry `json:"customers"`
}

type batchScoreResult struct {
	CustomerID string  `json:"customer_id"`
	Score      float64 `json:"score"`
	Percentile float64 `json:"percentile"`
	Decision   string  `json:"decision"`
	Tier       string  `json:"tier"`
	Error      string  `json:"error,omitempty"`
}

// scoreFromFeatures computes a 0–100 credit score from a feature map using
// the same linear model as handleCustomerWhatIf.
func scoreFromFeatures(features map[string]float64) float64 {
	score := 50.0
	for feat, weight := range featureWeights {
		if val, ok := features[feat]; ok {
			score += (val - featureBaselines[feat]) * weight
		}
	}
	if score < 0 {
		score = 0
	}
	if score > 100 {
		score = 100
	}
	return math.Round(score*100) / 100
}

// decisionFromScore maps a 0–100 score to (decision, tier) per shared/decision_logic.py thresholds.
func decisionFromScore(score float64) (string, string) {
	switch {
	case score >= 70:
		return "APPROVE", "LOW_RISK"
	case score >= 50:
		return "APPROVE", "MEDIUM_RISK"
	case score >= 30:
		return "MANUAL_REVIEW", "HIGH_RISK"
	default:
		return "REJECT", "VERY_HIGH_RISK"
	}
}

// ═══════════════════════════════════════════════════════════
//  GDPR / NRB RIGHT-TO-ERASURE (Compliance C-2)
// ═══════════════════════════════════════════════════════════

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// ═══════════════════════════════════════════════════════════

func main() {
	initConfig()
	initDB()
	go idsResetLoop()
	startFraudWorker()

	if dsn := getEnv("SENTRY_DSN", ""); dsn != "" {
		if err := sentry.Init(sentry.ClientOptions{
			Dsn:              dsn,
			Environment:      getEnv("APP_ENV", "production"),
			Release:          getEnv("GIT_SHA", "unknown"),
			TracesSampleRate: 0.1,
		}); err != nil {
			log.Printf("[WARN] Sentry init failed: %v", err)
		} else {
			defer sentry.Flush(2 * time.Second)
		}
	}

	port := "4000"
	for i, arg := range os.Args[1:] {
		if arg == "--port" && i+1 < len(os.Args[1:]) {
			port = os.Args[i+2]
		}
	}
	if p := getEnv("BFF_PORT", ""); p != "" {
		port = p
	}

	// Bridge HQ SSE events → WebSocket hub so all WS clients receive FL round events
	// including fairness_violation, round_complete, byzantine_detected, etc.
	go func() {
		for {
			func() {
				token := getHQToken()
				req, err := http.NewRequest("GET", hqURL+"/events/stream", nil)
				if err != nil {
					return
				}
				req.Header.Set("Authorization", "Bearer "+token)
				resp, err := httpClient.Do(req)
				if err != nil {
					return
				}
				defer resp.Body.Close()
				scanner := bufio.NewScanner(resp.Body)
				for scanner.Scan() {
					line := scanner.Text()
					if !strings.HasPrefix(line, "data:") {
						continue
					}
					raw := strings.TrimPrefix(line, "data:")
					raw = strings.TrimSpace(raw)
					var evt map[string]interface{}
					if err := json.Unmarshal([]byte(raw), &evt); err != nil {
						continue
					}
					evtType, _ := evt["type"].(string)
					if evtType != "" {
						wsBroadcast(evtType, evt["data"])
					}
				}
			}()
			time.Sleep(5 * time.Second) // reconnect delay
		}
	}()

	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Logger())
	r.Use(gin.Recovery())
	if getEnv("SENTRY_DSN", "") != "" {
		r.Use(sentrygin.New(sentrygin.Options{Repanic: true}))
	}
	r.Use(requestIDMiddleware())
	r.Use(corsMiddleware())
	r.Use(securityHeadersMiddleware())
	r.Use(maxBodyMiddleware())
	r.Use(idsMiddleware())
	r.Use(idempotencyMiddleware())

	// ── Health / root ──────────────────────────────────────
	r.GET("/api/health", handleHealth)
	r.GET("/", handleRoot)

	// ── Auth (no auth middleware needed) ───────────────────
	r.POST("/api/auth/login", handleLogin)
	r.POST("/api/auth/refresh", handleRefreshToken)
	r.POST("/api/auth/mfa/verify", handleMFAVerify)

	// ── Authenticated routes ───────────────────────────────
	auth := r.Group("/", authMiddleware())
	{
		registerRBACRoutes(auth)
		registerTellerRoutes(auth)
		registerMarketsRoutes(auth)
		registerConsoleRoutes(auth)
		registerForexRoutes(auth)
		registerApprovalRoutes(auth)
		registerCardControlRoutes(auth)
		registerNotificationRoutes(auth)

		auth.GET("/api/auth/me", handleGetMe)
		auth.POST("/api/auth/mfa/setup", handleMFASetup)
		auth.GET("/api/auth/mfa/status", handleMFAStatus)

		// Customer
		auth.GET("/api/customer/score", handleCustomerScore)
		auth.POST("/api/customer/explain", handleCustomerExplain)
		auth.POST("/api/customer/chat", handleCustomerChat)
		auth.POST("/api/customer/robo-advice", handleCustomerRoboAdvice)
		auth.GET("/api/customer/cashflow", handleCustomerCashflow)
		auth.GET("/api/customer/risk_profile", handleCustomerRiskProfile)
		auth.GET("/api/customer/cashflow_branch", handleCustomerCashflowBranch)

		// Branch (some require manager check inside handler)
		auth.GET("/api/branch/metrics", handleBranchMetrics)
		auth.GET("/api/branch/customers", handleBranchCustomers)
		auth.POST("/api/branch/explain", handleBranchExplain)
		auth.GET("/api/branch/fraud_alerts", handleBranchFraudAlerts)
		auth.GET("/api/branch/loan_decisions", handleBranchLoanDecisions)
		auth.GET("/api/branch/hq_fingerprints", handleBranchHQFingerprints)
		auth.GET("/api/branch/fraud_alerts/history", handleBranchFraudAlertHistory)
		auth.GET("/api/branch/data_drift", handleBranchDataDrift)
		auth.GET("/api/branch/ai_models_status", handleBranchAIModelsStatus)
		auth.GET("/api/branch/cash_demand", handleBranchCashDemand)
		auth.GET("/api/branch/cross_sell", handleBranchCrossSell)
		auth.POST("/api/branch/copilot", handleBranchCopilot)
		auth.GET("/api/branch/fraud_ml", handleBranchFraudML)
		auth.POST("/api/branch/fraud_ml/explain", handleBranchFraudMLExplain)
		auth.GET("/api/branch/aml_scan", handleBranchAMLScan)
		auth.GET("/api/branch/aml_sar/:customer_id", handleBranchAMLSar)
		auth.POST("/api/branch/loan_default", handleBranchLoanDefault)
		auth.GET("/api/branch/loan_portfolio", handleBranchLoanPortfolio)
		auth.POST("/api/branch/collateral_estimate", handleBranchCollateralEstimate)
		auth.POST("/api/branch/rate_optimizer", handleBranchRateOptimizer)
		auth.POST("/api/branch/remittance_analyze", handleBranchRemittanceAnalyze)
		auth.POST("/api/branch/hq_assess", handleBranchHQAssess)
		auth.POST("/api/branch/transaction", handleBranchTransaction)
		auth.GET("/api/branch/churn_summary", handleBranchChurnSummary)
		auth.GET("/api/branch/churn/:customer_id", handleBranchChurnCustomer)
		auth.GET("/api/branch/unified_risk/:customer_id", handleBranchUnifiedRisk)
		auth.GET("/api/branch/risk_distribution", handleBranchRiskDistribution)
		auth.GET("/api/branch/gnn_score", handleBranchGNNScore)
		auth.GET("/api/branch/topology_fingerprint", handleBranchTopologyFingerprint)
		auth.POST("/api/branch/adapt_drift", handleBranchAdaptDrift)
		auth.GET("/api/branch/mu_graphcoder_status", handleBranchMuStatus)

		// HQ
		auth.GET("/api/hq/status", handleHQStatus)
		auth.GET("/api/hq/health", handleHQHealth)
		auth.GET("/api/hq/round_history", handleHQRoundHistory)
		auth.GET("/api/hq/anomaly_log", handleHQAnomalyLog)
		auth.GET("/api/hq/audit_log", handleHQAuditLog)
		auth.GET("/api/hq/audit_verify", handleHQAuditVerify)
		auth.GET("/api/hq/loan_decisions", handleHQLoanDecisions)

		// General ledger (double-entry) — HQ admin
		auth.GET("/api/hq/gl/trial-balance", handleGLTrialBalance)
		auth.GET("/api/hq/gl/balance-sheet", handleGLBalanceSheet)
		auth.GET("/api/hq/gl/journal", handleGLJournal)

		// Transaction blockchain — HQ admin
		auth.GET("/api/hq/chain/blocks", handleChainBlocks)
		auth.POST("/api/hq/chain/seal", handleChainSeal)
		auth.GET("/api/hq/chain/verify", handleChainVerify)
		auth.GET("/api/hq/fingerprint_decisions", handleHQFingerprintDecisions)
		auth.GET("/api/hq/fraud_alerts", handleHQFraudAlerts)
		auth.GET("/api/hq/model_registry", handleHQModelRegistry)
		auth.POST("/api/hq/trigger_aggregation", handleHQTriggerAggregation)
		auth.GET("/api/hq/branches", handleHQBranches)
		auth.GET("/api/hq/mu_graphcoder/status", handleHQMuStatus)
		auth.GET("/api/hq/mu_graphcoder/report", handleHQMuReport)
		auth.POST("/api/hq/mu_graphcoder/trigger_training", handleHQMuTrigger)
		auth.GET("/api/hq/pi_devices", handleHQPiDevices)
		auth.GET("/api/hq/pi_devices/:branch", handleHQPiDevice)

		// HQ Security
		auth.GET("/api/hq/security/cert_status", handleHQCertStatus)
		auth.POST("/api/hq/security/cert_rotate", handleHQCertRotate)
		auth.GET("/api/hq/security/honeypot_log", handleHQHoneypotLog)
		auth.POST("/api/hq/security/audit_export", handleHQAuditExport)
		auth.GET("/api/hq/security/jwt_rotation_status", handleHQJWTRotationStatus)
		auth.POST("/api/hq/security/jwt_rotate_now", handleHQJWTRotateNow)
		auth.GET("/api/hq/security/active_bans", handleHQActiveBans)
		auth.GET("/api/hq/security/ids_log", handleHQIDSLog)
		auth.GET("/api/hq/security/threats", handleHQThreats)
		auth.GET("/api/hq/security/threats/:user_id", handleHQThreatUser)
		auth.GET("/api/hq/security/suspended", handleHQSuspended)
		auth.POST("/api/hq/security/suspend/:user_id", handleHQSuspendUser)
		auth.POST("/api/hq/security/unsuspend/:user_id", handleHQUnsuspendUser)
		auth.GET("/api/hq/security/threat_log", handleHQThreatLog)

		// Spec V1
		auth.POST("/api/v1/scoring", handleSpecScoring)
		auth.POST("/api/v1/gradients/upload", handleSpecGradientsUpload)
		auth.GET("/api/v1/models/weights", handleSpecModelWeights)
		auth.POST("/api/v1/aggregate", handleSpecAggregate)
		auth.POST("/api/v1/hypernetwork/personalize", handleSpecHypernetworkPersonalize)
		auth.POST("/api/v1/verify/background", handleSpecVerifyBackground)
		auth.GET("/api/v1/verify/results", handleSpecVerifyResults)

		// Banking — existing
		auth.GET("/api/banking/accounts", handleBankingAccounts)
		auth.GET("/api/banking/accounts/search", handleBankingAccountsSearch)
		auth.POST("/api/banking/transfer", handleBankingTransfer)
		auth.POST("/api/banking/cheque/scan", handleChequeScan)
		auth.POST("/api/banking/ocr/handwriting", handleHandwritingScan)
		auth.POST("/api/banking/cheque/deposit", handleChequeDeposit)
		auth.GET("/api/banking/transactions", handleBankingTransactions)
		auth.GET("/api/banking/profile", handleBankingProfile)
		auth.PATCH("/api/banking/profile", handleBankingProfileUpdate)
		auth.POST("/api/banking/change-password", handleBankingChangePassword)
		auth.POST("/api/banking/fd", handleBankingFDCreate)
		auth.GET("/api/banking/fd", handleBankingFDList)
		auth.DELETE("/api/banking/fd/:fd_number", handleBankingFDBreak)

		// Banking — loan servicing (disburse, schedule, repay)
		auth.POST("/api/banking/loans", handleLoanDisburse)
		auth.GET("/api/banking/loans", handleLoanList)
		auth.GET("/api/banking/loans/:loan_number", handleLoanDetail)
		auth.POST("/api/banking/loans/:loan_number/pay", handleLoanRepay)
		auth.POST("/api/banking/loans/:loan_number/prepay", handleLoanPrepay)
		auth.POST("/api/banking/loans/:loan_number/foreclose", handleLoanForeclose)

		// Banking — utility bill payments
		auth.POST("/api/banking/bill-pay", handleBillPay)

		// Banking — debit cards
		auth.GET("/api/banking/cards", handleCardList)
		auth.POST("/api/banking/cards", handleCardIssue)
		auth.POST("/api/banking/cards/:id/block", handleCardBlock)
		auth.POST("/api/banking/cards/:id/freeze", handleCardFreeze)
		auth.POST("/api/banking/cards/:id/unblock", handleCardUnblock)
		auth.POST("/api/banking/cards/:id/limit", handleCardLimit)

		// Banking — cheque-book requests (customer requests; branch advances)
		auth.GET("/api/banking/cheque-books", handleChequeBookList)
		auth.POST("/api/banking/cheque-books", handleChequeBookRequest)
		auth.GET("/api/branch/cheque-books", handleBranchChequeBookList)
		auth.POST("/api/branch/cheque-books/:id/advance", handleBranchChequeBookAdvance)

		// Banking — beneficiaries (saved payees)
		auth.GET("/api/banking/beneficiaries", handleBeneficiaryList)
		auth.POST("/api/banking/beneficiaries", handleBeneficiaryAdd)
		auth.DELETE("/api/banking/beneficiaries/:id", handleBeneficiaryDelete)

		// Banking — standing instructions (recurring auto-pay; run by BOD)
		auth.GET("/api/banking/standing-instructions", handleStandingList)
		auth.POST("/api/banking/standing-instructions", handleStandingCreate)
		auth.DELETE("/api/banking/standing-instructions/:id", handleStandingCancel)
		auth.GET("/api/banking/security-audit", handleBankingSecurityAudit)
		auth.GET("/api/banking/audit/merkle-proof", handleBankingMerkleProof)
		auth.GET("/api/banking/audit/merkle-proof/export", handleBankingMerkleProofExport)
		auth.POST("/api/banking/audit/merkle-anchor", handleBankingMerkleAnchorCreate)
		auth.GET("/api/banking/audit/merkle-anchors", handleBankingMerkleAnchors)

		// Banking — new: account applications (customer side)
		auth.POST("/api/banking/account-application", handleApplyAccount)
		auth.GET("/api/banking/account-applications", handleMyApplications)

		// Banking — statement
		auth.GET("/api/banking/statement", handleBankingStatement)

		// Banking — EOD/BOD
		auth.GET("/api/banking/eod/preview", handleEODPreview)
		auth.POST("/api/banking/eod", handleRunEOD)
		auth.POST("/api/banking/bod", handleRunBOD)
		auth.GET("/api/banking/eod/logs", handleEODLogs)

		// Branch — core banking management
		auth.GET("/api/branch/banking/summary", handleBranchBankingSummary)
		auth.GET("/api/branch/fraud-worker/status", handleFraudWorkerStatus)
		auth.GET("/api/branch/banking/accounts", handleBranchAllAccounts)
		auth.GET("/api/branch/banking/fd", handleBranchAllFDs)
		auth.GET("/api/branch/account-applications", handleBranchGetApplications)
		auth.POST("/api/branch/account-applications/:id/approve", handleBranchApproveApplication)
		auth.POST("/api/branch/account-applications/:id/reject", handleBranchRejectApplication)
		auth.GET("/api/branch/clients", handleBranchClients)
		auth.GET("/api/branch/clients/:customer_id", handleBranchClientDetail)
		auth.POST("/api/branch/clients/:customer_id/verify-kyc", handleBranchVerifyKYC)

		// New feature routes
		auth.GET("/api/hq/events/stream", handleHQEventsStream)
		auth.POST("/api/hq/byzantine_demo", handleHQByzantineDemo)
		auth.GET("/api/customer/score_explanation", handleCustomerScoreExplanation)
		auth.POST("/api/customer/whatif", handleCustomerWhatIf)
		auth.GET("/api/customer/score_history", handleCustomerScoreHistory)
		auth.GET("/api/hq/compliance_report", handleHQComplianceReport)
		auth.GET("/api/hq/branch_contributions", handleHQBranchContributions)
		auth.POST("/api/hq/stress_test", handleHQStressTest)
		auth.GET("/api/hq/privacy_budget", handleHQPrivacyBudget)
		auth.POST("/api/customer/kyc_submit", handleCustomerKYCSubmit)
		auth.GET("/api/branch/aml_network", handleBranchAMLNetwork)

		// New feature routes — batch 2
		auth.GET("/api/customer/counterfactual", handleCustomerCounterfactual)
		auth.GET("/api/hq/fairness_audit", handleHQFairnessAudit)
		auth.GET("/api/hq/convergence", handleHQConvergence)
		auth.POST("/api/hq/fl_simulate", handleHQFLSimulator)
		auth.GET("/api/hq/model_drift", handleHQModelDrift)
		auth.POST("/api/customer/loan_apply", handleCustomerLoanApply)
		auth.GET("/api/customer/loan_history", handleCustomerLoanHistory)
		auth.GET("/api/hq/network_topology", handleHQNetworkTopology)
		auth.GET("/api/hq/he_demo", handleHQHEDemo)
		auth.POST("/api/customer/kyc_ai_verify", handleCustomerKYCAIVerify)
		auth.POST("/api/customer/kyc_update_ai", handleCustomerKYCUpdateAI)
		auth.POST("/api/customer/kyc_face_verify", handleCustomerKYCFaceVerify)
		auth.GET("/api/branch/kyc_applications", handleBranchKYCApplications)
		auth.POST("/api/branch/kyc_review/:id", handleBranchKYCReview)

		// Research feature routes
		auth.POST("/api/hq/privacy/gradient_inversion", handleHQPrivacyGradientInversion)
		auth.POST("/api/hq/privacy/membership_inference", handleHQPrivacyMembershipInference)
		auth.POST("/api/hq/privacy/model_inversion", handleHQPrivacyModelInversion)
		auth.GET("/api/hq/federated_benchmark", handleHQFederatedBenchmark)
		auth.POST("/api/hq/security/watermark_embed", handleHQWatermarkEmbed)
		auth.POST("/api/hq/security/watermark_verify", handleHQWatermarkVerify)
		auth.GET("/api/hq/security/watermark_status", handleHQWatermarkStatus)

		// Wave 3 — new features
		auth.GET("/api/customer/health_score", handleCustomerHealthScore)
		auth.GET("/api/customer/loan_eligibility", handleCustomerLoanEligibility)
		auth.GET("/api/customer/spending_analytics", handleCustomerSpendingAnalytics)
		auth.GET("/api/branch/par", handleBranchPAR)
		auth.POST("/api/branch/generate_sar", handleBranchGenerateSAR)
		auth.GET("/api/hq/branch_leaderboard", handleHQBranchLeaderboard)
		auth.GET("/api/hq/branch_explainability", handleHQBranchExplainability)
		auth.GET("/api/hq/split_learning", handleHQSplitLearning)
		auth.GET("/api/hq/zkp_demo", handleHQZKPDemo)
		auth.GET("/api/branch/fraud_stream", handleBranchFraudStream)

		// Batch scoring
		auth.POST("/api/branch/score/batch", handleBranchBatchScore)

		// GDPR / NRB right-to-erasure (admin only, enforced inside handler)
		auth.DELETE("/api/admin/customer/:customer_id/erasure", handleAdminCustomerErasure)
	}

	// ── Webhooks (no auth — edge/HQ POST here) ─────────────
	r.POST("/api/webhook/fraud_alert", handleWebhookFraudAlert)
	r.POST("/api/webhook/aggregation", handleWebhookAggregation)
	r.POST("/api/webhook/weight_submitted", handleWebhookWeightSubmitted)

	// ── WebSocket ──────────────────────────────────────────
	r.GET("/ws/events", handleWebSocket)

	// ── Graceful shutdown (O-7) ────────────────────────────
	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		log.Printf("SecureScore BFF Gateway (Go) starting on :%s", port)
		log.Printf("HQ URL: %s", hqURL)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("[BFF] Shutdown signal received — draining in-flight requests (30s timeout)...")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("[BFF] Forced shutdown: %v", err)
	}
	log.Println("[BFF] Server exited cleanly")
}
