package main

import "testing"

func TestBuildAndVerifyMerkleProof(t *testing.T) {
	leaves := []string{
		hashHex("txn:a"),
		hashHex("txn:b"),
		hashHex("txn:c"),
		hashHex("txn:d"),
		hashHex("txn:e"),
	}

	root, proof, err := buildMerkleProof(leaves, 2)
	if err != nil {
		t.Fatalf("buildMerkleProof returned error: %v", err)
	}
	if root == "" {
		t.Fatal("expected non-empty Merkle root")
	}
	if len(proof) == 0 {
		t.Fatal("expected proof path")
	}
	if !verifyMerkleProof(leaves[2], root, proof) {
		t.Fatal("expected proof to verify")
	}
	if verifyMerkleProof(hashHex("txn:tampered"), root, proof) {
		t.Fatal("tampered leaf should not verify")
	}
}

func TestBuildMerkleProofRejectsBadTarget(t *testing.T) {
	_, _, err := buildMerkleProof([]string{hashHex("txn:a")}, 3)
	if err == nil {
		t.Fatal("expected target range error")
	}
}

func TestScoreFraudEventFlagsLargeTransfer(t *testing.T) {
	score, severity, reason := scoreFraudEvent(fraudTxnEvent{
		ReferenceNumber:   "TXN-TEST",
		CustomerID:        "CUST-1",
		BranchID:          "kathmandu",
		FromAccountNumber: "1001",
		ToAccountNumber:   "1002",
		Amount:            600000,
		Fee:               600,
		Channel:           "online",
		CreatedAt:         "2026-06-06T23:15:00Z",
	})
	if score < 0.85 {
		t.Fatalf("expected high fraud score, got %.3f", score)
	}
	if severity != "critical" {
		t.Fatalf("expected critical severity, got %s", severity)
	}
	if reason == "" {
		t.Fatal("expected explainable fraud reason")
	}
}

func TestScoreFraudEventKeepsSmallTransferLow(t *testing.T) {
	score, severity, _ := scoreFraudEvent(fraudTxnEvent{
		ReferenceNumber:   "TXN-SMALL",
		CustomerID:        "CUST-1",
		BranchID:          "kathmandu",
		FromAccountNumber: "1001",
		ToAccountNumber:   "1002",
		Amount:            1500,
		Fee:               0,
		Channel:           "online",
		CreatedAt:         "2026-06-06T12:00:00Z",
	})
	if score >= 0.45 {
		t.Fatalf("expected low fraud score, got %.3f", score)
	}
	if severity != "low" {
		t.Fatalf("expected low severity, got %s", severity)
	}
}
