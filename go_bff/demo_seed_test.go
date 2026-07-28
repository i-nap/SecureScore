package main

import "testing"

func TestSeedDemoBankingProducesLedger(t *testing.T) {
	newTestRouter(t)
	seedDemoBanking()

	// Idempotent: a second call must not duplicate.
	seedDemoBanking()

	var accounts, txns int
	db.QueryRow("SELECT COUNT(*) FROM accounts WHERE customer_id='CUST100005'").Scan(&accounts)
	db.QueryRow(`SELECT COUNT(*) FROM transactions t JOIN accounts a ON t.from_account_id=a.id
		WHERE a.customer_id='CUST100005'`).Scan(&txns)
	if accounts != 1 {
		t.Fatalf("expected exactly 1 account, got %d", accounts)
	}
	if txns < 20 {
		t.Fatalf("expected a rich ledger (>=20 debits), got %d", txns)
	}

	// Loan book: active loans + at least one overdue installment for the branch copilot.
	var loans, overdue int
	db.QueryRow("SELECT COUNT(*) FROM loans WHERE customer_id='CUST100005' AND status='ACTIVE'").Scan(&loans)
	db.QueryRow(`SELECT COUNT(*) FROM loan_schedule s JOIN loans l ON l.id=s.loan_id
		WHERE l.customer_id='CUST100005' AND s.status='OVERDUE'`).Scan(&overdue)
	if loans < 3 {
		t.Fatalf("expected >=3 active loans, got %d", loans)
	}
	if overdue < 1 {
		t.Fatalf("expected >=1 overdue installment, got %d", overdue)
	}

	// Bulk portfolio: hundreds of loans across all 13 branches, with overdue spread.
	seedBulkPortfolio()
	seedBulkPortfolio() // idempotent — must not double
	var totalLoans, branchesWithLoans, totalOverdue int
	db.QueryRow("SELECT COUNT(*) FROM loans").Scan(&totalLoans)
	db.QueryRow("SELECT COUNT(DISTINCT branch_id) FROM loans").Scan(&branchesWithLoans)
	db.QueryRow("SELECT COUNT(*) FROM loan_schedule WHERE status='OVERDUE'").Scan(&totalOverdue)
	if totalLoans < 450 {
		t.Fatalf("expected >=450 loans after bulk seed, got %d", totalLoans)
	}
	if branchesWithLoans < 13 {
		t.Fatalf("expected loans in all 13 branches, got %d", branchesWithLoans)
	}
	if totalOverdue < 10 {
		t.Fatalf("expected a spread of overdue installments, got %d", totalOverdue)
	}

	// realSpending must now return live ledger data, not the synthetic fallback.
	out := realSpending("CUST100005")
	if out == nil {
		t.Fatal("realSpending returned nil despite seeded ledger")
	}
	if out["source"] != "ledger" {
		t.Fatalf("spending source = %v, want ledger", out["source"])
	}
}
