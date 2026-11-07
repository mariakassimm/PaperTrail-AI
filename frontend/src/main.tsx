import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthGate } from "./components/AuthGate";
import { ToastProvider } from "./components/Toast";
import { ThemeProvider } from "./hooks/useTheme";
import "./styles/index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider><ToastProvider><AuthGate><BrowserRouter><App /></BrowserRouter></AuthGate></ToastProvider></ThemeProvider>
  </StrictMode>,
);
