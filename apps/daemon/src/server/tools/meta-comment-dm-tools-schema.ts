import type { ToolDefinition } from "@criativo/contracts";

/**
 * Schemas MCP das ferramentas da Fase 47 (Automação Comentário -> Direct & Entregáveis).
 * Expostos via `meta-2026-tools-schema.ts` sem alterar `studio-mcp-bridge.ts`.
 */
export const META_COMMENT_DM_TOOLS_SCHEMA: ToolDefinition[] = [
  {
    name: "meta_listar_regras_comentario_dm",
    description:
      "Lista regras configuradas de Automação Comentário -> Direct no Instagram e métricas resumidas (envios, janela 24h aberta e rate limit 200/h).",
    parameters: {
      type: "object",
      properties: {
        conta_id: {
          type: "string",
          description: "ID opcional da conta Instagram para filtrar regras e métricas.",
        },
      },
    },
  },
  {
    name: "meta_criar_rascunho_regra_dm",
    description:
      "Cria um RASCUNHO PAUSADO (sempre ativo=false) de automação Comentário -> Direct no estilo ManyChat. O usuário humano deve revisar e ativar no Cockpit antes de responder seguidores.",
    parameters: {
      type: "object",
      properties: {
        nome: { type: "string", description: "Nome identificador da regra de automação." },
        match_mode: {
          type: "string",
          enum: ["exact", "contains", "any"],
          description: "Modo de disparo no comentário: exact, contains ou any.",
        },
        keywords: {
          type: "array",
          items: { type: "string" },
          description: "Lista de palavras-chave que disparam a regra (quando match_mode != any).",
        },
        negative_keywords: {
          type: "array",
          items: { type: "string" },
          description: "Palavras negativas que bloqueiam o disparo mesmo se houver keyword.",
        },
        post_scope: {
          type: "string",
          enum: ["all_posts", "specific_posts", "future_posts_only"],
          description: "Escopo das publicações monitoradas.",
        },
        target_media_ids: {
          type: "array",
          items: { type: "string" },
          description: "IDs específicos de posts quando post_scope = specific_posts.",
        },
        opening_text: {
          type: "string",
          description: "Texto inicial do Private Reply enviado ao seguidor com botão para abrir janela 24h.",
        },
        button_label: {
          type: "string",
          description: "Texto do botão CTA inicial (ex.: Quero receber!).",
        },
        public_replies: {
          type: "array",
          items: { type: "string" },
          description: "Variações de resposta pública ao comentário.",
        },
        flow_nodes: {
          type: "array",
          description: "Lista ordenada de blocos do fluxo multi-etapa executados após abertura da janela 24h.",
          items: { type: "object" },
        },
        crm_tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags atribuídas ao lead no CRM ao interagir com a automação.",
        },
        conta_id: {
          type: "string",
          description: "ID opcional da conta Instagram alvo.",
        },
      },
      required: ["nome", "match_mode", "post_scope", "opening_text", "button_label"],
    },
  },
  {
    name: "meta_simular_fluxo_comentario_dm",
    description:
      "Simula em modo Dry-Run (sem chamadas externas à Meta) o disparo de comentário, abertura 24h, entrega de link e roteamento do fluxo.",
    parameters: {
      type: "object",
      properties: {
        rule_id: { type: "string", description: "ID da regra a ser simulada." },
        comment_text: { type: "string", description: "Texto de comentário simulado do seguidor." },
        post_media_id: { type: "string", description: "ID de mídia simulado (opcional)." },
        simulate_button_click: {
          type: "boolean",
          description: "Se true, simula o seguidor clicando no botão inicial para abrir janela 24h.",
        },
        collect_input_value: {
          type: "string",
          description: "Valor simulado de e-mail ou WhatsApp caso o fluxo tenha etapa collect_input.",
        },
        is_reply_comment: {
          type: "boolean",
          description: "Indica se o comentário simulado é resposta a outro comentário.",
        },
      },
      required: ["rule_id", "comment_text"],
    },
  },
  {
    name: "publicar_entregavel_publico",
    description:
      "Publica um entregável do diretor_entregaveis (arquivo do workspace, HTML ou link externo) retornando URL pública HTTPS segura (sem IP bruto) pronta para envio no Direct.",
    parameters: {
      type: "object",
      properties: {
        titulo: { type: "string", description: "Título público do material entregável." },
        descricao: { type: "string", description: "Descrição curta exibida no cartão ou índice." },
        slug: { type: "string", description: "Slug amigável opcional para a URL." },
        source_type: {
          type: "string",
          enum: ["github_pages", "showcase_https", "external_https"],
          description: "Destino de hospedagem HTTPS pública.",
        },
        local_file_path: {
          type: "string",
          description: "Caminho relativo no workspace (ex.: saidas/guia.pdf ou saidas/kit.html).",
        },
        html_content: {
          type: "string",
          description: "Conteúdo HTML inline opcional para publicar diretamente.",
        },
        external_https_url: {
          type: "string",
          description: "URL HTTPS externa quando source_type = external_https.",
        },
        public_base_url: {
          type: "string",
          description: "Domínio HTTPS base quando source_type = showcase_https.",
        },
      },
      required: ["titulo", "source_type"],
    },
  },
];

export const META_COMMENT_DM_TOOL_NAMES: ReadonlySet<string> = new Set(
  META_COMMENT_DM_TOOLS_SCHEMA.map((t) => t.name)
);

export function isMetaCommentDmToolName(name: string): boolean {
  return META_COMMENT_DM_TOOL_NAMES.has(name);
}
