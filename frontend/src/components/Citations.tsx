import { BookOpen } from "lucide-react";
import type { Citation } from "../types";

export function CitationList({ citations, onOpen }: { citations: Citation[]; onOpen: (c: Citation) => void }) {
  if (!citations.length) return null;
  return (
    <div className="mt-3">
      <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted"><BookOpen className="h-3.5 w-3.5" aria-hidden />Evidence ({citations.length})</h4>
      <ol className="space-y-2">
        {citations.map((c, i) => (
          <li key={c.chunk_id}>
            <button onClick={() => onOpen(c)}
              className="w-full rounded-lg border border-line bg-surface2 p-3 text-left text-sm transition hover:border-accent hover:glow">
              <div className="mb-1 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                <span className="sr-only">Open source</span>{" "}<span className="font-semibold text-accent-strong">[{i + 1}]</span>{" "}
                <span className="font-medium text-ink">{c.document_title}</span>{" "}<span>· page {c.page_number}</span>{" "}
                {c.matched_by === "meaning" && <span className="rounded-full border border-accent px-1.5 text-accent-strong">matched by meaning</span>}
                {c.matched_by === "both" && <span className="rounded-full border border-accent px-1.5 text-accent-strong">keyword + meaning</span>}
              </div>
              <p className="leading-relaxed text-muted">…{c.excerpt}…</p>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
