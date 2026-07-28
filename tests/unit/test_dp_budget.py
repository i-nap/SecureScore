"""Unit tests for DP budget tracking (persisted in dp_budget_ledger SQLite table)."""
from __future__ import annotations

import sqlite3
import tempfile
import os
from typing import Optional


# ── Minimal DP budget ledger (mirrors Go BFF dp_budget_ledger logic) ─────────

class DPBudgetLedger:
    def __init__(self, db_path: str, total_budget: float = 10.0, per_round_epsilon: float = 1.0):
        self.db_path = db_path
        self.total_budget = total_budget
        self.per_round_epsilon = per_round_epsilon
        self._init_db()

    def _conn(self) -> sqlite3.Connection:
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        with self._conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS dp_budget_ledger (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    round_number INTEGER NOT NULL,
                    epsilon_spent REAL NOT NULL,
                    created_at TEXT DEFAULT (datetime('now'))
                )
            """)

    def record_round(self, round_number: int) -> None:
        remaining = self.get_remaining()
        if remaining < self.per_round_epsilon:
            raise ValueError(f"DP budget exhausted: remaining={remaining:.4f} < epsilon={self.per_round_epsilon}")
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO dp_budget_ledger (round_number, epsilon_spent) VALUES (?, ?)",
                (round_number, self.per_round_epsilon)
            )

    def get_spent(self) -> float:
        with self._conn() as conn:
            row = conn.execute("SELECT COALESCE(SUM(epsilon_spent), 0) FROM dp_budget_ledger").fetchone()
            return float(row[0])

    def get_remaining(self) -> float:
        return max(0.0, self.total_budget - self.get_spent())

    def get_rounds_completed(self) -> int:
        with self._conn() as conn:
            row = conn.execute("SELECT COUNT(*) FROM dp_budget_ledger").fetchone()
            return int(row[0])


# ── Tests ────────────────────────────────────────────────────────────────────

def make_ledger(total: float = 10.0, per_round: float = 1.0) -> DPBudgetLedger:
    tmp = tempfile.mktemp(suffix=".db")
    return DPBudgetLedger(tmp, total_budget=total, per_round_epsilon=per_round)


def test_initial_remaining_equals_total():
    ledger = make_ledger(total=10.0)
    assert ledger.get_remaining() == 10.0


def test_spent_zero_initially():
    ledger = make_ledger()
    assert ledger.get_spent() == 0.0


def test_record_round_decrements_budget():
    ledger = make_ledger(total=5.0, per_round=1.0)
    ledger.record_round(1)
    assert abs(ledger.get_remaining() - 4.0) < 1e-9
    assert abs(ledger.get_spent() - 1.0) < 1e-9


def test_multiple_rounds_accumulate():
    ledger = make_ledger(total=10.0, per_round=1.0)
    for i in range(1, 6):
        ledger.record_round(i)
    assert abs(ledger.get_spent() - 5.0) < 1e-9
    assert abs(ledger.get_remaining() - 5.0) < 1e-9


def test_rounds_completed_count():
    ledger = make_ledger(total=10.0, per_round=1.0)
    assert ledger.get_rounds_completed() == 0
    ledger.record_round(1)
    ledger.record_round(2)
    ledger.record_round(3)
    assert ledger.get_rounds_completed() == 3


def test_budget_exhaustion_raises_error():
    ledger = make_ledger(total=2.0, per_round=1.0)
    ledger.record_round(1)
    ledger.record_round(2)
    # Budget now 0 — next round should fail
    try:
        ledger.record_round(3)
        assert False, "Expected ValueError for exhausted budget"
    except ValueError as e:
        assert "exhausted" in str(e).lower()


def test_survives_restart():
    """Ledger reads from DB so it persists across instances."""
    tmp = tempfile.mktemp(suffix=".db")
    ledger1 = DPBudgetLedger(tmp, total_budget=10.0, per_round_epsilon=1.0)
    ledger1.record_round(1)
    ledger1.record_round(2)

    # Simulate restart by creating a new instance pointing to same file
    ledger2 = DPBudgetLedger(tmp, total_budget=10.0, per_round_epsilon=1.0)
    assert ledger2.get_rounds_completed() == 2
    assert abs(ledger2.get_spent() - 2.0) < 1e-9
    assert abs(ledger2.get_remaining() - 8.0) < 1e-9


def test_remaining_never_negative():
    ledger = make_ledger(total=1.0, per_round=1.0)
    ledger.record_round(1)
    assert ledger.get_remaining() == 0.0
    # Attempting another round raises, remaining stays 0
    try:
        ledger.record_round(2)
    except ValueError:
        pass
    assert ledger.get_remaining() == 0.0


def test_partial_budget_fractional_epsilon():
    ledger = make_ledger(total=5.0, per_round=0.5)
    for i in range(10):
        ledger.record_round(i + 1)
    assert ledger.get_rounds_completed() == 10
    assert abs(ledger.get_remaining()) < 1e-9
