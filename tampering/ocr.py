"""
OCR + field extractor.

Extracts structured fields (approval/license number, product, applicant, date)
from a document so that:
- the QR/barcode analyzer can cross-check the payload against the document
- the issuer verifier can look the document up in an authoritative register

Prefers the PDF text layer when available; falls back to Tesseract OCR for
scans and images. Tolerant to label-variant spelling and whitespace.
"""

from __future__ import annotations

import io
import re
from typing import Any

try:
    import fitz  # PyMuPDF
    _HAS_FITZ = True
except Exception:
    _HAS_FITZ = False

try:
    from PIL import Image
    _HAS_PIL = True
except Exception:
    _HAS_PIL = False

try:
    import pytesseract
    _HAS_TESS = True
except Exception:
    _HAS_TESS = False


# --- Label patterns ---------------------------------------------------------
# Each entry: (output_key, regex with one named group `val`).
# Order matters: more specific first. Structured-ID patterns precede
# label-based heuristics so we don't pick up the next word after "Approval".
_FIELD_PATTERNS: list[tuple[str, re.Pattern]] = [
    # Structured agency-prefixed IDs (case-sensitive on the prefix).
    ("approval_no", re.compile(
        r"\b(?P<val>(?:CDSCO|DCGI|FDA|EMA|MD|IND|NOC)[/\-][A-Z0-9][A-Z0-9/\-]{2,30})\b",
    )),
    # Label-based fallback. Requires the value to *start* with an uppercase
    # letter or digit and contain a slash, hyphen, or digit (so plain words
    # like "Letter" don't qualify).
    ("approval_no", re.compile(
        r"(?i:approval|licen[sc]e|registration|permission|permit)"
        r"\s*(?i:no\.?|number|#)?\s*[:\-]\s*"
        r"(?P<val>[A-Z0-9][A-Z0-9/\-]{2,30}(?:[/\-][A-Z0-9]+)+)",
    )),
    ("product_name", re.compile(
        r"(?:product|drug|brand|item)\s*(?:name)?\s*[:\-]\s*(?P<val>[A-Za-z0-9 \-\.\,\(\)\+]{3,80})",
        re.IGNORECASE,
    )),
    ("applicant", re.compile(
        r"(?:applicant|holder|issued\s+to|name\s+of\s+(?:applicant|firm|company))\s*[:\-]\s*"
        r"(?P<val>[A-Za-z0-9 \-\.\,\(\)&]{3,100})",
        re.IGNORECASE,
    )),
    ("approval_date", re.compile(
        r"(?:date\s+of\s+(?:approval|issue|grant)|approval\s+date|issued\s+on)\s*[:\-]\s*"
        r"(?P<val>\d{1,2}[\-/\.\s][A-Za-z0-9]{1,9}[\-/\.\s]\d{2,4})",
        re.IGNORECASE,
    )),
]


def _pdf_text_from_bytes(data: bytes) -> str:
    if not _HAS_FITZ:
        return ""
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception:
        return ""
    try:
        return "\n".join(p.get_text() for p in doc)
    finally:
        try:
            doc.close()
        except Exception:
            pass


def _ocr_image_bytes(data: bytes) -> str:
    if not (_HAS_TESS and _HAS_PIL):
        return ""
    try:
        img = Image.open(io.BytesIO(data))
        return pytesseract.image_to_string(img)
    except Exception:
        return ""


def _ocr_pdf_bytes(data: bytes) -> str:
    if not (_HAS_TESS and _HAS_FITZ and _HAS_PIL):
        return ""
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception:
        return ""
    out: list[str] = []
    try:
        for page in doc:
            pix = page.get_pixmap(dpi=200)
            img = Image.open(io.BytesIO(pix.tobytes("png")))
            try:
                out.append(pytesseract.image_to_string(img))
            except Exception:
                continue
    finally:
        try:
            doc.close()
        except Exception:
            pass
    return "\n".join(out)


def _normalize(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip(" ,.-:;")


def _apply_patterns(text: str) -> dict[str, str]:
    found: dict[str, str] = {}
    for key, pat in _FIELD_PATTERNS:
        if key in found:
            continue
        m = pat.search(text)
        if m:
            val = _normalize(m.group("val"))
            if val:
                found[key] = val
    return found


def extract_fields(
    data: bytes,
    kind: str,
    text_layer: str | None = None,
) -> dict[str, Any]:
    """Extract structured fields from a document.

    Returns a dict including:
      - approval_no, product_name, applicant, approval_date (when found)
      - _raw_text: the full text used for extraction
      - _source: "pdf_text" | "ocr" | "image_ocr" | "none"
    """
    text = ""
    source = "none"

    if kind == "pdf":
        text = text_layer if text_layer is not None else _pdf_text_from_bytes(data)
        if text.strip():
            source = "pdf_text"
        else:
            text = _ocr_pdf_bytes(data)
            if text.strip():
                source = "ocr"
    elif kind == "image":
        text = _ocr_image_bytes(data)
        if text.strip():
            source = "image_ocr"

    fields = _apply_patterns(text)
    fields["_raw_text"] = text
    fields["_source"] = source
    return fields
