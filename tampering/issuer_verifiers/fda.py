"""
FDA verifier — interface stub.

A full implementation would query openFDA (api.fda.gov) and/or the
Drugs@FDA dataset. Until that lands, this returns CHANNEL_UNAVAILABLE so
the engine produces a coherent "route to human" verdict.
"""

from __future__ import annotations

from typing import Any

from .base import BaseIssuerVerifier, VerifierResult, VerificationStatus


class FDAStubVerifier(BaseIssuerVerifier):
    issuer = "FDA"

    def verify(self, extracted_fields: dict[str, Any]) -> VerifierResult:
        return VerifierResult(
            issuer=self.issuer,
            status=VerificationStatus.CHANNEL_UNAVAILABLE,
            confidence=0.0,
            source_url="https://open.fda.gov/apis/drug/",
            notes=[
                "FDA verifier not yet implemented. Suggested data sources: "
                "openFDA Drug endpoint, Drugs@FDA download package."
            ],
        )
