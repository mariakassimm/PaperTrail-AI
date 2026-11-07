import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useToast } from "../components/Toast";
import { Button, ConfirmDialog, Dialog, EmptyState, inputCls } from "../components/ui";
import { useFetch } from "../hooks/useFetch";
import { api } from "../services/api";
import type { EvalCaseDef, EvalCaseInput } from "../types";

const splitList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export function CasesManager({ cases, onChanged }: { cases: EvalCaseDef[]; onChanged: () => void }) {
  const toast = useToast();
  const [editing, setEditing] = useState<EvalCaseDef | "new" | null>(null);
  const [deleting, setDeleting] = useState<EvalCaseDef | null>(null);
  const docs = useFetch(() => api.listDocuments({ page_size: 100 }));
  const filenames = Array.from(new Set(docs.data?.items.map((d) => d.filename) ?? []));

  async function save(input: EvalCaseInput) {
    try {
      if (editing === "new") await api.createEvalCase(input); else if (editing) await api.updateEvalCase(editing.id, input);
      toast("success", "Case saved."); setEditing(null); onChanged();
    } catch (e) { toast("error", e instanceof Error ? e.message : "Could not save the case."); }
  }
  async function remove(c: EvalCaseDef) {
    try { await api.deleteEvalCase(c.id); toast("success", "Case deleted."); setDeleting(null); onChanged(); }
    catch (e) { toast("error", e instanceof Error ? e.message : "Could not delete the case."); }
  }

  return (
    <section className="mb-4" aria-labelledby="cases">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 id="cases" className="font-semibold">Your test cases ({cases.length})</h2>
        <Button variant="ghost" onClick={() => setEditing("new")}><Plus className="h-4 w-4" aria-hidden />Add case</Button>
      </div>
      {cases.length === 0 ? (
        <EmptyState icon={<Plus className="h-8 w-8" />} title="No cases yet">
          Write a question, say which file and page should answer it (or that it should be refused), and list facts the evidence must contain. Then run the evaluation against your own documents.
        </EmptyState>
      ) : (
        <ul className="space-y-2">{cases.map((c) => (
          <li key={c.id} className="card flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
            <div className="min-w-0">
              <div className="font-medium">{c.question}</div>
              <div className="text-xs text-muted">{c.answerable ? `expects ${c.expected_filename ?? "any file"}${c.expected_pages.length ? `, page ${c.expected_pages.join(", ")}` : ""}${c.expected_facts.length ? ` · facts: ${c.expected_facts.join(", ")}` : ""}` : "should be refused (no evidence in your documents)"}</div>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" aria-label={`Edit case: ${c.question}`} onClick={() => setEditing(c)}><Pencil className="h-4 w-4" /></Button>
              <Button variant="danger" aria-label={`Delete case: ${c.question}`} onClick={() => setDeleting(c)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          </li>))}</ul>
      )}
      {editing && <CaseForm initial={editing === "new" ? undefined : editing} filenames={filenames} onClose={() => setEditing(null)} onSave={save} />}
      {deleting && <ConfirmDialog title="Delete this case?" confirmLabel="Delete" message={`"${deleting.question}" will be removed from your evaluation set.`} onClose={() => setDeleting(null)} onConfirm={() => void remove(deleting)} />}
    </section>
  );
}

function CaseForm({ initial, filenames, onClose, onSave }: { initial?: EvalCaseDef; filenames: string[]; onClose: () => void; onSave: (c: EvalCaseInput) => Promise<void> }) {
  const [question, setQuestion] = useState(initial?.question ?? "");
  const [answerable, setAnswerable] = useState(initial?.answerable ?? true);
  const [facts, setFacts] = useState(initial?.expected_facts.join(", ") ?? "");
  const [filename, setFilename] = useState(initial?.expected_filename ?? "");
  const [pages, setPages] = useState(initial?.expected_pages.join(", ") ?? "");
  const [busy, setBusy] = useState(false);
  const pageNums = splitList(pages).map(Number);
  const pagesBad = pageNums.some((n) => !Number.isInteger(n) || n < 1);
  const needsFile = pageNums.length > 0 && !filename;
  const invalid = !question.trim() || pagesBad || (answerable && needsFile);

  return (
    <Dialog title={initial ? "Edit case" : "Add case"} onClose={onClose} wide>
      <label htmlFor="case-q" className="mb-1 block text-sm">Question</label>
      <textarea id="case-q" className={inputCls} rows={2} maxLength={1000} value={question} onChange={(e) => setQuestion(e.target.value)} />
      <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={answerable} onChange={(e) => setAnswerable(e.target.checked)} />This should be answerable from my documents <span className="text-xs text-muted">(untick to test that the app refuses)</span></label>
      {answerable && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><label htmlFor="case-f" className="mb-1 block text-sm">Facts the cited evidence must contain (comma-separated, optional)</label>
            <input id="case-f" className={inputCls} value={facts} onChange={(e) => setFacts(e.target.value)} placeholder="140 US dollars, 14 months" /></div>
          <div><label htmlFor="case-file" className="mb-1 block text-sm">Expected file (optional)</label>
            <select id="case-file" className={inputCls} value={filename} onChange={(e) => setFilename(e.target.value)}>
              <option value="">Any file</option>{filenames.map((f) => <option key={f} value={f}>{f}</option>)}</select></div>
          <div><label htmlFor="case-p" className="mb-1 block text-sm">Expected pages (comma-separated, optional)</label>
            <input id="case-p" className={inputCls} value={pages} aria-invalid={pagesBad || needsFile} onChange={(e) => setPages(e.target.value)} placeholder="2, 3" /></div>
        </div>
      )}
      {answerable && pagesBad && <p role="alert" className="mt-2 text-sm text-danger">Pages must be whole numbers starting at 1.</p>}
      {answerable && needsFile && !pagesBad && <p role="alert" className="mt-2 text-sm text-danger">Choose the expected file when you give page numbers.</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button busy={busy} disabled={invalid} onClick={async () => {
          setBusy(true);
          await onSave({ question: question.trim(), answerable, expected_facts: answerable ? splitList(facts) : [],
            expected_filename: answerable && filename ? filename : null, expected_pages: answerable ? pageNums : [] });
          setBusy(false);
        }}>Save case</Button>
      </div>
    </Dialog>
  );
}
