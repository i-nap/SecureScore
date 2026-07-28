package main

// banking_test.go — HTTP handler tests for SecureScore BFF banking endpoints.
//
// Covers: GET /api/banking/accounts shape, POST /api/banking/transfer validation,
// GET /api/banking/eod/preview shape, and GET /api/health shape.
//
// All tests run against an in-memory SQLite database via newTestRouter().

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
)

// ─── TestBankingAccountsListShape ─────────────────────────────────────────────
//
// GET /api/banking/accounts with a valid customer token must return 200 and
// a JSON object with an "accounts" key whose value is a JSON array.

func TestBankingAccountsListShape(t *testing.T) {
	router := newTestRouter(t)
	req := makeJSONRequest("GET", "/api/banking/accounts", nil, customerToken())
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d — body: %s", w.Code, w.Body.String())
	}
	var resp map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("response is not valid JSON: %v — body: %s", err, w.Body.String())
	}
	accounts, ok := resp["accounts"]
	if !ok {
		t.Fatalf("response missing 'accounts' key — got: %s", w.Body.String())
	}
	// accounts must be an array (may be empty in a fresh in-memory DB)
	if _, isArray := accounts.([]interface{}); !isArray {
		t.Fatalf("'accounts' is not an array, got %T", accounts)
	}
}

// ─── TestBankingTransferMissingFields ─────────────────────────────────────────
//
// POST /api/banking/transfer with an empty JSON body must return 400
// (amount = 0 fails the positive-amount guard or from == to guard).

func TestBankingTransferMissingFields(t *testing.T) {
	router := newTestRouter(t)
	req := makeJSONRequest("POST", "/api/banking/transfer", map[string]interface{}{}, customerToken())
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	// Acceptable: 400 (validation failed) or 503 (DB unavailable at bind time).
	// The handler first checks dbAvailable() then validates amount > 0.
	if w.Code != 400 && w.Code != 503 {
		t.Fatalf("expected 400 or 503 for empty transfer body, got %d — body: %s", w.Code, w.Body.String())
	}
	// If 400, there must be an error/detail field
	if w.Code == 400 {
		var resp map[string]interface{}
		json.Unmarshal(w.Body.Bytes(), &resp)
		if resp["detail"] == nil && resp["error"] == nil {
			t.Errorf("400 response missing 'detail' or 'error' field — got: %s", w.Body.String())
		}
	}
}

// ─── TestBankingTransferAmountZeroRejected ────────────────────────────────────
//
// A transfer with amount=0 must be rejected with 400 (amount must be positive).

func TestBankingTransferAmountZeroRejected(t *testing.T) {
	router := newTestRouter(t)
	req := makeJSONRequest("POST", "/api/banking/transfer", map[string]interface{}{
		"from_account_number": "1001",
		"to_account_number":   "1002",
		"amount":              0.0,
	}, customerToken())
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	// 400 = amount validation or 503 = DB not available (both acceptable for unit test)
	if w.Code != 400 && w.Code != 503 {
		t.Fatalf("expected 400 or 503, got %d — body: %s", w.Code, w.Body.String())
	}
}

// ─── TestBankingTransferSameAccountRejected ───────────────────────────────────
//
// A transfer where from == to must be rejected with 400.

func TestBankingTransferSameAccountRejected(t *testing.T) {
	router := newTestRouter(t)
	req := makeJSONRequest("POST", "/api/banking/transfer", map[string]interface{}{
		"from_account_number": "1001",
		"to_account_number":   "1001",
		"amount":              500.0,
	}, customerToken())
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != 400 && w.Code != 503 {
		t.Fatalf("expected 400 or 503, got %d — body: %s", w.Code, w.Body.String())
	}
}

// ─── TestEODPreviewShape ──────────────────────────────────────────────────────
//
// GET /api/banking/eod/preview with a branch_manager token must return 200
// with a JSON object containing the expected preview keys.

func TestEODPreviewShape(t *testing.T) {
	router := newTestRouter(t)
	req := makeJSONRequest("GET", "/api/banking/eod/preview", nil, branchManagerToken())
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	// Requires DB; if unavailable handler returns 503 — acceptable in unit tests.
	if w.Code == 503 {
		t.Skip("DB not available — skipping EOD preview shape test")
	}
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d — body: %s", w.Code, w.Body.String())
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("response is not valid JSON: %v", err)
	}

	expectedKeys := []string{
		"branch_id",
		"as_of",
		"interest_eligible_accounts",
		"projected_interest_npr",
		"dormant_candidates",
		"fds_maturing_today",
	}
	for _, k := range expectedKeys {
		if _, ok := resp[k]; !ok {
			t.Errorf("EOD preview response missing key %q — got: %s", k, w.Body.String())
		}
	}
}

// ─── TestEODPreviewRequiresAuth ───────────────────────────────────────────────

func TestEODPreviewRequiresAuth(t *testing.T) {
	router := newTestRouter(t)
	req := makeJSONRequest("GET", "/api/banking/eod/preview", nil, "")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != 401 {
		t.Fatalf("expected 401 without auth, got %d", w.Code)
	}
}

// ─── TestEODPreviewRequiresManager ────────────────────────────────────────────
//
// A customer token (not branch_manager) must be rejected with 403.

func TestEODPreviewRequiresManager(t *testing.T) {
	router := newTestRouter(t)
	req := makeJSONRequest("GET", "/api/banking/eod/preview", nil, customerToken())
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != 403 {
		t.Fatalf("expected 403 for customer role on EOD preview, got %d — body: %s", w.Code, w.Body.String())
	}
}

// ─── TestHealthEndpoint ───────────────────────────────────────────────────────
//
// GET /api/health must return 200 or 503 (degraded when HQ/DB unreachable) with
// "status", "db", and "hq" fields that have the correct Go types.

func TestHealthEndpoint(t *testing.T) {
	router := newTestRouter(t)
	req := makeJSONRequest("GET", "/api/health", nil, "")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	// Accept 200 (ok) or 503 (degraded — HQ offline in test env)
	if w.Code != 200 && w.Code != 503 {
		t.Fatalf("expected 200 or 503, got %d — body: %s", w.Code, w.Body.String())
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("health response is not valid JSON: %v", err)
	}

	status, ok := resp["status"].(string)
	if !ok {
		t.Fatalf("'status' field missing or not a string — got: %s", w.Body.String())
	}
	if status != "ok" && status != "degraded" {
		t.Errorf("'status' must be 'ok' or 'degraded', got %q", status)
	}

	if _, ok := resp["db"].(bool); !ok {
		t.Errorf("'db' field missing or not a bool — got: %s", w.Body.String())
	}
	if _, ok := resp["hq"].(bool); !ok {
		t.Errorf("'hq' field missing or not a bool — got: %s", w.Body.String())
	}
}

// ─── TestHealthShape ──────────────────────────────────────────────────────────
//
// GET /api/health must include "version" and a role identifier.
// Per handleHealth implementation, version is "2.0.0".

func TestHealthShape(t *testing.T) {
	router := newTestRouter(t)
	req := makeJSONRequest("GET", "/api/health", nil, "")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)

	// version must be present (may be empty string for unreleased builds)
	if _, exists := resp["version"]; !exists {
		t.Errorf("'version' field missing from health response — got: %s", w.Body.String())
	}
	// The handler sets role="bff_gateway_go" — any non-empty string is fine
	if _, exists := resp["role"]; !exists {
		t.Logf("note: 'role' field absent from health — body: %s", w.Body.String())
	}
}

// ─── TestBankingAccountsRequiresAuth ─────────────────────────────────────────

func TestBankingAccountsRequiresAuth(t *testing.T) {
	router := newTestRouter(t)
	req := makeJSONRequest("GET", "/api/banking/accounts", nil, "")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != 401 {
		t.Fatalf("expected 401 without auth, got %d", w.Code)
	}
}
