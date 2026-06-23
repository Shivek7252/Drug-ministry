"""
Calibration harness.

Runs the engine over a small labelled set and reports per-layer
precision/recall, the confusion matrix, and — most importantly — the
false-AUTHENTIC rate. The harness exposes results both as a pytest
assertion (the false-authentic rate must stay at zero on the bundled set)
and as a `report()` callable for ad-hoc tuning.

Label values: 'genuine' or 'tampered'.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from pathlib import Path

import pytest
from PIL import Image, ImageDraw, ImageFont

from engine import analyze_document, Verdict
from issuer_verifiers import CDSCOVerifier
from make_samples import (
    make_clean_pdf,
    make_tampered_pdf,
    make_tampered_scan,
    _make_scan_base,
)


@dataclass
class Sample:
    name: str
    data: bytes
    filename: str
    label: str  # 'genuine' | 'tampered'


def _clean_scan_bytes() -> bytes:
    img = _make_scan_base()
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def build_samples() -> list[Sample]:
    return [
        Sample("clean_pdf", make_clean_pdf().read_bytes(),
               "clean.pdf", "genuine"),
        Sample("tampered_pdf", make_tampered_pdf().read_bytes(),
               "tampered.pdf", "tampered"),
        Sample("tampered_scan", make_tampered_scan().read_bytes(),
               "tampered_scan.jpg", "tampered"),
        Sample("clean_scan", _clean_scan_bytes(),
               "clean_scan.jpg", "genuine"),
    ]


def report() -> dict:
    """Run all bundled samples and return per-verdict / per-label stats."""
    verifier = CDSCOVerifier()
    confusion: dict[tuple[str, str], int] = {}
    per_sample: list[dict] = []

    for s in build_samples():
        r = analyze_document(s.data, filename=s.filename,
                             issuer_verifier=verifier)
        confusion[(s.label, r.verdict.value)] = (
            confusion.get((s.label, r.verdict.value), 0) + 1
        )
        per_sample.append({
            "sample": s.name,
            "label": s.label,
            "verdict": r.verdict.value,
            "score": r.score,
        })

    # A "false authentic" is the dangerous case: a TAMPERED sample for which
    # the engine returned NO STRONG TAMPER SIGNAL.
    false_authentic = confusion.get(("tampered", Verdict.NO_STRONG_SIGNAL.value), 0)
    tampered_total = sum(v for (lab, _), v in confusion.items() if lab == "tampered")
    genuine_total = sum(v for (lab, _), v in confusion.items() if lab == "genuine")

    return {
        "per_sample": per_sample,
        "confusion": {f"{k[0]}__{k[1]}": v for k, v in confusion.items()},
        "false_authentic_rate": (false_authentic / tampered_total) if tampered_total else 0,
        "tampered_total": tampered_total,
        "genuine_total": genuine_total,
    }


def test_false_authentic_rate_is_zero_on_bundled_set():
    r = report()
    assert r["false_authentic_rate"] == 0, (
        f"DANGEROUS: tampered sample was reported NO STRONG TAMPER SIGNAL.\n"
        f"per-sample: {r['per_sample']}"
    )


def test_clean_samples_dont_flip_to_tampering():
    """Clean samples must never be called TAMPERING DETECTED — that would be
    a false-positive of the worst kind for an operator."""
    r = report()
    bad = r["confusion"].get(f"genuine__{Verdict.TAMPERING_DETECTED.value}", 0)
    assert bad == 0, f"clean samples wrongly promoted to tampering: {r['per_sample']}"


if __name__ == "__main__":
    import json
    print(json.dumps(report(), indent=2))
