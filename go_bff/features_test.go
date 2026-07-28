package main

// features_test.go — tests for the money/security paths added this session:
// DP budget guard (#6) and loan rejection reasons / NRB C-5 (#4), plus a smoke
// sweep over the self-contained (simulated) handlers to lift coverage cheaply.

import (
	"net/http/httptest"
	"testing"
)

// #6 — DP budget guard blocks aggregation once the ledger is exhausted.
// Default total budget 10.0, per-round epsilon 1.0 → spending >9 exhausts it.
func TestDPBudgetGuardBlocksWhenExhausted(t *testing.T) {
	router := newTestRouter(t)
	for i := 1; i <= 10; i++ {
		if _, err := db.Exec(
			`INSERT INTO dp_budget_ledger (round_number, epsilon_used, clip_norm, branches_included, triggered_by)
			 VALUES (?,?,?,?,?)`, i, 1.0, 1.0, 3, "test"); err != nil {
			t.Fatalf("seed ledger: %v", err)
		}
	}
	req := makeJSONRequest("POST", "/api/hq/trigger_aggregation", map[string]interface{}{}, adminToken())
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != 429 {
		t.Fatalf("expected 429 when DP budget exhausted, got %d — body: %s", w.Code, w.Body.String())
	}
}

// Guard must NOT fire with budget remaining. HQ is offline in tests, so the
// request proceeds past the guard and fails at the proxy (503) — never 429.
func TestDPBudgetGuardAllowsWhenBudgetRemains(t *testing.T) {
	router := newTestRouter(t)
	req := makeJSONRequest("POST", "/api/hq/trigger_aggregation", map[string]interface{}{}, adminToken())
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code == 429 {
		t.Fatalf("guard should not fire with full budget; got 429 — body: %s", w.Body.String())
	}
}

// #4 — buildRejectionReasons returns the top-3 most-negative known SHAP features,
// ignoring positive and unknown features.
func TestBuildRejectionReasonsTop3(t *testing.T) {
	resp := map[string]interface{}{
		"shap_values": map[string]interface{}{
			"debt_to_income":          -0.40,
			"repayment_history_score": -0.30,
			"collateral_value":        -0.20,
			"annual_income":           -0.10,
			"employment_months":       0.15,  // positive → ignored
			"unknown_feature":         -0.99, // not in lookup → ignored
		},
	}
	reasons := buildRejectionReasons(resp, map[string]interface{}{})
	if len(reasons) != 3 {
		t.Fatalf("expected top-3 reasons, got %d: %+v", len(reasons), reasons)
	}
	for _, r := range reasons {
		if r["feature"] == "" || r["impact"] == "" || r["improvement"] == "" {
			t.Errorf("reason missing fields: %+v", r)
		}
	}
	if reasons[0]["feature"] != "debt_to_income" {
		t.Errorf("most-negative feature should rank first, got %q", reasons[0]["feature"])
	}
}

// #4 — heuristic fallback fires when no SHAP values are present.
func TestBuildRejectionReasonsHeuristicFallback(t *testing.T) {
	reasons := buildRejectionReasons(
		map[string]interface{}{},
		map[string]interface{}{"debt_to_income": 0.7, "existing_loans": 4.0},
	)
	if len(reasons) == 0 {
		t.Fatal("expected heuristic reasons when DTI high and many active loans")
	}
}

// #4 — customer loan_apply returns a decision; a rejected loan must carry the reason.
func TestCustomerLoanApplyShape(t *testing.T) {
	router := newTestRouter(t)
	body := map[string]interface{}{
		"loan_purpose": "Personal", "loan_amount": 5000000, "tenure_months": 12,
		"collateral_type": "None", "collateral_value": 0, "monthly_income": 10000,
	}
	req := makeJSONRequest("POST", "/api/customer/loan_apply", body, customerToken())
	code, resp := serveAndDecode(router, req)
	if code != 200 {
		t.Fatalf("expected 200, got %d", code)
	}
	if _, ok := resp["status"].(string); !ok {
		t.Fatalf("missing status field: %+v", resp)
	}
	if resp["status"] == "rejected" {
		if _, ok := resp["rejection_reason"].([]interface{}); !ok {
			t.Errorf("rejected loan must carry rejection_reason: %+v", resp)
		}
	}
}

// Smoke: self-contained / simulated handlers must never 500. 503 (HQ/edge offline
// in tests) is acceptable — the point is to exercise the handler entry paths.
func TestSelfContainedEndpointsSmoke(t *testing.T) {
	router := newTestRouter(t)
	cases := []struct{ path, token string }{
		{"/api/health", ""},
		{"/api/customer/counterfactual", customerToken()},
		{"/api/customer/health_score", customerToken()},
		{"/api/customer/loan_eligibility", customerToken()},
		{"/api/hq/he_demo", adminToken()},
		{"/api/hq/zkp_demo", adminToken()},
		{"/api/hq/convergence", adminToken()},
		{"/api/hq/network_topology", adminToken()},
		{"/api/hq/branch_leaderboard", adminToken()},
		{"/api/hq/split_learning", adminToken()},
		{"/api/hq/privacy_budget", adminToken()},
	}
	for _, c := range cases {
		req := makeJSONRequest("GET", c.path, nil, c.token)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code >= 500 && w.Code != 503 {
			t.Errorf("%s -> %d (server error): %s", c.path, w.Code, w.Body.String())
		}
	}
}
