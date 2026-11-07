import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthGate } from "../components/AuthGate";
import { api } from "../services/api";
import { applyDefaults, health } from "./apiMock";

vi.mock("../services/api", async () => (await import("./apiMock")).makeApiMock());
const unauthorized = Object.assign(new Error("A valid access token is required."), { code: "unauthorized" });
const gate = () => render(<AuthGate><div>SECRET WORKSPACE</div></AuthGate>);

beforeEach(() => { sessionStorage.clear(); applyDefaults(api as unknown as Parameters<typeof applyDefaults>[0]); });

describe("AuthGate", () => {
  it("renders the app directly when no token is required (local mode)", async () => {
    gate();
    expect(await screen.findByText("SECRET WORKSPACE")).toBeInTheDocument();
    expect(api.authCheck).not.toHaveBeenCalled();
  });

  it("locks the workspace until a valid token is entered", async () => {
    vi.mocked(api.health).mockResolvedValue({ ...health, auth_required: true });
    vi.mocked(api.authCheck).mockRejectedValueOnce(unauthorized).mockResolvedValueOnce({ ok: true });
    gate();
    expect(await screen.findByText("PaperTrail AI is locked")).toBeInTheDocument();
    expect(screen.queryByText("SECRET WORKSPACE")).not.toBeInTheDocument();
    const unlock = screen.getByRole("button", { name: "Unlock" });
    expect(unlock).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Access token"), "wrong-token");
    await userEvent.click(unlock);
    expect(await screen.findByRole("alert")).toHaveTextContent("was not accepted");
    expect(screen.queryByText("SECRET WORKSPACE")).not.toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Access token"));
    await userEvent.type(screen.getByLabelText("Access token"), "right-token");
    await userEvent.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByText("SECRET WORKSPACE")).toBeInTheDocument();
  });

  it("uses a remembered token and re-locks if the server later rejects it", async () => {
    sessionStorage.setItem("t", "saved-token");
    vi.mocked(api.health).mockResolvedValue({ ...health, auth_required: true });
    vi.mocked(api.authCheck).mockResolvedValue({ ok: true });
    gate();
    expect(await screen.findByText("SECRET WORKSPACE")).toBeInTheDocument();
    act(() => { window.dispatchEvent(new Event("papertrail:unauthorized")); });
    expect(await screen.findByText("PaperTrail AI is locked")).toBeInTheDocument();
    expect(sessionStorage.getItem("t")).toBeNull();
  });

  it("shows a retryable error when the backend is unreachable instead of unlocking", async () => {
    vi.mocked(api.health).mockRejectedValueOnce(new Error("Cannot reach the PaperTrail backend."));
    gate();
    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot reach");
    expect(screen.queryByText("SECRET WORKSPACE")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("SECRET WORKSPACE")).toBeInTheDocument();
  });
});
