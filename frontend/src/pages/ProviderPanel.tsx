import { useState } from "react";
import { Button, Pill } from "../components/ui";
import { api } from "../services/api";
import type { AppSettings, ProviderTest } from "../types";

export function ProviderPanel({ settings }: { settings: AppSettings }) {
  const [result, setResult] = useState<ProviderTest | null>(null);
  const [busy, setBusy] = useState(false);

  async function test() {
    setBusy(true);
    try { setResult(await api.testProvider()); }
    catch (e) { setResult({ ok: false, configured: false, provider: null, message: e instanceof Error ? e.message : "Test failed." }); }
    finally { setBusy(false); }
  }

  return (
    <section className="card mb-4 p-4" aria-labelledby="ai">
      <h2 id="ai" className="mb-1 font-semibold">AI answer generation (optional)</h2>
      <p className="mb-3 text-sm text-muted">Without a provider the app runs in retrieval-only mode and sends nothing anywhere. Add a free provider key to have an AI write cited answers from your retrieved passages.</p>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        {settings.ai_configured ? <Pill>Active: {settings.ai_provider} · {settings.ai_model}</Pill> : <Pill tone="muted">Not configured: retrieval-only</Pill>}
        {settings.ai_config_error && <span role="alert" className="text-warn">{settings.ai_config_error}</span>}
      </div>
      <Button variant="ghost" busy={busy} onClick={() => void test()}>Test connection</Button>
      {result && <p role="status" className={`mt-2 text-sm ${result.ok ? "text-ok" : "text-danger"}`}>{result.ok ? "✓ " : "✗ "}{result.message}</p>}

      <details className="mt-4 text-sm text-muted">
        <summary className="cursor-pointer text-ink">How to set up Google Gemini (free tier)</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Check that your country is on Google's supported-regions list, then create a key at <code>aistudio.google.com/apikey</code> (Google says no billing is needed for the free tier).</li>
          <li>In <code>backend\.env</code> add <code>PAPERTRAIL_AI_PROVIDER=gemini</code> and <code>PAPERTRAIL_GEMINI_API_KEY=your-key</code>. Never put the key in the frontend or commit it.</li>
          <li>If Google has renamed models, set <code>PAPERTRAIL_GEMINI_MODEL</code> to a current model name from Google's docs.</li>
          <li>Restart the backend and press "Test connection".</li>
        </ol>
        <p className="mt-2">Limits are per project and shown in Google AI Studio; they can change and are not guaranteed. When the quota runs out, answers fall back to matching passages automatically. See <code>docs/providers.md</code>.</p>
      </details>
      <p className="mt-3 text-xs text-muted">Privacy: with an AI provider on, the retrieved passages and your question are sent to that provider. Google's docs say paid-tier prompts are not used to improve its products, which implies free-tier content may be, so avoid sending confidential documents on a free tier.</p>
    </section>
  );
}
