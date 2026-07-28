package main

import "testing"

func TestForexCardLoadUnload(t *testing.T) {
	router := newTestRouter(t)
	db.Exec(`INSERT INTO accounts (id, account_number, customer_id, branch_id, account_type, balance)
		VALUES ('f1','ACC900','CUST100005','kathmandu','savings',50000)`)

	if code, _ := custReq(router, "POST", "/api/customer/forex/issue",
		map[string]interface{}{"account_number": "ACC900"}); code != 201 {
		t.Fatalf("issue status %d, want 201", code)
	}

	// Load 100 USD => 13350 NPR debited; account 50000-13350=36650, card 100
	code, resp := custReq(router, "POST", "/api/customer/forex/load",
		map[string]interface{}{"account_number": "ACC900", "usd_amount": 100.0})
	if code != 200 {
		t.Fatalf("load status %d: %v", code, resp)
	}
	if resp["usd_card_balance"].(float64) != 100 {
		t.Fatalf("card balance = %v, want 100", resp["usd_card_balance"])
	}
	if resp["npr_account_balance"].(float64) != 36650 {
		t.Fatalf("npr balance = %v, want 36650", resp["npr_account_balance"])
	}

	// Over-load (1000 USD = 133500 NPR > balance) => 400
	if code, _ := custReq(router, "POST", "/api/customer/forex/load",
		map[string]interface{}{"account_number": "ACC900", "usd_amount": 1000.0}); code != 400 {
		t.Fatalf("over-load status %d, want 400", code)
	}

	// Unload 50 USD => account +6675 => 43325, card 50
	code, resp = custReq(router, "POST", "/api/customer/forex/unload",
		map[string]interface{}{"account_number": "ACC900", "usd_amount": 50.0})
	if code != 200 {
		t.Fatalf("unload status %d: %v", code, resp)
	}
	if resp["usd_card_balance"].(float64) != 50 {
		t.Fatalf("card balance after unload = %v, want 50", resp["usd_card_balance"])
	}
}
