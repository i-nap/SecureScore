package main

import (
	"testing"
	"time"
)

// The demand model must be deterministic, positive, and respect the Saturday
// holiday dip (Saturday demand below the same branch's Friday demand).
func TestModelDemand(t *testing.T) {
	day := time.Date(2026, 6, 12, 0, 0, 0, 0, time.UTC) // a Friday
	a := modelDemand("kathmandu", day)
	b := modelDemand("kathmandu", day)
	if a != b {
		t.Fatalf("modelDemand not deterministic: %v vs %v", a, b)
	}
	if a <= 0 {
		t.Fatalf("modelDemand should be positive, got %v", a)
	}
	fri := modelDemand("pokhara", time.Date(2026, 6, 12, 0, 0, 0, 0, time.UTC))
	sat := modelDemand("pokhara", time.Date(2026, 6, 13, 0, 0, 0, 0, time.UTC))
	if sat >= fri {
		t.Errorf("Saturday demand %v should be below Friday %v (bank holiday)", sat, fri)
	}
}
