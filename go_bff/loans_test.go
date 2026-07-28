package main

import (
	"math"
	"testing"
)

// The amortization schedule must fully repay the principal: the sum of the
// principal components equals the loan, and the final balance is zero.
func TestAmortizeClosesToZero(t *testing.T) {
	cases := []struct {
		p    float64
		rate float64
		n    int
	}{
		{500000, 12.0, 60},
		{100000, 0, 12}, // zero-interest edge case
		{1234567, 16.5, 37},
		{10000, 20, 3},
	}
	for _, c := range cases {
		emi, rows := amortize(c.p, c.rate, c.n)
		if len(rows) != c.n {
			t.Fatalf("p=%v rate=%v n=%d: got %d rows", c.p, c.rate, c.n, len(rows))
		}
		if emi <= 0 {
			t.Fatalf("p=%v rate=%v: non-positive emi %v", c.p, c.rate, emi)
		}
		var principalSum float64
		for _, r := range rows {
			principalSum += r.Principal
		}
		if math.Abs(principalSum-c.p) > 0.05 {
			t.Errorf("p=%v rate=%v: principal components sum to %.2f, want %.2f", c.p, c.rate, principalSum, c.p)
		}
		if last := rows[len(rows)-1].Balance; last != 0 {
			t.Errorf("p=%v rate=%v: final balance %.2f, want 0", c.p, c.rate, last)
		}
	}
}

// The disbursement gate must approve an affordable loan and decline one whose
// EMI dwarfs the borrower's income.
func TestAssessLoanGate(t *testing.T) {
	// Comfortable: 12k EMI on a 1.2M income (DTI ~12%).
	if _, _, ok := assessLoan(500000, 12000, 1200000, 0, false); !ok {
		t.Error("affordable loan should be approved")
	}
	// Unaffordable: 90k EMI on a 240k income (DTI ~450%).
	if g, _, ok := assessLoan(5000000, 90000, 240000, 0, false); ok {
		t.Errorf("unaffordable loan should be declined, got grade %s approved", g)
	}
}
