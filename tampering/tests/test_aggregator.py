"""Aggregator: verdict logic, heuristic gating, score weighting."""

from engine import (
    Finding,
    Severity,
    Verdict,
    decide_verdict,
    detect_kind,
)


def test_detect_kind_pdf():
    assert detect_kind(b"%PDF-1.7\nstuff") == "pdf"


def test_detect_kind_jpeg():
    assert detect_kind(b"\xff\xd8\xff\xe0rest") == "image"


def test_detect_kind_png():
    assert detect_kind(b"\x89PNG\r\n\x1a\nrest") == "image"


def test_no_findings_no_strong_signal():
    v, score = decide_verdict([])
    assert v == Verdict.NO_STRONG_SIGNAL
    assert score == 0


def test_deterministic_critical_promotes_to_tampering():
    findings = [
        Finding("pdf_revisions", Severity.CRITICAL, "REV_CONTENT_DIFF", "x"),
    ]
    v, _ = decide_verdict(findings)
    assert v == Verdict.TAMPERING_DETECTED


def test_signature_critical_promotes_to_tampering():
    findings = [
        Finding("signature", Severity.CRITICAL, "SIG_BROKEN", "x"),
    ]
    v, _ = decide_verdict(findings)
    assert v == Verdict.TAMPERING_DETECTED


def test_issuer_mismatch_promotes_to_tampering():
    findings = [
        Finding("issuer", Severity.CRITICAL, "ISSUER_MISMATCH", "x"),
    ]
    v, _ = decide_verdict(findings)
    assert v == Verdict.TAMPERING_DETECTED


def test_heuristic_only_cannot_reach_tampering_even_at_critical():
    """A lone ELA / noise / clone signal — even rated CRITICAL — must not promote."""
    findings = [
        Finding("ela", Severity.CRITICAL, "ELA_LOCALIZED_HOTSPOT", "x"),
    ]
    v, _ = decide_verdict(findings)
    assert v == Verdict.SUSPICIOUS


def test_high_severity_is_suspicious():
    findings = [
        Finding("issuer", Severity.HIGH, "ISSUER_NOT_FOUND", "x"),
    ]
    v, _ = decide_verdict(findings)
    assert v == Verdict.SUSPICIOUS


def test_accumulated_mediums_promote_to_suspicious():
    findings = [
        Finding("ela", Severity.MEDIUM, "ELA_LOCALIZED_HOTSPOT", "x"),
        Finding("noise", Severity.MEDIUM, "NOISE_BLOCK_OUTLIER", "x"),
        Finding("pdf_metadata", Severity.MEDIUM, "META_MOD_BEFORE_CREATE", "x"),
    ]
    v, score = decide_verdict(findings)
    assert v == Verdict.SUSPICIOUS
    assert score >= 20


def test_only_lows_stays_no_strong_signal():
    findings = [
        Finding("pdf_metadata", Severity.LOW, "META_EDIT_TOOL_PRODUCER", "x"),
    ]
    v, _ = decide_verdict(findings)
    assert v == Verdict.NO_STRONG_SIGNAL
