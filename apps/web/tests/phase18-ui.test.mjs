import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer as createViteServer } from "vite";

const webRoot = resolve(fileURLToPath(import.meta.url), "../..");

function listFrontendFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listFrontendFiles(full));
    } else if (name.endsWith(".tsx") || name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("Fase 18 — UI Auto-Update 1 Clique Carbon Dark SSR & Auditoria Estática Final", () => {
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

  it("Teste 1 — Renderiza SSR UpdateNotificationBanner (available, downloading, ready_to_restart)", async () => {
    const { UpdateNotificationBanner } = await vite.ssrLoadModule(
      "/src/features/updates/UpdateNotificationBanner.tsx",
    );

    const availableHtml = renderToStaticMarkup(
      React.createElement(UpdateNotificationBanner, {
        status: {
          current_version: "1.0.0",
          latest_version: "1.2.0",
          update_available: true,
          state: "available",
          progress_percent: 0,
          changelog_markdown: "Novo motor Remotion e estabilidade.",
          requires_active_license: true,
          can_apply_in_app: true,
          is_desktop_packaged: true,
          server_id: "primary",
          server_kind: "primary",
          last_checked_at: new Date().toISOString(),
        },
        onApplyUpdate: () => {},
        onOpenDetails: () => {},
      }),
    );
    assert.match(availableHtml, /Nova versão v1\.2\.0/);
    assert.match(availableHtml, /Atualizar agora/);

    const downloadingHtml = renderToStaticMarkup(
      React.createElement(UpdateNotificationBanner, {
        status: {
          current_version: "1.0.0",
          latest_version: "1.2.0",
          update_available: true,
          state: "downloading",
          progress_percent: 45,
          requires_active_license: true,
          can_apply_in_app: true,
          is_desktop_packaged: true,
          server_id: "primary",
          server_kind: "primary",
          last_checked_at: new Date().toISOString(),
        },
      }),
    );
    assert.match(downloadingHtml, /Baixando atualização \(45%\)/);
    assert.match(downloadingHtml, /Atualizando\.\.\./);

    const readyHtml = renderToStaticMarkup(
      React.createElement(UpdateNotificationBanner, {
        status: {
          current_version: "1.2.0",
          latest_version: "1.2.0",
          update_available: false,
          state: "ready_to_restart",
          progress_percent: 100,
          requires_active_license: true,
          can_apply_in_app: true,
          is_desktop_packaged: true,
          server_id: "primary",
          server_kind: "primary",
          last_checked_at: new Date().toISOString(),
        },
      }),
    );
    assert.match(readyHtml, /Atualização v1\.2\.0 aplicada/);
    assert.match(readyHtml, /Pronto · Reiniciar agora/);
  });

  it("Teste 2 — Renderiza SSR SettingsUpdatesTab (up_to_date, available, license_blocked)", async () => {
    const { SettingsUpdatesTab } = await vite.ssrLoadModule(
      "/src/features/settings/SettingsUpdatesTab.tsx",
    );

    const upToDateHtml = renderToStaticMarkup(
      React.createElement(SettingsUpdatesTab, {
        updateStatus: {
          current_version: "1.0.0",
          latest_version: "1.0.0",
          update_available: false,
          state: "up_to_date",
          progress_percent: 0,
          requires_active_license: true,
          can_apply_in_app: true,
          is_desktop_packaged: false,
          server_id: "primary",
          server_kind: "primary",
          last_checked_at: new Date().toISOString(),
        },
        whatsNew: null,
        activeServerName: "Servidor Principal",
      }),
    );
    assert.match(upToDateHtml, /Servidor Principal/);
    assert.match(upToDateHtml, /Você já está usando a versão mais recente \(v1\.0\.0\)/);
    assert.match(upToDateHtml, /Blindagem de dados/);

    const availableHtml = renderToStaticMarkup(
      React.createElement(SettingsUpdatesTab, {
        updateStatus: {
          current_version: "1.0.0",
          latest_version: "1.3.0",
          update_available: true,
          state: "available",
          progress_percent: 0,
          changelog_markdown: "- Auto-Update em 1 clique para VPS\n- Melhorias de memória",
          requires_active_license: true,
          can_apply_in_app: true,
          is_desktop_packaged: false,
          server_id: "srv_vps_1",
          server_kind: "remote_vps",
          last_checked_at: new Date().toISOString(),
        },
        whatsNew: null,
        activeServerName: "VPS Produção Cliente",
      }),
    );
    assert.match(availableHtml, /VPS Produção Cliente/);
    assert.match(availableHtml, /Atualização disponível: v1\.3\.0/);
    assert.match(availableHtml, /Atualizar agora \(v1\.3\.0\)/);
    assert.match(availableHtml, /Verificação SHA-256 obrigatória/);

    const blockedHtml = renderToStaticMarkup(
      React.createElement(SettingsUpdatesTab, {
        updateStatus: {
          current_version: "1.0.0",
          latest_version: null,
          update_available: false,
          state: "license_blocked",
          progress_percent: 0,
          requires_active_license: true,
          can_apply_in_app: true,
          is_desktop_packaged: true,
          server_id: "primary",
          server_kind: "primary",
          last_checked_at: new Date().toISOString(),
          error_message: "Licença revogada para atualizações.",
        },
        whatsNew: null,
        activeServerName: "Desktop Windows",
      }),
    );
    assert.match(blockedHtml, /Atualizações bloqueadas pela licença/);
    assert.match(blockedHtml, /Licença revogada para atualizações\./);
  });

  it("Teste 3 — Auditoria clean-room final: zero <select> nativos e zero imports Electron/Node no apps/web/src", () => {
    const files = listFrontendFiles(resolve(webRoot, "src"));
    const selectOffenders = [];
    const electronImportOffenders = [];

    for (const f of files) {
      const content = readFileSync(f, "utf8");
      if (/<select[\s>]/i.test(content)) {
        selectOffenders.push(f);
      }
      if (/from\s+['"](?:electron|node:[^'"]+)['"]/.test(content)) {
        electronImportOffenders.push(f);
      }
    }

    assert.deepEqual(selectOffenders, [], `Encontrados <select> nativos em: ${selectOffenders.join(", ")}`);
    assert.deepEqual(
      electronImportOffenders,
      [],
      `Encontrados imports proibidos de electron/node: em: ${electronImportOffenders.join(", ")}`,
    );
  });
});
