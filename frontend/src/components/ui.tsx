import { Loader2, X } from "lucide-react";
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";

type Variant = "primary" | "ghost" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:brightness-110 glow",
  ghost: "border border-line bg-surface2 text-ink hover:border-accent",
  danger: "border border-danger text-danger hover:bg-danger hover:text-accent-fg",
};

export function Button({ variant = "primary", busy, className = "", children, disabled, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button {...rest} disabled={disabled || busy}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}>
      {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

const badgeTone: Record<string, string> = {
  indexed: "text-ok border-ok", partially_extracted: "text-warn border-warn", failed: "text-danger border-danger",
  processing: "text-accent-strong border-accent", queued: "text-muted border-line",
};
export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${badgeTone[status] ?? "text-muted border-line"}`}>
      {status.replace("_", " ")}
    </span>
  );
}

export function Pill({ children, tone = "accent" }: { children: ReactNode; tone?: "accent" | "muted" | "warn" }) {
  const t = { accent: "border-accent text-accent-strong", muted: "border-line text-muted", warn: "border-warn text-warn" }[tone];
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${t}`}>{children}</span>;
}

export function Skeleton({ className = "h-5 w-full" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-12 text-center">
      <div className="text-accent-strong" aria-hidden>{icon}</div>
      <h3 className="text-lg font-semibold">{title}</h3>
      <div className="max-w-md text-sm text-muted">{children}</div>
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="card flex flex-wrap items-center justify-between gap-3 border-danger px-4 py-3 text-sm">
      <span className="text-danger">{message}</span>
      {onRetry && <Button variant="ghost" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={onClose}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className={`card max-h-[90vh] w-full overflow-auto p-5 ${wide ? "max-w-3xl" : "max-w-md"}`}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close dialog" className="rounded p-1 text-muted hover:text-ink"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onClose, busy }:
  { title: string; message: string; confirmLabel: string; onConfirm: () => void; onClose: () => void; busy?: boolean }) {
  return (
    <Dialog title={title} onClose={onClose}>
      <p className="mb-5 text-sm text-muted">{message}</p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="danger" busy={busy} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </Dialog>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export const inputCls = "w-full rounded-lg border border-line bg-surface2 px-3 py-2 text-sm text-ink placeholder:text-muted";
export const formatBytes = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
export const formatDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
