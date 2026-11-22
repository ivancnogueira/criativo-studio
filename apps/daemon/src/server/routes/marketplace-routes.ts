import {
  normalizeWhatsAppPairingPhone,
  type MarketplaceSourceFilter,
  type MarketplaceTab,
  type McpAcessoAgentes,
  type McpServidorConfig,
  type WhatsAppConfigPayload,
  type WhatsAppMetodoPareamento,
  type WhatsAppModoOperacao,
  type WhatsAppPairingStatus,
} from "@criativo/contracts";
import { CatalogServiceError, type ConnectCatalogAppInput } from "../../marketplace/catalog-service.ts";
import { maskMcpServerForClient, redactMcpPayload } from "../../mcp/mcp-redaction.ts";
import type { StudioRouteContext } from "./route-helpers.ts";
import { resolveCallbackBaseUrl, sendError } from "./whatsapp-mcp-store-helpers.ts";

export async function tryHandleMarketplaceRoutes(ctx: StudioRouteContext): Promise<boolean> {
  const { req, res, path, method, url, deps, wsHub } = ctx;
  const { sendJson, readJsonBody } = deps;

  // ====================================================================
  // 3. LOJA UNIFICADA (/api/loja/*)
  // ====================================================================
  if (path.startsWith("/api/loja/")) {
    if (!deps.catalogService || !deps.skillsManager || !deps.githubImporter) {
      sendJson(res, 503, { erro: "Serviços da Loja Unificada não inicializados." });
      return true;
    }

    if (method === "GET" && path === "/api/loja/catalogo") {
      const q = url.searchParams.get("q") ?? url.searchParams.get("query") ?? undefined;
      const tab = (url.searchParams.get("tab") as MarketplaceTab | null) ?? undefined;
      const sourceFilter =
        ((url.searchParams.get("fonte") ?? url.searchParams.get("source")) as MarketplaceSourceFilter | null) ??
        undefined;
      const category = url.searchParams.get("category") ?? url.searchParams.get("categoria") ?? undefined;

      const snapshot = deps.catalogService.getCatalogSnapshot({
        q,
        tab,
        sourceFilter,
        category,
      });
      sendJson(res, 200, snapshot);
      return true;
    }

    const appDetailMatch = path.match(/^\/api\/loja\/apps\/([^/]+)$/);
    if (method === "GET" && appDetailMatch) {
      const slug = decodeURIComponent(appDetailMatch[1]);
      const detail = deps.catalogService.getAppDetail(slug);
      if (!detail) {
        sendJson(res, 404, { erro: `Aplicativo '${slug}' não encontrado na Loja.` });
        return true;
      }
      sendJson(res, 200, detail);
      return true;
    }

    const appConnectMatch = path.match(/^\/api\/loja\/apps\/([^/]+)\/conectar$/);
    if (method === "POST" && appConnectMatch) {
      const slug = decodeURIComponent(appConnectMatch[1]);
      try {
        const body = (await readJsonBody(req)) as ConnectCatalogAppInput;
        const callbackBaseUrl =
          typeof body.callbackBaseUrl === "string" && body.callbackBaseUrl.trim()
            ? body.callbackBaseUrl.trim()
            : resolveCallbackBaseUrl(req);
        const result = await deps.catalogService.connectCatalogApp(slug, {
          ...body,
          callbackBaseUrl,
        });

        if (result.mcpId) {
          const srv = result.server ?? deps.mcpGateway?.store.getServer(result.mcpId, false);
          wsHub.broadcast("mcp.status_atualizado", {
            mcp_id: result.mcpId,
            ativo: srv?.ativo ?? true,
            oauth_status:
              result.kind === "oauth"
                ? "signing_in"
                : deps.mcpGateway?.oauthProvider.getOAuthStatus(result.mcpId) ?? "disconnected",
            qtd_ferramentas: result.probe?.toolCount ?? srv?.qtdFerramentas ?? 0,
            ultimo_erro: srv?.ultimoErro ?? null,
          });
        } else if (result.native) {
          wsHub.broadcast("loja.app_atualizado", {
            app_slug: slug,
            acao: "conectado",
            ok: result.nativeAccount?.testado_ok ?? true,
          });
        }

        sendJson(res, 200, redactMcpPayload(result, []));
      } catch (err) {
        sendError(res, sendJson, err);
      }
      return true;
    }

    const appAccessMatch = path.match(/^\/api\/loja\/apps\/([^/]+)\/acesso$/);
    if (method === "PATCH" && appAccessMatch) {
      const slug = decodeURIComponent(appAccessMatch[1]);
      try {
        const body = await readJsonBody(req);
        const rawAcesso =
          body.acesso && typeof body.acesso === "object"
            ? (body.acesso as Partial<McpAcessoAgentes>)
            : body.access && typeof body.access === "object"
              ? (body.access as Partial<McpAcessoAgentes>)
              : ({
                  mode: body.mode === "agents" ? "agents" : "everyone",
                  agentIds: Array.isArray(body.agentIds)
                    ? body.agentIds.filter((id): id is string => typeof id === "string")
                    : [],
                } satisfies Partial<McpAcessoAgentes>);
        const contaId = typeof body.contaId === "string" ? body.contaId : undefined;
        const result = deps.catalogService.updateNativeAppAccess(slug, rawAcesso, contaId);
        wsHub.broadcast("loja.app_atualizado", {
          app_slug: slug,
          acao: "acesso",
        });
        sendJson(res, 200, redactMcpPayload(result, []));
      } catch (err) {
        sendError(res, sendJson, err);
      }
      return true;
    }

    const appTestMatch = path.match(/^\/api\/loja\/apps\/([^/]+)\/testar$/);
    if (method === "POST" && appTestMatch) {
      const slug = decodeURIComponent(appTestMatch[1]);
      try {
        const body = await readJsonBody(req);
        const contaId = typeof body.contaId === "string" ? body.contaId : undefined;
        const result = await deps.catalogService.testNativeApp(slug, contaId);
        wsHub.broadcast("loja.app_atualizado", {
          app_slug: slug,
          acao: "testado",
          ok: result.ok,
        });
        sendJson(res, 200, redactMcpPayload(result, []));
      } catch (err) {
        sendError(res, sendJson, err);
      }
      return true;
    }

    const appDeleteAccountMatch = path.match(/^\/api\/loja\/apps\/([^/]+)\/contas\/([^/]+)$/);
    if (method === "DELETE" && appDeleteAccountMatch) {
      const slug = decodeURIComponent(appDeleteAccountMatch[1]);
      const contaId = decodeURIComponent(appDeleteAccountMatch[2]);
      try {
        const result = deps.catalogService.deleteNativeAppAccount(slug, contaId);
        wsHub.broadcast("loja.app_atualizado", {
          app_slug: slug,
          acao: "conta_removida",
        });
        sendJson(res, 200, redactMcpPayload(result, []));
      } catch (err) {
        sendError(res, sendJson, err);
      }
      return true;
    }

    const agentInstallMatch = path.match(/^\/api\/loja\/agentes\/([^/]+)\/instalar$/);
    if (method === "POST" && agentInstallMatch) {
      const slug = decodeURIComponent(agentInstallMatch[1]);
      try {
        const body = await readJsonBody(req);
        const overrides =
          body.overrides && typeof body.overrides === "object"
            ? (body.overrides as Record<string, unknown>)
            : body;

        const hasManifestPayload =
          Boolean(body.manifest && typeof body.manifest === "object") ||
          ((slug === "importar" || slug === "personalizado") &&
            (typeof body.name === "string" || typeof body.promptBase === "string"));

        const targetPayload = hasManifestPayload
          ? ((body.manifest as Record<string, unknown>) ?? body)
          : slug;

        const installed = deps.catalogService.installAgentPackage(targetPayload, {
          name: typeof overrides.name === "string" ? overrides.name : typeof overrides.nome === "string" ? overrides.nome : undefined,
          model: typeof overrides.model === "string" ? overrides.model : typeof overrides.modelo_padrao === "string" ? overrides.modelo_padrao : undefined,
          pasta: typeof overrides.pasta === "string" ? overrides.pasta : undefined,
          customAgenteId: typeof overrides.customAgenteId === "string" ? overrides.customAgenteId : undefined,
          activateRoutines:
            typeof overrides.activateRoutines === "boolean" ? overrides.activateRoutines : undefined,
        });

        wsHub.broadcast("loja.agente_instalado", {
          agente_id: installed.agente.agente_id,
          slug,
        });
        sendJson(res, 201, installed);
      } catch (err) {
        sendError(res, sendJson, err);
      }
      return true;
    }

    const agentExportMatch = path.match(/^\/api\/loja\/agentes\/([^/]+)\/exportar$/);
    if (method === "GET" && agentExportMatch) {
      const agenteId = decodeURIComponent(agentExportMatch[1]);
      try {
        const exported = deps.catalogService.exportAgentTemplate(agenteId);
        sendJson(res, 200, exported);
      } catch (err) {
        sendError(res, sendJson, err);
      }
      return true;
    }

    const agentDuplicateMatch = path.match(/^\/api\/loja\/agentes\/([^/]+)\/duplicar$/);
    if (method === "POST" && agentDuplicateMatch) {
      const agenteId = decodeURIComponent(agentDuplicateMatch[1]);
      try {
        const body = await readJsonBody(req);
        const newName =
          typeof body.nome === "string"
            ? body.nome
            : typeof body.name === "string"
              ? body.name
              : undefined;
        const duplicated = deps.catalogService.duplicateAgent(agenteId, newName);
        wsHub.broadcast("loja.agente_instalado", {
          agente_id: duplicated.agente.agente_id,
          slug: duplicated.agente.agente_id,
        });
        sendJson(res, 201, duplicated);
      } catch (err) {
        sendError(res, sendJson, err);
      }
      return true;
    }

    if (method === "GET" && path === "/api/loja/github/inspecionar") {
      const repoUrl = url.searchParams.get("url") ?? "";
      const tipoParam = url.searchParams.get("tipo") ?? url.searchParams.get("kind") ?? "skills";
      const kind = tipoParam === "agents" ? "agents" : "skills";
      try {
        const preview = await deps.githubImporter.inspectRepository(repoUrl, kind);
        sendJson(res, 200, preview);
      } catch (err) {
        sendError(res, sendJson, err);
      }
      return true;
    }

    if (method === "POST" && path === "/api/loja/github/instalar") {
      try {
        const body = await readJsonBody(req);
        const repoUrl = typeof body.url === "string" ? body.url : "";
        const kindParam = body.kind ?? body.tipo ?? "skills";
        const kind = kindParam === "agents" ? "agents" : "skills";
        const itemPaths = Array.isArray(body.itemPaths)
          ? body.itemPaths.filter((p): p is string => typeof p === "string")
          : undefined;
        const targetAgentIds = Array.isArray(body.targetAgentIds)
          ? body.targetAgentIds.filter((id): id is string => typeof id === "string")
          : undefined;

        const installed = await deps.githubImporter.installFromGithub({
          url: repoUrl,
          kind,
          itemPaths,
          targetAgentIds,
        });

        for (const s of installed.installedSkills) {
          wsHub.broadcast("loja.skill_atualizada", {
            skill_id: s.skillId,
            acao: "instalada",
          });
        }
        for (const a of installed.installedAgents) {
          wsHub.broadcast("loja.agente_instalado", {
            agente_id: a.agente.agente_id,
            slug: a.agente.agente_id,
          });
        }

        sendJson(res, 201, installed);
      } catch (err) {
        sendError(res, sendJson, err);
      }
      return true;
    }

    if (method === "GET" && path === "/api/loja/habilidades") {
      const q = url.searchParams.get("q") ?? url.searchParams.get("query") ?? undefined;
      const source =
        ((url.searchParams.get("fonte") ?? url.searchParams.get("source")) as MarketplaceSourceFilter | null) ??
        "all";
      const agentId = url.searchParams.get("agenteId") ?? url.searchParams.get("agentId") ?? undefined;
      const category = url.searchParams.get("category") ?? url.searchParams.get("categoria") ?? undefined;
      sendJson(res, 200, {
        habilidades: deps.skillsManager.listSkills({
          query: q,
          source,
          agentId,
          category,
        }),
      });
      return true;
    }

    if (method === "POST" && path === "/api/loja/habilidades") {
      try {
        const body = await readJsonBody(req);
        const created = deps.skillsManager.createCustomSkill({
          name: String(body.name ?? body.nome ?? ""),
          slug: typeof body.slug === "string" ? body.slug : undefined,
          description: String(body.description ?? body.descricao ?? ""),
          category: String(body.category ?? body.categoria ?? "Automação & Rotinas"),
          instructions: String(body.instructions ?? body.instrucoes ?? ""),
          agentIds: Array.isArray(body.agentIds ?? body.agentes)
            ? ((body.agentIds ?? body.agentes) as unknown[]).filter(
                (id): id is string => typeof id === "string"
              )
            : undefined,
        });
        wsHub.broadcast("loja.skill_atualizada", {
          skill_id: created.skillId,
          acao: "criada",
        });
        sendJson(res, 201, { habilidade: created });
      } catch (err) {
        sendError(res, sendJson, err);
      }
      return true;
    }

    const skillDetailMatch = path.match(/^\/api\/loja\/habilidades\/([^/]+)$/);
    if (skillDetailMatch && (method === "GET" || method === "DELETE")) {
      const skillId = decodeURIComponent(skillDetailMatch[1]);
      if (method === "GET") {
        const found = deps.skillsManager.readSkill(skillId);
        if (!found) {
          sendJson(res, 404, { erro: `Habilidade '${skillId}' não encontrada.` });
          return true;
        }
        sendJson(res, 200, found);
        return true;
      }

      try {
        const resDel = deps.skillsManager.uninstallSkill(skillId);
        if (!resDel.removed) {
          sendJson(res, 404, { erro: `Habilidade '${skillId}' não está instalada.` });
          return true;
        }
        wsHub.broadcast("loja.skill_atualizada", {
          skill_id: resDel.skillId ?? skillId,
          acao: "removida",
        });
        sendJson(res, 200, { ok: true, ...resDel });
      } catch (err) {
        sendError(res, sendJson, err);
      }
      return true;
    }

    const skillInstallMatch = path.match(/^\/api\/loja\/habilidades\/([^/]+)\/instalar$/);
    if (method === "POST" && skillInstallMatch) {
      const skillId = decodeURIComponent(skillInstallMatch[1]);
      try {
        const body = await readJsonBody(req);
        const rawAgents = body.targetAgentIds ?? body.agentIds ?? body.agentes ?? [];
        const targetAgentIds = Array.isArray(rawAgents)
          ? rawAgents.filter((id): id is string => typeof id === "string")
          : [];
        const installed = deps.skillsManager.installCatalogSkill(skillId, targetAgentIds);
        wsHub.broadcast("loja.skill_atualizada", {
          skill_id: installed.skillId,
          acao: "instalada",
        });
        sendJson(res, 200, { habilidade: installed });
      } catch (err) {
        sendError(res, sendJson, err);
      }
      return true;
    }

    const skillAgentsBatchMatch = path.match(/^\/api\/loja\/habilidades\/([^/]+)\/agentes$/);
    if (method === "PUT" && skillAgentsBatchMatch) {
      const skillId = decodeURIComponent(skillAgentsBatchMatch[1]);
      try {
        const body = await readJsonBody(req);
        const rawAgents = body.agentIds ?? body.agentes ?? [];
        const agentIds = Array.isArray(rawAgents)
          ? rawAgents.filter((id): id is string => typeof id === "string")
          : [];
        const result = deps.skillsManager.setSkillAgentsBatch(skillId, agentIds);
        wsHub.broadcast("loja.skill_atualizada", {
          skill_id: result.skillId,
          acao: "vinculada",
        });
        sendJson(res, 200, { ok: true, ...result });
      } catch (err) {
        sendError(res, sendJson, err);
      }
      return true;
    }

    const agentSkillToggleMatch = path.match(
      /^\/api\/loja\/agentes\/([^/]+)\/habilidades\/([^/]+)$/
    );
    if (method === "PATCH" && agentSkillToggleMatch) {
      const agenteId = decodeURIComponent(agentSkillToggleMatch[1]);
      const skillId = decodeURIComponent(agentSkillToggleMatch[2]);
      try {
        const body = await readJsonBody(req);
        if (typeof body.habilitada !== "boolean") {
          sendJson(res, 400, { erro: "Campo obrigatório: 'habilitada' (boolean)." });
          return true;
        }
        const toggled = deps.skillsManager.setSkillEnabledForAgent(
          agenteId,
          skillId,
          body.habilitada
        );
        wsHub.broadcast("loja.skill_atualizada", {
          skill_id: toggled.skillId,
          acao: "vinculada",
        });
        sendJson(res, 200, { ok: true, ...toggled });
      } catch (err) {
        sendError(res, sendJson, err);
      }
      return true;
    }
  }

  return false;
}
