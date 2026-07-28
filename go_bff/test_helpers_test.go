package main

// test_helpers_test.go — shared test infrastructure for Go BFF handler tests.
//
// newTestRouter() spins up the full Gin router (same middleware stack as main())
// against an in-memory SQLite database so tests are isolated and repeatable.
// All test files in this package import nothing extra — they use the helpers here.

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
)

// testDBSeq gives every test a uniquely-named in-memory database. modernc's bare
// ":memory:" is shared process-wide and persists across Close(), so without a unique
// name one test's seed data leaks into the next. A named shared-cache memory db is
// isolated per name and lives as long as its single pinned connection.
var testDBSeq int64

// testSecret is the BFF JWT signing secret used across all HTTP handler tests.
const testSecret = "test-bff-secret-handler-tests-32ch!!"

// newTestRouter initialises the BFF global state (bffSecret, db) and returns
// a ready-to-use http.Handler that exercises the real Gin router.
//
// Each call creates a fresh in-memory SQLite so tests never share state.
func newTestRouter(t *testing.T) http.Handler {
	t.Helper()

	// Set the module-level signing secret so createBFFJWT / verifyBFFJWT work.
	bffSecret = testSecret

	// Point at a non-existent HQ so proxy handlers gracefully return 503.
	hqURL = "http://127.0.0.1:59999"
	hqAPIKey = "test-api-key"
	corsOrigins = []string{"http://localhost:3000"}

	// Build a fresh, uniquely-named in-memory SQLite database for each test.
	var err error
	dsn := fmt.Sprintf("file:testdb%d?mode=memory&cache=shared", atomic.AddInt64(&testDBSeq, 1))
	db, err = sql.Open("sqlite", dsn)
	if err != nil {
		t.Fatalf("failed to open in-memory SQLite: %v", err)
	}
	db.SetMaxOpenConns(1)
	if err := db.Ping(); err != nil {
		t.Fatalf("in-memory SQLite ping failed: %v", err)
	}
	ensureSchema()
	initRBAC()
	initMarkets()
	initApprovals()
	initNotifications()

	t.Cleanup(func() {
		if db != nil {
			db.Close()
			db = nil
		}
	})

	// Seed branchEdgeMap so branch handlers don't panic.
	branchEdgeMap = map[string]string{
		"kathmandu": "http://127.0.0.1:59998",
		"pokhara":   "http://127.0.0.1:59997",
		"sarlahi":   "http://127.0.0.1:59996",
	}

	return buildRouter()
}

// buildRouter constructs a Gin engine with the same routes and middleware as
// main(), but in ReleaseMode so output is clean in test logs.
func buildRouter() http.Handler {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(requestIDMiddleware())
	r.Use(corsMiddleware())
	r.Use(securityHeadersMiddleware())
	r.Use(maxBodyMiddleware())
	r.Use(idsMiddleware())
	r.Use(idempotencyMiddleware())

	// Health / root
	r.GET("/api/health", handleHealth)
	r.GET("/", handleRoot)

	// Auth (no auth middleware)
	r.POST("/api/auth/login", handleLogin)
	r.POST("/api/auth/refresh", handleRefreshToken)
	r.POST("/api/auth/mfa/verify", handleMFAVerify)

	// Webhooks (no auth — HMAC-protected)
	r.POST("/api/webhook/fraud_alert", handleWebhookFraudAlert)
	r.POST("/api/webhook/aggregation", handleWebhookAggregation)
	r.POST("/api/webhook/weight_submitted", handleWebhookWeightSubmitted)

	// Authenticated routes
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
		auth.GET("/api/customer/cashflow", handleCustomerCashflow)
		auth.GET("/api/customer/risk_profile", handleCustomerRiskProfile)
		auth.GET("/api/customer/score_explanation", handleCustomerScoreExplanation)
		auth.POST("/api/customer/whatif", handleCustomerWhatIf)
		auth.GET("/api/customer/score_history", handleCustomerScoreHistory)
		auth.POST("/api/customer/kyc_submit", handleCustomerKYCSubmit)
		auth.POST("/api/customer/loan_apply", handleCustomerLoanApply)
		auth.GET("/api/customer/loan_history", handleCustomerLoanHistory)
		auth.GET("/api/customer/counterfactual", handleCustomerCounterfactual)
		auth.GET("/api/customer/health_score", handleCustomerHealthScore)
		auth.GET("/api/customer/loan_eligibility", handleCustomerLoanEligibility)
		auth.GET("/api/customer/spending_analytics", handleCustomerSpendingAnalytics)
		auth.POST("/api/customer/robo-advice", handleCustomerRoboAdvice)
		auth.GET("/api/customer/cashflow_branch", handleCustomerCashflowBranch)
		auth.POST("/api/customer/kyc_ai_verify", handleCustomerKYCAIVerify)
		auth.POST("/api/customer/kyc_update_ai", handleCustomerKYCUpdateAI)
		auth.POST("/api/customer/kyc_face_verify", handleCustomerKYCFaceVerify)

		// Branch
		auth.GET("/api/branch/metrics", handleBranchMetrics)
		auth.GET("/api/branch/customers", handleBranchCustomers)
		auth.POST("/api/branch/explain", handleBranchExplain)
		auth.GET("/api/branch/fraud_alerts", handleBranchFraudAlerts)
		auth.GET("/api/branch/loan_decisions", handleBranchLoanDecisions)
		auth.GET("/api/branch/hq_fingerprints", handleBranchHQFingerprints)
		auth.GET("/api/branch/kyc_applications", handleBranchKYCApplications)
		auth.POST("/api/branch/kyc_review/:id", handleBranchKYCReview)
		auth.GET("/api/branch/clients", handleBranchClients)
		auth.GET("/api/branch/clients/:customer_id", handleBranchClientDetail)
		auth.POST("/api/branch/clients/:customer_id/verify-kyc", handleBranchVerifyKYC)
		auth.GET("/api/branch/banking/summary", handleBranchBankingSummary)
		auth.GET("/api/branch/banking/accounts", handleBranchAllAccounts)
		auth.GET("/api/branch/banking/fd", handleBranchAllFDs)
		auth.GET("/api/branch/account-applications", handleBranchGetApplications)
		auth.POST("/api/branch/account-applications/:id/approve", handleBranchApproveApplication)
		auth.POST("/api/branch/account-applications/:id/reject", handleBranchRejectApplication)
		auth.GET("/api/branch/fraud-worker/status", handleFraudWorkerStatus)
		auth.GET("/api/branch/fraud_alerts/history", handleBranchFraudAlertHistory)
		auth.GET("/api/branch/data_drift", handleBranchDataDrift)
		auth.GET("/api/branch/ai_models_status", handleBranchAIModelsStatus)
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
		auth.GET("/api/branch/aml_network", handleBranchAMLNetwork)
		auth.GET("/api/branch/par", handleBranchPAR)
		auth.POST("/api/branch/generate_sar", handleBranchGenerateSAR)
		auth.GET("/api/branch/fraud_stream", handleBranchFraudStream)
		auth.POST("/api/branch/score/batch", handleBranchBatchScore)

		// HQ
		auth.GET("/api/hq/status", handleHQStatus)
		auth.GET("/api/hq/health", handleHQHealth)
		auth.GET("/api/hq/round_history", handleHQRoundHistory)
		auth.GET("/api/hq/anomaly_log", handleHQAnomalyLog)
		auth.GET("/api/hq/audit_log", handleHQAuditLog)
		auth.GET("/api/hq/audit_verify", handleHQAuditVerify)
		auth.GET("/api/hq/loan_decisions", handleHQLoanDecisions)
		auth.GET("/api/hq/fingerprint_decisions", handleHQFingerprintDecisions)
		auth.GET("/api/hq/fraud_alerts", handleHQFraudAlerts)
		auth.GET("/api/hq/model_registry", handleHQModelRegistry)
		auth.POST("/api/hq/trigger_aggregation", handleHQTriggerAggregation)
		auth.GET("/api/hq/branches", handleHQBranches)
		auth.GET("/api/hq/privacy_budget", handleHQPrivacyBudget)
		auth.GET("/api/hq/compliance_report", handleHQComplianceReport)
		auth.GET("/api/hq/branch_contributions", handleHQBranchContributions)
		auth.POST("/api/hq/stress_test", handleHQStressTest)
		auth.POST("/api/hq/byzantine_demo", handleHQByzantineDemo)
		auth.GET("/api/hq/fairness_audit", handleHQFairnessAudit)
		auth.GET("/api/hq/convergence", handleHQConvergence)
		auth.GET("/api/hq/model_drift", handleHQModelDrift)
		auth.GET("/api/hq/network_topology", handleHQNetworkTopology)
		auth.GET("/api/hq/he_demo", handleHQHEDemo)
		auth.GET("/api/hq/branch_leaderboard", handleHQBranchLeaderboard)
		auth.GET("/api/hq/branch_explainability", handleHQBranchExplainability)
		auth.GET("/api/hq/split_learning", handleHQSplitLearning)
		auth.GET("/api/hq/zkp_demo", handleHQZKPDemo)
		auth.GET("/api/hq/federated_benchmark", handleHQFederatedBenchmark)
		auth.GET("/api/hq/mu_graphcoder/status", handleHQMuStatus)
		auth.GET("/api/hq/mu_graphcoder/report", handleHQMuReport)
		auth.POST("/api/hq/mu_graphcoder/trigger_training", handleHQMuTrigger)
		auth.GET("/api/hq/pi_devices", handleHQPiDevices)
		auth.GET("/api/hq/pi_devices/:branch", handleHQPiDevice)
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
		auth.POST("/api/hq/security/watermark_embed", handleHQWatermarkEmbed)
		auth.POST("/api/hq/security/watermark_verify", handleHQWatermarkVerify)
		auth.GET("/api/hq/security/watermark_status", handleHQWatermarkStatus)
		auth.GET("/api/hq/events/stream", handleHQEventsStream)

		// Banking
		auth.GET("/api/banking/accounts", handleBankingAccounts)
		auth.GET("/api/banking/accounts/search", handleBankingAccountsSearch)
		auth.POST("/api/banking/transfer", handleBankingTransfer)
		auth.GET("/api/banking/transactions", handleBankingTransactions)
		auth.GET("/api/banking/profile", handleBankingProfile)
		auth.PATCH("/api/banking/profile", handleBankingProfileUpdate)
		auth.POST("/api/banking/change-password", handleBankingChangePassword)
		auth.POST("/api/banking/fd", handleBankingFDCreate)
		auth.GET("/api/banking/fd", handleBankingFDList)
		auth.DELETE("/api/banking/fd/:fd_number", handleBankingFDBreak)
		auth.GET("/api/banking/security-audit", handleBankingSecurityAudit)
		auth.GET("/api/banking/audit/merkle-proof", handleBankingMerkleProof)
		auth.GET("/api/banking/audit/merkle-proof/export", handleBankingMerkleProofExport)
		auth.POST("/api/banking/audit/merkle-anchor", handleBankingMerkleAnchorCreate)
		auth.GET("/api/banking/audit/merkle-anchors", handleBankingMerkleAnchors)
		auth.POST("/api/banking/account-application", handleApplyAccount)
		auth.GET("/api/banking/account-applications", handleMyApplications)
		auth.GET("/api/banking/statement", handleBankingStatement)
		auth.GET("/api/banking/eod/preview", handleEODPreview)
		auth.POST("/api/banking/eod", handleRunEOD)
		auth.POST("/api/banking/bod", handleRunBOD)
		auth.GET("/api/banking/eod/logs", handleEODLogs)

		// Spec V1
		auth.POST("/api/v1/scoring", handleSpecScoring)
		auth.POST("/api/v1/gradients/upload", handleSpecGradientsUpload)
		auth.GET("/api/v1/models/weights", handleSpecModelWeights)
		auth.POST("/api/v1/aggregate", handleSpecAggregate)
		auth.POST("/api/v1/hypernetwork/personalize", handleSpecHypernetworkPersonalize)
		auth.POST("/api/v1/verify/background", handleSpecVerifyBackground)

		// Admin
		auth.DELETE("/api/admin/customer/:customer_id/erasure", handleAdminCustomerErasure)
	}

	return r
}

// mustMarshal returns a compact JSON string for diagnostic output.
func mustMarshal(v interface{}) string {
	b, _ := json.Marshal(v)
	return string(b)
}

// adminToken returns a fresh 15-min admin JWT signed with testSecret.
// Useful in test files that do not need to exercise the login handler.
func adminToken() string {
	return createBFFJWT(map[string]interface{}{
		"sub":       "admin",
		"role":      "admin",
		"branch_id": "hq",
		"full_name": "System Admin",
	}, 900)
}

// branchManagerToken returns a fresh 15-min branch_manager JWT for Kathmandu.
func branchManagerToken() string {
	return createBFFJWT(map[string]interface{}{
		"sub":       "kathmandu_mgr",
		"role":      "branch_manager",
		"branch_id": "kathmandu",
		"full_name": "Ram Sharma",
	}, 900)
}

// customerToken returns a fresh 15-min customer JWT.
func customerToken() string {
	return createBFFJWT(map[string]interface{}{
		"sub":         "cust001",
		"role":        "customer",
		"branch_id":   "kathmandu",
		"full_name":   "Aarav Thapa",
		"customer_id": "CUST100005",
	}, 900)
}

// TestMain is the entry point for the test binary. It sets BFF_SECRET_KEY so
// initConfig() never aborts (initConfig is not called in tests — we set
// bffSecret directly), and runs all tests.
func TestMain(m *testing.M) {
	// Ensure the module-level secret is set before any test helper needs it.
	bffSecret = testSecret
	// Silence gin output during tests.
	gin.SetMode(gin.TestMode)
	os.Exit(m.Run())
}

// serveAndDecode is a shorthand: serve req against router, return (status, body).
func serveAndDecode(router http.Handler, req *http.Request) (int, map[string]interface{}) {
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	var body map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &body)
	return w.Code, body
}

// serveAndDecodeArray decodes the response into a JSON array rather than object.
func serveAndDecodeArray(router http.Handler, req *http.Request) (int, []interface{}) {
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	var body []interface{}
	json.Unmarshal(w.Body.Bytes(), &body)
	return w.Code, body
}
