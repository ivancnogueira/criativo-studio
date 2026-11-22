import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { AskUserQuestion } from "@criativo/contracts";
import { ROSTER_15_AGENTES } from "../../engine/runner/roster-defaults.ts";
import { listAgentsWithAliases } from "../agent-resolver.ts";
import { getSkillUpgradePackage, loadSkillPromptBySlug } from "../analytics-skills-service.ts";
import { executePhase14MemoryDataTool, isPhase14MemoryDataTool } from "./phase14-memory-data-exec.ts";
import type { Phase14ToolContext, Phase14ToolServices } from "./phase14-tools-schema.ts";
import { isUpgradeUnlocked } from "./studio-tool-auth.ts";
import { readStringArg, readStringArrayArg } from "./studio-tool-helpers.ts";
function validateSingleEmojiGrapheme(rawEmoji: string): string {
  const trimmed = String(rawEmoji ?? "").trim();
  if (!trimmed) {
    throw new Error("Informe um emoji não vazio em 'emoji'.");
  }
  const segmenter = new Intl.Segmenter("pt-BR", { granularity: "grapheme" });
  const graphemes = Array.from(segmenter.segment(trimmed));
  if (graphemes.length !== 1) {
    throw new Error(
      `react_to_user_message aceita exatamente 1 grafema emoji Unicode (recebidos: ${graphemes.length}).`,
    );
  }
  const single = graphemes[0]!.segment;
  if (!/\p{Extended_Pictographic}/u.test(single)) {
    throw new Error(`O caractere '${single}' não é um pictograma emoji Unicode válido.`);
  }
  return single;
}

/**
 * Roteador unificado para todas as 21 ferramentas (+ aliases) da Fase 14,
 * usado tanto pelo AgentRunner quanto pelo loop interativo do Chat.
 */
export async function executePhase14ToolCall(
  toolName: string,
  args: Record<string, unknown>,
  ctx: Phase14ToolContext,
  services: Phase14ToolServices
): Promise<unknown> {
  if (isPhase14MemoryDataTool(toolName)) {
    const memData = await executePhase14MemoryDataTool(toolName, args, ctx, services);
    return memData.result;
  }

  switch (toolName) {
    case "ask_user": {
      if (!services.uiBlockRegistry) {
        throw new Error("UiBlockRegistry não inicializado neste daemon.");
      }
      const rawQuestions = Array.isArray(args.questions) ? args.questions : [];
      if (rawQuestions.length < 1 || rawQuestions.length > 3) {
        throw new Error("ask_user requer entre 1 e 3 perguntas em 'questions'.");
      }

      const questions: AskUserQuestion[] = rawQuestions.map((q, idx) => {
        const rec = (q && typeof q === "object" ? q : {}) as Record<string, unknown>;
        const questionText = readStringArg(rec, "question", "pergunta") ?? "";
        if (!questionText) {
          throw new Error(`A pergunta #${idx + 1} de ask_user não possui texto em 'question'.`);
        }
        const rawOptions = Array.isArray(rec.options) ? rec.options : undefined;
        return {
          id: readStringArg(rec, "id") ?? `q${idx + 1}`,
          header: readStringArg(rec, "header", "cabecalho"),
          question: questionText,
          detail: readStringArg(rec, "detail", "detalhe"),
          isSecret: Boolean(rec.isSecret),
          multiSelect: Boolean(rec.multiSelect),
          options: rawOptions
            ?.map((opt) => {
              if (typeof opt === "string") return { label: opt };
              if (opt && typeof opt === "object") {
                const oRec = opt as Record<string, unknown>;
                const label = readStringArg(oRec, "label", "value") ?? "";
                return label
                  ? { label, description: readStringArg(oRec, "description") }
                  : null;
              }
              return null;
            })
            .filter((x): x is NonNullable<typeof x> => x !== null),
        };
      });

      const title = readStringArg(args, "title", "titulo");
      return await services.uiBlockRegistry.openBlockingBlock({
        agenteId: ctx.agenteId,
        canalId: ctx.canalId,
        threadId: ctx.threadId,
        turnoId: ctx.turnId,
        tipoFerramenta: "ask_user",
        spec: {
          kind: "ask_user",
          ...(title ? { title } : {}),
          questions,
        },
        conteudoMarkdown: title ?? questions[0]!.question,
      });
    }

    case "ask_ui": {
      if (!services.uiBlockRegistry) {
        throw new Error("UiBlockRegistry não inicializado neste daemon.");
      }
      const rawBlock =
        args.block && typeof args.block === "object" && !Array.isArray(args.block)
          ? (args.block as Record<string, unknown>)
          : args;

      const title = readStringArg(rawBlock, "title", "titulo") ?? "Confirmação Necessária";
      const rawVariant = readStringArg(rawBlock, "variant", "type") ?? "confirm";
      const markdownPreview = readStringArg(rawBlock, "markdownPreview", "preview");
      const description = readStringArg(rawBlock, "description", "descricao");
      const danger = Boolean(rawBlock.danger);

      let confirmHold: { label?: string; durationMs?: number } | boolean | undefined;
      if (typeof rawBlock.confirmHold === "number") {
        confirmHold = {
          durationMs: Math.max(400, Math.min(3000, Math.round(rawBlock.confirmHold))),
        };
      } else if (typeof rawBlock.confirmHold === "boolean") {
        confirmHold = rawBlock.confirmHold;
      } else if (rawBlock.confirmHold && typeof rawBlock.confirmHold === "object") {
        const ch = rawBlock.confirmHold as Record<string, unknown>;
        const dur =
          typeof ch.durationMs === "number"
            ? Math.max(400, Math.min(3000, Math.round(ch.durationMs)))
            : 1200;
        confirmHold = {
          label: readStringArg(ch, "label"),
          durationMs: dur,
        };
      }

      const rawActions = Array.isArray(rawBlock.actions) ? rawBlock.actions.slice(0, 4) : [];
      const actions =
        rawActions.length > 0
          ? rawActions.map((a, idx) => {
              const ar = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
              return {
                id: readStringArg(ar, "id") ?? `action_${idx + 1}`,
                label: readStringArg(ar, "label") ?? `Ação ${idx + 1}`,
                tone: readStringArg(ar, "tone") ?? (idx === 0 ? (danger ? "danger" : "primary") : "default"),
                ...(ar.confirmHold !== undefined ? { confirmHold: ar.confirmHold } : {}),
              };
            })
          : [
              {
                id: "confirm",
                label: danger ? "Confirmar exclusão" : "Aprovar e continuar",
                tone: danger ? "danger" : "primary",
                ...(confirmHold ? { confirmHold } : {}),
              },
              { id: "cancel", label: "Cancelar operação", tone: "default" },
            ];

      return await services.uiBlockRegistry.openBlockingBlock({
        agenteId: ctx.agenteId,
        canalId: ctx.canalId,
        threadId: ctx.threadId,
        turnoId: ctx.turnId,
        tipoFerramenta: "ask_ui",
        spec: {
          kind: "ask_ui",
          variant: rawVariant,
          title,
          ...(description ? { description } : {}),
          ...(markdownPreview ? { markdownPreview } : {}),
          danger,
          ...(confirmHold !== undefined ? { confirmHold } : {}),
          ...(Array.isArray(rawBlock.options) ? { options: rawBlock.options } : {}),
          ...(typeof rawBlock.multiSelect === "boolean"
            ? { multiSelect: rawBlock.multiSelect }
            : {}),
          ...(Array.isArray(rawBlock.fields) ? { fields: rawBlock.fields } : {}),
          actions,
        },
        conteudoMarkdown: title,
      });
    }

    case "acknowledge_request": {
      if (!services.uiBlockRegistry) {
        throw new Error("UiBlockRegistry não inicializado neste daemon.");
      }
      const steps = readStringArrayArg(args, "steps", "etapas").slice(0, 4);
      if (steps.length === 0) {
        throw new Error("acknowledge_request requer de 1 a 4 etapas em 'steps'.");
      }
      const title = readStringArg(args, "title", "titulo") ?? "Plano de Execução";
      const summaryMarkdown =
        readStringArg(args, "summaryMarkdown", "message", "resumo") ?? title;
      const startLabel = readStringArg(args, "startLabel") ?? "Iniciar plano";
      const cancelLabel = readStringArg(args, "cancelLabel") ?? "Cancelar plano";
      const alternativeLabel = readStringArg(args, "alternativeLabel");
      const autoStartAfterMs =
        typeof args.planStartAfterMs === "number" ? args.planStartAfterMs : undefined;

      return await services.uiBlockRegistry.openBlockingBlock({
        agenteId: ctx.agenteId,
        canalId: ctx.canalId,
        threadId: ctx.threadId,
        turnoId: ctx.turnId,
        tipoFerramenta: "acknowledge_request",
        autoStartAfterMs,
        spec: {
          kind: "acknowledge_request",
          title,
          summaryMarkdown,
          steps,
          startLabel,
          cancelLabel,
          ...(alternativeLabel ? { alternativeLabel } : {}),
        },
        conteudoMarkdown: title,
      });
    }

    case "request_api_key": {
      if (!services.uiBlockRegistry || !services.apiKeysBridge) {
        throw new Error("UiBlockRegistry / ApiKeysBridge não inicializados neste daemon.");
      }
      const rawName = readStringArg(args, "name", "nome") ?? "";
      const validName = services.apiKeysBridge.validateKeyName(rawName);
      const label = readStringArg(args, "label", "title", "titulo") ?? `Configurar ${validName}`;
      const description = readStringArg(args, "description", "descricao");
      const docsUrl = readStringArg(args, "docsUrl");
      const placeholder = readStringArg(args, "placeholder");
      const submit = readStringArg(args, "submit") ?? "Salvar no Cofre";
      const defaultScope =
        args.defaultScope === "agente_especifico" ? "agente_especifico" : "todos_agentes";

      return await services.uiBlockRegistry.openBlockingBlock({
        agenteId: ctx.agenteId,
        canalId: ctx.canalId,
        threadId: ctx.threadId,
        turnoId: ctx.turnId,
        tipoFerramenta: "request_api_key",
        spec: {
          kind: "request_api_key",
          name: validName,
          label,
          ...(description ? { description } : {}),
          ...(docsUrl ? { docsUrl } : {}),
          ...(placeholder ? { placeholder } : {}),
          submit,
          defaultScope,
        },
        conteudoMarkdown: label,
      });
    }

    case "list_api_keys": {
      if (!services.apiKeysBridge) {
        throw new Error("ApiKeysBridge não inicializado neste daemon.");
      }
      return {
        keys: services.apiKeysBridge.listApiKeys(ctx.agenteId),
      };
    }

    case "save_api_key": {
      if (!services.apiKeysBridge) {
        throw new Error("ApiKeysBridge não inicializado neste daemon.");
      }
      const name = readStringArg(args, "name", "nome") ?? "";
      const key = typeof args.key === "string" ? args.key : typeof args.value === "string" ? args.value : "";
      const scope =
        args.scope === "agente_especifico" ? "agente_especifico" : "todos_agentes";
      return services.apiKeysBridge.saveApiKey({
        name,
        value: key,
        scope,
        agenteId: ctx.agenteId,
        origemTurno: ctx.origemTurno,
      });
    }

    case "remove_api_key": {
      if (!services.apiKeysBridge) {
        throw new Error("ApiKeysBridge não inicializado neste daemon.");
      }
      const name = readStringArg(args, "name", "nome") ?? "";
      return services.apiKeysBridge.removeApiKey({
        name,
        agenteId: ctx.agenteId,
        byUser: false,
      });
    }

    // -------------------------------------------------------------------------
    // 5. Biblioteca Hierárquica & Reação Emoji 1:1 (CHAT-03)
    // -------------------------------------------------------------------------
    case "list_library_folders": {
      if (!services.libraryFolders) {
        throw new Error("LibraryFoldersService não inicializado neste daemon.");
      }
      const folder = readStringArg(args, "folder", "pasta");
      return services.libraryFolders.listLibraryFoldersForAgent(ctx.agenteId, folder);
    }

    case "attach_files_to_response": {
      if (!services.libraryFolders) {
        throw new Error("LibraryFoldersService não inicializado neste daemon.");
      }
      const paths = readStringArrayArg(args, "paths", "arquivos");
      if (paths.length === 0) {
        throw new Error("Informe ao menos 1 caminho relativo em 'paths'.");
      }
      const folder = readStringArg(args, "folder", "pasta") ?? null;
      const resolved = services.libraryFolders.resolveSafeWorkspaceFiles(paths, {
        agenteId: ctx.agenteId,
        tarefaId: ctx.tarefaId ?? null,
        folderPath: folder,
      });

      for (const arq of resolved) {
        ctx.generatedArtifacts?.push(arq.caminho_relativo);
        ctx.generatedAnexos?.push({
          nome: arq.nome_original,
          caminho_relativo: arq.caminho_relativo,
          url: arq.url || `/api/arquivos/raw/${encodeURIComponent(arq.caminho_relativo)}`,
          mime_type: arq.mime_type,
          tamanho_bytes: arq.tamanho_bytes,
          tipo_uso: arq.tipo_uso,
        });
      }

      return {
        ok: true,
        attachedCount: resolved.length,
        files: resolved.map((a) => ({
          arquivo_id: a.arquivo_id,
          nome: a.nome_original,
          caminho_relativo: a.caminho_relativo,
          folder_path: a.folder_path ?? null,
        })),
      };
    }

    case "react_to_user_message": {
      if (!ctx.isOneToOneUserChat) {
        return {
          ok: false,
          erro: "react_to_user_message é permitido exclusivamente em conversas 1:1 diretas com o usuário.",
        };
      }
      const validEmoji = validateSingleEmojiGrapheme(
        typeof args.emoji === "string" ? args.emoji : "",
      );

      let targetMsgId = ctx.lastUserMessageId ?? null;
      if (!targetMsgId) {
        const lastRow = services.db.connection
          .prepare(
            `SELECT mensagem_id FROM projecao_conversas_chat
             WHERE canal_id = ? AND autor = 'usuario'
             ORDER BY criado_em DESC
             LIMIT 1;`,
          )
          .get(ctx.canalId) as { mensagem_id?: string } | undefined;
        targetMsgId = lastRow?.mensagem_id ?? null;
      }

      if (!targetMsgId) {
        return {
          ok: false,
          erro: "Nenhuma mensagem do usuário encontrada nesta conversa para reagir.",
        };
      }

      services.db.connection
        .prepare("UPDATE projecao_conversas_chat SET reacao_emoji = ? WHERE mensagem_id = ?;")
        .run(validEmoji, targetMsgId);

      services.wsHub?.broadcast("chat:reaction", {
        canal_id: ctx.canalId,
        mensagem_id: targetMsgId,
        emoji: validEmoji,
        agente_id: ctx.agenteId,
      });

      return {
        ok: true,
        mensagem_id: targetMsgId,
        emoji: validEmoji,
      };
    }

    // -------------------------------------------------------------------------
    // 6. Mensageria Assíncrona Multi-Agente (send_message — CHAT-04)
    // -------------------------------------------------------------------------
    case "send_message": {
      if (!services.handoffBus) {
        throw new Error("HandoffBus não inicializado neste daemon.");
      }
      const recipientAgentIds = readStringArrayArg(
        args,
        "recipientAgentIds",
        "para_agentes",
        "recipients",
      );
      const text = readStringArg(args, "text", "texto", "instrucao") ?? "";
      const rawPaths = readStringArrayArg(args, "paths", "artefatos");

      let safePaths: string[] = [];
      if (rawPaths.length > 0) {
        if (services.libraryFolders) {
          const checked = services.libraryFolders.resolveSafeWorkspaceFiles(rawPaths, {
            agenteId: ctx.agenteId,
            tarefaId: ctx.tarefaId ?? null,
          });
          safePaths = checked.map((c) => c.caminho_relativo);
        } else {
          safePaths = rawPaths;
        }
      }

      const replyToMessageId =
        readStringArg(args, "replyToMessageId", "reply_to_message_id") ?? null;
      const expectsReply = typeof args.expectsReply === "boolean" ? args.expectsReply : true;

      return services.handoffBus.sendMessageAsync({
        senderAgentId: ctx.agenteId,
        sourceCanalId: ctx.canalId,
        sourceThreadId: ctx.threadId ?? null,
        tarefaId: ctx.tarefaId ?? null,
        hopDepth: ctx.hopDepth ?? 0,
        recipientAgentIds,
        text,
        paths: safePaths,
        replyToMessageId,
        expectsReply,
        wsHub: services.wsHub,
        isAgentBusy: services.isAgentBusy,
        onSteerMessage: services.onSteerMessage,
        onDispatchQueued: services.onDispatchQueuedInterAgent,
      });
    }

    case "load_skill": {
      const requestedSlug = readStringArg(args, "slug", "skill", "habilidade");
      let targetSlug = requestedSlug ? requestedSlug.trim() : "";
      let candidatePaths: string[] = [];

      if (!targetSlug) {
        const agentRow = services.db.connection
          .prepare("SELECT config_json, skills_paths_json FROM projecao_agentes WHERE agente_id = ? LIMIT 1;")
          .get(ctx.agenteId) as { config_json?: string; skills_paths_json?: string } | undefined;
        if (agentRow?.config_json) {
          try {
            const parsedCfg = JSON.parse(agentRow.config_json) as { skill_slug?: unknown };
            if (typeof parsedCfg.skill_slug === "string" && parsedCfg.skill_slug.trim()) {
              targetSlug = parsedCfg.skill_slug.trim();
            }
          } catch {
            // ignora json inválido
          }
        }
        if (agentRow?.skills_paths_json) {
          try {
            const parsedPaths = JSON.parse(agentRow.skills_paths_json) as unknown;
            if (Array.isArray(parsedPaths)) {
              candidatePaths = parsedPaths.filter((p): p is string => typeof p === "string" && p.trim().length > 0);
            }
          } catch {
            // ignora json inválido
          }
        }
        if (!targetSlug && candidatePaths.length > 0) {
          const matchedSlug = candidatePaths[0]!.match(/([^/\\]+)[/\\]SKILL\.md$/i);
          if (matchedSlug?.[1]) {
            targetSlug = matchedSlug[1];
          }
        }
        if (!targetSlug) {
          const def = ROSTER_15_AGENTES.find((a) => a.agente_id === ctx.agenteId);
          if (def?.skill_slug) targetSlug = def.skill_slug;
        }
      }

      if (targetSlug) {
        const upgradePkg = getSkillUpgradePackage(targetSlug);
        if (
          upgradePkg &&
          !isUpgradeUnlocked(
            services.db,
            services.workspaceRoot ?? process.cwd(),
            upgradePkg,
            services.licenseService,
            services.productRoot
          )
        ) {
          return {
            ok: false,
            slug: targetSlug,
            erro: `Habilidade '${targetSlug}' pertence ao módulo '${upgradePkg}', não liberado na licença ativa.`,
          };
        }
        const loaded = loadSkillPromptBySlug(targetSlug, undefined, services.workspaceRoot, {
          db: services.db,
          licenseService: services.licenseService,
          productRoot: services.productRoot,
        });
        if (loaded) {
          return {
            ok: true,
            slug: targetSlug,
            path: loaded.path,
            tokensEst: loaded.tokensEst,
            content: loaded.body,
          };
        }
      }

      for (const relPath of candidatePaths) {
        const absPath = isAbsolute(relPath) ? relPath : resolve(process.cwd(), relPath);
        if (existsSync(absPath)) {
          try {
            const body = readFileSync(absPath, "utf8");
            return {
              ok: true,
              slug: targetSlug || ctx.agenteId,
              path: absPath,
              tokensEst: Math.max(80, Math.round(body.length / 4)),
              content: body,
            };
          } catch {
            // continua tentando outros caminhos
          }
        }
      }

      return {
        ok: false,
        slug: targetSlug || null,
        erro: targetSlug
          ? `SKILL.md da habilidade '${targetSlug}' não encontrado.`
          : "Nenhuma habilidade configurada para este agente.",
      };
    }

    case "list_agents": {
      const agents = listAgentsWithAliases(services.db);
      return {
        total: agents.length,
        agents,
      };
    }

    default:
      throw new Error(`Ferramenta da Fase 14 desconhecida: ${toolName}`);
  }
}
