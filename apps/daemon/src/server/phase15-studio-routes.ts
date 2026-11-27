/**
 * Sub-router HTTP REST da Fase 15:
 * Navegador Chromium CDP, Perfis/Proxies, BrowserTakeover, submit_secret, BrowserTeachBar,
 * Mídia (read_video / capture_screen), Duplicação & Failover de Agentes, Sidebar,
 * Configurações & Armazenamento, Conectores (Slack/Discord/GitHub) e Showcase Local.
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  BackupModelChoice,
  MensagemChat,
  ProviderName,
  SidebarLayoutMutation,
  StudioUserSettings,
} from "@criativo/contracts";
import {
  BackupModelsResolver,
} from "../engine/runner/backup-models-resolver.ts";
import {
  TranscriptionService,
} from "../voice/transcription-service.ts";
import {
  clearStorageCategory,
  computeStorageUsage,
  deleteStorageFile,
  getUserSettings,
  getWhatsNewInfo,
  updateUserSettings,
} from "./settings-storage-service.ts";
import {
  duplicateAgent,
  getSidebarLayout,
  mutateSidebarLayout,
} from "./sidebar-service.ts";
import {
  generateAgentChatReply,
} from "./studio-routes.ts";
import { ALLOWED_HUMAN_INPUT_TYPES, mapHttpErrorStatus, type Phase15RouteContext } from "./phase15-routes-types.ts";

export async function handlePhase15StudioRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  method: string,
  _url: URL,
  ctx: Phase15RouteContext,
): Promise<boolean> {
  const {
    db,
    wsHub,
    workspaceRoot,
    browserService,
    screenCapture,
    showcaseService,
    connectorsWebhook,
    sendJson,
    readJsonBody,
    readRawBody,
  } = ctx;
  void db; void wsHub; void workspaceRoot; void browserService; void screenCapture;
  void showcaseService; void connectorsWebhook; void readRawBody;

  // =========================================================================
  // 3. Agentes — Duplicação & Resposta ao UsageLimitAskCard
  // =========================================================================

  const dupAgentMatch = path.match(/^\/api\/agentes\/([^/]+)\/duplicar$/);
  if (method === "POST" && dupAgentMatch) {
    try {
      const agenteId = decodeURIComponent(dupAgentMatch[1]!);
      const out = duplicateAgent(db, agenteId, wsHub);
      sendJson(res, 201, out);
    } catch (err) {
      sendJson(res, mapHttpErrorStatus(err), {
        erro: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  const usageLimitRespMatch = path.match(/^\/api\/agentes\/([^/]+)\/uso-limite\/responder$/);
  if (method === "POST" && usageLimitRespMatch) {
    try {
      const agenteId = decodeURIComponent(usageLimitRespMatch[1]!);
      const body = await readJsonBody(req);
      const choiceRaw = (body.choice ?? body) as Record<string, unknown>;
      const modelo = typeof choiceRaw.modelo === "string" ? choiceRaw.modelo.trim() : "";
      if (!modelo) {
        sendJson(res, 400, { erro: "Informe o modelo reserva escolhido em 'choice.modelo'." });
        return true;
      }
      const provedor = (
        typeof choiceRaw.provedor === "string"
          ? choiceRaw.provedor
          : ctx.providers.resolveProviderName(modelo)
      ) as ProviderName;
      const choice: BackupModelChoice = {
        provedor,
        modelo,
        conta_id: typeof choiceRaw.conta_id === "string" ? choiceRaw.conta_id : null,
      };

      const resolver = ctx.backupResolver ?? new BackupModelsResolver();
      let backupConfig = undefined;
      if (body.remember === true) {
        backupConfig = resolver.rememberAutomaticFailover(db, agenteId, choice);
      }

      const askId = typeof body.askId === "string" ? body.askId.trim() : "";
      let pendingPrompt: string | null = null;
      let canalId = `agente:${agenteId}`;
      let threadId = `main:${agenteId}`;
      let anexos: unknown[] = [];

      if (askId) {
        const askRow = db.connection
          .prepare("SELECT valor_json FROM projecao_studio_config WHERE chave = ? LIMIT 1;")
          .get(`usage_limit_ask:${askId}`) as { valor_json: string } | undefined;
        if (askRow) {
          try {
            const parsed = JSON.parse(askRow.valor_json) as {
              userPrompt?: string;
              canalId?: string;
              threadId?: string;
              anexos?: unknown[];
            };
            pendingPrompt = parsed.userPrompt ?? null;
            canalId = parsed.canalId ?? canalId;
            threadId = parsed.threadId ?? threadId;
            anexos = Array.isArray(parsed.anexos) ? parsed.anexos : [];
          } catch {
            // ignore
          }
          db.connection
            .prepare("DELETE FROM projecao_studio_config WHERE chave = ?;")
            .run(`usage_limit_ask:${askId}`);
        }
      }

      const agenteRow = db.connection
        .prepare("SELECT * FROM projecao_agentes WHERE agente_id = ? LIMIT 1;")
        .get(agenteId) as Parameters<typeof generateAgentChatReply>[1] | undefined;

      if (agenteRow && pendingPrompt) {
        const turnoId = `turn-${randomUUID().slice(0, 8)}`;
        const reply = await generateAgentChatReply(
          ctx.studioRoutesDeps,
          agenteRow,
          pendingPrompt,
          anexos as never[],
          [],
          undefined,
          {
            threadId,
            turnoId,
            overrideModel: choice.modelo,
            overrideAccountId: choice.conta_id ?? null,
          },
        );
        const maxOrdRow = db.connection
          .prepare("SELECT COALESCE(MAX(ordinal), 0) AS max_ord FROM projecao_conversas_chat WHERE thread_id = ?;")
          .get(threadId) as { max_ord: number };
        const agentMsg: MensagemChat = {
          mensagem_id: `msg-${randomUUID()}`,
          canal_id: canalId,
          agente_id: agenteId,
          autor: "agente",
          autor_nome: agenteRow.nome,
          conteudo_markdown: reply.markdown,
          anexos: reply.anexosGerados,
          steps: reply.steps,
          tarefa_id: reply.tarefaCriadaId,
          thread_id: threadId,
          turno_id: turnoId,
          item_type: "mensagem",
          status: "completed",
          ordinal: maxOrdRow.max_ord + 1,
          lida: true,
          criado_em: new Date().toISOString(),
        };

        db.connection
          .prepare(
            `INSERT INTO projecao_conversas_chat (
              mensagem_id, canal_id, agente_id, autor, autor_nome, conteudo_markdown,
              anexos_json, steps_json, tarefa_id, lida, criado_em,
              thread_id, turno_id, item_type, status, resposta_para_mensagem_id,
              ordinal, branch_origem_mensagem_id, metadados_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 'mensagem', 'completed', NULL, ?, NULL, '{}');`,
          )
          .run(
            agentMsg.mensagem_id,
            agentMsg.canal_id,
            agentMsg.agente_id,
            agentMsg.autor,
            agentMsg.autor_nome ?? agenteRow.nome,
            agentMsg.conteudo_markdown,
            JSON.stringify(agentMsg.anexos),
            JSON.stringify(agentMsg.steps),
            agentMsg.tarefa_id ?? null,
            agentMsg.criado_em,
            threadId,
            turnoId,
            agentMsg.ordinal ?? 1,
          );

        wsHub.broadcast("chat:message", {
          canal_id: canalId,
          agente_id: agenteId,
          mensagem: agentMsg,
        });

        sendJson(res, 200, { ok: true, choice, backupConfig, mensagem: agentMsg });
        return true;
      }

      sendJson(res, 200, { ok: true, choice, backupConfig });
    } catch (err) {
      sendJson(res, mapHttpErrorStatus(err), {
        erro: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  // =========================================================================
  // 4. Sidebar — Layout Hierárquico, Drag-and-Drop & Pins
  // =========================================================================

  if (method === "GET" && path === "/api/sidebar/layout") {
    sendJson(res, 200, getSidebarLayout(db));
    return true;
  }

  if (method === "PUT" && path === "/api/sidebar/layout") {
    try {
      const body = await readJsonBody(req);
      const mutation = (
        body.mutation && typeof body.mutation === "object" ? body.mutation : body
      ) as unknown as SidebarLayoutMutation;
      const layout = mutateSidebarLayout(db, mutation, wsHub);
      sendJson(res, 200, layout);
    } catch (err) {
      sendJson(res, mapHttpErrorStatus(err), {
        erro: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  if (method === "POST" && path === "/api/sidebar/pins") {
    try {
      const body = await readJsonBody(req);
      const pins = Array.isArray(body.pins) ? body.pins.map(String) : [];
      const layout = mutateSidebarLayout(db, { op: "reorder_pins", pins }, wsHub);
      sendJson(res, 200, layout);
    } catch (err) {
      sendJson(res, mapHttpErrorStatus(err), {
        erro: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  // =========================================================================
  // 5. Configurações Unificadas, Atualizações & Armazenamento
  // =========================================================================

  if (method === "GET" && path === "/api/configuracoes") {
    sendJson(res, 200, { settings: getUserSettings(db) });
    return true;
  }

  if (method === "PUT" && path === "/api/configuracoes") {
    try {
      const body = await readJsonBody(req);
      const patch = (
        body.settings && typeof body.settings === "object" ? body.settings : body
      ) as Partial<StudioUserSettings>;
      const settings = updateUserSettings(db, patch, wsHub);
      sendJson(res, 200, { ok: true, settings });
    } catch (err) {
      sendJson(res, mapHttpErrorStatus(err), {
        erro: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  if (method === "GET" && path === "/api/configuracoes/atualizacoes") {
    sendJson(
      res,
      200,
      getWhatsNewInfo(
        workspaceRoot,
        ctx.studioRoutesDeps.productRoot ?? process.env.CRIATIVO_PRODUCT_ROOT
      )
    );
    return true;
  }

  if (method === "POST" && path === "/api/voz/transcrever") {
    try {
      const body = await readJsonBody(req);
      const rawAudio =
        typeof body.audio_base64 === "string" ? body.audio_base64.trim() : "";
      if (!rawAudio) {
        sendJson(res, 400, { erro: "Campo obrigatório: 'audio_base64'." });
        return true;
      }

      const rawMime =
        typeof body.mime_type === "string" && body.mime_type.trim()
          ? body.mime_type.trim().toLowerCase()
          : "audio/webm";
      const baseMime = rawMime.split(";")[0]?.trim() || "audio/webm";
      if (!baseMime.startsWith("audio/") && baseMime !== "video/webm") {
        sendJson(res, 400, { erro: `Formato de áudio não suportado: '${baseMime}'.` });
        return true;
      }

      const cleanBase64 = rawAudio.replace(/^data:[^;]+;base64,/i, "");
      if (cleanBase64.length > 20_000_000) {
        sendJson(res, 413, {
          ok: false,
          codigo: "PAYLOAD_TOO_LARGE",
          erro: "Áudio excede o limite de 15 MB.",
        });
        return true;
      }

      const audioBuffer = Buffer.from(cleanBase64, "base64");
      if (audioBuffer.length === 0) {
        sendJson(res, 400, { erro: "Áudio vazio ou base64 inválido." });
        return true;
      }
      if (audioBuffer.length > 15 * 1024 * 1024) {
        sendJson(res, 413, {
          ok: false,
          codigo: "PAYLOAD_TOO_LARGE",
          erro: "Áudio excede o limite de 15 MB.",
        });
        return true;
      }

      const transcriber =
        ctx.transcription ??
        (ctx.studioRoutesDeps.vault
          ? new TranscriptionService({ vault: ctx.studioRoutesDeps.vault })
          : null);
      if (!transcriber) {
        sendJson(res, 422, {
          ok: false,
          code: "MISSING_TRANSCRIPTION_KEY",
          codigo: "MISSING_TRANSCRIPTION_KEY",
          erro: "Cofre de transcrição indisponível neste servidor.",
        });
        return true;
      }

      const durationSec =
        typeof body.duration_sec === "number" && Number.isFinite(body.duration_sec)
          ? body.duration_sec
          : undefined;
      if (durationSec !== undefined && durationSec > 600) {
        sendJson(res, 400, {
          ok: false,
          codigo: "CRV-VOICE-DURATION",
          erro: "CRV-VOICE-DURATION: o ditado excede o limite de 10 minutos.",
        });
        return true;
      }
      const vadEnabled = body.vad_enabled !== false;
      const clientSpeechMs =
        typeof body.client_speech_ms === "number" && Number.isFinite(body.client_speech_ms)
          ? body.client_speech_ms
          : undefined;

      if (typeof transcriber.transcribeAudioDetailed === "function") {
        const detailed = await transcriber.transcribeAudioDetailed(audioBuffer, rawMime, {
          vadEnabled,
          clientSpeechMs,
          maxDurationSec: durationSec,
        });
        sendJson(res, 200, {
          ok: true,
          texto: detailed.texto,
          silent: detailed.silent,
          chunks_processados: detailed.chunks,
        });
        return true;
      }
      const texto = await transcriber.transcribeAudio(audioBuffer, rawMime);
      sendJson(res, 200, { ok: true, texto, silent: false, chunks_processados: 1 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("MISSING_TRANSCRIPTION_KEY")) {
        sendJson(res, 422, {
          ok: false,
          code: "MISSING_TRANSCRIPTION_KEY",
          codigo: "MISSING_TRANSCRIPTION_KEY",
          erro: msg,
        });
        return true;
      }
      sendJson(res, mapHttpErrorStatus(err), { ok: false, erro: msg });
    }
    return true;
  }

  if (method === "GET" && path === "/api/armazenamento") {
    sendJson(res, 200, computeStorageUsage(db, workspaceRoot));
    return true;
  }

  if (method === "POST" && path === "/api/armazenamento/limpar") {
    try {
      const body = await readJsonBody(req);
      const category =
        body.category === "browser_cache" || body.category === "temp_previews"
          ? body.category
          : null;
      if (!category) {
        sendJson(res, 400, {
          erro: "Categoria inválida. Use 'browser_cache' ou 'temp_previews'.",
        });
        return true;
      }
      const result = clearStorageCategory(db, workspaceRoot, category);
      sendJson(res, 200, { ...result, snapshot: computeStorageUsage(db, workspaceRoot) });
    } catch (err) {
      sendJson(res, mapHttpErrorStatus(err), {
        erro: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  const storageFileMatch = path.match(/^\/api\/armazenamento\/arquivos\/(.+)$/);
  if (method === "DELETE" && storageFileMatch) {
    try {
      const arquivoId = decodeURIComponent(storageFileMatch[1]!);
      const result = deleteStorageFile(db, workspaceRoot, arquivoId);
      sendJson(res, 200, { ...result, snapshot: computeStorageUsage(db, workspaceRoot) });
    } catch (err) {
      sendJson(res, mapHttpErrorStatus(err), {
        erro: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }


  return false;
}
