import { FolderOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useToast } from "../components/Toast";
import { Button, ConfirmDialog, Dialog, EmptyState, ErrorBox, PageHeader, Skeleton, inputCls } from "../components/ui";
import { useFetch } from "../hooks/useFetch";
import { api } from "../services/api";
import type { Collection } from "../types";

export default function Collections() {
  const toast = useToast();
  const { data, error, loading, reload } = useFetch(api.collections);
  const [editing, setEditing] = useState<Collection | "new" | null>(null);
  const [deleting, setDeleting] = useState<Collection | null>(null);

  async function save(name: string, description: string) {
    try {
      if (editing === "new") await api.createCollection(name, description);
      else if (editing) await api.updateCollection(editing.id, name, description);
      toast("success", "Collection saved.");
      setEditing(null); reload();
    } catch (e) { toast("error", e instanceof Error ? e.message : "Could not save."); }
  }

  async function remove(c: Collection) {
    try { await api.deleteCollection(c.id); toast("success", "Collection deleted. Its documents were kept."); setDeleting(null); reload(); }
    catch (e) { toast("error", e instanceof Error ? e.message : "Could not delete."); }
  }

  return (
    <>
      <PageHeader title="Research Collections" subtitle="Group documents so questions only search the material you choose."
        actions={<Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" aria-hidden />New collection</Button>} />
      {error ? <ErrorBox message={error} onRetry={reload} /> : loading ? <Skeleton className="h-28" /> : data?.length === 0 ? (
        <EmptyState icon={<FolderOpen className="h-10 w-10" />} title="No collections yet">
          Create a collection, then assign documents to it from My Documents. Documents without a collection are only searched when you choose "All documents".
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data?.map((c) => (
            <div key={c.id} className="card flex flex-col gap-2 p-4">
              <Link to={`/collections/${c.id}`} className="text-lg font-semibold hover:text-accent-strong">{c.name}</Link>
              <p className="flex-1 text-sm text-muted">{c.description || "No description."}</p>
              <p className="text-xs text-muted">{c.document_count} {c.document_count === 1 ? "document" : "documents"}</p>
              <div className="flex gap-2">
                <Link to={`/chat?collection=${c.id}`} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg">Ask</Link>
                <Button variant="ghost" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}><Pencil className="h-4 w-4" /></Button>
                <Button variant="danger" aria-label={`Delete ${c.name}`} onClick={() => setDeleting(c)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && <CollectionForm initial={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} onSave={save} />}
      {deleting && <ConfirmDialog title="Delete collection?" confirmLabel="Delete" onClose={() => setDeleting(null)}
        message={`"${deleting.name}" will be removed. Its ${deleting.document_count} document(s) are kept and become unassigned.`}
        onConfirm={() => void remove(deleting)} />}
    </>
  );
}

function CollectionForm({ initial, onClose, onSave }: { initial?: Collection; onClose: () => void; onSave: (n: string, d: string) => Promise<void> }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={initial ? "Edit collection" : "New collection"} onClose={onClose}>
      <label className="mb-1 block text-sm" htmlFor="col-name">Name</label>
      <input id="col-name" className={inputCls} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
      <label className="mb-1 mt-3 block text-sm" htmlFor="col-desc">Description (optional)</label>
      <textarea id="col-desc" className={inputCls} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button busy={busy} disabled={!name.trim()} onClick={async () => { setBusy(true); await onSave(name.trim(), description); setBusy(false); }}>Save</Button>
      </div>
    </Dialog>
  );
}
