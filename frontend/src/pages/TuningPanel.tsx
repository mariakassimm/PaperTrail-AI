import { useState } from "react";
import { useToast } from "../components/Toast";
import { Button, inputCls } from "../components/ui";
import { api } from "../services/api";
import type { AppSettings, SettingsPatch } from "../types";

type Form = Required<Pick<AppSettings, "chunk_size" | "chunk_overlap" | "top_k" | "min_term_coverage">> & {
  min_cosine: number; retrieval_mode: "keyword" | "hybrid"; ai_enabled: boolean; auto_embed: boolean };

const toForm = (s: AppSettings): Form => ({
  retrieval_mode: s.retrieval_mode.startsWith("hybrid") ? "hybrid" : "keyword", top_k: s.top_k, min_term_coverage: s.min_term_coverage,
  min_cosine: s.min_cosine ?? 0.62, chunk_size: s.chunk_size, chunk_overlap: s.chunk_overlap, ai_enabled: s.ai_enabled ?? true, auto_embed: s.auto_embed ?? true });

function Field({ id, label, help, children }: { id: string; label: string; help: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">{label}</label>
      {children}
      <p id={`${id}-help`} className="mt-1 text-xs text-muted">{help}</p>
    </div>
  );
}

export function TuningPanel({ settings, onChanged }: { settings: AppSettings; onChanged: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState<Form>(() => toForm(settings));
  const [busy, setBusy] = useState<"save" | "reset" | "reindex" | null>(null);
  const initial = toForm(settings);
  const changed = (Object.keys(form) as (keyof Form)[]).filter((k) => form[k] !== initial[k]);
  const hybridOk = settings.retrieval_modes?.includes("hybrid") ?? false;
  const overlapBad = form.chunk_overlap >= form.chunk_size;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const num = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, (e.target.value === "" ? NaN : Number(e.target.value)) as never);

  async function run<T>(kind: "save" | "reset" | "reindex", work: () => Promise<T>, ok: (r: T) => string) {
    setBusy(kind);
    try { const r = await work(); toast("success", ok(r)); onChanged(); }
    catch (e) { toast("error", e instanceof Error ? e.message : "Could not save settings."); }
    finally { setBusy(null); }
  }
  const save = () => {
    const patch: Record<string, unknown> = {};
    changed.forEach((k) => { patch[k] = form[k]; });
    void run("save", () => api.updateSettings(patch as SettingsPatch), () => "Settings saved.");
  };

  return (
    <section className="card mb-4 p-4" aria-labelledby="tuning">
      <h2 id="tuning" className="mb-1 font-semibold">Search and answer settings</h2>
      <p className="mb-4 text-sm text-muted">Saved in your local database and applied immediately. Keys and providers stay in <code>backend/.env</code> and cannot be changed here.</p>

      {settings.reindex_needed && (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warn p-3 text-sm">
          <span className="text-warn">Chunk settings changed. Existing documents still use the old chunking until you reindex.</span>
          <Button variant="ghost" busy={busy === "reindex"} onClick={() => void run("reindex", api.reindex, (r) => `Reindexed ${r.reindexed} document(s)${r.failed ? `, ${r.failed} failed` : ""}.`)}>Reindex all documents</Button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="mode" label="Retrieval mode" help={hybridOk ? "Hybrid combines keyword matching with meaning-based matching (embeddings)." : "Hybrid needs an embedding provider (see 'Semantic search' below)."}>
          <select id="mode" className={inputCls} aria-describedby="mode-help" value={form.retrieval_mode} onChange={(e) => set("retrieval_mode", e.target.value as Form["retrieval_mode"])}>
            <option value="keyword">Keyword (BM25)</option>
            <option value="hybrid" disabled={!hybridOk}>Hybrid (keyword + meaning){hybridOk ? "" : " (not available)"}</option>
          </select>
        </Field>
        <Field id="topk" label="Passages per question (top-k)" help="How many passages to retrieve and cite. 1 to 20.">
          <input id="topk" type="number" min={1} max={20} className={inputCls} aria-describedby="topk-help" value={Number.isNaN(form.top_k) ? "" : form.top_k} onChange={num("top_k")} />
        </Field>
        <Field id="cov" label="Minimum keyword coverage" help={`Share of your question's content words a passage must contain to count as evidence. Higher = stricter. Default ${String(settings.defaults?.min_term_coverage ?? 0.5)}.`}>
          <input id="cov" type="number" min={0} max={1} step={0.05} className={inputCls} aria-describedby="cov-help" value={Number.isNaN(form.min_term_coverage) ? "" : form.min_term_coverage} onChange={num("min_term_coverage")} />
        </Field>
        <Field id="cos" label="Minimum meaning similarity" help={`Hybrid only. Cosine similarity a passage needs to count as evidence. This default (${String(settings.defaults?.min_cosine ?? 0.62)}) is untuned: calibrate it in the Evaluation Lab.`}>
          <input id="cos" type="number" min={0} max={1} step={0.01} className={inputCls} aria-describedby="cos-help" value={Number.isNaN(form.min_cosine) ? "" : form.min_cosine} onChange={num("min_cosine")} />
        </Field>
        <Field id="csize" label="Chunk size (characters)" help="Changing this requires a reindex to take effect. 200 to 4000.">
          <input id="csize" type="number" min={200} max={4000} step={50} className={inputCls} aria-describedby="csize-help" value={Number.isNaN(form.chunk_size) ? "" : form.chunk_size} onChange={num("chunk_size")} />
        </Field>
        <Field id="cover" label="Chunk overlap (characters)" help="Characters shared between neighbouring chunks. Must be smaller than the chunk size.">
          <input id="cover" type="number" min={0} max={1000} step={10} className={inputCls} aria-describedby="cover-help" aria-invalid={overlapBad} value={Number.isNaN(form.chunk_overlap) ? "" : form.chunk_overlap} onChange={num("chunk_overlap")} />
        </Field>
      </div>
      {overlapBad && <p role="alert" className="mt-2 text-sm text-danger">Overlap must be smaller than the chunk size.</p>}

      <div className="mt-4 space-y-2 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.ai_enabled} disabled={!settings.ai_configured} onChange={(e) => set("ai_enabled", e.target.checked)} />
          Let the AI write answers {settings.ai_configured ? "" : "(no AI provider configured)"}<span className="text-xs text-muted">Turn off to save quota.</span></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.auto_embed} disabled={!hybridOk} onChange={(e) => set("auto_embed", e.target.checked)} />
          Build the meaning index automatically on upload {hybridOk ? "" : "(no embedding provider configured)"}</label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button busy={busy === "save"} disabled={!changed.length || overlapBad || Object.values(form).some((v) => typeof v === "number" && Number.isNaN(v))} onClick={save}>Save settings</Button>
        <Button variant="ghost" busy={busy === "reset"} disabled={!(settings.overridden?.length)} onClick={() => void run("reset", api.resetSettings, () => "Settings reset to defaults.")}>Reset to defaults</Button>
        {changed.length > 0 && <span className="self-center text-xs text-muted">{changed.length} unsaved change{changed.length > 1 ? "s" : ""}</span>}
      </div>
    </section>
  );
}
