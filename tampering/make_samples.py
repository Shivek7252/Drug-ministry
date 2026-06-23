"""
Generate reproducible test fixtures.

Produces three samples that exercise each verdict bucket:

  samples/clean_approval.pdf
      A clean, single-revision PDF whose fields match the CDSCO snapshot.
      Expected verdict: NO STRONG TAMPER SIGNAL.

  samples/tampered_approval.pdf
      The same document, then INCREMENTALLY edited so an earlier revision
      remains recoverable from the byte stream. Demonstrates the centerpiece
      analyzer.
      Expected verdict: TAMPERING DETECTED.

  samples/tampered_scan.jpg
      A realistic "scan" with a region whose JPEG compression history
      differs from the rest. Demonstrates ELA + noise.
      Expected verdict: SUSPICIOUS — HUMAN REVIEW.

DETECTION-ONLY: these fixtures exist solely to verify that the detector
behaves correctly. They are not, and must not be used as, templates for
producing forged documents. The content is deliberately implausible
("Acme Pharma" / generic placeholders) and not a likeness of any real
issuance.
"""

from __future__ import annotations

import io
import random
from pathlib import Path

import fitz
import numpy as np
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).parent / "samples"
OUT.mkdir(exist_ok=True)


# ---------------------------------------------------------------------------
# Clean PDF — matches the CDSCO snapshot.
# ---------------------------------------------------------------------------

_CLEAN_LINES = [
    "CENTRAL DRUGS STANDARD CONTROL ORGANIZATION",
    "Approval Letter",
    "",
    "Approval No: CDSCO/IND/2021/00482",
    "Product Name: Paracetamol IP 500mg Tablets",
    "Applicant: Acme Pharma Pvt Ltd",
    "Date of Approval: 12 Jan 2021",
    "",
    "This is a synthetic fixture for testing the document",
    "forensics engine. Do not treat as a real approval.",
]


def _draw_pdf(lines: list[str], path: Path) -> None:
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    y = 80
    for line in lines:
        page.insert_text((72, y), line, fontsize=12, fontname="helv")
        y += 20
    doc.save(str(path))
    doc.close()


def make_clean_pdf() -> Path:
    path = OUT / "clean_approval.pdf"
    _draw_pdf(_CLEAN_LINES, path)
    return path


# ---------------------------------------------------------------------------
# Tampered PDF — true incremental edit so revision recovery fires.
# ---------------------------------------------------------------------------

def make_tampered_pdf() -> Path:
    path = OUT / "tampered_approval.pdf"
    _draw_pdf(_CLEAN_LINES, path)

    # Re-open and INCREMENTALLY edit. Use a PDF redaction so the original
    # "Applicant: Acme Pharma Pvt Ltd" is genuinely REMOVED from the page
    # content stream of revision 2 (not merely covered). Because the save is
    # incremental, the original content stream remains in the byte stream,
    # referenced by the prior xref — recoverable by truncating at the first
    # %%EOF. That is exactly the evidence the engine looks for.
    doc = fitz.open(str(path))
    page = doc[0]
    targets = page.search_for("Applicant: Acme Pharma Pvt Ltd")
    if targets:
        rect = targets[0]
        cover = fitz.Rect(rect.x0 - 2, rect.y0 - 2, page.rect.x1 - 40, rect.y1 + 2)
        page.add_redact_annot(
            cover,
            text="Applicant: Shadow Trading Co",
            fontsize=12,
            fontname="helv",
            fill=(1, 1, 1),
            text_color=(0, 0, 0),
        )
        page.apply_redactions()

    doc.save(str(path), incremental=True, encryption=fitz.PDF_ENCRYPT_KEEP)
    doc.close()
    return path


# ---------------------------------------------------------------------------
# Tampered scan JPEG — pasted region with different compression history.
# ---------------------------------------------------------------------------

def _make_scan_base(width: int = 1000, height: int = 1400) -> Image.Image:
    """A plausible-looking scanned form: off-white paper with realistic
    sensor noise, printed text. The paper noise std is set high enough
    that anti-aliased text edges do not dominate the noise-floor analyzer."""
    rng = np.random.default_rng(42)
    paper = (rng.normal(loc=243, scale=14, size=(height, width, 3))
             .clip(0, 255).astype(np.uint8))
    img = Image.fromarray(paper)
    draw = ImageDraw.Draw(img)

    try:
        font = ImageFont.truetype("arial.ttf", 28)
        small = ImageFont.truetype("arial.ttf", 18)
    except Exception:
        font = ImageFont.load_default()
        small = font

    draw.text((60, 60), "REGULATORY APPROVAL — SCAN", fill=(20, 20, 30), font=font)
    draw.line((60, 110, width - 60, 110), fill=(40, 40, 50), width=2)
    rows = [
        ("Approval No", "CDSCO/IND/2022/01193"),
        ("Product",     "Amoxicillin 250mg Capsules"),
        ("Applicant",   "Northstar Healthcare Ltd"),
        ("Date",        "03 Mar 2022"),
        ("Issued by",   "Office of the Drugs Controller"),
    ]
    y = 160
    for label, value in rows:
        draw.text((60, y), label + ":", fill=(60, 60, 70), font=small)
        draw.text((260, y), value, fill=(20, 20, 30), font=small)
        y += 50

    return img


def make_tampered_scan() -> Path:
    """
    Build a JPEG with a region whose compression history differs from the rest.

    Recipe (the standard ELA-detectable construction):
      1. Save the base at LOW JPEG quality, then load — it picks up coarse
         DCT artifacts on an 8x8 block grid aligned to (0,0).
      2. Build a patch with sharp synthetic content (text/edges) and leave
         it UNCOMPRESSED — its DCT coefficients are not yet on any
         quantization grid.
      3. Paste the patch at a position NOT divisible by 8 → its eventual
         block grid is misaligned with the base's.
      4. Save the combined image as JPEG. The base region is already on a
         coarse grid; the patch region is being quantized for the first
         time, on a grid that doesn't align with anything it previously
         carried. When ELA recompresses at moderate quality, the patch
         region's residual is markedly higher than the base region's.

    The patch content is a placeholder rectangle — deliberately bland so it
    is not, and could not be mistaken for, a likeness of any real official mark.
    """
    base = _make_scan_base()

    base_buf = io.BytesIO()
    base.save(base_buf, format="JPEG", quality=70)
    base_buf.seek(0)
    base_low = Image.open(base_buf).convert("RGB").copy()

    patch_w, patch_h = 240, 110
    patch = Image.new("RGB", (patch_w, patch_h), (250, 250, 255))
    pdraw = ImageDraw.Draw(patch)
    try:
        pfont_big = ImageFont.truetype("arial.ttf", 24)
        pfont_sm = ImageFont.truetype("arial.ttf", 16)
    except Exception:
        pfont_big = ImageFont.load_default()
        pfont_sm = pfont_big
    pdraw.rectangle((3, 3, patch_w - 3, patch_h - 3), outline=(0, 0, 0), width=3)
    pdraw.text((14, 14), "REVISED", fill=(160, 20, 20), font=pfont_big)
    pdraw.text((14, 52), "valid till 2099", fill=(20, 20, 20), font=pfont_sm)
    pdraw.line((14, 88, patch_w - 14, 88), fill=(0, 0, 0), width=2)

    tampered = base_low.copy()
    # Deliberately non-multiple-of-8 paste position → block-grid misalignment.
    tampered.paste(patch, (637, 203))

    out_path = OUT / "tampered_scan.jpg"
    # Save at high quality so the patch retains detail; the engine's
    # coarser recompression will then pull the patch out as a residual hotspot.
    tampered.save(out_path, format="JPEG", quality=95)
    return out_path


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main() -> None:
    random.seed(0)
    clean = make_clean_pdf()
    tampered_pdf = make_tampered_pdf()
    tampered_img = make_tampered_scan()
    print(f"wrote {clean}")
    print(f"wrote {tampered_pdf}")
    print(f"wrote {tampered_img}")


if __name__ == "__main__":
    main()
