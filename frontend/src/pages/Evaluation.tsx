import { Download, Play } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useToast } from "../components/Toast";
import { Button, EmptyState, ErrorBox, PageHeader } from "../components/ui";
import { api } from "../services/api";
import { useFetch } from "../hooks/useFetch";
import type { EvalCase, EvalMetrics, EvalOptions, EvalReport } from "../types";
import { CasesManager } from "./CasesManager";

const COMPARE_COVERAGE = [0, 0.25, 0.5, 0.75, 1];
const COMPARE_COSINE = [0.5, 0.6, 0.7, 0.8, 0.9];
const pct = (v: number | null) => (v === null ? "n/a" : `${Math.round(v * 100)}%`);

export function resultsToCsv(results: EvalCase[]): string {
  const esc = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
  const rows = results.map((r) => [r.id, r.question, r.answerable, r.status, r.expected_pages.join("|"),
    r.retrieved.map((x) => `${x.filename}:p${x.page}`).join("|"), r.retrieval_hit ?? "", r.citation_valid,
    r.fact_coverage ?? "", r.abstention_correct, r.passed ? "pass" : "fail"].map(esc).join(","));
  return ["id,question,answerable,status,expected_pages,retrieved,retrieval_hit,citation_valid,fact_coverage,abstention_correct,result", ...rows].join("\n");
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

const METRIC_DEFS: [keyof EvalMetrics, string, string][] = [
  ["pass_rate", "Pass rate", "Cases where every applicable check below succeeded."],
  ["retrieval_hit_rate", "Retrieval hit rate", "Answerable cases where an expected (file, page) was among the retrieved passages."],
  ["citation_validity_rate", "Citation validity", "Citations whose excerpt is an exact substring of the stored chunk they point to."],
  ["mean_fact_coverage", "Fact coverage", "Share of expected facts found in the cited passages' text (case-insensitive substring match)."],
  ["correct_abstention_rate", "Correct abstention", "Unanswerable questions where the system declined to answer."],
];

interface Row { label: string; report: EvalReport }

export default function Evaluation() {
  const toast = useToast();
  const [target, setTarget] = useState<"sample" | "library">("sample");
  const [report, setReport] = useState<EvalReport | null>(null);
  const [comparison, setComparison] = useState<Row[]>([]);
  const [busy, setBusy] = useState<"run" | "compare" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cases = useFetch(api.evalCases);
  const health = useFetch(api.health);
  const hybridOk = Boolean(health.data?.semantic);

  const switchTarget = (t: "sample" | "library") => { setTarget(t); setReport(null); setComparison([]); setError(null); };

  async function run() {
    setBusy("run"); setError(null);
    try { setReport(await api.runEvaluation({ target })); }
    catch (e) { setError(e instanceof Error ? e.message : "Evaluation failed."); }
    finally { setBusy(null); }
  }

  async function compare() {
    setBusy("compare"); setError(null);
    try {
      const rows: Row[] = [];
      const go = async (label: string, opts: EvalOptions) => rows.push({ label, report: await api.runEvaluation({ target, ...opts }) });
      for (const c of COMPARE_COVERAGE) await go(`keyword, min coverage ${c}`, { mode: "keyword", min_coverage: c });
      if (target === "library" && hybridOk) for (const c of COMPARE_COSINE) await go(`hybrid, min similarity ${c}`, { mode: "hybrid", min_cosine: c });
      setComparison(rows);
    } catch (e) { setError(e instanceof Error ? e.message : "Comparison failed."); }
    finally { setBusy(null); }
  }

  return (
    <>
      <Link to="/settings" className="mb-3 inline-block text-sm text-muted hover:text-ink">← Back to Settings</Link>
      <PageHeader title="Evaluation Lab" subtitle="Deterministic retrieval checks. Keyword mode needs no API key or network."
        actions={<div className="flex gap-2">
          <Button busy={busy === "run"} disabled={target === "library" && !(cases.data?.custom.length)} onClick={() => void run()}><Play className="h-4 w-4" />Run evaluation</Button>
          <Button variant="ghost" busy={busy === "compare"} disabled={target === "library" && !(cases.data?.custom.length)} onClick={() => void compare()}>Compare thresholds</Button></div>} />
      <div role="tablist" aria-label="Evaluation target" className="mb-4 inline-flex gap-1 rounded-lg border border-line bg-surface2 p-1">
        {([["sample", "Built-in sample"], ["library", "My library cases"]] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={target === id} onClick={() => switchTarget(id)}
            className={`rounded-md px-3 py-1.5 text-sm ${target === id ? "bg-accent text-accent-fg" : "text-muted hover:text-ink"}`}>{label}</button>))}
      </div>
      <p className="mb-4 rounded-lg border border-line bg-surface2 p-3 text-sm text-muted">
        All metrics are computed objectively by string and page matching. There is no LLM judge. {target === "sample"
          ? "The built-in set is 7 hand-written cases on one fictional 3-page document, so treat scores as a regression check, not a measure of real-world accuracy. It runs on a temporary copy and never touches your documents."
          : "Your cases run against your real library using your current settings (read-only: nothing is saved). In hybrid mode each case sends one question to your embedding provider."}
      </p>
      {target === "library" && <CasesManager cases={cases.data?.custom ?? []} onChanged={cases.reload} />}
      {error && <ErrorBox message={error} />}
      {!report && !comparison.length && !error && (target === "sample" || Boolean(cases.data?.custom.length)) && (
        <EmptyState icon={<Play className="h-9 w-9" />} title="No results yet">Press "Run evaluation" to score the retrieval pipeline.</EmptyState>
      )}

      {report && (
        <section aria-labelledby="eval-res">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 id="eval-res" className="font-semibold">Results ({report.settings.mode ?? "keyword"}, min term coverage {report.settings.min_coverage}{report.settings.mode === "hybrid" ? `, min similarity ${report.settings.min_cosine}` : ""}, top-{report.settings.top_k})</h2>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => download("evaluation.json", JSON.stringify(report, null, 2), "application/json")}><Download className="h-4 w-4" />JSON</Button>
              <Button variant="ghost" onClick={() => { download("evaluation.csv", resultsToCsv(report.results), "text/csv"); toast("success", "CSV exported."); }}><Download className="h-4 w-4" />CSV</Button>
            </div>
          </div>
          <dl className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {METRIC_DEFS.map(([key, label, def]) => (
              <div key={key} className="card p-3" title={def}><dt className="text-xs text-muted">{label}</dt><dd className="text-2xl font-semibold">{pct(report.metrics[key] as number | null)}</dd></div>
            ))}
          </dl>
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="border-b border-line text-xs uppercase text-muted"><tr>
                <th className="p-3">Case</th><th className="p-3">Expected</th><th className="p-3">Retrieved</th><th className="p-3">Outcome</th><th className="p-3">Result</th></tr></thead>
              <tbody>{report.results.map((r) => (
                <tr key={r.id} className="border-b border-line align-top last:border-0">
                  <td className="p-3"><div className="font-medium">{r.question}</div><div className="text-xs text-muted">{r.id}</div></td>
                  <td className="p-3 text-xs text-muted">{r.answerable ? <>pages {r.expected_pages.join(", ")}<br />facts: {r.expected_facts.join(", ")}</> : "abstain (no evidence)"}</td>
                  <td className="p-3 text-xs text-muted">{r.retrieved.length ? r.retrieved.map((x) => `p${x.page}`).join(", ") : "none"}</td>
                  <td className="p-3 text-xs">{r.status.replace("_", " ")}{r.answerable && <><br />citations valid: {String(r.citation_valid)}<br />facts: {pct(r.fact_coverage)}</>}</td>
                  <td className={`p-3 font-semibold ${r.passed ? "text-ok" : "text-danger"}`}>{r.passed ? "PASS" : "FAIL"}</td>
                </tr>))}</tbody>
            </table>
          </div>
        </section>
      )}

      {comparison.length > 0 && (
        <section className="mt-6" aria-labelledby="cmp">
          <h2 id="cmp" className="mb-1 font-semibold">Threshold comparison</h2>
          <p className="mb-3 text-sm text-muted">A low threshold retrieves more but answers questions it should refuse; a high one refuses more, including answerable ones. Pick the setting that balances hit rate and correct abstention on your own cases.</p>
          <div className="card overflow-x-auto"><table className="w-full min-w-[34rem] text-left text-sm">
            <thead className="border-b border-line text-xs uppercase text-muted"><tr><th className="p-3">Setting</th><th className="p-3">Pass rate</th><th className="p-3">Retrieval hit</th><th className="p-3">Fact coverage</th><th className="p-3">Correct abstention</th></tr></thead>
            <tbody>{comparison.map(({ label, report: c }) => (
              <tr key={label} className="border-b border-line last:border-0">
                <td className="p-3">{label}</td><td className="p-3">{pct(c.metrics.pass_rate)}</td><td className="p-3">{pct(c.metrics.retrieval_hit_rate)}</td>
                <td className="p-3">{pct(c.metrics.mean_fact_coverage)}</td><td className="p-3">{pct(c.metrics.correct_abstention_rate)}</td></tr>))}</tbody></table></div>
        </section>
      )}
      <section className="mt-6 text-sm text-muted" aria-labelledby="defs">
        <h2 id="defs" className="mb-2 font-semibold text-ink">Metric definitions</h2>
        <ul className="list-disc space-y-1 pl-5">{METRIC_DEFS.map(([k, l, d]) => <li key={k}><strong className="text-ink">{l}:</strong> {d}</li>)}</ul>
      </section>
    </>
  );
}
