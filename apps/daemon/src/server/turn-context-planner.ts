export type StudioToolScope =
  | "core"
  | "browser"
  | "schedule"
  | "workflows"
  | "messaging"
  | "meta"
  | "media"
  | "data_ui"
  | "external_mcp";

export const ALL_STUDIO_TOOL_SCOPES: readonly StudioToolScope[] = [
  "core",
  "browser",
  "schedule",
  "workflows",
  "messaging",
  "meta",
  "media",
  "data_ui",
  "external_mcp",
];

export interface TurnContextPlan {
  mode: "light" | "action";
  loadFullSkill: boolean;
  attachBrandImages: boolean;
  compactLiveContext: boolean;
  mcpScopes: StudioToolScope[];
  includeExternalMcps: boolean;
}

export interface TurnContextPlannerInput {
  userPrompt: string;
  agenteId: string;
  isGreetingOrCapability: boolean;
  anexosCount: number;
  hasOpenBrowserTabs: boolean;
  hasActiveWakeups: boolean;
  hasWokenWaits: boolean;
  isHandoff: boolean;
  isRoutine: boolean;
  channelOrigin?: "web" | "whatsapp";
  recentHistoryText?: string;
  hasExternalMcps?: boolean;
}

const CORE_TOOLS = new Set([
  "load_skill",
  "list_agents",
  "ask_user",
  "ask_ui",
  "acknowledge_request",
  "pin_message",
  "start_new_chat",
  "remember",
  "forget_memory",
  "list_memories",
  "search_memories",
  "set_memory_inclusion",
  "memory_recall",
  "history_read",
  "history_search",
  "react_to_user_message",
  "react_message",
  "send_message",
  "interrupt_agent",
]);

const BROWSER_TOOLS = new Set([
  "criativo_browser",
  "capture_screen",
  "get_browsing_log",
]);

const SCHEDULE_TOOLS = new Set([
  "schedule_wakeup",
  "list_wakeups",
  "cancel_wakeup",
  "start_task",
  "await_event",
  "close_wait",
  "list_waits",
]);

const META_TOOLS = new Set([
  "validar_integracao_meta",
  "consultar_metricas_meta",
  "meta_publicar",
]);

const MEDIA_TOOLS = new Set([
  "generate_image",
  "read_video",
  "read_image",
  "crop_margem_segura",
  "exec_remotion_render",
  "attach_files_to_response",
]);

const DATA_UI_TOOLS = new Set([
  "list_tables",
  "query_data",
  "execute_data",
  "delete_table",
  "list_library_folders",
  "attach_files_to_response",
  "html_render",
  "html_preview",
  "request_api_key",
  "list_api_keys",
  "save_api_key",
  "remove_api_key",
  "list_sections",
  "create_section",
  "rename_section",
  "delete_section",
  "assign_agent_section",
  "list_sites",
  "publish_site",
  "replace_site",
  "create_site",
  "update_site",
  "delete_site",
  "create_server_install_command",
  "salvar_identidade_marca",
  "save_brand_identity",
  "concluir_setup_inicial",
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

function isNativeMcpManagementTool(toolName: string): boolean {
  return (
    DATA_UI_TOOLS.has(toolName) ||
    /^(list|save|test|set|remove|add|install|update|connect)_mcp_server(s|_enabled)?$/i.test(
      toolName,
    ) ||
    /^mcp_(list|add|install|update|remove|connect)_servers?$/i.test(toolName)
  );
}

/**
 * Classifica determinística e exaustivamente se uma ferramenta pertence aos escopos ativos no turno.
 */
export function toolBelongsToScopes(
  toolName: string,
  scopes: ReadonlySet<StudioToolScope>,
): boolean {
  if (scopes.size === 0) return false;
  const clean = toolName.trim();
  if (!clean) return false;

  if (scopes.has("core") && CORE_TOOLS.has(clean)) {
    return true;
  }

  if (
    scopes.has("browser") &&
    (BROWSER_TOOLS.has(clean) || clean.startsWith("browser_"))
  ) {
    return true;
  }

  if (
    scopes.has("schedule") &&
    (SCHEDULE_TOOLS.has(clean) ||
      clean.endsWith("_routine") ||
      clean.startsWith("routine_"))
  ) {
    return true;
  }

  if (
    scopes.has("workflows") &&
    (clean.includes("_workflow") || clean.startsWith("workflow_"))
  ) {
    return true;
  }

  if (scopes.has("messaging") && clean.startsWith("messaging_")) {
    return true;
  }

  if (scopes.has("meta") && META_TOOLS.has(clean)) {
    return true;
  }

  if (scopes.has("media") && MEDIA_TOOLS.has(clean)) {
    return true;
  }

  if (
    scopes.has("data_ui") &&
    (isNativeMcpManagementTool(clean) ||
      /^(list|read|create|revise|install|set|uninstall)_(local_)?skills?$/i.test(clean) ||
      /^(suggest|install|connect)_[a-z0-9_]+(app|marketplace)$/i.test(clean))
  ) {
    return true;
  }

  if (
    scopes.has("external_mcp") &&
    clean.startsWith("mcp_") &&
    !isNativeMcpManagementTool(clean)
  ) {
    return true;
  }

  return false;
}

const BROWSER_INTENT_RE =
  /\b(navegador|browser|aba|abas|url|chrome|cdp|site|pagina|p[aá]gina|clicar|clique|preencher|formul[aá]rio|screenshot|captura|prints?|navegar|acessar\s+http|https?:\/\/|web\.whatsapp)\b/i;

const SCHEDULE_INTENT_RE =
  /\b(timer|timers|wakeup|wakeups|rotina|rotinas|agenda|agendar|agende|agendamento|cron|a\s+cada|minuto|minutos|segundo|segundos|hora|horas|espera|esperas|acompanh|monitor|verificar|verifique|checar|cheque|retomar|retomada|subtarefa|sub-tarefa|subtarefas|tarefa|tarefas|fila|background|webhook)\b/i;

const WORKFLOW_INTENT_RE =
  /\b(workflow|workflows|fluxo|fluxos|grafo|pipeline|esteira|n[oó]s\s+do\s+fluxo)\b/i;

const MESSAGING_INTENT_RE =
  /\b(whatsapp|wpp|zap|mensagem|mensagens|enviar\s+para|disparar|disparo|prospec[cç][aã]o|prospectar|conversa\s+com|lead|leads|contato|contatos|telegram)\b/i;

const META_INTENT_RE =
  /\b(meta|instagram|insta|graph\s*api|insights|m[eé]trica|m[eé]tricas|alcance|engajamento|seguidores|publicar|publica[cç][aã]o|postar|token\s+meta|conta\s+instagram)\b/i;

const MEDIA_INTENT_RE =
  /\b(imagem|imagens|arte|artes|foto|fotos|carrossel|carross[eé]is|slide|slides|post|posts|storie|stories|story|reel|reels|v[ií]deo|v[ií]deos|render|remotion|banner|criativo|criativos|capa|thumb|thumbnail|margem\s+segura)\b/i;

const IMAGE_GENERATION_OR_VISUAL_EDIT_RE =
  /\b(crie|criar|gere|gerar|fa[cç]a|fazer|produza|produzir|monte|montar|desenhe|desenhar|ilustre|edite|editar|refa[cç]a|ajuste|ajustar|banner|capa|imagem|imagens|arte|artes|carrossel|post|storie|stories|criativo|criativos|an[uú]ncio)\b/i;

const DATA_UI_INTENT_RE =
  /\b(tabela|tabelas|sql|banco\s+de\s+dados|query|planilha|csv|biblioteca|pasta|pastas|arquivos?|cofre|api\s*key|chave\s+de\s+api|se[cç][aã]o|se[cç][oõ]es|sidebar|barra\s+lateral|showcase|landing|skill|habilidade|habilidades|loja|marketplace|instalar|servidor|servidores|mcp|identidade\s+visual|marca|brandbook|html|gr[aá]fico|dashboard)\b/i;

const EXTERNAL_MCP_INTENT_RE =
  /\b(mcp|crm|notion|github|slack|discord|google\s+drive|calendar|agenda\s+google|docs|sheets|wordpress|woocommerce|elementor|shopify|rd\s*station|hubspot|pipedrive|airtable|stripe|email|e-mail|imap|smtp)\b/i;

const PRODUCTION_SKILL_RE =
  /\b(crie|criar|gere|gerar|produza|produzir|monte|montar|escreva|escrever|redija|redigir|planeje|planejar|elabore|elaborar|desenvolva|desenvolver|roteiro|copy|carrossel|post|posts|storie|stories|reel|reels|v[ií]deo|an[uú]ncio|brandbook|identidade\s+visual|concorrente|concorrentes|entreg[aá]vel|dossi[eê]|auditar|audit|m[eé]trica|m[eé]tricas|calend[aá]rio\s+editorial|estrat[eé]gia|pilar|pilares|legenda|gancho)\b/i;

const MENTION_OR_HANDOFF_RE = /(?:^|\s)@[a-z0-9_-]+|\[HANDOFF:[a-z0-9_-]+\]/i;

/**
 * Planeja o carregamento preguiçoso (*lazy loading*) de ferramentas MCP, SKILL.md, imagens e contexto do estúdio.
 */
export function planTurnContext(input: TurnContextPlannerInput): TurnContextPlan {
  const prompt = String(input.userPrompt ?? "").trim();
  const hasMentionInPrompt = MENTION_OR_HANDOFF_RE.test(prompt);

  const hasOperationalSignalInPrompt =
    BROWSER_INTENT_RE.test(prompt) ||
    SCHEDULE_INTENT_RE.test(prompt) ||
    WORKFLOW_INTENT_RE.test(prompt) ||
    MESSAGING_INTENT_RE.test(prompt) ||
    META_INTENT_RE.test(prompt) ||
    MEDIA_INTENT_RE.test(prompt) ||
    DATA_UI_INTENT_RE.test(prompt) ||
    EXTERNAL_MCP_INTENT_RE.test(prompt) ||
    PRODUCTION_SKILL_RE.test(prompt);

  const shouldUseLightMode =
    input.isGreetingOrCapability &&
    !hasOperationalSignalInPrompt &&
    !hasMentionInPrompt &&
    input.anexosCount === 0 &&
    !input.hasOpenBrowserTabs &&
    !input.hasActiveWakeups &&
    !input.hasWokenWaits &&
    !input.isHandoff &&
    !input.isRoutine;

  if (shouldUseLightMode) {
    return {
      mode: "light",
      loadFullSkill: false,
      attachBrandImages: false,
      compactLiveContext: true,
      mcpScopes: [],
      includeExternalMcps: false,
    };
  }

  const combinedText = input.recentHistoryText
    ? `${prompt}\n${input.recentHistoryText}`
    : prompt;

  const scopes = new Set<StudioToolScope>(["core"]);

  if (input.hasOpenBrowserTabs || BROWSER_INTENT_RE.test(combinedText)) {
    scopes.add("browser");
  }
  if (
    input.hasActiveWakeups ||
    input.isRoutine ||
    input.hasWokenWaits ||
    SCHEDULE_INTENT_RE.test(combinedText)
  ) {
    scopes.add("schedule");
  }
  if (WORKFLOW_INTENT_RE.test(combinedText)) {
    scopes.add("workflows");
  }
  if (input.channelOrigin === "whatsapp" || MESSAGING_INTENT_RE.test(combinedText)) {
    scopes.add("messaging");
  }
  if (
    input.agenteId === "engenheiro_meta" ||
    input.agenteId === "analista_metricas" ||
    META_INTENT_RE.test(combinedText)
  ) {
    scopes.add("meta");
  }
  if (input.anexosCount > 0 || MEDIA_INTENT_RE.test(combinedText)) {
    scopes.add("media");
  }
  if (DATA_UI_INTENT_RE.test(combinedText)) {
    scopes.add("data_ui");
  }

  const onlyCoreSoFar = scopes.size === 1;
  const includeExternalMcps = Boolean(
    input.hasExternalMcps &&
      (EXTERNAL_MCP_INTENT_RE.test(combinedText) || onlyCoreSoFar),
  );
  if (includeExternalMcps) {
    scopes.add("external_mcp");
  }

  const loadFullSkill =
    input.isHandoff ||
    input.isRoutine ||
    input.anexosCount > 0 ||
    PRODUCTION_SKILL_RE.test(prompt);

  const attachBrandImages =
    input.anexosCount > 0 ||
    (scopes.has("media") && IMAGE_GENERATION_OR_VISUAL_EDIT_RE.test(prompt));

  return {
    mode: "action",
    loadFullSkill,
    attachBrandImages,
    compactLiveContext: false,
    mcpScopes: ALL_STUDIO_TOOL_SCOPES.filter((scope) => scopes.has(scope)),
    includeExternalMcps,
  };
}
