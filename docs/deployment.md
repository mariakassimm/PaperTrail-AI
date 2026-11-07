# Deploying PaperTrail AI for free (Render)

**Read this first.** Free hosting is fine for a *demo you can link to in an interview*. It is **not** a place to keep your
real documents: the free web service forgets everything when it restarts. For real use, run the app on your own computer
(see the README), where your library persists.

Checked 26 Oct 2026. Free tiers change; re-check Render's pages before relying on this.

## What I verified, and what I did not
| Fact | Status | Source |
|---|---|---|
| Free web services spin down after ~15 minutes without traffic | Confirmed | Render FAQ (render.com/docs/faq) |
| The filesystem is **ephemeral**: files and SQLite written at runtime are lost on restart/redeploy | Confirmed | Render FAQ |
| `PYTHON_VERSION` must be a fully qualified version (e.g. `3.12.3`); Render's default has moved to 3.14, so we pin 3.12.3, the version this project was tested on | Confirmed | render.com/docs/python-version |
| Blueprint (`render.yaml`) field names | Read from Render's published JSON schema; a test checks `render.yaml` only uses those fields | render.com/schema/render.yaml.json |
| Free instance is about 512 MB RAM, ~750 free hours/month, no persistent disk, "not for production"; static sites are free | **Third-party summaries** of Render's free-plan page, not read from the page itself | blog posts |
| Whether Render asks for a payment card at sign-up | **Not verified.** Check at sign-up; stop if it asks for something you don't want to provide | n/a |
| Cold start length after sleeping | Third-party reports say up to about a minute; not measured | n/a |
| **A real deployment to Render** | **Not done.** I have no Render account. `render.yaml` is schema-checked, not deployed | n/a |

If Render's terms change or it becomes unsuitable, nothing here is required: the app runs fully locally.

## Why Render
One free account hosts both parts (a Python web service and a static site) from one `render.yaml`, with no Docker.
Other free hosts exist (I did not research them), so treat this as one workable choice, not the only one.

## What persistence you actually get
| Item | On Render free | What the app does about it |
|---|---|---|
| Uploaded PDFs, SQLite database, conversations | **Lost** on every restart, redeploy, and after sleeping | `PAPERTRAIL_SEED_SAMPLE=true` re-loads the fictional sample paper into an empty library, so the demo always has something to ask about |
| Embeddings (meaning index) | **Lost** with the database; re-created only if embeddings are enabled and documents are uploaded again | Leave `PAPERTRAIL_EMBEDDING_PROVIDER=none` on the free demo unless you accept the quota use |
| Settings saved in the app, evaluation cases | **Lost** with the database | Set defaults through environment variables instead |
| Your theme | Kept (stored in your browser) | n/a |

Practical alternatives: (1) keep using it locally for real documents; (2) a paid persistent disk or database on a host of
your choice (not free, not set up here). Do not describe the deployed demo as storing user data durably.

## Security before you put it on the internet
The app has **no user accounts**. For a public deployment it uses one shared secret instead:
`PAPERTRAIL_ACCESS_TOKEN`. Every API call except `/api/v1/health` must send it, and the UI shows an unlock screen.
- The blueprint **generates** a random token for you (`generateValue: true`); read it in the service's *Environment* tab.
- This is a single shared password, **not** multi-user authentication: everyone with the token shares one workspace.
- Wrong guesses are throttled (20 per minute), but use the generated long value, never a short one (minimum 16 characters).
- The token is kept in `sessionStorage` (forgotten when the tab closes) and never logged or returned by the API.
- API docs (`/docs`) are disabled in production by `PAPERTRAIL_ENABLE_DOCS=false`.
- If you enable an AI provider, uploaded text goes to that provider. See `docs/providers.md`.

## Deploy, step by step
1. Put the project in a GitHub repository (the `.gitignore` already excludes `.env`, `node_modules`, data and builds).
   Check that no real key is committed: `git grep -nE "AIza|sk-"` should only show the fake test constant.
2. In Render: **New > Blueprint**, choose the repository. It creates `papertrail-api` and `papertrail-web` from `render.yaml`.
   Fill the prompted values: leave `PAPERTRAIL_GEMINI_API_KEY` empty for retrieval-only; the other two come in steps 4-5.
3. Wait for both services to build. Note their URLs, e.g. `https://papertrail-api.onrender.com` and
   `https://papertrail-web.onrender.com` (yours may carry a suffix if the names are taken).
4. On **papertrail-web** > Environment, set `VITE_API_BASE` to `https://<your-api-host>/api/v1` and **redeploy it**.
   (Vite bakes this value in at build time, so changing it requires a rebuild.)
5. On **papertrail-api** > Environment, set `PAPERTRAIL_CORS_ORIGINS` to `["https://<your-web-host>"]` (JSON list, exact origin,
   no trailing slash). Save; the service restarts.
6. Copy `PAPERTRAIL_ACCESS_TOKEN` from the API's Environment tab, open the web URL, and paste it into the unlock screen.

### Turning on AI answers (optional)
On the API service set `PAPERTRAIL_AI_PROVIDER=gemini` and `PAPERTRAIL_GEMINI_API_KEY=<your key>` (and
`PAPERTRAIL_GEMINI_MODEL` if Google renamed models), then use Settings > **Test connection**. Free-tier quotas apply.

## Test the deployed app
```powershell
$api = "https://<your-api-host>"
curl.exe "$api/api/v1/health"                       # 200, {"status":"ok", ..., "auth_required":true}
curl.exe -i "$api/api/v1/stats"                     # 401: proves the token gate works
curl.exe -H "Authorization: Bearer <token>" "$api/api/v1/stats"   # 200
```
In the browser: unlock, confirm the sample paper is listed, ask "What microcontroller does the controller use?", open the
citation, upload another PDF, and run the Evaluation Lab. The first request after idle time can be slow (cold start).

## Troubleshooting
| Symptom | Likely cause and fix |
|---|---|
| UI says "Cannot reach the PaperTrail backend" | `VITE_API_BASE` missing/wrong, or the API is asleep/crashed. Check the API's logs, then rebuild the web service after fixing the variable |
| Browser console shows a CORS error | `PAPERTRAIL_CORS_ORIGINS` is not exactly your web origin (scheme + host, no path, no trailing slash) or is not valid JSON |
| Unlock screen rejects the token | Copy the value again from the API's Environment tab; if you regenerated it, old tabs must unlock again |
| Everything is empty after a while | Expected: ephemeral disk (see above). The sample paper returns on restart if `PAPERTRAIL_SEED_SAMPLE=true` |
| Build fails on Python packages | Confirm `PYTHON_VERSION` is `3.12.3` (fully qualified) in the service's Environment |
| First page load takes about a minute | Free service was asleep and is starting |
| "AI not configured" pill | `PAPERTRAIL_AI_PROVIDER` is set but the key/model is missing; see Settings for the exact message |

## Run the production build locally (no hosting needed)
```powershell
cd papertrail-ai\backend; .\.venv\Scripts\Activate.ps1
$env:PAPERTRAIL_ACCESS_TOKEN = "a-long-random-secret-at-least-16-chars"
uvicorn app.main:create_app --factory --port 8000
# second terminal
cd papertrail-ai\frontend; npm run build; npx vite preview --port 4173
```
Open http://localhost:4173 and enter the token. (`vite preview` forwards `/api` to port 8000 using the same proxy setting.)

## Production vs development settings
| Setting | Development (default) | Production (`render.yaml`) |
|---|---|---|
| `PAPERTRAIL_ACCESS_TOKEN` | unset (open, local only) | generated, required |
| `PAPERTRAIL_ENABLE_DOCS` | true | false |
| `PAPERTRAIL_SEED_SAMPLE` | false | true |
| `PAPERTRAIL_CORS_ORIGINS` | `http://localhost:5173` | your web URL |
| `PAPERTRAIL_EMBEDDING_PROVIDER` | none | none (opt in deliberately) |
| API address in the UI | dev proxy (`/api/v1`) | `VITE_API_BASE` |
