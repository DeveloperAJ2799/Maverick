# Plan: Fix CLAUDE.md Document & File Generation Section

## Context

The CLAUDE.md created earlier has a misleading "Key gap: no freeform document → file export" section. The app **already has** general-purpose file generation capabilities:

- **Client-side PDF**: `exportAsPdf()` in `static/js/document.js:9169` uses `html2pdf.js` (html2canvas + jsPDF) — converts markdown→HTML→PDF in the browser
- **Client-side DOCX**: `exportAsDocx()` in `static/js/document.js:9203` uses `docx.umd.min.js` — converts markdown→DOCX in the browser
- **Export menu** (line 9107-9116): offers "Export Markdown", "Export HTML", "Print as PDF", "Export as Word" for all document types
- **Server-side PDF form export**: `GET /api/document/{doc_id}/export-pdf` — fills AcroForm fields + stamps signatures (PyMuPDF, optional)
- **ZIP export**: `POST /api/documents/export-zip` — bundles selected docs as text files

## Changes

### Update `CLAUDE.md` — Replace the misleading "Key gap" section

**Remove** the current "Key gap: no freeform document → file export" subsection and the incorrect claim "There is NO general-purpose markdown/HTML → PDF conversion."

**Replace with** accurate documentation of the full export pipeline:

1. **Document Export Menu** — the editor's Export button provides four options for all document types:
   - Export Markdown (raw text download)
   - Export HTML (self-contained HTML file)
   - Print as PDF (client-side: markdown→HTML→PDF via html2pdf.js)
   - Export as Word (client-side: markdown→DOCX via docx.js)
   - Filled PDF (server-side, only for AcroForm-imported documents)

2. **Clarify the server-side vs client-side split**:
   - Client-side (html2pdf.js / docx.js): works for ANY document type, runs in browser, rasterizes HTML at 2x scale
   - Server-side (PyMuPDF): only for PDF form documents, fills AcroForm fields + stamps signatures/annotations

3. **Add a note about agent tool gap**: The agent (LLM) cannot directly trigger PDF/DOCX export — these are frontend-only actions. There is no server-side API endpoint for arbitrary markdown→PDF conversion.

## File to modify

- `D:\odyseus\odysseus\CLAUDE.md` — lines 98-147 (the "Document & File Generation" section)

## Verification

- Read the updated CLAUDE.md to confirm accuracy
- Cross-reference with `static/js/document.js` export functions
- Cross-reference with `routes/document_routes.py` export endpoints
