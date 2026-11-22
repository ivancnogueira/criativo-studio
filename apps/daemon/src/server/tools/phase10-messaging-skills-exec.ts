import {
  mcpConfigErrors,
  normalizeMcpConfig,
  whatsAppNumberForms,
  type MarketplaceSourceFilter,
  type McpAcessoAgentes,
  type McpServidorConfig,
} from "@criativo/contracts";
import {
  DEFAULT_WHATSAPP_ACCOUNT_ID,
  WHATSAPP_MAX_POST_CHARS,
  WhatsAppArchiveService,
} from "@criativo/whatsapp";
import type { CriativoDatabase } from "../../database/client.ts";
import { maskMcpServerForClient, redactMcpPayload } from "../../mcp/mcp-redaction.ts";
import type { StudioExtensionToolDeps } from "./phase10-tools-schema.ts";
import {
  readStringArg,
  readStringArrayArg,
  readStringRecordArg,
  resolveSafeStudioMediaPath,
} from "./studio-tool-helpers.ts";

const HANDLED_NAMES = new Set([
  "messaging_list_places",
  "messaging_history",
  "messaging_post",
  "messaging_remember",
  "messaging_forget_memory",
  "list_mcp_servers",
  "save_mcp_server",
  "test_mcp_server",
  "set_mcp_server_enabled",
  "remove_mcp_server",
  "suggest_marketplace_app",
  "list_local_skills",
  "read_local_skill",
  "create_skill",
  "revise_skill",
  "install_local_skill",
  "set_skill_enabled",
  "uninstall_skill",
]);
function normalizeTargetWhatsAppJid(rawTarget: string): string {
  const trimmed = rawTarget.trim();
  if (trimmed.includes("@")) return trimmed;
  const digits = trimmed.replace(/[^0-9]/g, "");
  return digits ? `${digits}@s.whatsapp.net` : trimmed;
}

function isRecipientAuthorizedForAccount(
  db: CriativoDatabase,
  contaId: string,
  targetJid: string
): boolean {
  const account = db.connection
    .prepare(`SELECT jid_proprio, numero_telefone FROM whatsapp_contas WHERE conta_id = ? LIMIT 1;`)
    .get(contaId) as { jid_proprio?: string | null; numero_telefone?: string | null } | undefined;

  const targetForms = new Set(whatsAppNumberForms(targetJid));
  if (account) {
    const ownForms = new Set([
      ...(account.jid_proprio ? whatsAppNumberForms(account.jid_proprio) : []),
      ...(account.numero_telefone ? whatsAppNumberForms(account.numero_telefone) : []),
    ]);
    for (const form of targetForms) {
      if (ownForms.has(form)) return true;
    }
  }

  const rows = db.connection
    .prepare(
      `SELECT tipo, identificador_jid, telefone_normalizado, variantes_json
       FROM whatsapp_contatos_autorizados
       WHERE conta_id = ? AND permitido = 1;`
    )
    .all(contaId) as Array<{
    tipo: string;
    identificador_jid: string;
    telefone_normalizado: string | null;
    variantes_json: string;
  }>;

  for (const row of rows) {
    if (row.identificador_jid === targetJid) return true;
    if (row.tipo === "contato") {
      if (row.telefone_normalizado && targetForms.has(row.telefone_normalizado)) return true;
      try {
        const variants = JSON.parse(row.variantes_json) as unknown;
        if (Array.isArray(variants) && variants.some((v) => typeof v === "string" && targetForms.has(v))) {
          return true;
        }
      } catch {
        // ignora JSON inválido
      }
      if (whatsAppNumberForms(row.identificador_jid).some((f) => targetForms.has(f))) {
        return true;
      }
    }
  }

  return false;
}

export async function executePhase10MessagingMcpSkillTool(
  toolName: string,
  args: Record<string, unknown>,
  deps: StudioExtensionToolDeps,
  ctx: { workspaceRoot: string }
): Promise<{ handled: boolean; result?: unknown }> {
  if (!HANDLED_NAMES.has(toolName)) {
    return { handled: false };
  }
  const { workspaceRoot } = ctx;
  const getArchive = () =>
    new WhatsAppArchiveService({
      db: deps.db.connection,
      workspaceRoot,
    });

  const run = async (): Promise<unknown> => {
    switch (toolName) {
    case "messaging_list_places": {
      const contaId = readStringArg(args, "contaId", "conta_id");
      return getArchive().listPlaces(contaId);
    }

    case "messaging_history": {
      const contaId = readStringArg(args, "contaId", "conta_id");
      const chatJid = readStringArg(args, "chatJid", "chat_jid");
      const rawLimit = typeof args.limit === "number" ? args.limit : Number(args.limit ?? 30);
      const limit = Number.isFinite(rawLimit)
        ? Math.min(100, Math.max(1, Math.trunc(rawLimit)))
        : 30;
      const mensagens = getArchive().listHistory({ contaId, chatJid, limit });
      return {
        contaId: contaId ?? null,
        chatJid: chatJid ?? null,
        limit,
        total: mensagens.length,
        mensagens,
      };
    }

    case "messaging_post": {
      if (!deps.whatsappOrchestrator) {
        throw new Error("Orquestrador WhatsApp não está ativo neste daemon.");
      }
      const contaId = readStringArg(args, "contaId", "conta_id") ?? DEFAULT_WHATSAPP_ACCOUNT_ID;
      const rawTarget = readStringArg(args, "chatJid", "chat_jid", "to", "destinatario");
      if (!rawTarget) {
        throw new Error("Informe 'chatJid' do destinatário autorizado para envio.");
      }
      const targetJid = normalizeTargetWhatsAppJid(rawTarget);
      if (!isRecipientAuthorizedForAccount(deps.db, contaId, targetJid)) {
        throw new Error(
          `Destinatário '${rawTarget}' não está autorizado na conta WhatsApp '${contaId}'.`
        );
      }

      const text = typeof args.text === "string"
        ? args.text
        : typeof args.texto === "string"
          ? args.texto
          : "";
      if (text.length > WHATSAPP_MAX_POST_CHARS) {
        throw new Error(
          `Mensagem excede o limite de ${WHATSAPP_MAX_POST_CHARS} caracteres por envio no WhatsApp.`
        );
      }

      const rawMediaPath = readStringArg(args, "mediaPath", "media_path");
      const safeMediaPath = rawMediaPath
        ? resolveSafeStudioMediaPath(workspaceRoot, rawMediaPath)
        : undefined;

      if (!text.trim() && !safeMediaPath) {
        throw new Error("Informe 'text' ou 'mediaPath' para enviar no WhatsApp.");
      }

      const registro = await deps.whatsappOrchestrator.sendMessageAndArchive(
        contaId,
        targetJid,
        {
          text,
          mediaPath: safeMediaPath,
          caption: readStringArg(args, "caption", "legenda"),
          asAudioPtt: typeof args.asAudioPtt === "boolean" ? args.asAudioPtt : undefined,
        }
      );

      return { ok: true, mensagem: registro };
    }

    case "messaging_remember": {
      if (!deps.whatsappOrchestrator) {
        throw new Error("Orquestrador WhatsApp não está ativo neste daemon.");
      }
      const texto = readStringArg(args, "texto", "text", "memory");
      if (!texto) {
        throw new Error("Informe o campo 'texto' para gravar a memória operacional.");
      }
      const contaId = readStringArg(args, "contaId", "conta_id") ?? DEFAULT_WHATSAPP_ACCOUNT_ID;
      const chatJid = readStringArg(args, "chatJid", "chat_jid");
      const memoria = deps.whatsappOrchestrator.rememberChannelMemory({
        contaId,
        chatJid,
        texto,
        origem: "manual",
      });
      return { ok: Boolean(memoria), memoria };
    }

    case "messaging_forget_memory": {
      if (!deps.whatsappOrchestrator) {
        throw new Error("Orquestrador WhatsApp não está ativo neste daemon.");
      }
      const contaId = readStringArg(args, "contaId", "conta_id") ?? DEFAULT_WHATSAPP_ACCOUNT_ID;
      const memoriaId = readStringArg(args, "memoriaId", "memoria_id", "id");
      const texto = readStringArg(args, "texto", "text");
      const chatJid = readStringArg(args, "chatJid", "chat_jid");
      if (!memoriaId && !texto) {
        throw new Error("Informe 'memoriaId' ou 'texto' para remover a memória do canal.");
      }
      const removed = deps.whatsappOrchestrator.forgetChannelMemory({
        contaId,
        memoriaId,
        texto,
        chatJid,
      });
      return { ok: removed, removed };
    }

    // ------------------------------------------------------------------
    // 5 Tools MCP + Sugestão de App (MCP-03 / STORE-02 / D-07)
    // ------------------------------------------------------------------
    case "list_mcp_servers": {
      if (!deps.mcpGateway) {
        throw new Error("McpGateway não inicializado neste daemon.");
      }
      const includeDisabled =
        typeof args.includeDisabled === "boolean" ? args.includeDisabled : true;
      const agentId = readStringArg(args, "agentId", "agenteId");
      const servers = deps.mcpGateway.store
        .listServersForClient({ includeDisabled, agentId })
        .map((srv) => ({
          ...maskMcpServerForClient(srv),
          oauthStatus: deps.mcpGateway!.oauthProvider.getOAuthStatus(srv.mcp_id),
        }));

      return { total: servers.length, servidores: servers };
    }

    case "save_mcp_server": {
      if (!deps.mcpGateway) {
        throw new Error("McpGateway não inicializado neste daemon.");
      }
      const rawAcesso = (args.acesso ?? args.access) as Partial<McpAcessoAgentes> | undefined;
      const payload: Partial<McpServidorConfig> = {
        mcp_id: readStringArg(args, "mcp_id", "mcpId"),
        nome: readStringArg(args, "nome", "name"),
        transporte:
          args.transporte === "http" || args.transport === "http"
            ? "http"
            : args.transporte === "stdio" || args.transport === "stdio"
              ? "stdio"
              : undefined,
        comando: readStringArg(args, "comando", "command"),
        args: readStringArrayArg(args, "args"),
        env: readStringRecordArg(args, "env"),
        envPassthrough: readStringArrayArg(args, "envPassthrough", "env_passthrough"),
        workingDirectory:
          args.workingDirectory === null || args.working_directory === null
            ? null
            : readStringArg(args, "workingDirectory", "working_directory"),
        url: args.url === null ? null : readStringArg(args, "url"),
        headers: readStringRecordArg(args, "headers"),
        acesso:
          rawAcesso && typeof rawAcesso === "object"
            ? {
                mode: rawAcesso.mode === "agents" ? "agents" : "everyone",
                agentIds: Array.isArray(rawAcesso.agentIds)
                  ? rawAcesso.agentIds.filter((id): id is string => typeof id === "string")
                  : [],
              }
            : undefined,
        ativo: typeof args.ativo === "boolean" ? args.ativo : true,
      };

      const normalized = normalizeMcpConfig(payload);
      const errors = mcpConfigErrors(normalized);
      const firstErr = errors.nome ?? errors.comando ?? errors.url ?? errors.acesso;
      if (firstErr) {
        throw new Error(firstErr);
      }

      const saved = deps.mcpGateway.store.saveServer(payload);
      deps.mcpGateway.invalidateServer(saved.mcp_id);
      deps.mcpGateway.refreshProxyRoutes();

      const shouldProbe = args.testar === true || args.probe === true;
      const probe = shouldProbe ? await deps.mcpGateway.testServer(saved.mcp_id) : undefined;
      const latest = deps.mcpGateway.store.getServer(saved.mcp_id, false) ?? saved;
      const oauthStatus = deps.mcpGateway.oauthProvider.getOAuthStatus(saved.mcp_id);

      deps.wsHub?.broadcast("mcp.status_atualizado", {
        mcp_id: latest.mcp_id,
        ativo: latest.ativo,
        oauth_status: oauthStatus,
        qtd_ferramentas: probe?.toolCount ?? latest.qtdFerramentas,
        ultimo_erro: latest.ultimoErro ?? null,
      });

      return redactMcpPayload(
        {
          ok: true,
          servidor: maskMcpServerForClient({ ...latest, oauthStatus }),
          ...(probe ? { probe } : {}),
        },
        []
      );
    }

    case "test_mcp_server": {
      if (!deps.mcpGateway) {
        throw new Error("McpGateway não inicializado neste daemon.");
      }
      const mcpId = readStringArg(args, "mcpId", "mcp_id");
      if (!mcpId) {
        throw new Error("Informe 'mcpId' do servidor MCP a testar.");
      }

      const resultado = await deps.mcpGateway.testServer(mcpId);
      const server = deps.mcpGateway.store.getServer(mcpId, false);
      if (resultado.status === "needs_sign_in") {
        const motivo = resultado.error ?? `Autenticação OAuth necessária para '${server?.nome ?? mcpId}'.`;
        deps.wsHub?.broadcast("mcp.oauth_solicitado", {
          mcp_id: mcpId,
          nome: server?.nome ?? mcpId,
          app_slug: server?.origemAppSlug ?? null,
          authorize_url: resultado.authUrl ?? null,
          canal_id: deps.canalId ?? null,
          agente_id: deps.agenteId ?? null,
          motivo,
        });
        return redactMcpPayload(
          {
            ...resultado,
            ok: false,
            action: "sign_in",
            mcpId,
            nome: server?.nome ?? mcpId,
            appSlug: server?.origemAppSlug ?? null,
            motivo,
          },
          []
        );
      }

      return redactMcpPayload({ ...resultado, mcpId }, []);
    }

    case "set_mcp_server_enabled": {
      if (!deps.mcpGateway) {
        throw new Error("McpGateway não inicializado neste daemon.");
      }
      const mcpId = readStringArg(args, "mcpId", "mcp_id");
      if (!mcpId || typeof args.ativo !== "boolean") {
        throw new Error("Informe 'mcpId' e 'ativo' (boolean).");
      }

      const updated = deps.mcpGateway.store.setServerEnabled(mcpId, args.ativo);
      deps.mcpGateway.invalidateServer(mcpId);
      deps.mcpGateway.refreshProxyRoutes();
      const oauthStatus = deps.mcpGateway.oauthProvider.getOAuthStatus(mcpId);

      deps.wsHub?.broadcast("mcp.status_atualizado", {
        mcp_id: updated.mcp_id,
        ativo: updated.ativo,
        oauth_status: oauthStatus,
        qtd_ferramentas: updated.qtdFerramentas,
        ultimo_erro: updated.ultimoErro ?? null,
      });

      return {
        ok: true,
        servidor: maskMcpServerForClient({ ...updated, oauthStatus }),
      };
    }

    case "remove_mcp_server": {
      if (!deps.mcpGateway) {
        throw new Error("McpGateway não inicializado neste daemon.");
      }
      const mcpId = readStringArg(args, "mcpId", "mcp_id");
      if (!mcpId) {
        throw new Error("Informe 'mcpId' do servidor MCP a remover.");
      }

      await deps.mcpGateway.oauthProvider.signOut(mcpId).catch(() => undefined);
      deps.mcpGateway.invalidateServer(mcpId);
      const removed = deps.mcpGateway.store.removeServer(mcpId);
      deps.mcpGateway.refreshProxyRoutes();

      if (removed) {
        deps.wsHub?.broadcast("mcp.status_atualizado", {
          mcp_id: mcpId,
          ativo: false,
          oauth_status: "disconnected",
          qtd_ferramentas: 0,
          ultimo_erro: null,
        });
      }

      return { ok: removed, removed, mcpId };
    }

    case "suggest_marketplace_app": {
      if (!deps.catalogService) {
        throw new Error("CatalogService não inicializado neste daemon.");
      }
      const slug = readStringArg(args, "slug");
      const query = readStringArg(args, "query", "q");
      let app = slug ? deps.catalogService.findAppBySlug(slug) : null;
      if (!app && (query || slug)) {
        app = deps.catalogService.searchCatalogApps(query ?? slug ?? "", 1)[0] ?? null;
      }

      if (!app) {
        return {
          type: "marketplace_app_suggestion",
          found: false,
          app: null,
        };
      }

      return {
        type: "marketplace_app_suggestion",
        app: {
          slug: app.slug,
          name: app.name,
          tagline: app.tagline,
          category: app.category,
          verified: app.verified,
          prompts: app.prompts,
        },
      };
    }

    // ------------------------------------------------------------------
    // 7 Tools Skills (STORE-03 / D-09)
    // ------------------------------------------------------------------
    case "list_local_skills": {
      if (!deps.skillsManager) {
        throw new Error("SkillsManager não inicializado neste daemon.");
      }
      const skills = deps.skillsManager.listSkills({
        query: readStringArg(args, "query", "q"),
        source: (readStringArg(args, "source", "fonte") as MarketplaceSourceFilter) ?? "all",
        agentId: readStringArg(args, "agentId", "agenteId"),
        category: readStringArg(args, "category", "categoria"),
      });
      return { total: skills.length, skills };
    }

    case "read_local_skill": {
      if (!deps.skillsManager) {
        throw new Error("SkillsManager não inicializado neste daemon.");
      }
      const slugOrId = readStringArg(args, "slugOrId", "slug", "skillId", "skill_id");
      if (!slugOrId) {
        throw new Error("Informe 'slugOrId' da habilidade.");
      }
      const result = deps.skillsManager.readSkill(slugOrId);
      if (!result) {
        throw new Error(`Habilidade '${slugOrId}' não encontrada.`);
      }
      return result;
    }

    case "create_skill": {
      if (!deps.skillsManager) {
        throw new Error("SkillsManager não inicializado neste daemon.");
      }
      const name = readStringArg(args, "name", "nome");
      const description = readStringArg(args, "description", "descricao");
      const instructions = readStringArg(args, "instructions", "instrucoes");
      if (!name || !description || !instructions) {
        throw new Error("Informe 'name', 'description' e 'instructions' para criar a habilidade.");
      }
      const created = deps.skillsManager.createCustomSkill({
        name,
        slug: readStringArg(args, "slug"),
        description,
        category: readStringArg(args, "category", "categoria") ?? "Automação & Rotinas",
        instructions,
        agentIds: readStringArrayArg(args, "agentIds", "agentes"),
      });
      deps.wsHub?.broadcast("loja.skill_atualizada", {
        skill_id: created.skillId,
        acao: "criada",
      });
      return { ok: true, skill: created };
    }

    case "revise_skill": {
      if (!deps.skillsManager) {
        throw new Error("SkillsManager não inicializado neste daemon.");
      }
      const slugOrId = readStringArg(args, "slugOrId", "slug", "skillId", "skill_id");
      const instructions = readStringArg(args, "instructions", "instrucoes");
      if (!slugOrId || !instructions) {
        throw new Error("Informe 'slugOrId' e 'instructions' para revisar a habilidade.");
      }
      const updated = deps.skillsManager.reviseSkill(slugOrId, {
        name: readStringArg(args, "name", "nome"),
        description: readStringArg(args, "description", "descricao"),
        category: readStringArg(args, "category", "categoria"),
        instructions,
      });
      deps.wsHub?.broadcast("loja.skill_atualizada", {
        skill_id: updated.skillId,
        acao: "atualizada",
      });
      return { ok: true, skill: updated };
    }

    case "install_local_skill": {
      if (!deps.skillsManager) {
        throw new Error("SkillsManager não inicializado neste daemon.");
      }
      const slugOrId = readStringArg(args, "slugOrId", "slug", "skillId", "skill_id");
      if (!slugOrId) {
        throw new Error("Informe 'slugOrId' da habilidade a instalar.");
      }
      const targetAgentIds = readStringArrayArg(args, "targetAgentIds", "agentIds", "agentes");
      const installed = deps.skillsManager.installCatalogSkill(slugOrId, targetAgentIds);
      deps.wsHub?.broadcast("loja.skill_atualizada", {
        skill_id: installed.skillId,
        acao: "instalada",
      });
      return { ok: true, skill: installed };
    }

    case "set_skill_enabled": {
      if (!deps.skillsManager) {
        throw new Error("SkillsManager não inicializado neste daemon.");
      }
      const agenteId = readStringArg(args, "agenteId", "agentId") ?? deps.agenteId;
      const slugOrId = readStringArg(args, "slugOrId", "slug", "skillId", "skill_id");
      if (!agenteId || !slugOrId || typeof args.habilitada !== "boolean") {
        throw new Error("Informe 'agenteId', 'slugOrId' e 'habilitada' (boolean).");
      }
      const res = deps.skillsManager.setSkillEnabledForAgent(agenteId, slugOrId, args.habilitada);
      deps.wsHub?.broadcast("loja.skill_atualizada", {
        skill_id: res.skillId,
        acao: "vinculada",
      });
      return { ok: true, ...res };
    }

    case "uninstall_skill": {
      if (!deps.skillsManager) {
        throw new Error("SkillsManager não inicializado neste daemon.");
      }
      const slugOrId = readStringArg(args, "slugOrId", "slug", "skillId", "skill_id");
      if (!slugOrId) {
        throw new Error("Informe 'slugOrId' da habilidade a desinstalar.");
      }
      const res = deps.skillsManager.uninstallSkill(slugOrId);
      if (res.removed && res.skillId) {
        deps.wsHub?.broadcast("loja.skill_atualizada", {
          skill_id: res.skillId,
          acao: "removida",
        });
      }
      return { ok: res.removed, ...res };
    }
      default:
        return undefined;
    }
  };

  return { handled: true, result: await run() };
}
