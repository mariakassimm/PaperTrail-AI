import { Copy, Loader2, MessageSquare, Plus, Send, Square, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CitationList } from "../components/Citations";
import { EvidencePanel } from "../components/EvidencePanel";
import { useToast } from "../components/Toast";
import { Button, EmptyState, ErrorBox, PageHeader, Pill, inputCls } from "../components/ui";
import { useFetch } from "../hooks/useFetch";
import { api } from "../services/api";
import type { Message } from "../types";

export default function Chat() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [conversationId, setConversationId] = useState<number | null>(params.get("conversation") ? Number(params.get("conversation")) : null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [collection, setCollection] = useState(params.get("collection") ?? "");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [writingId, setWritingId] = useState<number | null>(null); // message whose AI answer is being written
  const [error, setError] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<{ chunkId: number; query: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const justCreated = useRef<number | null>(null); // id we created ourselves; its messages are already on screen

  const convs = useFetch(api.conversations);
  const collections = useFetch(api.collections);
  const stats = useFetch(api.stats);
  const health = useFetch(api.health);
  const suggestions = useFetch(() => api.suggestions(collection ? Number(collection) : undefined), [collection]);

  useEffect(() => {
    if (conversationId === null) { setMessages([]); return; }
    if (justCreated.current === conversationId) { justCreated.current = null; return; }
    api.conversation(conversationId)
      .then((c) => { setMessages(c.messages); setCollection(c.collection_id ? String(c.collection_id) : ""); })
      .catch((e: unknown) => { setError(e instanceof Error ? e.message : "Could not load conversation."); });
  }, [conversationId]);
  useEffect(() => { bottom.current?.scrollIntoView?.({ block: "end" }); }, [messages, sending]);

  async function send(override?: string) {
    const question = (override ?? input).trim();
    if (!question || sending) return;
    setError(null); setSending(true); setInput("");
    setMessages((m) => [...m, { id: -Date.now(), role: "user", content: question, meta: null, created_at: new Date().toISOString() }]);
    abort.current = new AbortController();
    try {
      // Evidence first: the passages come back immediately; the AI answer is requested next, in the background.
      const res = await api.ask({ question, collection_id: collection ? Number(collection) : undefined,
        conversation_id: conversationId ?? undefined, defer_ai: true }, abort.current.signal);
      const id = res.message_id ?? -Date.now() - 1;
      setMessages((m) => [...m, { id, role: "assistant", content: res.answer, created_at: new Date().toISOString(),
        meta: { status: res.status, mode: res.mode, citations: res.citations, provider: res.provider, notice: res.notice,
          ai_pending: res.ai_pending, cached: res.cached } }]);
      if (conversationId === null) { justCreated.current = res.conversation_id; setConversationId(res.conversation_id); setParams({}); }
      convs.reload();
      if (res.ai_pending && res.message_id) await writeAnswer(res.message_id);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") toast("info", "Request cancelled.");
      else setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally { setSending(false); abort.current = null; }
  }

  /** Ask the server to write the AI answer for passages already on screen. On failure the passages stay and can be retried. */
  async function writeAnswer(messageId: number) {
    setWritingId(messageId);
    abort.current = new AbortController();
    try {
      const res = await api.generateAnswer(messageId, abort.current.signal);
      setMessages((m) => m.map((x) => (x.id === messageId ? { ...x, content: res.answer,
        meta: { status: res.status, mode: res.mode, citations: res.citations, provider: res.provider, notice: res.notice,
          ai_pending: res.ai_pending, cached: res.cached } } : x)));
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") toast("info", "Stopped waiting. The passages are still here; press \"Write AI answer\" to try again.");
      else toast("error", e instanceof Error ? e.message : "The AI answer could not be written.");
    } finally { setWritingId(null); }
  }

  async function retryWriting(messageId: number) {
    if (sending) return;
    setSending(true);
    try { await writeAnswer(messageId); } finally { setSending(false); abort.current = null; }
  }

  async function remove() {
    if (conversationId === null) return;
    try { await api.deleteConversation(conversationId); setConversationId(null); setMessages([]); convs.reload(); toast("success", "Conversation deleted."); }
    catch (e) { toast("error", e instanceof Error ? e.message : "Could not delete."); }
  }

  const scopeName = collection ? collections.data?.find((c) => String(c.id) === collection)?.name ?? "selected collection" : "all documents";
  const noDocs = stats.data?.documents === 0;
  const aiOn = Boolean(health.data?.ai_provider) && health.data?.ai_enabled !== false;

  return (
    <>
      <PageHeader title="AI Research Chat" subtitle="Answers come only from your documents, with citations you can open and check."
        actions={<div className="flex gap-2"><Button variant="ghost" onClick={() => { setConversationId(null); setMessages([]); setParams({}); }}><Plus className="h-4 w-4" />New</Button>
          {conversationId !== null && <Button variant="danger" onClick={() => void remove()}><Trash2 className="h-4 w-4" />Delete</Button>}</div>} />
      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        <aside className="card max-h-64 overflow-auto p-2 lg:max-h-[70vh]" aria-label="Conversations">
          {convs.data?.length ? convs.data.map((c) => (
            <button key={c.id} onClick={() => setConversationId(c.id)} aria-current={c.id === conversationId}
              className={`block w-full truncate rounded-md px-3 py-2 text-left text-sm ${c.id === conversationId ? "bg-surface2 glow" : "text-muted hover:bg-surface2"}`}>{c.title}</button>
          )) : <p className="p-3 text-sm text-muted">No conversations yet.</p>}
        </aside>

        <section className="card flex min-h-[60vh] flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3 text-sm">
            <label htmlFor="scope" className="text-muted">Searching:</label>
            <select id="scope" className={`${inputCls} !w-auto`} value={collection} onChange={(e) => setCollection(e.target.value)}>
              <option value="">All documents</option>
              {collections.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <Pill tone="muted">{aiOn ? `AI answers: ${health.data?.ai_provider}` : "Retrieval-only"} · {health.data?.retrieval_mode ?? "keyword (BM25)"}</Pill>
          </div>

          <div className="flex-1 space-y-4 overflow-auto p-4" aria-live="polite">
            {messages.length === 0 && !sending && (
              noDocs ? <EmptyState icon={<MessageSquare className="h-9 w-9" />} title="Upload a document first">Chat needs documents to search. Add a PDF from My Documents.</EmptyState>
                : <EmptyState icon={<MessageSquare className="h-9 w-9" />} title="Ask about your documents">
                    Searching {scopeName}. {health.data?.retrieval_mode?.startsWith("hybrid") ? "Hybrid search matches your words and their meaning." : "Keyword search finds passages that share words with your question, so use the terms your documents use."} {aiOn ? "An AI writes a cited answer from the passages it finds." : "No AI writes answers in this mode; you get the matching passages."}
                    {suggestions.data?.items.length ? (
                      <div className="mt-4 text-left">
                        <p className="mb-2 text-xs text-muted">Try one of these (picked from distinctive words in your documents):</p>
                        <div className="flex flex-wrap gap-2">{suggestions.data.items.map((s) => (
                          <button key={s.term} onClick={() => void send(s.question)} className="rounded-full border border-line bg-surface2 px-3 py-1 text-sm text-ink hover:border-accent">{s.question}</button>))}</div>
                      </div>) : null}
                  </EmptyState>
            )}
            {messages.map((m, i) => (
              <div key={m.id} className={m.role === "user" ? "ml-auto max-w-[85%] rounded-xl bg-accent px-4 py-2 text-sm text-accent-fg" : "max-w-full"}>
                {m.role === "user" ? m.content : (
                  <div className="card p-4 text-sm">
                    {m.meta?.status === "insufficient_evidence" ? (
                      <div className="rounded-lg border border-warn p-3"><strong className="text-warn">Not enough evidence.</strong> {m.content}</div>
                    ) : (
                      <>
                        <div className="mb-2">
                          {m.meta?.mode === "ai_generated"
                            ? <Pill>AI-generated · {m.meta.provider}</Pill>
                            : m.meta?.ai_pending ? <Pill tone="muted">Matching passages · AI answer pending</Pill>
                              : <Pill tone="muted">Matching passages · no AI wrote this</Pill>}
                        </div>
                        <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
                        {m.meta?.ai_pending && (writingId === m.id
                          ? <p className="mt-3 flex items-center gap-2 text-xs text-muted" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Writing a cited answer from these passages…</p>
                          : <Button variant="ghost" className="mt-3" disabled={sending} onClick={() => void retryWriting(m.id)}>Write AI answer</Button>)}
                      </>
                    )}
                    {m.meta?.notice && (
                      <p role="note" className={`mt-3 rounded-lg border p-2 text-xs ${m.meta.mode === "ai_generated" ? "border-line text-muted" : "border-warn text-warn"}`}>{m.meta.notice}</p>
                    )}
                    <CitationList citations={m.meta?.citations ?? []}
                      onOpen={(c) => setEvidence({ chunkId: c.chunk_id, query: messages[i - 1]?.content ?? "" })} />
                    <button className="mt-3 inline-flex items-center gap-1 text-xs text-muted hover:text-ink"
                      onClick={() => navigator.clipboard.writeText(m.content).then(() => toast("success", "Copied."), () => toast("error", "Copy failed."))}>
                      <Copy className="h-3.5 w-3.5" />Copy
                    </button>
                  </div>
                )}
              </div>
            ))}
            {sending && writingId === null && <p className="text-sm text-muted">Searching your documents…</p>}
            {error && <ErrorBox message={error} />}
            <div ref={bottom} />
          </div>

          <div className="flex gap-2 border-t border-line p-3">
            <input className={inputCls} placeholder="Ask a question about your documents…" aria-label="Your question" maxLength={1000}
              value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void send()} />
            {sending ? <Button variant="ghost" aria-label="Stop" onClick={() => abort.current?.abort()}><Square className="h-4 w-4" />Stop</Button>
              : <Button aria-label="Send" disabled={!input.trim()} onClick={() => void send()}><Send className="h-4 w-4" />Send</Button>}
          </div>
        </section>
      </div>
      {evidence && <EvidencePanel chunkId={evidence.chunkId} query={evidence.query} onClose={() => setEvidence(null)} />}
    </>
  );
}
