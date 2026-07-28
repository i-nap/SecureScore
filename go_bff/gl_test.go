package main

import "testing"

// The cardinal rule of double-entry: every posting's debits equal its credits.
// If any mapping is unbalanced, the trial balance can't net to zero.
func TestGLPostingsBalance(t *testing.T) {
	cases := []struct {
		ttype       string
		amount, fee float64
	}{
		{"DEPOSIT", 5000, 0},
		{"CHEQUE_DEPOSIT", 12000, 0},
		{"WITHDRAWAL", 3000, 0},
		{"TRANSFER", 25000, 25},
		{"TRANSFER", 8000, 0},
		{"STANDING_INSTRUCTION", 1500, 0},
		{"BILL_PAYMENT", 1200, 0},
		{"FD_OPEN", 100000, 0},
		{"FD_MATURITY", 108000, 0},
		{"INTEREST", 42.5, 0},
		{"LOAN_DISBURSE", 500000, 0},
		{"LOAN_EMI", 11122, 0},
		{"LOAN_FORECLOSE", 250000, 0},
	}
	for _, c := range cases {
		lines := glPostingsFor(c.ttype, c.amount, c.fee)
		if lines == nil {
			t.Errorf("%s: no postings", c.ttype)
			continue
		}
		var dr, cr float64
		for _, l := range lines {
			dr += l.Debit
			cr += l.Credit
		}
		if mathAbs(dr-cr) > 0.001 {
			t.Errorf("%s amount=%v fee=%v: unbalanced dr=%.2f cr=%.2f", c.ttype, c.amount, c.fee, dr, cr)
		}
	}
	if glPostingsFor("UNKNOWN_TYPE", 100, 0) != nil {
		t.Error("unknown type should not post")
	}
}
