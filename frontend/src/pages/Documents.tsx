import { Eye, FileText, Pencil, RotateCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useToast } from "../components/Toast";
import { UploadZone } from "../components/UploadZone";
import { Button, ConfirmDialog, Dialog, EmptyState, ErrorBox, PageHeader, Pill, Skeleton, StatusBadge, formatBytes, formatDate, inputCls } from "../components/ui";
import { useFetch } from "../hooks/useFetch";
import { api } from "../services/api";
import type { Doc } from "../types";

const PAGE_SIZE = 10;

export default function Documents() {
  const toast = useToast();
  const [params] = useSearchParams();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("newest");
  const [collection, setCollection] = useState(params.get("collection") ?? "");
  const [page, setPage] = useState(1);
  const [renaming, setRenaming] = useState<Doc | null>(null);
  const [deleting, setDeleting] = useState<Doc | null>(null);
  const [previewing, setPreviewing] = useState<Doc | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => { const t = setTimeout(() => { setDebouncedQ(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);

  const settings = useFetch(api.settings);
  const collections = useFetch(api.collections);
  const emb = useFetch(api.embeddingsStatus);
  const docs = useFetch(() => api.listDocuments({ q: debouncedQ, status, sort, page, page_size: PAGE_SIZE,
    collection_id: collection ? Number(collection) : undefined }), [debouncedQ, status, sort, page, collection]);

  async function act(doc: Doc, work: () => Promise<unknown>, okMsg: string) {
    setBusy(doc.id);
    try { await work(); toast("success", okMsg); docs.reload(); collections.reload(); emb.reload(); }
    catch (e) { toast("error", e instanceof Error ? e.message : "Action failed."); }
    finally { setBusy(null); }
  }

  const totalPages = docs.data ? Math.max(1, Math.ceil(docs.data.total / PAGE_SIZE)) : 1;
  const filtered = Boolean(debouncedQ || status || collection);

  return (
    <>
      <PageHeader title="My Documents" subtitle="Upload, organise and manage the PDFs you can ask questions about." />
      <UploadZone maxMb={settings.data?.max_upload_mb ?? 20} onDone={() => { docs.reload(); collections.reload(); }} />

      <div className="my-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <input className={inputCls} placeholder="Search titles and text…" aria-label="Search documents" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={inputCls} aria-label="Filter by status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          {["indexed", "partially_extracted", "failed"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </select>
        <select className={inputCls} aria-label="Filter by collection" value={collection} onChange={(e) => { setCollection(e.target.value); setPage(1); }}>
          <option value="">All collections</option>
          {collections.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className={inputCls} aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="newest">Newest first</option><option value="oldest">Oldest first</option>
          <option value="title">Title A–Z</option><option value="size">Largest first</option>
        </select>
      </div>

      {docs.error ? <ErrorBox message={docs.error} onRetry={docs.reload} /> : docs.loading && !docs.data ? (
        <div className="space-y-3"><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
      ) : docs.data && docs.data.items.length === 0 ? (
        <EmptyState icon={<FileText className="h-10 w-10" />} title={filtered ? "No documents match your filters" : "No documents yet"}>
          {filtered ? "Try clearing the search or filters." : "Upload a PDF above to start building your library."}
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {docs.data?.items.map((d) => (
            <li key={d.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><h3 className="truncate font-medium">{d.title}</h3><StatusBadge status={d.status} />
                    {emb.data?.enabled && d.status !== "failed" && (() => { const c = emb.data.documents[String(d.id)]; if (!c) return null;
                      return <Pill tone={c.embedded === c.total ? "accent" : "muted"}>{c.embedded === c.total ? "meaning index ready" : c.embedded === 0 ? "keyword only" : `meaning index ${c.embedded}/${c.total}`}</Pill>; })()}</div>
                  <p className="mt-1 text-xs text-muted">{d.filename} · {formatBytes(d.size_bytes)} · {d.page_count} pages · {formatDate(d.created_at)}</p>
                  {d.status_message && <p className={`mt-1 text-xs ${d.status === "failed" ? "text-danger" : "text-warn"}`}>{d.status_message}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select className={`${inputCls} !w-auto`} aria-label={`Collection for ${d.title}`} value={d.collection_id ?? ""} disabled={busy === d.id}
                    onChange={(e) => void act(d, () => e.target.value ? api.patchDocument(d.id, { collection_id: Number(e.target.value) }) : api.patchDocument(d.id, { clear_collection: true }), "Collection updated.")}>
                    <option value="">No collection</option>
                    {collections.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  {emb.data?.enabled && d.status !== "failed" && (emb.data.documents[String(d.id)]?.embedded ?? 0) < (emb.data.documents[String(d.id)]?.total ?? 0) &&
                    <Button variant="ghost" aria-label={`Embed ${d.title}`} busy={busy === d.id} onClick={() => void act(d, () => api.embedDocument(d.id), "Meaning index updated.")}>Embed now</Button>}
                  <Button variant="ghost" aria-label={`Preview ${d.title}`} onClick={() => setPreviewing(d)} disabled={d.status === "failed"}><Eye className="h-4 w-4" /></Button>
                  <Button variant="ghost" aria-label={`Rename ${d.title}`} onClick={() => setRenaming(d)}><Pencil className="h-4 w-4" /></Button>
                  {d.status === "failed" && <Button variant="ghost" aria-label={`Retry ${d.title}`} busy={busy === d.id} onClick={() => void act(d, () => api.retry(d.id), "Reprocessed.")}><RotateCw className="h-4 w-4" /></Button>}
                  <Button variant="danger" aria-label={`Delete ${d.title}`} onClick={() => setDeleting(d)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {docs.data && docs.data.total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <Button variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="text-muted">Page {page} of {totalPages}</span>
          <Button variant="ghost" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}

      {renaming && <RenameDialog doc={renaming} onClose={() => setRenaming(null)}
        onSave={(title) => { const d = renaming; setRenaming(null); void act(d, () => api.patchDocument(d.id, { title }), "Title updated."); }} />}
      {deleting && <ConfirmDialog title="Delete document?" confirmLabel="Delete" onClose={() => setDeleting(null)}
        message={`"${deleting.title}" and all of its indexed text will be permanently removed. Citations pointing to it will stop working.`}
        onConfirm={() => { const d = deleting; setDeleting(null); void act(d, () => api.deleteDocument(d.id), "Document deleted."); }} />}
      {previewing && <PreviewDialog doc={previewing} onClose={() => setPreviewing(null)} />}
    </>
  );
}

function RenameDialog({ doc, onClose, onSave }: { doc: Doc; onClose: () => void; onSave: (t: string) => void }) {
  const [title, setTitle] = useState(doc.title);
  return (
    <Dialog title="Rename document" onClose={onClose}>
      <label className="mb-1 block text-sm" htmlFor="rename">Display title</label>
      <input id="rename" className={inputCls} value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={!title.trim()} onClick={() => onSave(title)}>Save</Button>
      </div>
    </Dialog>
  );
}

function PreviewDialog({ doc, onClose }: { doc: Doc; onClose: () => void }) {
  const { data, error, loading } = useFetch(() => api.preview(doc.id), [doc.id]);
  return (
    <Dialog title={`Extracted text: ${doc.title}`} onClose={onClose} wide>
      {loading && <Skeleton className="h-40" />}
      {error && <ErrorBox message={error} />}
      {data && <><pre className="whitespace-pre-wrap text-sm leading-relaxed">{data.preview || "No text."}</pre>
        {data.truncated && <p className="mt-2 text-xs text-muted">Preview truncated.</p>}</>}
    </Dialog>
  );
}
