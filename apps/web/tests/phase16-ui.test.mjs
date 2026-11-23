import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer as createViteServer } from "vite";

const webRoot = resolve(fileURLToPath(import.meta.url), "../..");

function listTsxFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listTsxFiles(full));
    } else if (name.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

describe("Fase 16 — UI Licenciamento Carbon Dark SSR & Auditoria Estática", () => {
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

  it("Teste 1 — Renderiza SSR LicenseActivationGate (missing, revoked, machine_limit)", async () => {
    const { LicenseActivationGate } = await vite.ssrLoadModule(
      "/src/features/license/LicenseActivationGate.tsx",
    );

    const missingHtml = renderToStaticMarkup(
      React.createElement(LicenseActivationGate, {
        status: {
          valid: false,
          status_code: "missing",
          plan_tier: null,
          plan_label: "Nenhuma licença ativada",
          max_servers: 0,
          servers_used: 1,
          max_machines: 0,
          machines_used: 0,
          upgrades: [],
          devices: [],
          hub_url: "http://127.0.0.1:3007",
        },
        onActivate: async () => ({}) ,
        onDeactivateDevice: async () => ({ ok: true, devices: [] }),
      }),
    );
    assert.match(missingHtml, /Ative sua licença do Criativo AI Studio/);
    assert.match(missingHtml, /Agência 10/);
    assert.match(missingHtml, /Agência Ilimitada/);

    const limitHtml = renderToStaticMarkup(
      React.createElement(LicenseActivationGate, {
        status: {
          valid: false,
          status_code: "machine_limit",
          plan_tier: "individual",
          plan_label: "Licença Individual",
          customer_email: "teste@exemplo.invalid",
          max_servers: 2,
          servers_used: 1,
          max_machines: 2,
          machines_used: 2,
          upgrades: [],
          devices: [
            {
              machine_id: "m-1",
              hostname: "PC-STUDIO-A",
              os_platform: "win32-x64",
              first_activated_at: new Date().toISOString(),
              last_heartbeat_at: new Date().toISOString(),
            },
          ],
          hub_url: "http://127.0.0.1:3007",
        },
        onActivate: async () => ({}),
        onDeactivateDevice: async () => ({ ok: true, devices: [] }),
      }),
    );
    assert.match(limitHtml, /Limite de computadores atingido/);
    assert.match(limitHtml, /PC-STUDIO-A/);
    assert.match(limitHtml, /Desvincular e ativar aqui/);
  });

  it("Teste 2 — Renderiza SSR SettingsLicenseTab nos 3 planos e dentro do SettingsModal", async () => {
    const { SettingsLicenseTab } = await vite.ssrLoadModule(
      "/src/features/settings/SettingsLicenseTab.tsx",
    );
    const { SettingsModal, DEFAULT_FRONTEND_USER_SETTINGS } = await vite.ssrLoadModule(
      "/src/features/settings/SettingsModal.tsx",
    );

    const ag10Html = renderToStaticMarkup(
      React.createElement(SettingsLicenseTab, {
        status: {
          valid: true,
          status_code: "active",
          plan_tier: "agencia_10",
          plan_label: "Licença Agência 10",
          customer_email: "agencia@exemplo.invalid",
          masked_key: "CRIA-AG10-••••-ABCD",
          max_servers: 10,
          servers_used: 4,
          max_machines: 3,
          machines_used: 2,
          upgrades: ["bonus"],
          offline_days_remaining: 7,
          devices: [
            {
              machine_id: "m-local",
              hostname: "NOTEBOOK-PRINCIPAL",
              os_platform: "win32-x64",
              first_activated_at: new Date().toISOString(),
              last_heartbeat_at: new Date().toISOString(),
              is_current_machine: true,
            },
          ],
          hub_url: "http://127.0.0.1:3007",
        },
      }),
    );
    assert.match(ag10Html, /Licença Agência 10/);
    assert.match(ag10Html, /4 \/ 10/);
    assert.match(ag10Html, /2 \/ 3/);
    assert.match(ag10Html, /Liberado/);
    assert.match(ag10Html, /Não incluído/);

    const modalHtml = renderToStaticMarkup(
      React.createElement(SettingsModal, {
        open: true,
        initialTab: "licenca",
        settings: DEFAULT_FRONTEND_USER_SETTINGS,
        storageUsage: null,
        whatsNew: null,
        browserProfiles: [],
        browserProxies: [],
        agentes: [],
        canais: [],
        licenseStatus: {
          valid: true,
          status_code: "active",
          plan_tier: "agencia_ilimitada",
          plan_label: "Licença Agência Ilimitada",
          max_servers: -1,
          servers_used: 18,
          max_machines: 5,
          machines_used: 3,
          upgrades: ["bonus", "video"],
          devices: [],
          hub_url: "http://127.0.0.1:3007",
        },
        onClose: () => {},
        onSaveSettings: async () => {},
        onCreateBrowserProfile: async () => {},
        onUpdateBrowserProfile: async () => {},
        onClearBrowserProfile: async () => {},
        onDeleteBrowserProfile: async () => {},
        onSaveBrowserProxy: async () => ({}),
        onDeleteBrowserProxy: async () => {},
      }),
    );
    assert.match(modalHtml, /Licença/);
    assert.match(modalHtml, /18 \/ Ilimitado/);
  });

  it("Teste 3 — Auditoria estática Clean-Room: zero <select nativos nos arquivos da Fase 16", () => {
    const files = listTsxFiles(resolve(webRoot, "src"));
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      assert.equal(/<select[\s>]/i.test(content), false, `Encontrado <select nativo em ${file}`);
    }
  });
});
