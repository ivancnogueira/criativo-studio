import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/theme.css";
import { App } from "./App";
import { FloatingDesktopDock } from "./features/dock/FloatingDesktopDock";

const isFloatingDockMode =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("mode") === "floating-dock";

if (isFloatingDockMode && typeof document !== "undefined") {
  document.title = "";
  document.documentElement.style.background = "transparent";
  document.documentElement.style.overflow = "hidden";
  document.body.style.background = "transparent";
  document.body.style.overflow = "hidden";
  const rootEl = document.getElementById("root");
  if (rootEl) rootEl.style.background = "transparent";
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>{isFloatingDockMode ? <FloatingDesktopDock /> : <App />}</StrictMode>
);
