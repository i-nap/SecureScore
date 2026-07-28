package main

import (
	"database/sql"
	"fmt"

	"github.com/gin-gonic/gin"
)

// Double-entry general ledger. Rather than retrofit every money handler, the GL
// is reconciled from the canonical `transactions` ledger: glSync() seeds opening
// balances once, then posts balanced journal lines for any transaction not yet
// booked. Every posting has equal debits and credits, so the trial balance
// always nets to zero and the accounting equation (A = L + E) holds by
// construction.
//
// ponytail: economic nuance is intentionally coarse — FD maturity reverses the
// full maturity amount against the FD account (not split into principal +
// interest), and loan EMIs credit Loans Receivable in full (no interest-income
// split). The books still balance; refine the splits only if a real audit needs
// the income lines broken out.

type glLine struct {
	Account string
	Debit   float64
	Credit  float64
	Memo    string
}

// glPostingsFor maps a transaction type + amount to balanced journal lines.
func glPostingsFor(txnType string, amount, fee float64) []glLine {
	switch txnType {
	case "DEPOSIT", "CHEQUE_DEPOSIT":
		return []glLine{{"1000", amount, 0, "cash in"}, {"2000", 0, amount, "deposit credited"}}
	case "WITHDRAWAL", "CARD_POS", "CARD_ATM":
		return []glLine{{"2000", amount, 0, "withdrawal"}, {"1000", 0, amount, "cash out"}}
	case "TRANSFER", "STANDING_INSTRUCTION":
		lines := []glLine{{"2000", amount + fee, 0, "transfer out"}, {"2000", 0, amount, "transfer in"}}
		if fee > 0 {
			lines = append(lines, glLine{"4000", 0, fee, "transfer fee"})
		}
		return lines
	case "BILL_PAYMENT", "IPO_BLOCK":
		return []glLine{{"2000", amount, 0, "bill paid"}, {"1000", 0, amount, "settled to biller"}}
	case "IPO_REFUND", "FOREX_UNLOAD":
		return []glLine{{"1000", amount, 0, "refund in"}, {"2000", 0, amount, "credited to account"}}
	case "FOREX_LOAD":
		return []glLine{{"2000", amount, 0, "NPR debited"}, {"1000", 0, amount, "loaded to forex card"}}
	case "FD_OPEN":
		return []glLine{{"2000", amount, 0, "deposit → FD"}, {"2100", 0, amount, "FD opened"}}
	case "FD_MATURITY":
		return []glLine{{"2100", amount, 0, "FD closed"}, {"2000", 0, amount, "FD → deposit"}}
	case "INTEREST":
		return []glLine{{"5000", amount, 0, "interest expense"}, {"2000", 0, amount, "interest credited"}}
	case "LOAN_DISBURSE":
		return []glLine{{"1100", amount, 0, "loan booked"}, {"2000", 0, amount, "disbursed to account"}}
	case "LOAN_EMI", "LOAN_PREPAY", "LOAN_FORECLOSE":
		return []glLine{{"2000", amount, 0, "repayment debit"}, {"1100", 0, amount, "loan reduced"}}
	default:
		return nil // unrecognised types are not posted
	}
}

func glMetaGet(key string) string {
	var v sql.NullString
	db.QueryRow("SELECT value FROM gl_meta WHERE key=?", key).Scan(&v)
	return v.String
}

func glMetaSet(key, value string) {
	db.Exec("INSERT INTO gl_meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", key, value)
}

func glPost(txnRef, branchID string, lines []glLine) {
	for i, l := range lines {
		db.Exec(`INSERT OR IGNORE INTO gl_entries (id,txn_ref,line_no,account_code,debit,credit,branch_id,memo)
			VALUES (?,?,?,?,?,?,?,?)`,
			newUUID(), txnRef, i, l.Account, l.Debit, l.Credit, branchID, l.Memo)
	}
}

// glSync brings the ledger up to date. Idempotent — safe to call on every read.
func glSync() {
	if !dbAvailable() {
		return
	}

	// One-time opening snapshot: book current deposit + FD balances against cash,
	// and remember the high-water rowid so we never re-post historical activity.
	if glMetaGet("opening_done") != "1" {
		var depTotal, fdTotal sql.NullFloat64
		db.QueryRow("SELECT COALESCE(SUM(balance),0) FROM accounts WHERE is_active=1").Scan(&depTotal)
		db.QueryRow("SELECT COALESCE(SUM(principal),0) FROM fixed_deposits WHERE status='ACTIVE'").Scan(&fdTotal)
		var maxRowID sql.NullInt64
		db.QueryRow("SELECT COALESCE(MAX(rowid),0) FROM transactions").Scan(&maxRowID)

		opening := []glLine{
			{"1000", math_round(depTotal.Float64+fdTotal.Float64, 2), 0, "opening cash"},
			{"2000", 0, math_round(depTotal.Float64, 2), "opening deposits"},
			{"2100", 0, math_round(fdTotal.Float64, 2), "opening FDs"},
		}
		glPost("OPENING", "", opening)
		glMetaSet("opening_max_rowid", fmt.Sprintf("%d", maxRowID.Int64))
		glMetaSet("opening_done", "1")
	}

	openingRowID := glMetaGet("opening_max_rowid")
	if openingRowID == "" {
		openingRowID = "0"
	}

	// Post any transaction newer than the opening snapshot that isn't booked yet.
	rows, err := db.Query(`SELECT t.id, t.transaction_type, t.amount, COALESCE(t.fee,0), COALESCE(t.branch_id,'')
		FROM transactions t
		WHERE t.rowid > ? AND t.id NOT IN (SELECT DISTINCT txn_ref FROM gl_entries)`, openingRowID)
	if err != nil {
		return
	}
	defer rows.Close()
	type pending struct {
		id, ttype, branch string
		amount, fee       float64
	}
	var todo []pending
	for rows.Next() {
		var id, ttype, branch sql.NullString
		var amount, fee sql.NullFloat64
		rows.Scan(&id, &ttype, &amount, &fee, &branch)
		todo = append(todo, pending{id.String, ttype.String, branch.String, amount.Float64, fee.Float64})
	}
	rows.Close()
	for _, t := range todo {
		lines := glPostingsFor(t.ttype, t.amount, t.fee)
		if lines != nil {
			glPost(t.id, t.branch, lines)
		}
	}
}

func handleGLTrialBalance(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	glSync()

	rows, _ := db.Query(`SELECT a.code,a.name,a.type,a.normal_side,
		COALESCE(SUM(e.debit),0), COALESCE(SUM(e.credit),0)
		FROM gl_accounts a LEFT JOIN gl_entries e ON e.account_code=a.code
		GROUP BY a.code ORDER BY a.code`)
	defer rows.Close()

	accounts := []gin.H{}
	var totalDebit, totalCredit float64
	for rows.Next() {
		var code, name, typ, side sql.NullString
		var dr, cr sql.NullFloat64
		rows.Scan(&code, &name, &typ, &side, &dr, &cr)
		// Present each account on its normal side as a single balance.
		bal := dr.Float64 - cr.Float64
		debitCol, creditCol := 0.0, 0.0
		if bal >= 0 {
			debitCol = math_round(bal, 2)
		} else {
			creditCol = math_round(-bal, 2)
		}
		totalDebit += debitCol
		totalCredit += creditCol
		accounts = append(accounts, gin.H{
			"code": code.String, "name": name.String, "type": typ.String,
			"debit": debitCol, "credit": creditCol,
		})
	}
	td, tc := math_round(totalDebit, 2), math_round(totalCredit, 2)
	c.JSON(200, gin.H{
		"accounts":     accounts,
		"total_debit":  td,
		"total_credit": tc,
		"balanced":     mathAbs(td-tc) < 0.01,
	})
}

func handleGLBalanceSheet(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	glSync()

	rows, _ := db.Query(`SELECT a.type, COALESCE(SUM(e.debit),0), COALESCE(SUM(e.credit),0)
		FROM gl_accounts a LEFT JOIN gl_entries e ON e.account_code=a.code GROUP BY a.type`)
	defer rows.Close()
	byType := map[string]float64{}
	for rows.Next() {
		var typ sql.NullString
		var dr, cr sql.NullFloat64
		rows.Scan(&typ, &dr, &cr)
		byType[typ.String] = dr.Float64 - cr.Float64 // debit-positive
	}
	assets := math_round(byType["ASSET"], 2)
	liabilities := math_round(-byType["LIABILITY"], 2)
	income := math_round(-byType["INCOME"], 2)
	expense := math_round(byType["EXPENSE"], 2)
	netProfit := math_round(income-expense, 2)
	equity := math_round(-byType["EQUITY"]+netProfit, 2)

	c.JSON(200, gin.H{
		"assets":      assets,
		"liabilities": liabilities,
		"equity":      equity,
		"income":      income,
		"expense":     expense,
		"net_profit":  netProfit,
		"balanced":    mathAbs(assets-(liabilities+equity)) < 0.01,
	})
}

func handleGLJournal(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	glSync()
	limit := safeLimit(c.DefaultQuery("limit", "60"), 60)

	rows, _ := db.Query(`SELECT e.txn_ref,e.account_code,a.name,e.debit,e.credit,e.memo,e.created_at
		FROM gl_entries e LEFT JOIN gl_accounts a ON a.code=e.account_code
		ORDER BY e.created_at DESC, e.txn_ref, e.line_no LIMIT ?`, limit)
	defer rows.Close()
	entries := []gin.H{}
	for rows.Next() {
		var ref, code, name, memo, createdAt sql.NullString
		var dr, cr sql.NullFloat64
		rows.Scan(&ref, &code, &name, &dr, &cr, &memo, &createdAt)
		entries = append(entries, gin.H{
			"txn_ref": ref.String, "account_code": code.String, "account_name": name.String,
			"debit": dr.Float64, "credit": cr.Float64, "memo": memo.String, "created_at": createdAt.String,
		})
	}
	c.JSON(200, gin.H{"entries": entries})
}

func mathAbs(f float64) float64 {
	if f < 0 {
		return -f
	}
	return f
}
