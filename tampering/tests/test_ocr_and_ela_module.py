"""OCR field extraction (PDF text layer path) and ELA module statistics."""

import numpy as np
from PIL import Image

import ocr
import ela
from make_samples import make_clean_pdf


def test_extract_fields_from_pdf_text_layer():
    pdf = make_clean_pdf().read_bytes()
    fields = ocr.extract_fields(pdf, kind="pdf")
    assert fields["_source"] == "pdf_text"
    assert fields.get("approval_no", "").startswith("CDSCO/IND/2021/00482")
    # Product extraction is best-effort: confirm it found *something* useful.
    assert any(k in fields for k in ("product_name", "applicant", "approval_date"))


def test_extract_fields_unknown_kind_returns_empty_source():
    fields = ocr.extract_fields(b"", kind="unknown")
    assert fields["_source"] == "none"
    assert fields["_raw_text"] == ""


def test_ela_compute_stats_shape():
    img = Image.new("RGB", (200, 200), (100, 150, 200))
    # Add some structure so ELA has something to chew on.
    arr = np.asarray(img).copy()
    arr[50:100, 50:100] = (220, 30, 30)
    img = Image.fromarray(arr)
    ela_map, stats = ela.compute_ela(img)
    assert ela_map.shape == (200, 200)
    assert "mean" in stats and "p99" in stats and "max" in stats
    assert "suspect_area_ratio" in stats


def test_ela_heatmap_is_valid_base64_png():
    import base64
    img = Image.new("RGB", (100, 100), (200, 200, 200))
    ela_map, stats = ela.compute_ela(img)
    b64 = ela.render_heatmap_b64(img, ela_map, stats)
    raw = base64.b64decode(b64)
    assert raw[:8] == b"\x89PNG\r\n\x1a\n"
