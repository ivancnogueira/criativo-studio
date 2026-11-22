import type {
  BrowserTargetSelector,
  PermissionLevel,
  ToolDefinition,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../../database/client.ts";
import type { BrowserAutomationService } from "../../engine/tools/browser-automation.ts";
import type { ScreenCaptureBridge } from "../../engine/tools/screen-capture-bridge.ts";
import type { RemoteClaimService } from "../../servers/remote-claim-service.ts";
import type { TranscriptionService } from "../../voice/transcription-service.ts";
import type { BrowserAutofillService } from "../../vault/browser-autofill-service.ts";
import type { CrmService } from "../../crm/crm-service.ts";
import { CRM_TOOL_DEFINITIONS } from "../../crm/crm-tools.ts";
import type { CuaDriverClient } from "../../engine/tools/cua-driver-client.ts";
import { CUA_TOOL_DEFINITIONS } from "../../engine/tools/cua-tools.ts";
import type { ShowcaseSiteService } from "../showcase-service.ts";
import type { WebSocketHub } from "../websocket-hub.ts";
export const BROWSER_DIRECT_ALIASES = [
  "browser_open",
  "browser_list_tabs",
  "browser_status",
  "browser_navigate",
  "browser_go_back",
  "browser_go_forward",
  "browser_reload",
  "browser_snapshot",
  "browser_click",
  "browser_type",
  "browser_fill_fields",
  "browser_press",
  "browser_hover",
  "browser_scroll",
  "browser_select_option",
  "browser_set_checked",
  "browser_drag",
  "browser_upload_files",
  "browser_wait_for",
  "browser_evaluate",
  "browser_screenshot",
  "browser_set_environment",
  "browser_handle_dialog",
  "browser_request_takeover",
  "browser_release_takeover",
  "browser_submit_secret",
  "browser_autofill_login",
  "browser_close_tab",
] as const;

export const HIDDEN_CATALOG_TOOL_NAMES: ReadonlySet<string> = new Set<string>(BROWSER_DIRECT_ALIASES);

export const BROWSER_TARGET_SCHEMA = {
  type: "object",
  description:
    "Seletor do elemento alvo no snapshot/DOM ({ ref: 'e12' }, { selector: '#btn' }, { role: 'button', name: 'Enviar' }, { text: 'Continuar' } ou { x, y }).",
  properties: {
    kind: {
      type: "string",
      enum: ["ref", "role", "text", "css", "point"],
      description: "Tipo explícito do seletor (opcional; inferido automaticamente quando omitido).",
    },
    ref: {
      type: "string",
      description: "Referência curta obtida no snapshot (ex.: 'e12').",
    },
    revision: {
      type: "number",
      description: "Revisão do snapshot associada à ref.",
    },
    role: {
      type: "string",
      description: "Papel ARIA do elemento (ex.: 'button', 'textbox').",
    },
    name: {
      type: "string",
      description: "Nome acessível do elemento ARIA.",
    },
    text: {
      type: "string",
      description: "Texto visível do elemento.",
    },
    exact: {
      type: "boolean",
      description: "Exige correspondência exata de name/text.",
    },
    selector: {
      type: "string",
      description: "Seletor CSS para o elemento (ex.: '#campo-busca').",
    },
    nth: {
      type: "number",
      description: "Índice baseado em zero quando houver múltiplos elementos.",
    },
    x: {
      type: "number",
      description: "Coordenada X na viewport em pixels.",
    },
    y: {
      type: "number",
      description: "Coordenada Y na viewport em pixels.",
    },
  },
} as const;

export function normalizeBrowserTargetInput(raw: unknown): BrowserTargetSelector | undefined {
  if (raw === null || raw === undefined) return undefined;

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    if (/^e\d+$/i.test(trimmed)) {
      return { kind: "ref", ref: trimmed };
    }
    return { kind: "css", selector: trimmed };
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }

  const obj = raw as Record<string, unknown>;
  const explicitKind = typeof obj.kind === "string" ? obj.kind.trim().toLowerCase() : "";
  const nth = typeof obj.nth === "number" && Number.isFinite(obj.nth) ? obj.nth : undefined;
  const exact = typeof obj.exact === "boolean" ? obj.exact : undefined;

  if (explicitKind === "ref" || (!explicitKind && typeof obj.ref === "string" && obj.ref.trim())) {
    const ref = typeof obj.ref === "string" ? obj.ref.trim() : "";
    if (!ref) return undefined;
    const revision =
      typeof obj.revision === "number" && Number.isFinite(obj.revision) ? obj.revision : undefined;
    return {
      kind: "ref",
      ref,
      ...(revision !== undefined ? { revision } : {}),
    };
  }

  const cssCandidate =
    typeof obj.selector === "string" && obj.selector.trim()
      ? obj.selector.trim()
      : typeof obj.css === "string" && obj.css.trim()
        ? obj.css.trim()
        : "";
  if (explicitKind === "css" || (!explicitKind && cssCandidate)) {
    if (!cssCandidate) return undefined;
    return {
      kind: "css",
      selector: cssCandidate,
      ...(nth !== undefined ? { nth } : {}),
    };
  }

  if (
    explicitKind === "point" ||
    (!explicitKind && typeof obj.x === "number" && typeof obj.y === "number")
  ) {
    const x = Number(obj.x);
    const y = Number(obj.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
    return { kind: "point", x, y };
  }

  if (explicitKind === "role" || (!explicitKind && typeof obj.role === "string" && obj.role.trim())) {
    const role = typeof obj.role === "string" ? obj.role.trim() : "";
    if (!role) return undefined;
    const name = typeof obj.name === "string" && obj.name.trim() ? obj.name.trim() : undefined;
    return {
      kind: "role",
      role,
      ...(name !== undefined ? { name } : {}),
      ...(exact !== undefined ? { exact } : {}),
      ...(nth !== undefined ? { nth } : {}),
    };
  }

  if (explicitKind === "text" || (!explicitKind && typeof obj.text === "string" && obj.text.trim())) {
    const text = typeof obj.text === "string" ? obj.text.trim() : "";
    if (!text) return undefined;
    return {
      kind: "text",
      text,
      ...(exact !== undefined ? { exact } : {}),
      ...(nth !== undefined ? { nth } : {}),
    };
  }

  if (typeof obj.name === "string" && obj.name.trim()) {
    return {
      kind: "text",
      text: obj.name.trim(),
      ...(exact !== undefined ? { exact } : {}),
      ...(nth !== undefined ? { nth } : {}),
    };
  }

  return undefined;
}

export const PHASE15_TOOLS_SCHEMA: ToolDefinition[] = [
  {
    name: "criativo_browser",
    description:
      "Controla o navegador real Chromium embutido via Chrome DevTools Protocol (open, list_tabs, status, navigate, go_back, go_forward, reload, snapshot, click, type, fill_fields, press, hover, scroll, select_option, set_checked, drag, upload_files, wait_for, evaluate, screenshot, set_environment, handle_dialog, request_takeover, release_takeover, submit_secret, close_tab).",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "open",
            "list_tabs",
            "status",
            "navigate",
            "go_back",
            "go_forward",
            "reload",
            "snapshot",
            "click",
            "type",
            "fill_fields",
            "press",
            "hover",
            "scroll",
            "select_option",
            "set_checked",
            "drag",
            "upload_files",
            "wait_for",
            "evaluate",
            "screenshot",
            "set_environment",
            "handle_dialog",
            "request_takeover",
            "release_takeover",
            "submit_secret",
            "autofill_login",
            "close_tab",
          ],
        },
        tabId: { type: "string" },
        perfilId: { type: "string" },
        url: { type: "string" },
        target: BROWSER_TARGET_SCHEMA,
        toTarget: BROWSER_TARGET_SCHEMA,
        text: { type: "string" },
        clear: { type: "boolean" },
        pressEnter: { type: "boolean" },
        key: { type: "string" },
        fields: {
          type: "array",
          items: {
            type: "object",
            properties: {
              target: BROWSER_TARGET_SCHEMA,
              value: { type: "string" },
            },
            required: ["target", "value"],
          },
        },
        deltaX: { type: "number" },
        deltaY: { type: "number" },
        values: { type: "array", items: { type: "string" } },
        checked: { type: "boolean" },
        paths: { type: "array", items: { type: "string" } },
        waitKind: { type: "string", enum: ["text", "selector", "url", "load"] },
        waitValue: { type: "string" },
        timeoutMs: { type: "number" },
        image: { type: "boolean" },
        expression: { type: "string" },
        accept: { type: "boolean" },
        promptText: { type: "string" },
        viewport: {
          type: "object",
          properties: {
            width: { type: "number" },
            height: { type: "number" },
          },
        },
        userAgent: { type: "string" },
        locale: { type: "string" },
        timezoneId: { type: "string" },
        colorScheme: { type: "string", enum: ["dark", "light"] },
        reason: {
          type: "string",
          enum: ["login", "2fa", "captcha", "passkey", "payment", "sign-in-blocked", "manual"],
        },
        waitForTakeover: { type: "boolean" },
        method: { type: "string", enum: ["password", "otp", "authenticator"] },
        targets: { type: "array", items: BROWSER_TARGET_SCHEMA },
        loginId: { type: "string" },
        username: { type: "string" },
        submission: { type: "string", enum: ["enter", "click", "none"] },
        submitTarget: BROWSER_TARGET_SCHEMA,
      },
      required: ["action"],
    },
  },
  ...BROWSER_DIRECT_ALIASES.map((aliasName): ToolDefinition => ({
    name: aliasName,
    description: `Atalho direto para criativo_browser(action="${aliasName.slice("browser_".length)}").`,
    parameters: {
      type: "object",
      properties: {
        tabId: { type: "string" },
        perfilId: { type: "string" },
        url: { type: "string" },
        target: BROWSER_TARGET_SCHEMA,
        toTarget: BROWSER_TARGET_SCHEMA,
        text: { type: "string" },
        fields: {
          type: "array",
          items: {
            type: "object",
            properties: {
              target: BROWSER_TARGET_SCHEMA,
              value: { type: "string" },
            },
            required: ["target", "value"],
          },
        },
        key: { type: "string" },
        paths: { type: "array", items: { type: "string" } },
        expression: { type: "string" },
        reason: { type: "string" },
        image: { type: "boolean" },
      },
    },
  })),
  {
    name: "read_video",
    description:
      "Lê vídeo público (Reels, TikTok, YouTube ou MP4 direto) extraindo metadados, legendas/transcrição e até 12 frames-chave JPEG.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL pública http(s) do vídeo." },
        frames: { type: "number", description: "Quantidade de frames-chave JPEG (0 a 12, padrão 6)." },
        timeoutMs: { type: "number" },
      },
      required: ["url"],
    },
  },
  {
    name: "read_image",
    description:
      "Lê uma imagem PNG/JPEG/WebP do workspace permitido, validando assinatura binária e retornando imagem redimensionada com orientação EXIF correta.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Caminho relativo no workspace permitido." },
        maxDimension: { type: "number", description: "Dimensão máxima em pixels (padrão 1568)." },
      },
      required: ["path"],
    },
  },
  {
    name: "capture_screen",
    description:
      "Solicita ao usuário autorização explícita via getDisplayMedia() no navegador para capturar uma imagem única da tela ou janela atual.",
    parameters: {
      type: "object",
      properties: {
        purpose: {
          type: "string",
          description: "Explicação clara para o usuário sobre o motivo da captura pontual.",
        },
        targetHint: { type: "string", description: "Sugestão opcional de aba/janela alvo." },
        timeoutMs: { type: "number" },
      },
      required: ["purpose"],
    },
  },
  {
    name: "list_sections",
    description: "Lista todas as seções hierárquicas da Sidebar e os vínculos de agentes.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "create_section",
    description: "Cria uma nova seção na Sidebar (até 3 níveis de profundidade e máx 40 seções).",
    parameters: {
      type: "object",
      properties: {
        nome: { type: "string" },
        parentId: { type: "string" },
      },
      required: ["nome"],
    },
  },
  {
    name: "rename_section",
    description: "Renomeia uma seção existente da Sidebar.",
    parameters: {
      type: "object",
      properties: {
        sectionId: { type: "string" },
        nome: { type: "string" },
      },
      required: ["sectionId", "nome"],
    },
  },
  {
    name: "delete_section",
    description: "Remove uma seção da Sidebar promovendo suas subseções e agentes sem apagar nenhum agente.",
    parameters: {
      type: "object",
      properties: {
        sectionId: { type: "string" },
      },
      required: ["sectionId"],
    },
  },
  {
    name: "assign_agent_section",
    description: "Move ou ordena um agente para dentro de uma seção da Sidebar (ou raiz com sectionId=null).",
    parameters: {
      type: "object",
      properties: {
        agentId: { type: "string" },
        sectionId: { type: "string" },
        beforeAgentId: { type: "string" },
      },
      required: ["agentId"],
    },
  },
  {
    name: "list_sites",
    description: "Lista os sites estáticos locais publicados no Showcase (/showcase/:slug/).",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "publish_site",
    description: "Publica um diretório estático do workspace no Showcase local (/showcase/:slug/) mediante aprovação humana.",
    parameters: {
      type: "object",
      properties: {
        slug: { type: "string" },
        titulo: { type: "string" },
        descricao: { type: "string" },
        sourceDir: { type: "string" },
        spaFallback: { type: "boolean" },
        aprovadoPorHumano: { type: "boolean" },
      },
      required: ["slug", "titulo", "sourceDir"],
    },
  },
  {
    name: "replace_site",
    description: "Atualiza/substitui os arquivos estáticos de um site Showcase local mediante aprovação humana.",
    parameters: {
      type: "object",
      properties: {
        siteId: { type: "string" },
        sourceDir: { type: "string" },
        titulo: { type: "string" },
        descricao: { type: "string" },
        spaFallback: { type: "boolean" },
        aprovadoPorHumano: { type: "boolean" },
      },
      required: ["siteId", "sourceDir"],
    },
  },
  {
    name: "delete_site",
    description: "Remove um site estático publicado no Showcase local mediante aprovação humana.",
    parameters: {
      type: "object",
      properties: {
        siteId: { type: "string" },
        aprovadoPorHumano: { type: "boolean" },
      },
      required: ["siteId"],
    },
  },
  {
    name: "create_server_install_command",
    description:
      "Gera comando único de instalação e pareamento (CRIATIVO_CLAIM) com validade de 15 minutos para conectar uma VPS Linux ao Criativo AI Studio (fluxo 'Configurar com um agente'). Nunca registre o token em memórias permanentes.",
    parameters: {
      type: "object",
      properties: {
        server_name: { type: "string", description: "Nome amigável do servidor VPS" },
        aprovadoPorHumano: {
          type: "boolean",
          description: "Confirmação explícita do usuário antes de executar instalação em VPS.",
        },
      },
      required: ["server_name"],
    },
  },
  {
    name: "gerar_comando_claim_vps",
    description:
      "Gera um novo comando shell único (CRIATIVO_CLAIM válido por 15 minutos) para instalar e conectar uma VPS Linux ao Criativo AI Studio Online.",
    parameters: {
      type: "object",
      properties: {
        server_name: { type: "string", description: "Nome amigável opcional do servidor VPS." },
      },
    },
  },
  {
    name: "instalar_parear_servidor_vps",
    description:
      "Instala via SSH (quando host e chave SSH são fornecidos) ou verifica saúde HTTP (/health) de um servidor VPS Linux para conectá-lo ao Criativo AI Studio Online.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["install", "health_check"],
          description: "Ação desejada: 'install' executa o instalador via SSH; 'health_check' verifica http://host:port/health.",
        },
        host: { type: "string", description: "IP público ou domínio SSH/HTTP da VPS Linux." },
        port: { type: "number", description: "Porta SSH (padrão 22)." },
        username: { type: "string", description: "Usuário SSH (padrão 'root')." },
        private_key_path: { type: "string", description: "Caminho local opcional para chave privada SSH." },
        claim_secret: { type: "string", description: "Token CRIATIVO_CLAIM opcional; se omitido em 'install', gera um novo automaticamente." },
        server_name: { type: "string", description: "Nome amigável do servidor VPS." },
        server_port: { type: "number", description: "Porta do daemon do Criativo na VPS (padrão 3000)." },
      },
    },
  },
  ...CRM_TOOL_DEFINITIONS,
  ...CUA_TOOL_DEFINITIONS,
];

export const PHASE15_TOOL_NAMES: ReadonlySet<string> = new Set(
  PHASE15_TOOLS_SCHEMA.map((t) => t.name),
);

export function isPhase15ToolName(name: string): boolean {
  return PHASE15_TOOL_NAMES.has(name);
}

export interface Phase15ToolServices {
  db: CriativoDatabase;
  wsHub?: WebSocketHub;
  workspaceRoot: string;
  browserService?: BrowserAutomationService;
  screenCapture?: ScreenCaptureBridge;
  showcaseService?: ShowcaseSiteService;
  transcription?: TranscriptionService;
  remoteClaimService?: RemoteClaimService;
  browserAutofillService?: BrowserAutofillService;
  crmService?: CrmService;
  cuaClient?: CuaDriverClient;
}

export interface Phase15ToolContext {
  agenteId: string;
  canalId: string;
  permissionLevel?: PermissionLevel;
  browserProfileId?: string | null;
  aprovadoPorHumano?: boolean;
  generatedArtifacts?: string[];
}
