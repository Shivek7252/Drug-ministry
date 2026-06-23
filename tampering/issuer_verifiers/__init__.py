"""Pluggable issuer-verification layer.

Each verifier subclasses BaseIssuerVerifier and returns a normalized
VerifierResult. Today: CDSCO (Indian drug regulator), via a locally-synced
snapshot of the public Drugs@CDSCO register. FDA / EMA are present as
interface stubs so the engine returns a coherent CHANNEL_UNAVAILABLE
status until a real implementation lands.

DETECTION-ONLY: verifiers compare a document against an authoritative
register; they never publish, generate, or alter documents.
"""

from .base import (
    BaseIssuerVerifier,
    VerifierResult,
    VerificationStatus,
)
from .cdsco import CDSCOVerifier
from .fda import FDAStubVerifier
from .ema import EMAStubVerifier

__all__ = [
    "BaseIssuerVerifier",
    "VerifierResult",
    "VerificationStatus",
    "CDSCOVerifier",
    "FDAStubVerifier",
    "EMAStubVerifier",
]
