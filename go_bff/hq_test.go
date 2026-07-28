package main

// hq_test.go — HTTP handler tests for SecureScore BFF HQ admin endpoints.
//
// Covers: GET /api/hq/branches shape, GET /api/hq/privacy_budget shape,
// POST /api/hq/trigger_aggregation role guard, GET /api/hq/audit_log shape,
// unauthenticated access rejection, and webhook HMAC verification.

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"os"
	"testing"

	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
)

// ─── TestHQBranchesShape ──────────────────────────────────────────────────────
//
// GET /api/hq/branches with an admin token proxies to HQ /api/status.
// In unit tests HQ is offline → 503 is the expected graceful fallback.
// If somehow reachable, verify the returned value is a JSON array.

func TestHQBranchesShape(t *testing.T) {
	router := newTestRouter(t)
	req := makeJSONRequest("GET", "/api/hq/branches", nil, adminToken())
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	// Auth must pass
	if w.Code == 401 || w.Code == 403 {
		t.Fatalf("auth failed unexpectedly: %d — body: %s", w.Code, w.Body.String())
	}

	if w.Code == 200 {
		// If HQ is reachable verify array shape
		var branches []interface{}
		if err := json.Unmarshal(w.Body.Bytes(), &branches); err != nil {
			var obj map[string]interface{}
			if jsonErr := json.Unmarshal(w.Body.Bytes(), &obj); jsonErr != nil {
				t.Fatalf("branches response is not valid JSON: %v", err)
			}
			t.Logf("HQ branches wrapped in object: %s", w.Body.String())
		} else {
			t.Logf("HQ branches count: %d", len(branches))
		}
	} else if w.Code == 503 || w.Code == 502 {
		t.Logf("HQ offline (expected in unit test environment): %d", w.Code)
	} else {
		t.Fatalf("unexpected status %d — body: %s", w.Code, w.Body.String())
	}
}

// ─── TestHQPrivacyBudgetShape ─────────────────────────────────────────────────
//
// GET /api/hq/privacy_budget must return 200 with required numeric fields.
// This handler reads from the local SQLite dp_budget_ledger — no HQ proxy.

func TestHQPrivacyBudgetShape(t *testing.T) {
	router := newTestRouter(t)
	req := makeJSONRequest("GET", "/api/hq/privacy_budget", nil, adminToken())
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d — body: %s", w.Code, w.Body.String())
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("privacy_budget response is not valid JSON: %v", err)
	}

	// Required fields per handleHQPrivacyBudget implementation
	requiredFields := []string{
		"total_budget",
		"epsilon_remaining",
		"epsilon_consumed",
		"status",
		"per_round_epsilon",
	}
	for _, f := range requiredFields {
		if _, ok := resp[f]; !ok {
			t.Errorf("privacy_budget response missing field %q — got: %s", f, w.Body.String())
		}
	}

	if tb, ok := resp["total_budget"].(float64); !ok || tb < 0 {
		t.Errorf("total_budget is not a positive number — got: %v", resp["total_budget"])
	}
}

// ─── TestHQPrivacyBudgetRemainingIsNumeric ────────────────────────────────────

func TestHQPrivacyBudgetRemainingIsNumeric(t *testing.T) {
	router := newTestRouter(t)
	req := makeJSONRequest("GET", "/api/hq/privacy_budget", nil, adminToken())
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)

	remaining, ok := resp["epsilon_remaining"].(float64)
	if !ok {
		t.Fatalf("epsilon_remaining is not a float64 — got %T (%v)", resp["epsilon_remaining"], resp["epsilon_remaining"])
	}
	if remaining < 0 {
		t.Errorf("epsilon_remaining must be >= 0, got %.6f", remaining)
	}
}

// ─── TestHQTriggerRequiresAdminRole ───────────────────────────────────────────
//
// POST /api/hq/trigger_aggregation with a branch_manager token must be
// rejected with 403 by requireAdmin().

func TestHQTriggerRequiresAdminRole(t *testing.T) {
	router := newTestRouter(t)
	req := makeJSONRequest("POST", "/api/hq/trigger_aggregation", map[string]interface{}{}, branchManagerToken())
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != 403 {
		t.Fatalf("expected 403 for branch_manager on trigger_aggregation, got %d — body: %s", w.Code, w.Body.String())
	}
}

// ─── TestHQTriggerRequiresAuthAtAll ───────────────────────────────────────────

func TestHQTriggerRequiresAuthAtAll(t *testing.T) {
	router := newTestRouter(t)
	req := makeJSONRequest("POST", "/api/hq/trigger_aggregation", nil, "")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != 401 {
		t.Fatalf("expected 401 without auth, got %d", w.Code)
	}
}

// ─── TestHQAuditLogShape ──────────────────────────────────────────────────────
//
// GET /api/hq/audit_log requires admin role and proxies to HQ.
// HQ offline in unit tests → 503 is acceptable.

func TestHQAuditLogShape(t *testing.T) {
	router := newTestRouter(t)
	req := makeJSONRequest("GET", "/api/hq/audit_log", nil, adminToken())
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	// Auth must succeed
	if w.Code == 401 || w.Code == 403 {
		t.Fatalf("auth/role check failed unexpectedly: %d — body: %s", w.Code, w.Body.String())
	}
	if w.Code != 200 && w.Code != 503 && w.Code != 502 {
		t.Fatalf("unexpected status %d — body: %s", w.Code, w.Body.String())
	}
}

// ─── TestHQAuditLogRequiresAdminRole ─────────────────────────────────────────

func TestHQAuditLogRequiresAdminRole(t *testing.T) {
	router := newTestRouter(t)
	req := makeJSONRequest("GET", "/api/hq/audit_log", nil, branchManagerToken())
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != 403 {
		t.Fatalf("expected 403 for branch_manager on audit_log, got %d — body: %s", w.Code, w.Body.String())
	}
}

// ─── TestHQEndpointRequiresAuth ───────────────────────────────────────────────

func TestHQEndpointRequiresAuth(t *testing.T) {
	router := newTestRouter(t)
	req := makeJSONRequest("GET", "/api/hq/privacy_budget", nil, "")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != 401 {
		t.Fatalf("expected 401 without auth on /api/hq/privacy_budget, got %d", w.Code)
	}
}

// ─── TestWebhookWithoutHMACReturns403 ─────────────────────────────────────────
//
// POST /api/webhook/fraud_alert without a valid X-Webhook-Signature header
// must return 403. This is true regardless of whether WEBHOOK_SECRET is set:
// - If set: missing/invalid sig → 403
// - If unset: verifyWebhookSignature returns false → 403

func TestWebhookWithoutHMACReturns403(t *testing.T) {
	os.Setenv("WEBHOOK_SECRET", "test-webhook-secret-abc123")
	t.Cleanup(func() { os.Unsetenv("WEBHOOK_SECRET") })

	router := newTestRouter(t)
	body := bytes.NewBufferString(`{"branch":"kathmandu","severity":"high"}`)
	req := httptest.NewRequest("POST", "/api/webhook/fraud_alert", body)
	req.Header.Set("Content-Type", "application/json")
	// Deliberately NO X-Webhook-Signature header

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != 403 {
		t.Fatalf("expected 403 without HMAC signature, got %d — body: %s", w.Code, w.Body.String())
	}
}

// ─── TestWebhookWithValidHMACReturns200 ───────────────────────────────────────
//
// POST /api/webhook/fraud_alert with a correctly computed HMAC-SHA256
// signature must return 200.

func TestWebhookWithValidHMACReturns200(t *testing.T) {
	webhookSecret := "test-webhook-secret-abc123"
	os.Setenv("WEBHOOK_SECRET", webhookSecret)
	t.Cleanup(func() { os.Unsetenv("WEBHOOK_SECRET") })

	router := newTestRouter(t)

	payload := []byte(`{"branch":"kathmandu","severity":"high","customer_id":"CUST001"}`)

	// Compute HMAC-SHA256 signature the same way verifyWebhookSignature does.
	mac := hmac.New(sha256.New, []byte(webhookSecret))
	mac.Write(payload)
	sig := "sha256=" + hex.EncodeToString(mac.Sum(nil))

	req := httptest.NewRequest("POST", "/api/webhook/fraud_alert", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Webhook-Signature", sig)

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatalf("expected 200 with valid HMAC signature, got %d — body: %s", w.Code, w.Body.String())
	}
}

// ─── TestHQComplianceReportShape ─────────────────────────────────────────────

func TestHQComplianceReportShape(t *testing.T) {
	router := newTestRouter(t)
	req := makeJSONRequest("GET", "/api/hq/compliance_report", nil, adminToken())
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code == 401 || w.Code == 403 {
		t.Fatalf("auth/role failed: %d — body: %s", w.Code, w.Body.String())
	}
	if w.Code != 200 && w.Code != 503 {
		t.Fatalf("unexpected status %d — body: %s", w.Code, w.Body.String())
	}
}

// ─── TestHQFairnessAuditShape ─────────────────────────────────────────────────

func TestHQFairnessAuditShape(t *testing.T) {
	router := newTestRouter(t)
	req := makeJSONRequest("GET", "/api/hq/fairness_audit", nil, adminToken())
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code == 401 || w.Code == 403 {
		t.Fatalf("auth/role failed: %d — body: %s", w.Code, w.Body.String())
	}
	if w.Code != 200 && w.Code != 503 {
		t.Fatalf("unexpected status %d — body: %s", w.Code, w.Body.String())
	}
}

// ─── TestHQPrivacyBudgetNoDBReturnsDefault ────────────────────────────────────
//
// Fresh in-memory DB → zero rows in dp_budget_ledger.
// The endpoint must still return valid defaults.

func TestHQPrivacyBudgetNoDBReturnsDefault(t *testing.T) {
	router := newTestRouter(t)
	req := makeJSONRequest("GET", "/api/hq/privacy_budget", nil, adminToken())
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d — body: %s", w.Code, w.Body.String())
	}
	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)

	status, _ := resp["status"].(string)
	if status == "" {
		t.Errorf("expected non-empty status field — body: %s", w.Body.String())
	}

	total, _ := resp["total_budget"].(float64)
	remaining, _ := resp["epsilon_remaining"].(float64)
	if total <= 0 {
		t.Errorf("total_budget should be > 0 by default, got %.6f", total)
	}
	if remaining < 0 {
		t.Errorf("epsilon_remaining should be >= 0, got %.6f", remaining)
	}
}
