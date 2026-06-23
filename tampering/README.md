# Government Document Authentication & Forensics

A detection-only forensics service that inspects uploaded government documents
(PDF or scanned image) and reports whether they show signs of tampering.

> **Detection only.** This system inspects documents and verifies them against
> issuer registers. It does **not** generate, simulate, edit, or instruct the
> creation of forged documents, stamps, signatures, seals, or QR codes.

---

## What it does

Two cooperating halves:

1. **File-forensics engine** — works on every upload with no external access.
   - PDF metadata consistency
   - **Incremental-update / revision recovery** — recovers and diffs earlier
     PDF revisions against the visible final revision; the strongest
     non-cryptographic evidence of post-publication editing.
   - Digital signature validation (pyhanko) — a valid sig is decisive proof of
     byte-level integrity; an invalid sig is direct evidence of alteration.
   - Image forensics on scans: ELA (with base64 heatmap), block-noise
     inconsistency, ORB copy-move self-match. These are supporting heuristics
     and **never** decide a verdict on their own.
   - QR / barcode decode and consistency check vs. document text.
2. **Issuer-verification layer** — confirms the document against the issuing
   authority's published register when an ID is present.
   - **CDSCO** verifier ships in full, backed by a locally-synced snapshot of
     the public Drugs@CDSCO register. (CDSCO exposes no authenticated public
     API, so a snapshot is the correct architecture — not per-request scraping
     behind auth/captcha.)
   - **FDA** and **EMA** are present as interface stubs that return
     `CHANNEL_UNAVAILABLE` so the engine still produces a coherent verdict.

## Verdicts

Three-way, calibrated:

| Verdict | When |
| --- | --- |
| `TAMPERING DETECTED` | Recovered contradictory edits in a prior PDF revision, failed digital signature, or issuer-registry mismatch. Heuristic-only signals **never** reach this. |
| `SUSPICIOUS — HUMAN REVIEW` | Heuristic flags (ELA / noise / clone) or an unverifiable ID. Route to a human. |
| `NO STRONG TAMPER SIGNAL` | Nothing found. **Not** a proof of authenticity. |

### Honest limits

A clean result is *not* proof of authenticity. Flattening (re-export, print-to-PDF,
re-scan) erases the edit history this tool relies on. The system is built to
minimise the dangerous error — a false "authentic" — even at the cost of more
"human review" verdicts. The calibration harness measures and asserts this.

---

## Setup

Requires Python ≥ 3.10.

```bash
pip install -r requirements.txt
```

A few dependencies have native bits:
- **pyzbar** wraps `libzbar`. On Ubuntu: `apt install libzbar0`. On macOS: `brew install zbar`.
- **pytesseract** wraps the Tesseract OCR binary. On Ubuntu: `apt install tesseract-ocr`. On macOS: `brew install tesseract`. Without it, image OCR is silently skipped and the engine falls back to whatever else is available.
- **pyhanko** is pure Python.

The engine degrades gracefully if any optional dependency is missing.

## Run

```bash
# Generate the bundled fixtures (clean PDF, tampered PDF, tampered scan).
python make_samples.py

# Serve the demo UI + JSON API.
uvicorn app:app --port 8000
# → open http://localhost:8000
```

The demo UI accepts drag-and-drop uploads, posts to `/analyze`, and renders the
verdict banner, evidence-backed findings list, the ELA heatmap (for images),
and the raw layer JSON.

### CLI

```bash
python cli.py samples/tampered_approval.pdf
python cli.py samples/tampered_scan.jpg --json
python cli.py path/to/doc.pdf --snapshot path/to/cdsco_full.csv
```

### JSON API

```bash
curl -F "file=@samples/tampered_approval.pdf" http://localhost:8000/analyze | jq
```

Response shape:

```json
{
  "verdict": "TAMPERING DETECTED",
  "score": 60,
  "findings": [{"analyzer": "pdf_revisions", "severity": "CRITICAL", ...}],
  "layers": { "pdf_metadata": {...}, "pdf_revisions": {...}, ... },
  "extracted_fields": { "approval_no": "...", "product_name": "...", ... },
  "ela_heatmap_b64": null,
  "disclaimer": "A clean result is NOT proof of authenticity..."
}
```

## Testing

```bash
pytest -q
```

The test suite covers every analyzer with both genuine and tampered fixtures
and includes a calibration harness (`tests/test_calibration.py`) that runs the
bundled labelled set and reports a confusion matrix. Two of its assertions are
load-bearing:

- the **false-authentic rate** on the bundled set must be zero
- a clean sample must never be promoted to `TAMPERING DETECTED`

To dump the calibration report for tuning, run it as a script:

```bash
python -m tests.test_calibration
```

The harness biases thresholds toward `SUSPICIOUS — HUMAN REVIEW`. A genuine
clean scan may legitimately be reported as suspicious — that's the safe side
of the tradeoff. What it must **never** do is report a tampered document as
`NO STRONG TAMPER SIGNAL`, or a clean document as `TAMPERING DETECTED`, and
both of those constraints are pytest-asserted.

## Architecture

```
engine.py               # analyzers (PDF metadata, revision recovery, image
                        # heuristics, QR consistency) + aggregator + verdict
ela.py                  # ELA computation + base64 PNG heatmap rendering
ocr.py                  # field extractor (PDF text layer → Tesseract fallback)
issuer_verifiers/
    base.py             # BaseIssuerVerifier + VerifierResult
    cdsco.py            # local-snapshot CDSCO verifier (shipped)
    fda.py, ema.py      # interface stubs returning CHANNEL_UNAVAILABLE
    signature.py        # pyhanko PDF digital-signature validation
    snapshots/cdsco_sample.csv
app.py                  # FastAPI: GET / (UI), POST /analyze, GET /healthz
cli.py                  # CLI entry point
make_samples.py         # reproducible test fixtures
tests/                  # per-analyzer tests + calibration harness
```

### Severity → verdict mapping

| Severity | Weight | Notes |
| --- | --- | --- |
| INFO | 0 | reported, no impact |
| LOW | 3 | hint only |
| MEDIUM | 8 | meaningful but not decisive |
| HIGH | 25 | strong signal — promotes to SUSPICIOUS |
| CRITICAL | 60 | decisive — promotes to TAMPERING DETECTED (non-heuristic only) |

Findings from **heuristic** analyzers (`ela`, `noise`, `clone`) are capped at
`SUSPICIOUS` no matter their severity. Only deterministic analyzers
(`pdf_revisions`, `signature`, `issuer`) can decide `TAMPERING DETECTED`.

## Adding a new issuer verifier

```python
from issuer_verifiers.base import BaseIssuerVerifier, VerifierResult, VerificationStatus

class MyVerifier(BaseIssuerVerifier):
    issuer = "MY-REG"
    def verify(self, extracted_fields):
        # look up extracted_fields['approval_no'] in your snapshot / API
        return VerifierResult(
            issuer=self.issuer,
            status=VerificationStatus.VERIFIED,
            confidence=0.9,
            source_url="https://...",
            matched_fields={...},
        )
```

Pass an instance to `analyze_document(..., issuer_verifier=MyVerifier())` or
plug it into `app.py`'s `_VERIFIER`.

## Out of scope

This system does not — and will not — provide any capability to create, alter,
simulate, or teach the creation of forged documents, stamps, signatures, seals,
or QR codes. Detection and verification only.
