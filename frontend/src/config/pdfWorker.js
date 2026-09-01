import * as pdfjsLib from 'pdfjs-dist';

/* ============================================================================
   Central pdf.js configuration. Import this once from any module that renders
   a PDF, instead of configuring the worker at each call site.

   Two things were previously wrong and both produced an endless "Loading PDF…":

   1. The worker was loaded from `//unpkg.com/pdfjs-dist@<version>/build/...`.
      When that CDN is unreachable — offline, restricted network, or an air-
      gapped ministry machine — pdf.js silently falls back to decoding on the
      main thread, which is extremely slow, or never resolves at all. The worker
      is a package file, so it is served from our own origin instead.

   2. Stored documents now require an authenticated session. pdf.js issues its
      own request for the URL, and because the API is a different origin from
      the app during development, the session cookie is not attached unless the
      request explicitly asks for credentials.
   ============================================================================ */

/* Copied from node_modules/pdfjs-dist/build/ into public/ so it is served by
   the app itself. Re-copy it when pdfjs-dist is upgraded. */
pdfjsLib.GlobalWorkerOptions.workerSrc = `${process.env.PUBLIC_URL || ''}/pdf.worker.min.mjs`;

/**
 * Build the parameters for pdfjsLib.getDocument().
 * Same-origin blob: and data: URLs need no credentials; anything fetched over
 * HTTP does, because stored documents sit behind the session guard.
 */
export function pdfDocumentParams(url, extra = {}) {
  const needsCredentials = /^https?:/i.test(String(url || ''));
  return { url, withCredentials: needsCredentials, ...extra };
}

export { pdfjsLib };
