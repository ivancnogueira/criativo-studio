import type { AIProviderClient, ProviderName } from "@criativo/contracts";
import type { VaultService } from "../../vault/vault-service.ts";
import { ClaudeProvider } from "./claude-provider.ts";
import { GeminiProvider } from "./gemini-provider.ts";
import { OllamaProvider } from "./ollama-provider.ts";
import { OpenAIProvider } from "./openai-provider.ts";
import type { FetchLike } from "./provider-interface.ts";

export interface ProviderRegistryOptions {
  vault: VaultService;
  fetchImpl?: FetchLike;
}

/**
 * Resolve dinamicamente o cliente AIProviderClient apropriado a partir do identificador do modelo.
 */
export class ProviderRegistry {
  private readonly providers: Map<ProviderName, AIProviderClient>;
  private readonly customProviderNames = new Set<ProviderName>();
  private readonly vault: VaultService;

  constructor(options: ProviderRegistryOptions) {
    this.vault = options.vault;
    this.providers = new Map<ProviderName, AIProviderClient>([
      ["gemini", new GeminiProvider({ vault: options.vault, fetchImpl: options.fetchImpl })],
      ["claude", new ClaudeProvider({ vault: options.vault, fetchImpl: options.fetchImpl })],
      ["openai", new OpenAIProvider({ vault: options.vault, fetchImpl: options.fetchImpl })],
      [
        "grok",
        new OpenAIProvider({
          vault: options.vault,
          fetchImpl: options.fetchImpl,
          providerName: "grok",
          baseUrl: "https://api.x.ai/v1",
          secretKeys: ["xai_api_key", "grok_api_key"],
        }),
      ],
      ["ollama", new OllamaProvider({ vault: options.vault, fetchImpl: options.fetchImpl })],
    ]);
  }

  public registerCustomProvider(name: ProviderName, client: AIProviderClient): void {
    this.providers.set(name, client);
    this.customProviderNames.add(name);
  }

  public hasCustomProvider(name: ProviderName): boolean {
    return this.customProviderNames.has(name);
  }

  /**
   * Quando o agente usa o modelo fallback OpenCode padrão mas o usuário possui
   * outro provedor ativo via cliente customizado ou chave de API no Cofre (e sem OpenCode),
   * devolve o melhor cliente disponível no registry.
   */
  public resolveFallbackClientForDefault(): {
    client: AIProviderClient;
    provider: ProviderName;
    model: string;
  } | null {
    const order: readonly ProviderName[] = ["openai", "gemini", "claude", "grok", "ollama", "opencode"];
    for (const name of order) {
      if (this.customProviderNames.has(name)) {
        const client = this.providers.get(name);
        if (client) {
          return { client, provider: name, model: name };
        }
      }
    }
    const vaultMap: ReadonlyArray<{ provider: ProviderName; keys: readonly string[] }> = [
      { provider: "openai", keys: ["openai_api_key", "OPENAI_API_KEY"] },
      { provider: "gemini", keys: ["gemini_api_key", "GEMINI_API_KEY", "google_api_key"] },
      { provider: "claude", keys: ["claude_api_key", "anthropic_api_key", "ANTHROPIC_API_KEY"] },
      { provider: "grok", keys: ["grok_api_key", "xai_api_key"] },
    ];
    for (const item of vaultMap) {
      if (item.keys.some((k) => Boolean(this.vault.getSecret(k)))) {
        const client = this.providers.get(item.provider);
        if (client) {
          return { client, provider: item.provider, model: item.provider };
        }
      }
    }
    return null;
  }

  public resolveProviderName(modelName: string): ProviderName {
    const raw = modelName.trim();
    const normalized = raw.toLowerCase();
    if (normalized.startsWith("custom/")) {
      const rest = raw.slice("custom/".length);
      const slashIdx = rest.indexOf("/");
      const customId = (slashIdx >= 0 ? rest.slice(0, slashIdx) : rest).trim();
      if (customId) {
        return `custom:${customId}` as ProviderName;
      }
    }
    if (normalized.startsWith("lmstudio/") || normalized.startsWith("lmstudio:")) {
      return "lmstudio";
    }
    if (
      normalized.startsWith("opencode/") ||
      normalized.endsWith("-free") ||
      normalized.includes("big-pickle")
    ) {
      return "opencode";
    }
    if (normalized.startsWith("ollama/") || normalized.includes("llama") || normalized.includes("qwen")) {
      return "ollama";
    }
    if (normalized.includes("claude")) {
      return "claude";
    }
    if (normalized.includes("grok")) {
      return "grok";
    }
    if (
      normalized.includes("gpt") ||
      normalized.startsWith("o1") ||
      normalized.startsWith("o3")
    ) {
      return "openai";
    }
    return "gemini";
  }

  public getClientForModel(modelName: string): AIProviderClient {
    const providerName = this.resolveProviderName(modelName);
    const client = this.providers.get(providerName);
    if (!client) {
      throw new Error(`Provedor não registrado para modelo '${modelName}': ${providerName}`);
    }
    return client;
  }
}
