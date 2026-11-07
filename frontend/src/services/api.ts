import type { AppSettings, AskResponse, ChunkDetail, Citation, Collection, ConversationDetail, Conversation, Doc,
  EmbeddingStatus, EvalCaseDef, EvalCaseInput, EvalOptions, EvalReport, Health, Paged, ProviderTest, SearchResponse,
  SettingsPatch, Stats, Suggestion } from "../types";

export const API_BASE: string = ((import.meta.env.VITE_API_BASE as string | undefined) || "/api/v1").replace(/\/+$/, "");

const TOKEN_KEY = "papertrail-token";
export const UNAUTHORIZED_EVENT = "papertrail:unauthorized";
// sessionStorage: the token is forgotten when the tab closes and is never sent anywhere except our API.
export const getToken = (): string | null => { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } };
export const setToken = (t: string) => { try { sessionStorage.setItem(TOKEN_KEY, t); } catch { /* ignore */ } };
export const clearToken = () => { try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } };

export class ApiError extends Error {
  constructor(message: string, public status: number, public code: string) { super(message); }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    const token = getToken();
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError("Cannot reach the PaperTrail backend. Is it running on port 8000?", 0, "network_error");
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && body?.error?.code === "unauthorized") window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    throw new ApiError(body?.error?.message ?? `Request failed (${res.status}).`, res.status, body?.error?.code ?? "error");
  }
  return body as T;
}

const json = (method: string, data: unknown): RequestInit => ({
  method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
});

export const api = {
  health: () => request<Health>("/health"),
  authCheck: () => request<{ ok: boolean }>("/auth/check"),
  stats: () => request<Stats>("/stats"),
  settings: () => request<AppSettings>("/settings"),
  testProvider: () => request<ProviderTest>("/provider/test", { method: "POST" }),
  listDocuments: (p: { q?: string; status?: string; collection_id?: number; sort?: string; page?: number; page_size?: number } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(p).forEach(([k, v]) => v !== undefined && v !== "" && qs.set(k, String(v)));
    return request<Paged<Doc>>(`/documents?${qs}`);
  },
  upload: (file: File) => { const f = new FormData(); f.append("file", file); return request<Doc>("/documents", { method: "POST", body: f }); },
  patchDocument: (id: number, body: { title?: string; collection_id?: number; clear_collection?: boolean }) =>
    request<Doc>(`/documents/${id}`, json("PATCH", body)),
  retry: (id: number) => request<Doc>(`/documents/${id}/retry`, { method: "POST" }),
  deleteDocument: (id: number) => request<void>(`/documents/${id}`, { method: "DELETE" }),
  preview: (id: number) => request<{ preview: string; truncated: boolean }>(`/documents/${id}/preview`),
  collections: () => request<Collection[]>("/collections"),
  createCollection: (name: string, description: string) => request<Collection>("/collections", json("POST", { name, description })),
  updateCollection: (id: number, name: string, description: string) => request<Collection>(`/collections/${id}`, json("PUT", { name, description })),
  deleteCollection: (id: number) => request<void>(`/collections/${id}`, { method: "DELETE" }),
  ask: (body: { question: string; collection_id?: number; conversation_id?: number; defer_ai?: boolean }, signal?: AbortSignal) =>
    request<AskResponse>("/ask", { ...json("POST", body), signal }),
  generateAnswer: (messageId: number, signal?: AbortSignal) =>
    request<AskResponse>(`/messages/${messageId}/generate`, { method: "POST", signal }),
  conversations: () => request<Conversation[]>("/conversations"),
  conversation: (id: number) => request<ConversationDetail>(`/conversations/${id}`),
  deleteConversation: (id: number) => request<void>(`/conversations/${id}`, { method: "DELETE" }),
  search: (q: string, collection_id?: number) =>
    request<SearchResponse>(`/search?q=${encodeURIComponent(q)}${collection_id ? `&collection_id=${collection_id}` : ""}`),
  chunk: (id: number) => request<ChunkDetail>(`/chunks/${id}`),
  runEvaluation: (opts: EvalOptions = {}) => request<EvalReport>("/evaluation/run", json("POST", opts)),
  updateSettings: (patch: SettingsPatch) => request<AppSettings>("/settings", json("PUT", patch)),
  resetSettings: () => request<AppSettings>("/settings", { method: "DELETE" }),
  reindex: () => request<{ reindexed: number; failed: number }>("/documents/reindex", { method: "POST" }),
  suggestions: (collection_id?: number) => request<{ items: Suggestion[]; note: string }>(`/suggestions${collection_id ? `?collection_id=${collection_id}` : ""}`),
  embeddingsStatus: () => request<EmbeddingStatus>("/embeddings/status"),
  embedDocument: (id: number) => request<{ added: number; embedded: number; total: number }>(`/documents/${id}/embed`, { method: "POST" }),
  testEmbeddings: () => request<ProviderTest>("/embeddings/test", { method: "POST" }),
  evalCases: () => request<{ builtin: EvalCaseDef[]; custom: EvalCaseDef[] }>("/evaluation/cases"),
  createEvalCase: (c: EvalCaseInput) => request<EvalCaseDef>("/evaluation/cases", json("POST", c)),
  updateEvalCase: (id: number, c: EvalCaseInput) => request<EvalCaseDef>(`/evaluation/cases/${id}`, json("PUT", c)),
  deleteEvalCase: (id: number) => request<void>(`/evaluation/cases/${id}`, { method: "DELETE" }),
};

export type { Citation };
