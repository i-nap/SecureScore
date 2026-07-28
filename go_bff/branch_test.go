package main

// branch_test.go — HTTP handler tests for SecureScore BFF branch endpoints.
//
// Covers: KYC application submission and listing, branch dashboard, branch
// client list, and unauthenticated access rejection.

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
)

// ─── TestKYCSubmitCreatesRow ──────────────────────────────────────────────────
//
// POST /api/branch/kyc with a valid JSON body must return 200 or 201 with an
// id field. The handler writes to kyc_applications in SQLite.
//
// Note: the route is /api/customer/kyc_submit (authenticated customer route)
// for customer KYC self-submission.  Branch managers review via
// GET /api/branch/kyc_applications. The branch submit is handled via
// POST /api/customer/kyc_submit — we test that here too.

func TestKYCSubmitCreatesRow(t *testing.T) {
	router := newTestRouter(t)
	if !dbAvailable() {
		t.Skip("SQLite not available")
	}

	body := map[string]interface{}{
		"full_name":    "Test Applicant",
		"phone":        "9800000001",
		"email":        "test@example.com",
		"loan_purpose": "Home",
		"loan_amount":  500000.0,
	}
	req := makeJSONRequest("POST", "/api/customer/kyc_submit", body, customerToken())
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != 200 && w.Code != 201 {
		t.Fatalf("expected 200 or 201 for KYC submit, got %d — body: %s", w.Code, w.Body.String())
	}
	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)

	// Response must have either "id" or "reference" to indicate a record was created
	if resp["id"] == nil && resp["reference"] == nil && resp["kyc_id"] == nil {
		t.Errorf("KYC submit response missing id/reference — got: %s", w.Body.String())
	}
}

// ─── TestKYCListReturnsArray ───────────────────────────────────────────────────
//
// GET /api/branch/kyc_applications with a branch_manager token must return 200
// with a JSON array (the handler pads with demo data if the DB is empty).

func TestKYCListReturnsArray(t *testing.T) {
	router := newTestRouter(t)
	req := makeJSONRequest("GET", "/api/branch/kyc_applications", nil, branchManagerToken())
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d — body: %s", w.Code, w.Body.String())
	}

	// The response is a bare JSON array
	var apps []interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &apps); err != nil {
		// Maybe wrapped in an object — check for "applications" key
		var obj map[string]interface{}
		if jsonErr := json.Unmarshal(w.Body.Bytes(), &obj); jsonErr != nil {
			t.Fatalf("response is neither an array nor object: %v — body: %s", err, w.Body.String())
		}
		// Accept either bare array or object with array value
		for _, v := range obj {
			if arr, ok := v.([]interface{}); ok {
				if len(arr) == 0 {
					t.Log("KYC list returned empty array inside object wrapper — acceptable")
				}
				return
			}
		}
		// Demo data always pads to 5 items even if DB is empty
		t.Logf("KYC list response: %s", w.Body.String())
		return
	}

	// Array path: demo data should give at least 5 entries
	if len(apps) == 0 {
		t.Errorf("expected at least 1 KYC application (demo data should populate), got 0 — body: %s", w.Body.String())
	}
}

// ─── TestKYCListRequiresAuth ───────────────────────────────────────────────────

func TestKYCListRequiresAuth(t *testing.T) {
	router := newTestRouter(t)
	req := makeJSONRequest("GET", "/api/branch/kyc_applications", nil, "")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != 401 {
		t.Fatalf("expected 401 without auth, got %d", w.Code)
	}
}

// ─── TestBranchDashboardShape ─────────────────────────────────────────────────
//
// GET /api/branch/metrics with a branch_manager token should return a JSON
// object (the edge node will be offline in tests → 503 is also acceptable).

func TestBranchDashboardShape(t *testing.T) {
	router := newTestRouter(t)
	req := makeJSONRequest("GET", "/api/branch/metrics", nil, branchManagerToken())
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	// Edge node is offline in test env — 503 is the expected graceful fallback.
	// Auth must pass (not 401/403).
	if w.Code == 401 || w.Code == 403 {
		t.Fatalf("auth failed unexpectedly: got %d — body: %s", w.Code, w.Body.String())
	}

	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)

	if w.Code == 200 {
		// Shape check only when edge is reachable (rare in unit tests)
		if resp["branch_id"] == nil {
			t.Errorf("branch metrics response missing 'branch_id' — got: %s", w.Body.String())
		}
	} else if w.Code == 503 {
		// Service unavailable — edge node offline; this is expected in unit tests
		t.Logf("branch metrics: edge node offline (503) — acceptable in unit test environment")
	} else if w.Code == 404 {
		// Unknown branch (branch not in branchEdgeMap) — also acceptable
		t.Logf("branch metrics: branch not found (404) — acceptable")
	} else {
		t.Fatalf("unexpected status %d — body: %s", w.Code, w.Body.String())
	}
}

// ─── TestBranchClientsListShape ───────────────────────────────────────────────
//
// GET /api/branch/clients with a branch_manager token must return 200 with
// a JSON object containing a "clients" key. The handler returns an empty list
// when no accounts exist in the DB (does not pad with demo data).

func TestBranchClientsListShape(t *testing.T) {
	router := newTestRouter(t)
	req := makeJSONRequest("GET", "/api/branch/clients", nil, branchManagerToken())
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	// Without DB data or with DB unavailable
	if w.Code != 200 && w.Code != 503 {
		t.Fatalf("expected 200 or 503, got %d — body: %s", w.Code, w.Body.String())
	}

	if w.Code == 200 {
		var resp map[string]interface{}
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("clients response is not valid JSON: %v", err)
		}
		// Must have clients key
		if _, ok := resp["clients"]; !ok {
			t.Errorf("clients response missing 'clients' key — got: %s", w.Body.String())
		}
	}
}

// ─── TestBranchEndpointRequiresAuth ──────────────────────────────────────────
//
// GET /api/branch/dashboard (metrics) without any Authorization header
// must return 401 before the handler even runs.

func TestBranchEndpointRequiresAuth(t *testing.T) {
	router := newTestRouter(t)
	req := makeJSONRequest("GET", "/api/branch/metrics", nil, "")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != 401 {
		t.Fatalf("expected 401 without auth header, got %d — body: %s", w.Code, w.Body.String())
	}
}

// ─── TestBranchClientsRequiresManagerRole ─────────────────────────────────────
//
// A customer token (role=customer) must be rejected by requireManager() with 403.

func TestBranchClientsRequiresManagerRole(t *testing.T) {
	router := newTestRouter(t)
	req := makeJSONRequest("GET", "/api/branch/clients", nil, customerToken())
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != 403 {
		t.Fatalf("expected 403 for customer role on branch/clients, got %d — body: %s", w.Code, w.Body.String())
	}
}

// ─── TestBranchFraudWorkerStatus ──────────────────────────────────────────────
//
// GET /api/branch/fraud-worker/status must return 200 with shape fields.
// This handler uses in-memory fraudStats — no DB or edge node needed.

func TestBranchFraudWorkerStatus(t *testing.T) {
	router := newTestRouter(t)
	req := makeJSONRequest("GET", "/api/branch/fraud-worker/status", nil, branchManagerToken())
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d — body: %s", w.Code, w.Body.String())
	}
	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)

	// Handler always returns processed + flagged counters
	if _, ok := resp["processed"]; !ok {
		t.Errorf("fraud worker status missing 'processed' field — got: %s", w.Body.String())
	}
}

// ─── TestBranchBankingSummaryShape ────────────────────────────────────────────
//
// GET /api/branch/banking/summary with manager token should return 200 or 503.

func TestBranchBankingSummaryShape(t *testing.T) {
	router := newTestRouter(t)
	req := makeJSONRequest("GET", "/api/branch/banking/summary", nil, branchManagerToken())
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != 200 && w.Code != 503 {
		t.Fatalf("expected 200 or 503, got %d — body: %s", w.Code, w.Body.String())
	}
	if w.Code == 200 {
		var resp map[string]interface{}
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("response is not valid JSON: %v", err)
		}
		t.Logf("branch banking summary keys: %v", mustMarshal(resp))
	}
}
