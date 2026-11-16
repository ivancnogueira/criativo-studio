import { randomUUID } from "node:crypto";
import type {
  AgentStepEvent,
  AgentTurnContext,
  AgentTurnResult,
  AIProviderClient,
  ToolCallRequest,
} from "@criativo/contracts";
import {
  resolveVaultKeyOrThrow,
  sanitizeProviderError,
  type FetchLike,
  type ProviderAdapterOptions,
} from "./provider-interface.ts";

interface GeminiPart {
  text?: string;
  thought?: boolean;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: { result: unknown } };
}

interface GeminiResponsePayload {
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: GeminiPart[] };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
  error?: { message?: string };
}

/**
 * Adaptador BYOK para Google Gemini API (v1beta) com suporte a Tool Calling e streaming.
 */
export class GeminiProvider implements AIProviderClient {
  public readonly name = "gemini" as const;
  private readonly options: ProviderAdapterOptions;
  private readonly fetchFn: FetchLike;
  private readonly baseUrl: string;

  constructor(options: ProviderAdapterOptions) {
    this.options = options;
    this.fetchFn = options.fetchImpl ?? fetch;
    this.baseUrl =
      options.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
  }

  public buildRequestBody(turnContext: AgentTurnContext): Record<string, unknown> {
    const contents = turnContext.messages
      .filter((m) => m.role !== "system")
      .map((msg) => {
        if (msg.role === "tool") {
          let parsedOutput: unknown = msg.content;
          try {
            parsedOutput = JSON.parse(msg.content);
          } catch {
            // mantém string simples
          }
          return {
            role: "user",
            parts: [
              {
                functionResponse: {
                  name: msg.toolName ?? "tool",
                  response: { result: parsedOutput },
                },
              },
            ],
          };
        }

        const parts: GeminiPart[] = [];
        if (msg.content) {
          parts.push({ text: msg.content });
        }
        if (msg.toolCalls) {
          for (const call of msg.toolCalls) {
            parts.push({
              functionCall: { name: call.name, args: call.arguments },
            });
          }
        }
        return {
          role: msg.role === "assistant" ? "model" : "user",
          parts: parts.length > 0 ? parts : [{ text: "" }],
        };
      });

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: turnContext.temperature ?? 0.7,
        maxOutputTokens: turnContext.maxTokens ?? 4096,
      },
    };

    if (turnContext.systemPrompt) {
      body.systemInstruction = {
        parts: [{ text: turnContext.systemPrompt }],
      };
    }

    if (turnContext.tools && turnContext.tools.length > 0) {
      body.tools = [
        {
          functionDeclarations: turnContext.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          })),
        },
      ];
    }

    return body;
  }

  private parseGeminiResponse(payload: GeminiResponsePayload): AgentTurnResult {
    const candidate = payload.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const textChunks: string[] = [];
    const toolCalls: ToolCallRequest[] = [];

    for (const part of parts) {
      if (part.text && !part.thought) {
        textChunks.push(part.text);
      }
      if (part.functionCall) {
        toolCalls.push({
          id: randomUUID(),
          name: part.functionCall.name,
          arguments: part.functionCall.args ?? {},
        });
      }
    }

    return {
      text: textChunks.join(""),
      toolCalls,
      finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
      usage: payload.usageMetadata
        ? {
            inputTokens: payload.usageMetadata.promptTokenCount ?? 0,
            outputTokens: payload.usageMetadata.candidatesTokenCount ?? 0,
          }
        : undefined,
    };
  }

  public async generateText(prompt: string, systemPrompt = ""): Promise<string> {
    const res = await this.executeTurn({
      model: this.options.defaultModel ?? "gemini-2.5-flash",
      systemPrompt,
      messages: [{ role: "user", content: prompt }],
    });
    return res.text;
  }

  public async executeTurn(turnContext: AgentTurnContext): Promise<AgentTurnResult> {
    const apiKey = resolveVaultKeyOrThrow(
      this.options.vault,
      ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
      "Gemini"
    );
    const model = (turnContext.model || "gemini-2.5-flash").replace(/^gemini\//, "");
    const endpoint = `${this.baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    try {
      const response = await this.fetchFn(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(this.buildRequestBody(turnContext)),
      });

      const payload = (await response.json()) as GeminiResponsePayload;
      if (!response.ok) {
        throw new Error(
          payload.error?.message ?? `Erro HTTP ${response.status} na Gemini API`
        );
      }
      return this.parseGeminiResponse(payload);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(sanitizeProviderError(msg, [apiKey]));
    }
  }

  public async streamTurn(
    turnContext: AgentTurnContext,
    onChunk: (event: AgentStepEvent) => void
  ): Promise<AgentTurnResult> {
    const apiKey = resolveVaultKeyOrThrow(
      this.options.vault,
      ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
      "Gemini"
    );
    const model = (turnContext.model || "gemini-2.5-flash").replace(/^gemini\//, "");
    const endpoint = `${this.baseUrl}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

    try {
      const response = await this.fetchFn(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(this.buildRequestBody(turnContext)),
      });

      if (!response.ok) {
        const textErr = await response.text();
        throw new Error(`Erro HTTP ${response.status} no stream Gemini: ${textErr}`);
      }

      if (!response.body) {
        const payload = (await response.json()) as GeminiResponsePayload;
        const parsed = this.parseGeminiResponse(payload);
        if (parsed.text) onChunk({ type: "text_delta", tokenChunk: parsed.text });
        for (const tc of parsed.toolCalls) onChunk({ type: "tool_call", toolCall: tc });
        onChunk({ type: "done" });
        return parsed;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";
      const allToolCalls: ToolCallRequest[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith("data:")) continue;
          const jsonStr = line.slice(5).trim();
          if (!jsonStr || jsonStr === "[DONE]") continue;

          const chunk = JSON.parse(jsonStr) as GeminiResponsePayload;
          const parts = chunk.candidates?.[0]?.content?.parts ?? [];
          for (const part of parts) {
            if (part.thought && part.text) {
              onChunk({ type: "thought", tokenChunk: part.text });
            } else if (part.text) {
              fullText += part.text;
              onChunk({ type: "text_delta", tokenChunk: part.text });
            } else if (part.functionCall) {
              const tc: ToolCallRequest = {
                id: randomUUID(),
                name: part.functionCall.name,
                arguments: part.functionCall.args ?? {},
              };
              allToolCalls.push(tc);
              onChunk({ type: "tool_call", toolCall: tc });
            }
          }
        }
      }

      onChunk({ type: "done" });
      return {
        text: fullText,
        toolCalls: allToolCalls,
        finishReason: allToolCalls.length > 0 ? "tool_calls" : "stop",
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(sanitizeProviderError(msg, [apiKey]));
    }
  }
}
