import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ok = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

async function load(base?: string) {
  vi.resetModules();
  if (base !== undefined) vi.stubEnv("VITE_API_BASE", base);
  return import("../services/api");
}

beforeEach(() => sessionStorage.clear());
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("api client (real module, fetch stubbed)", () => {
  it("normalises a trailing slash on VITE_API_BASE so URLs are never doubled", async () => {
    const fetchMock = vi.fn((..._args: unknown[]) => ok({ status: "ok" }));
    vi.stubGlobal("fetch", fetchMock);
    const { api, API_BASE } = await load("https://api.example.com/api/v1/");
    expect(API_BASE).toBe("https://api.example.com/api/v1");
    await api.health();
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/api/v1/health");
  });

  it("sends the bearer token only when one is stored, including on file uploads", async () => {
    const fetchMock = vi.fn((..._args: unknown[]) => ok({ id: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    const { api, setToken, clearToken } = await load("/api/v1");
    await api.stats();
    expect(new Headers((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers).has("Authorization")).toBe(false);
    setToken("my-secret-token");
    await api.upload(new File(["%PDF-"], "a.pdf", { type: "application/pdf" }));
    const [, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer my-secret-token");
    expect(init.body).toBeInstanceOf(FormData); // multipart boundary still set by the browser
    clearToken();
    await api.stats();
    expect(new Headers((fetchMock.mock.calls[2] as unknown as [string, RequestInit])[1].headers).has("Authorization")).toBe(false);
  });

  it("announces 401s so the UI can lock, and keeps the server's message", async () => {
    vi.stubGlobal("fetch", vi.fn(() => ok({ error: { code: "unauthorized", message: "A valid access token is required." } }, 401)));
    const { api, UNAUTHORIZED_EVENT } = await load("/api/v1");
    const heard = vi.fn();
    window.addEventListener(UNAUTHORIZED_EVENT, heard);
    await expect(api.stats()).rejects.toMatchObject({ status: 401, code: "unauthorized", message: "A valid access token is required." });
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener(UNAUTHORIZED_EVENT, heard);
  });

  it("turns network failures into a friendly message and never leaks the token", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    const { api, setToken } = await load("/api/v1");
    setToken("my-secret-token");
    const err = (await api.stats().catch((e: unknown) => e)) as Error;
    expect(err.message).toMatch(/Cannot reach the PaperTrail backend/);
    expect(err.message).not.toContain("my-secret-token");
  });
});
