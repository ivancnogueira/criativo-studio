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

interface ClaudeContentBlock {
  type: "text" | "thinking" | "tool_use";
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface ClaudeResponsePayload {
  content?: ClaudeContentBlock[];
  stop_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  error?: { message?: string };
}

/**
 * Adaptador BYOK para Anthropic Claude API (/v1/messages) com Tool Calling e SSE streaming.
 */
export class ClaudeProvider implements AIProviderClient {
  public readonly name = "claude" as const;
  private readonly options: ProviderAdapterOptions;
  private readonly fetchFn: FetchLike;
  private readonly baseUrl: string;

  constructor(options: ProviderAdapterOptions) {
    this.options = options;
    this.fetchFn = options.fetchImpl ?? fetch;
    this.baseUrl = options.baseUrl ?? "https://api.anthropic.com/v1";
  }

  public buildRequestBody(
    turnContext: AgentTurnContext,
    stream = false
  ): Record<string, unknown> {
    const messages = turnContext.messages
      .filter((m) => m.role !== "system")
      .map((msg) => {
        if (msg.role === "tool") {
          return {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: msg.toolCallId ?? randomUUID(),
                content: msg.content,
              },
            ],
          };
        }

        if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
          const blocks: Array<Record<string, unknown>> = [];
          if (msg.content) {
            blocks.push({ type: "text", text: msg.content });
          }
          for (const tc of msg.toolCalls) {
            blocks.push({
              type: "tool_use",
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
            });
          }
          return { role: "assistant", content: blocks };
        }

        return { role: msg.role, content: msg.content };
      });

    const body: Record<string, unknown> = {
      model: turnContext.model || this.options.defaultModel || "claude-3-7-sonnet-latest",
      max_tokens: turnContext.maxTokens ?? 4096,
      messages,
      stream,
    };

    if (turnContext.systemPrompt) {
      body.system = turnContext.systemPrompt;
    }

    if (turnContext.temperature !== undefined) {
      body.temperature = turnContext.temperature;
    }

    if (turnContext.tools && turnContext.tools.length > 0) {
      body.tools = turnContext.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      }));
    }

    return body;
  }

  private parseResponse(payload: ClaudeResponsePayload): AgentTurnResult {
    const blocks = payload.content ?? [];
    const textParts: string[] = [];
    const toolCalls: ToolCallRequest[] = [];

    for (const block of blocks) {
      if (block.type === "text" && block.text) {
        textParts.push(block.text);
      } else if (block.type === "tool_use" && block.name) {
        toolCalls.push({
          id: block.id ?? randomUUID(),
          name: block.name,
          arguments: block.input ?? {},
        });
      }
    }

    return {
      text: textParts.join(""),
      toolCalls,
      finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
      usage: payload.usage
        ? {
            inputTokens: payload.usage.input_tokens ?? 0,
            outputTokens: payload.usage.output_tokens ?? 0,
          }
        : undefined,
    };
  }

  public async generateText(prompt: string, systemPrompt = ""): Promise<string> {
    const result = await this.executeTurn({
      model: this.options.defaultModel ?? "claude-3-7-sonnet-latest",
      systemPrompt,
      messages: [{ role: "user", content: prompt }],
    });
    return result.text;
  }

  public async executeTurn(turnContext: AgentTurnContext): Promise<AgentTurnResult> {
    const apiKey = resolveVaultKeyOrThrow(
      this.options.vault,
      ["CLAUDE_API_KEY", "ANTHROPIC_API_KEY"],
      "Claude"
    );

    try {
      const response = await this.fetchFn(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(this.buildRequestBody(turnContext, false)),
      });

      const payload = (await response.json()) as ClaudeResponsePayload;
      if (!response.ok) {
        throw new Error(payload.error?.message ?? `Erro HTTP ${response.status} na Claude API`);
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
    const apiKey = resolveVaultKeyOrThrow(
      this.options.vault,
      ["CLAUDE_API_KEY", "ANTHROPIC_API_KEY"],
      "Claude"
    );

    try {
      const response = await this.fetchFn(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(this.buildRequestBody(turnContext, true)),
      });

      if (!response.ok) {
        const textErr = await response.text();
        throw new Error(`Erro HTTP ${response.status} no stream Claude: ${textErr}`);
      }

      if (!response.body) {
        const payload = (await response.json()) as ClaudeResponsePayload;
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
      const toolCalls: ToolCallRequest[] = [];
      const activeToolBuffers = new Map<number, { id: string; name: string; json: string }>();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith("data:")) continue;
          const dataStr = line.slice(5).trim();
          if (!dataStr || dataStr === "[DONE]") continue;

          const evt = JSON.parse(dataStr) as {
            type?: string;
            index?: number;
            content_block?: { type?: string; id?: string; name?: string };
            delta?: {
              type?: string;
              text?: string;
              thinking?: string;
              partial_json?: string;
            };
          };

          if (evt.type === "content_block_start" && evt.content_block?.type === "tool_use") {
            activeToolBuffers.set(evt.index ?? 0, {
              id: evt.content_block.id ?? randomUUID(),
              name: evt.content_block.name ?? "tool",
              json: "",
            });
          } else if (evt.type === "content_block_delta" && evt.delta) {
            if (evt.delta.type === "text_delta" && evt.delta.text) {
              fullText += evt.delta.text;
              onChunk({ type: "text_delta", tokenChunk: evt.delta.text });
            } else if (evt.delta.type === "thinking_delta" && evt.delta.thinking) {
              onChunk({ type: "thought", tokenChunk: evt.delta.thinking });
            } else if (evt.delta.type === "input_json_delta" && evt.delta.partial_json) {
              const buf = activeToolBuffers.get(evt.index ?? 0);
              if (buf) buf.json += evt.delta.partial_json;
            }
          } else if (evt.type === "content_block_stop") {
            const buf = activeToolBuffers.get(evt.index ?? 0);
            if (buf) {
              const args = buf.json ? (JSON.parse(buf.json) as Record<string, unknown>) : {};
              const tc: ToolCallRequest = { id: buf.id, name: buf.name, arguments: args };
              toolCalls.push(tc);
              onChunk({ type: "tool_call", toolCall: tc });
              activeToolBuffers.delete(evt.index ?? 0);
            }
          }
        }
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
