import { useEffect, useRef, useState, useCallback } from 'react'
import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc =
  `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`

// Set DEBUG_OCR_BOXES = true to draw red outlines on every OCR block
// so you can visually verify alignment against the rendered PDF page.
const DEBUG_OCR_BOXES = false

// ── regex escape ──────────────────────────────────────────────────────────────
function escapeRx(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, (ch) => '\\' + ch)
}

// ── parse HTML into individual lines ─────────────────────────────────────────
function htmlToLines(html) {
  if (!html) return []
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
  return withBreaks.split('\n').map(l => l.trim()).filter(l => l.length > 0)
}

// ── strip HTML tags, return plain text ───────────────────────────────────────
function stripHtml(html) {
  if (!html) return ''
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── parse table rows — returns array of {cells: string[], rowHtml} ───────────
function parseTableRowsWithCells(html) {
  const rows = []
  const lower = html.toLowerCase()
  let pos = 0
  while (pos < html.length) {
    const trStart = lower.indexOf('<tr', pos)
    if (trStart === -1) break
    const trEnd = lower.indexOf('</tr>', trStart)
    if (trEnd === -1) break
    const rowHtml  = html.slice(trStart, trEnd + 5)
    const rowLower = rowHtml.toLowerCase()
    const cells    = []
    let cpos       = 0
    while (cpos < rowHtml.length) {
      const tdStart = rowLower.indexOf('<td', cpos)
      if (tdStart === -1) break
      const tdClose = rowHtml.indexOf('>', tdStart)
      if (tdClose === -1) break
      const tdEnd = rowLower.indexOf('</td>', tdClose)
      if (tdEnd === -1) break
      const cellText = stripHtml(rowHtml.slice(tdClose + 1, tdEnd)).trim()
      cells.push(cellText)
      cpos = tdEnd + 5
    }
    if (cells.some(c => c)) rows.push(cells)
    pos = trEnd + 5
  }
  return rows
}

// ── parse table rows using indexOf (avoids regex escaping issues) ─────────────
// Returns an array of strings — one per <tr>, with all <td> values joined.
function parseTableRows(html) {
  return parseTableRowsWithCells(html).map(cells => cells.filter(c => c).join('   '))
}

// ── UNIFIED: extract positioned OCR blocks from Datalab JSON ─────────────────
//
// Datalab returns bbox in pixels of the rendered image it processed internally.
// page.bbox = [0, 0, imageW, imageH] in pixels.
// We normalize to 0-1 by dividing by imageW/imageH.
// PDF.js renders using PDF points — the normalization makes them compatible.
//
// The bbox format is [x1, y1, x2, y2] where origin is TOP-LEFT.
//
export function extractOcrBlocks(jsonData) {
  if (!jsonData || typeof jsonData !== 'object') return []
  const result = []

  const pages = jsonData.children || []
  pages.forEach((page, pageIdx) => {
    const pageBbox = page.bbox
    // pageBbox[2] = image width in px, pageBbox[3] = image height in px
    const pageW = pageBbox ? (pageBbox[2] - (pageBbox[0] || 0)) : 1654
    const pageH = pageBbox ? (pageBbox[3] - (pageBbox[1] || 0)) : 2339
    if (!pageW || !pageH) return

    ;(page.children || []).forEach(block => {
      const blockBbox = block.bbox
      if (!blockBbox || blockBbox.length < 4) return
      const [bx1, by1, bx2, by2] = blockBbox
      const blockH = by2 - by1

      // ── Case A: per-line children each with their own bbox ────────────────
      const lineChildren = (block.children || []).filter(
        ch => ch.bbox && ch.bbox.length >= 4
      )
      if (lineChildren.length > 0) {
        lineChildren.forEach(line => {
          const text = stripHtml(line.html) || (line.text || '').trim()
          if (!text) return
          const [lx1, ly1, lx2, ly2] = line.bbox
          result.push({
            text,
            bbox: [lx1 / pageW, ly1 / pageH, lx2 / pageW, ly2 / pageH],
            page: pageIdx,
            lines: 1,
          })
        })
        return
      }

      // ── Case C: Table / TableOfContents → one div per row ─────────────────
      const isTable = block.block_type === 'Table' ||
                      block.block_type === 'TableOfContents'
      if (isTable) {
        const rows = parseTableRowsWithCells(block.html || block.text || '')
        if (rows.length > 0) {
          const rowH = blockH / rows.length
          rows.forEach((cells, ri) => {
            const rowText = cells.filter(c => c).join('   ')
            if (!rowText) return
            const ry1 = by1 + ri * rowH
            const ry2 = ry1 + rowH
            result.push({
              text:  rowText,
              cells: cells, // Store individual cell texts for accurate highlighting
              bbox:  [bx1 / pageW, ry1 / pageH, bx2 / pageW, ry2 / pageH],
              page:  pageIdx,
              lines: 1,
            })
          })
          return
        }
      }

      // ── Case B: plain block → one entry per line ──────────────────────────
      const htmlLines = htmlToLines(block.html || block.text || '')
      const lineTexts = htmlLines.length > 0
        ? htmlLines
        : [stripHtml(block.html || block.text || '')]
      const nonEmpty = lineTexts.filter(l => l.trim())
      if (nonEmpty.length === 0) return
      const lineStepH = blockH / nonEmpty.length
      nonEmpty.forEach((lineText, li) => {
        const ly1 = by1 + li * lineStepH
        const ly2 = ly1 + lineStepH
        result.push({
          text:  lineText,
          bbox:  [bx1 / pageW, ly1 / pageH, bx2 / pageW, ly2 / pageH],
          page:  pageIdx,
          lines: 1,
        })
      })
    })
  })

  return result
}

// ── compute highlights for one page (PDF.js text layer) ──────────────────────
function getHighlights(query, items, vp) {
  if (!items?.length || !vp || !query?.trim()) return []
  let full = ''; const map = []
  items.forEach(item => {
    for (let c = 0; c < (item.str || '').length; c++) map.push({ item, c })
    full += item.str || ''
  })
  const rects = []
  const regex = new RegExp(escapeRx(query), 'gi')
  let m
  regex.lastIndex = 0
  while ((m = regex.exec(full)) !== null) {
    let seg = null
    for (let ci = m.index; ci < m.index + m[0].length; ci++) {
      if (ci >= map.length) break
      const { item, c } = map[ci]
      if (!seg || seg.item !== item) {
        if (seg) rects.push(toRect(seg.item, seg.s, seg.e, vp))
        seg = { item, s: c, e: c + 1 }
      } else seg.e = c + 1
    }
    if (seg) rects.push(toRect(seg.item, seg.s, seg.e, vp))
  }
  return rects.filter(Boolean)
}

function toRect(item, s, e, vp) {
  if (!item) return null
  const [, , , sy, tx, ty] = item.transform
  const x = tx * vp.scale, y = vp.height - ty * vp.scale
  const w = item.width * vp.scale, h = Math.abs(sy) * vp.scale
  const len = item.str.length
  if (!len || w <= 0) return null
  const cw = w / len

  // RTL detection for Urdu/Arabic text
  const isRTL = item.dir === 'rtl' || /[\u0600-\u06FF\u0750-\u077F]/.test(item.str)
  let left, width
  if (isRTL) {
    // In RTL, char index 0 is at the right edge; higher index moves left
    left  = x + (len - e) * cw
    width = (e - s) * cw
  } else {
    left  = x + s * cw
    width = (e - s) * cw
  }
  return { left, top: y - h, width, height: h + 2 }
}

// Measure text width using a hidden canvas — works correctly for RTL Urdu/Arabic.
let _measureCanvas = null
let _measureCtx = null
function getMeasureCtx() {
  if (!_measureCtx) {
    _measureCanvas = document.createElement('canvas')
    _measureCtx = _measureCanvas.getContext('2d')
  }
  return _measureCtx
}

function measureTextWidth(text, fontSize) {
  const ctx = getMeasureCtx()
  ctx.font = `${fontSize}px "Noto Nastaliq Urdu","Noto Naskh Arabic","Arial Unicode MS",sans-serif`
  return ctx.measureText(text).width
}

// Check if a string contains RTL (Urdu/Arabic) characters
function hasRTL(text) {
  return /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFEFC]/.test(text)
}

// Compute a tight highlight rect around a substring match within an OCR block.
//
// Strategy:
//  1. For table rows (block.cells), find which cell contains the match and
//     measure only within that cell. The Urdu title cell is the widest RTL
//     cell — we estimate its column bounds using proportional widths.
//  2. For plain text blocks, measure prefix/suffix within the line text using
//     canvas measureText() with the correct font.
//  3. All RTL text is measured with the Urdu font so widths are accurate.
function ocrMatchRect(block, charIdx, matchLen, canvasW, canvasH) {
  const [x1, y1, x2, y2] = block.bbox
  const L = x1 * canvasW
  const T = y1 * canvasH
  const W = (x2 - x1) * canvasW
  const H = (y2 - y1) * canvasH
  if (W <= 0 || H <= 0) return null

  const lineH = H  // blocks are always single-line after extractOcrBlocks
  const fontSize = Math.max(8, lineH * 0.65)

  // ── Table rows: locate the matching cell, estimate its column bbox ─────────
  if (block.cells && block.cells.length > 1) {
    // Find which cell contains the match by scanning the joined text offsets
    // The joined text is: cells.filter(c=>c).join('   ')
    // We need to map charIdx in the joined text back to a specific cell
    let offset = 0
    let matchCell = null
    let matchLocalIdx = 0
    const nonEmptyCells = block.cells.map((c, i) => ({ text: c, origIdx: i })).filter(c => c.text)

    for (let ci = 0; ci < nonEmptyCells.length; ci++) {
      const { text: cell, origIdx } = nonEmptyCells[ci]
      const cellEnd = offset + cell.length
      if (charIdx >= offset && charIdx < cellEnd) {
        matchCell = cell
        matchLocalIdx = charIdx - offset
        break
      }
      // separator is 3 spaces between cells
      offset = cellEnd + (ci < nonEmptyCells.length - 1 ? 3 : 0)
    }

    if (matchCell) {
      // Measure all (non-empty) cells to estimate proportional column widths
      const cellWidths = nonEmptyCells.map(c => Math.max(1, measureTextWidth(c.text || ' ', fontSize)))
      const totalMeasured = cellWidths.reduce((a, b) => a + b, 0)

      const matchCellLocalIdx = nonEmptyCells.findIndex(c => c.text === matchCell)
      const widthBefore = cellWidths.slice(0, matchCellLocalIdx).reduce((a, b) => a + b, 0)
      const cellMeasuredW = cellWidths[matchCellLocalIdx]
      const scale = W / totalMeasured

      const isRTLCell = hasRTL(matchCell)
      const colLeft = L + widthBefore * scale
      const colW = cellMeasuredW * scale

      if (isRTLCell) {
        const suffix    = matchCell.slice(matchLocalIdx + matchLen)
        const matchText = matchCell.slice(matchLocalIdx, matchLocalIdx + matchLen)
        const suffixW   = measureTextWidth(suffix, fontSize) * (colW / cellMeasuredW)
        const matchW    = measureTextWidth(matchText, fontSize) * (colW / cellMeasuredW)
        const matchRight = colLeft + colW - suffixW
        const matchLeft  = Math.max(colLeft, matchRight - matchW)
        return { left: matchLeft, top: T, width: Math.max(4, Math.min(matchW, colLeft + colW - matchLeft)), height: lineH }
      } else {
        const prefix    = matchCell.slice(0, matchLocalIdx)
        const matchText = matchCell.slice(matchLocalIdx, matchLocalIdx + matchLen)
        const prefixW   = measureTextWidth(prefix, fontSize) * (colW / cellMeasuredW)
        const matchW    = measureTextWidth(matchText, fontSize) * (colW / cellMeasuredW)
        const matchLeft = Math.max(colLeft, colLeft + prefixW)
        return { left: matchLeft, top: T, width: Math.max(4, Math.min(matchW, colLeft + colW - matchLeft)), height: lineH }
      }
    }
  }

  // ── Plain text block ───────────────────────────────────────────────────────
  const text = block.text
  const totalW = measureTextWidth(text, fontSize)
  if (totalW <= 0) return { left: L, top: T, width: W, height: lineH }

  const scale = W / totalW
  const isRTL = hasRTL(text)

  if (isRTL) {
    const suffix    = text.slice(charIdx + matchLen)
    const matchText = text.slice(charIdx, charIdx + matchLen)
    const suffixW   = measureTextWidth(suffix, fontSize) * scale
    const matchW    = measureTextWidth(matchText, fontSize) * scale
    const matchRight = L + W - suffixW
    const matchLeft  = Math.max(L, matchRight - matchW)
    return { left: matchLeft, top: T, width: Math.max(4, Math.min(matchW, L + W - matchLeft)), height: lineH }
  } else {
    const prefix    = text.slice(0, charIdx)
    const matchText = text.slice(charIdx, charIdx + matchLen)
    const prefixW   = measureTextWidth(prefix, fontSize) * scale
    const matchW    = measureTextWidth(matchText, fontSize) * scale
    return { left: Math.max(L, L + prefixW), top: T, width: Math.max(4, matchW), height: lineH }
  }
}

function getTextItemStyle(item, vp) {
  if (!item || !vp) return null
  const [scaleX, skewX, , scaleY, tx, ty] = item.transform
  const fontSize = Math.sqrt(scaleX * scaleX + skewX * skewX)
  const angle    = Math.atan2(skewX, scaleX) * (180 / Math.PI)
  const x        = tx * vp.scale
  const y        = vp.height - ty * vp.scale
  const itemW    = item.width * vp.scale
  const itemH    = Math.abs(scaleY) * vp.scale
  const scaleXF  = item.str && item.str.length > 0 && itemW > 0
    ? itemW / Math.max(1, item.str.length * fontSize * vp.scale * 0.6)
    : 1
  return {
    position: 'absolute',
    left: x, top: y - itemH, width: itemW, height: itemH,
    fontSize: fontSize * vp.scale,
    fontFamily: item.fontName || 'sans-serif',
    color: 'transparent', whiteSpace: 'pre', cursor: 'text',
    userSelect: 'text', WebkitUserSelect: 'text',
    transformOrigin: '0% 100%',
    transform: `${angle !== 0 ? `rotate(${angle}deg) ` : ''}scaleX(${scaleXF})`,
  }
}

function isGarbledItems(items) {
  // Disabled — Indian government PDFs often use private-use font encodings
  // which falsely triggered this check and blocked all search highlights.
  // We always attempt text-layer search regardless of character encoding.
  return false
}

// ── single page ───────────────────────────────────────────────────────────────
function PdfPage({
  pdf, pageNum, scale, searchQuery,
  activeGlobal, globalOffset, onReady,
  wrapRef, pageOcrBlocks, activeOcrMatch,
}) {
  const canvasRef = useRef()
  const taskRef   = useRef(null)
  const dataRef   = useRef({ items: [], vp: null })

  const [hl,        setHl]        = useState([])
  const [textItems, setTextItems] = useState([])
  const [vpState,   setVpState]   = useState(null)
  const [garbled,   setGarbled]   = useState(false)

  useEffect(() => {
    if (!pdf || scale <= 0) return
    let dead = false
    ;(async () => {
      if (taskRef.current) { taskRef.current.cancel(); taskRef.current = null }
      const page   = await pdf.getPage(pageNum)
      const canvas = canvasRef.current
      if (!canvas || dead) return
      const vp = page.getViewport({ scale })
      canvas.width  = vp.width
      canvas.height = vp.height

      taskRef.current = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp })
      try { await taskRef.current.promise }
      catch (e) { if (e?.name === 'RenderingCancelledException') return }
      if (dead) return
      const tc        = await page.getTextContent()
      const isGarbled = isGarbledItems(tc.items)
      dataRef.current = { items: tc.items, vp }
      setTextItems(tc.items)
      setVpState(vp)
      setGarbled(isGarbled)
      const rects = isGarbled ? [] : getHighlights(searchQuery, tc.items, vp)
      setHl(rects)
      onReady(pageNum, rects)
    })()
    return () => { dead = true; taskRef.current?.cancel() }
  }, [pdf, pageNum, scale])

  useEffect(() => {
    const { items, vp } = dataRef.current
    const rects = garbled ? [] : getHighlights(searchQuery, items, vp)
    setHl(rects)
    onReady(pageNum, rects)
  }, [searchQuery, garbled])

  return (
    <div
      ref={wrapRef}
      style={{
        position: 'relative', display: 'inline-block',
        boxShadow: '0 4px 20px rgba(0,0,0,.12)',
        marginBottom: 16, lineHeight: 0,
      }}
    >
      <canvas ref={canvasRef} style={{ display: 'block' }} />

      {/* ── OCR overlay ── */}
      {vpState && pageOcrBlocks?.length > 0 && (() => {
        const canvasW = vpState.width
        const canvasH = vpState.height
        const query   = searchQuery?.trim()
        const qLower  = query?.toLowerCase()

        // Collect precise per-match highlight rects from OCR blocks
        const ocrHlRects = []
        if (query) {
          pageOcrBlocks.forEach((block, blockI) => {
            const text  = block.text
            const lower = text.toLowerCase()
            let pos = 0
            while (true) {
              const idx = lower.indexOf(qLower, pos)
              if (idx === -1) break
              const r = ocrMatchRect(block, idx, query.length, canvasW, canvasH)
              // Mark as active if this exact block+charIdx matches the active match
              const isActive = !!(
                activeOcrMatch &&
                activeOcrMatch.blockIdx === blockI &&
                activeOcrMatch.charIdx  === idx
              )
              if (r) ocrHlRects.push({ ...r, isActive })
              pos = idx + query.length
            }
          })
        }

        return (
          <div style={{
            position: 'absolute', left: 0, top: 0,
            width: canvasW, height: canvasH,
            pointerEvents: 'none', overflow: 'hidden',
          }}>
            {/* Selectable OCR text blocks (transparent) */}
            {pageOcrBlocks.map((block, i) => {
              const [x1, y1, x2, y2] = block.bbox
              const L = x1 * canvasW
              const T = y1 * canvasH
              const W = (x2 - x1) * canvasW
              const H = (y2 - y1) * canvasH
              const nLines   = block.lines || 1
              const lineH    = H / nLines
              const fontSize = Math.max(6, lineH * 0.55)

              return (
                <div
                  key={i}
                  style={{
                    position:         'absolute',
                    left: L, top: T, width: W, height: H,
                    overflow:         'hidden',
                    boxSizing:        'border-box',
                    color:            'transparent',
                    border:           DEBUG_OCR_BOXES ? '1px solid red' : 'none',
                    userSelect:       'text',
                    WebkitUserSelect: 'text',
                    cursor:           'text',
                    pointerEvents:    'auto',
                  }}
                >
                  <span
                    ref={el => {
                      if (!el) return
                      const nW = el.scrollWidth  || el.offsetWidth
                      const nH = el.scrollHeight || el.offsetHeight
                      if (nW > 0 && nH > 0 && W > 0 && H > 0) {
                        el.style.transform       = 'scale(' + (W / nW) + ',' + (H / nH) + ')'
                        el.style.transformOrigin = 'right bottom'
                      }
                    }}
                    style={{
                      display:          'inline-block',
                      fontSize,
                      lineHeight:       lineH + 'px',
                      fontFamily:       '"Noto Nastaliq Urdu","Noto Naskh Arabic","Arial Unicode MS",sans-serif',
                      direction:        'rtl',
                      unicodeBidi:      'plaintext',
                      textAlign:        'right',
                      whiteSpace:       nLines > 1 ? 'pre-wrap' : 'nowrap',
                      wordBreak:        nLines > 1 ? 'break-word' : 'normal',
                      position:         'absolute',
                      bottom:           0,
                      right:            0,
                    }}
                    dangerouslySetInnerHTML={{ __html: block.text }}
                  />
                </div>
              )
            })}

            {/* Precise word-level highlight rects */}
            {ocrHlRects.map((r, i) => (
              <div key={'hl-' + i} style={{
                position:     'absolute',
                left:         r.left,
                top:          r.top,
                width:        r.width,
                height:       r.height,
                background:   r.isActive ? 'rgba(251,191,36,0.85)' : 'rgba(254,240,138,0.55)',
                border:       '1.5px solid ' + (r.isActive ? '#d97706' : '#f59e0b'),
                borderRadius: 2,
                mixBlendMode: 'multiply',
                pointerEvents:'none',
                zIndex:       10,
              }} />
            ))}
          </div>
        )
      })()}

      {/* ── Selectable text layer (digital PDFs) ── */}
      {!garbled && vpState && textItems.length > 0 && (
        <div style={{
          position: 'absolute', left: 0, top: 0,
          width: vpState.width, height: vpState.height,
          overflow: 'hidden', pointerEvents: 'none',
        }}>
          {textItems.map((item, i) => {
            if (!item.str) return null
            const style = getTextItemStyle(item, vpState)
            if (!style) return null
            return <span key={i} style={{ ...style, pointerEvents: 'auto' }}>{item.str}</span>
          })}
        </div>
      )}

      {/* ── Search highlight boxes (PDF.js text layer) ── */}
      {hl.map((r, i) => {
        const isActive = (globalOffset + i) === activeGlobal
        return (
          <div key={i} style={{
            position: 'absolute',
            left: r.left, top: r.top, width: r.width, height: r.height,
            background:   isActive ? 'rgba(251,191,36,.85)' : 'rgba(254,240,138,.55)',
            border:       '1.5px solid ' + (isActive ? '#d97706' : '#f59e0b'),
            borderRadius: 2, pointerEvents: 'none', zIndex: 10, mixBlendMode: 'multiply',
          }} />
        )
      })}
    </div>
  )
}

// ── main viewer ───────────────────────────────────────────────────────────────
export default function PDFViewer({ file, searchQuery, ocrText, ocrBlocks }) {
  const [pdf,         setPdf]         = useState(null)
  const [numPages,    setPages]       = useState(0)
  const [fitScale,    setFit]         = useState(null)
  const [zoom,        setZoom]        = useState(1.0)
  const [copyStatus,  setCopyStatus]  = useState(null)
  const [pageHl,      setPageHl]      = useState({})
  const [activeMatch, setActive]      = useState(0)
  const [allPageText, setAllPageText] = useState({})

  const scrollRef = useRef()
  const pageRefs  = useRef({})

  useEffect(() => {
    if (!file) return
    setPdf(null); setPages(0); setFit(null)
    setPageHl({}); setActive(0); setAllPageText({})
    const url = URL.createObjectURL(file)
    let doc = null
    pdfjsLib.getDocument({ url }).promise.then(d => { doc = d; setPdf(d); setPages(d.numPages) })
    return () => {
      if (doc) URL.revokeObjectURL(url)
      else setTimeout(() => URL.revokeObjectURL(url), 5000)
    }
  }, [file])

  useEffect(() => {
    if (!pdf) return
    ;(async () => {
      const texts = {}
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p)
        const tc   = await page.getTextContent()
        texts[p]   = tc.items.map(it => it.str).join(' ')
      }
      setAllPageText(texts)
    })()
  }, [pdf])

  // Always treat as non-scanned so text-layer search always runs.
  // Indian govt PDFs with PUA font encodings were falsely detected as scanned.
  const isScanned = false

  async function handleCopyAll() {
    const full = ocrText?.trim()
      ? ocrText
      : Object.keys(allPageText).sort((a, b) => +a - +b).map(p => allPageText[p]).join('\n\n')
    if (!full.trim()) return
    setCopyStatus('copying')
    try { await navigator.clipboard.writeText(full) }
    catch {
      const ta = document.createElement('textarea')
      ta.value = full; ta.style.cssText = 'position:fixed;opacity:0'
      document.body.appendChild(ta); ta.select()
      document.execCommand('copy'); document.body.removeChild(ta)
    }
    setCopyStatus('copied')
    setTimeout(() => setCopyStatus(null), 2000)
  }

  useEffect(() => {
    if (!pdf || !scrollRef.current) return
    pdf.getPage(1).then(page => {
      const containerW = scrollRef.current.clientWidth || 700
      const base = page.getViewport({ scale: 1 })
      const maxW = Math.min(containerW - 48, 860)
      setFit(maxW / base.width)
    })
  }, [pdf])

  useEffect(() => { setActive(0) }, [searchQuery])

  const handleReady = useCallback((pageNum, rects) => {
    setPageHl(prev => ({ ...prev, [pageNum]: rects }))
  }, [])

  const scale = fitScale ? fitScale * zoom : 0

  const allOcrBlocks    = ocrBlocks ? extractOcrBlocks(ocrBlocks) : []
  const ocrBlocksByPage = {}
  for (const b of allOcrBlocks) {
    const p = b.page + 1
    if (!ocrBlocksByPage[p]) ocrBlocksByPage[p] = []
    ocrBlocksByPage[p].push(b)
  }

  const allMatches = []
  const useOcrSearch = allOcrBlocks.length > 0 && searchQuery?.trim()
  if (useOcrSearch) {
    const qLower = searchQuery.toLowerCase()
    for (let p = 1; p <= numPages; p++) {
      ;(ocrBlocksByPage[p] || []).forEach((block, blockIdx) => {
        const lower = block.text.toLowerCase()
        let pos = 0
        let matchCount = 0
        while (true) {
          const idx = lower.indexOf(qLower, pos)
          if (idx === -1) break
          allMatches.push({ pageNum: p, blockIdx, charIdx: idx, isOcr: true })
          pos = idx + searchQuery.length
          matchCount++
        }
      })
    }
  } else {
    let off2 = 0
    for (let p = 1; p <= numPages; p++) {
      const rects = pageHl[p] || []
      rects.forEach((_, i) => allMatches.push({ pageNum: p, rectIdx: i, globalOffset: off2 + i }))
      off2 += rects.length
    }
  }

  const total    = allMatches.length
  const safeIdx  = total > 0 ? ((activeMatch % total) + total) % total : 0
  const curMatch = allMatches[safeIdx]

  // Pass active match details per page for OCR mode
  // activeOcrByPage[pageNum] = { blockIdx, charIdx } of the active match
  const activeOcrByPage = {}
  if (curMatch?.isOcr) {
    activeOcrByPage[curMatch.pageNum] = { blockIdx: curMatch.blockIdx, charIdx: curMatch.charIdx }
  }

  const pageOffsets = {}
  let off = 0
  for (let p = 1; p <= numPages; p++) {
    pageOffsets[p] = off
    off += (pageHl[p] || []).length
  }

  useEffect(() => {
    if (!curMatch || !scrollRef.current) return
    const wrap = pageRefs.current[curMatch.pageNum]
    if (!wrap) return
    if (curMatch.isOcr) {
      scrollRef.current.scrollTo({ top: wrap.offsetTop - 80, behavior: 'smooth' })
    } else {
      const rect = (pageHl[curMatch.pageNum] || [])[curMatch.rectIdx]
      if (!rect) return
      scrollRef.current.scrollTo({ top: wrap.offsetTop + rect.top - 140, behavior: 'smooth' })
    }
  }, [safeIdx, total])

  if (!file) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <p style={{ fontSize: 13, color: '#94a3b8' }}>No PDF uploaded</p>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 16px', background: 'white', borderBottom: '1px solid #e2e8f0',
        flexShrink: 0, gap: 8, flexWrap: 'wrap',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600, letterSpacing: 0.2 }}>
            {numPages > 0 ? `${numPages} page${numPages !== 1 ? 's' : ''}` : 'Loading…'}
          </span>
          {searchQuery?.trim() && (
            <>
              {total > 0
                ? <span style={{ background: '#fef3c7', color: '#92400e', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>
                    {safeIdx + 1} / {total}
                  </span>
                : <span style={{ color: '#ef4444', fontSize: 12, fontWeight: 600 }}>No matches</span>
              }
              {total > 1 && <>
                <button onClick={() => setActive(a => (a - 1 + total) % total)} style={navBtnStyle()}>‹</button>
                <button onClick={() => setActive(a => (a + 1) % total)} style={navBtnStyle()}>›</button>
              </>}
            </>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button onClick={() => setZoom(z => Math.max(0.5, +(z - 0.25).toFixed(2)))} disabled={zoom <= 0.5} style={zoomBtnStyle(zoom <= 0.5)}>−</button>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#475569', minWidth: 38, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.min(3.0, +(z + 0.25).toFixed(2)))} disabled={zoom >= 3.0} style={zoomBtnStyle(zoom >= 3.0)}>+</button>
          <button onClick={() => setZoom(1.0)} style={{ ...zoomBtnStyle(false), fontSize: 11, padding: '0 8px', width: 'auto' }}>Reset</button>
          <button
            onClick={handleCopyAll}
            disabled={!pdf || copyStatus === 'copying'}
            style={{
              ...zoomBtnStyle(!pdf || copyStatus === 'copying'),
              width: 'auto', padding: '0 10px', fontSize: 11, fontWeight: 700,
              background: copyStatus === 'copied' ? '#dcfce7' : 'white',
              color:      copyStatus === 'copied' ? '#16a34a'  : '#374151',
              border:     '1px solid ' + (copyStatus === 'copied' ? '#86efac' : '#e2e8f0'),
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            {copyStatus === 'copied' ? '✓ Copied!' : '📋 Copy Text'}
          </button>
        </div>
      </div>

      {/* pages */}
      <div ref={scrollRef} style={{
        flex: 1, overflowY: 'auto', overflowX: 'auto',
        background: '#525659', padding: '24px 16px',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        position: 'relative',
      }}>
        {pdf && numPages > 0 && scale > 0 &&
          Array.from({ length: numPages }, (_, i) => i + 1).map(n => (
            <PdfPage
              key={file.name + '-p' + n}
              pdf={pdf} pageNum={n} scale={scale}
              searchQuery={searchQuery}
              activeGlobal={safeIdx}
              globalOffset={pageOffsets[n] ?? 0}
              onReady={handleReady}
              wrapRef={el => { pageRefs.current[n] = el }}
              pageOcrBlocks={ocrBlocksByPage[n] || []}
              activeOcrMatch={activeOcrByPage[n] ?? null}
            />
          ))
        }
        {isScanned && ocrText?.trim() && allOcrBlocks.length === 0 && (
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', padding: '16px', zIndex: 5 }}>
            <div style={{
              color: 'transparent',
              fontFamily: '"Noto Nastaliq Urdu","Noto Naskh Arabic","Arial Unicode MS",sans-serif',
              fontSize: 14, lineHeight: 2, whiteSpace: 'pre-wrap',
              userSelect: 'text', WebkitUserSelect: 'text',
              cursor: 'text', pointerEvents: 'auto',
              direction: 'auto', unicodeBidi: 'plaintext',
            }}>
              {ocrText}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── style helpers ─────────────────────────────────────────────────────────────
function zoomBtnStyle(disabled) {
  return {
    width: 28, height: 28, border: '1px solid #e2e8f0', borderRadius: 7,
    background: disabled ? '#f1f5f9' : 'white',
    color:      disabled ? '#94a3b8' : '#374151',
    fontSize: 16, fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    lineHeight: 1, padding: 0,
  }
}
function navBtnStyle() {
  return {
    width: 26, height: 26, border: '1px solid #e2e8f0', borderRadius: 6,
    background: 'white', color: '#374151', fontSize: 18, fontWeight: 700,
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    lineHeight: 1, padding: 0,
  }
}
