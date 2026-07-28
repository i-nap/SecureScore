package main

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// Private transaction blockchain. Transactions are batched into hash-linked
// blocks; each block stores the Merkle root of its transactions and its hash is
// sha256(index|prev_hash|merkle_root|timestamp|nonce). Light proof-of-work
// (leading-zero difficulty) gives the "mining" step. Tampering with any past
// transaction changes a Merkle root, which changes that block's hash, which
// breaks every subsequent prev_hash link — caught by /verify.
//
// ponytail: this is a permissioned single-writer ledger (HQ seals blocks), not a
// distributed-consensus chain. That's the right tool for an internal audit
// anchor — no tokens, no nodes, no PoW arms race. Difficulty is cosmetic (3).

const chainDifficulty = 3 // leading hex zeros — ~4k hashes, instant to mine

func merkleRootHex(leaves []string) string {
	if len(leaves) == 0 {
		return strings.Repeat("0", 64)
	}
	layer := leaves
	for len(layer) > 1 {
		var next []string
		for i := 0; i < len(layer); i += 2 {
			if i+1 < len(layer) {
				next = append(next, sha256hex(layer[i]+layer[i+1]))
			} else {
				next = append(next, sha256hex(layer[i]+layer[i])) // duplicate odd leaf
			}
		}
		layer = next
	}
	return layer[0]
}

func blockHash(idx int, prev, root, ts string, nonce int) string {
	return sha256hex(fmt.Sprintf("%d|%s|%s|%s|%d", idx, prev, root, ts, nonce))
}

func mineBlock(idx int, prev, root, ts string, difficulty int) (int, string) {
	target := strings.Repeat("0", difficulty)
	for nonce := 0; ; nonce++ {
		h := blockHash(idx, prev, root, ts, nonce)
		if strings.HasPrefix(h, target) {
			return nonce, h
		}
	}
}

// txnLeaf is the canonical, stable hash of a transaction for the Merkle tree.
func txnLeaf(id, ttype string, amount float64) string {
	return sha256hex(fmt.Sprintf("txn:%s:%s:%.2f", id, ttype, amount))
}

func chainHeight() (int, string, bool) {
	var idx sql.NullInt64
	var hash sql.NullString
	err := db.QueryRow("SELECT idx, hash FROM blocks ORDER BY idx DESC LIMIT 1").Scan(&idx, &hash)
	if err != nil {
		return -1, "", false
	}
	return int(idx.Int64), hash.String, true
}

func ensureGenesis() {
	if _, _, ok := chainHeight(); ok {
		return
	}
	ts := time.Now().UTC().Format(time.RFC3339)
	root := strings.Repeat("0", 64)
	prev := strings.Repeat("0", 64)
	nonce, hash := mineBlock(0, prev, root, ts, chainDifficulty)
	db.Exec(`INSERT OR IGNORE INTO blocks (idx,prev_hash,merkle_root,tx_count,nonce,difficulty,ts,hash)
		VALUES (0,?,?,0,?,?,?,?)`, prev, root, nonce, chainDifficulty, ts, hash)
	glMetaSet("chain_last_rowid", "0") // first sealed block anchors all prior history
}

// sealNextBlock batches every transaction not yet in a block into a new block.
func sealNextBlock() (gin.H, error) {
	ensureGenesis()
	lastRowid := glMetaGet("chain_last_rowid")
	if lastRowid == "" {
		lastRowid = "0"
	}

	rows, err := db.Query(`SELECT rowid, id, transaction_type, COALESCE(amount,0)
		FROM transactions WHERE rowid > ? ORDER BY rowid ASC`, lastRowid)
	if err != nil {
		return nil, err
	}
	var leaves []string
	var maxRowid int64
	for rows.Next() {
		var rowid sql.NullInt64
		var id, ttype sql.NullString
		var amount sql.NullFloat64
		rows.Scan(&rowid, &id, &ttype, &amount)
		leaves = append(leaves, txnLeaf(id.String, ttype.String, amount.Float64))
		if rowid.Int64 > maxRowid {
			maxRowid = rowid.Int64
		}
	}
	rows.Close()

	if len(leaves) == 0 {
		return nil, fmt.Errorf("no pending transactions to seal")
	}

	idx, prevHash, _ := chainHeight()
	newIdx := idx + 1
	root := merkleRootHex(leaves)
	ts := time.Now().UTC().Format(time.RFC3339)
	nonce, hash := mineBlock(newIdx, prevHash, root, ts, chainDifficulty)

	_, err = db.Exec(`INSERT INTO blocks (idx,prev_hash,merkle_root,tx_count,nonce,difficulty,ts,hash)
		VALUES (?,?,?,?,?,?,?,?)`, newIdx, prevHash, root, len(leaves), nonce, chainDifficulty, ts, hash)
	if err != nil {
		return nil, err
	}
	glMetaSet("chain_last_rowid", fmt.Sprintf("%d", maxRowid))

	return gin.H{
		"index": newIdx, "hash": hash, "prev_hash": prevHash, "merkle_root": root,
		"tx_count": len(leaves), "nonce": nonce, "difficulty": chainDifficulty, "timestamp": ts,
	}, nil
}

func handleChainSeal(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	block, err := sealNextBlock()
	if err != nil {
		c.JSON(400, gin.H{"detail": err.Error()})
		return
	}
	c.JSON(200, gin.H{"status": "sealed", "block": block})
}

func handleChainBlocks(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	ensureGenesis()

	// Count transactions still awaiting a block.
	lastRowid := glMetaGet("chain_last_rowid")
	if lastRowid == "" {
		lastRowid = "0"
	}
	var pending int
	db.QueryRow("SELECT COUNT(*) FROM transactions WHERE rowid > ?", lastRowid).Scan(&pending)

	rows, _ := db.Query(`SELECT idx,prev_hash,merkle_root,tx_count,nonce,difficulty,ts,hash FROM blocks ORDER BY idx DESC LIMIT 100`)
	defer rows.Close()
	blocks := []gin.H{}
	for rows.Next() {
		var idx, txc, nonce, diff sql.NullInt64
		var prev, root, ts, hash sql.NullString
		rows.Scan(&idx, &prev, &root, &txc, &nonce, &diff, &ts, &hash)
		blocks = append(blocks, gin.H{
			"index": idx.Int64, "prev_hash": prev.String, "merkle_root": root.String,
			"tx_count": txc.Int64, "nonce": nonce.Int64, "difficulty": diff.Int64,
			"timestamp": ts.String, "hash": hash.String,
		})
	}
	c.JSON(200, gin.H{"blocks": blocks, "height": len(blocks), "pending": pending})
}

func handleChainVerify(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	rows, _ := db.Query(`SELECT idx,prev_hash,merkle_root,nonce,difficulty,ts,hash FROM blocks ORDER BY idx ASC`)
	defer rows.Close()

	valid := true
	brokenAt := -1
	count := 0
	prevExpected := strings.Repeat("0", 64)
	for rows.Next() {
		var idx, nonce, diff sql.NullInt64
		var prev, root, ts, hash sql.NullString
		rows.Scan(&idx, &prev, &root, &nonce, &diff, &ts, &hash)
		count++
		// 1) prev_hash must link to the previous block's hash.
		// 2) stored hash must equal the recomputed hash.
		// 3) hash must satisfy the proof-of-work difficulty.
		recomputed := blockHash(int(idx.Int64), prev.String, root.String, ts.String, int(nonce.Int64))
		linkOK := prev.String == prevExpected
		hashOK := recomputed == hash.String
		powOK := strings.HasPrefix(hash.String, strings.Repeat("0", int(diff.Int64)))
		if !linkOK || !hashOK || !powOK {
			valid = false
			brokenAt = int(idx.Int64)
			break
		}
		prevExpected = hash.String
	}

	c.JSON(200, gin.H{
		"valid": valid, "blocks_verified": count, "broken_at": brokenAt,
		"message": map[bool]string{true: "Chain intact — every block links and hashes verify", false: fmt.Sprintf("Chain broken at block %d", brokenAt)}[valid],
	})
}
