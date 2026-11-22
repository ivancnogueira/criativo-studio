import {
  resolveMetaGraphApiVersion,
  type AgentAllowedFolder,
  type AgentNotificationLevel,
  type AnexoChat,
  type AprendizadoConfig,
  type ArquivoStudio,
  type AvatarStyle,
  type BackupModelChoice,
  type BackupModelsConfig,
  type CanalEquipe,
  type CanalMemoria,
  type CanalNavegadorModo,
  type ChatVisualMeta,
  type ConversationMessage,
  type ConversationUiBlock,
  type DeletedNativeAgentInfo,
  type MemoriaInclusao,
  type MemoryReviewAlteracao,
  type MensagemChat,
  type OnboardingEstado,
  type PassoChat,
  type PermissionLevel,
  type ProviderName,
  type SkillSugestaoItem,
  type ToolDefinition,
  type UiBlockSubmitPayload,
  type UsageLimitAskPayload,
  type WorkflowAresta,
  type WorkflowNo,
  type WorkflowTraco,
  type WorkflowVisual,
} from "@criativo/contracts";
import type { SharedTablesService } from "../../agent-data/shared-tables-service.ts";
import { SharedTablesError } from "../../agent-data/shared-tables-service.ts";
import type { SkillLearningService } from "../../engine/runner/skill-learning-service.ts";
import type { LibraryFoldersService } from "../../engine/runner/library-folders-service.ts";
import { UiBlockHttpError, type UiBlockRegistry } from "../../engine/runner/ui-block-registry.ts";
import type { ApiKeysBridge } from "../../vault/api-keys-bridge.ts";
import type { StudioRouteContext } from "./route-helpers.ts";

export async function tryHandlePhase14Routes(ctx: StudioRouteContext): Promise<boolean> {
  const { req, res, path, method, url, deps, db, wsHub, workspaceRoot } = ctx;
  const { sendJson, readJsonBody } = deps;

  // =========================================================================
  // 7. Fase 14 — Shared Tables, Biblioteca Hierárquica, UI Blocks, SSE & Cofre
  // =========================================================================

  // 7.1 Shared Tables (/api/tabelas-compartilhadas)
  if (method === "GET" && path === "/api/tabelas-compartilhadas") {
    if (!deps.sharedTables) {
      sendJson(res, 503, { erro: "SharedTablesService não inicializado neste daemon." });
      return true;
    }
    const tables = await deps.sharedTables.listTablesForCockpit();
    sendJson(res, 200, { tables });
    return true;
  }

  if (method === "POST" && path === "/api/tabelas-compartilhadas/query") {
    if (!deps.sharedTables) {
      sendJson(res, 503, { erro: "SharedTablesService não inicializado neste daemon." });
      return true;
    }
    const body = await readJsonBody(req);
    const sql = typeof body.sql === "string" ? body.sql : "";
    const params = Array.isArray(body.params) ? body.params : undefined;
    try {
      const result = await deps.sharedTables.runCockpitReadQuery(sql, params);
      sendJson(res, 200, result);
    } catch (err) {
      const status = err instanceof SharedTablesError ? 400 : 500;
      sendJson(res, status, { erro: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  const sharedTableExportMatch = path.match(/^\/api\/tabelas-compartilhadas\/([^/]+)\/export$/);
  if (method === "GET" && sharedTableExportMatch) {
    if (!deps.sharedTables) {
      sendJson(res, 503, { erro: "SharedTablesService não inicializado neste daemon." });
      return true;
    }
    const tableName = decodeURIComponent(sharedTableExportMatch[1]);
    const formato = url.searchParams.get("formato") === "json" ? "json" : "csv";
    try {
      const exported = await deps.sharedTables.exportTable(tableName, formato);
      res.writeHead(200, {
        "Content-Type": exported.mimeType,
        "Content-Disposition": `attachment; filename="${exported.filename}"`,
        "X-Truncated": exported.truncated ? "1" : "0",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "Content-Disposition, X-Truncated",
      });
      res.end(exported.content);
    } catch (err) {
      const status = err instanceof SharedTablesError ? 400 : 500;
      sendJson(res, status, { erro: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  const sharedTableItemMatch = path.match(/^\/api\/tabelas-compartilhadas\/([^/]+)$/);
  if (sharedTableItemMatch && (method === "GET" || method === "DELETE")) {
    if (!deps.sharedTables) {
      sendJson(res, 503, { erro: "SharedTablesService não inicializado neste daemon." });
      return true;
    }
    const tableName = decodeURIComponent(sharedTableItemMatch[1]);
    try {
      if (method === "DELETE") {
        const deleted = await deps.sharedTables.removeTableAsUser(tableName);
        sendJson(res, 200, { ok: true, ...deleted });
        return true;
      }
      const limit = Number(url.searchParams.get("limit") ?? "100");
      const offset = Number(url.searchParams.get("offset") ?? "0");
      const busca = url.searchParams.get("busca") ?? "";
      const detail = await deps.sharedTables.inspectTableForCockpit(tableName, {
        limit: Number.isFinite(limit) ? limit : 100,
        offset: Number.isFinite(offset) ? offset : 0,
        busca,
      });
      sendJson(res, 200, detail);
    } catch (err) {
      const status = err instanceof SharedTablesError ? 400 : 500;
      sendJson(res, status, { erro: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  // 7.2 Biblioteca Hierárquica de Pastas (/api/bibliotecas/pastas)
  if (method === "GET" && path === "/api/bibliotecas/pastas") {
    if (!deps.libraryFolders) {
      sendJson(res, 503, { erro: "LibraryFoldersService não inicializado neste daemon." });
      return true;
    }
    sendJson(res, 200, deps.libraryFolders.getSnapshot());
    return true;
  }

  if (method === "POST" && path === "/api/bibliotecas/pastas/mover") {
    if (!deps.libraryFolders) {
      sendJson(res, 503, { erro: "LibraryFoldersService não inicializado neste daemon." });
      return true;
    }
    const body = await readJsonBody(req);
    const arquivoIds = Array.isArray(body.arquivo_ids)
      ? body.arquivo_ids.filter((id): id is string => typeof id === "string")
      : [];
    const pastaId = typeof body.pasta_id === "string" && body.pasta_id.trim() ? body.pasta_id.trim() : null;
    try {
      const moved = deps.libraryFolders.moveFilesToFolder(arquivoIds, pastaId);
      sendJson(res, 200, { ok: true, ...moved, snapshot: deps.libraryFolders.getSnapshot() });
    } catch (err) {
      sendJson(res, 400, { erro: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (method === "POST" && path === "/api/bibliotecas/pastas") {
    if (!deps.libraryFolders) {
      sendJson(res, 503, { erro: "LibraryFoldersService não inicializado neste daemon." });
      return true;
    }
    const body = await readJsonBody(req);
    const agenteId = typeof body.agente_id === "string" ? body.agente_id.trim() : "";
    const nome = typeof body.nome === "string" ? body.nome : "";
    const parentId = typeof body.parent_id === "string" && body.parent_id.trim() ? body.parent_id.trim() : null;
    if (!agenteId || !nome.trim()) {
      sendJson(res, 400, { erro: "Campos obrigatórios: 'agente_id' e 'nome'." });
      return true;
    }
    try {
      const pasta = deps.libraryFolders.createFolder({ agenteId, nome, parentId });
      sendJson(res, 201, { ok: true, pasta, snapshot: deps.libraryFolders.getSnapshot() });
    } catch (err) {
      sendJson(res, 400, { erro: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  const libraryFolderItemMatch = path.match(/^\/api\/bibliotecas\/pastas\/([^/]+)$/);
  if (libraryFolderItemMatch && (method === "PATCH" || method === "DELETE")) {
    if (!deps.libraryFolders) {
      sendJson(res, 503, { erro: "LibraryFoldersService não inicializado neste daemon." });
      return true;
    }
    const pastaId = decodeURIComponent(libraryFolderItemMatch[1]);
    try {
      if (method === "DELETE") {
        const out = deps.libraryFolders.deleteFolder(pastaId);
        sendJson(res, 200, { ok: true, ...out, snapshot: deps.libraryFolders.getSnapshot() });
        return true;
      }
      const body = await readJsonBody(req);
      const pasta = deps.libraryFolders.renameOrMoveFolder(pastaId, {
        nome: typeof body.nome === "string" ? body.nome : undefined,
        parentId:
          body.parent_id === null || typeof body.parent_id === "string"
            ? body.parent_id
            : undefined,
      });
      sendJson(res, 200, { ok: true, pasta, snapshot: deps.libraryFolders.getSnapshot() });
    } catch (err) {
      sendJson(res, 400, { erro: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  // 7.3 Chat Interativo, UI Blocks, SSE & Skill Learning (/api/chat/...)
  if (method === "GET" && path === "/api/chat/stream") {
    wsHub.registerSseClient(res, {
      canalId: url.searchParams.get("canal_id"),
      agenteId: url.searchParams.get("agente_id"),
      threadId: url.searchParams.get("thread_id"),
    });
    return true;
  }

  if (method === "POST" && path === "/api/chat/ui-response") {
    if (!deps.uiBlockRegistry) {
      sendJson(res, 503, { erro: "UiBlockRegistry não inicializado neste daemon." });
      return true;
    }
    const body = await readJsonBody(req);
    try {
      const outcome = deps.uiBlockRegistry.submitUiResponse(
        body as unknown as UiBlockSubmitPayload,
      );
      sendJson(res, 200, { ok: true, ...outcome });
    } catch (err) {
      const status = err instanceof UiBlockHttpError ? err.statusCode : 400;
      sendJson(res, status, { erro: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  const skillSuggestionActionMatch = path.match(
    /^\/api\/chat\/skill-sugestao\/([^/]+)\/(salvar|dispensar)$/,
  );
  if (method === "POST" && skillSuggestionActionMatch) {
    if (!deps.skillLearning) {
      sendJson(res, 503, { erro: "SkillLearningService não inicializado neste daemon." });
      return true;
    }
    const mensagemId = decodeURIComponent(skillSuggestionActionMatch[1]);
    const acao = skillSuggestionActionMatch[2];
    if (acao === "dispensar") {
      const sugestao = deps.skillLearning.dismissSuggestionByMessageId(mensagemId);
      if (!sugestao) {
        sendJson(res, 404, { erro: "Sugestão de habilidade não encontrada." });
        return true;
      }
      sendJson(res, 200, { ok: true, sugestao });
      return true;
    }

    const saved = await deps.skillLearning.saveSuggestionByMessageId(mensagemId);
    sendJson(res, saved.ok ? 200 : 400, saved);
    return true;
  }

  // 7.4 Cofre de API Keys (/api/cofre/api-keys)
  if (method === "GET" && path === "/api/cofre/api-keys") {
    if (!deps.apiKeysBridge) {
      sendJson(res, 503, { erro: "ApiKeysBridge não inicializado neste daemon." });
      return true;
    }
    const agenteId = url.searchParams.get("agente_id");
    sendJson(res, 200, { keys: deps.apiKeysBridge.listApiKeys(agenteId) });
    return true;
  }

  if (method === "POST" && path === "/api/cofre/api-keys") {
    if (!deps.apiKeysBridge) {
      sendJson(res, 503, { erro: "ApiKeysBridge não inicializado neste daemon." });
      return true;
    }
    const body = await readJsonBody(req);
    const name = typeof body.name === "string" ? body.name : typeof body.nome === "string" ? body.nome : "";
    const value = typeof body.value === "string" ? body.value : typeof body.valor === "string" ? body.valor : "";
    const scope = body.scope === "agente_especifico" ? "agente_especifico" : "todos_agentes";
    const agenteId = typeof body.agente_id === "string" ? body.agente_id : null;
    try {
      const saved = deps.apiKeysBridge.saveApiKey({
        name,
        value,
        scope,
        agenteId,
        origemTurno: "usuario_local",
      });
      sendJson(res, 201, { ok: true, ...saved });
    } catch (err) {
      sendJson(res, 400, { erro: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  const cofreKeyDeleteMatch = path.match(/^\/api\/cofre\/api-keys\/([^/]+)$/);
  if (method === "DELETE" && cofreKeyDeleteMatch) {
    if (!deps.apiKeysBridge) {
      sendJson(res, 503, { erro: "ApiKeysBridge não inicializado neste daemon." });
      return true;
    }
    const keyName = decodeURIComponent(cofreKeyDeleteMatch[1]);
    const rawScope = url.searchParams.get("scope");
    const scope =
      rawScope === "agente_especifico"
        ? "agente_especifico"
        : rawScope === "todos_agentes"
          ? "todos_agentes"
          : undefined;
    const agenteId = url.searchParams.get("agente_id");
    try {
      const out = deps.apiKeysBridge.removeApiKey({
        name: keyName,
        scope,
        agenteId,
        byUser: true,
      });
      sendJson(res, 200, { ok: true, ...out });
    } catch (err) {
      sendJson(res, 400, { erro: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  // 7.5 Configurações Globais de Aprendizado (/api/configuracoes/aprendizado)
  if (path === "/api/configuracoes/aprendizado" && (method === "GET" || method === "PUT")) {
    if (!deps.skillLearning) {
      sendJson(res, 503, { erro: "SkillLearningService não inicializado neste daemon." });
      return true;
    }
    if (method === "GET") {
      sendJson(res, 200, { configuracao: deps.skillLearning.getLearningConfig() });
      return true;
    }
    const body = await readJsonBody(req);
    const updated = deps.skillLearning.updateLearningConfig(body as Partial<AprendizadoConfig>);
    sendJson(res, 200, { ok: true, configuracao: updated });
    return true;
  }

  return false;
}
