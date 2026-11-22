import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(__dirname, "..");

describe("Fase 31 — UI Hardening, Diagnóstico, Paleta Ctrl+K & Gravador/PiP Browser", () => {
  it("CommandPaletteModal, SettingsDiagnosticsTab, InAppBrowserRecorderPipControls e DynamicIsland renderizam em SSR sem <select>", async () => {
    const vite = await createServer({
      root: WEB_ROOT,
      server: { middlewareMode: true },
      appType: "custom",
    });
    try {
      const paletteMod = await vite.ssrLoadModule("/src/components/CommandPaletteModal.tsx");
      const diagMod = await vite.ssrLoadModule("/src/features/settings/SettingsDiagnosticsTab.tsx");
      const pipMod = await vite.ssrLoadModule("/src/features/browser/InAppBrowserRecorderPipControls.tsx");
      const islandMod = await vite.ssrLoadModule("/src/components/DynamicIsland.tsx");

      const paletteHtml = renderToStaticMarkup(
        React.createElement(paletteMod.CommandPaletteModal, {
          open: true,
          onClose: () => {},
          onSelectSection: () => {},
          onSelectAgent: () => {},
          onOpenSettings: () => {},
        }),
      );
      assert.ok(paletteHtml.includes("Paleta de Comandos e Busca Global"));
      assert.ok(paletteHtml.includes("Abrir Configurações"));
      assert.ok(!paletteHtml.includes("<select"));

      const diagHtml = renderToStaticMarkup(
        React.createElement(diagMod.SettingsDiagnosticsTab, {}),
      );
      assert.ok(diagHtml.includes("Logs Estruturados Redigidos"));
      assert.ok(diagHtml.includes("CRV-*"));
      assert.ok(!diagHtml.includes("<select"));

      const pipHtml = renderToStaticMarkup(
        React.createElement(pipMod.InAppBrowserRecorderPipControls, {
          tabId: "tab-teste",
          agenteId: "pesquisador",
        }),
      );
      assert.ok(pipHtml.includes("Gravar"));
      assert.ok(!pipHtml.includes("<select"));

      const islandHtml = renderToStaticMarkup(
        React.createElement(islandMod.DynamicIsland, {
          wsConnected: true,
          runningCount: 0,
          pendingCount: 0,
          awaitingApprovalCount: 0,
          whatsappStatus: "desconectado",
          onOpenWhatsAppModal: () => {},
          onOpenVaultModal: () => {},
          onOpenCommandPalette: () => {},
        }),
      );
      assert.ok(islandHtml.includes("Ctrl+K"));
    } finally {
      await vite.close();
    }
  });
});
