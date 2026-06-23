"""
CDSCO verifier — matches documents against a locally-synced snapshot of the
public Drugs@CDSCO approved-drugs register.

Reality on the ground:
- CDSCO does not expose an authenticated "is-this-approval-valid" API.
- The authoritative public source is the Drugs@CDSCO list published via the
  SUGAM portal at cdscoonline.gov.in. That list ships as downloadable
  CSV/Excel that human users browse.

Therefore this verifier reads a SNAPSHOT (CSV/JSON) that the deployment is
expected to refresh periodically — NOT scrape behind auth/captcha per request.
That keeps the verifier deterministic, offline-runnable, and respectful of
the source. The snapshot path is configurable; a small sample ships under
`snapshots/cdsco_sample.csv` so the engine and tests run out of the box.
"""

from __future__ import annotations

import csv
import json
import re
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

from .base import BaseIssuerVerifier, VerifierResult, VerificationStatus

_SOURCE_URL = "https://cdscoonline.gov.in/CDSCO/Drugs"

_DEFAULT_SNAPSHOT = Path(__file__).parent / "snapshots" / "cdsco_sample.csv"


def _normalize_id(s: str) -> str:
    if not s:
        return ""
    return re.sub(r"[^A-Z0-9]", "", s.upper())


def _normalize_name(s: str) -> str:
    if not s:
        return ""
    return re.sub(r"\s+", " ", s).strip().lower()


def _fuzzy(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


class CDSCOVerifier(BaseIssuerVerifier):
    issuer = "CDSCO"

    def __init__(self, snapshot_path: str | Path | None = None):
        self.snapshot_path = Path(snapshot_path) if snapshot_path else _DEFAULT_SNAPSHOT
        self._records: list[dict[str, str]] = []
        self._by_id: dict[str, dict[str, str]] = {}
        self._loaded = False

    def _load(self) -> None:
        if self._loaded:
            return
        self._loaded = True
        if not self.snapshot_path.exists():
            return
        try:
            if self.snapshot_path.suffix.lower() == ".json":
                self._records = json.loads(self.snapshot_path.read_text(encoding="utf-8"))
            else:
                with self.snapshot_path.open("r", encoding="utf-8", newline="") as fh:
                    self._records = list(csv.DictReader(fh))
        except Exception:
            self._records = []
        for r in self._records:
            rid = _normalize_id(r.get("approval_no", ""))
            if rid:
                self._by_id[rid] = r

    def verify(self, extracted_fields: dict[str, Any]) -> VerifierResult:
        self._load()

        if not self._records:
            return VerifierResult(
                issuer=self.issuer,
                status=VerificationStatus.CHANNEL_UNAVAILABLE,
                confidence=0.0,
                source_url=_SOURCE_URL,
                notes=[
                    "No CDSCO snapshot loaded. Deploy a refreshed "
                    f"snapshot at {self.snapshot_path} to enable verification.",
                ],
            )

        approval_no = extracted_fields.get("approval_no", "")
        product = extracted_fields.get("product_name", "")
        applicant = extracted_fields.get("applicant", "")
        approval_date = extracted_fields.get("approval_date", "")

        id_key = _normalize_id(approval_no)

        # Path 1: exact ID match.
        if id_key and id_key in self._by_id:
            record = self._by_id[id_key]
            return self._compare(record, extracted_fields, exact_id=True)

        # Path 2: no ID OR ID not in register — try fuzzy product-name match.
        if product:
            best_record = None
            best_score = 0.0
            target = _normalize_name(product)
            for r in self._records:
                cand = _normalize_name(r.get("product_name", ""))
                sc = _fuzzy(target, cand)
                if sc > best_score:
                    best_score = sc
                    best_record = r
            if best_record and best_score >= 0.85:
                result = self._compare(best_record, extracted_fields, exact_id=False)
                result.notes.append(
                    f"Matched by product-name similarity ({best_score:.2f}); "
                    "ID was missing or absent from the register. Confirm manually."
                )
                return result

        if id_key:
            return VerifierResult(
                issuer=self.issuer,
                status=VerificationStatus.NOT_FOUND,
                confidence=0.0,
                source_url=_SOURCE_URL,
                mismatched_fields={"approval_no": approval_no},
                notes=[f"Approval number '{approval_no}' not in snapshot."],
            )

        return VerifierResult(
            issuer=self.issuer,
            status=VerificationStatus.CHANNEL_UNAVAILABLE,
            confidence=0.0,
            source_url=_SOURCE_URL,
            notes=[
                "No approval/license number extracted and no high-confidence "
                "product-name match. Route to a human reviewer.",
            ],
        )

    def _compare(
        self,
        record: dict[str, str],
        extracted_fields: dict[str, Any],
        exact_id: bool,
    ) -> VerifierResult:
        matched: dict[str, Any] = {}
        mismatched: dict[str, Any] = {}
        notes: list[str] = []

        def _cmp(key: str, normalizer):
            doc_val = extracted_fields.get(key, "") or ""
            reg_val = record.get(key, "") or ""
            if not doc_val or not reg_val:
                return None  # unknown; don't penalize
            a, b = normalizer(doc_val), normalizer(reg_val)
            return (a == b) or (_fuzzy(a, b) >= 0.9), {"document": doc_val, "register": reg_val}

        for key, normalizer in (
            ("product_name", _normalize_name),
            ("applicant", _normalize_name),
            ("approval_date", lambda s: re.sub(r"\s+", "", s).lower()),
        ):
            r = _cmp(key, normalizer)
            if r is None:
                continue
            ok, pair = r
            (matched if ok else mismatched)[key] = pair

        if exact_id:
            matched["approval_no"] = {
                "document": extracted_fields.get("approval_no", ""),
                "register": record.get("approval_no", ""),
            }
            if mismatched:
                return VerifierResult(
                    issuer=self.issuer,
                    status=VerificationStatus.MISMATCH,
                    confidence=0.95,
                    source_url=_SOURCE_URL,
                    matched_fields=matched,
                    mismatched_fields=mismatched,
                    notes=["ID exists but one or more fields disagree — likely altered."],
                )
            return VerifierResult(
                issuer=self.issuer,
                status=VerificationStatus.VERIFIED,
                confidence=0.92,
                source_url=_SOURCE_URL,
                matched_fields=matched,
                notes=notes,
            )

        # Name-only match path: never high confidence, mandates manual review.
        if mismatched:
            return VerifierResult(
                issuer=self.issuer,
                status=VerificationStatus.MISMATCH,
                confidence=0.5,
                source_url=_SOURCE_URL,
                matched_fields=matched,
                mismatched_fields=mismatched,
                notes=["Name-only match with field disagreements — high risk."],
            )
        return VerifierResult(
            issuer=self.issuer,
            status=VerificationStatus.VERIFIED,
            confidence=0.55,
            source_url=_SOURCE_URL,
            matched_fields=matched,
            notes=["Name-only match. Confirm with the register manually before trusting."],
        )
