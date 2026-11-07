import { Lock } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { UNAUTHORIZED_EVENT, api, clearToken, getToken, setToken } from "../services/api";
import { Button, ErrorBox, inputCls } from "./ui";

type State = "checking" | "open" | "locked" | "error";

/** Shows an unlock screen only when the backend says an access token is required. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>("checking");
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    setState("checking");
    try {
      const health = await api.health();
      if (!health.auth_required) return setState("open");
      if (!getToken()) return setState("locked");
      await api.authCheck();
      setState("open");
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "unauthorized") { clearToken(); setState("locked"); }
      else { setError(e instanceof Error ? e.message : "Something went wrong."); setState("error"); }
    }
  }, []);

  useEffect(() => { void check(); }, [check]);
  useEffect(() => {
    const onUnauthorized = () => { clearToken(); setError(null); setState("locked"); };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  async function unlock() {
    setBusy(true); setError(null);
    setToken(value.trim());
    try { await api.authCheck(); setValue(""); setState("open"); }
    catch (e) {
      clearToken();
      setError((e as { code?: string }).code === "unauthorized" ? "That access token was not accepted." : e instanceof Error ? e.message : "Could not unlock.");
    } finally { setBusy(false); }
  }

  if (state === "open") return <>{children}</>;
  if (state === "checking") return <div className="p-8 text-center text-sm text-muted" role="status">Connecting…</div>;
  if (state === "error") return <div className="mx-auto max-w-md p-8"><ErrorBox message={error ?? "Error"} onRetry={() => void check()} /></div>;
  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="card w-full max-w-sm p-6">
        <div className="mb-3 flex items-center gap-2 text-accent-strong"><Lock className="h-5 w-5" aria-hidden /><h1 className="text-lg font-semibold text-ink">PaperTrail AI is locked</h1></div>
        <p className="mb-4 text-sm text-muted">This workspace needs an access token. Ask whoever deployed it, or find it in the backend's <code>PAPERTRAIL_ACCESS_TOKEN</code> setting.</p>
        <label htmlFor="token" className="mb-1 block text-sm">Access token</label>
        <input id="token" type="password" autoComplete="off" className={inputCls} value={value} onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && value.trim() && void unlock()} />
        {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
        <Button className="mt-4 w-full" busy={busy} disabled={!value.trim()} onClick={() => void unlock()}>Unlock</Button>
      </div>
    </div>
  );
}
