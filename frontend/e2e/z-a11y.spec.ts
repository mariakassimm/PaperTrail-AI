import { fileURLToPath } from "node:url";
import fs from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, request, test, type Page } from "@playwright/test";

// Runs after journeys.spec.ts (alphabetical order). Seeds data through the API so pages show real content.
const SAMPLE = fileURLToPath(new URL("../../sample_data/sample_paper.pdf", import.meta.url));
const ROUTES = ["/", "/documents", "/collections", "/chat", "/search", "/evaluation", "/settings"];
const THEMES = ["dark", "light", "aurora"] as const;

test.beforeAll(async () => {
  const api = await request.newContext({ baseURL: "http://127.0.0.1:8000" });
  await api.post("/api/v1/documents", { multipart: { file: { name: "sample_paper.pdf", mimeType: "application/pdf", buffer: fs.readFileSync(SAMPLE) } } });
  await api.post("/api/v1/ask", { data: { question: "What microcontroller does the controller use?" } });
  await api.post("/api/v1/collections", { data: { name: "Irrigation", description: "Sample collection" } });
  await api.post("/api/v1/evaluation/cases", { data: { question: "Which chip?", answerable: true, expected_facts: ["ESP32"], expected_filename: "sample_paper.pdf", expected_pages: [2] } });
});

/** Runs axe and returns readable violation lines (callers collect them so one run reports every problem). */
async function audit(page: Page, label: string): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return results.violations.map((v) => `[${label}] ${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

for (const theme of THEMES) {
  test(`accessibility: every page has no axe violations in the ${theme} theme`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("papertrail-theme", t), theme);
    const found: string[] = [];
    for (const route of ROUTES) {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      await expect(page.locator("main")).toBeVisible();
      found.push(...(await audit(page, `${route} (${theme})`)));
    }
    expect(found).toEqual([]);
  });
}

test("accessibility: dialogs, the evidence panel, results and the mobile menu", async ({ page }) => {
  const found: string[] = [];
  await page.goto("/chat");
  await page.getByRole("complementary", { name: "Conversations" }).getByRole("button").first().click();
  await page.getByRole("button", { name: /Open source \[1\]/ }).first().click();
  await expect(page.getByRole("complementary", { name: "Source evidence" })).toContainText("ESP32");
  found.push(...(await audit(page, "evidence panel")));
  await page.goto("/documents");
  await page.getByRole("button", { name: /^Delete / }).click();
  found.push(...(await audit(page, "delete dialog")));
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await page.goto("/evaluation");
  await page.getByRole("button", { name: /Run evaluation/ }).click();
  await expect(page.getByText("PASS", { exact: true }).first()).toBeVisible();
  found.push(...(await audit(page, "evaluation results")));
  await page.getByRole("tab", { name: "My library cases" }).click();
  await page.getByRole("button", { name: "Add case" }).click();
  found.push(...(await audit(page, "add-case dialog")));
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open navigation" }).click();
  found.push(...(await audit(page, "mobile menu")));
  expect(found).toEqual([]);
});
