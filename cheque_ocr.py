"""
cheque_ocr.py — On-device cheque OCR for auto-deposit.

Runs at the branch edge node so the cheque image (PII) never leaves the branch,
satisfying the federated privacy invariant. EasyOCR (pure-Python, reuses the
torch already installed for XGBoost/SHAP) does the raw character recognition;
everything else here — preprocessing, the amount words→digits cross-check,
MICR-band parsing, and per-field confidence — is the bank-grade pipeline on top.

extract_cheque_fields(image_bytes) -> dict with amount / amount_in_words /
amount_in_words_value / amount_match / payee / account_number / cheque_number /
routing_number / date / bank_name / field_confidence / review_reasons.
Fields are confirmable/editable by the teller before posting.
"""

from __future__ import annotations

import io
import re
import logging
from typing import Optional

logger = logging.getLogger(__name__)

_reader = None  # lazy EasyOCR singleton — first load is slow + downloads the model


def _get_reader():
    """Lazy-init the EasyOCR reader (heavy: model load + optional download)."""
    global _reader
    if _reader is None:
        import easyocr  # imported lazily so the edge starts without OCR cost
        # gpu=False: deterministic on any host; cheques are small so CPU is fine.
        _reader = easyocr.Reader(["en"], gpu=False, verbose=False)
        logger.info("EasyOCR reader initialised (en, cpu)")
    return _reader


# ── Preprocessing ───────────────────────────────────────────────────────────
# Grayscale + autocontrast + upscale lifts recognition on phone photos of
# cheques. Returns a numpy array EasyOCR can read, or the raw bytes on any error.
# ponytail: no deskew yet (needs cv2/Hough); add it if rotated scans show up.

def _preprocess(image_bytes: bytes):
    try:
        from PIL import Image, ImageOps
        import numpy as np

        img = Image.open(io.BytesIO(image_bytes)).convert("L")
        img = ImageOps.autocontrast(img, cutoff=1)
        if img.width < 1200:  # upscale small captures so thin strokes survive
            scale = 1200 / img.width
            img = img.resize((1200, max(1, int(img.height * scale))))
        return np.array(img)
    except Exception as exc:  # Pillow/numpy missing or undecodable image
        logger.debug("cheque preprocess skipped: %s", exc)
        return image_bytes


# ── Amount words → number (self-built, Nepali lakh/crore aware) ──────────────

_ONES = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
    "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
    "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
    "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20, "thirty": 30,
    "forty": 40, "fourty": 40, "fifty": 50, "sixty": 60, "seventy": 70,
    "eighty": 80, "ninety": 90,
}
# Scales that flush the running group into the total. Ordered by magnitude so the
# Indian/Nepali system (lakh = 1e5, crore = 1e7) composes correctly.
_SCALES = {
    "hundred": 100, "thousand": 1000, "lakh": 100000, "lac": 100000,
    "lakhs": 100000, "million": 1000000, "crore": 10000000, "crores": 10000000,
}


def words_to_number(text: str) -> Optional[float]:
    """Parse an English amount-in-words into a number. Handles lakh/crore.

    'rupees twenty five thousand three hundred only' -> 25300
    'five lakh twenty thousand' -> 520000
    """
    words = re.findall(r"[a-z]+", text.lower())
    if not words:
        return None
    total = 0
    current = 0
    seen = False
    for w in words:
        if w in ("rupees", "rupee", "only", "and", "rs", "npr", "inr"):
            continue
        if w in _ONES:
            current += _ONES[w]
            seen = True
        elif w == "hundred":
            current = (current or 1) * 100
            seen = True
        elif w in _SCALES:
            total += (current or 1) * _SCALES[w]
            current = 0
            seen = True
        # unknown tokens (names, 'paisa', noise) are ignored
    if not seen:
        return None
    return float(total + current)


# ── Field extraction heuristics ─────────────────────────────────────────────

_DATE_RE = re.compile(r"\b(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{2,4})\b")
_AMOUNT_RE = re.compile(r"(?:rs|inr|npr|₹|=)?\s*([0-9][0-9,]{2,}(?:\.\d{1,2})?)", re.IGNORECASE)
_DIGITS_RE = re.compile(r"\d[\d ]{4,}\d")  # digit runs >= 6 chars (account / MICR)


def _parse_amount(text: str) -> Optional[float]:
    """Pick the most cheque-amount-like number from a text fragment."""
    best = None
    for m in _AMOUNT_RE.finditer(text):
        raw = m.group(1).replace(",", "")
        try:
            val = float(raw)
        except ValueError:
            continue
        if val >= 10 and (best is None or val > best):
            best = val
    return best


def _box_y(box) -> float:
    """Mean vertical position of an EasyOCR bounding box (4 points)."""
    try:
        return sum(float(p[1]) for p in box) / len(box)
    except Exception:
        return 0.0


def extract_cheque_fields(image_bytes: bytes) -> dict:
    """OCR a cheque image and return structured, teller-confirmable fields."""
    reader = _get_reader()
    results = reader.readtext(_preprocess(image_bytes), detail=1, paragraph=False)

    # Keep text, confidence, and vertical position (for the MICR band).
    lines = []
    max_y = 0.0
    for (box, t, conf) in results:
        if not t or not t.strip():
            continue
        y = _box_y(box)
        max_y = max(max_y, y)
        lines.append({"text": t.strip(), "confidence": round(float(conf), 3), "y": y})

    full_text = "\n".join(l["text"] for l in lines)

    fields: dict = {
        "amount": None, "amount_in_words": None, "amount_in_words_value": None,
        "amount_match": None, "payee": None, "account_number": None,
        "cheque_number": None, "routing_number": None, "date": None, "bank_name": None,
    }
    field_conf: dict = {}
    reasons: list[str] = []

    # Date
    md = _DATE_RE.search(full_text)
    if md:
        d, m, y = md.groups()
        if len(y) == 2:
            y = "20" + y
        fields["date"] = f"{int(d):02d}/{int(m):02d}/{y}"

    # Amount (digits): prefer a line with a currency cue, else the largest number.
    amount = None
    for l in lines:
        lt = l["text"].lower()
        if any(c in lt for c in ("rs", "inr", "npr", "₹", "=")):
            amount = _parse_amount(l["text"])
            if amount:
                field_conf["amount"] = l["confidence"]
                break
    if amount is None:
        amount = _parse_amount(full_text)
    fields["amount"] = amount

    # Amount in words + parsed value + cross-check against the digit amount.
    for l in lines:
        if "rupee" in l["text"].lower():
            fields["amount_in_words"] = l["text"]
            field_conf["amount_in_words"] = l["confidence"]
            break
    if fields["amount_in_words"]:
        wv = words_to_number(fields["amount_in_words"])
        fields["amount_in_words_value"] = wv
        if wv is not None and amount is not None:
            fields["amount_match"] = abs(wv - amount) < 1.0
            if not fields["amount_match"]:
                reasons.append(
                    f"amount mismatch: words={wv:g} vs digits={amount:g}")

    # Payee
    for i, l in enumerate(lines):
        lt = l["text"].lower()
        if lt.startswith("pay") or "pay to" in lt:
            payee = re.sub(r"(?i)pay\s*(to the order of|to|:)?", "", l["text"]).strip(" :-")
            if not payee and i + 1 < len(lines):
                payee = lines[i + 1]["text"].strip()
                field_conf["payee"] = lines[i + 1]["confidence"]
            else:
                field_conf["payee"] = l["confidence"]
            if payee:
                fields["payee"] = payee
                break

    # MICR band: the strip across the bottom carries cheque no / account /
    # routing as long digit runs. Restrict to the bottom ~20% of detections when
    # we have positions, so account/cheque numbers from the body don't pollute it.
    micr_lines = lines
    if max_y > 0:
        band = [l for l in lines if l["y"] >= 0.8 * max_y]
        if band:
            micr_lines = band
    micr_text = "\n".join(l["text"] for l in micr_lines)
    digit_runs = [re.sub(r"\s", "", m.group(0)) for m in _DIGITS_RE.finditer(micr_text)]
    digit_runs = [d for d in digit_runs if d.isdigit()]
    if digit_runs:
        fields["account_number"] = max(digit_runs, key=len)
        six = [d for d in digit_runs if len(d) == 6]
        if six:
            fields["cheque_number"] = six[0]
        # A routing/branch code is a mid-length run (3–9) that isn't the account.
        routing = [d for d in digit_runs if 3 <= len(d) <= 9 and d != fields["cheque_number"] and d != fields["account_number"]]
        if routing:
            fields["routing_number"] = routing[0]

    # Bank name
    for l in lines[:6]:
        if "bank" in l["text"].lower():
            fields["bank_name"] = l["text"]
            field_conf["bank_name"] = l["confidence"]
            break

    # Overall confidence: mean of detected-line confidences.
    conf = round(sum(l["confidence"] for l in lines) / len(lines), 3) if lines else 0.0

    # Review reasons — surfaced to the teller so low-trust extractions are checked.
    if amount is None:
        reasons.append("amount not detected")
    if conf < 0.5:
        reasons.append(f"low overall OCR confidence ({conf:.2f})")
    if fields["amount_in_words"] and fields["amount_in_words_value"] is None:
        reasons.append("could not parse amount-in-words")

    # Strip the helper 'y' before returning the raw lines.
    raw_lines = [{"text": l["text"], "confidence": l["confidence"]} for l in lines]

    return {
        "fields": fields,
        "field_confidence": field_conf,
        "overall_confidence": conf,
        "amount_verified": bool(fields["amount_match"]),
        "raw_lines": raw_lines,
        "review_reasons": reasons,
        "needs_review": bool(reasons) or fields["amount_match"] is False,
    }


if __name__ == "__main__":
    # ponytail self-check: words→number parser + field heuristics on synthetic
    # OCR output (no model needed).
    import sys

    assert words_to_number("rupees twenty five thousand only") == 25000.0
    assert words_to_number("five lakh twenty thousand") == 520000.0
    assert words_to_number("two crore fifty lakh") == 25000000.0
    assert words_to_number("three hundred") == 300.0
    assert words_to_number("not a number xyz") is None

    class _FakeReader:
        def readtext(self, _img, detail=1, paragraph=False):
            sample = [
                "NEPAL INVESTMENT BANK", "Pay  Aarav Thapa",
                "Rupees Twenty Five Thousand Only", "Rs 25,000.00",
                "Date 11/06/2026", "A/C 0123456789012", "001234",
            ]
            # Synthetic boxes: stack top→bottom so the MICR band lands last.
            return [([[0, i * 50], [10, i * 50], [10, i * 50 + 20], [0, i * 50 + 20]], t, 0.9)
                    for i, t in enumerate(sample)]

    _reader = _FakeReader()
    out = extract_cheque_fields(b"")
    f = out["fields"]
    assert f["amount"] == 25000.0, f["amount"]
    assert f["amount_in_words_value"] == 25000.0, f["amount_in_words_value"]
    assert f["amount_match"] is True, f["amount_match"]
    assert out["amount_verified"] is True
    assert f["payee"] == "Aarav Thapa", f["payee"]
    assert f["date"] == "11/06/2026", f["date"]
    assert f["account_number"] == "0123456789012", f["account_number"]
    assert f["cheque_number"] == "001234", f["cheque_number"]
    assert "BANK" in (f["bank_name"] or "").upper()
    assert out["needs_review"] is False, out["review_reasons"]

    # A mismatched cheque must be flagged for review.
    class _MismatchReader(_FakeReader):
        def readtext(self, _img, detail=1, paragraph=False):
            sample = ["Pay Sita Rai", "Rupees Ten Thousand Only", "Rs 99,000.00"]
            return [([[0, i * 50], [10, i * 50], [10, i * 50 + 20], [0, i * 50 + 20]], t, 0.9)
                    for i, t in enumerate(sample)]

    _reader = _MismatchReader()
    out2 = extract_cheque_fields(b"")
    assert out2["fields"]["amount_match"] is False
    assert out2["needs_review"] is True
    assert any("mismatch" in r for r in out2["review_reasons"])

    print("cheque_ocr self-check passed:", f)
    sys.exit(0)
