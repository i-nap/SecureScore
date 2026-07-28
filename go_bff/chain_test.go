package main

import (
	"strings"
	"testing"
)

func TestMineBlockMeetsDifficulty(t *testing.T) {
	prev := strings.Repeat("0", 64)
	root := merkleRootHex([]string{txnLeaf("t1", "TRANSFER", 100), txnLeaf("t2", "DEPOSIT", 50)})
	nonce, hash := mineBlock(1, prev, root, "2026-06-27T00:00:00Z", 3)
	if !strings.HasPrefix(hash, "000") {
		t.Fatalf("mined hash does not meet difficulty: %s", hash)
	}
	// Re-deriving with the found nonce must reproduce the exact hash.
	if blockHash(1, prev, root, "2026-06-27T00:00:00Z", nonce) != hash {
		t.Fatal("block hash not reproducible from stored fields")
	}
}

func TestMerkleRootStableAndTamperEvident(t *testing.T) {
	a := merkleRootHex([]string{txnLeaf("a", "DEPOSIT", 100), txnLeaf("b", "TRANSFER", 200)})
	b := merkleRootHex([]string{txnLeaf("a", "DEPOSIT", 100), txnLeaf("b", "TRANSFER", 200)})
	if a != b {
		t.Fatal("merkle root not deterministic")
	}
	// Tampering with an amount must change the root.
	c := merkleRootHex([]string{txnLeaf("a", "DEPOSIT", 100), txnLeaf("b", "TRANSFER", 999)})
	if a == c {
		t.Fatal("merkle root unchanged after tampering — not tamper-evident")
	}
	// Odd-leaf count must not panic.
	_ = merkleRootHex([]string{txnLeaf("x", "DEPOSIT", 1)})
	if merkleRootHex(nil) != strings.Repeat("0", 64) {
		t.Fatal("empty tree should be zero root")
	}
}
