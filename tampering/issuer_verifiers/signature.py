"""
Digital signature validation (pyhanko).

A valid signature is *strong* evidence that the byte stream of the document
has not been changed since signing. An invalid signature is direct evidence
of post-signing alteration → CRITICAL.

This module is optional — if pyhanko is not installed, callers receive a
clean no-op.
"""

from __future__ import annotations

import io
from typing import Any

try:
    from pyhanko.pdf_utils.reader import PdfFileReader
    from pyhanko.sign.validation import validate_pdf_signature as _vps
    _HAS_PYHANKO = True
except Exception:
    _HAS_PYHANKO = False


def validate_pdf_signature(pdf_bytes: bytes):
    """Return (findings: list[Finding], layer_detail: dict)."""
    from engine import Finding, Severity  # local import to avoid cycle

    if not _HAS_PYHANKO:
        return [], {"skipped": "pyhanko not installed"}

    findings: list = []
    layer: dict[str, Any] = {"signatures": []}

    try:
        reader = PdfFileReader(io.BytesIO(pdf_bytes))
        sigs = list(reader.embedded_signatures)
    except Exception as e:
        return [], {"skipped": f"reader error: {type(e).__name__}: {e}"}

    if not sigs:
        return [], {"signatures": [], "note": "no embedded signatures"}

    for sig in sigs:
        entry: dict[str, Any] = {"field_name": getattr(sig, "field_name", None)}
        try:  
            status = _vps(sig)
            entry["intact"] = bool(getattr(status, "intact", False))
            entry["valid"] = bool(getattr(status, "valid", False))
            entry["signer"] = str(getattr(status, "signer_cert", "") or "")
            entry["summary"] = status.pretty_print_details() if hasattr(status, "pretty_print_details") else ""

            if entry["intact"] and entry["valid"]:
                findings.append(Finding(
                    "signature", Severity.INFO, "SIG_VALID",
                    f"Digital signature '{entry['field_name']}' is valid and intact.",
                    entry,
                ))
            elif not entry["intact"]:
                findings.append(Finding(
                    "signature", Severity.CRITICAL, "SIG_BROKEN",
                    f"Digital signature '{entry['field_name']}' is INVALID — "
                    "bytes were changed after signing.",
                    entry,
                ))
            else:
                findings.append(Finding(
                    "signature", Severity.HIGH, "SIG_UNTRUSTED",
                    f"Digital signature '{entry['field_name']}' is intact but "
                    "not trusted (issuer not in trust store).",
                    entry,
                ))
        except Exception as e:
            entry["error"] = f"{type(e).__name__}: {e}"
            findings.append(Finding(
                "signature", Severity.LOW, "SIG_VALIDATION_ERROR",
                f"Could not validate signature: {entry['error']}",
                entry,
            ))
        layer["signatures"].append(entry)

    return findings, layer
