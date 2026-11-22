import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(__dirname, "..");

describe("Fase 37 — UI Ecossistema Avançado (CUA, Temas JSON & Monitor de Host)", () => {
  it("DynamicIsland exibe botão Parar Controle quando CUA está executando", async () => {
    const vite = await createServer({
      root: WEB_ROOT,
      server: { middlewareMode: true },
      appType: "custom",
    });
    try {
      const mod = await vite.ssrLoadModule("/src/components/DynamicIsland.tsx");
      const html = renderToStaticMarkup(
        React.createElement(mod.DynamicIsland, {
          wsConnected: true,
          runningCount: 1,
          pendingCount: 0,
          awaitingApprovalCount: 0,
          whatsappStatus: "desconectado",
          onOpenWhatsAppModal: () => {},
          onOpenVaultModal: () => {},
          cuaStatus: {
            enabled: true,
            running: true,
            aborted: false,
            active_agent_id: "designer",
            active_window: "CapCut",
            cursor: { x: 100, y: 200 },
            highlight_region: null,
            permission_granted: true,
            last_action: "click",
            last_action_at: null,
            message: "Ativo",
          },
          onAbortCua: () => {},
        }),
      );
      assert.ok(html.includes("Parar Controle"));
      assert.ok(!html.includes("<select"));
    } finally {
      await vite.close();
    }
  });

  it("HostResourcesPanel renderiza métricas e alerta de RAM alta + SettingsAppearanceTab sem <select>", async () => {
    const vite = await createServer({
      root: WEB_ROOT,
      server: { middlewareMode: true },
      appType: "custom",
    });
    try {
      const panelMod = await vite.ssrLoadModule("/src/components/HostResourcesPanel.tsx");
      const panelHtml = renderToStaticMarkup(
        React.createElement(panelMod.HostResourcesPanel, {
          initialSnapshot: {
            timestamp: new Date().toISOString(),
            platform: "linux",
            hostname: "vps-producao",
            cpus: 4,
            cpu_percent: 42.5,
            memory_total_mb: 4096,
            memory_used_mb: 3686,
            memory_free_mb: 410,
            memory_percent: 90,
            daemon_rss_mb: 240,
            disk_total_gb: 80,
            disk_free_gb: 35,
            disk_percent: 56.2,
            processes: [
              {
                pid: 9812,
                kind: "chromium",
                label: "Chromium CDP",
                started_at: new Date().toISOString(),
                uptime_ms: 15000,
                memory_mb: 420,
                can_kill: true,
              },
            ],
          },
        }),
      );
      assert.ok(panelHtml.includes("Recursos do Host"));
      assert.ok(panelHtml.includes("Uso de memória RAM acima de 85%"));
      assert.ok(panelHtml.includes("Chromium CDP"));
      assert.ok(panelHtml.includes("Encerrar"));

      const i18nMod = await vite.ssrLoadModule("/src/i18n/I18nContext.tsx");
      const tabMod = await vite.ssrLoadModule("/src/features/settings/SettingsAppearanceTab.tsx");
      const tabHtml = renderToStaticMarkup(
        React.createElement(
          i18nMod.I18nProvider,
          { locale: "pt-BR" },
          React.createElement(tabMod.SettingsAppearanceTab, {
            aparencia: {
              tema: "carbon_dark",
              cor_acento: "#007CF7",
              escala: 100,
              fonte_interface: "Inter",
              fonte_codigo: "JetBrains Mono",
              idioma: "pt-BR",
              tema_externo_id: "obsidian-neon",
              backdrop_id: "nebula",
            },
            initialExternalThemes: [
              {
                id: "obsidian-neon",
                name: "Obsidian Neon",
                base: "dark",
                tokens: { "--studio-accent": "#38BDF8" },
                backdrop: "nebula",
                updated_at: new Date().toISOString(),
              },
            ],
            onChange: () => {},
          }),
        ),
      );
      assert.ok(tabHtml.includes("Temas Externos JSON"));
      assert.ok(tabHtml.includes("Obsidian Neon"));
      assert.ok(!tabHtml.includes("<select"));
    } finally {
      await vite.close();
    }
  });
});
