package main

// concurrency_test.go — Go concurrency tests for the SecureScore BFF Gateway.
//
// Covers: concurrent JWT verification, concurrent Merkle proof building,
// idempotency key replay detection, decimal money arithmetic precision, and
// transfer serialization safety (double-spend guard).

import (
	"fmt"
	"math"
	"sync"
	"sync/atomic"
	"testing"
)

// ─── 1. Concurrent JWT verification ──────────────────────────────────────────
//
// 50 goroutines verify tokens created by 5 different issuers simultaneously.
// The verifier must be race-free and always agree on the token's validity.

func TestConcurrentJWTVerify(t *testing.T) {
	bffSecret = "test-concurrent-secret-abc123"

	tokens := make([]string, 5)
	for i := range tokens {
		tokens[i] = createBFFJWT(map[string]interface{}{
			"sub":    fmt.Sprintf("user%d", i),
			"role":   "branch_manager",
			"branch": "kathmandu",
		}, 1)
	}

	var wg sync.WaitGroup
	var failures int64

	for g := 0; g < 50; g++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			tok := tokens[idx%len(tokens)]
			claims, err := verifyBFFJWT(tok)
			if err != nil {
				atomic.AddInt64(&failures, 1)
				return
			}
			if claims["role"] != "branch_manager" {
				atomic.AddInt64(&failures, 1)
			}
		}(g)
	}
	wg.Wait()

	if failures > 0 {
		t.Fatalf("concurrent JWT verify: %d goroutines reported failures", failures)
	}
}

func TestConcurrentJWTRejectsExpiredToken(t *testing.T) {
	bffSecret = "test-expire-secret-xyz987"

	// Create a token with -2h expiry (already expired).
	expired := createBFFJWT(map[string]interface{}{
		"sub":  "ghost",
		"role": "customer",
	}, -2)

	var wg sync.WaitGroup
	var accepted int64

	for g := 0; g < 20; g++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := verifyBFFJWT(expired)
			if err == nil {
				atomic.AddInt64(&accepted, 1)
			}
		}()
	}
	wg.Wait()

	if accepted > 0 {
		t.Fatalf("expired token accepted by %d goroutines", accepted)
	}
}

// ─── 2. Concurrent Merkle proof building ─────────────────────────────────────
//
// Multiple goroutines build proofs for different target indices over the same
// leaf set. All must produce the same root and each proof must verify.

func TestConcurrentMerkleProofBuilding(t *testing.T) {
	leaves := make([]string, 16)
	for i := range leaves {
		leaves[i] = hashHex(fmt.Sprintf("txn:concurrent:%d", i))
	}

	// Compute ground-truth root with target 0.
	expectedRoot, _, err := buildMerkleProof(leaves, 0)
	if err != nil {
		t.Fatal(err)
	}

	var wg sync.WaitGroup
	var failures int64

	for g := 0; g < len(leaves); g++ {
		wg.Add(1)
		go func(target int) {
			defer wg.Done()
			root, proof, err := buildMerkleProof(leaves, target)
			if err != nil {
				atomic.AddInt64(&failures, 1)
				return
			}
			if root != expectedRoot {
				atomic.AddInt64(&failures, 1)
				return
			}
			if !verifyMerkleProof(leaves[target], root, proof) {
				atomic.AddInt64(&failures, 1)
			}
		}(g)
	}
	wg.Wait()

	if failures > 0 {
		t.Fatalf("concurrent Merkle proofs: %d goroutines reported failures", failures)
	}
}

func TestMerkleRootIsDeterministic(t *testing.T) {
	leaves := []string{
		hashHex("a"), hashHex("b"), hashHex("c"),
		hashHex("d"), hashHex("e"), hashHex("f"),
	}
	roots := make([]string, 8)
	var wg sync.WaitGroup
	for i := range roots {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			r, _, _ := buildMerkleProof(leaves, 0)
			roots[idx] = r
		}(i)
	}
	wg.Wait()
	for i := 1; i < len(roots); i++ {
		if roots[i] != roots[0] {
			t.Fatalf("non-deterministic root: index 0=%s, index %d=%s", roots[0], i, roots[i])
		}
	}
}

// ─── 3. Idempotency key replay detection ─────────────────────────────────────
//
// An in-memory idempotency store (simulating what the transfer handler would
// use) must allow exactly one request per key even under concurrent load.

type idempotencyStore struct {
	mu   sync.Mutex
	seen map[string]bool
}

func newIdempotencyStore() *idempotencyStore {
	return &idempotencyStore{seen: make(map[string]bool)}
}

// tryCommit returns true only on the first call for a given key.
func (s *idempotencyStore) tryCommit(key string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.seen[key] {
		return false
	}
	s.seen[key] = true
	return true
}

func TestIdempotencyReplayPrevented(t *testing.T) {
	store := newIdempotencyStore()
	key := "REF-TXN-IDEMPOTENT-001"
	const goroutines = 50

	var committed int64
	var wg sync.WaitGroup
	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if store.tryCommit(key) {
				atomic.AddInt64(&committed, 1)
			}
		}()
	}
	wg.Wait()

	if committed != 1 {
		t.Fatalf("idempotency: expected exactly 1 commit, got %d", committed)
	}
}

func TestIdempotencyDifferentKeysAreIndependent(t *testing.T) {
	store := newIdempotencyStore()
	const keys = 20

	var committed int64
	var wg sync.WaitGroup
	for k := 0; k < keys; k++ {
		key := fmt.Sprintf("REF-UNIQUE-%d", k)
		wg.Add(1)
		go func(key string) {
			defer wg.Done()
			if store.tryCommit(key) {
				atomic.AddInt64(&committed, 1)
			}
		}(key)
	}
	wg.Wait()

	if committed != keys {
		t.Fatalf("expected %d commits for unique keys, got %d", keys, committed)
	}
}

// ─── 4. Decimal money arithmetic precision ───────────────────────────────────
//
// Banking transfers use float64. These tests ensure the math_round helper
// keeps cents accurate across edge-case amounts and that fee calculation
// never produces negative-money artefacts.

func TestDecimalRoundingHalfUp(t *testing.T) {
	// math_round uses int(x*factor+0.5)/factor. Values like 1.005 are stored
	// as 1.00499... in IEEE 754, so they round DOWN at 2 decimal places.
	// These cases document the actual production behaviour to prevent
	// accidental regressions from "fixing" the rounding in one direction.
	cases := []struct {
		in       float64
		decimals int
		want     float64
	}{
		{1.005, 2, 1.00}, // IEEE 754: 1.005 → 1.00499... rounds down
		{2.555, 2, 2.56}, // 2.555*100+0.5 = 256.0 exactly → rounds up
		{0.1 + 0.2, 2, 0.30},
		{100.004, 2, 100.00},
		{100.005, 2, 100.01},
		{1234567.891, 2, 1234567.89},
		{0.001, 2, 0.00},
	}
	for _, tc := range cases {
		got := math_round(tc.in, tc.decimals)
		if math.Abs(got-tc.want) > 1e-9 {
			t.Errorf("math_round(%.10f, %d) = %.10f, want %.10f", tc.in, tc.decimals, got, tc.want)
		}
	}
}

func TestFeeCalculationNeverExceedsAmount(t *testing.T) {
	amounts := []float64{1, 10, 100, 1000, 10001, 99999, 500000, 1000000}
	for _, amt := range amounts {
		var fee float64
		if amt > 10000 {
			fee = math_round(amt*0.001, 2)
		}
		if fee >= amt {
			t.Errorf("fee %.2f >= amount %.2f for transfer amount %.2f", fee, amt, amt)
		}
		totalDebit := math_round(amt+fee, 2)
		if totalDebit > amt*1.1 {
			t.Errorf("totalDebit %.2f is more than 10%% over amount %.2f", totalDebit, amt)
		}
	}
}

func TestMinimumBalanceBreachDetected(t *testing.T) {
	balance := 5000.00
	minBal := 1000.00
	amount := 4500.00
	fee := math_round(amount*0.001, 2)
	totalDebit := amount + fee

	remaining := balance - totalDebit
	if remaining >= minBal {
		t.Fatalf("expected min-balance breach: remaining=%.2f minBal=%.2f", remaining, minBal)
	}
}

func TestMinimumBalanceSatisfied(t *testing.T) {
	balance := 10000.00
	minBal := 1000.00
	amount := 8000.00
	fee := math_round(amount*0.001, 2)
	totalDebit := amount + fee

	remaining := balance - totalDebit
	if remaining < minBal {
		t.Fatalf("expected balance OK: remaining=%.2f minBal=%.2f", remaining, minBal)
	}
}

// ─── 5. Transfer serialization safety (in-memory double-spend guard) ─────────
//
// Simulates the serialized read-modify-write that a DB transaction enforces.
// A naive unsynchronised update lets concurrent goroutines double-spend;
// the mutex-guarded version must prevent it.

type ledger struct {
	mu      sync.Mutex
	balance float64
}

func (l *ledger) transferSafe(amount float64) (bool, float64) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.balance < amount {
		return false, l.balance
	}
	l.balance -= amount
	return true, l.balance
}

func TestConcurrentTransferNoDoubleSpend(t *testing.T) {
	const initial = 10000.0
	const transferAmt = 1000.0
	const goroutines = 20

	acct := &ledger{balance: initial}
	var succeeded int64
	var wg sync.WaitGroup

	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ok, _ := acct.transferSafe(transferAmt)
			if ok {
				atomic.AddInt64(&succeeded, 1)
			}
		}()
	}
	wg.Wait()

	expectedSucceeded := int64(initial / transferAmt) // 10
	if succeeded != expectedSucceeded {
		t.Fatalf("expected %d successful transfers, got %d", expectedSucceeded, succeeded)
	}
	finalBalance := math_round(acct.balance, 2)
	if finalBalance != 0.0 {
		t.Fatalf("expected final balance 0.00, got %.2f", finalBalance)
	}
}

func TestConcurrentTransferRejectsOverdraft(t *testing.T) {
	const initial = 500.0
	const transferAmt = 300.0
	const goroutines = 10

	acct := &ledger{balance: initial}
	var succeeded int64
	var wg sync.WaitGroup

	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ok, _ := acct.transferSafe(transferAmt)
			if ok {
				atomic.AddInt64(&succeeded, 1)
			}
		}()
	}
	wg.Wait()

	// Only one 300 transfer can succeed from a 500 balance (second would leave 200 which is < 300).
	if succeeded != 1 {
		t.Fatalf("overdraft guard: expected 1 successful transfer, got %d", succeeded)
	}
}

// ─── 6. Merkle proof tamper detection ────────────────────────────────────────

func TestMerkleProofTamperDetection(t *testing.T) {
	leaves := make([]string, 8)
	for i := range leaves {
		leaves[i] = hashHex(fmt.Sprintf("real-txn:%d", i))
	}
	root, proof, err := buildMerkleProof(leaves, 3)
	if err != nil {
		t.Fatal(err)
	}

	// Genuine verification must pass.
	if !verifyMerkleProof(leaves[3], root, proof) {
		t.Fatal("genuine proof should verify")
	}

	// Tamper: swap a sibling hash in the proof.
	if len(proof) > 0 {
		tampered := make([]merkleProofStep, len(proof))
		copy(tampered, proof)
		tampered[0].SiblingHash = hashHex("tampered-sibling")
		if verifyMerkleProof(leaves[3], root, tampered) {
			t.Fatal("tampered proof should NOT verify")
		}
	}

	// Tamper: wrong leaf.
	fakeleaf := hashHex("injected-transaction")
	if verifyMerkleProof(fakeleaf, root, proof) {
		t.Fatal("injected leaf should NOT verify against original proof")
	}

	// Tamper: wrong root.
	fakeRoot := hashHex("fake-root")
	if verifyMerkleProof(leaves[3], fakeRoot, proof) {
		t.Fatal("genuine leaf should NOT verify against tampered root")
	}
}

// ─── 7. JWT auth — claims integrity ──────────────────────────────────────────

func TestJWTClaimsRoundTrip(t *testing.T) {
	bffSecret = "roundtrip-secret-claims-test"
	original := map[string]interface{}{
		"sub":         "test-user",
		"role":        "admin",
		"branch_id":   "kathmandu",
		"customer_id": "CUST999",
	}
	tok := createBFFJWT(original, 1)
	claims, err := verifyBFFJWT(tok)
	if err != nil {
		t.Fatalf("verify failed: %v", err)
	}
	for _, key := range []string{"sub", "role", "branch_id", "customer_id"} {
		if claims[key] != original[key] {
			t.Errorf("claim[%s]: got %v, want %v", key, claims[key], original[key])
		}
	}
}

func TestJWTRejectsMangledSignature(t *testing.T) {
	bffSecret = "mangle-secret-789"
	tok := createBFFJWT(map[string]interface{}{"sub": "attacker", "role": "admin"}, 1)

	// Flip the last character of the signature.
	runes := []rune(tok)
	if runes[len(runes)-1] == 'a' {
		runes[len(runes)-1] = 'b'
	} else {
		runes[len(runes)-1] = 'a'
	}
	mangled := string(runes)

	_, err := verifyBFFJWT(mangled)
	if err == nil {
		t.Fatal("mangled JWT should be rejected")
	}
}

func TestJWTRejectsTruncatedToken(t *testing.T) {
	bffSecret = "truncate-secret"
	tok := createBFFJWT(map[string]interface{}{"sub": "x"}, 1)
	_, err := verifyBFFJWT(tok[:len(tok)/2])
	if err == nil {
		t.Fatal("truncated JWT should be rejected")
	}
}
