import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/theme.css";
import { App } from "./App";
import { FloatingDesktopDock } from "./features/dock/FloatingDesktopDock";

const isFloatingDockMode =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("mode") === "floating-dock";

if (isFloatingDockMode && typeof document !== "undefined") {
  document.documentElement.style.background = "transparent";
  document.body.style.background = "transparent";
  const rootEl = document.getElementById("root");
  if (rootEl) rootEl.style.background = "transparent";
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>{isFloatingDockMode ? <FloatingDesktopDock /> : <App />}</StrictMode>
);
