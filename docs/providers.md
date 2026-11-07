# AI providers: what was verified, and what was not

Checked on **26 Oct 2026**. Free tiers change without notice; re-check before relying on any of this.
The app never switches to a paid service on its own and never requires a key.

## Google Gemini API (primary, recommended)
| Item | Finding | Source |
|---|---|---|
| Registration | Google account + API key from Google AI Studio | ai.google.dev (Get API key) |
| Free tier | Yes. Google's billing page describes two tiers, free and pay-as-you-go; enabling billing is optional | ai.google.dev/gemini-api/docs/billing |
| Card required | Not for the free tier, per Google's docs and rate-limit page ("Free: users in eligible countries") | ai.google.dev/gemini-api/docs/rate-limits |
| Region | The official supported-regions list includes **Pakistan**. Age 18+ and a verified Google account required | ai.google.dev/gemini-api/docs/available-regions |
| Quotas | Per **project**, tied to usage tier; the exact RPM/TPM/RPD for your project are shown **inside Google AI Studio**. Google says limits are not guaranteed. Third-party blogs quote conflicting numbers, so none are repeated here | rate-limits page |
| Models | Names rotate (Google's own docs pages showed different "flash" names on different days). Default is `gemini-3.8-flash`; override with `PAPERTRAIL_GEMINI_MODEL` | text-generation page, updated 2026-10-19 |
| Data handling | Google states paid-tier prompts/responses are not used to improve its products, which implies **free-tier content may be**. Do not send confidential documents on the free tier | billing page |
| Quota exhausted | HTTP 429. The app shows the matching passages instead and says why |  |

API contract used (from Google's "Text generation" page): `POST {base}/models/{model}:generateContent`,
header `x-goog-api-key`, body `system_instruction`, `contents[].parts[].text`, `generationConfig.maxOutputTokens`;
reply at `candidates[0].content.parts[].text`. `temperature`/`top_p`/`top_k` are not sent because Google documents that
Gemini 3.6+ ignores them. Google labels this page "Generate Content API (Legacy)" and promotes a newer Interactions API, so
this adapter may need updating in future.

## OpenAI-compatible adapter (secondary; tested for OpenRouter-style APIs)
Works with any service that implements `POST {base_url}/chat/completions` with `Authorization: Bearer`.
Defaults to OpenRouter's base URL. **You must choose the model** (`PAPERTRAIL_OPENAI_MODEL`), e.g. an ID ending in `:free`.
- OpenRouter documents that `:free` models share account-wide limits: **20 requests/minute and 50/day** until you have bought
  at least $10 of credits (then 1000/day). The per-day figures were confirmed from a third-party summary of OpenRouter's docs
  read on 17 Oct 2026, not from the raw page. Free capacity "can change or be temporarily unavailable".
- 402/429 from the provider are shown as "quota exhausted". Review OpenRouter's data-collection policy for free models yourself.

## Not used
- **Hugging Face Inference Providers**: sources disagree; most say free accounts get about **$0.10 per month** of credit (roughly a
  handful of requests) and some say none, with HTTP 402 once exhausted. Too small to be a dependable primary provider.
  It exposes an OpenAI-compatible router, so the OpenAI-compatible adapter can use it if you buy credits.

## Verified vs unverified in this project
- Verified by automated tests with **mocked HTTP**: request shape, header placement, error mapping, key scrubbing, fallbacks.
- Verified end to end against a **local stand-in server** that mimics the documented Gemini response format.
- **Not verified:** a live call to Google or OpenRouter (no key was available). Use Settings > "Test connection" with your own key.

## Local safeguards
- One automatic retry, only for 502/503/504, dropped connections, or a 429 with a `Retry-After` of 5 s or less. Timeouts and other quota errors are never retried.
- Identical requests (same question, same passages, same model) are answered from an in-memory cache and cost no quota.
- Answers must cite `[n]` passages that were actually sent; unknown numbers are removed and uncited AI text is discarded.
- No provider call when retrieval found nothing. No automatic retries. At most `PAPERTRAIL_AI_REQUESTS_PER_MINUTE` (default 10) calls.
- Keys are read only from environment/`backend/.env`, held as secrets, sent only in request headers, scrubbed from error text, and never returned by the API.

## Embeddings (semantic search), optional
Checked against Google's "Embeddings" docs on the same date. Same key and same free-tier caveats as above.

| Item | Finding |
|---|---|
| Model used | `gemini-embedding-001` (stable, text-only). `gemini-embedding-2` is newer; Google says it does **not** accept task types, so the app omits `taskType` for it |
| Endpoint | `POST {base}/models/{model}:batchEmbedContents`, header `x-goog-api-key`, body `requests[]` each with `model`, `content.parts[].text`, optional `taskType` and `output_dimensionality`; reply `embeddings[].values` |
| Task types | `RETRIEVAL_DOCUMENT` when indexing, `RETRIEVAL_QUERY` for questions |
| Dimensions | Adjustable (Google lists 128 to 3072; 768 is the app default). Google notes only the full 3072 vectors come normalised, so the app **normalises every vector itself** |
| Free-tier quota | Per project, shown in AI Studio, not published as fixed numbers; **not verified**. When it runs out the app falls back to keyword search and says so |
| Privacy | Every passage and every question is sent to the provider. Free-tier content may be used by Google (see above) |

How it is used: a document is embedded in batches of up to 32 passages when uploaded (or via "Embed now"); only passages that
lack a vector for the current model/dimension are embedded, so unchanged documents are never re-embedded. A question costs one
embedding request. Vectors are stored in SQLite (about 3 MB per 1,000 passages at 768 dimensions).

**Hybrid ranking.** Keyword (BM25) and cosine rankings are merged with reciprocal rank fusion. A passage counts as *evidence* if it
passes the keyword coverage test **or** the cosine threshold (`PAPERTRAIL_MIN_COSINE`, default 0.62). **That default is an untuned
guess**: real similarity scores depend on your documents. Use Evaluation Lab > My library cases > Compare thresholds to choose a value.

**Verified vs not:** request shape, batching, normalisation, error mapping, fallbacks, and hybrid ranking are covered by tests with mocked
HTTP and by an end-to-end run against a local stand-in server. A **live call to Google was never made**, and the quality of real Gemini
similarity scores on your documents is **unmeasured**. The tests prove the pipeline finds paraphrases when the vectors place them close;
they cannot prove Google's vectors do.

The generic OpenAI-compatible `/embeddings` adapter (`PAPERTRAIL_EMBEDDING_PROVIDER=openai_compat`) is tested with mocked HTTP only and
not checked against any specific service's free tier.
