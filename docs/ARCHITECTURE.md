# Architecture and interview notes

## The 60-second explanation
PaperTrail AI answers questions about your PDFs **with evidence you can check**. A React UI talks to a FastAPI backend. PDFs are
split into page-aware chunks stored in SQLite. A question is matched to chunks by keyword (BM25), optionally fused with
embedding similarity. Every answer is a set of citations that point at real stored passages; an optional LLM writes prose
from those passages, but its output is **validated server-side** and discarded if it does not cite what it was given. Without
a key it still works, in an honest retrieval-only mode.

```
React + Vite (browser)                    FastAPI (one process, SQLite file)
 pages -> services/api.ts  ── HTTPS ──>   routes -> services -> rag/ (extract, chunk, retrieve, cite, answer)
 evidence panel, settings, eval lab                 \-> providers/ (Gemini or OpenAI-compatible: generation + embeddings)
                                          SQLite: documents, chunks, chunk_embeddings, conversations, collections,
                                                  app_settings, eval_cases        uploads/: original PDFs (UUID names)
```

## Request flows
- **Upload:** validate (PDF header, size, SHA-256 duplicate check) -> PyMuPDF per-page text -> normalise -> chunk (900 chars,
  150 overlap, never across pages) -> store -> *optionally* embed in batches (failure leaves the doc keyword-searchable).
- **Ask (step 1, always fast):** retrieve (BM25 [+ cosine, fused by RRF]) -> build citations -> verify each against the stored chunk ->
  nothing found? abstain **without calling the model** -> otherwise return the passages immediately, flagged `ai_pending`.
- **Write the answer (step 2, `POST /messages/{id}/generate`):** reuse the *stored* passages (never re-retrieve) -> look up the answer
  cache -> else call the LLM with a hardened prompt -> parse `[n]` markers, drop unknown numbers, renumber, **discard uncited text**
  -> on any provider failure fall back to the plain passages and say why. Safe to call twice; a repeat returns the stored answer.

## Decisions worth defending
| Decision | Why | Trade-off |
|---|---|---|
| Keyword retrieval is the default | Works offline, free, explainable, deterministic to test | Misses synonyms; hence the optional hybrid mode |
| Evidence test = coverage threshold, not a score cut-off | BM25 scores are not comparable across queries; "fraction of your words present" is | Needs tuning; the Evaluation Lab exists to measure it |
| Context from earlier turns never counts as evidence | Otherwise "and the volcano?" after a pump question would "find" pump passages | Short follow-ups only help rank passages that already match |
| Citations are checked, not trusted | Excerpts must be exact substrings of stored chunks; LLM `[n]` markers are validated | Proves *where text came from*, not that a sentence is *correct* |
| LLM failures degrade, never error or fake | A quota error must not look like an answer; fallback is labelled "no AI wrote this" | Users see plainer output when the free quota is gone |
| Retrieved text is untrusted input | Delimited, tag-defanged, system rules say never to follow it | Reduces, does not eliminate, prompt-injection risk |
| SQLite + NumPy, no vector DB | 4 GB laptop, zero setup; ~3 MB per 1,000 chunks | Brute-force cosine is fine to ~tens of thousands of chunks, not millions |
| Shared access token instead of accounts | A public demo must not be open; real multi-user auth is out of scope | One shared secret, one workspace |
| Evidence first, answer second | The AI call is the slow part; users can read verified passages while it runs, and a failed AI step loses nothing | Two requests instead of one; the stored message is updated in place |
| Cache key = hash of the exact prompt + model | Changed documents change the passages, so stale answers can never be served; identical repeats are free | In memory only; cleared on restart |
| Retry only transient failures | 502/503/504 and short `Retry-After` are cheap to retry; quota errors and timeouts would waste quota or double the wait | One retry max; a long outage still falls back to passages |
| Secrets only in env vars | The browser can never read or change keys (settings API rejects them) | Provider changes need an edit + restart |

## Performance notes (measured, with caveats)
- Keyword search: ~29 ms at ~60 pages, ~340 ms at ~625, ~1.5 s at ~2,500 (linear; the corpus is re-tokenised per query). Not the bottleneck at personal scale.
- AI latency dominates. Against a stand-in AI set to 3 s: passages in ~1.3 s, AI answer in ~4.0 s, repeat question ~0.7 s. Real Gemini latency was never measured.
- Next steps if needed: SQLite FTS5 for keyword search, streaming responses, background upload processing.

## Testing strategy (what to say, honestly)
- Unit/API tests (backend), component tests (frontend), real-browser journeys (Playwright) and an automated accessibility
  audit (axe-core) over every page, theme and overlay.
- External services are **mocked at the HTTP layer** and also exercised against local stand-in servers; nothing was verified
  against live Google/OpenRouter.
- Tests were **mutation-checked**: key safeguards were deliberately broken to prove a test fails. Doing this exposed real gaps
  (an unchecked citation validator, ambiguous follow-up evidence, suggested questions that would abstain).
- The built-in evaluation is 7 cases on a fictional paper: a regression guard, **not** a quality benchmark.

## Known weak points (say them before an interviewer does)
Untuned cosine threshold; no live-provider verification; keyword stemming is a 1-rule plural stripper; no OCR; PDF text-order
quirks (columns, tables) are not handled; synchronous processing inside the upload request; single-process rate limiter; no
per-user data isolation; free hosting loses data on restart.
