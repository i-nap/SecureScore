package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"testing"
)

func custReq(router http.Handler, method, path string, payload map[string]interface{}) (int, map[string]interface{}) {
	var body []byte
	if payload != nil {
		body, _ = json.Marshal(payload)
	}
	req, _ := http.NewRequest(method, path, bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+customerToken())
	req.Header.Set("Content-Type", "application/json")
	return serveAndDecode(router, req)
}

func TestIPOApplyFlow(t *testing.T) {
	router := newTestRouter(t)
	// customerToken() => customer_id CUST100005
	db.Exec(`INSERT INTO accounts (id, account_number, customer_id, branch_id, account_type, balance)
		VALUES ('m1','ACC900','CUST100005','kathmandu','savings',5000)`)

	var issueID string
	db.QueryRow(`SELECT id FROM ipo_issues WHERE symbol='NABIL'`).Scan(&issueID)
	if issueID == "" {
		t.Fatal("seeded IPO issue not found")
	}

	// Apply before linking demat -> 400
	code, _ := custReq(router, "POST", "/api/customer/ipo/apply",
		map[string]interface{}{"issue_id": issueID, "account_number": "ACC900", "units": 10})
	if code != 400 {
		t.Fatalf("apply without demat status %d, want 400", code)
	}

	// Link demat
	code, _ = custReq(router, "POST", "/api/customer/demat/link", map[string]interface{}{})
	if code != 201 {
		t.Fatalf("demat link status %d, want 201", code)
	}

	// Apply 10 units @ 100 = 1000 blocked -> balance 4000
	code, resp := custReq(router, "POST", "/api/customer/ipo/apply",
		map[string]interface{}{"issue_id": issueID, "account_number": "ACC900", "units": 10})
	if code != 201 {
		t.Fatalf("apply status %d: %v", code, resp)
	}
	if resp["balance_after"].(float64) != 4000 {
		t.Fatalf("balance after apply = %v, want 4000", resp["balance_after"])
	}

	// Double apply -> 409
	code, _ = custReq(router, "POST", "/api/customer/ipo/apply",
		map[string]interface{}{"issue_id": issueID, "account_number": "ACC900", "units": 10})
	if code != 409 {
		t.Fatalf("double apply status %d, want 409", code)
	}
}

func TestIPOAllotmentRefundAndHoldings(t *testing.T) {
	router := newTestRouter(t)
	db.Exec(`INSERT INTO accounts (id, account_number, customer_id, branch_id, account_type, balance)
		VALUES ('m2','ACC901','CUST100005','kathmandu','savings',10000)`)
	var issueID string
	db.QueryRow(`SELECT id FROM ipo_issues WHERE symbol='UPPER'`).Scan(&issueID)

	custReq(router, "POST", "/api/customer/demat/link", map[string]interface{}{})
	// Apply 20 units @100 = 2000 blocked -> balance 8000
	custReq(router, "POST", "/api/customer/ipo/apply",
		map[string]interface{}{"issue_id": issueID, "account_number": "ACC901", "units": 20})

	// Admin allots: grants 10 (min), refunds 10*100=1000 -> balance 9000
	body, _ := json.Marshal(map[string]interface{}{})
	req, _ := http.NewRequest("POST", "/api/admin/ipo/"+issueID+"/allot", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+adminToken())
	req.Header.Set("Content-Type", "application/json")
	if code, resp := serveAndDecode(router, req); code != 200 {
		t.Fatalf("allot status %d: %v", code, resp)
	}

	var units int
	db.QueryRow(`SELECT units FROM holdings WHERE customer_id='CUST100005' AND symbol='UPPER'`).Scan(&units)
	if units != 10 {
		t.Fatalf("holdings units = %d, want 10", units)
	}
	var bal float64
	db.QueryRow(`SELECT balance FROM accounts WHERE account_number='ACC901'`).Scan(&bal)
	if bal != 9000 {
		t.Fatalf("balance after refund = %v, want 9000", bal)
	}
}
