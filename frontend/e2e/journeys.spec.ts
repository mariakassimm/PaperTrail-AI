import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const SAMPLE = fileURLToPath(new URL("../../sample_data/sample_paper.pdf", import.meta.url));
const SHOTS = process.env.SHOTS_DIR;
const shot = async (page: Page, name: string) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false }); } };

test.describe.configure({ mode: "serial" });

async function ask(page: Page, question: string) {
  await page.goto("/chat");
  await page.getByLabel("Your question").fill(question);
  await page.getByRole("button", { name: "Send" }).click();
}

test("1. the app starts and talks to the backend", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Welcome to PaperTrail AI" })).toBeVisible();
  await expect(page.getByText("Your library is empty")).toBeVisible();
  await expect(page.getByText("Retrieval: keyword (BM25)", { exact: true })).toBeVisible();
  await expect(page.getByText("Backend offline")).toHaveCount(0);
  await shot(page, "dashboard-empty-dark");
});

test("2. a sample PDF uploads, is extracted and indexed", async ({ page }) => {
  await page.goto("/documents");
  await page.getByLabel("Choose PDF files").setInputFiles(SAMPLE);
  await expect(page.getByText(/uploaded and indexed/)).toBeVisible();
  const row = page.getByRole("listitem").filter({ hasText: "sample_paper" });
  await expect(row.getByText("indexed", { exact: true })).toBeVisible();
  await expect(row).toContainText("3 pages");
  await shot(page, "documents-dark");
});

test("3. duplicates and non-PDF files are rejected with clear messages", async ({ page }) => {
  await page.goto("/documents");
  await page.getByLabel("Choose PDF files").setInputFiles(SAMPLE);
  await expect(page.getByText(/already uploaded/)).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "sample_paper" })).toHaveCount(1);
  await page.getByLabel("Choose PDF files").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.getByText(/not a PDF/)).toBeVisible();
});

test("4. a question returns evidence with a real page, and the citation opens the source", async ({ page }) => {
  await ask(page, "What microcontroller does the controller use?");
  await expect(page.getByText("Matching passages · no AI wrote this")).toBeVisible();
  const citation = page.getByRole("button", { name: /Open source \[1\].*page 2/ });
  await expect(citation).toBeVisible();
  await shot(page, "chat-answer-dark");
  await citation.click();
  const panel = page.getByRole("complementary", { name: "Source evidence" });
  await expect(panel).toContainText("ESP32");
  await expect(panel).toContainText("page 2");
  await expect(panel.getByText("Page 2 in context")).toBeVisible();
  // regression checks for bugs found by eyeballing real screenshots
  await expect(panel.getByTestId("cited-span")).toContainText("ESP32 microcontroller opens the pump");
  const highlighted = (await panel.locator("mark").allTextContents()).map((s) => s.toLowerCase());
  expect(highlighted.length).toBeGreaterThan(0);
  expect(highlighted).not.toContain("the"); // stopwords are never highlighted
  expect(highlighted).toContain("controller");
  await shot(page, "evidence-panel-dark");
  await panel.getByRole("button", { name: "Close evidence panel" }).click();
  await expect(panel).toHaveCount(0);
});

test("5. an unanswerable question abstains instead of inventing an answer", async ({ page }) => {
  await ask(page, "What is the population of France?");
  await expect(page.getByText("Not enough evidence.")).toBeVisible();
  await expect(page.getByText(/Evidence \(/)).toHaveCount(0);
});

test("6. search is labelled keyword-based and highlights matches", async ({ page }) => {
  await page.goto("/search");
  await page.getByLabel("Search query").fill("soil moisture sensors");
  await page.getByRole("button", { name: /Search$/ }).click();
  await expect(page.getByText(/Keyword search \(BM25\), not semantic/)).toBeVisible();
  await expect(page.locator("mark").first()).toBeVisible();
});

test("7. collections: create, assign a document, and scope a question", async ({ page }) => {
  await page.goto("/collections");
  await page.getByRole("button", { name: "New collection" }).click();
  await page.getByLabel("Name").fill("Irrigation");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("link", { name: "Irrigation" })).toBeVisible();
  await page.goto("/documents");
  await page.getByLabel(/Collection for/).selectOption({ label: "Irrigation" });
  await expect(page.getByText("Collection updated.")).toBeVisible();
  await page.goto("/collections");
  await expect(page.getByText("1 document")).toBeVisible();
  await page.getByRole("link", { name: "Ask", exact: true }).click();
  await expect(page.getByLabel("Searching:")).toHaveValue(/\d+/);
  await page.getByLabel("Your question").fill("How much did water use decrease?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("button", { name: /Open source \[1\].*page 1/ })).toBeVisible();
});

test("8. the Evaluation Lab runs with no API key and every case passes", async ({ page }) => {
  await page.goto("/evaluation");
  await page.getByRole("button", { name: /Run evaluation/ }).click();
  await expect(page.getByText("PASS", { exact: true })).toHaveCount(7);
  await expect(page.getByText("FAIL", { exact: true })).toHaveCount(0);
  await shot(page, "evaluation-dark");
  await page.getByRole("button", { name: "Compare thresholds" }).click();
  await expect(page.getByRole("heading", { name: "Threshold comparison" })).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "CSV" }).click()]);
  expect(download.suggestedFilename()).toBe("evaluation.csv");
});

test("9. all three themes switch, restyle the page, and persist across reloads", async ({ page }) => {
  await page.goto("/settings");
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const group = page.getByRole("group", { name: "Theme" });
  const seen = new Set<string>([await bg()]);
  for (const [name, id] of [["Light Professional", "light"], ["Midnight Aurora", "aurora"], ["Dark Neon Purple", "dark"]] as const) {
    await group.getByRole("button", { name }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", id);
    seen.add(await bg());
    await shot(page, `settings-${id}`);
  }
  expect(seen.size).toBe(3);
  await group.getByRole("button", { name: "Midnight Aurora" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "aurora");
});

const ROUTES = ["/", "/documents", "/collections", "/chat", "/search", "/evaluation", "/settings"];
for (const [label, size] of [["phone", { width: 375, height: 812 }], ["tablet", { width: 768, height: 1024 }]] as const) {
  test(`10. no horizontal overflow on any page at ${label} width, in every theme`, async ({ page }) => {
    await page.setViewportSize(size);
    for (const theme of ["dark", "light", "aurora"]) {
      await page.addInitScript((t) => localStorage.setItem("papertrail-theme", t), theme);
      for (const route of ROUTES) {
        await page.goto(route);
        await expect(page.locator("main")).toBeVisible();
        await page.waitForLoadState("networkidle");
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, `${route} (${theme}, ${label}) overflows by ${overflow}px`).toBeLessThanOrEqual(0);
      }
    }
    await shot(page, `chat-${label}`);
  });
}

test("11. the mobile menu opens, navigates and closes", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Search", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Search", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close navigation" })).toHaveCount(0);
  await shot(page, "mobile-search");
});

test("9b. settings can be edited, persist across reloads, validate, and reset", async ({ page }) => {
  await page.goto("/settings");
  await page.getByLabel(/Passages per question/).fill("2");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(/Passages per question/)).toHaveValue("2");
  await shot(page, "settings-tuning");
  await page.getByRole("button", { name: "Reset to defaults" }).click();
  await expect(page.getByText("Settings reset to defaults.")).toBeVisible();
  await expect(page.getByLabel(/Passages per question/)).toHaveValue("5");
  await page.getByLabel(/Chunk overlap/).fill("900");
  await expect(page.getByText("Overlap must be smaller than the chunk size.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save settings" })).toBeDisabled();
});

test("9c. suggested questions come from the document and each one is answerable", async ({ page }) => {
  await page.goto("/chat");
  const chips = page.getByText(/Try one of these/).locator("xpath=..").getByRole("button");
  await expect(chips.first()).toBeVisible();
  expect(await chips.first().textContent()).toMatch(/^Tell me about /);
  await shot(page, "chat-suggestions");
  await chips.first().click();
  await expect(page.getByText("Matching passages · no AI wrote this")).toBeVisible();
  await expect(page.getByRole("button", { name: /Open source \[1\]/ })).toBeVisible();
});

test("9d. you can add your own evaluation cases and run them against your library", async ({ page }) => {
  await page.goto("/evaluation");
  await page.getByRole("tab", { name: "My library cases" }).click();
  await expect(page.getByText("No cases yet")).toBeVisible();
  await page.getByRole("button", { name: "Add case" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Question").fill("What microcontroller does the controller use?");
  await dialog.getByLabel(/Facts the cited evidence/).fill("ESP32");
  await dialog.getByLabel(/Expected file/).selectOption("sample_paper.pdf");
  await dialog.getByLabel(/Expected pages/).fill("2");
  await dialog.getByRole("button", { name: "Save case" }).click();
  await expect(page.getByText("Case saved.")).toBeVisible();
  await page.getByRole("button", { name: "Add case" }).click();
  await dialog.getByLabel("Question").fill("What is the population of France?");
  await dialog.getByLabel(/This should be answerable/).uncheck();
  await dialog.getByRole("button", { name: "Save case" }).click();
  await expect(page.getByText("should be refused")).toBeVisible();
  await page.getByRole("button", { name: /Run evaluation/ }).click();
  await expect(page.getByText("PASS", { exact: true })).toHaveCount(2);
  await shot(page, "evaluation-library");
});

test("9e. changing chunk size asks for a reindex, applies it, and reset asks again", async ({ page }) => {
  await page.goto("/settings");
  await page.getByLabel(/Chunk size/).fill("300");
  await page.getByLabel(/Chunk overlap/).fill("30");
  await page.getByRole("button", { name: "Save settings" }).click();
  const banner = page.getByRole("alert").filter({ hasText: "Existing documents still use the old chunking" });
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: "Reindex all documents" }).click();
  await expect(page.getByText(/Reindexed 1 document/)).toBeVisible();
  await expect(banner).toHaveCount(0);
  await ask(page, "What microcontroller does the controller use?");
  await expect(page.getByRole("button", { name: /Open source \[1\].*page 2/ })).toBeVisible();
  await page.goto("/settings");
  await page.getByRole("button", { name: "Reset to defaults" }).click();
  await expect(banner).toBeVisible(); // documents are chunked at 300 but the setting is back to 900
  await banner.getByRole("button", { name: "Reindex all documents" }).click();
  await expect(banner).toHaveCount(0);
});

test("12. deleting a document asks first, removes it, and its citations stop resolving", async ({ page }) => {
  await ask(page, "What microcontroller does the controller use?");
  const chunkHref = await page.getByRole("button", { name: /Open source \[1\]/ }).count();
  expect(chunkHref).toBe(1);
  await page.goto("/documents");
  await page.getByRole("button", { name: /^Delete / }).click();
  await expect(page.getByRole("dialog")).toContainText("permanently removed");
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Document deleted.")).toBeVisible();
  await expect(page.getByText("No documents yet")).toBeVisible();
  await ask(page, "What microcontroller does the controller use?");
  await expect(page.getByText("Not enough evidence.")).toBeVisible();
});
