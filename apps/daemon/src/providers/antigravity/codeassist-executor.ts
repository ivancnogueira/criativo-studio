import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import {
  AntigravityAcpService,
  formatLabeledImageInstruction,
  type AcpDiscoveredModel,
  type LabeledImageInput,
} from "../antigravity-acp-service.ts";
import { CODE_ASSIST_URL, DAILY_CODE_ASSIST_URL, GENERATE_TIMEOUT_MS, type AntigravityGenerateRuntimeContext, type CodeAssistGenerateInput, type CodeAssistGenerateOutput, type DiscoveredTokenEntry } from "./live-types.ts";
import { getAntigravityUserAgent, inferImageMimeFromPath } from "./quota-helpers.ts";
import { callCodeAssistEndpoint, safeReadJson } from "./model-filter-helpers.ts";

export async function executeAntigravityCodeAssistGenerate(
  ctx: AntigravityGenerateRuntimeContext,
  input: CodeAssistGenerateInput
): Promise<CodeAssistGenerateOutput> {
    const snapshot = await ctx.getLiveSnapshot(false);
    const { entries } = ctx.discoverStudioTokenEntries();

    if (entries.length === 0) {
      throw new Error("Nenhuma conta Google conectada no Studio.");
    }

    const poolExcluded = new Set(snapshot.pool?.contas_excluidas ?? []);
    const candidateAccountIds = [
      input.preferredAccountId,
      snapshot.pool?.conta_em_uso,
      ...snapshot.contas.filter((c) => !poolExcluded.has(c.id)).map((c) => c.id),
      ...snapshot.contas.map((c) => c.id),
    ].filter((v): v is string => Boolean(v));

    const uniqueAccountIds = [...new Set(candidateAccountIds)];
    const chosenEntry =
      uniqueAccountIds
        .map((id) => entries.find((e) => e.id === id))
        .find((e): e is DiscoveredTokenEntry => Boolean(e)) ?? entries[0];

    const cliAvailable = Boolean(ctx.acpService.getCliExecutable());

    // 1. Chamadas de TEXTO/CHAT preferem o protocolo ACP aquecido (renova token sozinho e injeta MCPs autorizados ao agente)
    //    com retry automático e fallback transparente para Code Assist REST se a sessão ACP oscilar.
    let acpLastError: unknown = null;
    if (!input.generateImage && cliAvailable && (chosenEntry.hasRefreshToken || !chosenEntry.tokenValid)) {
      const promptParts: string[] = [];
      if (input.systemPrompt) {
        promptParts.push(input.systemPrompt);
      }
      if (input.messages.length > 1) {
        promptParts.push(
          `[Contexto recente da conversa]\n${input.messages
            .slice(-7, -1)
            .map((m) => `${m.role === "user" ? "Usuário" : "Assistente"}: ${m.text}`)
            .join("\n")}`
        );
      }
      promptParts.push(input.messages[input.messages.length - 1]?.text ?? "");

      const sandboxCwd = resolve(ctx.workspaceCwd, "dados", "agent-sandbox");
      mkdirSync(sandboxCwd, { recursive: true });
      const combinedPrompt = promptParts.join("\n\n");

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const acpOut = await ctx.acpService.executePrompt(chosenEntry.id, {
            geminiDir: chosenEntry.geminiDir,
            cwd: sandboxCwd,
            promptText: combinedPrompt,
            modelId: input.model,
            effort: input.effort,
            imagePaths: input.imagePaths,
            labeledImages: input.labeledImages,
            agentId: input.agentId,
            mcpServers: input.mcpServers,
            onDelta: attempt === 0 ? input.onDelta : undefined,
          });

          if (acpOut.text && acpOut.text.trim().length > 0) {
            ctx.clearSnapshotCache();
            return {
              text: acpOut.text,
              images: [],
              modelUsed: acpOut.modelUsed,
              accountId: chosenEntry.id,
              accountEmail: chosenEntry.email,
              usage: acpOut.usage,
            };
          }
          acpLastError = new Error("Sessão ACP retornou resposta vazia.");
        } catch (err) {
          acpLastError = err;
          const errMsg = err instanceof Error ? err.message : String(err);
          // Não repete em caso de timeout/aborto para evitar espera duplicada
          if (/timeout|timed out|abort|cancel/i.test(errMsg)) {
            break;
          }
        }
        ctx.acpService.disposeAccount(chosenEntry.id);
      }
    }

    const isInternalAcpModel = /orchestrator|argon|neon|g1-/i.test(input.model);
    const acpErrorMessage =
      acpLastError instanceof Error
        ? acpLastError.message
        : acpLastError
          ? String(acpLastError)
          : "";
    if (!input.generateImage && cliAvailable && isInternalAcpModel) {
      throw new Error(
        acpErrorMessage
          ? `Falha no runtime Antigravity ACP para o modelo ${input.model}: ${acpErrorMessage}`
          : `O modelo ${input.model} requer sessão Antigravity ACP ativa e não pôde ser executado sem rebaixamento.`
      );
    }

    // 2. Geração de IMAGEM ou ambientes HTTP puros (e.g. testes unitários sem CLI) via Code Assist REST
    let accessToken = chosenEntry.accessToken;
    if ((!chosenEntry.tokenValid || !accessToken) && cliAvailable && chosenEntry.hasRefreshToken) {
      const refreshed = await ctx.acpService.refreshAccountToken(chosenEntry.id, chosenEntry.geminiDir);
      accessToken = refreshed?.accessToken ?? null;
    }
    if (!accessToken) {
      throw new Error("Token OAuth da conta Google expirou e precisa ser reautenticado em Conexões.");
    }

    const codeAssistInfo = await callCodeAssistEndpoint<{ cloudaicompanionProject?: string }>(ctx.fetchImpl, 
      CODE_ASSIST_URL,
      "loadCodeAssist",
      accessToken,
      {}
    );
    const project = codeAssistInfo.cloudaicompanionProject;
    if (!project) {
      throw new Error("Projeto Code Assist indisponível para a conta Google conectada.");
    }

    const contents = input.messages.map((msg, idx) => {
      const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
        { text: msg.text },
      ];
      const restImages: Array<{ item: LabeledImageInput; labeled: boolean }> =
        input.labeledImages && input.labeledImages.length > 0
          ? input.labeledImages.map((item) => ({ item, labeled: true }))
          : (input.imagePaths ?? []).map((p) => ({
              item: { path: p, role: "anexo_usuario", label: p },
              labeled: false,
            }));
      if (idx === input.messages.length - 1 && restImages.length > 0) {
        for (const { item, labeled } of restImages) {
          try {
            if (existsSync(item.path)) {
              if (labeled) {
                parts.push({ text: formatLabeledImageInstruction(item) });
              }
              parts.push({
                inlineData: {
                  mimeType: inferImageMimeFromPath(item.path),
                  data: readFileSync(item.path).toString("base64"),
                },
              });
            }
          } catch {
            // ignora arquivo ilegível
          }
        }
      }
      return {
        role: msg.role === "assistant" ? "model" : "user",
        parts,
      };
    });

    const normalizeRestCandidates = (requested: string, defModel: string | null): string[] => {
      const isInternalAcp = /orchestrator|argon|neon|g1-/i.test(requested);
      const list = isInternalAcp
        ? ["gemini-2.5-pro", "gemini-2.5-flash", defModel || "gemini-3.8-flash-high"]
        : [requested, defModel || "gemini-3.8-flash-high", "gemini-2.5-pro", "gemini-2.5-flash"];
      return [...new Set(list.filter(Boolean))];
    };

    const candidateModels = input.generateImage
      ? [
          ...(snapshot.imageGenerationModelIds.length > 0
            ? snapshot.imageGenerationModelIds
            : ["gemini-3.1-flash-image"]),
        ]
      : normalizeRestCandidates(input.model, snapshot.defaultModelId);

    let lastError: unknown = acpLastError;
    for (const modelToTry of candidateModels) {
      try {
        const requestBody: Record<string, unknown> = {
          model: modelToTry,
          project,
          request: {
            ...(input.systemPrompt
              ? { systemInstruction: { parts: [{ text: input.systemPrompt }] } }
              : {}),
            contents,
            ...(input.generateImage
              ? { generationConfig: { responseModalities: ["TEXT", "IMAGE"] } }
              : {}),
          },
        };

        const result = await callCodeAssistEndpoint<{
          response?: {
            candidates?: Array<{
              content?: {
                parts?: Array<{
                  text?: string;
                  thought?: boolean;
                  inlineData?: { mimeType?: string; data?: string };
                }>;
              };
            }>;
            usageMetadata?: {
              promptTokenCount?: number;
              cachedContentTokenCount?: number;
              candidatesTokenCount?: number;
              thoughtsTokenCount?: number;
              totalTokenCount?: number;
            };
          };
        }>(ctx.fetchImpl, DAILY_CODE_ASSIST_URL, "generateContent", accessToken, requestBody, GENERATE_TIMEOUT_MS);

        const parts = result.response?.candidates?.[0]?.content?.parts ?? [];
        const textParts = parts.filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text!);
        const images = parts
          .filter((p) => p.inlineData?.data && p.inlineData?.mimeType)
          .map((p) => ({
            mimeType: p.inlineData!.mimeType!,
            dataBase64: p.inlineData!.data!,
          }));

        const um = result.response?.usageMetadata;
        const promptTokens = Number(um?.promptTokenCount ?? 0);
        const cachedInput = Number(um?.cachedContentTokenCount ?? 0);
        const uncachedInput = Math.max(0, promptTokens - cachedInput);
        const output = Number(um?.candidatesTokenCount ?? 0) + Number(um?.thoughtsTokenCount ?? 0);

        const fallbackReason = !input.generateImage
          ? acpErrorMessage
            ? `Fallback REST após falha ACP: ${acpErrorMessage.slice(0, 160)}`
            : modelToTry !== input.model
              ? `Modelo solicitado (${input.model}) redirecionado para ${modelToTry} via Code Assist REST.`
              : undefined
          : undefined;

        return {
          text: textParts.join("\n").trim(),
          images,
          modelUsed: modelToTry,
          accountId: chosenEntry.id,
          accountEmail: chosenEntry.email,
          ...(fallbackReason ? { fallbackReason } : {}),
          usage: {
            uncachedInput,
            cachedInput,
            output,
          },
        };
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Falha ao executar Code Assist.");
}
