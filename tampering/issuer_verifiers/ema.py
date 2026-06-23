"""
EMA verifier — interface stub.

A full implementation would query the EMA medicines register
(https://www.ema.europa.eu/en/medicines) — typically a downloadable
XML/CSV refreshed periodically.
"""

from __future__ import annotations

from typing import Any

from .base import BaseIssuerVerifier, VerifierResult, VerificationStatus


class EMAStubVerifier(BaseIssuerVerifier):
    issuer = "EMA"

    def verify(self, extracted_fields: dict[str, Any]) -> VerifierResult:
        return VerifierResult(
            issuer=self.issuer,
            status=VerificationStatus.CHANNEL_UNAVAILABLE,
            confidence=0.0,
            source_url="https://www.ema.europa.eu/en/medicines",
            notes=[
                "EMA verifier not yet implemented. Suggested data source: "
                "EMA medicines download (XML/CSV)."
            ],
        )
