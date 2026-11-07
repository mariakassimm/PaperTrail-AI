import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import App from "../App";
import { ToastProvider } from "../components/Toast";
import { ThemeProvider } from "../hooks/useTheme";
import type { Citation, Doc } from "../types";

export { applyDefaults, emptyStats } from "./apiMock";

export const doc = (over: Partial<Doc> = {}): Doc => ({ id: 1, title: "Solar Paper", filename: "solar.pdf", size_bytes: 2048, page_count: 3,
  status: "indexed", status_message: "", created_at: "2026-10-01T00:00:00Z", collection_id: null, ...over });
export const citation: Citation = { chunk_id: 7, document_id: 1, document_title: "Solar Paper", filename: "solar.pdf", page_number: 2,
  excerpt: "controller built around an ESP32 microcontroller", score: 3.1 };

export function renderApp(route = "/", ui: ReactElement = <App />) {
  return render(<ThemeProvider><ToastProvider><MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter></ToastProvider></ThemeProvider>);
}
