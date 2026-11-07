import { BarChart3, Check } from "lucide-react";
import { Link } from "react-router-dom";
import { Button, ErrorBox, PageHeader, Skeleton } from "../components/ui";
import { useFetch } from "../hooks/useFetch";
import { THEMES, useTheme } from "../hooks/useTheme";
import { api } from "../services/api";
import { EmbeddingsPanel } from "./EmbeddingsPanel";
import { ProviderPanel } from "./ProviderPanel";
import { TuningPanel } from "./TuningPanel";

export default function SettingsPage() {
  const { theme, setTheme, reset } = useTheme();
  const { data, error, loading, reload } = useFetch(api.settings);
  const rows: [string, string | number][] = data ? [
    ["Retrieval mode", data.retrieval_mode], ["Embeddings", data.embedding_provider ?? "none (keyword only)"], ["AI provider", data.ai_provider ? `${data.ai_provider} (${data.ai_model})` : "none (retrieval-only)"],
    ["Chunk size (characters)", data.chunk_size], ["Chunk overlap (characters)", data.chunk_overlap],
    ["Passages per question (top-k)", data.top_k], ["Min. term coverage", data.min_term_coverage], ["Max upload (MB)", data.max_upload_mb],
  ] : [];

  return (
    <>
      <PageHeader title="Settings" />
      <section className="card mb-4 p-4" aria-labelledby="appearance">
        <h2 id="appearance" className="mb-3 font-semibold">Appearance</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {THEMES.map((t) => (
            <button key={t.id} onClick={() => setTheme(t.id)} aria-pressed={theme === t.id}
              className={`rounded-xl border p-4 text-left transition ${theme === t.id ? "border-accent glow" : "border-line hover:border-accent"}`}>
              <div data-theme={t.id} className="mb-2 flex h-10 overflow-hidden rounded-md border border-line">
                <span className="flex-1" style={{ background: "var(--bg)" }} /><span className="flex-1" style={{ background: "var(--surface-2)" }} /><span className="flex-1" style={{ background: "var(--accent)" }} />
              </div>
              <span className="flex items-center gap-1 text-sm font-medium">{theme === t.id && <Check className="h-4 w-4" aria-hidden />}{t.label}</span>
            </button>
          ))}
        </div>
        <div className="mt-3"><Button variant="ghost" onClick={reset}>Reset appearance to default</Button></div>
      </section>

      {data && <TuningPanel key={JSON.stringify([data.top_k, data.min_term_coverage, data.min_cosine, data.chunk_size, data.chunk_overlap, data.retrieval_mode, data.ai_enabled, data.auto_embed, data.reindex_needed])} settings={data} onChanged={reload} />}
      {data && <EmbeddingsPanel settings={data} />}
      {data && <ProviderPanel settings={data} />}

      <section className="card mb-4 p-4" aria-labelledby="backend">
        <h2 id="backend" className="mb-1 font-semibold">Current configuration</h2>
        <p className="mb-3 text-sm text-muted">Effective values after your saved settings. Keys and providers come from <code>PAPERTRAIL_*</code> variables in <code>backend/.env</code>; edit that file and restart the backend to change them.</p>
        {error ? <ErrorBox message={error} onRetry={reload} /> : loading ? <Skeleton className="h-24" /> : (
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">{rows.map(([k, v]) => <div key={k} className="flex justify-between gap-3 border-b border-line py-1"><dt className="text-muted">{k}</dt><dd>{v}</dd></div>)}</dl>
        )}
      </section>

      <section className="card mb-4 p-4 text-sm" aria-labelledby="advanced">
        <h2 id="advanced" className="mb-1 font-semibold">Advanced</h2>
        <p className="mb-3 text-muted">Tools for checking and tuning search quality. You don't need them for everyday use.</p>
        <Link to="/evaluation" className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface2 px-3.5 py-2 font-medium hover:border-accent">
          <BarChart3 className="h-4 w-4" aria-hidden />Open Evaluation Lab</Link>
      </section>

      <section className="card p-4 text-sm text-muted" aria-labelledby="privacy">
        <h2 id="privacy" className="mb-2 font-semibold text-ink">Privacy and data storage</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Uploaded PDFs, extracted text and conversations are stored on the machine running the backend (SQLite database and an uploads folder).</li>
          <li>In retrieval-only mode nothing leaves your machine. No external service is called.</li>
          <li>If you enable an AI provider, your question and the retrieved passages are sent to it. API keys stay on the backend and are never returned to the browser.</li>
          <li>This is a single-user app with no login. Do not expose the backend to the internet.</li>
          <li>Your theme choice is stored in this browser only.</li>
        </ul>
      </section>
    </>
  );
}
