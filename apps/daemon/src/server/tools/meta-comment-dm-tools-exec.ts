import type {
  CommentDmFlowNode,
  CommentRuleScope,
  CommentTriggerMatchMode,
  DeliverableSourceType,
} from "@criativo/contracts";
import type { NativeAppConnectionsStore } from "../../marketplace/native-app-connections-store.ts";
import { createPhase47Runtime, type Phase47RuntimeHandle } from "../../social/phase47-runtime.ts";
import { resolveNativeAppConnectionsStore } from "../studio-tools-bridge.ts";
import type { StudioExtensionToolDeps } from "./phase10-tools-schema.ts";
import { readStringArg } from "./studio-tool-helpers.ts";

function readStringArrayArg(args: Record<string, unknown>, key: string): string[] {
  const raw = args[key];
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function getOrBuildPhase47Runtime(
  deps: StudioExtensionToolDeps,
  ctx: { workspaceRoot: string; nativeStore: NativeAppConnectionsStore | null }
): Phase47RuntimeHandle {
  if (deps.phase47Runtime) return deps.phase47Runtime;
  const nativeStore =
    ctx.nativeStore ??
    deps.nativeStore ??
    resolveNativeAppConnectionsStore({ db: deps.db, vault: deps.vault }) ??
    undefined;
  return createPhase47Runtime({
    db: deps.db,
    vault: deps.vault,
    nativeStore,
    wsHub: deps.wsHub,
    workspaceRoot: ctx.workspaceRoot || deps.workspaceRoot || process.cwd(),
    showcaseService: deps.showcaseService,
    fetchImpl: deps.fetchImpl,
  });
}

/**
 * Executor seguro das 4 ferramentas MCP da Fase 47.
 * Garante que rascunhos criados por IA sempre fiquem pausados (`ativo: false`)
 * e que entregáveis passem pela guarda HTTPS anti-IP bruto.
 */
export async function executeMetaCommentDmTool(
  toolName: string,
  args: Record<string, unknown>,
  deps: StudioExtensionToolDeps,
  ctx: { workspaceRoot: string; nativeStore: NativeAppConnectionsStore | null }
): Promise<unknown> {
  const rt = getOrBuildPhase47Runtime(deps, ctx);

  if (toolName === "meta_listar_regras_comentario_dm") {
    const contaId = readStringArg(args, "conta_id", "contaId") ?? null;
    return {
      ok: true,
      rules: rt.service.listRules(contaId),
      analytics: rt.service.getAnalytics(contaId),
    };
  }

  if (toolName === "meta_criar_rascunho_regra_dm") {
    const nome = readStringArg(args, "nome") ?? "";
    const matchMode = (readStringArg(args, "match_mode", "matchMode") ?? "contains") as CommentTriggerMatchMode;
    const postScope = (readStringArg(args, "post_scope", "postScope") ?? "all_posts") as CommentRuleScope;
    const openingText = readStringArg(args, "opening_text", "openingText") ?? "";
    const buttonLabel = readStringArg(args, "button_label", "buttonLabel") ?? "";
    const flowNodes = Array.isArray(args.flow_nodes) ? (args.flow_nodes as CommentDmFlowNode[]) : [];

    // Política obrigatória de segurança (DM47-06): rascunhos agênticos SEMPRE nascem pausados.
    const rule = rt.service.createRule({
      conta_id: readStringArg(args, "conta_id", "contaId") ?? null,
      nome,
      ativo: false,
      match_mode: matchMode,
      keywords: readStringArrayArg(args, "keywords"),
      negative_keywords: readStringArrayArg(args, "negative_keywords"),
      post_scope: postScope,
      target_media_ids: readStringArrayArg(args, "target_media_ids"),
      require_human_approval: args.require_human_approval !== false,
      public_replies: readStringArrayArg(args, "public_replies"),
      crm_tags: readStringArrayArg(args, "crm_tags"),
      opening_message: {
        text: openingText,
        button_label: buttonLabel,
        next_node_id: flowNodes[0]?.node_id ?? null,
      },
      flow_nodes: flowNodes,
    });

    return {
      ok: true,
      status: "paused_draft",
      rule,
      mensagem:
        "Rascunho da automação Comentário -> Direct criado PAUSADO (ativo=false). O usuário humano deve revisá-lo e ativá-lo na aba Automações > Fluxos Instagram [BETA].",
    };
  }

  if (toolName === "meta_simular_fluxo_comentario_dm") {
    const ruleId = readStringArg(args, "rule_id", "ruleId") ?? "";
    const commentText = readStringArg(args, "comment_text", "commentText") ?? "";
    const clickButton = args.simulate_button_click !== false && args.click_opening_button !== false;
    const collectValue = readStringArg(args, "collect_input_value", "user_reply_text");
    const simulation = rt.service.simulateDryRun({
      rule_id: ruleId,
      comment_text: commentText,
      media_id: readStringArg(args, "post_media_id", "postMediaId", "media_id") ?? undefined,
      is_comment_reply: args.is_reply_comment === true || args.is_comment_reply === true,
      simulated_button_clicks: Array.isArray(args.simulated_button_clicks)
        ? args.simulated_button_clicks.map(String)
        : clickButton
          ? ["Quero receber!"]
          : [],
      simulated_inputs: Array.isArray(args.simulated_inputs)
        ? args.simulated_inputs.map(String)
        : collectValue
          ? [collectValue]
          : [],
    });
    return { ok: true, simulation };
  }

  if (toolName === "publicar_entregavel_publico") {
    const titulo = readStringArg(args, "titulo") ?? "";
    const sourceType = (readStringArg(args, "source_type", "sourceType") ?? "github_pages") as DeliverableSourceType;
    const deliverable = await rt.deliverablePublisher.publishDeliverable({
      titulo,
      descricao: readStringArg(args, "descricao") ?? undefined,
      slug: readStringArg(args, "slug") ?? undefined,
      source_type: sourceType,
      local_file_path: readStringArg(args, "local_file_path", "localFilePath") ?? null,
      html_content: readStringArg(args, "html_content", "htmlContent") ?? null,
      external_https_url: readStringArg(args, "external_https_url", "externalHttpsUrl") ?? null,
      public_base_url: readStringArg(args, "public_base_url", "publicBaseUrl") ?? null,
      agente_id: deps.agenteId ?? "diretor_entregaveis",
    });
    return {
      ok: true,
      deliverable,
      public_https_url: deliverable.public_https_url,
    };
  }

  throw new Error(`Ferramenta Comentário -> Direct não suportada: ${toolName}`);
}
