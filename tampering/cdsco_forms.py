"""
CDSCO Form 25 / Form 28 specific analyzer.

Driven by the regulator's own tampering hotspots:
  1. Certificate number       — licence-number format check (G/25/* | G/28/*)
  2. Signature                — flag missing/untrusted sig on a Form 25/28
  3. Licence number           — same as (1)
  4. Manufacturing details    — extract premises + manufacturer for review
  5. Fake product approval    — handled by the issuer verifier (snapshot lookup)
  6. Form 25 / Form 28        — detect the form, then apply (1)-(4) stricter

Form 25 and Form 28 are FDCA (state) manufacturing licences. Genuine copies
are digitally signed by the Commissioner. A Form 25/28 PDF that carries NO
embedded digital signature is a strong forgery signal — that's the central
upgrade this module adds.

Self-contained. Only depends on engine.Finding/Severity (lazy-imported to
avoid a cycle). Safe to call with empty inputs.
"""

from __future__ import annotations

import re
from typing import Any


# A document is a Form 25 / 28 if any of these phrases appears in the text.
# Order matters only for reporting which form was matched.
_FORM_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("FORM_28D", re.compile(r"\bFORM\s*-?\s*28\s*D\b", re.IGNORECASE)),
    ("FORM_28",  re.compile(r"\bFORM\s*-?\s*28\b",      re.IGNORECASE)),
    ("FORM_25",  re.compile(r"\bFORM\s*-?\s*25\b",      re.IGNORECASE)),
    ("FORM_29",  re.compile(r"\bFORM\s*-?\s*29\b",      re.IGNORECASE)),
]

# Gujarat FDCA licence-number format. Form 25 → G/25/NNNNN, Form 28 → G/28/NNNNN.
# Allow optional inner whitespace because OCR sometimes inserts it.
_LICENCE_NUM_RE = re.compile(r"\bG\s*/\s*(?P<form>25|28)\s*/\s*(?P<num>[A-Z0-9\-]{2,})", re.IGNORECASE)

# Whose certificate the Commissioner-signed PDFs should carry.
_EXPECTED_SIGNER_HINTS = (
    "koshia",
    "commissioner",
    "food & drugs control",
    "food and drugs control",
    "fdca",
)

# Premises / manufacturer extraction. Best-effort; emits INFO for human review.
# Stop on a sentence-ending period followed by whitespace (so periods INSIDE
# the address like "Pvt." don't truncate), or on two newlines (paragraph break).
_PREMISES_RE = re.compile(
    r"(?:premises\s+situated\s+at|manufactur(?:e|ing)\s+at|"
    r"address(?:\s+of\s+(?:premises|manufacturing))?)"
    r"\s*[:\-]?\s*(?P<val>[A-Za-z0-9].{15,250}?)(?:\.\s|\n\s*\n|$)",
    re.IGNORECASE | re.DOTALL,
)
# Manufacturer: stop at common transition verbs / newline.
_MANUFACTURER_RE = re.compile(
    r"\bM/?s\.?\s+(?P<val>[A-Z][A-Za-z0-9 \-\.&,\(\)]{3,90}?)"
    r"(?=\s+(?:hereby|is|are|having|holding|located|situated|registered|with)\b|\n|$)",
    re.IGNORECASE,
)


def _make_finding(analyzer: str, severity: str, code: str, message: str, detail: dict):
    """Lazy-import engine types to avoid a circular import at module load."""
    from engine import Finding, Severity
    sev = getattr(Severity, severity)
    return Finding(analyzer=analyzer, severity=sev, code=code, message=message, detail=detail)


def _detect_form(text: str) -> str | None:
    if not text:
        return None
    for name, pat in _FORM_PATTERNS:
        if pat.search(text):
            return name
    return None


def _extract_licence_no(text: str) -> str | None:
    if not text:
        return None
    m = _LICENCE_NUM_RE.search(text)
    if not m:
        return None
    # Reassemble in canonical form so OCR whitespace doesn't pollute output.
    return f"G/{m.group('form')}/{m.group('num').upper()}"


def _extract_premises(text: str) -> str | None:
    if not text:
        return None
    m = _PREMISES_RE.search(text)
    if not m:
        return None
    val = re.sub(r"\s+", " ", m.group("val")).strip(" ,;.-:")
    return val[:300] if val else None


def _extract_manufacturer(text: str) -> str | None:
    if not text:
        return None
    m = _MANUFACTURER_RE.search(text)
    if not m:
        return None
    val = re.sub(r"\s+", " ", m.group("val")).strip(" ,;.-:")
    return val[:150] if val else None


def _signer_is_expected(signer_str: str) -> bool:
    s = (signer_str or "").lower()
    return any(hint in s for hint in _EXPECTED_SIGNER_HINTS)


def analyze_cdsco_forms(
    text: str,
    signature_layer: dict | None = None,
) -> tuple[list, dict]:
    """Run CDSCO-specific hotspot checks.

    Args:
      text: full plain text of the document (PDF text layer or OCR).
      signature_layer: the `layers['signature']` dict the signature analyzer
        produced. May be {} or None when no signature work was done.

    Returns:
      (list[Finding], dict layer_detail).
    """
    findings: list = []
    layer: dict[str, Any] = {
        "form_detected": None,
        "licence_no": None,
        "premises": None,
        "manufacturer": None,
        "signature_check": "not_applicable",
    }

    form = _detect_form(text or "")
    layer["form_detected"] = form

    if form is None:
        # Not a Form 25/28/28D/29 document — nothing extra to do.
        return findings, layer

    findings.append(_make_finding(
        "cdsco_forms", "INFO", "FORM25_28_DETECTED",
        f"Document appears to be a CDSCO/FDCA {form.replace('_', ' ')}. "
        "Applying form-specific tampering checks.",
        {"form": form},
    ))

    # --- Licence-number format check (hotspots #1 + #3) ---------------------
    licence = _extract_licence_no(text or "")
    layer["licence_no"] = licence

    expected_prefix = "G/25/" if form == "FORM_25" else "G/28/" if form.startswith("FORM_28") else None
    if expected_prefix:
        if licence is None:
            findings.append(_make_finding(
                "cdsco_forms", "MEDIUM", "LICENCE_FORMAT_INVALID",
                f"{form.replace('_', ' ')} detected but no licence number in the expected "
                f"Gujarat FDCA format ({expected_prefix}NNNNN) was found.",
                {"expected_prefix": expected_prefix},
            ))
        elif not licence.upper().startswith(expected_prefix):
            findings.append(_make_finding(
                "cdsco_forms", "MEDIUM", "LICENCE_FORMAT_INVALID",
                f"{form.replace('_', ' ')} carries licence '{licence}' which does not match "
                f"the expected Gujarat FDCA prefix '{expected_prefix}'.",
                {"licence": licence, "expected_prefix": expected_prefix},
            ))
        else:
            findings.append(_make_finding(
                "cdsco_forms", "INFO", "LICENCE_FORMAT_OK",
                f"Licence number '{licence}' has the expected format for this form.",
                {"licence": licence},
            ))

    # --- Signature requirement (hotspot #2 + #6) ----------------------------
    sigs = (signature_layer or {}).get("signatures") or []
    if not sigs:
        layer["signature_check"] = "missing"
        findings.append(_make_finding(
            "cdsco_forms", "HIGH", "SIG_MISSING_ON_FORM",
            f"{form.replace('_', ' ')} carries NO embedded digital signature. "
            "Genuine FDCA-issued copies are digitally signed by the Commissioner. "
            "Absent signature is a strong forgery signal for this form type.",
            {"form": form},
        ))
    else:
        # Inspect each signature: intact + valid + expected signer.
        any_intact = False
        any_expected = False
        sig_summary: list[dict] = []
        for s in sigs:
            intact = bool(s.get("intact"))
            valid = bool(s.get("valid"))
            signer = str(s.get("signer", "") or "")
            expected = _signer_is_expected(signer)
            sig_summary.append({
                "field": s.get("field_name"),
                "intact": intact, "valid": valid,
                "signer_expected": expected,
                "signer_preview": signer[:160],
            })
            any_intact = any_intact or intact
            any_expected = any_expected or expected

        layer["signature_check"] = sig_summary
        if not any_intact:
            # Already covered by SIG_BROKEN at CRITICAL; don't double-fire.
            pass
        elif not any_expected:
            findings.append(_make_finding(
                "cdsco_forms", "HIGH", "SIG_SIGNER_MISMATCH",
                f"{form.replace('_', ' ')} is digitally signed, but the signer "
                "certificate does not name the expected FDCA Commissioner. "
                "Verify the issuing CA out-of-band.",
                {"form": form, "signatures": sig_summary,
                 "expected_signer_hints": list(_EXPECTED_SIGNER_HINTS)},
            ))

    # --- Manufacturing details extraction (hotspot #4) ----------------------
    premises = _extract_premises(text or "")
    manufacturer = _extract_manufacturer(text or "")
    layer["premises"] = premises
    layer["manufacturer"] = manufacturer
    if premises or manufacturer:
        findings.append(_make_finding(
            "cdsco_forms", "INFO", "PREMISES_EXTRACTED",
            "Extracted manufacturing details for human cross-reference against "
            "the registered premises on file with FDCA.",
            {"premises": premises, "manufacturer": manufacturer},
        ))

    return findings, layer
