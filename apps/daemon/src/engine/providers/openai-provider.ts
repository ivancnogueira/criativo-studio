import { randomUUID } from "node:crypto";
import type {
  AgentStepEvent,
  AgentTurnContext,
  AgentTurnResult,
  AIProviderClient,
  ProviderName,
  ToolCallRequest,
} from "@criativo/contracts";
import {
  resolveVaultKeyOrThrow,
  sanitizeProviderError,
  type FetchLike,
  type ProviderAdapterOptions,
} from "./provider-interface.ts";

interface OpenAIChoiceMessage {
  content?: string | null;
  tool_calls?: Array<{
    id?: string;
    type?: string;
    function?: { name: string; arguments?: string };
  }>;
}

interface OpenAIChatResponse {
  choices?: Array<{
    message?: OpenAIChoiceMessage;
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  error?: { message?: string };
}

export interface OpenAIProviderOptions extends ProviderAdapterOptions {
  providerName?: ProviderName;
  secretKeys?: string[];
  requireApiKey?: boolean;
  customHeaders?: Record<string, string>;
}

/**
 * Adaptador BYOK compatível com OpenAI Chat Completions (OpenAI GPT-4o, xAI Grok, OpenRouter e Ollama).
 */
export class OpenAIProvider implements AIProviderClient {
  public readonly name: ProviderName;
  protected readonly options: OpenAIProviderOptions;
  protected readonly fetchFn: FetchLike;
  protected readonly baseUrl: string;

  constructor(options: OpenAIProviderOptions) {
    this.options = options;
    this.name = options.providerName ?? "openai";
    this.fetchFn = options.fetchImpl ?? fetch;
    this.baseUrl = options.baseUrl ?? "https://api.openai.com/v1";
  }

  public buildRequestBody(
    turnContext: AgentTurnContext,
    stream = false
  ): Record<string, unknown> {
    const messages: Array<Record<string, unknown>> = [];

    if (turnContext.systemPrompt) {
      messages.push({ role: "system", content: turnContext.systemPrompt });
    }

    for (const msg of turnContext.messages) {
      if (msg.role === "system") continue;
      if (msg.role === "tool") {
        messages.push({
          role: "tool",
          tool_call_id: msg.toolCallId ?? randomUUID(),
          content: msg.content,
        });
        continue;
      }

      if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
        messages.push({
          role: "assistant",
          content: msg.content || null,
          tool_calls: msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        });
        continue;
      }

      messages.push({ role: msg.role, content: msg.content });
    }

    const body: Record<string, unknown> = {
      model: turnContext.model || this.options.defaultModel || "gpt-4o",
      messages,
      temperature: turnContext.temperature ?? 0.7,
      max_tokens: turnContext.maxTokens ?? 4096,
      stream,
    };

    if (turnContext.tools && turnContext.tools.length > 0) {
      body.tools = turnContext.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
    }

    return body;
  }

  private getApiKey(): string | null {
    const keys = this.options.secretKeys ?? ["OPENAI_API_KEY", "GROK_API_KEY"];
    if (this.options.requireApiKey === false) {
      for (const k of keys) {
        const val = this.options.vault.getSecret(k);
        if (val) return val;
      }
      return null;
    }
    return resolveVaultKeyOrThrow(this.options.vault, keys, this.name.toUpperCase());
  }

  private parseResponse(payload: OpenAIChatResponse): AgentTurnResult {
    const choice = payload.choices?.[0];
    const message = choice?.message;
    const toolCalls: ToolCallRequest[] = (message?.tool_calls ?? [])
      .filter((tc) => tc.function?.name)
      .map((tc) => ({
        id: tc.id ?? randomUUID(),
        name: tc.function!.name,
        arguments: tc.function?.arguments
          ? (JSON.parse(tc.function.arguments) as Record<string, unknown>)
          : {},
      }));

    return {
      text: message?.content ?? "",
      toolCalls,
      finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
      usage: payload.usage
        ? {
            inputTokens: payload.usage.prompt_tokens ?? 0,
            outputTokens: payload.usage.completion_tokens ?? 0,
          }
        : undefined,
    };
  }

  public async generateText(prompt: string, systemPrompt = ""): Promise<string> {
    const res = await this.executeTurn({
      model: this.options.defaultModel ?? "gpt-4o",
      systemPrompt,
      messages: [{ role: "user", content: prompt }],
    });
    return res.text;
  }

  public async executeTurn(turnContext: AgentTurnContext): Promise<AgentTurnResult> {
    const apiKey = this.getApiKey();
    const headers: Record<string, string> = {
      ...(this.options.customHeaders ?? {}),
      "Content-Type": "application/json",
    };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    try {
      const response = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(this.buildRequestBody(turnContext, false)),
      });

      const payload = (await response.json()) as OpenAIChatResponse;
      if (!response.ok) {
        throw new Error(
          payload.error?.message ?? `Erro HTTP ${response.status} na API ${this.name}`
        );
      }
      return this.parseResponse(payload);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(sanitizeProviderError(msg, [apiKey]));
    }
  }

  public async streamTurn(
    turnContext: AgentTurnContext,
    onChunk: (event: AgentStepEvent) => void
  ): Promise<AgentTurnResult> {
    const apiKey = this.getApiKey();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    try {
      const response = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(this.buildRequestBody(turnContext, true)),
      });

      if (!response.ok) {
        const textErr = await response.text();
        throw new Error(`Erro HTTP ${response.status} no stream ${this.name}: ${textErr}`);
      }

      if (!response.body) {
        const payload = (await response.json()) as OpenAIChatResponse;
        const parsed = this.parseResponse(payload);
        if (parsed.text) onChunk({ type: "text_delta", tokenChunk: parsed.text });
        for (const tc of parsed.toolCalls) onChunk({ type: "tool_call", toolCall: tc });
        onChunk({ type: "done" });
        return parsed;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";
      const toolBuffers = new Map<number, { id: string; name: string; args: string }>();

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

          const evt = JSON.parse(jsonStr) as {
            choices?: Array<{
              delta?: {
                content?: string;
                reasoning_content?: string;
                tool_calls?: Array<{
                  index?: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
            }>;
          };

          const delta = evt.choices?.[0]?.delta;
          if (!delta) continue;
          if (delta.reasoning_content) {
            onChunk({ type: "thought", tokenChunk: delta.reasoning_content });
          }
          if (delta.content) {
            fullText += delta.content;
            onChunk({ type: "text_delta", tokenChunk: delta.content });
          }
          if (delta.tool_calls) {
            for (const tcDelta of delta.tool_calls) {
              const idx = tcDelta.index ?? 0;
              const existing = toolBuffers.get(idx) ?? {
                id: tcDelta.id ?? randomUUID(),
                name: tcDelta.function?.name ?? "",
                args: "",
              };
              if (tcDelta.id) existing.id = tcDelta.id;
              if (tcDelta.function?.name) existing.name = tcDelta.function.name;
              if (tcDelta.function?.arguments) existing.args += tcDelta.function.arguments;
              toolBuffers.set(idx, existing);
            }
          }
        }
      }

      const toolCalls: ToolCallRequest[] = [];
      for (const [, buf] of toolBuffers) {
        if (!buf.name) continue;
        const parsedArgs = buf.args ? (JSON.parse(buf.args) as Record<string, unknown>) : {};
        const tc: ToolCallRequest = { id: buf.id, name: buf.name, arguments: parsedArgs };
        toolCalls.push(tc);
        onChunk({ type: "tool_call", toolCall: tc });
      }

      onChunk({ type: "done" });
      return {
        text: fullText,
        toolCalls,
        finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(sanitizeProviderError(msg, [apiKey]));
    }
  }
}
