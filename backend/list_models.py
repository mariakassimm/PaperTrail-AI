import httpx
from app.core.config import Settings

s = Settings()
key = s.gemini_api_key.get_secret_value()
r = httpx.get(f"{s.gemini_base_url}/models", params={"pageSize": 1000},
              headers={"x-goog-api-key": key}, timeout=30)
print("HTTP", r.status_code)
if r.status_code != 200:
    print(r.text[:300])
    raise SystemExit
for m in r.json().get("models", []):
    if "generateContent" in m.get("supportedGenerationMethods", []):
        print(f"{m['name'].removeprefix('models/'):45} thinking={m.get('thinking')}")