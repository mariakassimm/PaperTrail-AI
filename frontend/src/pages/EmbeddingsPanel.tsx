import { useState } from "react";
import { Button, Pill } from "../components/ui";
import { api } from "../services/api";
import type { AppSettings, ProviderTest } from "../types";

export function EmbeddingsPanel({ settings }: { settings: AppSettings }) {
  const [result, setResult] = useState<ProviderTest | null>(null);
  const [busy, setBusy] = useState(false);
  async function test() {
    setBusy(true);
    try { setResult(await api.testEmbeddings()); }
    catch (e) { setResult({ ok: false, configured: false, provider: null, message: e instanceof Error ? e.message : "Test failed." }); }
    finally { setBusy(false); }
  }
  return (
    <section className="card mb-4 p-4" aria-labelledby="emb">
      <h2 id="emb" className="mb-1 font-semibold">Semantic search (optional)</h2>
      <p className="mb-3 text-sm text-muted">Keyword search cannot match different words with the same meaning ("price" vs "cost"). An embedding provider adds meaning-based matching. Each passage and question is sent to that provider to get a vector.</p>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        {settings.embedding_provider ? <Pill>Active: {settings.embedding_provider}</Pill> : <Pill tone="muted">Not configured: keyword search only</Pill>}
        {settings.embedding_config_error && <span role="alert" className="text-warn">{settings.embedding_config_error}</span>}
      </div>
      <Button variant="ghost" busy={busy} onClick={() => void test()}>Test embeddings</Button>
      {result && <p role="status" className={`mt-2 text-sm ${result.ok ? "text-ok" : "text-danger"}`}>{result.ok ? "✓ " : "✗ "}{result.message}</p>}
      <details className="mt-4 text-sm text-muted">
        <summary className="cursor-pointer text-ink">How to turn it on (Google Gemini embeddings)</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Use the same Gemini key as for AI answers. In <code>backend\.env</code> add <code>PAPERTRAIL_EMBEDDING_PROVIDER=gemini</code> (and <code>PAPERTRAIL_GEMINI_API_KEY</code> if not already set).</li>
          <li>The default model is <code>gemini-embedding-001</code>; change <code>PAPERTRAIL_EMBEDDING_MODEL</code> if Google renames it.</li>
          <li>Restart the backend, press "Test embeddings", then set Retrieval mode to Hybrid above.</li>
          <li>Documents uploaded before this need "Embed now" in My Documents (one-time).</li>
        </ol>
        <p className="mt-2">Free-tier embedding quotas are per project and not published as fixed numbers; if they run out, searches fall back to keyword automatically. See <code>docs/providers.md</code>.</p>
      </details>
    </section>
  );
}
