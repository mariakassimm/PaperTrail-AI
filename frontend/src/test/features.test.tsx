import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../services/api";
import type { AppSettings } from "../types";
import { applyDefaults, health, settings as baseSettings } from "./apiMock";
import { citation, doc, emptyStats, renderApp } from "./helpers";

vi.mock("../services/api", async () => (await import("./apiMock")).makeApiMock());
beforeEach(() => applyDefaults(api as unknown as Parameters<typeof applyDefaults>[0]));
const withSettings = (over: Partial<AppSettings> = {}) => vi.mocked(api.settings).mockResolvedValue({ ...baseSettings, ...over } as AppSettings);

describe("settings editor", () => {
  it("saves only what changed and keeps Save disabled until something changes", async () => {
    vi.mocked(api.updateSettings).mockResolvedValue({ ...baseSettings, top_k: 8 } as AppSettings);
    renderApp("/settings");
    const save = await screen.findByRole("button", { name: "Save settings" });
    expect(save).toBeDisabled();
    const topk = screen.getByLabelText(/Passages per question/);
    await userEvent.clear(topk); await userEvent.type(topk, "8");
    expect(screen.getByText("1 unsaved change")).toBeInTheDocument();
    await userEvent.click(save);
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({ top_k: 8 }));
    expect(await screen.findByText("Settings saved.")).toBeInTheDocument();
  });

  it("blocks an overlap that is not smaller than the chunk size, before calling the server", async () => {
    renderApp("/settings");
    const overlap = await screen.findByLabelText(/Chunk overlap/);
    await userEvent.clear(overlap); await userEvent.type(overlap, "900");
    expect(screen.getByText("Overlap must be smaller than the chunk size.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save settings" })).toBeDisabled();
    expect(api.updateSettings).not.toHaveBeenCalled();
  });

  it("only offers hybrid mode when an embedding provider exists", async () => {
    renderApp("/settings");
    const mode = await screen.findByLabelText("Retrieval mode");
    expect(within(mode).getByRole("option", { name: /Hybrid/ })).toBeDisabled();
    expect(screen.getByLabelText(/Build the meaning index automatically/)).toBeDisabled();
  });

  it("allows hybrid when available and disables the AI toggle when no provider is configured", async () => {
    withSettings({ retrieval_modes: ["keyword", "hybrid"], embedding_provider: "gemini (gemini-embedding-001)" });
    renderApp("/settings");
    expect(within(await screen.findByLabelText("Retrieval mode")).getByRole("option", { name: /Hybrid/ })).toBeEnabled();
    expect(screen.getByLabelText(/Let the AI write answers/)).toBeDisabled();
  });

  it("offers to reindex after chunk settings change, and reports the result", async () => {
    withSettings({ reindex_needed: true });
    vi.mocked(api.reindex).mockResolvedValue({ reindexed: 3, failed: 1 });
    renderApp("/settings");
    expect(await screen.findByRole("alert")).toHaveTextContent("Existing documents still use the old chunking");
    await userEvent.click(screen.getByRole("button", { name: "Reindex all documents" }));
    expect(await screen.findByText("Reindexed 3 document(s), 1 failed.")).toBeInTheDocument();
  });

  it("keeps Reset disabled when nothing is overridden", async () => {
    renderApp("/settings");
    expect(await screen.findByRole("button", { name: "Reset to defaults" })).toBeDisabled();
  });

  it("resets to defaults when something is overridden", async () => {
    withSettings({ overridden: ["top_k"], top_k: 2 });
    vi.mocked(api.resetSettings).mockResolvedValue(baseSettings as AppSettings);
    renderApp("/settings");
    const reset = await screen.findByRole("button", { name: "Reset to defaults" });
    await waitFor(() => expect(reset).toBeEnabled());
    await userEvent.click(reset);
    await waitFor(() => expect(api.resetSettings).toHaveBeenCalled());
    expect(await screen.findByText("Settings reset to defaults.")).toBeInTheDocument();
  });

  it("shows the server's message when saving fails", async () => {
    vi.mocked(api.updateSettings).mockRejectedValue(new Error("Hybrid search needs an embedding provider."));
    renderApp("/settings");
    const topk = await screen.findByLabelText(/Passages per question/);
    await userEvent.clear(topk); await userEvent.type(topk, "9");
    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await screen.findByText("Hybrid search needs an embedding provider.")).toBeInTheDocument();
  });

  it("explains semantic search honestly and tests the embedding connection", async () => {
    vi.mocked(api.testEmbeddings).mockResolvedValue({ ok: true, configured: true, provider: "gemini", message: "Connected. Received a 768-dimensional vector." });
    renderApp("/settings");
    expect(await screen.findByText(/Not configured: keyword search only/)).toBeInTheDocument();
    expect(screen.getByText(/each passage and question is sent to that provider/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Test embeddings" }));
    expect(await screen.findByText(/768-dimensional/)).toBeInTheDocument();
  });
});

describe("suggestions, match chips and semantic status", () => {
  it("offers suggested questions from the documents and asks one when clicked", async () => {
    vi.mocked(api.stats).mockResolvedValue({ ...emptyStats, documents: 1 });
    vi.mocked(api.suggestions).mockResolvedValue({ items: [{ term: "tensiometers", question: "Tell me about tensiometers" }], note: "" });
    vi.mocked(api.ask).mockResolvedValue({ conversation_id: 1, status: "answered", mode: "retrieval_only", answer: "ok", citations: [citation] });
    renderApp("/chat");
    await userEvent.click(await screen.findByRole("button", { name: "Tell me about tensiometers" }));
    await waitFor(() => expect(api.ask).toHaveBeenCalledWith(expect.objectContaining({ question: "Tell me about tensiometers" }), expect.anything()));
  });

  it("shows no suggestion row when there are none", async () => {
    vi.mocked(api.stats).mockResolvedValue({ ...emptyStats, documents: 1 });
    renderApp("/chat");
    expect(await screen.findByText(/Ask about your documents/)).toBeInTheDocument();
    expect(screen.queryByText(/Try one of these/)).not.toBeInTheDocument();
  });

  it("labels passages found by meaning, and says when hybrid search was used", async () => {
    vi.mocked(api.health).mockResolvedValue({ ...health, retrieval_mode: "hybrid (keyword + meaning)", semantic: true });
    vi.mocked(api.ask).mockResolvedValue({ conversation_id: 1, status: "answered", mode: "retrieval_only", answer: "x", retrieval: "hybrid",
      citations: [{ ...citation, matched_by: "meaning" }, { ...citation, chunk_id: 8, matched_by: "both" }, { ...citation, chunk_id: 9, matched_by: "keyword" }] });
    renderApp("/chat");
    expect(await screen.findByText(/Retrieval-only · hybrid \(keyword \+ meaning\)/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Your question"), "price of setup");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("matched by meaning")).toBeInTheDocument();
    expect(screen.getByText("keyword + meaning")).toBeInTheDocument();
    expect(screen.getAllByText("matched by meaning")).toHaveLength(1);
    expect(screen.getAllByText("keyword + meaning")).toHaveLength(1); // plain keyword hits get no chip
  });

  it("shows the meaning-index state per document and embeds on demand", async () => {
    vi.mocked(api.listDocuments).mockResolvedValue({ items: [doc(), doc({ id: 2, title: "Other" }), doc({ id: 3, title: "Third" })], total: 3, page: 1, page_size: 10 });
    vi.mocked(api.embeddingsStatus).mockResolvedValue({ enabled: true, provider: "gemini", config_error: null,
      documents: { 1: { embedded: 4, total: 4 }, 2: { embedded: 0, total: 5 }, 3: { embedded: 2, total: 6 } } });
    vi.mocked(api.embedDocument).mockResolvedValue({ added: 5, embedded: 5, total: 5 });
    renderApp("/documents");
    expect(await screen.findByText("meaning index ready")).toBeInTheDocument();
    expect(screen.getByText("keyword only")).toBeInTheDocument();
    expect(screen.getByText("meaning index 2/6")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Embed Solar Paper" })).not.toBeInTheDocument(); // already complete
    await userEvent.click(screen.getByRole("button", { name: "Embed Other" }));
    await waitFor(() => expect(api.embedDocument).toHaveBeenCalledWith(2));
  });

  it("hides all semantic UI when no embedding provider is configured", async () => {
    vi.mocked(api.listDocuments).mockResolvedValue({ items: [doc()], total: 1, page: 1, page_size: 10 });
    renderApp("/documents");
    await screen.findByText("Solar Paper");
    expect(screen.queryByText(/meaning index|keyword only/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Embed/ })).not.toBeInTheDocument();
  });

  it("search labels hybrid results and surfaces fallback notices", async () => {
    vi.mocked(api.search).mockResolvedValue({ search_type: "hybrid (keyword + meaning)", notice: "The semantic index covers 1 of 2 passages.", query: "price", title_matches: [], passages: [{ citation, coverage: 0 }] });
    renderApp("/search");
    await userEvent.type(screen.getByLabelText("Search query"), "price");
    await userEvent.click(screen.getByRole("button", { name: /Search$/ }));
    expect(await screen.findByText("Hybrid search (keyword + meaning)")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("covers 1 of 2 passages");
  });
});

describe("evaluation lab: your own cases", () => {
  const openLibrary = async () => { renderApp("/evaluation"); await userEvent.click(await screen.findByRole("tab", { name: "My library cases" })); };

  it("explains the empty state and disables running with no cases", async () => {
    await openLibrary();
    expect(await screen.findByText("No cases yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Run evaluation/ })).toBeDisabled();
    expect(screen.getByText(/read-only: nothing is saved/)).toBeInTheDocument();
  });

  it("creates a case with the parsed facts, file and pages", async () => {
    vi.mocked(api.listDocuments).mockResolvedValue({ items: [doc({ filename: "price.pdf" })], total: 1, page: 1, page_size: 100 });
    vi.mocked(api.createEvalCase).mockResolvedValue({ id: 1, question: "q", answerable: true, expected_facts: [], expected_filename: null, expected_pages: [] });
    await openLibrary();
    await userEvent.click(screen.getByRole("button", { name: "Add case" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Question"), "How much does installation cost?");
    await userEvent.type(within(dialog).getByLabelText(/Facts the cited evidence/), "140 US dollars,  14 months ,");
    await userEvent.selectOptions(within(dialog).getByLabelText(/Expected file/), "price.pdf");
    await userEvent.type(within(dialog).getByLabelText(/Expected pages/), "3, 4");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save case" }));
    await waitFor(() => expect(api.createEvalCase).toHaveBeenCalledWith({ question: "How much does installation cost?", answerable: true,
      expected_facts: ["140 US dollars", "14 months"], expected_filename: "price.pdf", expected_pages: [3, 4] }));
  });

  it("validates pages and requires a file when pages are given", async () => {
    await openLibrary();
    await userEvent.click(screen.getByRole("button", { name: "Add case" }));
    const dialog = await screen.findByRole("dialog");
    const save = within(dialog).getByRole("button", { name: "Save case" });
    await userEvent.type(within(dialog).getByLabelText("Question"), "q?");
    expect(save).toBeEnabled();
    await userEvent.type(within(dialog).getByLabelText(/Expected pages/), "0");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("whole numbers starting at 1");
    expect(save).toBeDisabled();
    await userEvent.clear(within(dialog).getByLabelText(/Expected pages/));
    await userEvent.type(within(dialog).getByLabelText(/Expected pages/), "2");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Choose the expected file");
    expect(save).toBeDisabled();
  });

  it("an unanswerable case hides expectations and sends none", async () => {
    vi.mocked(api.createEvalCase).mockResolvedValue({ id: 2, question: "q", answerable: false, expected_facts: [], expected_filename: null, expected_pages: [] });
    await openLibrary();
    await userEvent.click(screen.getByRole("button", { name: "Add case" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Question"), "Who won the world cup?");
    await userEvent.type(within(dialog).getByLabelText(/Facts the cited evidence/), "left over fact");  // typed, then the case is made unanswerable
    await userEvent.click(within(dialog).getByLabelText(/This should be answerable/));
    expect(within(dialog).queryByLabelText(/Expected pages/)).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Save case" }));
    await waitFor(() => expect(api.createEvalCase).toHaveBeenCalledWith({ question: "Who won the world cup?", answerable: false, expected_facts: [], expected_filename: null, expected_pages: [] }));
  });

  it("edits and deletes cases (with confirmation) and runs against the library", async () => {
    const one = { id: 5, question: "How much is it?", answerable: true, expected_facts: ["140"], expected_filename: "price.pdf", expected_pages: [1] };
    vi.mocked(api.evalCases).mockResolvedValue({ builtin: [], custom: [one] });
    vi.mocked(api.deleteEvalCase).mockResolvedValue(undefined);
    vi.mocked(api.runEvaluation).mockResolvedValue({ settings: { min_coverage: 0.5, top_k: 5, mode: "keyword", target: "library" },
      metrics: { cases: 1, pass_rate: 1, retrieval_hit_rate: 1, citation_validity_rate: 1, mean_fact_coverage: 1, abstention_accuracy: 1, correct_abstention_rate: null },
      results: [{ id: "case-5", question: "How much is it?", answerable: true, status: "answered", retrieved: [{ filename: "price.pdf", page: 1, chunk_id: 1 }], expected_facts: ["140"],
        expected_pages: [1], retrieval_hit: true, citation_valid: true, fact_coverage: 1, abstention_correct: true, passed: true }] });
    await openLibrary();
    expect(await screen.findByText(/expects price.pdf, page 1 · facts: 140/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Run evaluation/ }));
    expect(await screen.findByText("PASS")).toBeInTheDocument();
    expect(api.runEvaluation).toHaveBeenCalledWith({ target: "library" });
    await userEvent.click(screen.getByRole("button", { name: /Delete case: How much is it\?/ }));
    expect(api.deleteEvalCase).not.toHaveBeenCalled();
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(api.deleteEvalCase).toHaveBeenCalledWith(5));
  });

  it("compares keyword and hybrid settings only when semantic search exists", async () => {
    const one = { id: 5, question: "q", answerable: true, expected_facts: [], expected_filename: null, expected_pages: [] };
    vi.mocked(api.evalCases).mockResolvedValue({ builtin: [], custom: [one] });
    const rep = { settings: { min_coverage: 0.5, top_k: 5 }, results: [], metrics: { cases: 1, pass_rate: 1, retrieval_hit_rate: null, citation_validity_rate: 1, mean_fact_coverage: null, abstention_accuracy: 1, correct_abstention_rate: null } };
    vi.mocked(api.runEvaluation).mockResolvedValue(rep);
    await openLibrary();
    await userEvent.click(await screen.findByRole("button", { name: "Compare thresholds" }));
    await screen.findByRole("heading", { name: "Threshold comparison" });
    expect(api.runEvaluation).toHaveBeenCalledTimes(5); // keyword only: no embeddings configured
    vi.mocked(api.runEvaluation).mockClear();
    vi.mocked(api.health).mockResolvedValue({ ...health, semantic: true });
    renderApp("/evaluation");
    await userEvent.click((await screen.findAllByRole("tab", { name: "My library cases" })).at(-1)!);
    await userEvent.click((await screen.findAllByRole("button", { name: "Compare thresholds" })).at(-1)!);
    await waitFor(() => expect(api.runEvaluation).toHaveBeenCalledTimes(10)); // 5 keyword + 5 hybrid
    expect(vi.mocked(api.runEvaluation).mock.calls.filter(([o]) => o?.mode === "hybrid").map(([o]) => o?.min_cosine)).toEqual([0.5, 0.6, 0.7, 0.8, 0.9]);
  });
});
