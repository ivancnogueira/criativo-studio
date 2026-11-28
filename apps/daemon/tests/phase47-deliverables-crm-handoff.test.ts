import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CriativoDatabase } from "../src/database/client.ts";
import { VaultService } from "../src/vault/vault-service.ts";
import { CrmService } from "../src/crm/crm-service.ts";
import { ShowcaseSiteService } from "../src/server/showcase-service.ts";
import { assertSafePublicHttpsUrl } from "../src/social/deliverable-url-guard.ts";
import { DeliverablePublisherService } from "../src/social/deliverable-publisher-service.ts";
import { createCommentDmCrmHandoffAdapter } from "../src/social/comment-dm-crm-handoff.ts";
import { MetaCommentDmClient } from "../src/social/meta-comment-dm-client.ts";
import { MetaCommentDmEngine } from "../src/social/meta-comment-dm-engine.ts";
import { MetaCommentDmService } from "../src/social/meta-comment-dm-service.ts";

test("DM47-04 Guarda anti-IP: bloqueia IP bruto de VPS, localhost, redes privadas e HTTP", () => {
  for (const unsafe of [
    "http://exemplo.invalid/guia",
    "https://203.0.113.10/guia.pdf",
    "https://192.168.1.50/guia.pdf",
    "http://localhost:3000/guia",
    "https://127.0.0.1/showcase/a",
    "https://[::1]/showcase/a",
  ]) {
    assert.throws(() => assertSafePublicHttpsUrl(unsafe), /HTTPS|Bloqueado|locais/i);
  }
  const safe = assertSafePublicHttpsUrl("https://exemplo-marca.github.io/entregaveis/guia/");
  assert.equal(safe.hostname, "exemplo-marca.github.io");
});

test("DM47-04 DeliverablePublisherService publica no GitHub Pages e protege Showcase contra IP bruto", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "deliv-pub-47-"));
  const db = new CriativoDatabase({ dbPath: ":memory:" });
  db.initializeDatabase();
  const vault = new VaultService(db, "chave-deliv-47");
  vault.setSecret("GITHUB_PAGES_TOKEN", "ghp_teste_000");
  vault.setSecret("GITHUB_PAGES_OWNER", "exemplo-marca");
  vault.setSecret("GITHUB_PAGES_REPO", "materiais-publicos");

  const pdfPath = join(workDir, "checklist.pdf");
  writeFileSync(pdfPath, "%PDF-1.4\n%conteudo exemplo\n", "utf8");

  const githubCalls: string[] = [];
  const fetchImpl = async (url: string, init?: { method?: string }) => {
    if (init?.method === "PUT") {
      githubCalls.push(url);
      return new Response(JSON.stringify({ commit: { sha: "abc123sha" } }), { status: 201 });
    }
    return new Response("", { status: 404 });
  };

  const showcase = new ShowcaseSiteService({ db, workspaceRoot: workDir });
  const publisher = new DeliverablePublisherService({
    db,
    vault,
    showcaseService: showcase,
    workspaceRoot: workDir,
    fetchImpl: fetchImpl as never,
  });

  try {
    const rec = await publisher.publishDeliverable({
      titulo: "Checklist Oferta",
      descricao: "Guia passo a passo",
      source_type: "github_pages",
      local_file_path: "checklist.pdf",
      agente_id: "diretor_entregaveis",
    });

    assert.equal(rec.source_type, "github_pages");
    assert.equal(rec.public_https_url, "https://exemplo-marca.github.io/materiais-publicos/entregaveis/checklist-oferta/");
    assert.equal(rec.github_commit_sha, "abc123sha");
    assert.equal(githubCalls.length, 2, "Deve subir o arquivo e o index.html no GitHub Pages");

    // Showcase com IP bruto deve falhar
    await assert.rejects(
      () =>
        publisher.publishDeliverable({
          titulo: "Tentativa IP",
          source_type: "showcase_https",
          public_base_url: "https://203.0.113.10",
          html_content: "<h1>Oi</h1>",
        }),
      /IPs brutos/i
    );

    // Showcase com dominio HTTPS valido deve funcionar
    const scRec = await publisher.publishDeliverable({
      titulo: "Vitrine Segura",
      source_type: "showcase_https",
      public_base_url: "https://estudio.exemplo.invalid",
      html_content: "<h1>Vitrine</h1>",
    });
    assert.equal(scRec.public_https_url, "https://estudio.exemplo.invalid/showcase/vitrine-segura/");
  } finally {
    db.close();
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("DM47-04 CRM upsert + tags, WorkflowEngine trigger e Handoff IA protegido pela janela 24h", async () => {
  const db = new CriativoDatabase({ dbPath: ":memory:" });
  db.initializeDatabase();
  const vault = new VaultService(db, "chave-crm-47");
  vault.setSecret("IG_ACCESS_TOKEN", "ig-tok-crm");
  vault.setSecret("IG_USER_ID", "17841400999");

  const crmService = new CrmService(db);
  const dmSent: Array<Record<string, unknown>> = [];
  const workflowTriggered: Array<{ id: string; inputs: unknown }> = [];

  const client = new MetaCommentDmClient({
    vault,
    fetchImpl: (async (_u: string, init?: { body?: string }) => {
      dmSent.push(JSON.parse(init?.body ?? "{}") as Record<string, unknown>);
      return new Response(JSON.stringify({ message_id: "m-crm" }), { status: 200 });
    }) as never,
  });

  const adapter = createCommentDmCrmHandoffAdapter({
    crmService,
    workflowEngine: {
      startRun: async (opts: { workflowId: string; payload?: unknown }) => {
        workflowTriggered.push({ id: opts.workflowId, inputs: opts.payload });
        return { run: { run_id: "run-1" } };
      },
    } as never,
    client,
    agentExecutor: {
      replyInDmWindow: async ({ prompt }) => `Resposta IA contextualizada para: ${prompt.slice(0, 30)}`,
    },
  });

  const engine = new MetaCommentDmEngine({
    db,
    client,
    crmHooks: adapter,
  });
  const service = new MetaCommentDmService({ db, engine });

  service.createRule({
    conta_id: "principal",
    nome: "Funil CRM + IA",
    ativo: true,
    match_mode: "contains",
    keywords: ["quero"],
    post_scope: "all_posts",
    crm_tags: ["lead_instagram"],
    opening_message: { text: "Clique para receber:", button_label: "Sim", next_node_id: "n-email" },
    flow_nodes: [
      {
        node_id: "n-email",
        type: "collect_input",
        input_kind: "email",
        prompt_text: "Seu e-mail:",
        crm_tags: ["email_capturado"],
        next_node_id: "n-wf",
      },
      { node_id: "n-wf", type: "trigger_workflow", workflow_id: "wf-nutricao", next_node_id: "n-ia" },
      { node_id: "n-ia", type: "handoff_agent", handoff_agent_id: "estrategista", handoff_greeting: "Oi, assumi por aqui!" },
    ],
  });

  const openRes = await engine.handleIncomingComment({
    contaId: "principal",
    commentId: "c-crm-1",
    mediaId: "m-crm-1",
    senderIgId: "ig-lead-1",
    senderUsername: "seguidor_vip",
    text: "quero participar",
    timestamp: new Date().toISOString(),
    sourceMode: "direct_webhook",
  });
  assert.equal(openRes.outcome, "sent");

  // Clique abre 24h e pede email
  await engine.handleIncomingDmInteraction({
    contaId: "principal",
    senderIgId: "ig-lead-1",
    postbackPayload: `dm_open:${openRes.sessionId}`,
    timestamp: new Date().toISOString(),
  });

  // Resposta com email -> grava CRM com tags + dispara Workflow + Handoff para estrategista
  const afterEmail = await engine.handleIncomingDmInteraction({
    contaId: "principal",
    senderIgId: "ig-lead-1",
    text: "contato@exemplo.invalid",
    timestamp: new Date().toISOString(),
  });
  assert.equal(afterEmail.outcome, "handed_off");

  const contacts = crmService.listContacts("contato@exemplo.invalid");
  assert.equal(contacts.length, 1);
  assert.ok(contacts[0]!.tags.includes("lead_instagram"));
  assert.ok(contacts[0]!.tags.includes("email_capturado"));
  assert.equal(workflowTriggered.length, 1);
  assert.equal(workflowTriggered[0]!.id, "wf-nutricao");

  // Testa bloqueio fora da janela 24h
  const expiredHandoff = await adapter.handoffToCreativeAgent({
    agentId: "estrategista",
    session: {
      session_id: "s-exp",
      rule_id: "r1",
      conta_id: "principal",
      comment_id: "c1",
      media_id: "m1",
      ig_user_id: "ig-lead-1",
      ig_username: "@seguidor_vip",
      anchor_spent: true,
      window_24h_expires_at: new Date(Date.now() - 10_000).toISOString(),
      current_node_id: null,
      waiting_for: null,
      collected_data: {},
      next_run_at: null,
      status: "handed_off",
      criado_em: new Date().toISOString(),
      atualizado_em: new Date().toISOString(),
    },
    rule: service.listRules()[0]!,
    incomingText: "Oi",
  });
  assert.equal(expiredHandoff.ok, false);
  assert.equal(expiredHandoff.erro, "window_24h_closed");

  db.close();
});
