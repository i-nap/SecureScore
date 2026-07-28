package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"testing"
)

func postTeller(router http.Handler, path, token string, payload map[string]interface{}) (int, map[string]interface{}) {
	body, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", path, bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	return serveAndDecode(router, req)
}

func TestTellerDepositWithdraw(t *testing.T) {
	router := newTestRouter(t)
	db.Exec(`INSERT INTO accounts (id, account_number, customer_id, branch_id, account_type, balance)
		VALUES ('a1','ACC777','CUST1','kathmandu','savings',1000)`)
	tok := adminToken() // admin bypasses permission gate

	code, resp := postTeller(router, "/api/teller/deposit", tok, map[string]interface{}{"account_number": "ACC777", "amount": 500.0})
	if code != 200 {
		t.Fatalf("deposit status %d: %v", code, resp)
	}
	if resp["balance_after"].(float64) != 1500 {
		t.Fatalf("balance after deposit = %v, want 1500", resp["balance_after"])
	}

	code, _ = postTeller(router, "/api/teller/withdraw", tok, map[string]interface{}{"account_number": "ACC777", "amount": 5000.0})
	if code != 400 {
		t.Fatalf("over-withdraw status %d, want 400 (insufficient funds)", code)
	}

	code, resp = postTeller(router, "/api/teller/withdraw", tok, map[string]interface{}{"account_number": "ACC777", "amount": 300.0})
	if code != 200 {
		t.Fatalf("withdraw status %d: %v", code, resp)
	}
	if resp["balance_after"].(float64) != 1200 {
		t.Fatalf("balance after withdraw = %v, want 1200", resp["balance_after"])
	}
}

func TestTellerPermissionDenied(t *testing.T) {
	router := newTestRouter(t)
	code, _ := postTeller(router, "/api/teller/deposit", customerToken(),
		map[string]interface{}{"account_number": "ACC1", "amount": 100.0})
	if code != 403 {
		t.Fatalf("customer teller deposit status %d, want 403 (missing permission)", code)
	}
}
