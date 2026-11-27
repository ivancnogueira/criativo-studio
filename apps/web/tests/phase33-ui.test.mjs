import assert from "node:assert/strict";
import { resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer as createViteServer } from "vite";

const webRoot = resolve(fileURLToPath(import.meta.url), "../..");

describe("Fase 33 — UI Provedores Custom/Locais, Feed .ics, Notificações, Idle-Wait & Mídia em Workflows", () => {
  let vite;

  before(async () => {
    vite = await createViteServer({
      root: webRoot,
      server: { middlewareMode: true },
      appType: "custom",
    });
  });

  after(async () => {
    await vite.close();
  });

  it("1. CustomAndLocalProvidersSection e RoutineIcsSubscribeModal renderizam sem <select>", async () => {
    const { CustomAndLocalProvidersSection } = await vite.ssrLoadModule(
      "/src/features/pages/CustomAndLocalProvidersSection.tsx"
    );
    const { RoutineIcsSubscribeModal } = await vite.ssrLoadModule(
      "/src/features/schedule/RoutineIcsSubscribeModal.tsx"
    );

    const customHtml = renderToStaticMarkup(
      React.createElement(CustomAndLocalProvidersSection, { onShowToast: () => {} })
    );
    assert.match(customHtml, /Servidores Locais Detectados/);
    assert.match(customHtml, /Provedores Customizados/);
    assert.equal(/<select[\s>]/i.test(customHtml), false);

    const icsHtml = renderToStaticMarkup(
      React.createElement(RoutineIcsSubscribeModal, { open: true, onClose: () => {} })
    );
    assert.match(icsHtml, /Assinar Calendário \(\.ics\)/);
    assert.equal(/<select[\s>]/i.test(icsHtml), false);
  });

  it("2. NotificationCenterPopover, DynamicIsland, UpdateNotificationBanner (waiting_idle) e SettingsNotificationsTab", async () => {
    const { DynamicIsland } = await vite.ssrLoadModule("/src/components/DynamicIsland.tsx");
    const { UpdateNotificationBanner } = await vite.ssrLoadModule(
      "/src/features/updates/UpdateNotificationBanner.tsx"
    );
    const { SettingsNotificationsTab } = await vite.ssrLoadModule(
      "/src/features/settings/SettingsNotificationsVoiceTabs.tsx"
    );

    const islandHtml = renderToStaticMarkup(
      React.createElement(DynamicIsland, {
        wsConnected: true,
        runningCount: 0,
        pendingCount: 0,
        awaitingApprovalCount: 0,
        whatsappStatus: "desconectado",
        onOpenWhatsAppModal: () => {},
        onOpenVaultModal: () => {},
        notifications: [
          {
            id: "n-1",
            kind: "approval",
            title: "Aprovação pendente",
            body: "Carrossel aguardando revisão.",
            createdAt: "2026-11-22T12:00:00.000Z",
            read: false,
          },
        ],
      })
    );
    assert.match(islandHtml, /Central de notificações/);
    assert.match(islandHtml, />1<\/span>/);

    const bannerHtml = renderToStaticMarkup(
      React.createElement(UpdateNotificationBanner, {
        status: {
          current_version: "1.0.0",
          latest_version: "1.1.0",
          update_available: true,
          state: "waiting_idle",
          progress_percent: 100,
          requires_active_license: true,
          can_apply_in_app: true,
          is_desktop_packaged: true,
          server_id: "primary",
          server_kind: "primary",
          last_checked_at: null,
        },
        onForceRestart: () => {},
      })
    );
    assert.match(bannerHtml, /aguardando ociosidade/);
    assert.match(bannerHtml, /Reiniciar para atualizar \(forçar\)/);

    const settingsHtml = renderToStaticMarkup(
      React.createElement(SettingsNotificationsTab, {
        notificacoes: {
          web_habilitadas: true,
          mostrar_preview: true,
          notificacao_nativa_nivel: "approvals_only",
          som_tarefa: "cristal",
          som_feedback: "suave",
          matriz: {},
        },
        agentes: [],
        canais: [],
        onChange: () => {},
      })
    );
    assert.match(settingsHtml, /Notificações nativas do sistema/);
    assert.match(settingsHtml, /Apenas aprovações/);
    assert.equal(/<select[\s>]/i.test(settingsHtml), false);
  });
});
