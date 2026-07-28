package main

import "testing"

func TestArgon2RoundTrip(t *testing.T) {
	h := argon2Hash("s3cret-pw")
	if !argon2Verify("s3cret-pw", h) {
		t.Fatal("verify failed for correct password")
	}
	if argon2Verify("wrong-pw", h) {
		t.Fatal("verify passed for wrong password")
	}
	if h == argon2Hash("s3cret-pw") {
		t.Fatal("salt not random — two hashes of same password are identical")
	}
}

func TestAdminIsSuperuser(t *testing.T) {
	perms := effectivePermissions("admin", "admin")
	if len(perms) != len(permissionCatalog) {
		t.Fatalf("admin should hold all %d permissions, got %d", len(permissionCatalog), len(perms))
	}
	if !perms["teller.deposit"] || !perms["ceo.executive"] || !perms["admin.users.manage"] {
		t.Fatal("admin missing an expected permission")
	}
}

func TestCashierRolePerms(t *testing.T) {
	perms := effectivePermissions("some_cashier", "cashier")
	if !perms["teller.deposit"] || !perms["teller.cheque_deposit"] || !perms["teller.withdraw"] {
		t.Fatal("cashier missing teller permissions")
	}
	if perms["admin.users.manage"] {
		t.Fatal("cashier must not hold admin permissions")
	}
}
