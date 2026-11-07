import { FileText, FolderOpen, MessageSquare, Upload } from "lucide-react";
import { Link } from "react-router-dom";
import { useFetch } from "../hooks/useFetch";
import { api } from "../services/api";
import { EmptyState, ErrorBox, PageHeader, Skeleton, StatusBadge, formatDate } from "../components/ui";

export default function Dashboard() {
  const stats = useFetch(api.stats);
  const docs = useFetch(() => api.listDocuments({ page_size: 5 }));
  const convs = useFetch(api.conversations);
  const health = useFetch(api.health);

  if (stats.error) return <ErrorBox message={stats.error} onRetry={stats.reload} />;
  const empty = stats.data && stats.data.documents === 0;

  const tiles = [
    { label: "Indexed documents", value: (stats.data?.documents_by_status.indexed ?? 0) + (stats.data?.documents_by_status.partially_extracted ?? 0), icon: FileText },
    { label: "Research collections", value: stats.data?.collections, icon: FolderOpen },
    { label: "Conversations", value: stats.data?.conversations, icon: MessageSquare },
  ];

  return (
    <>
      <PageHeader title="Welcome to PaperTrail AI" subtitle="Ask questions about your PDFs and verify every answer against its source."
        actions={<Link to="/documents" className="inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg glow"><Upload className="h-4 w-4" aria-hidden />Upload document</Link>} />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {tiles.map(({ label, value, icon: Icon }) => (
          <div key={label} className="card p-4">
            <div className="flex items-center gap-2 text-sm text-muted"><Icon className="h-4 w-4" aria-hidden />{label}</div>
            <div className="mt-2 text-3xl font-semibold">{stats.loading ? <Skeleton className="h-8 w-12" /> : value}</div>
          </div>
        ))}
      </div>

      {empty ? (
        <EmptyState icon={<FileText className="h-10 w-10" />} title="Your library is empty">
          Upload a text-based PDF to get started. Try <code>sample_data/sample_paper.pdf</code> from the project folder.
          <div className="mt-4"><Link to="/documents" className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg glow">Upload your first PDF</Link></div>
        </EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="card p-4" aria-labelledby="recent-docs">
            <h2 id="recent-docs" className="mb-3 font-semibold">Recent documents</h2>
            {docs.loading ? <Skeleton className="h-20" /> : (
              <ul className="space-y-2">
                {docs.data?.items.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate">{d.title}</span><span className="flex items-center gap-2 shrink-0 text-muted">{formatDate(d.created_at)}<StatusBadge status={d.status} /></span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="card p-4" aria-labelledby="recent-q">
            <h2 id="recent-q" className="mb-3 font-semibold">Recent research</h2>
            {convs.loading ? <Skeleton className="h-20" /> : convs.data?.length ? (
              <ul className="space-y-2">
                {convs.data.slice(0, 5).map((c) => (
                  <li key={c.id} className="text-sm"><Link className="hover:text-accent-strong" to={`/chat?conversation=${c.id}`}>{c.title}</Link></li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">No questions asked yet. Open AI Research Chat to start.</p>}
          </section>
          <section className="card p-4 lg:col-span-2" aria-labelledby="proc">
            <h2 id="proc" className="mb-3 font-semibold">Document processing</h2>
            <div className="flex flex-wrap gap-2 text-sm">
              {Object.entries(stats.data?.documents_by_status ?? {}).map(([k, v]) => <span key={k} className="flex items-center gap-1.5"><StatusBadge status={k} /> {v}</span>)}
            </div>
          </section>
        </div>
      )}

      <section className="card mt-4 p-4 text-sm" aria-labelledby="modes">
        <h2 id="modes" className="mb-2 font-semibold">Active modes</h2>
        <p className="text-muted">
          Retrieval: <strong className="text-ink">{health.data?.retrieval_mode ?? "…"}</strong>, which matches the words in your question against your documents.
          It is keyword search, not semantic search. AI: <strong className="text-ink">{health.data?.ai_provider ?? "none configured"}</strong>.
          {health.data?.ai_provider ? "AI answers are written from the retrieved passages and must cite them; if the AI is unavailable you get the matching passages instead." : "In retrieval-only mode no AI model writes answers; you get the matching passages with page citations."}
        </p>
      </section>
    </>
  );
}
