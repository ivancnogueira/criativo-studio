import { OpenAIProvider } from "./openai-provider.ts";
import type { AgentTurnContext, ProviderAdapterOptions } from "./provider-interface.ts";

/**
 * Adaptador para modelos locais rodando em Ollama (compatível com /v1 OpenAI local).
 * Não exige chave de API no cofre para operação offline.
 */
export class OllamaProvider extends OpenAIProvider {
  constructor(options: ProviderAdapterOptions) {
    const customUrl = options.vault.getSecret("OLLAMA_BASE_URL");
    super({
      ...options,
      providerName: "ollama",
      baseUrl: options.baseUrl ?? customUrl ?? "http://localhost:11434/v1",
      defaultModel: options.defaultModel ?? "llama3.3",
      requireApiKey: false,
      secretKeys: ["OLLAMA_API_KEY"],
    });
  }

  public override buildRequestBody(
    turnContext: AgentTurnContext,
    stream = false
  ): Record<string, unknown> {
    const normalizedModel = (turnContext.model || "llama3.3").replace(/^ollama\//, "");
    return super.buildRequestBody(
      {
        ...turnContext,
        model: normalizedModel,
      },
      stream
    );
  }
}
