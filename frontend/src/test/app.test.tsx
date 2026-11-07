import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../services/api";
import { THEME_KEY } from "../hooks/useTheme";
import { applyDefaults, citation, doc, emptyStats, renderApp } from "./helpers";

vi.mock("../services/api", async () => (await import("./apiMock")).makeApiMock());
beforeEach(() => applyDefaults(api as unknown as Parameters<typeof applyDefaults>[0]));

describe("navigation and shell", () => {
  it("renders the dashboard empty state for a first-time user", async () => {
    renderApp("/");
    expect(await screen.findByText("Your library is empty")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /upload your first pdf/i })).toBeInTheDocument();
    expect(await screen.findByText(/No AI model \(retrieval-only\)/)).toBeInTheDocument();
  });

  it("shows stats from the API, not hardcoded numbers", async () => {
    vi.mocked(api.stats).mockResolvedValue({ ...emptyStats, documents: 4, documents_by_status: { indexed: 3, failed: 1 }, collections: 2, conversations: 5 });
    vi.mocked(api.listDocuments).mockResolvedValue({ items: [doc()], total: 1, page: 1, page_size: 5 });
    renderApp("/");
    expect(await screen.findByText("Indexed documents")).toBeInTheDocument();
    const tile = screen.getByText("Indexed documents").closest("div.card");
    await waitFor(() => expect(tile).toHaveTextContent("3"));
    expect(screen.getByText("Solar Paper")).toBeInTheDocument();
  });

  it("navigates between pages from the sidebar", async () => {
    renderApp("/");
    await userEvent.click(screen.getAllByRole("link", { name: /Settings/ })[0]);
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("link", { name: /Open Evaluation Lab/ }));  // lives under Settings > Advanced
    expect(await screen.findByRole("heading", { name: "Evaluation Lab" })).toBeInTheDocument();
  });

  it("shows an offline notice when the backend is unreachable", async () => {
    vi.mocked(api.health).mockRejectedValue(new Error("Cannot reach"));
    renderApp("/settings");
    expect(await screen.findByText("Backend offline")).toBeInTheDocument();
  });
});

describe("themes", () => {
  it("switches theme, updates the document and persists the choice", async () => {
    renderApp("/");
    const group = screen.getByRole("group", { name: "Theme" });
    await userEvent.click(within(group).getByRole("button", { name: "Light Professional" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem(THEME_KEY)).toBe("light");
    await userEvent.click(within(group).getByRole("button", { name: "Midnight Aurora" }));
    expect(document.documentElement.dataset.theme).toBe("aurora");
    expect(within(group).getByRole("button", { name: "Midnight Aurora" })).toHaveAttribute("aria-pressed", "true");
  });

  it("restores a saved theme on load and ignores invalid stored values", () => {
    localStorage.setItem(THEME_KEY, "aurora");
    const first = renderApp("/");
    expect(document.documentElement.dataset.theme).toBe("aurora");
    first.unmount();
    localStorage.setItem(THEME_KEY, "<script>");
    renderApp("/");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("resets appearance from Settings", async () => {
    localStorage.setItem(THEME_KEY, "light");
    renderApp("/settings");
    await userEvent.click(screen.getByRole("button", { name: /reset appearance/i }));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});

describe("documents", () => {
  it("lists documents with status and filename", async () => {
    vi.mocked(api.listDocuments).mockResolvedValue({ items: [doc(), doc({ id: 2, title: "Broken", status: "failed", status_message: "No extractable text found." })], total: 2, page: 1, page_size: 10 });
    renderApp("/documents");
    expect(await screen.findByText("Solar Paper")).toBeInTheDocument();
    expect(screen.getByText("No extractable text found.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry Broken" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry Solar Paper" })).not.toBeInTheDocument();
  });

  it("shows an empty state and an error state with retry", async () => {
    renderApp("/documents");
    expect(await screen.findByText("No documents yet")).toBeInTheDocument();
    vi.mocked(api.listDocuments).mockRejectedValue(new Error("Cannot reach the PaperTrail backend."));
    renderApp("/documents");
    expect((await screen.findAllByRole("alert"))[0]).toHaveTextContent("Cannot reach");
  });

  it("rejects non-PDF files client-side without calling the API", async () => {
    renderApp("/documents");
    const input = await screen.findByLabelText("Choose PDF files");
    await userEvent.upload(input, new File(["hello"], "notes.txt", { type: "text/plain" }), { applyAccept: false });
    expect(await screen.findByText(/is not a PDF/)).toBeInTheDocument();
    expect(api.upload).not.toHaveBeenCalled();
  });

  it("uploads a valid PDF and reports success", async () => {
    vi.mocked(api.upload).mockResolvedValue(doc());
    renderApp("/documents");
    const input = await screen.findByLabelText("Choose PDF files");
    await userEvent.upload(input, new File(["%PDF-1.4"], "solar.pdf", { type: "application/pdf" }));
    expect(await screen.findByText(/uploaded and indexed/)).toBeInTheDocument();
    expect(api.upload).toHaveBeenCalledTimes(1);
  });

  it("asks for confirmation before deleting", async () => {
    vi.mocked(api.listDocuments).mockResolvedValue({ items: [doc()], total: 1, page: 1, page_size: 10 });
    vi.mocked(api.deleteDocument).mockResolvedValue(undefined);
    renderApp("/documents");
    await userEvent.click(await screen.findByRole("button", { name: "Delete Solar Paper" }));
    expect(api.deleteDocument).not.toHaveBeenCalled();
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(api.deleteDocument).toHaveBeenCalledWith(1));
  });
});

describe("chat and citations", () => {
  const answered = { conversation_id: 1, status: "answered" as const, mode: "retrieval_only", answer: "Retrieval-only mode: matching passages.", citations: [citation] };

  it("submits a question and renders the answer with its evidence", async () => {
    vi.mocked(api.stats).mockResolvedValue({ ...emptyStats, documents: 1 });
    vi.mocked(api.ask).mockResolvedValue(answered);
    renderApp("/chat");
    await userEvent.type(await screen.findByLabelText("Your question"), "What microcontroller?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText(/Retrieval-only mode: matching passages/)).toBeInTheDocument();
    expect(screen.getByText("What microcontroller?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open source \[1\] .*Solar Paper.*page 2/ })).toBeInTheDocument();
    expect(api.ask).toHaveBeenCalledWith(expect.objectContaining({ question: "What microcontroller?" }), expect.anything());
  });

  it("opens the evidence panel with the stored passage when a citation is clicked", async () => {
    vi.mocked(api.ask).mockResolvedValue(answered);
    vi.mocked(api.chunk).mockResolvedValue({ chunk_id: 7, document_id: 1, document_title: "Solar Paper", filename: "solar.pdf", page_number: 2,
      text: "A controller built around an ESP32 microcontroller opens the pump.", page_text: "Methods.\nA controller built around an ESP32 microcontroller opens the pump. Trial covered 12 farms.", highlight_start: 9, highlight_end: 75 });
    renderApp("/chat");
    await userEvent.type(await screen.findByLabelText("Your question"), "microcontroller");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await userEvent.click(await screen.findByRole("button", { name: /Open source \[1\]/ }));
    const panel = await screen.findByRole("complementary", { name: "Source evidence" });
    expect(await within(panel).findByText(/opens the pump\./, { selector: "p" })).toBeInTheDocument();
    expect(within(panel).getByText(/solar.pdf · page 2/)).toBeInTheDocument();
    expect(within(panel).getByTestId("cited-span")).toHaveTextContent("A controller built around an ESP32 microcontroller opens the pump.");
    expect(api.chunk).toHaveBeenCalledWith(7);
    await userEvent.click(within(panel).getByRole("button", { name: "Close evidence panel" }));
    expect(screen.queryByRole("complementary", { name: "Source evidence" })).not.toBeInTheDocument();
  });

  it("explains a missing source instead of crashing", async () => {
    vi.mocked(api.ask).mockResolvedValue(answered);
    vi.mocked(api.chunk).mockRejectedValue(new Error("This source passage no longer exists (was the document deleted?)."));
    renderApp("/chat");
    await userEvent.type(await screen.findByLabelText("Your question"), "microcontroller");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await userEvent.click(await screen.findByRole("button", { name: /Open source \[1\]/ }));
    expect(await screen.findByText(/no longer exists/)).toBeInTheDocument();
  });

  it("presents insufficient evidence distinctly, with no citations", async () => {
    vi.mocked(api.ask).mockResolvedValue({ conversation_id: 1, status: "insufficient_evidence", mode: "retrieval_only", answer: "I could not find passages.", citations: [] });
    renderApp("/chat");
    await userEvent.type(await screen.findByLabelText("Your question"), "capital of france");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Not enough evidence.")).toBeInTheDocument();
    expect(screen.queryByText(/Evidence \(/)).not.toBeInTheDocument();
  });

  it("shows request failures as an error, not as an answer", async () => {
    vi.mocked(api.ask).mockRejectedValue(new Error("Cannot reach the PaperTrail backend."));
    renderApp("/chat");
    await userEvent.type(await screen.findByLabelText("Your question"), "anything");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot reach");
    expect(screen.queryByText("Not enough evidence.")).not.toBeInTheDocument();
  });

  it("disables Send for blank input and labels the mode honestly", async () => {
    renderApp("/chat");
    expect(await screen.findByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByText(/Retrieval-only · keyword/)).toBeInTheDocument();
  });
});

describe("search and evaluation", () => {
  it("labels search as keyword-based and highlights matches", async () => {
    vi.mocked(api.search).mockResolvedValue({ search_type: "keyword", query: "microcontroller", title_matches: [], passages: [{ citation, coverage: 1 }] });
    renderApp("/search");
    await userEvent.type(screen.getByLabelText("Search query"), "microcontroller");
    await userEvent.click(screen.getByRole("button", { name: /Search$/ }));
    expect(await screen.findByText(/Keyword search \(BM25\), not semantic/)).toBeInTheDocument();
    expect(document.querySelector("mark")?.textContent?.toLowerCase()).toBe("microcontroller");
  });

  it("runs the evaluation and shows pass/fail per case", async () => {
    const base = { answerable: true, status: "answered", retrieved: [{ filename: "s.pdf", page: 2, chunk_id: 1 }], expected_facts: ["ESP32"], expected_pages: [2], retrieval_hit: true, citation_valid: true, fact_coverage: 1, abstention_correct: true };
    vi.mocked(api.runEvaluation).mockResolvedValue({
      settings: { min_coverage: 0.5, top_k: 5 },
      metrics: { cases: 2, pass_rate: 0.5, retrieval_hit_rate: 1, citation_validity_rate: 1, mean_fact_coverage: 1, abstention_accuracy: 0.5, correct_abstention_rate: 0 },
      results: [{ id: "a", question: "Which chip?", passed: true, ...base }, { id: "b", question: "Capital of France?", passed: false, ...base, answerable: false, expected_facts: [], expected_pages: [], retrieval_hit: null, abstention_correct: false }],
    });
    renderApp("/evaluation");
    await userEvent.click(screen.getByRole("button", { name: /Run evaluation/ }));
    expect(await screen.findByText("PASS")).toBeInTheDocument();
    expect(screen.getByText("FAIL")).toBeInTheDocument();
    expect(screen.getByText(/no LLM judge/i)).toBeInTheDocument();
  });
});
