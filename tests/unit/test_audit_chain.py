"""Unit tests for the SHA-256 hash-linked audit chain."""
from __future__ import annotations

import hashlib
import json
import time
from typing import Optional


# ── Minimal audit chain implementation (mirrors hq_server.py logic) ──────────

GENESIS_PREV_HASH = "0" * 64


def _compute_entry_hash(seq: int, event_type: str, branch: str, payload_hash: str,
                        prev_hash: str, ts: float) -> str:
    raw = f"{seq}:{event_type}:{branch}:{payload_hash}:{prev_hash}:{ts}"
    return hashlib.sha256(raw.encode()).hexdigest()


class AuditChain:
    def __init__(self) -> None:
        self._entries: list[dict] = []

    def append(self, event_type: str, branch: str, payload_hash: str, details: str) -> dict:
        seq = len(self._entries)
        prev_hash = self._entries[-1]["entry_hash"] if self._entries else GENESIS_PREV_HASH
        ts = time.time()
        entry_hash = _compute_entry_hash(seq, event_type, branch, payload_hash, prev_hash, ts)
        entry = {
            "seq": seq,
            "event_type": event_type,
            "branch": branch,
            "payload_hash": payload_hash,
            "details": details,
            "prev_hash": prev_hash,
            "entry_hash": entry_hash,
            "timestamp": ts,
        }
        self._entries.append(entry)
        return entry

    def verify(self) -> tuple[bool, Optional[int]]:
        """Returns (is_valid, first_bad_seq). None means all valid."""
        for i, entry in enumerate(self._entries):
            expected_prev = self._entries[i - 1]["entry_hash"] if i > 0 else GENESIS_PREV_HASH
            if entry["prev_hash"] != expected_prev:
                return False, i
            recomputed = _compute_entry_hash(
                entry["seq"], entry["event_type"], entry["branch"],
                entry["payload_hash"], entry["prev_hash"], entry["timestamp"]
            )
            if recomputed != entry["entry_hash"]:
                return False, i
        return True, None

    def __len__(self) -> int:
        return len(self._entries)


# ── Tests ────────────────────────────────────────────────────────────────────

def test_genesis_entry_uses_zero_prev_hash():
    chain = AuditChain()
    entry = chain.append("aggregation", "kathmandu", "abc123", "round 1")
    assert entry["prev_hash"] == GENESIS_PREV_HASH
    assert entry["seq"] == 0


def test_second_entry_prev_hash_matches_first():
    chain = AuditChain()
    first = chain.append("aggregation", "kathmandu", "abc123", "round 1")
    second = chain.append("submission", "pokhara", "def456", "round 1 submission")
    assert second["prev_hash"] == first["entry_hash"]


def test_chain_verifies_after_multiple_entries():
    chain = AuditChain()
    for i in range(5):
        chain.append("aggregation", f"branch_{i}", f"hash_{i}", f"round {i}")
    valid, bad_seq = chain.verify()
    assert valid is True
    assert bad_seq is None


def test_tampered_entry_detected_by_verifier():
    chain = AuditChain()
    chain.append("aggregation", "kathmandu", "abc123", "round 1")
    chain.append("submission", "pokhara", "def456", "round 1")
    # Tamper: alter entry_hash of first entry
    chain._entries[0]["entry_hash"] = "deadbeef" * 8
    valid, bad_seq = chain.verify()
    assert valid is False
    # Second entry's prev_hash no longer matches tampered first entry_hash
    assert bad_seq is not None


def test_tampered_payload_hash_detected():
    chain = AuditChain()
    chain.append("aggregation", "kathmandu", "abc123", "round 1")
    # Tamper: modify the payload_hash without recomputing entry_hash
    chain._entries[0]["payload_hash"] = "tampered_hash"
    valid, bad_seq = chain.verify()
    assert valid is False
    assert bad_seq == 0


def test_entry_hashes_are_unique():
    chain = AuditChain()
    for i in range(10):
        chain.append("aggregation", "kathmandu", f"hash_{i}", f"round {i}")
    hashes = [e["entry_hash"] for e in chain._entries]
    assert len(set(hashes)) == 10  # all unique


def test_empty_chain_verifies():
    chain = AuditChain()
    valid, bad_seq = chain.verify()
    assert valid is True
    assert bad_seq is None


def test_seq_numbers_are_sequential():
    chain = AuditChain()
    for i in range(5):
        entry = chain.append("aggregation", "branch", f"h{i}", "")
        assert entry["seq"] == i


def test_chain_length():
    chain = AuditChain()
    assert len(chain) == 0
    chain.append("aggregation", "branch", "h1", "")
    chain.append("rollback", "branch", "h2", "")
    assert len(chain) == 2
