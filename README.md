# PaperTrail AI

Ask questions about your PDFs and check every answer against its source.

> **Status: complete and tested.** Backend, optional AI answers, optional semantic search, frontend, deployment config, browser tests.
> By default the app runs in **retrieval-only keyword mode** (no key needed): it finds and cites matching passages.
> Optional, off by default: **AI-written cited answers** (Gemini or any OpenAI-compatible API) and **semantic (meaning) search**
> via embeddings. Neither has been verified against a live provider: see "Known limitations" and `docs/providers.md`.
> **Not deployed anywhere:** `render.yaml` is schema-checked but I have not run a real Render deployment. See `docs/deployment.md`.
> Architecture and interview talking points: `docs/ARCHITECTURE.md`.

## What works
- Upload PDFs (drag-and-drop or picker) with validation: PDF header check, size limit, SHA-256 duplicate detection, generated storage names
- Per-page text extraction, overlapping chunking that never crosses pages, keyword retrieval (BM25, **not** semantic search)
- Document library: search, filter, sort, paginate, rename, assign to collection, preview extracted text, retry failed, delete (with confirmation)
- Collections: create/edit/delete, scoped questions, per-collection document list and research history
- Chat with stored conversation history, a Stop button, copy, and **clickable citations** that open an evidence panel showing the exact passage and its page
- Explicit "Not enough evidence" answers when nothing in scope matches
- Search page with highlighted matches, labelled keyword search
- Evaluation Lab: deterministic checks on a built-in sample paper, threshold comparison, JSON/CSV export (no API key, no network)
- **Evidence first, answer second:** with an AI provider on, your matching passages appear immediately and the AI answer is written in the background (with a Stop button, a retry button, and recovery if you reload mid-answer)
- **Answer cache and one safe automatic retry:** a repeated question over the same passages is answered instantly with no AI call; temporary AI errors (503 and similar) are retried once, quota errors and timeouts are not
- **Hybrid search** (keyword + embeddings, fused by reciprocal rank fusion) when an embedding provider is configured; passages found by meaning are labelled
- **Editable settings** in the app (retrieval mode, top-k, thresholds, chunk size with a guided reindex, AI on/off), validated and stored locally; keys stay in env vars
- **Follow-up questions** (earlier turns help rank and are shown to the AI, but never count as evidence) and **suggested questions** drawn from your documents' distinctive words
- **Evaluation Lab** (Settings > Advanced; a tuning tool, not needed for everyday use) with your own cases (add/edit/delete), runs against your real library, and keyword-vs-hybrid / threshold comparison
- Optional AI answers (Gemini or any OpenAI-compatible API) with validated `[n]` citations, automatic fallback, a local request limiter, and a connection test in Settings
- Optional shared access token for public deployments (`PAPERTRAIL_ACCESS_TOKEN`) with an unlock screen. Not multi-user auth
- Three themes (Dark Neon Purple, Light Professional, Midnight Aurora), persisted in the browser

## Optional: AI-written answers
1. Read `docs/providers.md` (what is free, limits, privacy, what was and was not verified).
2. Create a Gemini key at https://aistudio.google.com/apikey (Pakistan is on Google's supported-regions list; no billing is required for the free tier).
3. Copy `.env.example` to `backend\.env` and set `PAPERTRAIL_AI_PROVIDER=gemini` and `PAPERTRAIL_GEMINI_API_KEY=...`. Restart the backend.
4. Open Settings and press **Test connection**.

How it stays honest: the model only sees the retrieved passages and must cite them as `[1]`, `[2]`. The server removes citation
numbers that were never supplied and **discards any AI text that cites nothing**. If the provider fails, times out, or hits its quota,
you get the matching passages instead, labelled "no AI wrote this". If nothing relevant is retrieved the provider is not called at all.
AI answers are labelled with the provider, and citations show where wording came from, not that it is correct.

## Optional: semantic search
Keyword search cannot match "price" to "cost". With an embedding provider, **Hybrid** mode also matches by meaning.
1. In `backend\.env`: `PAPERTRAIL_EMBEDDING_PROVIDER=gemini` (reuses the Gemini key above). Restart the backend.
2. Settings > **Test embeddings**, then set Retrieval mode to **Hybrid**.
3. New uploads are embedded automatically; for older documents press **Embed now** in My Documents.
4. The similarity threshold (default 0.62) is an **untuned guess**. Add a few cases under Evaluation Lab > My library cases and use **Compare thresholds** to pick a value.

If the provider fails or its quota runs out, searches fall back to keyword and tell you. Privacy: passages and questions are sent to the provider.

## Run on Windows (PowerShell), two terminals
Requires Python 3.11+ and Node.js 20+.

**Terminal 1: backend**
```powershell
cd papertrail-ai\backend
py -3.13 -m venv .venv            # use the Python version you have installed (3.11+)
.\.venv\Scripts\Activate.ps1      # if blocked: Set-ExecutionPolicy -Scope Process Bypass
pip install -r requirements-dev.txt
uvicorn app.main:create_app --factory --reload
```
**Terminal 2: frontend**
```powershell
cd papertrail-ai\frontend
npm install
npm run dev
```
Open http://localhost:5173. The dev server proxies `/api` to the backend on port 8000.
Try it with `sample_data\sample_paper.pdf`, then ask "What microcontroller does the controller use?".
Data is stored in `backend\data\` (SQLite + uploaded PDFs). API docs: http://127.0.0.1:8000/docs.

## Tests and checks
```powershell
cd backend;  python -m pytest -q;  ruff check .   # AI tests use mocks; no key or network needed
python -m app.evaluation.cli --pdf ..\sample_data\sample_paper.pdf --dataset ..\evaluation\dataset.json
cd ..\frontend;  npm run typecheck;  npm test;  npm run build
# Real-browser tests (Playwright). One-time: npx playwright install chromium. Needs the backend virtualenv ACTIVATED:
cd ..\backend; .\.venv\Scripts\Activate.ps1; cd ..\frontend;  npm run e2e
npm run e2e:ai    # speed/cache/retry/timeout tests against scripts\fake_gemini.py, a local STAND-IN for Gemini (no key needed)
```

## How it works
1. Upload -> validate -> extract text per page -> normalise -> chunk (900 chars, 150 overlap by default).
2. Question -> lowercase, drop stopwords, light plural stemming -> BM25 over chunks in scope (all documents or one collection).
3. A chunk counts as evidence only if it contains >= 50% of the question's distinct terms; otherwise the app abstains.
4. Each citation stores chunk id, document, page and an excerpt that must be an exact substring of the stored chunk; invalid citations are dropped.

## Configuration
Copy `.env.example` to **`backend\.env`** (inside the `backend` folder; the app only reads it from there). It is commented step by step: to turn on Gemini, remove the `#` from the three marked lines and paste your key. Every value is optional. Settings are **read-only in the UI**: edit the file and restart the backend.

## Known limitations
- **Speed numbers are from a stand-in, not Google.** With a fake AI set to 3 s, the passages appeared after about 1.3 s and the AI answer after 4.0 s; a repeat question took 0.7 s. Real Gemini latency is unmeasured here. If your real model is slow, pick a lighter model (`PAPERTRAIL_GEMINI_MODEL`) and lower top-k.
- The answer cache lives in memory (cleared on restart). The retry policy deliberately skips timeouts and unannounced quota errors, so a slow or exhausted provider still shows plain passages plus the reason.
- Keyword search time grows with library size (measured about 29 ms at ~60 pages, 340 ms at ~625, 1.5 s at ~2,500). Fine for personal use; SQLite full-text search would be the next step.
- **Keyword matching only.** No synonyms or paraphrases ("cost" vs "price"), so it can abstain on answerable questions. The 0.5 threshold was tuned on only 7 sample cases and is not evidence of general accuracy.
- No OCR: scanned PDFs fail with a clear message.
- **Semantic search is unproven on real data.** It is tested with a deterministic fake embedder, a mocked HTTP layer and a local stand-in server, never a live provider. The cosine threshold is an untuned default.
- By default (and in the free Render demo) retrieval is keyword-only, which cannot match synonyms and can abstain on answerable questions.
- AI answers have **not been tested against a live provider**: adapters were verified with mocked HTTP and a local stand-in server only. Use Settings > Test connection with your own key. Model names and free quotas change.
- Follow-up questions do not use earlier conversation context. Suggested questions are not implemented.
- The built-in evaluation is 7 cases on one fictional document: a regression guard, not a quality benchmark. Quality on your documents is only as good as the cases you add.
- Follow-ups are heuristic: a short question borrows the previous question only for ranking; a vague follow-up with no matching words will correctly abstain.
- Single-user. Locally there is **no login**; do not expose that mode to the internet. Public deployments must set `PAPERTRAIL_ACCESS_TOKEN` (one shared secret, not per-user accounts).
- **Free hosting forgets your data.** On Render's free tier the disk is ephemeral and the service sleeps when idle; see `docs/deployment.md`.
- Processing happens inside the upload request; very large PDFs will be slow.
- Tables are created with `create_all` (new features only ever add tables, so existing databases keep working). Alembic migrations are not set up; a future change to an existing column would need them.
- Playwright tests use fixed sample data and one browser; they are journeys, not exhaustive coverage.
- Browser tests were run in headless **Chromium on Linux only**. Windows, Firefox, Safari and real phones are untested. I reviewed screenshots of a few screens, not every state.
- Accessibility: an automated axe-core audit (WCAG 2.0/2.1 A and AA rules) passes on every page in all three themes plus the evidence panel and dialogs. Automated tools find only part of the issues; no manual keyboard-only or screen-reader review was done.
