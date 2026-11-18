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

describe("Fase 17 — UI Multi-Servidores Carbon Dark SSR & Auditoria Zero <select>", () => {
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

  it("Teste 1 — Renderiza SSR ServerSwitcherPopover fiel aos Prints 1 e 2", async () => {
    const { ServerSwitcherPopover } = await vite.ssrLoadModule(
      "/src/features/servers/ServerSwitcherPopover.tsx",
    );

    const html = renderToStaticMarkup(
      React.createElement(ServerSwitcherPopover, {
        open: true,
        initialAddSubmenuOpen: true,
        activeServerId: "primary",
        quota: {
          allowed: true,
          servers_used: 3,
          max_servers: 10,
          local_used: 2,
          max_local_servers: 10,
          remote_used: 1,
          max_remote_servers: 10,
        },
        servers: [
          {
            server_id: "primary",
            nome: "Servidor Principal",
            slug: "primary",
            kind: "primary",
            status: "online",
            cor_hex: "#E88B2D",
            base_url: "http://127.0.0.1:3000",
            is_active: true,
            created_at: new Date().toISOString(),
          },
          {
            server_id: "srv_cliente_a",
            nome: "Cliente Alpha",
            slug: "cliente-alpha",
            kind: "local_child",
            status: "online",
            cor_hex: "#31CF76",
            base_url: "http://127.0.0.1:4101",
            port: 4101,
            is_active: false,
            created_at: new Date().toISOString(),
          },
          {
            server_id: "srv_vps_prod",
            nome: "VPS Produção",
            slug: "vps-producao",
            kind: "remote_vps",
            status: "online",
            cor_hex: "#4E8DFF",
            base_url: "http://198.51.100.10:3000",
            remote_ip: "198.51.100.10",
            is_active: false,
            created_at: new Date().toISOString(),
          },
        ],
        onClose: () => {},
        onSelectServer: () => {},
        onOpenNewLocalModal: () => {},
        onOpenNewRemoteModal: () => {},
        onOpenJoinModal: () => {},
        onOpenServerSettings: () => {},
        onOpenDisplaySettings: () => {},
      }),
    );

    assert.match(html, /Servidores/);
    assert.match(html, /3 de 10/);
    assert.match(html, /Servidor Principal/);
    assert.match(html, /Cliente Alpha/);
    assert.match(html, /VPS Produção/);
    assert.match(html, /Adicionar servidor/);
    assert.match(html, /Novo servidor neste computador/);
    assert.match(html, /Novo servidor em outro computador/);
    assert.match(html, /Entrar em um servidor/);
    assert.match(html, /Configurações do servidor/);
    assert.match(html, /Exibição/);
  });

  it("Teste 2 — Renderiza SSR NewLocalServerModal (livre e bloqueado por cota) e JoinServerModal", async () => {
    const { NewLocalServerModal, JoinServerModal } = await vite.ssrLoadModule(
      "/src/features/servers/ServerModals.tsx",
    );

    const blockedHtml = renderToStaticMarkup(
      React.createElement(NewLocalServerModal, {
        open: true,
        quota: {
          allowed: false,
          servers_used: 1,
          max_servers: 2,
          local_used: 1,
          max_local_servers: 1,
          remote_used: 0,
          max_remote_servers: 1,
          reason: "Na Licença Individual você pode ter 1 servidor local + 1 VPS remota.",
        },
        onClose: () => {},
        onCreated: () => {},
        onOpenLicenseSettings: () => {},
      }),
    );

    assert.match(blockedHtml, /Novo servidor neste computador/);
    assert.match(blockedHtml, /O servidor tem seus próprios agentes, chats e arquivos/);
    assert.match(blockedHtml, /Nome do servidor/);
    assert.match(blockedHtml, /Licença Individual/);
    assert.match(blockedHtml, /Ver planos e licença/);
    assert.match(blockedHtml, /Criar servidor/);

    const joinHtml = renderToStaticMarkup(
      React.createElement(JoinServerModal, {
        open: true,
        onClose: () => {},
        onJoined: () => {},
      }),
    );
    assert.match(joinHtml, /Entrar em um servidor/);
    assert.match(joinHtml, /Link de convite/);
    assert.match(joinHtml, /URL \+ Token/);
  });

  it("Teste 3 — Renderiza SSR NewRemoteServerClaimModal (pending e redeemed) e ServerSettingsModal", async () => {
    const { NewRemoteServerClaimModal, ServerSettingsModal } = await vite.ssrLoadModule(
      "/src/features/servers/ServerModals.tsx",
    );

    const pendingClaim = {
      claim_id: "clm_demo_123",
      server_name: "VPS Cliente Demo",
      command_bash:
        '{ echo CRIATIVO_CLAIM=CRV_demo_token_xyz; curl -fsSL http://127.0.0.1:3007/api/releases/install-server.sh; } | sudo bash -s -- --name "VPS Cliente Demo"',
      command_agent_prompt: "Instale o Criativo AI Studio na VPS via SSH.",
      expires_at: new Date(Date.now() + 14 * 60 * 1000).toISOString(),
      ttl_seconds: 900,
      status: "pending",
      paired_server: null,
    };

    const pendingHtml = renderToStaticMarkup(
      React.createElement(NewRemoteServerClaimModal, {
        open: true,
        quota: {
          allowed: true,
          servers_used: 1,
          max_servers: 10,
          local_used: 1,
          max_local_servers: 10,
          remote_used: 0,
          max_remote_servers: 10,
        },
        initialClaim: pendingClaim,
        onClose: () => {},
        onConfigureWithAgent: () => {},
        onOpenPairedServer: () => {},
      }),
    );

    assert.match(pendingHtml, /Novo servidor em outro computador/);
    assert.match(pendingHtml, /CRIATIVO_CLAIM=CRV_demo_token_xyz/);
    assert.match(pendingHtml, /Copiar para um agente de IA/);
    assert.match(pendingHtml, /Funciona uma vez\. Expira em/);
    assert.match(pendingHtml, /Aguardando o comando ser executado no seu servidor/);
    assert.match(pendingHtml, /Configurar com um agente/);
    assert.match(pendingHtml, /<button[^>]*disabled=""[^>]*>Abrir servidor<\/button>/);

    const redeemedHtml = renderToStaticMarkup(
      React.createElement(NewRemoteServerClaimModal, {
        open: true,
        quota: null,
        initialClaim: {
          ...pendingClaim,
          status: "redeemed",
          paired_server: {
            server_id: "srv_vps_demo",
            nome: "VPS Cliente Demo",
            slug: "vps-cliente-demo",
            kind: "remote_vps",
            status: "online",
            cor_hex: "#4E8DFF",
            base_url: "http://198.51.100.25:3000",
            remote_ip: "198.51.100.25",
            is_active: false,
            created_at: new Date().toISOString(),
          },
        },
        onClose: () => {},
        onConfigureWithAgent: () => {},
        onOpenPairedServer: () => {},
      }),
    );

    assert.match(redeemedHtml, /Servidor conectado: VPS Cliente Demo/);
    assert.doesNotMatch(redeemedHtml, /<button[^>]*disabled=""[^>]*>Abrir servidor<\/button>/);

    const settingsHtml = renderToStaticMarkup(
      React.createElement(ServerSettingsModal, {
        open: true,
        server: {
          server_id: "srv_local_2",
          nome: "Servidor Cliente B",
          slug: "servidor-cliente-b",
          kind: "local_child",
          status: "online",
          cor_hex: "#31CF76",
          base_url: "http://127.0.0.1:4102",
          workspace_path: "/tmp/servidores/servidor-cliente-b",
          port: 4102,
          is_active: false,
          created_at: new Date().toISOString(),
        },
        onClose: () => {},
        onUpdated: () => {},
        onRemoved: () => {},
      }),
    );

    assert.match(settingsHtml, /Configurações do servidor/);
    assert.match(settingsHtml, /Gerar convite/);
    assert.match(settingsHtml, /Reiniciar processo/);
    assert.match(settingsHtml, /Remover conexão deste servidor/);
  });

  it("Teste 4 — Auditoria estática: zero <select> HTML nativos nos componentes de servidor e frontend", () => {
    const files = listTsxFiles(resolve(webRoot, "src"));
    const offenders = [];
    for (const f of files) {
      const content = readFileSync(f, "utf8");
      if (/<select[\s>]/i.test(content)) {
        offenders.push(f);
      }
    }
    assert.deepEqual(offenders, [], `Encontrados <select> nativos proibidos em: ${offenders.join(", ")}`);
  });
});
