/** API mock with NO imports from the app, so vi.mock factories can load it without a circular import. */
import { vi } from "vitest";

export const health = { status: "ok", retrieval_mode: "keyword (BM25)", ai_provider: null, ai_mode: "retrieval_only" };
export const settings = { retrieval_mode: "keyword (BM25)", ai_provider: null, chunk_size: 900, chunk_overlap: 150, top_k: 5, min_term_coverage: 0.5, max_upload_mb: 20, ai_model: null, ai_configured: false, ai_config_error: null,
  ai_enabled: true, auto_embed: true, min_cosine: 0.62, embedding_provider: null, embedding_config_error: null, retrieval_modes: ["keyword"],
  defaults: { min_term_coverage: 0.5, min_cosine: 0.62 }, overridden: [] as string[], reindex_needed: false };
export const emptyStats = { documents: 0, documents_by_status: {}, collections: 0, conversations: 0, chunks: 0 };

type MockFn = ReturnType<typeof vi.fn>;

/** Reset every endpoint and re-apply harmless defaults (called before each test). */
export function applyDefaults(api: Record<string, MockFn>) {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.health.mockResolvedValue(health);
  api.stats.mockResolvedValue(emptyStats);
  api.settings.mockResolvedValue(settings);
  api.listDocuments.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 10 });
  api.collections.mockResolvedValue([]);
  api.conversations.mockResolvedValue([]);
  api.suggestions.mockResolvedValue({ items: [], note: "" });
  api.embeddingsStatus.mockResolvedValue({ enabled: false, provider: null, config_error: null, documents: {} });
  api.evalCases.mockResolvedValue({ builtin: [], custom: [] });
}

/** Factory used by vi.mock("../services/api"). */
export function makeApiMock() {
  class ApiError extends Error { constructor(m: string, public status: number, public code: string) { super(m); } }
  const names = ["health", "stats", "settings", "listDocuments", "upload", "patchDocument", "retry", "deleteDocument", "preview", "collections",
    "createCollection", "updateCollection", "deleteCollection", "ask", "conversations", "conversation", "deleteConversation", "search", "chunk", "runEvaluation", "testProvider", "authCheck", "updateSettings", "resetSettings", "reindex", "suggestions",
    "embeddingsStatus", "embedDocument", "testEmbeddings", "evalCases", "createEvalCase", "updateEvalCase", "deleteEvalCase", "generateAnswer"];
  const api = Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<string, MockFn>;
  applyDefaults(api);
  return { api, ApiError, API_BASE: "/api/v1", UNAUTHORIZED_EVENT: "papertrail:unauthorized", getToken: vi.fn(() => sessionStorage.getItem("t")),
    setToken: vi.fn((t: string) => sessionStorage.setItem("t", t)), clearToken: vi.fn(() => sessionStorage.removeItem("t")) };
}

