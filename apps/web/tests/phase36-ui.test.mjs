import assert from "node:assert/strict";
import { resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer as createViteServer } from "vite";

const webRoot = resolve(fileURLToPath(import.meta.url), "../..");

describe("Fase 36 — UI Team RBAC, Instance Transfer, CRM Opcional & Voz Local", () => {
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

  it("1. TeamManagementModal e InstanceTransferModal renderizam em Carbon Dark sem <select>", async () => {
    const { TeamManagementModal } = await vite.ssrLoadModule(
      "/src/features/servers/TeamManagementModal.tsx",
    );
    const { InstanceTransferModal } = await vite.ssrLoadModule(
      "/src/features/servers/InstanceTransferModal.tsx",
    );

    const teamHtml = renderToStaticMarkup(
      React.createElement(TeamManagementModal, {
        open: true,
        serverName: "VPS Principal",
        onClose: () => {},
      }),
    );
    assert.ok(teamHtml.includes("Equipe &amp; Auditoria"));
    assert.equal(/<select[\s>]/i.test(teamHtml), false);

    const transferHtml = renderToStaticMarkup(
      React.createElement(InstanceTransferModal, {
        open: true,
        onClose: () => {},
      }),
    );
    assert.ok(transferHtml.includes("Migração / Transferência de Instância"));
    assert.ok(transferHtml.includes("SHA-256"));
    assert.equal(/<select[\s>]/i.test(transferHtml), false);
  });

  it("2. CrmPage, CrmProposalCard e SettingsVoiceTab renderizam sem <select> nativo", async () => {
    const { CrmPage } = await vite.ssrLoadModule("/src/features/crm/CrmPage.tsx");
    const { CrmProposalCard } = await vite.ssrLoadModule("/src/features/chat/CrmProposalCard.tsx");
    const { SettingsVoiceTab } = await vite.ssrLoadModule(
      "/src/features/settings/SettingsNotificationsVoiceTabs.tsx",
    );

    const crmHtml = renderToStaticMarkup(
      React.createElement(CrmPage, { initialEnabled: true }),
    );
    assert.ok(crmHtml.includes("CRM Leve &amp; Funil"));
    assert.equal(/<select[\s>]/i.test(crmHtml), false);

    const propHtml = renderToStaticMarkup(
      React.createElement(CrmProposalCard, {
        proposal: {
          proposalId: "crmp_1",
          agenteId: "estrategista",
          operation: "create_contact",
          contactId: null,
          summary: "Adicionar lead da campanha",
          diffJson: { name: "Lead Teste", stage: "lead" },
          status: "pending",
          decidedBy: null,
          createdAt: "2026-11-22T12:00:00.000Z",
          decidedAt: null,
        },
        onDecide: async () => {},
      }),
    );
    assert.ok(propHtml.includes("Confirmar CRM"));

    const voiceHtml = renderToStaticMarkup(
      React.createElement(SettingsVoiceTab, {
        voz: {
          provedor_ditado: "web_speech",
          modelo_tts: "edge_tts",
          velocidade: 1,
          leitura_automatica: false,
          live_voice_habilitada: false,
        },
        onChange: () => {},
      }),
    );
    assert.ok(voiceHtml.includes("Motor de Voz Local Isolado"));
    assert.equal(/<select[\s>]/i.test(voiceHtml), false);
  });
});
