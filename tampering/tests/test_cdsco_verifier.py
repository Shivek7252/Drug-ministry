"""CDSCO verifier: each of VERIFIED / MISMATCH / NOT_FOUND / CHANNEL_UNAVAILABLE paths."""

from issuer_verifiers import CDSCOVerifier, VerificationStatus


def test_exact_id_match_verified():
    v = CDSCOVerifier()
    r = v.verify({
        "approval_no": "CDSCO/IND/2021/00482",
        "product_name": "Paracetamol IP 500mg Tablets",
        "applicant": "Acme Pharma Pvt Ltd",
        "approval_date": "12 Jan 2021",
    })
    assert r.status == VerificationStatus.VERIFIED
    assert r.confidence >= 0.9


def test_exact_id_with_field_disagreement_is_mismatch():
    v = CDSCOVerifier()
    r = v.verify({
        "approval_no": "CDSCO/IND/2021/00482",
        "product_name": "Paracetamol IP 500mg Tablets",
        "applicant": "Shadow Trading Co",
        "approval_date": "12 Jan 2021",
    })
    assert r.status == VerificationStatus.MISMATCH
    assert "applicant" in r.mismatched_fields


def test_unknown_id_not_found():
    v = CDSCOVerifier()
    r = v.verify({
        "approval_no": "CDSCO/IND/9999/99999",
        "product_name": "Mystery Tablet",
    })
    assert r.status == VerificationStatus.NOT_FOUND


def test_no_id_no_match_channel_unavailable():
    v = CDSCOVerifier()
    r = v.verify({"product_name": "Completely Unrelated Brand X"})
    assert r.status == VerificationStatus.CHANNEL_UNAVAILABLE


def test_name_only_high_confidence_match_is_lower_confidence_verified():
    v = CDSCOVerifier()
    r = v.verify({
        "product_name": "Paracetamol IP 500mg Tablets",
        "applicant": "Acme Pharma Pvt Ltd",
    })
    assert r.status == VerificationStatus.VERIFIED
    assert r.confidence < 0.8  # name-only never high-confidence
    assert any("Confirm" in n or "Name-only" in n for n in r.notes)


def test_missing_snapshot_channel_unavailable(tmp_path):
    v = CDSCOVerifier(snapshot_path=tmp_path / "does_not_exist.csv")
    r = v.verify({"approval_no": "CDSCO/IND/2021/00482"})
    assert r.status == VerificationStatus.CHANNEL_UNAVAILABLE
