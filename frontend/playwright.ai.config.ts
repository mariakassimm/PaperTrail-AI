import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import base from "./playwright.config";

// Same app, but the backend is pointed at a local STAND-IN for Gemini (scripts/fake_gemini.py) with a short
// timeout, so speed, caching, retry and timeout behaviour can be measured without a key or network.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "papertrail-e2e-ai-"));

export default {
  ...base,
  testMatch: ["**/ai-speed.spec.ts"],
  testIgnore: [],
  timeout: 60_000,
  webServer: [
    { command: "python ../scripts/fake_gemini.py 9933", url: "http://127.0.0.1:9933/__calls", reuseExistingServer: false, timeout: 30_000 },
    {
      command: "python -m uvicorn app.main:create_app --factory --port 8000",
      cwd: "../backend",
      url: "http://127.0.0.1:8000/api/v1/health",
      env: {
        PAPERTRAIL_DATA_DIR: dataDir,
        PAPERTRAIL_AI_PROVIDER: "gemini",
        PAPERTRAIL_GEMINI_API_KEY: "TESTKEY-123",
        PAPERTRAIL_GEMINI_BASE_URL: "http://127.0.0.1:9933/v1beta",
        PAPERTRAIL_AI_TIMEOUT_SECONDS: "6",
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    { command: "npm run build && npx vite preview --port 4173 --strictPort", url: "http://127.0.0.1:4173", reuseExistingServer: false, timeout: 120_000 },
  ],
};
