package main

import (
	"net/http"
	"testing"
)

func getJSON(router http.Handler, path, token string) (int, map[string]interface{}) {
	req, _ := http.NewRequest("GET", path, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	return serveAndDecode(router, req)
}

func TestMakerCheckerWithdrawal(t *testing.T) {
	router := newTestRouter(t)
	db.Exec(`INSERT INTO accounts (id, account_number, customer_id, branch_id, account_type, balance)
		VALUES ('mc1','ACC902','CUST1','kathmandu','savings',500000)`)

	// Admin (maker) withdraws 200000 > 100000 auto limit -> queued (202)
	code, resp := postTeller(router, "/api/teller/withdraw", adminToken(),
		map[string]interface{}{"account_number": "ACC902", "amount": 200000.0})
	if code != 202 {
		t.Fatalf("over-limit withdraw status %d, want 202 (queued)", code)
	}
	reqID, _ := resp["request_id"].(string)
	if reqID == "" {
		t.Fatal("no request_id returned")
	}

	// Balance unchanged while pending
	var bal float64
	db.QueryRow(`SELECT balance FROM accounts WHERE account_number='ACC902'`).Scan(&bal)
	if bal != 500000 {
		t.Fatalf("balance changed before approval: %v", bal)
	}

	// Maker cannot approve own request -> 403
	if code, _ := postTeller(router, "/api/approvals/"+reqID+"/approve", adminToken(), map[string]interface{}{}); code != 403 {
		t.Fatalf("self-approval status %d, want 403 (four-eyes)", code)
	}

	// Manager (checker) approves -> 200, balance 300000
	code, _ = postTeller(router, "/api/approvals/"+reqID+"/approve", branchManagerToken(), map[string]interface{}{})
	if code != 200 {
		t.Fatalf("manager approval status %d, want 200", code)
	}
	db.QueryRow(`SELECT balance FROM accounts WHERE account_number='ACC902'`).Scan(&bal)
	if bal != 300000 {
		t.Fatalf("balance after approval = %v, want 300000", bal)
	}
}

func TestTrialBalanceBalanced(t *testing.T) {
	router := newTestRouter(t)
	db.Exec(`INSERT INTO accounts (id, account_number, customer_id, branch_id, account_type, balance)
		VALUES ('tb1','ACC903','CUST1','kathmandu','savings',1000)`)
	postTeller(router, "/api/teller/deposit", adminToken(), map[string]interface{}{"account_number": "ACC903", "amount": 500.0})

	code, resp := getJSON(router, "/api/hq/trial-balance", adminToken())
	if code != 200 {
		t.Fatalf("trial balance status %d", code)
	}
	if resp["balanced"] != true {
		t.Fatalf("GL not balanced: debit=%v credit=%v", resp["total_debit"], resp["total_credit"])
	}
}
