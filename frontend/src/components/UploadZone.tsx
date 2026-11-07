import { UploadCloud } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "../services/api";
import { useToast } from "./Toast";

export function validatePdf(file: File, maxMb: number): string | null {
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) return `"${file.name}" is not a PDF. Only PDF files are supported.`;
  if (file.size === 0) return `"${file.name}" is empty.`;
  if (file.size > maxMb * 1024 * 1024) return `"${file.name}" is larger than the ${maxMb} MB limit.`;
  return null;
}

export function UploadZone({ maxMb, onDone }: { maxMb: number; onDone: () => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);

  async function handle(files: FileList | File[]) {
    for (const file of Array.from(files)) {  // one at a time keeps server memory low
      const problem = validatePdf(file, maxMb);
      if (problem) { toast("error", problem); continue; }
      setUploading(file.name);
      try {
        const doc = await api.upload(file);
        if (doc.status === "failed") toast("error", `"${doc.title}" was saved but could not be indexed: ${doc.status_message}`);
        else toast("success", `"${doc.title}" uploaded and ${doc.status.replace("_", " ")}.`);
      } catch (e) {
        toast("error", e instanceof Error ? e.message : "Upload failed.");
      }
    }
    setUploading(null);
    onDone();
    if (input.current) input.current.value = "";
  }

  return (
    <div onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); void handle(e.dataTransfer.files); }}
      className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition ${dragging ? "border-accent bg-surface2 glow" : "border-line bg-surface"}`}>
      <UploadCloud className="h-8 w-8 text-accent-strong" aria-hidden />
      <p className="text-sm">{uploading ? `Processing ${uploading}…` : "Drag and drop PDFs here, or"}</p>
      <label className="cursor-pointer rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg glow focus-within:outline focus-within:outline-2">
        Choose PDF files
        <input ref={input} type="file" accept="application/pdf,.pdf" multiple className="sr-only" disabled={!!uploading}
          aria-label="Choose PDF files" onChange={(e) => e.target.files && void handle(e.target.files)} />
      </label>
      <p className="text-xs text-muted">PDF only · up to {maxMb} MB · text-based PDFs (scanned images are not supported: no OCR)</p>
    </div>
  );
}
