"""
Error Level Analysis (ELA) and heatmap rendering.

Detects regions of an image whose JPEG-compression history differs from the
rest — typical of pasted content. Produces both raw statistics for the engine
and a base64 PNG heatmap for the UI.

Detection uses BLOCK-LEVEL robust statistics rather than global percentiles:
a single percentile of per-pixel residual is dominated by text/edge pixels
spread across the whole image. The actual question for ELA is *which spatial
regions* have anomalously high residual energy.
"""

from __future__ import annotations

import base64
import io
from typing import Any

import numpy as np
from PIL import Image, ImageDraw

# Recompress at a coarser quality than typical "high-quality" scans so that
# detail-rich regions (untouched OR pasted from a higher-quality source) lose
# more on the second pass and ELA isolates them.
_RECOMPRESS_QUALITY = 75

# Block size for the per-region residual map.
_BLOCK = 24


def compute_ela(img: Image.Image) -> tuple[np.ndarray, dict[str, Any]]:
    """Return (per-pixel ELA intensity map uint8, stats).

    The map is the per-pixel max-channel absolute difference between the
    image and a re-saved-then-reloaded JPEG copy. Stats include block-level
    outlier counts and the bounding box of the strongest cluster.
    """
    rgb = img.convert("RGB")
    buf = io.BytesIO()
    rgb.save(buf, format="JPEG", quality=_RECOMPRESS_QUALITY)
    buf.seek(0)
    recompressed = Image.open(buf).convert("RGB")

    a = np.asarray(rgb, dtype=np.int16)
    b = np.asarray(recompressed, dtype=np.int16)
    diff = np.abs(a - b).max(axis=2).astype(np.uint8)

    if diff.max() > 0:
        ela_map = np.clip(diff.astype(np.float32) * (255.0 / max(1, diff.max())), 0, 255).astype(np.uint8)
    else:
        ela_map = diff

    h, w = diff.shape
    by = max(4, h // _BLOCK)
    bx = max(4, w // _BLOCK)
    bh, bw = h // by, w // bx
    block_mean = np.zeros((by, bx), dtype=np.float32)
    for i in range(by):
        for j in range(bx):
            patch = diff[i * bh:(i + 1) * bh, j * bw:(j + 1) * bw]
            block_mean[i, j] = float(patch.mean())

    # Detection thresholds: a "strong" block has residual far above what even
    # sharp text edges normally produce after recompression at this quality.
    # An empty page has residual ≈ 0; a sharp text page averages ~3–6 per
    # block; pasted high-detail content (or content with mismatched
    # compression history) often spikes to 8+.
    STRONG = 8.0
    strong_mask = block_mean >= STRONG
    strong_blocks = int(strong_mask.sum())
    max_block = float(block_mean.max()) if block_mean.size else 0.0
    median = float(np.median(block_mean))

    bbox = None
    cluster_area_ratio = 0.0
    if strong_blocks:
        ys, xs = np.where(strong_mask)
        y0 = int(ys.min() * bh)
        x0 = int(xs.min() * bw)
        y1 = int((ys.max() + 1) * bh)
        x1 = int((xs.max() + 1) * bw)
        bbox = [x0, y0, x1, y1]
        cluster_area_ratio = ((x1 - x0) * (y1 - y0)) / float(h * w)

    stats = {
        "mean": round(float(diff.mean()), 3),
        "p99": round(float(np.percentile(diff, 99)), 3),
        "max": int(diff.max()),
        "block_median": round(median, 3),
        "block_max": round(max_block, 3),
        "strong_blocks": strong_blocks,
        "strong_block_threshold": STRONG,
        "cluster_area_ratio": round(cluster_area_ratio, 5),
        "block_grid": [by, bx],
        "suspect_bbox": bbox,
        # Back-compat alias.
        "suspect_area_ratio": round(cluster_area_ratio, 6),
    }
    return ela_map, stats


def _colorize(ela_map: np.ndarray) -> np.ndarray:
    h, w = ela_map.shape
    out = np.zeros((h, w, 3), dtype=np.uint8)
    out[..., 0] = ela_map
    out[..., 1] = (ela_map // 4)
    out[..., 2] = 0
    return out


def render_heatmap_b64(orig: Image.Image, ela_map: np.ndarray, stats: dict) -> str:
    base = orig.convert("RGB")
    base_arr = np.asarray(base, dtype=np.uint8)
    if base_arr.shape[:2] != ela_map.shape:
        from PIL import Image as _Im
        ela_resized = _Im.fromarray(ela_map).resize(base.size, _Im.BILINEAR)
        ela_map = np.asarray(ela_resized, dtype=np.uint8)

    color = _colorize(ela_map)
    alpha = (ela_map.astype(np.float32) / 255.0)[..., None]
    blended = (base_arr.astype(np.float32) * (1 - 0.65 * alpha)
               + color.astype(np.float32) * (0.65 * alpha)).astype(np.uint8)

    out_img = Image.fromarray(blended)
    if stats.get("suspect_bbox"):
        x0, y0, x1, y1 = stats["suspect_bbox"]
        draw = ImageDraw.Draw(out_img)
        draw.rectangle([x0, y0, x1, y1], outline=(255, 255, 0), width=3)

    out_buf = io.BytesIO()
    out_img.save(out_buf, format="PNG")
    return base64.b64encode(out_buf.getvalue()).decode("ascii")
