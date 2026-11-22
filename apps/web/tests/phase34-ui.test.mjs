import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer as createViteServer } from "vite";

const webRoot = path.resolve(fileURLToPath(import.meta.url), "../..");
const WEB_SRC = path.resolve(webRoot, "src");

describe("Fase 34 — UI Mensageria Multicanal, Cofre de Logins, Consentimento Autofill & i18n", () => {
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

  it("1. @criativo/i18n alterna traduções reais em WorkspaceRail e SchedulePage (pt-BR/en/es)", async () => {
    const { I18nProvider } = await vite.ssrLoadModule("/src/i18n/I18nContext.tsx");
    const { WorkspaceRail } = await vite.ssrLoadModule("/src/components/WorkspaceRail.tsx");
    const { SchedulePage } = await vite.ssrLoadModule("/src/features/schedule/SchedulePage.tsx");

    const railEn = renderToStaticMarkup(
      React.createElement(
        I18nProvider,
        { locale: "en" },
        React.createElement(WorkspaceRail, {
          activeSection: "agentes",
          onSelectSection: () => {},
          whatsappStatus: "desconectado",
          onOpenWhatsAppModal: () => {},
          onOpenSettings: () => {},
          onOpenHelp: () => {},
        }),
      ),
    );
    assert.ok(railEn.includes('title="Studio"'));
    assert.ok(railEn.includes('title="Integrations"'));
    assert.ok(railEn.includes('title="Settings"'));

    const scheduleEs = renderToStaticMarkup(
      React.createElement(
        I18nProvider,
        { locale: "es" },
        React.createElement(SchedulePage, {
          agentes: [],
          initialAgenda: {
            periodo_inicio: "2026-11-22T00:00:00.000Z",
            periodo_fim: "2026-11-29T00:00:00.000Z",
            rotinas: [],
            execucoes: [],
          },
          onOpenRoutine: () => {},
          onOpenAgentChat: () => {},
          onCreateFirstRoutine: () => {},
        }),
      ),
    );
    assert.ok(scheduleEs.includes("Agenda de Rutinas"));
    assert.ok(scheduleEs.includes("Crear rutina"));
  });

  it("2. ConnectorsPage expõe políticas conversacionais, cofre de logins e modal de autofill sem <select> nativo", async () => {
    const { ConnectorsMessagingPoliciesTab } = await vite.ssrLoadModule(
      "/src/features/pages/connectors/ConnectorsMessagingPoliciesTab.tsx",
    );
    const { ConnectorsLoginVaultTab } = await vite.ssrLoadModule(
      "/src/features/pages/connectors/ConnectorsLoginVaultTab.tsx",
    );
    const { BrowserAutofillConsentModal } = await vite.ssrLoadModule(
      "/src/features/browser/BrowserAutofillConsentModal.tsx",
    );

    const policiesHtml = renderToStaticMarkup(
      React.createElement(ConnectorsMessagingPoliciesTab, {
        agentes: [],
        onToast: () => {},
      }),
    );
    assert.ok(policiesHtml.includes("Políticas Conversacionais Multicanal"));
    assert.equal(/<select[\s>]/i.test(policiesHtml), false);

    const vaultHtml = renderToStaticMarkup(
      React.createElement(ConnectorsLoginVaultTab, {
        onToast: () => {},
      }),
    );
    assert.ok(vaultHtml.includes("Cofre Estruturado de Logins"));
    assert.equal(/<select[\s>]/i.test(vaultHtml), false);

    const consentHtml = renderToStaticMarkup(
      React.createElement(BrowserAutofillConsentModal, {
        request: {
          requestId: "af_test_1",
          tabId: "tab-1",
          agenteId: "estrategista",
          domain: "painel.teste.dev",
          url: "https://painel.teste.dev/login",
          candidates: [
            {
              id: "login_1",
              title: "Painel Teste",
              domain: "painel.teste.dev",
              username: "op@teste.dev",
              source: "local",
            },
          ],
          createdAt: "2026-11-22T12:00:00.000Z",
        },
        onResolve: async () => {},
      }),
    );
    assert.ok(consentHtml.includes("Autorizar autopreenchimento de login"));
    assert.ok(consentHtml.includes("painel.teste.dev"));
    assert.equal(/<select[\s>]/i.test(consentHtml), false);

    const connectorsSrc = fs.readFileSync(
      path.join(WEB_SRC, "features/pages/ConnectorsPage.tsx"),
      "utf8",
    );
    assert.ok(connectorsSrc.includes("ConnectorsMessagingPoliciesTab"));
    assert.ok(connectorsSrc.includes("ConnectorsLoginVaultTab"));
  });
});
