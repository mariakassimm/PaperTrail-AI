import { Link, useParams } from "react-router-dom";
import { EmptyState, ErrorBox, PageHeader, Skeleton, StatusBadge } from "../components/ui";
import { useFetch } from "../hooks/useFetch";
import { api } from "../services/api";

export default function CollectionDetail() {
  const id = Number(useParams().id);
  const cols = useFetch(api.collections);
  const docs = useFetch(() => api.listDocuments({ collection_id: id, page_size: 100 }), [id]);
  const convs = useFetch(api.conversations);
  const collection = cols.data?.find((c) => c.id === id);

  if (cols.error) return <ErrorBox message={cols.error} onRetry={cols.reload} />;
  if (cols.data && !collection) return <EmptyState icon={null} title="Collection not found">It may have been deleted. <Link className="text-accent-strong" to="/collections">Back to collections</Link></EmptyState>;
  const history = convs.data?.filter((c) => c.collection_id === id) ?? [];

  return (
    <>
      <PageHeader title={collection?.name ?? "Collection"} subtitle={collection?.description}
        actions={<Link to={`/chat?collection=${id}`} className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg glow">Ask this collection</Link>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-4" aria-labelledby="cd-docs">
          <h2 id="cd-docs" className="mb-3 font-semibold">Documents</h2>
          {docs.loading ? <Skeleton className="h-16" /> : docs.data?.items.length ? (
            <ul className="space-y-2 text-sm">{docs.data.items.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2"><span className="truncate">{d.title}</span><StatusBadge status={d.status} /></li>))}</ul>
          ) : <p className="text-sm text-muted">This collection is empty. Assign documents from <Link className="text-accent-strong" to="/documents">My Documents</Link>.</p>}
        </section>
        <section className="card p-4" aria-labelledby="cd-hist">
          <h2 id="cd-hist" className="mb-3 font-semibold">Research history</h2>
          {history.length ? <ul className="space-y-2 text-sm">{history.map((c) => (
            <li key={c.id}><Link className="hover:text-accent-strong" to={`/chat?conversation=${c.id}`}>{c.title}</Link></li>))}</ul>
            : <p className="text-sm text-muted">No questions asked in this collection yet.</p>}
        </section>
      </div>
    </>
  );
}
