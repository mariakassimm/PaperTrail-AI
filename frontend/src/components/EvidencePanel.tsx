import { FileText, X } from "lucide-react";
import { useEffect } from "react";
import { api } from "../services/api";
import { useFetch } from "../hooks/useFetch";
import { highlight, reflow } from "../utils";
import { ErrorBox, Skeleton } from "./ui";

/** Side drawer that shows the exact stored passage behind a citation plus its page for context. */
export function EvidencePanel({ chunkId, query, onClose }: { chunkId: number; query?: string; onClose: () => void }) {
  const { data, error, loading } = useFetch(() => api.chunk(chunkId), [chunkId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const start = data?.highlight_start, end = data?.highlight_end;
  const located = data && typeof start === "number" && typeof end === "number";

  return (
    <aside role="complementary" aria-label="Source evidence"
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-lg flex-col border-l border-line bg-surface shadow-2xl">
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="flex items-center gap-2 font-semibold"><FileText className="h-4 w-4 text-accent-strong" aria-hidden />Source evidence</h2>
        <button onClick={onClose} aria-label="Close evidence panel" className="rounded p-1 text-muted hover:text-ink"><X className="h-5 w-5" /></button>
      </header>
      <div className="flex-1 space-y-4 overflow-auto p-4 text-sm">
        {loading && <><Skeleton className="h-6 w-2/3" /><Skeleton className="h-32" /></>}
        {error && <ErrorBox message={error} />}
        {data && (
          <>
            <div>
              <div className="font-medium">{data.document_title}</div>
              <div className="text-muted">{data.filename} · page {data.page_number}</div>
            </div>
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Cited passage</h3>
              <p className="whitespace-pre-wrap rounded-lg border border-accent bg-surface2 p-3 leading-relaxed">{highlight(data.text, query ?? "")}</p>
            </section>
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Page {data.page_number} in context</h3>
              <p className="whitespace-pre-wrap leading-relaxed text-muted">
                {located
                  ? <>{reflow(data.page_text.slice(0, start))}<span data-testid="cited-span" className="rounded bg-surface2 px-0.5 text-ink">{reflow(data.page_text.slice(start, end))}</span>{reflow(data.page_text.slice(end))}</>
                  : reflow(data.page_text)}
              </p>
            </section>
          </>
        )}
      </div>
    </aside>
  );
}
