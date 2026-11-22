import {
  existsSync,
  readFileSync,
} from "node:fs";
import {
  join,
  resolve,
} from "node:path";
import type {
  ModeloProvedorInfo,
  OnboardingEstado,
  ProviderName,
} from "@criativo/contracts";
import type {
  CriativoDatabase,
} from "../database/client.ts";
import type {
  McpGateway,
} from "../mcp/mcp-gateway.ts";
import type {
  CriativoStudioMcpBridge,
} from "../mcp/studio-mcp-bridge.ts";
import type {
  VaultService,
} from "../vault/vault-service.ts";
import {
  AntigravityLiveService,
} from "./antigravity-live-service.ts";
import {
  CliOAuthAccountsService,
} from "./cli-oauth-accounts-service.ts";
import {
  OpenCodeLiveService,
} from "./opencode-live-service.ts";

export interface ProviderCatalogMeta {
  provedor: ProviderName;
  rotulo: string;
  subtitulo: string;
  cliBins: string[];
  managedRuntimeFolder?: string;
  vaultKeys: string[];
  fallbackModelos: ModeloProvedorInfo[];
}

export const PROVIDER_CATALOG: readonly ProviderCatalogMeta[] = [
  {
    provedor: "gemini",
    rotulo: "Gemini",
    subtitulo: "Conta Google OAuth (Antigravity & Nano Banana) ou Gemini API Key",
    cliBins: ["antigravity", "agy", "gemini"],
    managedRuntimeFolder: "antigravity",
    vaultKeys: ["gemini_api_key", "google_api_key"],
    fallbackModelos: [
      { id: "gemini-3.8-flash-high", rotulo: "Gemini 3.8 Flash", padrao: true, suporta_imagem: true, esforcos_suportados: ["baixo", "medio", "alto"] },
      { id: "gemini-2.5-pro", rotulo: "Gemini 2.5 Pro", suporta_imagem: true, esforcos_suportados: ["baixo", "medio", "alto"] },
      { id: "gemini-nano-banana-2.1", rotulo: "Gemini Nano Banana 2.1 (Imagem)", suporta_imagem: true },
      { id: "gemini-omni-1.2-flash", rotulo: "Gemini Omni 1.2 Flash (Vídeo + Áudio)", suporta_imagem: true },
      { id: "gemini-3.1-flash-image", rotulo: "Gemini 3.1 Flash Image (Nano Banana)", suporta_imagem: true },
    ],
  },
  {
    provedor: "claude",
    rotulo: "Claude",
    subtitulo: "Conta Claude.ai no navegador ou Anthropic API Key",
    cliBins: ["claude"],
    managedRuntimeFolder: "claude",
    vaultKeys: ["anthropic_api_key", "claude_api_key"],
    fallbackModelos: [
      { id: "claude-sonnet-4-6", rotulo: "Claude Sonnet 4.6", padrao: true, esforcos_suportados: ["baixo", "medio", "alto"] },
      { id: "claude-opus-4-6", rotulo: "Claude Opus 4.6", esforcos_suportados: ["baixo", "medio", "alto"] },
      { id: "claude-3-7-sonnet-latest", rotulo: "Claude 3.7 Sonnet", esforcos_suportados: ["baixo", "medio", "alto"] },
      { id: "claude-3-5-haiku-latest", rotulo: "Claude 3.5 Haiku", esforcos_suportados: ["baixo", "medio"] },
    ],
  },
  {
    provedor: "openai",
    rotulo: "ChatGPT",
    subtitulo: "Conta ChatGPT/Codex no navegador ou OpenAI API Key",
    cliBins: ["codex", "openai"],
    managedRuntimeFolder: "codex",
    vaultKeys: ["openai_api_key"],
    fallbackModelos: [
      { id: "gpt-5.4", rotulo: "GPT-5.4 (Codex)", padrao: true, suporta_imagem: true, esforcos_suportados: ["baixo", "medio", "alto"] },
      { id: "gpt-4o", rotulo: "GPT-4o", suporta_imagem: true, esforcos_suportados: ["baixo", "medio", "alto"] },
      { id: "o3-mini", rotulo: "o3-mini (Raciocínio)", esforcos_suportados: ["baixo", "medio", "alto"] },
      { id: "gpt-image-2.6-sunburst", rotulo: "GPT Image 2.6 Sunburst", suporta_imagem: true },
      { id: "gpt-image-2.5-sunburst", rotulo: "GPT Image 2.5 Sunburst", suporta_imagem: true },
    ],
  },
  {
    provedor: "opencode",
    rotulo: "OpenCode",
    subtitulo: "Modelos gratuitos ativos neste servidor (API Key opcional)",
    cliBins: ["opencode"],
    managedRuntimeFolder: "opencode",
    vaultKeys: ["opencode_api_key"],
    fallbackModelos: [
      { id: "opencode/glm-5.3-flash-free", rotulo: "OpenCode / GLM 5.3 Flash Free", padrao: true, gratuito: true, esforcos_suportados: ["medio", "alto"] },
      { id: "opencode/deepseek-v4.1-flash-free", rotulo: "OpenCode / DeepSeek V4.1 Flash Free", gratuito: true, esforcos_suportados: ["medio", "alto"] },
      { id: "opencode/beam-free", rotulo: "OpenCode / Beam Free", gratuito: true, esforcos_suportados: ["medio", "alto"] },
    ],
  },
  {
    provedor: "grok",
    rotulo: "Grok",
    subtitulo: "xAI API Key cifrada no Cofre",
    cliBins: ["grok"],
    managedRuntimeFolder: "grok",
    vaultKeys: ["xai_api_key", "grok_api_key"],
    fallbackModelos: [
      { id: "grok-4.7", rotulo: "Grok 4.7", padrao: true, esforcos_suportados: ["baixo", "medio", "alto"] },
      { id: "grok-4.6", rotulo: "Grok 4.6", esforcos_suportados: ["baixo", "medio"] },
      { id: "grok-code-fast-1", rotulo: "Grok Code Fast 1" },
    ],
  },
  {
    provedor: "ollama",
    rotulo: "Ollama (Local)",
    subtitulo: "Servidor Ollama offline em http://127.0.0.1:11434",
    cliBins: ["ollama"],
    vaultKeys: [],
    fallbackModelos: [
      { id: "ollama/qwen2.5:14b", rotulo: "Qwen 2.5 14B (Local)", padrao: true, gratuito: true },
      { id: "ollama/llama3.2:latest", rotulo: "Llama 3.2 (Local)", gratuito: true },
      { id: "ollama/gemma3:12b", rotulo: "Gemma 3 12B (Local)", gratuito: true },
    ],
  },
];

export function readDefaultRuntimeVersion(workspaceRoot?: string): string {
  const candidates = [
    process.env.CRIATIVO_PRODUCT_ROOT ? join(process.env.CRIATIVO_PRODUCT_ROOT, "produto.json") : null,
    workspaceRoot ? join(workspaceRoot, "produto.json") : null,
    workspaceRoot ? resolve(workspaceRoot, "..", "..", "produto.json") : null,
    join(process.cwd(), "produto.json"),
  ].filter((p): p is string => Boolean(p));

  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const parsed = JSON.parse(readFileSync(p, "utf8")) as { versao?: unknown };
      if (typeof parsed.versao === "string" && parsed.versao.trim()) {
        const clean = parsed.versao.trim();
        return clean.startsWith("v") ? clean : `v${clean}`;
      }
    } catch {
      // ignora arquivo inválido
    }
  }
  return process.env.CRIATIVO_APP_VERSION?.trim()
    ? `v${process.env.CRIATIVO_APP_VERSION.trim().replace(/^v/i, "")}`
    : "v1.0.0";
}

export const API_MODELS_CACHE_TTL_MS = 5 * 60_000;
export const apiKeyModelsCache = new Map<ProviderName, { expiresAt: number; models: ModeloProvedorInfo[] }>();

export async function fetchApiModelsForProvider(
  provedor: ProviderName,
  apiKey: string
): Promise<ModeloProvedorInfo[]> {
  if (!apiKey || process.env.CRIATIVO_SKIP_LOCAL_PROBE === "1") {
    return [];
  }

  try {
    if (provedor === "openai") {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(2500),
      });
      if (!res.ok) return [];
      const payload = (await res.json()) as { data?: Array<{ id?: string }> };
      const filtered = (payload.data ?? [])
        .map((item) => (typeof item.id === "string" ? item.id.trim() : ""))
        .filter(
          (id) =>
            Boolean(id) &&
            /^(gpt-|o1|o3|o4|chatgpt-)/i.test(id) &&
            !/(instruct|realtime|audio|transcribe|tts|whisper|embedding)/i.test(id)
        );
      filtered.sort((a, b) => a.localeCompare(b));
      return filtered.map((id, idx) => ({
        id,
        rotulo: id,
        padrao: id === "gpt-4o" || (!filtered.includes("gpt-4o") && idx === 0),
        suporta_imagem: id.includes("image") || id.includes("4o"),
        esforcos_suportados: ["baixo", "medio", "alto"],
        descoberto_em_conta: true,
      }));
    }

    if (provedor === "claude") {
      const res = await fetch("https://api.anthropic.com/v1/models", {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        signal: AbortSignal.timeout(2500),
      });
      if (!res.ok) return [];
      const payload = (await res.json()) as {
        data?: Array<{ id?: string; display_name?: string }>;
      };
      return (payload.data ?? [])
        .filter((item) => typeof item.id === "string" && item.id.trim().length > 0)
        .map((item, idx) => ({
          id: item.id!.trim(),
          rotulo: item.display_name?.trim() || item.id!.trim(),
          padrao: idx === 0,
          esforcos_suportados: ["baixo", "medio", "alto"],
          descoberto_em_conta: true,
        }));
    }

    if (provedor === "gemini") {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
        { signal: AbortSignal.timeout(2500) }
      );
      if (!res.ok) return [];
      const payload = (await res.json()) as {
        models?: Array<{
          name?: string;
          displayName?: string;
          supportedGenerationMethods?: string[];
        }>;
      };
      return (payload.models ?? [])
        .filter(
          (m) =>
            typeof m.name === "string" &&
            Array.isArray(m.supportedGenerationMethods) &&
            m.supportedGenerationMethods.includes("generateContent")
        )
        .map((m, idx) => {
          const cleanId = m.name!.replace(/^models\//, "").trim();
          return {
            id: cleanId,
            rotulo: m.displayName?.trim() || cleanId,
            padrao: idx === 0,
            suporta_imagem: cleanId.includes("image") || cleanId.includes("imagen"),
            esforcos_suportados: ["baixo", "medio", "alto"],
            descoberto_em_conta: true,
          };
        });
    }

    if (provedor === "grok") {
      const res = await fetch("https://api.x.ai/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(2500),
      });
      if (!res.ok) return [];
      const payload = (await res.json()) as { data?: Array<{ id?: string }> };
      return (payload.data ?? [])
        .filter((item) => typeof item.id === "string" && item.id.trim().length > 0)
        .map((item, idx) => ({
          id: item.id!.trim(),
          rotulo: item.id!.trim(),
          padrao: idx === 0,
          esforcos_suportados: ["baixo", "medio", "alto"],
          descoberto_em_conta: true,
        }));
    }
  } catch {
    // falha silenciosa em ambiente offline ou timeout -> usa fallback somente quando conectado
  }

  return [];
}

export const DEFAULT_ONBOARDING: OnboardingEstado = {
  onboarding_concluido: false,
  modo_provedor_inicial: null,
  provedor_selecionado: null,
  telemetria_anonima: false,
  marca_nome: "[NOME_DA_MARCA]",
  perfil_handle: "[@SEU_PERFIL]",
  runtime_versao: readDefaultRuntimeVersion(),
  atualizado_em: new Date().toISOString(),
};


export interface ProviderConnectionDeps {
  db: import("../database/client.ts").CriativoDatabase;
  vault: import("../vault/vault-service.ts").VaultService;
  antigravityLive: import("./antigravity-live-service.ts").AntigravityLiveService;
  cliOAuth: import("./cli-oauth-accounts-service.ts").CliOAuthAccountsService;
  opencodeLive: import("./opencode-live-service.ts").OpenCodeLiveService;
  mcpGateway?: import("../mcp/mcp-gateway.ts").McpGateway;
  studioMcpBridge?: import("../mcp/studio-mcp-bridge.ts").CriativoStudioMcpBridge;
  getCliProbeCache: () => Promise<Record<import("@criativo/contracts").KnownProviderName, { found: boolean; version: string | null; executable: string | null }>>;
  getAgentsByProvider: () => Record<string, string[]>;
  invalidateCliProbeCache: () => void;
  getStudioConfig: <T>(chave: string, fallback: T) => T;
  setStudioConfig: (chave: string, valor: unknown) => void;
  getOnboardingState: () => import("@criativo/contracts").OnboardingEstado;
  updateOnboardingState: (patch: Partial<import("@criativo/contracts").OnboardingEstado>) => import("@criativo/contracts").OnboardingEstado;
}

export type TailArgs<F> = F extends (deps: ProviderConnectionDeps, ...args: infer A) => unknown ? A : never;

