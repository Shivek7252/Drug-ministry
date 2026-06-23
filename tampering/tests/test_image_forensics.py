"""ELA / noise / clone analyzers on real (synthetic) images."""

import io
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from engine import (
    analyze_image_ela,
    analyze_image_noise,
    analyze_image_clone,
    analyze_document,
    Severity,
    Verdict,
)
from make_samples import make_tampered_scan, _make_scan_base


@pytest.fixture(scope="module")
def tampered_image() -> Image.Image:
    path = make_tampered_scan()
    return Image.open(path).convert("RGB")


@pytest.fixture(scope="module")
def clean_image() -> Image.Image:
    img = _make_scan_base()
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    buf.seek(0)
    return Image.open(buf).convert("RGB")


def test_ela_localizes_tampered_region(tampered_image):
    findings, detail, heat = analyze_image_ela(tampered_image)
    assert detail.get("suspect_bbox") is not None
    codes = {f.code for f in findings}
    assert "ELA_LOCALIZED_HOTSPOT" in codes or "ELA_DIFFUSE_HIGH" in codes
    assert heat is not None and len(heat) > 0


def test_ela_clean_image_no_localized_hotspot(clean_image):
    findings, detail, _ = analyze_image_ela(clean_image)
    assert not any(f.code == "ELA_LOCALIZED_HOTSPOT" and f.severity == Severity.HIGH
                   for f in findings)


def test_ela_skips_low_texture():
    img = Image.new("RGB", (400, 400), (240, 240, 240))
    findings, detail, heat = analyze_image_ela(img)
    assert "skipped" in detail
    assert findings == []
    assert heat is None


def test_noise_skips_low_texture():
    img = Image.new("RGB", (400, 400), (200, 200, 200))
    findings, detail = analyze_image_noise(img)
    assert "skipped" in detail
    assert findings == []


def test_clone_skips_low_texture():
    img = Image.new("RGB", (400, 400), (200, 200, 200))
    findings, detail = analyze_image_clone(img)
    assert "skipped" in detail
    assert findings == []


def test_clone_no_finding_for_clean_image(clean_image):
    findings, detail = analyze_image_clone(clean_image)
    # Clone detector is allowed to under-fire on natural images.
    for f in findings:
        assert f.severity == Severity.LOW


def test_tampered_image_verdict_is_suspicious_not_tampered():
    """Heuristic-only signals must NOT promote to TAMPERING DETECTED."""
    data = Path("samples/tampered_scan.jpg").read_bytes()
    report = analyze_document(data, filename="tampered_scan.jpg",
                              issuer_verifier=None)
    assert report.verdict in (Verdict.SUSPICIOUS, Verdict.NO_STRONG_SIGNAL)
    assert report.verdict != Verdict.TAMPERING_DETECTED
