import { randomUUID, createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AnexoChat, StatusTarefa, TarefaRegistro } from "@criativo/contracts";
import { CriativoDatabase, initializeDatabase } from "../database/client.ts";
import { FifoQueueManager } from "../queue/fifo-queue.ts";
import { recoverInterruptedTasks } from "../queue/task-recovery.ts";
import { CronScheduler } from "../routines/cron-scheduler.ts";
import { VaultService } from "../vault/vault-service.ts";
import { WebSocketHub } from "./websocket-hub.ts";
import { AgentWaitStore } from "../waits/agent-wait-store.ts";
import { AgentWaitsService } from "../waits/agent-waits-service.ts";
import type { WaVersionFetcher, WhatsAppStudioClient } from "@criativo/whatsapp";
import { readJsonBody, sendJson } from "./daemon-http-utils.ts";

export interface DaemonCoreRoutesDeps {
  db: CriativoDatabase;
  wsHub: WebSocketHub;
  queue: FifoQueueManager;
  vault: VaultService;
  cron: CronScheduler;
  whatsapp: WhatsAppStudioClient;
  waitStore: AgentWaitStore;
  waitsService: AgentWaitsService;
  recoveryReport: ReturnType<typeof recoverInterruptedTasks>;
}

export async function tryHandleDaemonCoreRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  method: string,
  url: URL,
  deps: DaemonCoreRoutesDeps
): Promise<boolean> {
  const { db, wsHub, queue, vault, cron, whatsapp, waitStore, waitsService, recoveryReport } = deps;

      // Healthcheck
      if (method === "GET" && path === "/health") {
        sendJson(res, 200, {
          status: "ok",
          service: "criativo-daemon",
          dbPath: db.dbPath,
          websocketClients: wsHub.connectedCount,
          crashRecovery: recoveryReport,
          timestamp: new Date().toISOString(),
        });
        return true;
      }

      // Fila & Tarefas
      if (method === "GET" && path === "/api/tarefas") {
        const statusParam = url.searchParams.get("status") as StatusTarefa | null;
        const tarefas = queue.listTasks(statusParam ?? undefined);
        sendJson(res, 200, { tarefas });
        return true;
      }

      if (method === "POST" && path === "/api/tarefas") {
        const body = await readJsonBody(req);
        if (typeof body.titulo !== "string" || typeof body.tipo !== "string") {
          sendJson(res, 400, { erro: "Campos obrigatórios: 'titulo' e 'tipo'." });
          return true;
        }
        const tarefa = queue.enqueueTask({
          titulo: body.titulo,
          tipo: body.tipo,
          prioridade: typeof body.prioridade === "number" ? body.prioridade : 5,
          agente_id: typeof body.agente_id === "string" ? body.agente_id : null,
          canal_origem:
            typeof body.canal_origem === "string"
              ? (body.canal_origem as TarefaRegistro["canal_origem"])
              : "web",
          payload:
            body.payload && typeof body.payload === "object"
              ? (body.payload as Record<string, unknown>)
              : {},
        });
        wsHub.broadcast("task:queued", {
          tarefa_id: tarefa.tarefa_id,
          tipo: tarefa.tipo,
          titulo: tarefa.titulo,
          prioridade: tarefa.prioridade,
          canal_origem: tarefa.canal_origem,
        });
        sendJson(res, 201, { tarefa });
        return true;
      }

      const tarefaActionMatch = path.match(/^\/api\/tarefas\/([^/]+)\/(aprovar|cancelar|retentar)$/);
      if (method === "POST" && tarefaActionMatch) {
        const tarefaId = decodeURIComponent(tarefaActionMatch[1]);
        const acao = tarefaActionMatch[2];
        const existing = queue.getTask(tarefaId);
        if (!existing) {
          sendJson(res, 404, { erro: `Tarefa ${tarefaId} não encontrada.` });
          return true;
        }

        if (acao === "cancelar") {
          const updated = queue.cancelTask(tarefaId);
          sendJson(res, 200, { tarefa: updated });
          return true;
        }
        if (acao === "retentar") {
          const updated = queue.retryTask(tarefaId);
          wsHub.broadcast("task:queued", {
            tarefa_id: updated.tarefa_id,
            tipo: updated.tipo,
            titulo: updated.titulo,
            prioridade: updated.prioridade,
            canal_origem: updated.canal_origem,
          });
          sendJson(res, 200, { tarefa: updated });
          return true;
        }
        if (acao === "aprovar") {
          const updated = queue.updateTaskStatus(tarefaId, "concluido", {
            ...(existing.resultado ?? {}),
            aprovado: true,
            aprovado_em: new Date().toISOString(),
          });
          wsHub.broadcast("task:completed", {
            tarefa_id: updated.tarefa_id,
            permalink_instagram:
              typeof updated.resultado?.permalink === "string"
                ? updated.resultado.permalink
                : null,
            tempo_total_ms: 0,
          });
          sendJson(res, 200, { tarefa: updated });
          return true;
        }
      }

      // Roster de Agentes
      if (method === "GET" && path === "/api/agentes") {
        const agentes = db.connection
          .prepare(`SELECT * FROM projecao_agentes ORDER BY ordem_exibicao ASC;`)
          .all();
        sendJson(res, 200, { agentes });
        return true;
      }

      const agentUpdateMatch = path.match(/^\/api\/agentes\/([^/]+)$/);
      if (method === "PUT" && agentUpdateMatch) {
        const agenteId = decodeURIComponent(agentUpdateMatch[1]);
        const body = await readJsonBody(req);
        const existing = db.connection
          .prepare(`SELECT * FROM projecao_agentes WHERE agente_id = ?;`)
          .get(agenteId) as { agente_id: string; modelo_padrao: string } | undefined;
        if (!existing) {
          sendJson(res, 404, { erro: `Agente '${agenteId}' não encontrado.` });
          return true;
        }
        const novoModelo =
          typeof body.modelo_padrao === "string" ? body.modelo_padrao : existing.modelo_padrao;
        db.connection
          .prepare(
            `UPDATE projecao_agentes SET modelo_padrao = ?, atualizado_em = ? WHERE agente_id = ?;`
          )
          .run(novoModelo, new Date().toISOString(), agenteId);
        const updated = db.connection
          .prepare(`SELECT * FROM projecao_agentes WHERE agente_id = ?;`)
          .get(agenteId);
        sendJson(res, 200, { agente: updated });
        return true;
      }

      const agentLogsMatch = path.match(/^\/api\/agentes\/([^/]+)\/logs$/);
      if (method === "GET" && agentLogsMatch) {
        const agenteId = decodeURIComponent(agentLogsMatch[1]);
        const logs = db.connection
          .prepare(
            `SELECT * FROM projecao_canal_mensagens WHERE de_agente_id = ? OR para_agente_id = ? ORDER BY enviado_em DESC LIMIT 50;`
          )
          .all(agenteId, agenteId);
        sendJson(res, 200, { logs });
        return true;
      }

      // Mensageria WhatsApp & Webhooks
      if (method === "GET" && path === "/api/mensageria/whatsapp/status") {
        sendJson(res, 200, whatsapp.getStatus());
        return true;
      }

      if (method === "POST" && path === "/api/mensageria/whatsapp/conectar") {
        try {
          await whatsapp.connect();
          sendJson(res, 200, whatsapp.getStatus());
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          sendJson(res, 500, { erro: msg, status: whatsapp.getStatus() });
        }
        return true;
      }

      if (method === "POST" && path === "/api/mensageria/whatsapp/desconectar") {
        await whatsapp.disconnect();
        sendJson(res, 200, { status: "desconectado" });
        return true;
      }

      const webhookMatch = path.match(/^\/api\/webhooks\/disparo\/([^/]+)$/);
      if (method === "POST" && webhookMatch) {
        const token = decodeURIComponent(webhookMatch[1]);
        const tokenHash = createHash("sha256").update(token).digest("hex");
        const webhook = db.connection
          .prepare(
            `SELECT * FROM projecao_webhooks WHERE chave_secreta_hash = ? AND ativo = 1;`
          )
          .get(tokenHash) as { webhook_id: string; tipo_evento: string } | undefined;

        if (!webhook) {
          sendJson(res, 401, { erro: "Token de webhook inválido ou inativo." });
          return true;
        }

        const body = await readJsonBody(req);
        const requestedWaitId =
          typeof body.waitId === "string"
            ? body.waitId
            : typeof body.wait_id === "string"
              ? body.wait_id
              : null;
        const matchedWait = requestedWaitId ? waitStore.getWait(requestedWaitId) : null;
        const waitEntregaId = `wh-${randomUUID().slice(0, 8)}`;
        const wakeResult = matchedWait
          ? waitsService.wakeForRun({
              agenteId: matchedWait.agente_id,
              waitId: matchedWait.espera_id,
              entregaDespertarId: waitEntregaId,
              webhookPayload: body,
            })
          : null;

        const tarefa = queue.enqueueTask({
          agente_id:
            matchedWait?.agente_id ??
            (typeof body.agente_id === "string" ? body.agente_id : null),
          canal_origem: "webhook",
          tipo: typeof body.tipo === "string" ? body.tipo : webhook.tipo_evento,
          titulo:
            typeof body.titulo === "string"
              ? body.titulo
              : matchedWait
                ? `Webhook despertou espera (${matchedWait.espera_id})`
                : `Disparo externo via webhook (${webhook.webhook_id})`,
          prioridade: typeof body.prioridade === "number" ? body.prioridade : 4,
          payload: {
            ...body,
            ...(wakeResult?.promptBlock
              ? {
                  woken_waits_block: wakeResult.promptBlock,
                  woken_wait_ids: wakeResult.woken.map((w) => w.espera_id),
                }
              : {}),
          },
        });

        db.connection
          .prepare(`UPDATE projecao_webhooks SET ultimo_disparo_em = ? WHERE webhook_id = ?;`)
          .run(new Date().toISOString(), webhook.webhook_id);

        wsHub.broadcast("task:queued", {
          tarefa_id: tarefa.tarefa_id,
          tipo: tarefa.tipo,
          titulo: tarefa.titulo,
          prioridade: tarefa.prioridade,
          canal_origem: tarefa.canal_origem,
        });
        sendJson(res, 202, { tarefa });
        return true;
      }

      // Rotinas
      if (method === "GET" && path === "/api/rotinas") {
        sendJson(res, 200, { rotinas: cron.listRoutines() });
        return true;
      }

      if (method === "POST" && path === "/api/rotinas") {
        const body = await readJsonBody(req);
        if (
          typeof body.titulo !== "string" ||
          typeof body.expressao_cron !== "string" ||
          typeof body.tipo_tarefa !== "string"
        ) {
          sendJson(res, 400, {
            erro: "Campos obrigatórios: 'titulo', 'expressao_cron' e 'tipo_tarefa'.",
          });
          return true;
        }
        const rotina = cron.createRoutine({
          titulo: body.titulo,
          expressao_cron: body.expressao_cron,
          tipo_tarefa: body.tipo_tarefa,
          timezone: typeof body.timezone === "string" ? body.timezone : "America/Sao_Paulo",
          payload_modelo:
            body.payload_modelo && typeof body.payload_modelo === "object"
              ? (body.payload_modelo as Record<string, unknown>)
              : {},
        });
        sendJson(res, 201, { rotina });
        return true;
      }

      // Vault
      if (method === "GET" && path === "/api/vault/status") {
        sendJson(res, 200, { chaves: vault.listSecretsMetadata() });
        return true;
      }

      if (method === "POST" && path === "/api/vault/salvar") {
        const body = await readJsonBody(req);
        if (typeof body.chave_nome !== "string" || typeof body.valor !== "string") {
          sendJson(res, 400, { erro: "Campos obrigatórios: 'chave_nome' e 'valor'." });
          return true;
        }
        vault.setSecret(body.chave_nome, body.valor);
        sendJson(res, 200, { ok: true, chave_nome: body.chave_nome });
        return true;
      }

  return false;
}
