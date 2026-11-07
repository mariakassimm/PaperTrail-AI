import { Search as SearchIcon } from "lucide-react";
import { useState } from "react";
import { EvidencePanel } from "../components/EvidencePanel";
import { Button, EmptyState, ErrorBox, PageHeader, Pill, Skeleton, inputCls } from "../components/ui";
import { api } from "../services/api";
import type { SearchResponse } from "../types";
import { highlight } from "../utils";

export default function SearchPage() {
  const [q, setQ] = useState("");
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<number | null>(null);

  async function run() {
    if (!q.trim()) return;
    setLoading(true); setError(null);
    try { setResult(await api.search(q.trim())); }
    catch (e) { setError(e instanceof Error ? e.message : "Search failed."); }
    finally { setLoading(false); }
  }

  return (
    <>
      <PageHeader title="Search" subtitle="Find titles and passages across your library." />
      <div className="mb-4 flex gap-2">
        <input className={inputCls} placeholder="Search your documents…" aria-label="Search query" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void run()} />
        <Button busy={loading} onClick={() => void run()}><SearchIcon className="h-4 w-4" />Search</Button>
      </div>
      {error && <ErrorBox message={error} onRetry={() => void run()} />}
      {loading && <Skeleton className="h-24" />}
      {!loading && result && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2"><Pill tone="muted">{result.search_type === "keyword" ? "Keyword search (BM25), not semantic" : "Hybrid search (keyword + meaning)"}</Pill>{result.notice && <span role="note" className="text-xs text-warn">{result.notice}</span>}</div>
          {result.title_matches.length > 0 && (
            <section className="mb-4"><h2 className="mb-2 font-semibold">Documents</h2>
              <ul className="space-y-1 text-sm">{result.title_matches.map((d) => <li key={d.id}>{d.title} <span className="text-muted">({d.filename})</span></li>)}</ul></section>
          )}
          {result.passages.length === 0 && result.title_matches.length === 0 ? (
            <EmptyState icon={<SearchIcon className="h-9 w-9" />} title="No matches">Nothing in your library contains those words. Keyword search does not match synonyms.</EmptyState>
          ) : (
            <ul className="space-y-3">{result.passages.map(({ citation: c }) => (
              <li key={c.chunk_id}>
                <button onClick={() => setEvidence(c.chunk_id)} className="card w-full p-4 text-left hover:border-accent">
                  <div className="mb-1 text-xs text-muted"><span className="font-medium text-ink">{c.document_title}</span> · page {c.page_number}</div>
                  <p className="text-sm leading-relaxed">…{highlight(c.excerpt, result.query)}…</p>
                </button>
              </li>))}</ul>
          )}
        </>
      )}
      {evidence !== null && <EvidencePanel chunkId={evidence} query={q} onClose={() => setEvidence(null)} />}
    </>
  );
}
