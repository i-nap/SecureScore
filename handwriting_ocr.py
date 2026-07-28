"""
handwriting_ocr.py — On-device handwriting → text digitisation.

Runs at the branch edge so the page image (PII) never leaves the branch. The
pipeline is detection + recognition: EasyOCR (already loaded for cheques) acts
purely as the *text-region detector*, and Microsoft's TrOCR handwriting
transformer is the *recognizer* run on each region crop. Combining a strong
detector with a handwriting-specialised recognizer reads cursive far better than
either alone. If TrOCR isn't installed, it degrades to EasyOCR's own text so the
endpoint always returns something.

extract_handwriting(image_bytes) -> {text, lines, engine, confidence}.
"""

from __future__ import annotations

import io
import logging
from typing import Optional

logger = logging.getLogger(__name__)

_trocr = None  # (processor, model) singleton; lazy + heavy first load


def _get_detector():
    # Reuse the EasyOCR singleton from the cheque pipeline — one model, two uses.
    import cheque_ocr
    return cheque_ocr._get_reader()


def _get_trocr():
    """Lazy-load TrOCR (microsoft/trocr-base-handwritten). None if unavailable."""
    global _trocr
    if _trocr is None:
        try:
            from transformers import TrOCRProcessor, VisionEncoderDecoderModel
            name = "microsoft/trocr-base-handwritten"
            proc = TrOCRProcessor.from_pretrained(name)
            model = VisionEncoderDecoderModel.from_pretrained(name)
            model.eval()
            _trocr = (proc, model)
            logger.info("TrOCR handwriting recognizer loaded")
        except Exception as exc:  # transformers/torch missing or offline
            logger.warning("TrOCR unavailable, falling back to EasyOCR text: %s", exc)
            _trocr = False  # sentinel: tried and failed
    return _trocr or None


def _bbox_rect(box) -> tuple:
    """Axis-aligned (x0, y0, x1, y1) from an EasyOCR polygon box."""
    xs = [float(p[0]) for p in box]
    ys = [float(p[1]) for p in box]
    return (min(xs), min(ys), max(xs), max(ys))


def _assemble_lines(items: list) -> list:
    """Order detected regions into human reading order and group into lines.

    items: list of (box, text, confidence). Returns list of
    {"text", "confidence"} — one entry per visual line, top→bottom, with regions
    within a line ordered left→right. Pure geometry, no model — unit-tested.
    """
    if not items:
        return []
    enriched = []
    heights = []
    for box, text, conf in items:
        x0, y0, x1, y1 = _bbox_rect(box)
        enriched.append({"x": x0, "y": y0, "cy": (y0 + y1) / 2, "h": y1 - y0,
                         "text": (text or "").strip(), "conf": float(conf)})
        heights.append(y1 - y0)
    enriched = [e for e in enriched if e["text"]]
    if not enriched:
        return []
    med_h = sorted(heights)[len(heights) // 2] or 1.0

    enriched.sort(key=lambda e: e["cy"])
    lines = []
    current = [enriched[0]]
    for e in enriched[1:]:
        # Same line if vertical centres are within ~60% of a median glyph height.
        if abs(e["cy"] - current[-1]["cy"]) <= 0.6 * med_h:
            current.append(e)
        else:
            lines.append(current)
            current = [e]
    lines.append(current)

    out = []
    for ln in lines:
        ln.sort(key=lambda e: e["x"])
        text = " ".join(e["text"] for e in ln)
        conf = round(sum(e["conf"] for e in ln) / len(ln), 3)
        out.append({"text": text, "confidence": conf})
    return out


def _recognize_crop(proc, model, crop_rgb) -> Optional[str]:
    import torch
    pixel_values = proc(images=crop_rgb, return_tensors="pt").pixel_values
    with torch.no_grad():
        generated = model.generate(pixel_values, max_length=64)
    return proc.batch_decode(generated, skip_special_tokens=True)[0].strip()


def extract_handwriting(image_bytes: bytes) -> dict:
    """Digitise handwritten text from an image."""
    from PIL import Image
    import cheque_ocr

    detector = _get_detector()
    regions = detector.readtext(cheque_ocr._preprocess(image_bytes), detail=1, paragraph=False)
    regions = [(b, t, c) for (b, t, c) in regions if t and t.strip()]

    trocr = _get_trocr()
    engine = "easyocr"
    if trocr is not None and regions:
        # Recognise each detected region with TrOCR on the original colour image.
        proc, model = trocr
        try:
            page = Image.open(io.BytesIO(image_bytes)).convert("RGB")
            rebuilt = []
            for box, fallback_text, conf in regions:
                x0, y0, x1, y1 = _bbox_rect(box)
                pad = int(0.05 * max(1.0, y1 - y0))
                crop = page.crop((max(0, int(x0) - pad), max(0, int(y0) - pad),
                                  int(x1) + pad, int(y1) + pad))
                text = _recognize_crop(proc, model, crop) or fallback_text
                rebuilt.append((box, text, conf))
            regions = rebuilt
            engine = "trocr"
        except Exception as exc:
            logger.warning("TrOCR recognition failed, using EasyOCR text: %s", exc)

    lines = _assemble_lines(regions)
    text = "\n".join(l["text"] for l in lines)
    conf = round(sum(l["confidence"] for l in lines) / len(lines), 3) if lines else 0.0
    return {
        "text": text,
        "lines": lines,
        "engine": engine,
        "overall_confidence": conf,
        "line_count": len(lines),
    }


if __name__ == "__main__":
    # ponytail self-check: reading-order assembly (no model needed).
    import sys

    def box(x0, y0, x1, y1):
        return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]

    # Two lines, regions given out of order — must come back ordered.
    items = [
        (box(120, 10, 200, 40), "world", 0.8),   # line 1, right
        (box(10, 10, 100, 40), "Hello", 0.9),     # line 1, left
        (box(10, 70, 90, 100), "second", 0.7),    # line 2, left
        (box(100, 72, 180, 102), "line", 0.6),    # line 2, right
    ]
    lines = _assemble_lines(items)
    assert [l["text"] for l in lines] == ["Hello world", "second line"], lines
    assert _assemble_lines([]) == []
    assert _assemble_lines([(box(0, 0, 10, 10), "  ", 0.5)]) == []
    print("handwriting_ocr self-check passed:", lines)
    sys.exit(0)
