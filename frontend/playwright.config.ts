import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

// Fresh throwaway library for every run, so tests never touch your real data.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "papertrail-e2e-"));
// Only needed where Playwright's own browser download is unavailable (e.g. locked-down sandboxes).
const customChromium = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: "./e2e",
  testIgnore: ["**/ai-speed.spec.ts"], // needs the fake AI server: run it with `npm run e2e:ai`
  timeout: 30_000,
  expect: { timeout: 8_000 },
  workers: 1, // the journeys share one library and run in order
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    launchOptions: customChromium ? { executablePath: customChromium, args: JSON.parse(process.env.PW_CHROMIUM_ARGS ?? "[]") } : {},
  },
  webServer: [
    {
      // Run `npm run e2e` from a terminal where the backend virtualenv is activated.
      command: "python -m uvicorn app.main:create_app --factory --port 8000",
      cwd: "../backend",
      url: "http://127.0.0.1:8000/api/v1/health",
      env: { PAPERTRAIL_DATA_DIR: dataDir },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "npm run build && npx vite preview --port 4173 --strictPort",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
