"""Base interface for issuer verifiers."""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Any


class VerificationStatus(str, Enum):
    VERIFIED = "VERIFIED"                  # matched register; document is the one on file
    MISMATCH = "MISMATCH"                  # ID found, but content disagrees → CRITICAL
    NOT_FOUND = "NOT_FOUND"                # ID supplied but absent from register → HIGH
    CHANNEL_UNAVAILABLE = "CHANNEL_UNAVAILABLE"  # no snapshot/API, or no ID to look up
    ERROR = "ERROR"                        # verifier blew up


@dataclass
class VerifierResult:
    issuer: str
    status: VerificationStatus
    confidence: float                          # 0..1
    source_url: str | None = None              # for manual re-check
    matched_fields: dict[str, Any] = field(default_factory=dict)
    mismatched_fields: dict[str, Any] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["status"] = self.status.value
        return d

    def to_findings(self) -> list:
        """Convert this result into engine Finding objects."""
        from engine import Finding, Severity
        findings: list = []
        if self.status == VerificationStatus.VERIFIED:
            sev = Severity.INFO
            findings.append(Finding(
                "issuer", sev, "ISSUER_VERIFIED",
                f"Document matched the {self.issuer} register "
                f"(confidence={self.confidence:.2f}).",
                self.to_dict(),
            ))
        elif self.status == VerificationStatus.MISMATCH:
            findings.append(Finding(
                "issuer", Severity.CRITICAL, "ISSUER_MISMATCH",
                f"Document fields disagree with the {self.issuer} register for the supplied ID.",
                self.to_dict(),
            ))
        elif self.status == VerificationStatus.NOT_FOUND:
            findings.append(Finding(
                "issuer", Severity.HIGH, "ISSUER_NOT_FOUND",
                f"Approval/license ID not present in the {self.issuer} register.",
                self.to_dict(),
            ))
        elif self.status == VerificationStatus.CHANNEL_UNAVAILABLE:
            findings.append(Finding(
                "issuer", Severity.LOW, "ISSUER_UNAVAILABLE",
                f"{self.issuer} channel not available — cannot independently verify. "
                "Route to a human for manual confirmation.",
                self.to_dict(),
            ))
        elif self.status == VerificationStatus.ERROR:
            findings.append(Finding(
                "issuer", Severity.LOW, "ISSUER_ERROR",
                f"{self.issuer} verifier failed; manual confirmation required.",
                self.to_dict(),
            ))
        return findings


class BaseIssuerVerifier:
    """All verifiers implement `verify(extracted_fields) -> VerifierResult`."""

    issuer: str = "unknown"

    def verify(self, extracted_fields: dict[str, Any]) -> VerifierResult:
        raise NotImplementedError
