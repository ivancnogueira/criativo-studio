import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { CriativoDatabase } from "../src/database/client.ts";
import { CrmService } from "../src/crm/crm-service.ts";
import { VaultService } from "../src/vault/vault-service.ts";
import { ShowcaseSiteService } from "../src/server/showcase-service.ts";
import { tryHandleSocialCommentDmRoutes } from "../src/server/social-comment-dm-routes.ts";
import {
  executeMeta2026Tool,
  isMeta2026ToolName,
} from "../src/server/tools/meta-2026-tools-exec.ts";
import { createPhase47Runtime } from "../src/social/phase47-runtime.ts";

function makeSignedRequest(rawBody: string, appSecret: string) {
  const sig = `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
  const req = Readable.from([Buffer.from(rawBody, "utf8")]) as unknown as IncomingMessage;
  req.method = "POST";
  req.url = "/api/instagram/webhook";
  req.headers = {
    "content-type": "application/json",
    "x-hub-signature-256": sig,
  };
  return req;
}

function makeMockResponse() {
  let body = "";
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) {
      this.headers[k] = String(v);
    },
    end(chunk?: string) {
      if (chunk) body += chunk;
    },
    getBody() {
      return body;
    },
  };
  return res as unknown as ServerResponse & { getBody: () => string };
}

test("DM47-06 E2E completo: MCP tools, rascunho sempre pausado, webhook HMAC -> 24h -> CRM -> entregavel -> handoff IA", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "phase47-e2e-"));
  const db = new CriativoDatabase({ dbPath: ":memory:" });
  db.initializeDatabase();

  const vault = new VaultService(db, "chave-e2e-47");
  vault.setSecret("GITHUB_PAGES_TOKEN", "ghp_e2e_000");
  vault.setSecret("GITHUB_PAGES_OWNER", "exemplo-marca");
  vault.setSecret("GITHUB_PAGES_REPO", "materiais-publicos");
  vault.setSecret("IG_ACCESS_TOKEN", "igaat_e2e_token");
  vault.setSecret("IG_USER_ID", "17841400000047");
  vault.setSecret("IG_APP_SECRET", "segredo_webhook_e2e");

  const pdfPath = join(workDir, "guia-e2e.pdf");
  writeFileSync(pdfPath, "%PDF-1.4\n%conteudo E2E\n", "utf8");

  const sentMetaCalls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchImpl = async (url: string, init?: { method?: string; body?: string }) => {
    if (url.startsWith("https://api.github.com/") && init?.method === "PUT") {
      return new Response(JSON.stringify({ commit: { sha: "sha_e2e_001" } }), { status: 201 });
    }
    if (url.startsWith("https://api.github.com/")) {
      return new Response("", { status: 404 });
    }
    const parsedBody = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    sentMetaCalls.push({ url, body: parsedBody });
    return new Response(
      JSON.stringify({ id: `msg_${sentMetaCalls.length}`, recipient_id: "ig_user_999" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const crmService = new CrmService(db);
  const showcaseService = new ShowcaseSiteService({ db, workspaceRoot: workDir });

  const rt = createPhase47Runtime({
    db,
    vault,
    workspaceRoot: workDir,
    showcaseService,
    crmService,
    agentExecutor: {
      replyInDmWindow: async ({ prompt }) => `Criativo IA recebeu com janela 24h ativa: ${prompt}`,
    },
    fetchImpl: fetchImpl as never,
  });

  try {
    // Ciclo de vida inicia e para sem erros
    rt.start();

    for (const toolName of [
      "meta_listar_regras_comentario_dm",
      "meta_criar_rascunho_regra_dm",
      "meta_simular_fluxo_comentario_dm",
      "publicar_entregavel_publico",
    ]) {
      assert.equal(isMeta2026ToolName(toolName), true, `${toolName} deve estar registrada em META_2026_TOOLS_SCHEMA`);
    }

    const toolDeps = {
      db,
      vault,
      workspaceRoot: workDir,
      agenteId: "diretor_entregaveis",
      showcaseService,
      phase47Runtime: rt,
      fetchImpl: fetchImpl as never,
    };

    // 1. diretor_entregaveis publica entregavel publico HTTPS
    const pubRes = (await executeMeta2026Tool(
      "publicar_entregavel_publico",
      {
        titulo: "Guia Completo E2E",
        descricao: "Material para leads do Instagram",
        slug: "guia-e2e",
        source_type: "github_pages",
        local_file_path: "guia-e2e.pdf",
      },
      toolDeps,
      { workspaceRoot: workDir, nativeStore: null }
    )) as { ok: boolean; public_https_url: string; deliverable: { deliverable_id: string } };

    assert.equal(pubRes.ok, true);
    assert.match(pubRes.public_https_url, /^https:\/\/exemplo-marca\.github\.io\/materiais-publicos\/entregaveis\/guia-e2e\/$/);

    // 2. Agente tenta criar regra passando ativo: true -> deve ser forcadamente pausada (ativo: false)
    const draftRes = (await executeMeta2026Tool(
      "meta_criar_rascunho_regra_dm",
      {
        nome: "Campanha Guia E2E",
        ativo: true,
        match_mode: "contains",
        keywords: ["QUERO"],
        post_scope: "all_posts",
        opening_text: "Oi! Toque abaixo para liberar seu Guia Completo:",
        button_label: "Quero receber!",
        crm_tags: ["instagram", "e2e-guia"],
        flow_nodes: [
          {
            node_id: "n-collect",
            type: "collect_input",
            input_kind: "email",
            prompt_text: "Qual seu melhor e-mail?",
            crm_tags: ["lead-qualificado"],
            next_node_id: "n-deliv",
          },
          {
            node_id: "n-deliv",
            type: "send_deliverable_card",
            deliverable_id: pubRes.deliverable.deliverable_id,
            card_title: "Aqui esta seu Guia!",
            card_subtitle: "Clique para baixar em HTTPS",
            button_text: "Abrir Guia",
            next_node_id: "n-handoff",
          },
          {
            node_id: "n-handoff",
            type: "handoff_agent",
            handoff_agent_id: "atendimento",
            handoff_greeting: "Conectando voce com nosso especialista!",
            next_node_id: null,
          },
        ],
      },
      { ...toolDeps, agenteId: "social_media" },
      { workspaceRoot: workDir, nativeStore: null }
    )) as { ok: boolean; status: string; rule: { rule_id: string; ativo: boolean } };

    assert.equal(draftRes.ok, true);
    assert.equal(draftRes.status, "paused_draft");
    assert.equal(draftRes.rule.ativo, false);

    // 3. Listagem + Dry-Run antes de ativar
    const listRes = (await executeMeta2026Tool(
      "meta_listar_regras_comentario_dm",
      {},
      toolDeps,
      { workspaceRoot: workDir, nativeStore: null }
    )) as { ok: boolean; rules: Array<{ rule_id: string }> };
    assert.equal(listRes.ok, true);
    assert.equal(listRes.rules.length, 1);

    const simRes = (await executeMeta2026Tool(
      "meta_simular_fluxo_comentario_dm",
      {
        rule_id: draftRes.rule.rule_id,
        comment_text: "Eu QUERO esse guia!",
        simulate_button_click: true,
        collect_input_value: "lead@exemplo.invalid",
      },
      toolDeps,
      { workspaceRoot: workDir, nativeStore: null }
    )) as { ok: boolean; simulation: { matched: boolean; trace: unknown[] } };
    assert.equal(simRes.ok, true);
    assert.equal(simRes.simulation.matched, true);
    assert.ok(simRes.simulation.trace.length >= 3);

    // 4. Humano revisa e ativa a regra (sem exige aprovacao por comentario para fluxo automatico)
    rt.service.updateRule(draftRes.rule.rule_id, {
      ativo: true,
      require_human_approval: false,
    });

    // Helper para chamar rota HTTP Direta Meta assinada por HMAC-SHA256
    const dispatchSignedWebhook = async (payloadObj: Record<string, unknown>) => {
      const raw = JSON.stringify(payloadObj);
      const req = makeSignedRequest(raw, "segredo_webhook_e2e");
      const res = makeMockResponse();
      const handled = await tryHandleSocialCommentDmRoutes({
        req,
        res,
        path: "/api/instagram/webhook",
        method: "POST",
        url: new URL("http://localhost/api/instagram/webhook"),
        db,
        wsHub: undefined as never,
        workspaceRoot: workDir,
        deps: {
          sendJson: (r, status, data) => {
            r.statusCode = status;
            r.setHeader("Content-Type", "application/json");
            r.end(JSON.stringify(data));
          },
          readJsonBody: async () => payloadObj,
          vault,
          phase47: rt,
          crmService,
        } as never,
      });
      assert.equal(handled, true);
      assert.equal(res.statusCode, 200);
    };

    // 4a. Comentario no Instagram dispara Private Reply inicial
    await dispatchSignedWebhook({
      object: "instagram",
      entry: [
        {
          id: "17841400000047",
          changes: [
            {
              field: "comments",
              value: {
                id: "comment_e2e_1",
                text: "QUERO muito!",
                from: { id: "ig_user_999", username: "lead_exemplo" },
                media: { id: "media_post_1" },
              },
            },
          ],
        },
      ],
    });
    assert.equal(sentMetaCalls.length, 1);

    // Recupera session criada pelo comentario
    const sessionRow = db.connection
      .prepare("SELECT session_id FROM meta_dm_flow_sessions ORDER BY criado_em DESC LIMIT 1;")
      .get() as { session_id: string };
    assert.ok(sessionRow?.session_id);

    // 4b. Seguidor clica no botao -> postback abre janela 24h e pede e-mail
    await dispatchSignedWebhook({
      object: "instagram",
      entry: [
        {
          id: "17841400000047",
          messaging: [
            {
              sender: { id: "ig_user_999" },
              recipient: { id: "17841400000047" },
              postback: {
                title: "Quero receber!",
                payload: `CRV_OPEN:${draftRes.rule.rule_id}:${sessionRow.session_id}`,
              },
            },
          ],
        },
      ],
    });
    assert.equal(sentMetaCalls.length, 2); // Pergunta de collect_input enviada

    // 4c. Seguidor responde com seu e-mail -> grava CRM + envia cartao entregavel HTTPS + handoff IA 24h
    await dispatchSignedWebhook({
      object: "instagram",
      entry: [
        {
          id: "17841400000047",
          messaging: [
            {
              sender: { id: "ig_user_999" },
              recipient: { id: "17841400000047" },
              message: {
                mid: "mid_e2e_reply_1",
                text: "lead.e2e@exemplo.invalid",
              },
            },
          ],
        },
      ],
    });

    // 4d. Seguidor faz pergunta livre na janela 24h -> Criativo IA responde via handoff
    await dispatchSignedWebhook({
      object: "instagram",
      entry: [
        {
          id: "17841400000047",
          messaging: [
            {
              sender: { id: "ig_user_999" },
              recipient: { id: "17841400000047" },
              message: {
                mid: "mid_e2e_reply_2",
                text: "Quero saber sobre os planos!",
              },
            },
          ],
        },
      ],
    });

    // Verifica CRM + envio do entregavel HTTPS + resposta do Handoff IA
    const leads = crmService.listContacts("lead.e2e@exemplo.invalid");
    assert.equal(leads.length, 1);
    assert.ok(leads[0].tags.includes("instagram"));
    assert.ok(leads[0].tags.includes("lead-qualificado"));

    const allBodies = JSON.stringify(sentMetaCalls);
    assert.match(allBodies, /https:\/\/exemplo-marca\.github\.io\/materiais-publicos\/entregaveis\/guia-e2e\//);
    assert.match(allBodies, /Criativo IA recebeu com janela 24h ativa/);
  } finally {
    rt.dispose();
    db.close();
    rmSync(workDir, { recursive: true, force: true });
  }
});
