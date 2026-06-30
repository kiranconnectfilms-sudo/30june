# Docket — AI edits your file, same format back

Upload a Word, Excel, PowerPoint, PDF, or text file. A hosted AI model polishes
the content — wording, grammar, structure, formatting — and you download it
back in the **same file format** you uploaded. The model is called through
[Groq](https://groq.com)'s free OpenAI-compatible API, so there's nothing to
install locally and the app runs anywhere Node runs (including free cloud
tiers like Render). Files are processed in memory and discarded after a
single download.

**Access is gated by the operator.** This isn't a public service — users
request access by email, the operator (you) approves them from `/admin`, and
the user gets a single-use, one-hour code that authorizes exactly one
edit. See "Access flow" below.

## What this does (and doesn't) do

- **Does:** real parsing and real file generation for `.docx`, `.xlsx`/`.csv`,
  `.pptx`, `.pdf`, and `.txt`, with a hosted AI model doing the editing in
  between — Groq's free tier is the default, but the client is
  OpenAI-compatible so you can swap to OpenRouter, Together, OpenAI itself,
  or any compatible provider by changing two env vars.
- **Does not:** convert between formats (Excel in → Excel out, not PowerPoint).
  That's by design — see the brief this was built against.
- **Does not** read legacy binary `.doc` / `.xls` / `.ppt` (pre-2007 Office
  formats). Those need to be re-saved as `.docx` / `.xlsx` / `.pptx` first —
  the app tells the user this clearly if they try.

## What's been verified

Tested directly in development against earlier (Ollama and Anthropic-API)
revisions of the AI client. The current Groq-based client preserves the
same `{system, user, maxTokens, temperature}` → text interface that the
rest of the app calls into, and was syntax-checked but not re-exercised end
to end against the live Groq API in this session.

- **Round-trip build → parse** for DOCX, XLSX, PPTX, PDF, TXT, CSV — each
  format was built from sample content and parsed back, confirming the
  generated files are valid and content survives the round trip.
- **Generated file validity** — DOCX confirmed as a well-formed OOXML zip;
  PDF confirmed readable by `pdftotext`/`pdfinfo` (Poppler), an independent
  PDF engine, not just our own parser.
- **Full Express upload route** (`/api/edit`) exercised with real multipart
  uploads for every format — each correctly parses and fails clearly at the
  AI-call step when the AI provider isn't reachable, proving the parse
  stage works end-to-end through the actual HTTP route, not just in
  isolation.
- **Error paths**: missing file, unsupported extension, legacy `.doc`/`.xls`/
  `.ppt` rejection, expired/unknown download job, AI provider unreachable,
  invalid API key, model-not-found, rate-limit (429), and a
  malformed/empty model response — all return clean JSON errors instead of
  crashing.
- **`askLocalModelForJson`** confirmed to correctly strip markdown code
  fences, and falls back to extracting the first `{...}`/`[...]` block if the
  model adds stray commentary around the JSON. Groq also supports
  `response_format: { type: "json_object" }` which we now pass to nudge the
  model toward strict JSON output up front.
- **Access-control flow** exercised against the live HTTP server:
  - `/admin` rejects no credentials (401) and wrong credentials (401), accepts
    correct credentials (200).
  - `/api/request-access` accepts valid email, rejects invalid/missing email.
  - Admin approve generates a properly-formatted `XXXX-XXXX-XXXX` code and
    persists it to the database with a 1-hour expiry (`CODE_TTL_MS` confirmed
    `=== 3600000`).
  - `/api/redeem` accepts a valid code once and **rejects the same code on
    second use** — single-use guarantee holds across the atomic
    `UPDATE … WHERE used_at IS NULL` consume step.
  - `/api/edit` rejects requests with no code, an unknown code, or an
    already-consumed code, all with 401 + a clear message.
  - `validateCode` handles empty/null input without throwing.

Two real bugs were found and fixed during this testing:
- The original PPTX parser looked for `<p:ph type="title">` placeholder
  shapes, which `pptxgenjs`-generated slides don't have — titles were
  silently misread as body bullets. Fixed by switching to a shape-order
  heuristic (first text-bearing shape = title).
- The original PDF parser (`pdf-parse`) bundles a years-old pdf.js that
  cannot read modern compressed cross-reference streams — including PDFs
  produced by this app's own `pdf-lib`-based builder. Replaced with the
  actively-maintained `pdfjs-dist` package.
- The original access-code redemption consumed the code at the very start of
  `/api/edit`, which meant a user could burn their single-use code by
  uploading the wrong file type or a too-large file (both rejected before
  any AI work happens). Split into `validateCode` (up-front check) and
  `consumeCode` (atomic, called only after parsing succeeds), so the code is
  only spent when the AI actually runs.

**Not yet tested**: actual AI output quality end to end on real documents —
only the request/response plumbing and error handling were verified, not
whether the edits are well-judged for any given real document. Output
quality also depends on which Groq model is selected; `llama-3.1-8b-instant`
(the default) is fast and free but less reliable at strict structured-JSON
output than larger models. If edits come back malformed often, try
`llama-3.3-70b-versatile` (also free, slower) by changing `GROQ_MODEL`.

The access-flow verification above was done with an in-memory SQLite shim
because the testing sandbox can't compile the native `better-sqlite3` module
or fetch its prebuilt binaries. On a normal developer machine the prebuilt
binary downloads cleanly and the same code runs against real on-disk SQLite —
the SQL itself is plain ANSI, no shim-specific dialect. The denial flow
(`/admin/requests/:id/deny`) is symmetric to approve and shares the same
atomic-update pattern, but was not exercised end-to-end against the live
server in this session.

## Setup

### Local development

```bash
# 1. Get a free Groq API key: https://console.groq.com/keys

# 2. Install and configure
npm install
cp .env.example .env
# Edit .env and fill in:
#   - GROQ_API_KEY           (the key from step 1)
#   - ADMIN_USER / ADMIN_PASS (your login for the /admin review page)
#   - SMTP_USER / SMTP_PASS   (Gmail + an app password — see .env.example)
#   - APP_URL                 (http://localhost:3000 for local)

# 3. Run
npm start
```

Then open **http://localhost:3000**.

### Deploying on Render (or similar)

1. Push the code to GitHub.
2. Create a new Web Service on Render pointing at the repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Under **Environment**, add each of these as separate variables (not in
   a `.env` file — Render manages them in the dashboard):
   - `GROQ_API_KEY` — the key from console.groq.com
   - `GROQ_MODEL` (optional) — defaults to `llama-3.1-8b-instant`
   - `ADMIN_USER`, `ADMIN_PASS` — for the `/admin` page
   - `SMTP_USER`, `SMTP_PASS`, `ADMIN_EMAIL` — for sending codes
   - `APP_URL` — your Render URL, e.g. `https://docedits.onrender.com`
5. Deploy. The startup log should end with `AI features ready — using model "..." via https://api.groq.com/openai/v1`.

### Swapping AI providers

The client speaks the OpenAI chat-completions format, so any compatible
provider works without code changes — just override two env vars:

| Provider     | `GROQ_BASE_URL`                          | `GROQ_API_KEY`           |
|--------------|------------------------------------------|--------------------------|
| Groq         | `https://api.groq.com/openai/v1`         | from console.groq.com    |
| OpenRouter   | `https://openrouter.ai/api/v1`           | from openrouter.ai/keys  |
| Together AI  | `https://api.together.xyz/v1`            | from api.together.ai     |
| OpenAI       | `https://api.openai.com/v1`              | from platform.openai.com |

(The env var keeps the `GROQ_` prefix even when you switch — renaming would
just churn the code for no benefit.)

### When AI or SMTP isn't configured yet

If `GROQ_API_KEY` isn't set or is invalid, the app still starts and the UI
loads, but upload is disabled with a clear on-screen message — it won't
pretend to work and then fail silently. Same goes for missing admin
credentials: the `/admin` page still serves a clear "set ADMIN_USER and
ADMIN_PASS in .env" message rather than crashing.

If SMTP isn't configured, the app still runs in a degraded mode: emails are
logged to the server console (with the access code) instead of sent, so you
can still hand-deliver the code while testing.

## Access flow

This app isn't open to the public. Every edit needs a one-time access code.

1. **User visits `/`** and sees the gate screen. They can either submit their
   email to request access, or paste a code they've already been given.
2. **Server stores the request** in a small local SQLite database and emails
   the operator (you) at `ADMIN_EMAIL` saying someone wants in.
3. **Operator logs into `/admin`** (HTTP Basic Auth, credentials from `.env`),
   sees the pending request, and clicks **Approve** or **Deny**.
4. **Approve** generates a random `XXXX-XXXX-XXXX` code, stores it with a
   1-hour expiry, and emails it to the user. **Deny** marks the request
   denied and (politely) emails the user.
5. **User pastes the code** on the gate screen and is moved to the upload
   flow. The code is *not* consumed yet — it's just held in memory.
6. **User uploads a file.** The server validates the code first, parses the
   file, and only then atomically marks the code used (so a malformed file
   doesn't burn the code). The AI edit runs once and the result is delivered.
7. **Editing another file requires a new code** — codes are strictly
   single-use. The "edit another" button on the success screen returns the
   user to the gate.

Codes expire 1 hour after issuance whether used or not. Denied requests have
their codes invalidated immediately.

## How a request flows

1. **Upload** — drag-and-drop or browse, multipart upload straight into memory
   (`multer` memory storage — nothing touches disk).
2. **Parse** — format-specific parser extracts a plain-JSON content model:
   - DOCX → `mammoth` → heading/paragraph/list/table blocks
   - XLSX/CSV → `exceljs` / hand-rolled CSV parser → sheet rows
   - PPTX → raw OOXML read via `jszip` (slide title/bullets/notes — no
     general PPTX parser exists on npm, so this reads `slideN.xml` directly)
   - PDF → `pdf-parse` → paragraph/heading blocks (heuristic heading
     detection, since PDF has no semantic structure)
   - TXT → split on blank lines
3. **AI edit** — the content model (not the raw file) is sent to the AI
   provider (Groq by default) with a format-specific system prompt
   instructing it to preserve every fact/number and only improve clarity,
   grammar, and structure, returning the *same JSON shape* back. An optional
   custom instruction is layered on top.
4. **Build** — the edited JSON model is turned back into a real file:
   - DOCX via `docx` (proper styles, numbering, table widths)
   - XLSX via `exceljs` (header styling, autosize, freeze pane, autofilter)
   - PPTX via `pptxgenjs` (clean slide layout, speaker notes)
   - PDF via `pdf-lib` with hand-rolled word-wrap/pagination (pdf-lib has no
     text-flow layer built in)
   - TXT via plain string joins
5. **Download** — a one-time job id is handed to the browser; the actual
   bytes are streamed on `/api/download/:jobId` and the job is deleted from
   memory immediately after.

## Project layout

```
server/
  index.js               Express app entry point + AI provider health check
  routes/edit.js         /api/edit and /api/download/:jobId (gated by access code)
  routes/access.js       /api/request-access and /api/redeem
  routes/admin.js        /admin HTML page + admin JSON API (basic auth)
  lib/groq.js            AI provider client (OpenAI-compatible chat completions)
  lib/aiEdit.js          format-specific system prompts + AI calls
  lib/access.js          access-request lifecycle: create/list/approve/deny/redeem
  lib/db.js              SQLite database (access_requests, access_codes)
  lib/mailer.js          Gmail SMTP via nodemailer (with console fallback)
  lib/fileTypes.js       extension → format metadata / routing
  lib/parsers/*.js       file → structured JSON
  lib/builders/*.js      structured JSON → file
public/
  index.html             gate / upload / processing / done / error screens
  styles.css             design system (black & white)
  app.js                 gate + drag-drop + state machine
data/
  docket.db              SQLite file, created on first run (gitignored)
```

## Known limitations worth knowing about

- **Large files**: content over ~60,000 JSON characters is rejected with a
  clear error rather than silently truncated or sent in costly/unreliable
  chunks. Very large spreadsheets or long documents may hit this.
- **PDF round-trip is lossy in one direction**: PDF has no real document
  structure, so headings are detected heuristically (short, title-cased,
  unpunctuated lines). Complex multi-column or heavily designed PDFs will
  lose their original visual layout — the *rebuilt* PDF is a clean, readable
  single-column document, not a pixel copy of the original.
- **PPTX parsing reads text only**: titles, body bullets, and speaker notes
  round-trip; original images, charts, and custom slide layouts/themes do
  not carry over — the rebuilt deck uses a clean default layout per slide.
- **No persistence**: closing the server clears all in-flight jobs. This is
  intentional given "no login" — there's no user to own long-term storage.
- **Single model call per file**: no chunking/map-reduce for very long
  documents (see size limit above) — kept deliberately simple per the agreed
  scope.
- **Free-tier rate limits**: Groq's free tier has per-minute and per-day
  caps. A 429 response surfaces as a clear "rate limit hit — wait a moment"
  error rather than an opaque failure. For heavier use, switch to a larger
  Groq model, a paid tier, or a different OpenAI-compatible provider (see
  the "Swapping AI providers" table in Setup).
- **Smaller models are less JSON-strict**: `llama-3.1-8b-instant` is fast
  and free but occasionally returns JSON with stray prose around it; the
  client tolerates this (`response_format=json_object` + a defensive
  fence-and-block extractor). If edits come back malformed often, try
  `llama-3.3-70b-versatile`.
