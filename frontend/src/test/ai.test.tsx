import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../services/api";
import { applyDefaults, citation, emptyStats, renderApp } from "./helpers";

vi.mock("../services/api", async () => (await import("./apiMock")).makeApiMock());
beforeEach(() => applyDefaults(api as unknown as Parameters<typeof applyDefaults>[0]));

const ask = async (question = "microcontroller") => {
  await userEvent.type(await screen.findByLabelText("Your question"), question);
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
};

describe("chat: AI honesty", () => {
  it("labels AI-written answers with the provider and shows the verify-the-sources notice", async () => {
    vi.mocked(api.stats).mockResolvedValue({ ...emptyStats, documents: 1 });
    vi.mocked(api.ask).mockResolvedValue({ conversation_id: 1, status: "answered", mode: "ai_generated", provider: "gemini (m)",
      answer: "It uses an ESP32 [1].", citations: [citation], notice: "Written by an AI model using only the passages cited below." });
    renderApp("/chat");
    await ask();
    expect(await screen.findByText(/AI-generated · gemini \(m\)/)).toBeInTheDocument();
    expect(screen.getByText("It uses an ESP32 [1].")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("Written by an AI model");
    expect(screen.getByRole("button", { name: /Open source \[1\]/ })).toBeInTheDocument();
  });

  it("never labels fallback passages as AI, and explains why the AI was skipped", async () => {
    vi.mocked(api.ask).mockResolvedValue({ conversation_id: 1, status: "answered", mode: "retrieval_only", provider: null,
      answer: "Retrieval-only mode: matching passages.", citations: [citation],
      notice: "Gemini free-tier quota or rate limit reached. Showing matching passages instead." });
    renderApp("/chat");
    await ask();
    expect(await screen.findByText(/Matching passages · no AI wrote this/)).toBeInTheDocument();
    expect(screen.queryByText(/AI-generated/)).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("quota or rate limit reached");
  });

  it("shows the active AI provider in the header and chat scope bar", async () => {
    vi.mocked(api.health).mockResolvedValue({ status: "ok", retrieval_mode: "keyword (BM25)", ai_provider: "gemini (m)", ai_mode: "generative" });
    renderApp("/chat");
    expect(await screen.findByText("AI: gemini (m)")).toBeInTheDocument();
    expect(await screen.findByText(/AI answers: gemini \(m\) · keyword \(BM25\)/)).toBeInTheDocument();
  });
});

describe("settings: provider panel", () => {
  it("explains retrieval-only mode and a missing-key configuration problem", async () => {
    vi.mocked(api.settings).mockResolvedValue({ retrieval_mode: "keyword (BM25)", ai_provider: null, chunk_size: 900, chunk_overlap: 150, top_k: 5,
      min_term_coverage: 0.5, max_upload_mb: 20, ai_model: null, ai_configured: false, ai_config_error: "PAPERTRAIL_GEMINI_API_KEY is not set." });
    renderApp("/settings");
    expect(await screen.findByText(/Not configured: retrieval-only/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("GEMINI_API_KEY is not set");
    expect(screen.getByText(/never put the key in the frontend/i)).toBeInTheDocument();
  });

  it("test connection reports success", async () => {
    vi.mocked(api.settings).mockResolvedValue({ retrieval_mode: "keyword (BM25)", ai_provider: "gemini", chunk_size: 900, chunk_overlap: 150, top_k: 5,
      min_term_coverage: 0.5, max_upload_mb: 20, ai_model: "m", ai_configured: true, ai_config_error: null });
    vi.mocked(api.testProvider).mockResolvedValue({ ok: true, configured: true, provider: "gemini (m)", message: "Connected." });
    renderApp("/settings");
    expect(await screen.findByText(/Active: gemini · m/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText(/Connected\./)).toBeInTheDocument();
  });

  it("test connection shows the provider's failure message and survives network errors", async () => {
    vi.mocked(api.testProvider).mockResolvedValueOnce({ ok: false, configured: true, provider: "gemini (m)", message: "Gemini rejected the API key." });
    renderApp("/settings");
    await userEvent.click(await screen.findByRole("button", { name: "Test connection" }));
    expect(await screen.findByText(/Gemini rejected the API key/)).toBeInTheDocument();
    vi.mocked(api.testProvider).mockRejectedValueOnce(new Error("Cannot reach the PaperTrail backend."));
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }));
    const status = await screen.findByText(/Cannot reach the PaperTrail backend/);
    expect(within(status.closest("p")!).getByText(/Cannot reach/)).toBeInTheDocument();
  });
});
