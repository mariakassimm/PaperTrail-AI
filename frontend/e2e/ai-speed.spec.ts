import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, request, test, type APIRequestContext, type Page } from "@playwright/test";

// Run with `npm run e2e:ai`. The "AI" is scripts/fake_gemini.py, a local stand-in with a controllable delay.
const SAMPLE = fileURLToPath(new URL("../../sample_data/sample_paper.pdf", import.meta.url));
const SHOTS = process.env.SHOTS_DIR;
const FAKE = "http://127.0.0.1:9933";
test.describe.configure({ mode: "serial" });

let fake: APIRequestContext;
const calls = async () => ((await (await fake.get("/__calls")).json()) as { calls: number }).calls;

test.beforeAll(async () => {
  fake = await request.newContext({ baseURL: FAKE });
  const api = await request.newContext({ baseURL: "http://127.0.0.1:8000" });
  await api.post("/api/v1/documents", { multipart: { file: { name: "sample_paper.pdf", mimeType: "application/pdf", buffer: fs.readFileSync(SAMPLE) } } });
});

async function ask(page: Page, question: string) {
  await page.getByLabel("Your question").fill(question);
  await page.getByRole("button", { name: "Send" }).click();
}
const shot = async (page: Page, name: string) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); } };

test("the passages appear immediately; the AI answer follows when it is ready", async ({ page }) => {
  await fake.get("/__reset");
  await fake.get("/__delay/3");
  await page.goto("/chat");
  await expect(page.getByText("AI: gemini (gemini-3.8-flash)")).toBeVisible();
  const start = Date.now();
  await ask(page, "What microcontroller does the controller use?");
  await expect(page.getByRole("button", { name: /Open source \[1\].*page 2/ })).toBeVisible();
  const evidenceMs = Date.now() - start;
  await expect(page.getByText("Writing a cited answer from these passages…")).toBeVisible();
  await expect(page.getByText("Matching passages · AI answer pending")).toBeVisible();
  await expect(page.getByText("Searching your documents…")).toHaveCount(0);
  await shot(page, "ai-pending");
  await expect(page.getByText(/AI-generated · gemini/)).toBeVisible({ timeout: 20_000 });
  const aiMs = Date.now() - start;
  await shot(page, "ai-done");
  console.log(`evidence after ${evidenceMs} ms, AI answer after ${aiMs} ms (the stand-in AI takes 3000 ms)`);
  expect(evidenceMs).toBeLessThan(2000);
  expect(aiMs - evidenceMs).toBeGreaterThan(2000); // the user was reading evidence during the wait
  await expect(page.getByText("Writing a cited answer from these passages…")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Open source \[1\]/ })).toBeVisible(); // evidence still there, now cited by the AI
});

test("asking the same thing again is instant and uses no AI call", async ({ page }) => {
  const before = await calls();
  await page.goto("/chat");
  const start = Date.now();
  await ask(page, "What microcontroller does the controller use?");
  await expect(page.getByText(/AI-generated · gemini/)).toBeVisible({ timeout: 5_000 });
  const ms = Date.now() - start;
  console.log(`repeat question answered in ${ms} ms (stand-in AI would take 3000 ms)`);
  expect(ms).toBeLessThan(2000);
  await expect(page.getByRole("note")).toContainText("no AI quota was used");
  expect(await calls()).toBe(before);
  await shot(page, "ai-cached");
});

test("a momentary 503 from the AI is retried automatically and the user never notices", async ({ page }) => {
  await fake.get("/__delay/0");
  await fake.get("/__fail_next/1");
  const before = await calls();
  await page.goto("/chat");
  await ask(page, "How often do the soil moisture sensors sample?");
  await expect(page.getByText(/AI-generated · gemini/)).toBeVisible({ timeout: 15_000 });
  expect(await calls()).toBe(before + 2); // one 503, one success
  await expect(page.getByText(/did not respond|unavailable/)).toHaveCount(0);
});

test("a slow AI times out into plain passages with the reason, never a fake answer", async ({ page }) => {
  await fake.get("/__delay/9"); // the backend's timeout is 6 s
  await page.goto("/chat");
  await ask(page, "How much did water use decrease compared with flood irrigation?");
  await expect(page.getByRole("button", { name: /Open source \[1\].*page 1/ })).toBeVisible();
  await expect(page.getByText(/did not respond within 6 seconds/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Matching passages · no AI wrote this")).toBeVisible();
  await expect(page.getByText(/AI-generated/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Write AI answer" })).toHaveCount(0);
  await shot(page, "ai-timeout");
  await fake.get("/__delay/0");
});
