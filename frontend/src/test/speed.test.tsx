import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../services/api";
import type { AskResponse } from "../types";
import { applyDefaults } from "./apiMock";
import { citation, emptyStats, renderApp } from "./helpers";

vi.mock("../services/api", async () => (await import("./apiMock")).makeApiMock());
beforeEach(() => {
  applyDefaults(api as unknown as Parameters<typeof applyDefaults>[0]);
  vi.mocked(api.stats).mockResolvedValue({ ...emptyStats, documents: 1 });
});

const pending: AskResponse = { conversation_id: 1, message_id: 11, status: "answered", mode: "retrieval_only", ai_pending: true,
  answer: "These are the passages that best match your question.", citations: [citation], provider: null, notice: null };
const written: AskResponse = { ...pending, mode: "ai_generated", ai_pending: false, provider: "gemini (m)", answer: "It uses an ESP32 [1].",
  notice: "Written by an AI model using only the passages cited below." };

const ask = async (q = "microcontroller") => {
  await userEvent.type(await screen.findByLabelText("Your question"), q);
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
};
const deferred = () => { let resolve!: (r: AskResponse) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<AskResponse>((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };

describe("evidence first, answer second", () => {
  it("shows the passages immediately and swaps in the AI answer when it arrives", async () => {
    const gen = deferred();
    vi.mocked(api.ask).mockResolvedValue(pending);
    vi.mocked(api.generateAnswer).mockReturnValue(gen.promise);
    renderApp("/chat");
    await ask();
    // Phase 1: evidence is on screen while the AI is still working
    expect(await screen.findByText("Writing a cited answer from these passages…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open source \[1\]/ })).toBeInTheDocument();
    expect(screen.getByText("Matching passages · AI answer pending")).toBeInTheDocument();
    expect(screen.queryByText(/AI-generated/)).not.toBeInTheDocument();
    expect(api.ask).toHaveBeenCalledWith(expect.objectContaining({ defer_ai: true }), expect.anything());
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();  // can't double-submit meanwhile
    expect(screen.queryByText("Searching your documents…")).not.toBeInTheDocument();  // the search is finished; only the AI is working
    // Phase 2
    gen.resolve(written);
    expect(await screen.findByText("It uses an ESP32 [1].")).toBeInTheDocument();
    expect(screen.getByText(/AI-generated · gemini \(m\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Writing a cited answer/)).not.toBeInTheDocument();
    expect(api.generateAnswer).toHaveBeenCalledWith(11, expect.anything());
    expect(await screen.findByRole("button", { name: "Send" })).toBeInTheDocument();
  });

  it("keeps the passages and offers a retry when the AI step fails", async () => {
    vi.mocked(api.ask).mockResolvedValue(pending);
    vi.mocked(api.generateAnswer).mockRejectedValueOnce(new Error("Cannot reach the PaperTrail backend.")).mockResolvedValueOnce(written);
    renderApp("/chat");
    await ask();
    expect(await screen.findByText("Cannot reach the PaperTrail backend.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open source \[1\]/ })).toBeInTheDocument();  // evidence is not lost
    await userEvent.click(await screen.findByRole("button", { name: "Write AI answer" }));
    expect(await screen.findByText("It uses an ESP32 [1].")).toBeInTheDocument();
    expect(api.generateAnswer).toHaveBeenCalledTimes(2);
    expect(api.ask).toHaveBeenCalledTimes(1);  // the retry never re-asks the question
  });

  it("stopping the wait keeps the passages and lets you try again", async () => {
    vi.mocked(api.ask).mockResolvedValue(pending);
    vi.mocked(api.generateAnswer).mockImplementation((_id, signal) => new Promise((_res, rej) => {
      signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))); }));
    renderApp("/chat");
    await ask();
    await userEvent.click(await screen.findByRole("button", { name: "Stop" }));
    expect(await screen.findByText(/Stopped waiting/)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Write AI answer" })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Open source \[1\]/ })).toBeInTheDocument();
  });

  it("an answer interrupted by a page reload can be finished from the saved conversation", async () => {
    vi.mocked(api.conversations).mockResolvedValue([{ id: 1, title: "microcontroller", collection_id: null, created_at: "2026-10-01T00:00:00Z" }]);
    vi.mocked(api.conversation).mockResolvedValue({ id: 1, title: "microcontroller", collection_id: null, created_at: "2026-10-01T00:00:00Z", messages: [
      { id: 10, role: "user", content: "microcontroller", meta: null, created_at: "2026-10-01T00:00:00Z" },
      { id: 11, role: "assistant", content: pending.answer, created_at: "2026-10-01T00:00:00Z", meta: { status: "answered", mode: "retrieval_only", citations: [citation], ai_pending: true } }] });
    vi.mocked(api.generateAnswer).mockResolvedValue(written);
    renderApp("/chat?conversation=1");
    const button = await screen.findByRole("button", { name: "Write AI answer" });
    await userEvent.click(button);
    expect(await screen.findByText("It uses an ESP32 [1].")).toBeInTheDocument();
    expect(api.generateAnswer).toHaveBeenCalledWith(11, expect.anything());
  });

  it("makes no second request when no AI answer is pending (retrieval-only mode)", async () => {
    vi.mocked(api.ask).mockResolvedValue({ ...pending, ai_pending: false, message_id: 12 });
    renderApp("/chat");
    await ask();
    expect(await screen.findByText("Matching passages · no AI wrote this")).toBeInTheDocument();
    expect(api.generateAnswer).not.toHaveBeenCalled();
    expect(screen.queryByText(/Writing a cited answer/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Write AI answer" })).not.toBeInTheDocument();
  });

  it("shows an instant remembered answer straight away, with the cache notice", async () => {
    vi.mocked(api.ask).mockResolvedValue({ ...written, cached: true, ai_pending: false,
      notice: "Written by an AI model using only the passages cited below. This answer was remembered from an identical earlier request, so no AI quota was used." });
    renderApp("/chat");
    await ask();
    expect(await screen.findByText(/AI-generated · gemini \(m\)/)).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("no AI quota was used");
    expect(api.generateAnswer).not.toHaveBeenCalled();
  });

  it("falls back to plain passages with the reason when the AI fails server-side", async () => {
    vi.mocked(api.ask).mockResolvedValue(pending);
    vi.mocked(api.generateAnswer).mockResolvedValue({ ...pending, ai_pending: false, notice: "The AI provider did not respond within 30 seconds. Showing matching passages instead." });
    renderApp("/chat");
    await ask();
    expect(await screen.findByText(/did not respond within 30 seconds/)).toBeInTheDocument();
    expect(screen.getByText("Matching passages · no AI wrote this")).toBeInTheDocument();  // never mislabelled as AI
    expect(screen.queryByRole("button", { name: "Write AI answer" })).not.toBeInTheDocument();
  });
});

describe("Evaluation Lab moved under Advanced", () => {
  it("is no longer in the main menu but reachable from Settings, with a way back", async () => {
    renderApp("/settings");
    const nav = await screen.findAllByRole("navigation", { name: "Main" });
    expect(within(nav[0]).queryByRole("link", { name: /Evaluation/ })).not.toBeInTheDocument();
    expect(await screen.findByText(/You don't need them for everyday use/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: /Open Evaluation Lab/ }));
    expect(await screen.findByRole("heading", { name: "Evaluation Lab" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: /Back to Settings/ }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument());
  });
});
