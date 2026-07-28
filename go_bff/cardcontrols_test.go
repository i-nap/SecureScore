package main

import (
	"net/http"
	"testing"
)

func custGet(router http.Handler, path string) (int, map[string]interface{}) {
	req, _ := http.NewRequest("GET", path, nil)
	req.Header.Set("Authorization", "Bearer "+customerToken())
	return serveAndDecode(router, req)
}

func TestCardControls(t *testing.T) {
	router := newTestRouter(t)
	db.Exec(`INSERT INTO cards (id,customer_id,account_number,card_number,network,status,card_type)
		VALUES ('c1','CUST100005','ACC1','4111111111111111','VISA','ACTIVE','DEBIT')`)

	if code, _ := custReq(router, "POST", "/api/customer/card/pin",
		map[string]interface{}{"card_id": "c1", "pin": "4321"}); code != 200 {
		t.Fatalf("set pin status %d, want 200", code)
	}
	if code, _ := custReq(router, "POST", "/api/customer/card/pin",
		map[string]interface{}{"card_id": "c1", "pin": "12"}); code != 400 {
		t.Fatalf("short pin status %d, want 400", code)
	}
	if code, _ := custReq(router, "POST", "/api/customer/card/channel",
		map[string]interface{}{"card_id": "c1", "channel": "atm", "enabled": false}); code != 200 {
		t.Fatalf("toggle status %d, want 200", code)
	}

	code, resp := custGet(router, "/api/customer/card/controls?card_id=c1")
	if code != 200 {
		t.Fatalf("controls status %d", code)
	}
	if resp["pin_set"] != true {
		t.Fatal("pin_set should be true")
	}
	if resp["atm"] != false {
		t.Fatal("atm should be disabled")
	}
}

func TestCardPurchasePINAtUse(t *testing.T) {
	router := newTestRouter(t)
	db.Exec(`INSERT INTO accounts (id, account_number, customer_id, branch_id, account_type, balance)
		VALUES ('pa1','ACC960','CUST100005','kathmandu','savings',5000)`)
	db.Exec(`INSERT INTO cards (id,customer_id,account_number,card_number,network,status,card_type,daily_limit,ch_pos)
		VALUES ('cp1','CUST100005','ACC960','4111111111111112','VISA','ACTIVE','DEBIT',10000,1)`)
	custReq(router, "POST", "/api/customer/card/pin",
		map[string]interface{}{"card_id": "cp1", "pin": "4321"})

	// Wrong PIN → 401, no debit.
	if code, _ := custReq(router, "POST", "/api/customer/card/purchase",
		map[string]interface{}{"card_id": "cp1", "pin": "0000", "amount": 1000.0, "merchant": "X"}); code != 401 {
		t.Fatalf("wrong pin status %d, want 401", code)
	}
	// Correct PIN → approved, balance drops.
	code, resp := custReq(router, "POST", "/api/customer/card/purchase",
		map[string]interface{}{"card_id": "cp1", "pin": "4321", "amount": 1000.0, "merchant": "Bhatbhateni"})
	if code != 200 {
		t.Fatalf("purchase status %d, want 200", code)
	}
	if bal, _ := resp["balance_after"].(float64); bal != 4000 {
		t.Fatalf("balance_after %v, want 4000", resp["balance_after"])
	}
	// Disabled channel → 409.
	custReq(router, "POST", "/api/customer/card/channel",
		map[string]interface{}{"card_id": "cp1", "channel": "pos", "enabled": false})
	if code, _ := custReq(router, "POST", "/api/customer/card/purchase",
		map[string]interface{}{"card_id": "cp1", "pin": "4321", "amount": 100.0, "merchant": "X"}); code != 409 {
		t.Fatalf("disabled channel status %d, want 409", code)
	}
}

func TestNotificationsOnDeposit(t *testing.T) {
	router := newTestRouter(t)
	db.Exec(`INSERT INTO accounts (id, account_number, customer_id, branch_id, account_type, balance)
		VALUES ('n1','ACC950','CUST100005','kathmandu','savings',1000)`)

	postTeller(router, "/api/teller/deposit", adminToken(),
		map[string]interface{}{"account_number": "ACC950", "amount": 250.0})

	code, resp := custGet(router, "/api/customer/notifications")
	if code != 200 {
		t.Fatalf("notifications status %d", code)
	}
	if u, _ := resp["unread"].(float64); u < 1 {
		t.Fatalf("expected >=1 unread notification, got %v", resp["unread"])
	}
}
