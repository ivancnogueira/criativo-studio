import { randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, extname, relative, resolve, sep } from "node:path";
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
import {
  getDeletedNativeAgentsMeta,
  getSetupCompatibleRoster,
  markNativeAgentDeleted,
  ROSTER_15_AGENTES,
  SETUP_ASSISTANT_AGENT_DEF,
  unmarkNativeAgentDeleted,
} from "../../engine/runner/roster-defaults.ts";
import {
  activateUpgradePackage,
  computeUnlockedAgentsSummary,
  evaluateAndSyncSetupCompletion,
  getBrandIdentity,
  hasConfiguredBrand,
  importBrandPdfFromBuffer,
  interpolateBrandPlaceholders,
  isSetupAssistantVisible,
  isVpsAssistantVisible,
  listUpgradePackages,
  saveBrandIdentity,
  setSetupAssistantState,
  setVpsAssistantState,
  syncBrandPlaceholdersInDatabase,
} from "../brand-onboarding-service.ts";
import {
  generateImageTool,
  resolveVaultSecretCaseInsensitive,
} from "../../engine/tools/generate-image.ts";
import type { StudioRouteContext } from "./route-helpers.ts";
import { sanitizeAvatarStyle, sanitizeFileName, safeJsonParse, type BrandSummary } from "./route-helpers.ts";
import { enrichAgentRow } from "./agent-enrichment-helpers.ts";

export async function tryHandleAgentsCrudRoutes(ctx: StudioRouteContext): Promise<boolean> {
  const { req, res, path, method, url, deps, db, wsHub, workspaceRoot } = ctx;
  const { sendJson, readJsonBody, providerConnection } = deps;

  // 3. Agentes enriquecidos + criação de customizado + edição completa
  if (method === "GET" && path === "/api/agentes") {
    const apenasDesbloqueados =
      url.searchParams.get("apenas_desbloqueados") === "1" ||
      url.searchParams.get("onlyUnlocked") === "1";
    const includeSetupExplicit = url.searchParams.get("incluir_setup") === "1";
    const includeVpsExplicit = url.searchParams.get("incluir_vps") === "1";
    const setupVisible = includeSetupExplicit || isSetupAssistantVisible(db, providerConnection);
    const vpsVisible = includeVpsExplicit || isVpsAssistantVisible(db);
    const rows = db.connection
      .prepare(`SELECT * FROM projecao_agentes ORDER BY ordem_exibicao ASC;`)
      .all() as Array<Parameters<typeof enrichAgentRow>[1]>;
    const currentBrand = getBrandIdentity(providerConnection);
    const enriched = rows
      .filter((row) => row.agente_id !== SETUP_ASSISTANT_AGENT_DEF.agente_id || setupVisible)
      .filter((row) => row.agente_id !== "assistente_servidor_vps" || vpsVisible)
      .map((row) => enrichAgentRow(db, row, workspaceRoot, deps.licenseService, currentBrand));
    const filtered = apenasDesbloqueados
      ? enriched.filter((a) => a.config.upgrade_desbloqueado !== false)
      : enriched;
    const unlockedSummary = computeUnlockedAgentsSummary(db, workspaceRoot, deps.licenseService);
    sendJson(res, 200, {
      agentes: filtered,
      unlocked_agents_count: unlockedSummary.unlocked_agents_count,
      setup_assistant_visible: isSetupAssistantVisible(db, providerConnection),
      vps_assistant_visible: isVpsAssistantVisible(db),
    });
    return true;
  }

  if (method === "GET" && path === "/api/agentes/excluidos") {
    const metaList = getDeletedNativeAgentsMeta(db);
    const allRoster = getSetupCompatibleRoster();
    const excluidos: DeletedNativeAgentInfo[] = [];
    for (const meta of metaList) {
      const def = allRoster.find((a) => a.agente_id === meta.agente_id);
      if (!def) continue;
      excluidos.push({
        agente_id: def.agente_id,
        nome: def.nome,
        papel: def.papel,
        pasta: def.pasta,
        avatar_shape: def.avatar_shape,
        avatar_color: def.avatar_color,
        pacote: def.pacote,
        deleted_at: meta.deleted_at || undefined,
      });
    }
    sendJson(res, 200, { excluidos });
    return true;
  }

  if (method === "POST" && path === "/api/agentes/restaurar-excluidos") {
    const metaList = getDeletedNativeAgentsMeta(db);
    const allRoster = getSetupCompatibleRoster();
    const now = new Date().toISOString();
    const restoredIds: string[] = [];

    db.runInTransaction(() => {
      for (const meta of metaList) {
        const def = allRoster.find((a) => a.agente_id === meta.agente_id);
        unmarkNativeAgentDeleted(db, meta.agente_id);
        if (!def) continue;
        const restoredConfig = {
          frente: def.frente,
          pacote: def.pacote,
          pasta: def.pasta,
          skill_slug: def.skill_slug,
          avatar_shape: def.avatar_shape,
          avatar_color: def.avatar_color,
          avatar_style: "classic" as const,
          avatar_variant: def.avatar_shape,
          avatar_image_url: null,
          effort: def.effort,
          ferramentas: def.ferramentas,
          prompt_base: def.prompt_base,
          customizado: false,
        };
        db.connection
          .prepare(
            `INSERT INTO projecao_agentes (
               agente_id, nome, papel, modelo_padrao, status,
               skills_paths_json, memoria_resumo, ordem_exibicao, config_json, atualizado_em
             ) VALUES (?, ?, ?, ?, 'ocioso', ?, NULL, ?, ?, ?)
             ON CONFLICT(agente_id) DO UPDATE SET
               nome = excluded.nome,
               papel = excluded.papel,
               modelo_padrao = excluded.modelo_padrao,
               config_json = excluded.config_json,
               atualizado_em = excluded.atualizado_em;`,
          )
          .run(
            def.agente_id,
            def.nome,
            def.papel,
            def.modelo_padrao,
            JSON.stringify(def.skills_paths),
            def.ordem_exibicao,
            JSON.stringify(restoredConfig),
            now,
          );
        restoredIds.push(def.agente_id);
      }
    });

    wsHub.broadcast("sidebar:updated", { revision: Date.now() });
    sendJson(res, 200, { ok: true, restored_ids: restoredIds });
    return true;
  }

  if (method === "POST" && path === "/api/agentes/avatar/upload") {
    const body = await readJsonBody(req);
    const rawBase64 =
      typeof body.conteudo_base64 === "string"
        ? body.conteudo_base64
        : typeof body.data_base64 === "string"
          ? body.data_base64
          : "";
    if (!rawBase64.trim()) {
      sendJson(res, 400, { ok: false, erro: "Campo obrigatório: 'conteudo_base64'." });
      return true;
    }

    const dataUriMatch = rawBase64.match(/^data:([^;]+);base64,/i);
    const rawMime = (
      dataUriMatch?.[1] ??
      (typeof body.mime_type === "string" ? body.mime_type : "")
    )
      .trim()
      .toLowerCase();

    const extFromMime =
      rawMime === "image/png"
        ? ".png"
        : rawMime === "image/jpeg" || rawMime === "image/jpg"
          ? ".jpg"
          : rawMime === "image/webp"
            ? ".webp"
            : null;

    if (!extFromMime) {
      sendJson(res, 400, {
        ok: false,
        erro: "Formato inválido. Envie uma imagem PNG, JPG/JPEG ou WebP.",
      });
      return true;
    }

    const base64Clean = rawBase64.replace(/^data:[^;]+;base64,/i, "").trim();
    const buffer = Buffer.from(base64Clean, "base64");
    if (buffer.length === 0) {
      sendJson(res, 400, { ok: false, erro: "Imagem base64 vazia ou inválida." });
      return true;
    }
    if (buffer.length > 5 * 1024 * 1024) {
      sendJson(res, 413, { ok: false, erro: "A foto do avatar excede o limite de 5 MB." });
      return true;
    }

    const avatarDir = resolve(workspaceRoot, "recursos", "avatares");
    mkdirSync(avatarDir, { recursive: true });
    const fileName = `avatar-${randomUUID().slice(0, 12)}${extFromMime}`;
    const targetPath = resolve(avatarDir, fileName);
    writeFileSync(targetPath, buffer);

    const relPath = `recursos/avatares/${fileName}`;
    const normalizedMime = extFromMime === ".jpg" ? "image/jpeg" : `image/${extFromMime.slice(1)}`;
    sendJson(res, 201, {
      ok: true,
      avatar_image_url: `/api/arquivos/raw?path=${encodeURIComponent(relPath)}`,
      caminho_relativo: relPath,
      mime_type: normalizedMime,
      tamanho_bytes: buffer.length,
    });
    return true;
  }

  if (method === "POST" && path === "/api/agentes/avatar/gerar") {
    const body = await readJsonBody(req);
    const rawPrompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (rawPrompt.length < 3) {
      sendJson(res, 400, {
        ok: false,
        erro: "Descreva o avatar com pelo menos 3 caracteres antes de gerar.",
      });
      return true;
    }

    const estiloPrompt = typeof body.estilo === "string" ? body.estilo.trim() : "";
    const nomeAgente = typeof body.nome_agente === "string" ? body.nome_agente.trim() : "";
    const styleClause = estiloPrompt ? `Estilo visual desejado: ${estiloPrompt}. ` : "";
    const roleClause = nomeAgente ? `Personagem/Agente: ${nomeAgente}. ` : "";
    const avatarPrompt = `Crie um avatar quadrado 1:1 para ícone de perfil circular de aplicativo. ${roleClause}${styleClause}Composição: rosto ou personagem perfeitamente centralizado no quadro, enquadramento fechado de busto/cabeça com respiro nas bordas para recorte redondo, iluminação expressiva, alta nitidez e fundo limpo/harmonioso em baixa complexidade visual. Descrição do usuário: ${rawPrompt}. Sem textos, letras, números ou marcas d'água.`;

    const hasGeminiImgKey = Boolean(
      deps.vault && resolveVaultSecretCaseInsensitive(deps.vault, "gemini_api_key", "google_api_key")
    );
    const hasOpenAiImgKey = Boolean(
      deps.vault && resolveVaultSecretCaseInsensitive(deps.vault, "openai_api_key")
    );
    const hasFalImgKey = Boolean(
      deps.vault && resolveVaultSecretCaseInsensitive(deps.vault, "fal_api_key", "flux_api_key")
    );
    const hasImgApiKey = hasGeminiImgKey || hasOpenAiImgKey || hasFalImgKey;

    const agService = providerConnection.getAntigravityService();
    const agSnapshot = await agService.getLiveSnapshot(false).catch(() => null);
    const hasAntigravityAccount = Boolean(
      agSnapshot?.contas.some((c) => c.estado === "conectado" || Boolean(c.token_valido))
    );

    if (!hasImgApiKey && !hasAntigravityAccount) {
      sendJson(res, 400, {
        ok: false,
        erro: "Nenhuma chave de geração de imagem (Gemini/OpenAI/Flux no Cofre) ou conta Google/Antigravity conectada. Conecte um provedor ou envie uma foto do seu computador.",
      });
      return true;
    }

    const avatarDir = resolve(workspaceRoot, "recursos", "avatares");
    mkdirSync(avatarDir, { recursive: true });
    let generatedResult:
      | { relPath: string; engine: string; model: string }
      | null = null;
    let lastGenError: unknown = null;

    if (hasImgApiKey && deps.vault) {
      try {
        const fileName = `avatar-ia-${randomUUID().slice(0, 10)}.png`;
        const diskPath = resolve(avatarDir, fileName);
        const imgRes = await generateImageTool(
          {
            aspect_ratio: "1:1",
            prompt: avatarPrompt,
            output_path: diskPath,
          },
          { vault: deps.vault }
        );
        generatedResult = {
          relPath: `recursos/avatares/${fileName}`,
          engine: imgRes.engine_used,
          model: imgRes.model_used,
        };
      } catch (err) {
        lastGenError = err;
      }
    }

    if (!generatedResult && hasAntigravityAccount && agSnapshot) {
      try {
        const imgGen = await agService.executeCodeAssistGenerate({
          model: agSnapshot.imageGenerationModelIds[0] ?? "gemini-3.1-flash-image",
          messages: [{ role: "user", text: avatarPrompt }],
          generateImage: true,
        });
        if (imgGen.images.length > 0) {
          const firstImg = imgGen.images[0]!;
          const ext = firstImg.mimeType.includes("png")
            ? ".png"
            : firstImg.mimeType.includes("webp")
              ? ".webp"
              : ".jpg";
          const fileName = `avatar-ia-${randomUUID().slice(0, 10)}${ext}`;
          const diskPath = resolve(avatarDir, fileName);
          writeFileSync(diskPath, Buffer.from(firstImg.dataBase64, "base64"));
          generatedResult = {
            relPath: `recursos/avatares/${fileName}`,
            engine: "antigravity",
            model: imgGen.modelUsed,
          };
        }
      } catch (err) {
        lastGenError = err;
      }
    }

    if (!generatedResult) {
      const msg =
        lastGenError instanceof Error
          ? lastGenError.message
          : "O provedor de imagem não retornou arquivo válido.";
      sendJson(res, 502, {
        ok: false,
        erro: `Falha ao gerar avatar com IA: ${msg}`,
      });
      return true;
    }

    sendJson(res, 201, {
      ok: true,
      avatar_image_url: `/api/arquivos/raw?path=${encodeURIComponent(generatedResult.relPath)}`,
      caminho_relativo: generatedResult.relPath,
      engine: generatedResult.engine,
      model: generatedResult.model,
    });
    return true;
  }

  if (method === "POST" && path === "/api/agentes") {
    const body = await readJsonBody(req);
    if (typeof body.nome !== "string" || body.nome.trim().length === 0) {
      sendJson(res, 400, { erro: "Campo obrigatório: 'nome'." });
      return true;
    }
    const nome = body.nome.trim();
    const slugBase = nome
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    const agenteId = `custom_${slugBase || "agente"}_${randomUUID().slice(0, 4)}`;
    const maxOrderRow = db.connection
      .prepare(`SELECT COALESCE(MAX(ordem_exibicao), 15) as max_ordem FROM projecao_agentes;`)
      .get() as { max_ordem: number };
    const agora = new Date().toISOString();

    const currentBrand = getBrandIdentity(providerConnection);
    const hasBrand = hasConfiguredBrand(currentBrand);
    const rawPromptBase =
      typeof body.prompt_base === "string" && body.prompt_base.trim().length > 0
        ? body.prompt_base.trim()
        : `Você é ${nome}, agente customizado do Criativo AI Studio para [NOME_DA_MARCA].`;
    const resolvedPromptBase = hasBrand
      ? interpolateBrandPlaceholders(rawPromptBase, currentBrand)
      : rawPromptBase;

    const incomingBodyConfig =
      body.config && typeof body.config === "object"
        ? (body.config as Record<string, unknown>)
        : {};
    const resolvedAvatarStyle =
      sanitizeAvatarStyle(body.avatar_style) ??
      sanitizeAvatarStyle(incomingBodyConfig.avatar_style) ??
      "classic";
    const resolvedAvatarVariant =
      typeof body.avatar_variant === "string" && body.avatar_variant.trim()
        ? body.avatar_variant.trim()
        : typeof incomingBodyConfig.avatar_variant === "string" && incomingBodyConfig.avatar_variant.trim()
          ? incomingBodyConfig.avatar_variant.trim()
          : undefined;
    const resolvedAvatarImageUrl =
      typeof body.avatar_image_url === "string" && body.avatar_image_url.trim()
        ? body.avatar_image_url.trim()
        : typeof incomingBodyConfig.avatar_image_url === "string" && incomingBodyConfig.avatar_image_url.trim()
          ? incomingBodyConfig.avatar_image_url.trim()
          : null;

    const config = {
      frente: "custom",
      pasta: typeof body.pasta === "string" ? body.pasta : "Agentes Customizados",
      skill_slug: "custom-agent",
      avatar_shape: typeof body.avatar_shape === "string" ? body.avatar_shape : "rounded_square",
      avatar_color: typeof body.avatar_color === "string" ? body.avatar_color : "#38bdf8",
      avatar_style: resolvedAvatarStyle,
      ...(resolvedAvatarVariant ? { avatar_variant: resolvedAvatarVariant } : {}),
      ...(resolvedAvatarImageUrl ? { avatar_image_url: resolvedAvatarImageUrl } : {}),
      effort: typeof body.effort === "string" ? body.effort : "alto",
      prompt_base: resolvedPromptBase,
      customizado: true,
    };

    const rawPapel =
      typeof body.papel === "string" && body.papel.trim().length > 0
        ? body.papel.trim()
        : resolvedPromptBase.slice(0, 120);
    const papel = hasBrand ? interpolateBrandPlaceholders(rawPapel, currentBrand) : rawPapel;
    const modeloPadrao =
      typeof body.modelo_padrao === "string" && body.modelo_padrao.trim().length > 0
        ? body.modelo_padrao.trim()
        : "gemini-2.5-flash";

    db.connection
      .prepare(
        `INSERT INTO projecao_agentes (
          agente_id, nome, papel, modelo_padrao, status,
          skills_paths_json, memoria_resumo, ordem_exibicao, config_json, atualizado_em
        ) VALUES (?, ?, ?, ?, 'ocioso', '[]', NULL, ?, ?, ?);`
      )
      .run(
        agenteId,
        nome,
        papel,
        modeloPadrao,
        Number(maxOrderRow.max_ordem) + 1,
        JSON.stringify(config),
        agora
      );

    // Mensagem inicial de apresentação na conversa
    db.connection
      .prepare(
        `INSERT INTO projecao_conversas_chat (mensagem_id, canal_id, agente_id, autor, autor_nome, conteudo_markdown, anexos_json, steps_json, tarefa_id, lida, criado_em)
         VALUES (?, ?, ?, 'agente', ?, ?, '[]', '[]', NULL, 0, ?);`
      )
      .run(
        `msg-${randomUUID()}`,
        `agente:${agenteId}`,
        agenteId,
        nome,
        `Olá! Sou **${nome}**. ${config.prompt_base}\n\nEnvie sua instrução abaixo ou anexe imagens no botão **+**.`,
        agora
      );

    const createdRow = db.connection
      .prepare(`SELECT * FROM projecao_agentes WHERE agente_id = ?;`)
      .get(agenteId) as Parameters<typeof enrichAgentRow>[1];

    sendJson(res, 201, {
      agente: enrichAgentRow(db, createdRow, workspaceRoot, deps.licenseService, currentBrand),
    });
    return true;
  }

  return false;
}
