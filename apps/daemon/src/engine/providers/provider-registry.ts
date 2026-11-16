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

  constructor(options: ProviderRegistryOptions) {
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
  }

  public resolveProviderName(modelName: string): ProviderName {
    const normalized = modelName.trim().toLowerCase();
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
