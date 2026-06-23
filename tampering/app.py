"""
FastAPI service + drag-and-drop demo UI for the document forensics engine.

Endpoints:
  GET  /              — single-page HTML uploader (dark theme)
  POST /analyze       — multipart upload → JSON report
  GET  /healthz       — liveness probe
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse

from engine import analyze_document, DISCLAIMER
from issuer_verifiers import CDSCOVerifier

app = FastAPI(title="Government Document Forensics", version="1.0.0")

# A single configured verifier is fine for the demo. In production you would
# route by issuer (FDA / EMA / CDSCO) based on the document's regulator.
_VERIFIER = CDSCOVerifier()


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True}


@app.post("/analyze")
async def analyze(file: UploadFile = File(...)) -> JSONResponse:
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty file")
    if len(data) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="file too large (>25MB)")

    report = analyze_document(
        data,
        filename=file.filename,
        issuer_verifier=_VERIFIER,
    )
    return JSONResponse(report.to_dict())


@app.get("/", response_class=HTMLResponse)
def index() -> HTMLResponse:
    return HTMLResponse(_INDEX_HTML)


_INDEX_HTML = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Document Forensics</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  :root {
    --bg: #0e1116;
    --panel: #161b22;
    --panel2: #1f2630;
    --border: #2a313c;
    --text: #e6edf3;
    --muted: #8b949e;
    --accent: #58a6ff;
    --ok: #3fb950;
    --warn: #d29922;
    --bad: #f85149;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0; background: var(--bg); color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    line-height: 1.5;
  }
  header { padding: 24px 32px; border-bottom: 1px solid var(--border); }
  header h1 { margin: 0; font-size: 20px; font-weight: 600; }
  header p { margin: 4px 0 0 0; color: var(--muted); font-size: 13px; }
  main { padding: 24px 32px; max-width: 1100px; margin: 0 auto; }
  #drop {
    border: 2px dashed var(--border); border-radius: 12px; padding: 48px;
    text-align: center; cursor: pointer; transition: all 0.15s ease;
    background: var(--panel);
  }
  #drop.hover { border-color: var(--accent); background: var(--panel2); }
  #drop p { margin: 0; color: var(--muted); }
  #drop strong { color: var(--text); }
  #file { display: none; }
  .verdict {
    margin: 24px 0; padding: 20px 24px; border-radius: 8px;
    border: 1px solid var(--border); font-weight: 600; font-size: 17px;
    display: flex; align-items: center; gap: 16px;
  }
  .verdict.bad   { background: #2a0e0e; border-color: var(--bad);  color: var(--bad);  }
  .verdict.warn  { background: #2a210e; border-color: var(--warn); color: var(--warn); }
  .verdict.ok    { background: #0e2a14; border-color: var(--ok);   color: var(--ok);   }
  .signal-dot {
    width: 28px; height: 28px; border-radius: 50%;
    box-shadow: 0 0 14px currentColor; flex-shrink: 0;
    background: currentColor;
  }
  .summary-list { margin: 0; padding-left: 0; list-style: none; }
  .summary-list li {
    padding: 8px 0 8px 28px; position: relative;
    font-size: 14px; line-height: 1.5; color: var(--text);
    border-bottom: 1px solid var(--border);
  }
  .summary-list li:last-child { border-bottom: none; }
  .summary-list li::before {
    content: ""; position: absolute; left: 6px; top: 14px;
    width: 10px; height: 10px; border-radius: 50%;
    background: var(--muted);
  }
  .summary-list li.good::before { background: var(--ok); }
  .summary-list li.warn::before { background: var(--warn); }
  .summary-list li.bad::before  { background: var(--bad); }
  .panel {
    background: var(--panel); border: 1px solid var(--border);
    border-radius: 8px; padding: 16px 20px; margin: 16px 0;
  }
  .panel h2 { margin: 0 0 12px 0; font-size: 14px; color: var(--muted);
    font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
  .finding {
    border-left: 3px solid var(--border); padding: 8px 12px; margin: 8px 0;
    background: var(--panel2); border-radius: 4px;
  }
  .finding .sev {
    display: inline-block; font-size: 11px; padding: 2px 6px;
    border-radius: 4px; margin-right: 8px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.05em;
  }
  .sev.CRITICAL { background: var(--bad);  color: white; }
  .sev.HIGH     { background: #b35900;     color: white; }
  .sev.MEDIUM   { background: var(--warn); color: black; }
  .sev.LOW      { background: #1f4d2a;     color: var(--ok); }
  .sev.INFO     { background: var(--border); color: var(--muted); }
  .finding .code { color: var(--muted); font-size: 12px; font-family: monospace; }
  .finding .msg  { display: block; margin-top: 4px; }
  .fields table { border-collapse: collapse; width: 100%; }
  .fields td { padding: 6px 8px; border-bottom: 1px solid var(--border); font-size: 13px; }
  .fields td:first-child { color: var(--muted); width: 30%; }
  .findings-table { border-collapse: collapse; width: 100%; font-size: 13px; }
  .findings-table th, .findings-table td {
    padding: 10px 12px; border-bottom: 1px solid var(--border);
    text-align: left; vertical-align: top;
  }
  .findings-table th {
    color: var(--muted); font-weight: 600; font-size: 11px;
    text-transform: uppercase; letter-spacing: 0.05em;
    background: var(--panel2);
  }
  .findings-table td.code-cell { font-family: monospace; font-size: 12px;
    color: var(--accent); white-space: nowrap; width: 28%; }
  .findings-table td.sev-cell { width: 12%; }
  .verdict-explainer {
    margin: -12px 0 16px 0; padding: 12px 16px;
    background: var(--panel2); border-radius: 4px;
    border-left: 3px solid var(--border); color: var(--muted);
    font-size: 13px; line-height: 1.5;
  }
  pre {
    background: #0a0d12; border: 1px solid var(--border); border-radius: 4px;
    padding: 12px; overflow-x: auto; font-size: 12px; color: var(--muted);
    max-height: 400px;
  }
  img.heat { max-width: 100%; border: 1px solid var(--border); border-radius: 4px; }
  .disclaimer {
    margin-top: 24px; padding: 12px 16px; background: var(--panel2);
    border-left: 3px solid var(--warn); color: var(--muted); font-size: 13px;
    border-radius: 4px;
  }
  #busy { color: var(--accent); font-size: 14px; margin-top: 16px; display: none; }
</style>
</head>
<body>
<header>
  <h1>Government Document Forensics</h1>
  <p>Detection &amp; verification only — never generation. Heuristics are supporting
     signals, not verdicts on their own.</p>
</header>
<main>
  <div id="drop" tabindex="0">
    <p><strong>Drop a document here</strong> or click to choose<br>
    PDF or image — analyzed locally, nothing leaves your machine.</p>
    <input id="file" type="file" accept=".pdf,image/*" />
  </div>
  <div id="busy">Analyzing…</div>
  <div id="result"></div>
</main>
<script>
  const drop = document.getElementById('drop');
  const file = document.getElementById('file');
  const busy = document.getElementById('busy');
  const result = document.getElementById('result');

  drop.addEventListener('click', () => file.click());
  drop.addEventListener('keydown', e => { if (e.key === 'Enter') file.click(); });
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('hover'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('hover'));
  drop.addEventListener('drop', e => {
    e.preventDefault(); drop.classList.remove('hover');
    if (e.dataTransfer.files.length) upload(e.dataTransfer.files[0]);
  });
  file.addEventListener('change', () => { if (file.files.length) upload(file.files[0]); });

  async function upload(f) {
    result.innerHTML = '';
    busy.style.display = 'block';
    const fd = new FormData();
    fd.append('file', f);
    let r;
    try {
      const resp = await fetch('/analyze', { method: 'POST', body: fd });
      r = await resp.json();
    } catch (e) {
      busy.style.display = 'none';
      result.innerHTML = '<div class="verdict bad">Request failed: ' + e + '</div>';
      return;
    }
    busy.style.display = 'none';
    render(r);
  }

  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

  // Plain-English explanation for every finding code the engine can emit.
  // Keep in sync with engine.py, issuer_verifiers/*.
  const EXPLAINERS = {
    META_MOD_BEFORE_CREATE:
      "The PDF reports a modification date EARLIER than its creation date. That's physically impossible without tampering or a misconfigured editor.",
    META_MOD_AFTER_CREATE:
      "The PDF was modified after creation. Normal for many docs (form fill, annotation, signature), but worth noting.",
    META_EDIT_TOOL_PRODUCER:
      "The PDF was last touched by an image- or document-editing tool (e.g. Photoshop, Word) rather than the original issuer software. Not proof of edits — but it raises the question.",
    META_ANNOTATIONS_PRESENT:
      "PDF carries annotation objects. Annotations can include text overlays, redaction boxes, sticky notes, or signature widgets. Worth checking visually that none cover real content.",
    REV_NO_EOF:
      "The PDF's end-of-file marker is missing or unusual — file may be truncated or hand-edited.",
    REV_SINGLE:
      "Single-revision PDF (never re-saved). No incremental update history to inspect.",
    REV_INCREMENTAL_SAVES:
      "PDF was re-saved one or more times after original creation. Could be a digital signature, a form-fill, or an edit — the next check tells which.",
    REV_CONTENT_DIFF:
      "DECISIVE. The engine recovered an earlier revision of this PDF and the visible text differs from the final revision. Strong evidence that fields were edited after the original was published.",
    REV_NO_VISIBLE_DIFF:
      "The engine recovered the earlier revision and the visible text is the same. Rules out the strongest tamper signal (field editing).",
    ELA_LOCALIZED_HOTSPOT:
      "Error-Level Analysis found a small cluster of blocks with elevated compression error. HINT that a region of an embedded image may have been edited — but legitimate stamps, signatures, or pasted logos also trigger this. Never decisive on its own.",
    ELA_DIFFUSE_HIGH:
      "ELA residual is high across the whole image, not localized. Often caused by repeated JPEG re-compression (e.g. forwarded scans) rather than tampering.",
    ELA_SINGLE_HOT_BLOCK:
      "A single isolated ELA hot block. Very weak signal — could be a tiny logo, a fold, or noise.",
    NOISE_BLOCK_OUTLIER:
      "A block of the image has noise statistics inconsistent with the rest of the page. Possible region-level edit, but compression artefacts also produce this.",
    CLONE_SELF_MATCH:
      "Copy-move detector found many feature pairs that match across the page. Repeated text, seals, watermarks, and identical logos all trigger this — usually benign.",
    QR_DECODED:
      "A QR / barcode was decoded successfully from the document.",
    QR_PAYLOAD_DOC_MISMATCH:
      "DECISIVE-grade. The QR code's payload does not match the visible document text (e.g. approval number, date). Strong evidence of substitution.",
    SIG_VALID:
      "Digital signature verified. Strong proof of byte-level integrity — the document has not been altered since it was signed.",
    SIG_BROKEN:
      "DECISIVE. Digital signature is present but FAILS validation. Direct evidence the file was altered after signing.",
    SIG_UNTRUSTED:
      "Digital signature is cryptographically intact but signed by a certificate not in the trusted root store. May still be authentic — verify the issuing CA out-of-band.",
    SIG_VALIDATION_ERROR:
      "Signature validation could not complete (library error or unsupported algorithm). Not a tamper signal — treat as inconclusive.",
    ISSUER_VERIFIED:
      "Document fields match the issuer's published register. Strong authenticity signal.",
    ISSUER_MISMATCH:
      "DECISIVE. The document references an issuer ID, but the issuer's register shows different details (name, product, date). Direct evidence of forgery or substitution.",
    ISSUER_NOT_FOUND:
      "The document references an ID that does not exist in the issuer's register. Could be a typo, a very recent issuance, or a fabricated ID — route to a human.",
    ISSUER_UNAVAILABLE:
      "The issuer's verification channel (CDSCO / FDA / EMA) is not reachable, or no recognizable ID was extracted. Cannot independently verify — manual confirmation needed.",
    ISSUER_ERROR:
      "Error while contacting the issuer register. Not a tamper signal — retry or check manually.",
    FORM25_28_DETECTED:
      "Document looks like a CDSCO/FDCA Form 25 / Form 28 / Form 28D — the most-tampered document type per the regulator. Form-specific stricter checks have been applied.",
    LICENCE_FORMAT_OK:
      "The extracted licence number matches the expected Gujarat FDCA format for this form (G/25/… for Form 25, G/28/… for Form 28).",
    LICENCE_FORMAT_INVALID:
      "Form 25/28 was detected but the licence number is missing or does not match the expected Gujarat FDCA format. Forgers often get this prefix wrong.",
    SIG_MISSING_ON_FORM:
      "STRONG SIGNAL. A Form 25/28 was detected but the PDF carries NO embedded digital signature. Genuine FDCA-issued copies are always signed by the Commissioner — absence is a major forgery indicator.",
    SIG_SIGNER_MISMATCH:
      "The Form 25/28 IS digitally signed, but the signer certificate does not name the expected FDCA Commissioner (e.g. Dr. H.G. Koshia / FDCA Gujarat). Verify the issuing CA out-of-band.",
    PREMISES_EXTRACTED:
      "Extracted manufacturer name and premises address from the document. Cross-reference these against the registered premises on file with FDCA for the cited licence number.",
  };

  const VERDICT_EXPLAINERS = {
    'TAMPERING DETECTED':
      "Strong evidence of tampering. Do not trust this document — escalate.",
    'SUSPICIOUS — HUMAN REVIEW':
      "Some warning signs found, but nothing conclusive. A person should check this document by hand.",
    'NO STRONG TAMPER SIGNAL':
      "Nothing suspicious was found. Note: this is not proof the document is genuine — always cross-check important documents with the issuing authority.",
  };

  // Plain-English bullets for the summary panel — one line per code.
  // Tone: a non-technical reader should be able to act on this.
  // Tag values: "good" (green dot), "warn" (yellow), "bad" (red), "info" (grey).
  const SUMMARIES = {
    META_MOD_BEFORE_CREATE:   { tag: "bad",  text: "Modification date is BEFORE the creation date — impossible without tampering." },
    META_MOD_AFTER_CREATE:    { tag: "info", text: "Document was edited after it was first created (often normal — e.g. a signature or form fill)." },
    META_EDIT_TOOL_PRODUCER:  { tag: "warn", text: "Document was last touched by a known PDF-editing tool." },
    META_ANNOTATIONS_PRESENT: { tag: "warn", text: "Document contains annotations or overlays — check none cover real content." },
    REV_NO_EOF:               { tag: "warn", text: "PDF file looks truncated or hand-edited." },
    REV_SINGLE:               { tag: "info", text: "Single-revision PDF (no edit history to inspect)." },
    REV_INCREMENTAL_SAVES:    { tag: "info", text: "Document was re-saved one or more times after first creation." },
    REV_CONTENT_DIFF:         { tag: "bad",  text: "An earlier version of this document was recovered, and the visible text was CHANGED after that earlier save." },
    REV_NO_VISIBLE_DIFF:      { tag: "good", text: "Earlier version recovered — visible text is unchanged. Rules out the strongest edit signal." },
    ELA_LOCALIZED_HOTSPOT:    { tag: "warn", text: "A small region of the page looks like it may have been edited (stamp, signature, or logo paste also trigger this)." },
    ELA_DIFFUSE_HIGH:         { tag: "info", text: "Whole-image compression noise is high — often just a forwarded or re-saved scan." },
    ELA_SINGLE_HOT_BLOCK:     { tag: "info", text: "One isolated spot of compression noise — very weak signal." },
    NOISE_BLOCK_OUTLIER:      { tag: "warn", text: "Part of the image has different noise statistics from the rest — possible region edit." },
    CLONE_SELF_MATCH:         { tag: "info", text: "Repeated patterns detected on the page — usually just identical text, seals, or logos." },
    QR_DECODED:               { tag: "good", text: "QR / barcode on the document was decoded and matches the visible text." },
    QR_PAYLOAD_DOC_MISMATCH:  { tag: "bad",  text: "The QR code's content does NOT match the document text — strong substitution signal." },
    SIG_VALID:                { tag: "good", text: "Document has a valid digital signature — strong proof it has not been altered since signing." },
    SIG_BROKEN:               { tag: "bad",  text: "Digital signature is BROKEN — the document was changed after it was signed." },
    SIG_UNTRUSTED:            { tag: "warn", text: "Digital signature is intact but issued by an unknown authority — verify the issuing CA manually." },
    SIG_VALIDATION_ERROR:     { tag: "info", text: "Could not check the digital signature (library error)." },
    ISSUER_VERIFIED:          { tag: "good", text: "Document details match the issuing authority's register." },
    ISSUER_MISMATCH:          { tag: "bad",  text: "Document references a real ID, but the issuer's register shows DIFFERENT details — strong forgery signal." },
    ISSUER_NOT_FOUND:         { tag: "warn", text: "The referenced approval / licence ID is not in the issuer's register." },
    ISSUER_UNAVAILABLE:       { tag: "info", text: "Could not check with the issuing authority (no ID or channel unavailable)." },
    ISSUER_ERROR:             { tag: "info", text: "Issuer check failed — retry or verify manually." },
    FORM25_28_DETECTED:       { tag: "info", text: "This looks like a Form 25 / Form 28 — the most-tampered document type. Extra checks were applied." },
    LICENCE_FORMAT_OK:        { tag: "good", text: "Licence number is in the expected Gujarat FDCA format." },
    LICENCE_FORMAT_INVALID:   { tag: "warn", text: "Licence number is missing or doesn't match the expected format for this form." },
    SIG_MISSING_ON_FORM:      { tag: "bad",  text: "This Form 25/28 has NO digital signature. Genuine ones are always signed by the FDCA Commissioner." },
    SIG_SIGNER_MISMATCH:      { tag: "bad",  text: "Form is signed, but the signer is NOT the expected FDCA Commissioner." },
    PREMISES_EXTRACTED:       { tag: "info", text: "Manufacturer and premises address extracted — cross-check these against the registered address on file." },
  };

  function buildSummary(r) {
    const seen = new Map();   // dedupe repeated codes
    for (const f of (r.findings || [])) {
      const s = SUMMARIES[f.code];
      if (!s) continue;
      if (!seen.has(f.code)) seen.set(f.code, s);
    }
    const bullets = [...seen.values()];

    // Add a leading reassurance bullet when nothing serious fired.
    const hasBad  = bullets.some(b => b.tag === "bad");
    const hasWarn = bullets.some(b => b.tag === "warn");
    if (!hasBad && !hasWarn) {
      bullets.unshift({ tag: "good",
        text: "No clear signs of tampering were found by any check." });
    }
    return bullets;
  }

  function render(r) {
    const v = r.verdict || '';
    let klass = 'warn';        // yellow signal — SUSPICIOUS
    let label = 'Needs review';
    if (v.indexOf('TAMPERING') === 0)   { klass = 'bad'; label = 'Likely tampered'; }
    else if (v.indexOf('NO STRONG') === 0) { klass = 'ok';  label = 'Looks clean'; }
    let html = '';
    html += '<div class="verdict ' + klass + '">' +
            '<span class="signal-dot" aria-hidden="true"></span>' +
            '<span>' + escapeHtml(label) + '</span></div>';

    const vExplain = VERDICT_EXPLAINERS[v];
    if (vExplain) {
      html += '<div class="verdict-explainer">' + escapeHtml(vExplain) + '</div>';
    }

    // Plain-English bullet summary — easiest thing for a non-technical reader.
    const bullets = buildSummary(r);
    if (bullets.length) {
      html += '<div class="panel"><h2>Summary</h2><ul class="summary-list">';
      for (const b of bullets) {
        html += '<li class="' + escapeHtml(b.tag) + '">' + escapeHtml(b.text) + '</li>';
      }
      html += '</ul></div>';
    }

    if (r.findings && r.findings.length) {
      html += '<div class="panel"><h2>Findings — what each one means</h2>';
      html += '<table class="findings-table">' +
              '<thead><tr>' +
              '<th>Code</th><th>Severity</th><th>What it means</th>' +
              '</tr></thead><tbody>';
      for (const f of r.findings) {
        const explain = EXPLAINERS[f.code] || f.message ||
          '(no plain-English description registered for this code)';
        html += '<tr>' +
                '<td class="code-cell">' + escapeHtml(f.analyzer) + '/' +
                  escapeHtml(f.code) + '</td>' +
                '<td class="sev-cell"><span class="sev ' + escapeHtml(f.severity) +
                  '">' + escapeHtml(f.severity) + '</span></td>' +
                '<td>' + escapeHtml(explain) +
                  '<div style="color:var(--muted);font-size:12px;margin-top:4px">' +
                  escapeHtml(f.message) + '</div></td>' +
                '</tr>';
      }
      html += '</tbody></table></div>';
    } else {
      html += '<div class="panel"><h2>Findings</h2>' +
              '<p style="color:var(--muted);margin:0">No findings emitted. ' +
              'This usually means the document looks clean to every analyzer — ' +
              'but see the verdict explainer above.</p></div>';
    }

    if (r.extracted_fields && Object.keys(r.extracted_fields).length) {
      html += '<div class="panel fields"><h2>Extracted Fields</h2><table>';
      for (const [k, v] of Object.entries(r.extracted_fields)) {
        html += '<tr><td>' + escapeHtml(k) + '</td><td>' + escapeHtml(v) + '</td></tr>';
      }
      html += '</table></div>';
    }

    if (r.ela_heatmap_b64) {
      html += '<div class="panel"><h2>ELA Heatmap</h2>' +
              '<img class="heat" src="data:image/png;base64,' + r.ela_heatmap_b64 + '" /></div>';
    }

    html += '<div class="panel"><h2>Raw Layers</h2><pre>' +
            escapeHtml(JSON.stringify(r.layers, null, 2)) + '</pre></div>';

    html += '<div class="disclaimer">' + escapeHtml(r.disclaimer || '') + '</div>';
    result.innerHTML = html;
  }
</script>
</body>
</html>
"""
