import time, httpx
from app.core.config import Settings

s = Settings()
key = s.gemini_api_key.get_secret_value()
CANDIDATES = ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-3.1-flash-lite",
              "gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.8-flash"]
for model in CANDIDATES:
    start = time.time()
    try:
        r = httpx.post(f"{s.gemini_base_url}/models/{model}:generateContent",
                       headers={"x-goog-api-key": key}, timeout=40,
                       json={"contents": [{"parts": [{"text": "Reply with the single word OK."}]}]})
        note = "works" if r.status_code == 200 else r.text[:120].replace("\n", " ")
        print(f"{model:28} HTTP {r.status_code} in {time.time() - start:5.1f}s  {note}")
    except httpx.TimeoutException:
        print(f"{model:28} TIMEOUT after 40s")
    except httpx.HTTPError as e:
        print(f"{model:28} network error: {type(e).__name__}")