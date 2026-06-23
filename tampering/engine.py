"""
Forensic analyzer engine for government document authentication.

DETECTION-ONLY. This module inspects documents for signs of tampering. It does
not, and must not, generate, simulate, or instruct on the production of forged
documents, stamps, signatures, QR codes, or seals.

Architecture:
- Each analyzer is an independent function returning list[Finding].
- An aggregator combines analyzer findings into a single calibrated Report.
- Heuristic analyzers (ELA / noise / clone) can produce SUSPICIOUS at most;
  only deterministic findings (recovered prior revision, failed digital
  signature, issuer-registry mismatch) can produce TAMPERING DETECTED.

Optional heavy dependencies (pyzbar, opencv, pyhanko, tesseract) are imported
lazily so the engine degrades gracefully when something is missing.
"""

from __future__ import annotations

import difflib
import io
import re
from dataclasses import dataclass, field, asdict
from enum import Enum
from pathlib import Path
from typing import Any, Sequence

try:
    import fitz  # PyMuPDF
    _HAS_FITZ = True
except Exception:
    _HAS_FITZ = False

try:
    import numpy as np
    _HAS_NUMPY = True
except Exception:
    _HAS_NUMPY = False

try:
    from PIL import Image
    _HAS_PIL = True
except Exception:
    _HAS_PIL = False

try:
    import cv2
    _HAS_CV2 = True
except Exception:
    _HAS_CV2 = False

try:
    from pyzbar import pyzbar as _pyzbar
    _HAS_PYZBAR = True
except Exception:
    _HAS_PYZBAR = False


# ---------------------------------------------------------------------------
# Findings / severity model
# ---------------------------------------------------------------------------

class Severity(str, Enum):
    INFO = "INFO"
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


SEVERITY_WEIGHT = {
    Severity.INFO: 0,
    Severity.LOW: 3,
    Severity.MEDIUM: 8,
    Severity.HIGH: 25,
    Severity.CRITICAL: 60,
}

# Analyzers whose CRITICAL/HIGH alone must NOT trigger TAMPERING DETECTED.
# Only deterministic, evidence-bearing analyzers may decide that verdict.
HEURISTIC_ANALYZERS = {"ela", "noise", "clone"}


class Verdict(str, Enum):
    TAMPERING_DETECTED = "TAMPERING DETECTED"
    SUSPICIOUS = "SUSPICIOUS — HUMAN REVIEW"
    NO_STRONG_SIGNAL = "NO STRONG TAMPER SIGNAL"


@dataclass
class Finding:
    analyzer: str
    severity: Severity
    code: str
    message: str
    detail: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["severity"] = self.severity.value
        return d


@dataclass
class Report:
    verdict: Verdict
    score: int
    findings: list[Finding]
    layers: dict[str, Any]
    extracted_fields: dict[str, Any]
    ela_heatmap_b64: str | None
    disclaimer: str

    def to_dict(self) -> dict:
        return {
            "verdict": self.verdict.value,
            "score": self.score,
            "findings": [f.to_dict() for f in self.findings],
            "layers": self.layers,
            "extracted_fields": self.extracted_fields,
            "ela_heatmap_b64": self.ela_heatmap_b64,
            "disclaimer": self.disclaimer,
        }


DISCLAIMER = (
    "A clean result is NOT proof of authenticity. Flattened, re-exported, "
    "printed-to-PDF, or re-scanned files erase the evidence this tool relies on. "
    "Confirm important documents against the issuing authority."
)


# ---------------------------------------------------------------------------
# Document classification
# ---------------------------------------------------------------------------

def detect_kind(data: bytes, filename: str | None = None) -> str:
    """Return 'pdf' or 'image' or 'unknown'."""
    if data[:5] == b"%PDF-":
        return "pdf"
    if data[:3] == b"\xff\xd8\xff":
        return "image"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image"
    if filename:
        ext = Path(filename).suffix.lower()
        if ext == ".pdf":
            return "pdf"
        if ext in {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp"}:
            return "image"
    return "unknown"


# ---------------------------------------------------------------------------
# PDF: metadata analyzer
# ---------------------------------------------------------------------------

_PDF_DATE_RE = re.compile(r"D:(\d{14})")

_KNOWN_EDIT_TOOL_HINTS = (
    "ilovepdf", "smallpdf", "pdfescape", "sejda", "soda pdf",
    "foxit phantompdf", "pdfsam", "qpdf", "ghostscript",
)


def _parse_pdf_date(value: str | None) -> str | None:
    if not value:
        return None
    m = _PDF_DATE_RE.search(value)
    return m.group(1) if m else None


def analyze_pdf_metadata(doc: "fitz.Document") -> tuple[list[Finding], dict]:
    findings: list[Finding] = []
    meta = doc.metadata or {}
    creation = _parse_pdf_date(meta.get("creationDate"))
    modified = _parse_pdf_date(meta.get("modDate"))
    producer = (meta.get("producer") or "").strip()
    creator = (meta.get("creator") or "").strip()

    layer = {
        "creation_date": meta.get("creationDate"),
        "mod_date": meta.get("modDate"),
        "producer": producer,
        "creator": creator,
        "title": meta.get("title"),
        "author": meta.get("author"),
    }

    if creation and modified and modified < creation:
        findings.append(Finding(
            "pdf_metadata", Severity.MEDIUM, "META_MOD_BEFORE_CREATE",
            "Modification timestamp is earlier than creation timestamp.",
            {"creation": creation, "modified": modified},
        ))

    if creation and modified and creation != modified:
        findings.append(Finding(
            "pdf_metadata", Severity.INFO, "META_MOD_AFTER_CREATE",
            "Modification timestamp differs from creation timestamp.",
            {"creation": creation, "modified": modified},
        ))

    haystack = f"{producer} {creator}".lower()
    for hint in _KNOWN_EDIT_TOOL_HINTS:
        if hint in haystack:
            findings.append(Finding(
                "pdf_metadata", Severity.LOW, "META_EDIT_TOOL_PRODUCER",
                f"Producer/creator names a tool commonly used to edit PDFs: '{hint}'.",
                {"producer": producer, "creator": creator},
            ))
            break

    # Annotations on a "scan" can be a tampering hint (sticky-note over a field).
    try:
        annot_count = 0
        for page in doc:
            annot_count += sum(1 for _ in (page.annots() or []))
        layer["annotation_count"] = annot_count
        if annot_count > 0:
            findings.append(Finding(
                "pdf_metadata", Severity.LOW, "META_ANNOTATIONS_PRESENT",
                f"PDF carries {annot_count} annotation object(s); confirm none cover content.",
                {"annotation_count": annot_count},
            ))
    except Exception:
        pass

    return findings, layer


# ---------------------------------------------------------------------------
# PDF: incremental-update revision recovery (the centerpiece)
# ---------------------------------------------------------------------------

_EOF_MARKER = b"%%EOF"


def find_eof_offsets(pdf_bytes: bytes) -> list[int]:
    """Return byte offsets immediately AFTER each %%EOF marker."""
    offsets: list[int] = []
    pos = 0
    while True:
        idx = pdf_bytes.find(_EOF_MARKER, pos)
        if idx == -1:
            break
        end = idx + len(_EOF_MARKER)
        if end < len(pdf_bytes) and pdf_bytes[end:end + 1] in (b"\r", b"\n"):
            end += 1
            if end < len(pdf_bytes) and pdf_bytes[end:end + 1] == b"\n":
                end += 1
        offsets.append(end)
        pos = end
    return offsets


def _extract_text(pdf_chunk: bytes) -> str | None:
    if not _HAS_FITZ:
        return None
    try:
        doc = fitz.open(stream=pdf_chunk, filetype="pdf")
    except Exception:
        return None
    try:
        return "\n".join(p.get_text() for p in doc)
    except Exception:
        return None
    finally:
        try:
            doc.close()
        except Exception:
            pass


def _diff_text(old: str, new: str) -> tuple[list[str], list[str]]:
    old_lines = [l.strip() for l in old.splitlines() if l.strip()]
    new_lines = [l.strip() for l in new.splitlines() if l.strip()]
    diff = list(difflib.ndiff(old_lines, new_lines))
    removed = [l[2:] for l in diff if l.startswith("- ")]
    added = [l[2:] for l in diff if l.startswith("+ ")]
    return removed, added


def analyze_pdf_revisions(pdf_bytes: bytes) -> tuple[list[Finding], dict]:
    findings: list[Finding] = []
    offsets = find_eof_offsets(pdf_bytes)
    revisions = len(offsets)
    layer: dict = {"revisions": revisions, "revision_texts": []}

    if revisions == 0:
        findings.append(Finding(
            "pdf_revisions", Severity.LOW, "REV_NO_EOF",
            "No %%EOF marker found; file may be truncated.",
        ))
        return findings, layer

    if revisions == 1:
        findings.append(Finding(
            "pdf_revisions", Severity.INFO, "REV_SINGLE",
            "Single PDF revision. Either unedited, or edit history was flattened "
            "(re-exported / printed-to-PDF). Absence of edits is not proof of authenticity.",
        ))
        return findings, layer

    # Multiple revisions: recover and diff earliest vs final.
    texts: list[str] = []
    for off in offsets:
        t = _extract_text(pdf_bytes[:off])
        texts.append(t if t is not None else "")
    layer["revision_texts"] = [t[:4000] for t in texts]  # cap for report size

    first = texts[0]
    final = texts[-1]
    removed, added = _diff_text(first, final)

    sev_extra = Severity.INFO
    findings.append(Finding(
        "pdf_revisions", sev_extra, "REV_INCREMENTAL_SAVES",
        f"PDF contains {revisions} incremental revisions (was re-saved {revisions - 1} time(s)).",
        {"revisions": revisions},
    ))

    if removed or added:
        # CRITICAL: prior revision recovered, content materially differs.
        findings.append(Finding(
            "pdf_revisions", Severity.CRITICAL, "REV_CONTENT_DIFF",
            "Recovered earlier revision differs from the visible final revision. "
            "This is direct evidence the document was edited after first save.",
            {
                "removed_lines": removed[:50],
                "added_lines": added[:50],
                "removed_count": len(removed),
                "added_count": len(added),
            },
        ))
    else:
        findings.append(Finding(
            "pdf_revisions", Severity.LOW, "REV_NO_VISIBLE_DIFF",
            "Multiple revisions but no visible text difference. Could be benign "
            "(form-fill, signature) — still worth a human glance.",
        ))

    return findings, layer


# ---------------------------------------------------------------------------
# Image: utilities & guards
# ---------------------------------------------------------------------------

def _pil_to_gray_array(img: "Image.Image") -> "np.ndarray":
    g = img.convert("L")
    return np.asarray(g, dtype=np.uint8)


def _is_low_texture(gray: "np.ndarray") -> bool:
    """Skip noise/clone/ELA on near-uniform / vector-rendered pages."""
    if gray.size == 0:
        return True
    std = float(gray.std())
    return std < 6.0


# ---------------------------------------------------------------------------
# Image: ELA (delegates heatmap rendering to ela.py)
# ---------------------------------------------------------------------------

def analyze_image_ela(img: "Image.Image") -> tuple[list[Finding], dict, str | None]:
    """Returns (findings, layer_detail, ela_heatmap_b64)."""
    from ela import compute_ela, render_heatmap_b64  # local import to keep deps lazy

    findings: list[Finding] = []
    if not (_HAS_NUMPY and _HAS_PIL):
        return findings, {"skipped": "missing PIL/numpy"}, None

    gray = _pil_to_gray_array(img)
    if _is_low_texture(gray):
        return findings, {"skipped": "low-texture image (uniform / vector)"}, None

    ela_map, stats = compute_ela(img)
    heatmap_b64 = render_heatmap_b64(img, ela_map, stats)

    detail = {
        "mean": stats["mean"],
        "p99": stats["p99"],
        "max": stats["max"],
        "block_max": stats["block_max"],
        "strong_blocks": stats["strong_blocks"],
        "cluster_area_ratio": stats["cluster_area_ratio"],
        "suspect_bbox": stats["suspect_bbox"],
    }

    strong = stats["strong_blocks"]
    cluster_ratio = stats["cluster_area_ratio"]
    block_max = stats["block_max"]

    if strong >= 2 and cluster_ratio <= 0.10:
        sev = Severity.MEDIUM if strong <= 20 else Severity.HIGH
        findings.append(Finding(
            "ela", sev, "ELA_LOCALIZED_HOTSPOT",
            f"Localized ELA hotspot: {strong} block(s) with residual ≥ "
            f"{stats['strong_block_threshold']}, clustered into "
            f"{cluster_ratio*100:.1f}% of the page.",
            detail,
        ))
    elif strong >= 20 and cluster_ratio > 0.10:
        findings.append(Finding(
            "ela", Severity.LOW, "ELA_DIFFUSE_HIGH",
            f"Diffuse ELA energy: {strong} strong block(s) scattered across "
            f"{cluster_ratio*100:.1f}% of the page — no clear localization.",
            detail,
        ))
    elif block_max >= 12.0 and strong == 1:
        findings.append(Finding(
            "ela", Severity.LOW, "ELA_SINGLE_HOT_BLOCK",
            f"A single block has unusually high ELA residual (peak={block_max:.1f}); "
            "weak signal on its own.",
            detail,
        ))

    return findings, detail, heatmap_b64


# ---------------------------------------------------------------------------
# Image: noise-floor inconsistency
# ---------------------------------------------------------------------------

def analyze_image_noise(img: "Image.Image") -> tuple[list[Finding], dict]:
    """Detect regions whose sensor-noise floor differs from the rest.

    A pasted region from a different source (different camera/scanner, or
    uncompressed graphic) carries different noise statistics than the host
    document. To estimate "sensor noise" without mistaking text edges for
    noise, we subtract a median filter (edge-preserving) rather than a
    Gaussian blur. Residual energy is then close to true randomness.
    """
    findings: list[Finding] = []
    if not (_HAS_NUMPY and _HAS_CV2 and _HAS_PIL):
        return findings, {"skipped": "missing numpy/cv2/PIL"}

    gray = _pil_to_gray_array(img)
    if _is_low_texture(gray):
        return findings, {"skipped": "low-texture image"}

    # Median filter preserves edges, so the residual reflects random
    # high-frequency noise rather than coherent text content.
    med_filt = cv2.medianBlur(gray, 5)
    residual = cv2.absdiff(gray, med_filt).astype(np.float32)

    h, w = gray.shape
    by, bx = 8, 8
    bh, bw = h // by, w // bx
    if bh < 8 or bw < 8:
        return findings, {"skipped": "image too small for block analysis"}

    block_noise = np.zeros((by, bx), dtype=np.float32)
    for i in range(by):
        for j in range(bx):
            patch = residual[i * bh:(i + 1) * bh, j * bw:(j + 1) * bw]
            block_noise[i, j] = float(patch.mean())

    med = float(np.median(block_noise))
    mad = float(np.median(np.abs(block_noise - med))) or 1e-6

    # Guard: when the noise floor is implausibly uniform (MAD vanishingly
    # small), z-scores explode on any deviation. Require both a strong
    # z-score AND a meaningful absolute deviation.
    z = (block_noise - med) / (1.4826 * mad)
    abs_dev = np.abs(block_noise - med)
    outlier_mask = (np.abs(z) > 4.5) & (abs_dev > max(med * 0.4, 1.0))
    outliers = int(outlier_mask.sum())

    detail = {
        "median_block_noise": round(med, 3),
        "mad": round(mad, 3),
        "max_abs_z": round(float(np.max(np.abs(z))), 2),
        "max_abs_dev": round(float(abs_dev.max()), 3),
        "outlier_blocks": outliers,
        "block_grid": [by, bx],
    }

    if outliers >= 1:
        sev = Severity.MEDIUM if outliers <= 3 else Severity.HIGH
        findings.append(Finding(
            "noise", sev, "NOISE_BLOCK_OUTLIER",
            f"{outliers} block(s) deviate from the noise floor "
            f"(max |z|={detail['max_abs_z']:.1f}, peak Δ={detail['max_abs_dev']:.2f}).",
            detail,
        ))
    return findings, detail


# ---------------------------------------------------------------------------
# Image: copy-move (ORB self-match)
# ---------------------------------------------------------------------------

def analyze_image_clone(img: "Image.Image") -> tuple[list[Finding], dict]:
    findings: list[Finding] = []
    if not (_HAS_NUMPY and _HAS_CV2 and _HAS_PIL):
        return findings, {"skipped": "missing numpy/cv2/PIL"}

    gray = _pil_to_gray_array(img)
    if _is_low_texture(gray):
        return findings, {"skipped": "low-texture image"}

    h, w = gray.shape
    max_side = 1200
    if max(h, w) > max_side:
        scale = max_side / max(h, w)
        gray = cv2.resize(gray, (int(w * scale), int(h * scale)))
        h, w = gray.shape

    try:
        orb = cv2.ORB_create(nfeatures=2000)
        kp, des = orb.detectAndCompute(gray, None)
    except Exception:
        return findings, {"skipped": "ORB unavailable"}

    if des is None or len(kp) < 20:
        return findings, {"keypoints": 0 if des is None else len(kp), "skipped": "too few features"}

    bf = cv2.BFMatcher(cv2.NORM_HAMMING)
    matches = bf.knnMatch(des, des, k=4)

    min_pixel_dist = max(40, int(0.05 * max(h, w)))
    pairs: list[tuple[int, int]] = []
    for m_set in matches:
        for m in m_set:
            if m.queryIdx == m.trainIdx:
                continue
            p1 = kp[m.queryIdx].pt
            p2 = kp[m.trainIdx].pt
            d = ((p1[0] - p2[0]) ** 2 + (p1[1] - p2[1]) ** 2) ** 0.5
            if d < min_pixel_dist:
                continue
            if m.distance > 32:
                continue
            a, b = sorted((m.queryIdx, m.trainIdx))
            pairs.append((a, b))

    pairs = list(set(pairs))
    detail = {
        "keypoints": len(kp),
        "clone_pairs": len(pairs),
        "min_pixel_distance": min_pixel_dist,
    }

    if len(pairs) >= 25:
        # Cap at LOW: clone detection over-fires on repeated text/seals.
        findings.append(Finding(
            "clone", Severity.LOW, "CLONE_SELF_MATCH",
            f"{len(pairs)} spatially-separated feature pairs match — possible copy-move. "
            "Repeated text and seals also produce this signal; treat as a hint.",
            detail,
        ))
    return findings, detail


# ---------------------------------------------------------------------------
# QR / barcode decode + payload-vs-document consistency
# ---------------------------------------------------------------------------

def analyze_barcodes(img: "Image.Image", doc_text: str) -> tuple[list[Finding], dict]:
    findings: list[Finding] = []
    layer: dict = {"codes": []}
    if not _HAS_PYZBAR or not _HAS_PIL:
        return findings, {"skipped": "missing pyzbar/PIL"}

    try:
        codes = _pyzbar.decode(img)
    except Exception:
        return findings, {"skipped": "decode failed"}

    if not codes:
        return findings, layer

    doc_text_norm = re.sub(r"\s+", " ", doc_text or "").lower()
    for code in codes:
        try:
            payload = code.data.decode("utf-8", errors="replace")
        except Exception:
            payload = repr(code.data)
        entry = {
            "type": code.type,
            "payload": payload[:1000],
        }

        tokens = re.findall(r"[A-Za-z0-9/\-]{4,}", payload)
        unmatched = [t for t in tokens if t.lower() not in doc_text_norm]
        match_ratio = (len(tokens) - len(unmatched)) / max(1, len(tokens))
        entry["match_ratio"] = round(match_ratio, 3)
        entry["unmatched_tokens"] = unmatched[:10]
        layer["codes"].append(entry)

        if tokens and match_ratio < 0.4:
            findings.append(Finding(
                "barcode", Severity.HIGH, "QR_PAYLOAD_DOC_MISMATCH",
                f"Decoded {code.type} payload disagrees with the visible document text "
                f"(matched {match_ratio*100:.0f}% of payload tokens).",
                entry,
            ))
        else:
            findings.append(Finding(
                "barcode", Severity.INFO, "QR_DECODED",
                f"Decoded {code.type}; {len(tokens)} payload tokens, {match_ratio*100:.0f}% present in document.",
                entry,
            ))

    return findings, layer


# ---------------------------------------------------------------------------
# Page-image extraction (only when a PDF page is a full-page scan)
# ---------------------------------------------------------------------------

def page_full_image_pil(doc: "fitz.Document", page_index: int) -> "Image.Image | None":
    """Return the embedded image only when the page is essentially one big scan.

    We must not run image forensics on vector-rendered pages — ELA / noise on
    a perfectly clean vector render produces meaningless signals.
    """
    if not (_HAS_FITZ and _HAS_PIL):
        return None
    page = doc[page_index]
    try:
        info = page.get_images(full=True)
    except Exception:
        return None
    if not info:
        return None
    # Heuristic: page has one image whose drawn rect ~= page rect.
    page_rect = page.rect
    page_area = page_rect.width * page_rect.height
    candidates = []
    try:
        for img in info:
            xref = img[0]
            rects = page.get_image_rects(xref)
            for r in rects:
                if (r.width * r.height) / max(1.0, page_area) > 0.7:
                    candidates.append(xref)
    except Exception:
        return None
    if not candidates:
        return None
    xref = candidates[0]
    try:
        d = doc.extract_image(xref)
    except Exception:
        return None
    try:
        return Image.open(io.BytesIO(d["image"])).convert("RGB")
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Aggregator
# ---------------------------------------------------------------------------

def decide_verdict(findings: list[Finding]) -> tuple[Verdict, int]:
    score = sum(SEVERITY_WEIGHT[f.severity] for f in findings)

    decisive_critical = any(
        f.severity == Severity.CRITICAL and f.analyzer not in HEURISTIC_ANALYZERS
        for f in findings
    )
    if decisive_critical:
        return Verdict.TAMPERING_DETECTED, score

    high_any = any(f.severity == Severity.HIGH for f in findings)
    critical_heuristic = any(
        f.severity == Severity.CRITICAL and f.analyzer in HEURISTIC_ANALYZERS
        for f in findings
    )
    if high_any or critical_heuristic or score >= 20:
        return Verdict.SUSPICIOUS, score

    return Verdict.NO_STRONG_SIGNAL, score


def analyze_document(
    data: bytes,
    filename: str | None = None,
    issuer_verifier: Any | None = None,
) -> Report:
    """Run all analyzers on the document bytes and return a calibrated Report.

    `issuer_verifier`: optional object exposing `.verify(extracted_fields) -> VerifierResult`.
    """
    findings: list[Finding] = []
    layers: dict[str, Any] = {}
    extracted_fields: dict[str, Any] = {}
    heatmap_b64: str | None = None

    kind = detect_kind(data, filename)
    layers["kind"] = kind

    full_text = ""
    image_for_codes: "Image.Image | None" = None

    if kind == "pdf":
        if not _HAS_FITZ:
            findings.append(Finding(
                "engine", Severity.INFO, "PDF_DEPS_MISSING",
                "PyMuPDF is not installed; PDF analysis was skipped.",
            ))
        else:
            try:
                doc = fitz.open(stream=data, filetype="pdf")
            except Exception as e:
                findings.append(Finding(
                    "engine", Severity.HIGH, "PDF_OPEN_FAILED",
                    f"Could not open PDF: {e}",
                ))
                doc = None
            if doc is not None:
                meta_findings, meta_layer = analyze_pdf_metadata(doc)
                findings.extend(meta_findings)
                layers["pdf_metadata"] = meta_layer

                rev_findings, rev_layer = analyze_pdf_revisions(data)
                findings.extend(rev_findings)
                layers["pdf_revisions"] = rev_layer

                try:
                    full_text = "\n".join(p.get_text() for p in doc)
                except Exception:
                    full_text = ""
                layers["text_preview"] = full_text[:2000]

                # Image forensics ONLY when page is a full-page scan.
                scan_pages: list[dict] = []
                for i in range(len(doc)):
                    pil_img = page_full_image_pil(doc, i)
                    if pil_img is None:
                        continue
                    ela_findings, ela_detail, heat = analyze_image_ela(pil_img)
                    noise_findings, noise_detail = analyze_image_noise(pil_img)
                    clone_findings, clone_detail = analyze_image_clone(pil_img)
                    findings.extend(ela_findings)
                    findings.extend(noise_findings)
                    findings.extend(clone_findings)
                    scan_pages.append({
                        "page": i + 1,
                        "ela": ela_detail,
                        "noise": noise_detail,
                        "clone": clone_detail,
                    })
                    if heat and heatmap_b64 is None:
                        heatmap_b64 = heat
                    if image_for_codes is None:
                        image_for_codes = pil_img
                if scan_pages:
                    layers["scanned_pages"] = scan_pages

                # Signature check (pyhanko) — optional.
                try:
                    from issuer_verifiers.signature import validate_pdf_signature
                    sig_findings, sig_layer = validate_pdf_signature(data)
                    findings.extend(sig_findings)
                    layers["signature"] = sig_layer
                except Exception as e:
                    layers["signature"] = {"skipped": f"{type(e).__name__}: {e}"}

                # CDSCO Form 25/28 specific checks (regulator hotspots).
                # Runs after the signature analyzer so it can cross-check sigs.
                try:
                    from cdsco_forms import analyze_cdsco_forms
                    cf_findings, cf_layer = analyze_cdsco_forms(
                        text=full_text, signature_layer=layers.get("signature", {}),
                    )
                    findings.extend(cf_findings)
                    layers["cdsco_forms"] = cf_layer
                except Exception as e:
                    layers["cdsco_forms"] = {"skipped": f"{type(e).__name__}: {e}"}

                try:
                    doc.close()
                except Exception:
                    pass

    elif kind == "image":
        if not _HAS_PIL:
            findings.append(Finding(
                "engine", Severity.INFO, "IMAGE_DEPS_MISSING",
                "Pillow is not installed; image analysis was skipped.",
            ))
        else:
            try:
                pil_img = Image.open(io.BytesIO(data)).convert("RGB")
            except Exception as e:
                findings.append(Finding(
                    "engine", Severity.HIGH, "IMAGE_OPEN_FAILED",
                    f"Could not open image: {e}",
                ))
                pil_img = None
            if pil_img is not None:
                ela_findings, ela_detail, heat = analyze_image_ela(pil_img)
                noise_findings, noise_detail = analyze_image_noise(pil_img)
                clone_findings, clone_detail = analyze_image_clone(pil_img)
                findings.extend(ela_findings)
                findings.extend(noise_findings)
                findings.extend(clone_findings)
                layers["ela"] = ela_detail
                layers["noise"] = noise_detail
                layers["clone"] = clone_detail
                heatmap_b64 = heat
                image_for_codes = pil_img
    else:
        findings.append(Finding(
            "engine", Severity.INFO, "UNKNOWN_KIND",
            "Unsupported file type; only PDF and common raster images are analyzed.",
        ))

    # OCR / field extraction
    try:
        from ocr import extract_fields
        extracted_fields = extract_fields(data, kind=kind, text_layer=full_text)
        layers["ocr"] = {
            "source": extracted_fields.get("_source", "unknown"),
            "char_count": len(extracted_fields.get("_raw_text", "")),
        }
    except Exception as e:
        extracted_fields = {}
        layers["ocr"] = {"skipped": f"{type(e).__name__}: {e}"}

    # QR / barcodes — run when we have an image to read.
    if image_for_codes is not None:
        bc_findings, bc_layer = analyze_barcodes(
            image_for_codes, extracted_fields.get("_raw_text", "") or full_text
        )
        findings.extend(bc_findings)
        layers["barcodes"] = bc_layer

    # Issuer verification
    if issuer_verifier is not None:
        try:
            v_result = issuer_verifier.verify(extracted_fields)
            layers["issuer_verification"] = v_result.to_dict()
            findings.extend(v_result.to_findings())
        except Exception as e:
            layers["issuer_verification"] = {"error": f"{type(e).__name__}: {e}"}
            findings.append(Finding(
                "issuer", Severity.LOW, "ISSUER_ERROR",
                f"Issuer verifier raised an exception: {e}",
            ))

    verdict, score = decide_verdict(findings)
    return Report(
        verdict=verdict,
        score=score,
        findings=findings,
        layers=layers,
        extracted_fields={k: v for k, v in extracted_fields.items() if not k.startswith("_")},
        ela_heatmap_b64=heatmap_b64,
        disclaimer=DISCLAIMER,
    )
