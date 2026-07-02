# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Mavrick** (formerly Odysseus) — a self-hosted AI workspace for chat, agents, research, documents, email, notes, calendar, and local model workflows. Built with FastAPI (Python 3.11+) backend and vanilla JS (ES modules) frontend.

## Common Commands

### Running the app

```bash
# Docker (recommended)
docker compose up -d --build
# Open http://localhost:7000; first admin password in: docker compose logs mavrick

# Manual (native)
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app:app --host 127.0.0.1 --port 7000
```

### Testing

```bash
python -m pytest                          # full suite
python -m pytest tests/test_foo.py        # single file
python -m pytest -k "test_name"           # single test by name

# Focused runs via taxonomy markers
python tests/run_focus.py --area security
python tests/run_focus.py --area services --sub-area cookbook
python tests/run_focus.py --fast          # exclude slow-marked tests
python tests/run_focus.py --durations 25  # show 25 slowest tests

# Run a single test file with specific test
python -m pytest tests/test_agent_loop.py::test_tool_block_parsing -v
```

### Syntax checking

```bash
python -m compileall -q app.py core routes src services scripts tests
python -m py_compile <changed-files>      # verify changed files compile
node --check static/js/<file>.js          # JS syntax check
```

### Docker

```bash
docker compose config                     # validate compose config
docker compose up -d --build
docker compose logs --tail=120 mavrick
```

## Architecture

### Directory layout

| Directory | Purpose |
|-----------|---------|
| `app.py` | FastAPI orchestrator — middleware stack, route mounting, lifespan, static serving. Entry point for `uvicorn app:app`. |
| `src/` | Core business logic: agent loop, LLM calls, tool execution, embeddings, RAG, settings, task scheduler, document processing |
| `routes/` | HTTP route handlers, organized by feature (chat, email, calendar, cookbook, documents, etc.) |
| `core/` | Database models, auth, middleware, constants. `core/constants.py` is a backward-compat shim that re-exports `src/constants.py`. |
| `services/` | Background services: search, memory, TTS/STT, research, shell, hwfit, YouTube |
| `mcp_servers/` | MCP protocol servers (email, image gen, memory, RAG) |
| `static/` | Frontend: `index.html`, `login.html`, `style.css`, `app.js`, and `js/` modules |
| `static/js/` | Frontend JS modules organized by feature (chat.js, emailLibrary.js, calendar.js, etc.) |
| `scripts/` | CLI tools (mavrick-mail, mavrick-calendar, etc.) and data migration scripts |
| `tests/` | Test suite with taxonomy-based markers (see below) |
| `desktop/` | Electron desktop app wrapper |
| `integrations/` | Third-party integration adapters (claude, codex) |

### Key architectural patterns

**Single source of truth for constants**: `src/constants.py` defines ALL paths, env vars, and configuration values. `core/constants.py` re-exports them for backward compatibility. Never hardcode paths or use `Path(__file__)` to derive data locations — import from `src.constants` instead.

**Data directory**: All persistent data lives under `DATA_DIR` (controlled by `MAVRICK_DATA_DIR` env var). Use the named constants (e.g., `SESSIONS_FILE`, `AUTH_FILE`, `MEMORY_FILE`) rather than constructing paths manually.

**Internal API loopback**: Agent tools call back into the running server via HTTP. Use `internal_api_base()` from `src.constants` — never hardcode `http://localhost:7000`. The loopback is authenticated via `INTERNAL_TOOL_TOKEN` in `core.middleware`.

**Agent tool execution flow**: LLM responses contain fenced code blocks with tool names as language tags. `src/agent_tools/` parses and executes them; `src/agent_loop.py` runs the multi-round streaming loop. Tool schemas are in `src/tool_schemas.py`, execution logic in `src/tool_execution.py`.

**LLM integration**: `src/llm_core.py` handles all LLM API calls (streaming and non-streaming) with retry logic, caching, and stall detection. Supports Ollama, vLLM, OpenAI, and any OpenAI-compatible endpoint.

**Frontend**: Vanilla JS with ES modules — no build step. `static/index.html` is the SPA; `static/js/` contains feature modules. CSS uses custom properties (`--red`, `--fg`, `--bg`, `--card`, `--border`). Monospaced font (Fira Code) is the default. Dark theme is default; light mode goes through the existing theme system.

### Middleware stack (app.py)

Applied in order: GZip → SecurityHeaders → RequestTimeout → InteractiveActivity → AuthMiddleware (when auth enabled). Streaming endpoints (`/api/chat`, `/api/shell/stream`, etc.) are exempt from the request timeout.

### Database

SQLAlchemy with SQLite (default `data/app.db`). Models in `core/database.py`. The `EncryptedText` type decorator provides transparent Fernet encryption at rest for sensitive columns.

## Document & File Generation

The app has several layers for creating and exporting files, each with different constraints:

### Documents (in-app editor)

Documents are SQLite-backed markdown/HTML/code files created and edited via the `create_document`, `edit_document`, `suggest_edit`, and `update_document` agent tools (`src/agent_tools/document_tools.py`). They live in the editor panel and have versioning (`DocumentVersion` model in `core/database.py`). They are NOT files on disk — they are DB rows.

**Export routes** (`routes/document_routes.py`):
- `POST /api/documents/export-zip` — bundles selected documents as text files in a .zip
- PDF form export is limited to existing AcroForm templates (see below)

### PDF handling (PyMuPDF = optional AGPL dependency)

PDF work is split between optional and core:

**Core** (pypdf, always available):
- PDF text extraction (`src/document_processor.py`)
- PDF import → Document auto-creation (`src/pdf_form_doc.py`, `src/office_doc.py`)

**Optional** (PyMuPDF/fitz, install via `requirements-optional.txt`):
- AcroForm field detection and extraction (`src/pdf_forms.py`) — decides if a PDF is a fillable form
- PDF form filling and export (`routes/document_routes.py`):
  - `GET /api/document/{doc_id}/export-pdf` — fills form fields with markdown values + stamps annotations/signatures
  - `GET /api/document/{doc_id}/render-pdf` — inline preview of the filled form
  - `POST /api/document/{doc_id}/export-pdf/preview` — dry-run showing field→value mapping
  - `GET /api/document/{doc_id}/render-pages` — per-page metadata for the interactive PDF viewer
- Signature stamping on PDF pages (annotations with coordinates in page percentages)

### Document export (any document type)

The editor's Export menu (in-app button + per-tab context menu) provides five client-side export options for **all** document types:

- **Export Markdown** — raw text `.md` download
- **Export as PDF** — vector-quality PDF via jsPDF text APIs (selectable text, not rasterized). Handles headings, bullet/numbered lists, code blocks, horizontal rules. Falls back to html2canvas for non-markdown content.
- **Export as Word** — rich DOCX via `docx.umd.min.js`: headings (H1-H4), bullet/numbered lists (with nesting), fenced code blocks (monospace + gray background), tables (with header row styling), bold/italic/strikethrough/inline code, links, horizontal rules.
- **Export as PowerPoint** — PPTX via `pptxgenjs`: slides split on H1/H2 headings, with bullet lists, code blocks, and tables rendered as native PPTX objects.
- **Export HTML** — self-contained HTML file

These are implemented in `static/js/document.js`. Vendor libraries (`static/lib/`) are loaded on demand: `html2pdf.bundle.min.js`, `docx.umd.min.js`, `pptxgenjs.bundle.min.js`.

**Server-side vs client-side split**: The server-side PDF export (`/api/document/{doc_id}/export-pdf`) only works for AcroForm-imported documents. All general-purpose file generation (PDF, DOCX, PPTX) is entirely client-side — the agent cannot trigger it programmatically.

### Office document import (markitdown, optional)

`src/markitdown_runtime.py` converts .docx/.pptx/.xlsx/.epub → markdown via Microsoft's markitdown library. Falls back to a built-in pure-Python .docx extractor when markitdown is not installed. These create Document rows — they don't produce downloadable Office files.

### Deep research reports (HTML)

`src/visual_report.py` generates self-contained styled HTML pages from deep research results. Uses `markdown` + `nh3` sanitization. These are served via API routes and viewed in-browser — no PDF export.

### Image generation & editing

`mcp_servers/image_gen_server.py` provides the MCP image generation server. The agent tool `edit_image` (in `src/tool_schemas.py`) handles upscale/inpaint/rembg/harmonize via the gallery system. Generated images go to `GENERATED_IMAGES_DIR` and are accessible via `routes/gallery_routes.py`.

## Code Conventions

- **Conventional Commits**: `fix(scope): summary`, `feat(scope): summary`, etc.
- **No Unicode emoji in UI or code** — use inline SVG or plain text.
- **Reuse CSS variables and component classes** — don't introduce new visual primitives.
- **Windows support**: App runs on Windows but Docker/Linux is the primary target. `app.py` forces `ProactorEventLoop` for Windows asyncio compatibility.
- **Owner-scoped data**: Most data models have an `owner` column. Use `request.state.current_user` and filter by owner in queries.
- **Reserved usernames**: `internal-tool`, `api`, `demo`, `system` — these are synthetic sentinels and must never be real accounts.

## Test Taxonomy

Tests are auto-tagged at collection time by `tests/conftest.py` using `tests/_taxonomy.py`:

- **Area markers** (`area_security`, `area_routes`, `area_services`, `area_cli`, `area_js`, `area_helpers`, `area_unit`, `area_uncategorized`)
- **Sub-area markers** (`sub_<filename-token>`) for finer grouping
- **Fast lane**: `not slow` marker for quick feedback; only mark tests `slow` with duration evidence

See `tests/README.md` for the full test infrastructure documentation including helper conventions (`tests/helpers/`).

## Branch Model

- `dev` — default branch, all PRs land here
- `main` — curated stable releases, fast-forwarded from dev

PRs should target `dev`, not `main`.
