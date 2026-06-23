"""Revision-recovery analyzer: clean vs incrementally-edited PDF."""

from pathlib import Path

import pytest

from engine import (
    analyze_pdf_revisions,
    find_eof_offsets,
    Severity,
    Verdict,
    analyze_document,
)
from issuer_verifiers import CDSCOVerifier
from make_samples import make_clean_pdf, make_tampered_pdf


@pytest.fixture(scope="module")
def clean_pdf() -> bytes:
    return make_clean_pdf().read_bytes()


@pytest.fixture(scope="module")
def tampered_pdf() -> bytes:
    return make_tampered_pdf().read_bytes()


def test_clean_pdf_has_single_eof(clean_pdf):
    offsets = find_eof_offsets(clean_pdf)
    assert len(offsets) == 1


def test_clean_pdf_no_critical_revision_finding(clean_pdf):
    findings, layer = analyze_pdf_revisions(clean_pdf)
    assert layer["revisions"] == 1
    assert all(f.severity != Severity.CRITICAL for f in findings)


def test_tampered_pdf_has_multiple_eofs(tampered_pdf):
    offsets = find_eof_offsets(tampered_pdf)
    assert len(offsets) >= 2


def test_tampered_pdf_recovers_original(tampered_pdf):
    findings, layer = analyze_pdf_revisions(tampered_pdf)
    assert layer["revisions"] >= 2
    crit = [f for f in findings if f.severity == Severity.CRITICAL]
    assert crit, "expected CRITICAL revision-diff finding"
    diff = crit[0].detail
    # The original Applicant line was 'Acme Pharma Pvt Ltd' and the
    # incremental edit replaces it with 'Shadow Trading Co'.
    removed_text = " ".join(diff["removed_lines"]).lower()
    added_text = " ".join(diff["added_lines"]).lower()
    assert "acme pharma" in removed_text or "applicant" in removed_text
    assert "shadow trading" in added_text


def test_full_pipeline_verdict_clean(clean_pdf):
    report = analyze_document(clean_pdf, filename="clean.pdf",
                              issuer_verifier=CDSCOVerifier())
    assert report.verdict == Verdict.NO_STRONG_SIGNAL


def test_full_pipeline_verdict_tampered(tampered_pdf):
    report = analyze_document(tampered_pdf, filename="tampered.pdf",
                              issuer_verifier=CDSCOVerifier())
    assert report.verdict == Verdict.TAMPERING_DETECTED
