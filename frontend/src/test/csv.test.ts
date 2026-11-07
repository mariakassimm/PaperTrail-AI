import { describe, expect, it } from "vitest";
import { validatePdf } from "../components/UploadZone";
import { resultsToCsv } from "../pages/Evaluation";
import type { EvalCase } from "../types";

describe("validatePdf", () => {
  const f = (name: string, size: number, type = "application/pdf") => new File([new Uint8Array(size)], name, { type });
  it("accepts a normal PDF", () => expect(validatePdf(f("a.pdf", 10), 1)).toBeNull());
  it("accepts a PDF by extension when the browser gives no MIME type", () => expect(validatePdf(f("A.PDF", 10, ""), 1)).toBeNull());
  it("rejects other types, empty files and oversized files", () => {
    expect(validatePdf(f("a.txt", 10, "text/plain"), 1)).toMatch(/not a PDF/);
    expect(validatePdf(f("a.pdf", 0), 1)).toMatch(/empty/);
    expect(validatePdf(f("a.pdf", 1024 * 1024 + 1), 1)).toMatch(/1 MB limit/);
  });
});

describe("resultsToCsv", () => {
  it("escapes quotes and keeps one row per case", () => {
    const r: EvalCase = { id: "x", question: 'Say "hi", ok?', answerable: true, status: "answered", retrieved: [{ filename: "a.pdf", page: 1, chunk_id: 1 }],
      expected_facts: [], expected_pages: [1], retrieval_hit: true, citation_valid: true, fact_coverage: 1, abstention_correct: true, passed: true };
    const lines = resultsToCsv([r]).split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"Say ""hi"", ok?"');
    expect(lines[1]).toContain('"a.pdf:p1"');
  });
});
