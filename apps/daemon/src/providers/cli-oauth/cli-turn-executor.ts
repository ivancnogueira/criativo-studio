import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { EXEC_TIMEOUT_MS, resolveCliBinaryForProvider, spawnCommandWithStdin, type CliExecutionInput, type CliExecutionOutput, type CliServiceRuntimeContext } from "./cli-types-and-helpers.ts";
import { forceUpgradeProviderRuntime } from "../provider-runtime-resolver.ts";
import { extractCleanCodexError, isCodexSchemaMismatchError } from "./codex-models-http.ts";
import { accountTurnCoordinator, selectPoolAccount } from "../provider-account-pool.ts";
import {
  buildCodexConfigOverrideArgs,
  computeCodexSessionFingerprint,
} from "./codex-prompt-settings.ts";
import {
  CodexAppServerUnsupportedError,
  codexAppServerPool,
} from "./codex-app-server-client.ts";
import {
  buildClaudeCliArgs,
  buildClaudeEnv,
  claudeSessionCache,
  computeClaudeFingerprint,
} from "./claude-session-settings.ts";

export async function executeCliAgentTurn(
  ctx: CliServiceRuntimeContext,
input: CliExecutionInput): Promise<CliExecutionOutput> {
    if (input.signal?.aborted) {
      const abortErr = new Error("Turno interrompido.");
      abortErr.name = "AbortError";
      throw abortErr;
    }

    const accountsWithQuotas = await ctx
      .listAccountsWithQuotas(input.provedor, false)
      .catch(() => ctx.listAccounts(input.provedor));
    const accounts = accountsWithQuotas.length > 0 ? accountsWithQuotas : ctx.listAccounts(input.provedor);
    if (accounts.length === 0) {
      throw new Error(
        input.provedor === "claude"
          ? "Nenhuma conta Claude conectada no Studio."
          : "Nenhuma conta ChatGPT/Codex conectada no Studio."
      );
    }

    const { executable } = resolveCliBinaryForProvider(input.provedor, ctx.appDataDir);
    if (!executable) {
      throw new Error(`Executável CLI de ${input.provedor} não encontrado na máquina.`);
    }

    const pool = ctx.getPoolConfig(input.provedor);
    const chosenAccount = selectPoolAccount(accounts, pool, input.preferredAccountId, {
      activeTurnsByAccount: accountTurnCoordinator.getActiveTurnsMap(input.provedor),
      drainingAccountIds: accountTurnCoordinator.getDrainingAccountIds(input.provedor),
    });
    const drainingIds = accountTurnCoordinator.getDrainingAccountIds(input.provedor);
    const nonDrainingAccount = accounts.find((a) => !drainingIds.has(a.id));
    const chosenId = chosenAccount?.id ?? input.preferredAccountId ?? nonDrainingAccount?.id ?? accounts[0].id;
    const rec =
      ctx.getStoredRecords().find((r) => r.provedor === input.provedor && r.id === chosenId) ??
      ctx.getStoredRecords().find((r) => r.provedor === input.provedor && !drainingIds.has(r.id)) ??
      ctx.getStoredRecords().find((r) => r.provedor === input.provedor);
    if (!rec) {
      throw new Error("Conta configurada não localizada em disco.");
    }

    const releaseTurn = accountTurnCoordinator.beginTurn(input.provedor, rec.id);
    try {

    const promptParts: string[] = [];
    if (input.systemPrompt) promptParts.push(input.systemPrompt);
    if (input.messages.length > 1) {
      promptParts.push(
        `[Contexto recente da conversa]\n${input.messages
          .slice(-7, -1)
          .map((m) => `${m.role === "user" ? "Usuário" : "Assistente"}: ${m.text}`)
          .join("\n")}`
      );
    }
    promptParts.push(input.messages[input.messages.length - 1]?.text ?? "");
    const fullPrompt = promptParts.join("\n\n");

    const absDir = resolve(rec.configDir);

    if (input.provedor === "claude") {
      const env = buildClaudeEnv(absDir);
      const targetModel = input.modelId.toLowerCase().includes("claude")
        ? input.modelId
        : "claude-sonnet-4-6";

      const isLightTurn = input.turnMode === "light";
      const rawMcpConfig =
        input.mcpConfig !== undefined
          ? input.mcpConfig
          : (ctx.getMcpConfigResolver()?.(input.agentId ?? null) ?? null);
      const effectiveMcpConfig = isLightTurn ? null : rawMcpConfig;
      const claudeFingerprint = computeClaudeFingerprint({
        modelId: targetModel,
        systemPrompt: input.systemPrompt,
        mcpConfig: effectiveMcpConfig,
        turnMode: input.turnMode,
      });
      const sessionKey = claudeSessionCache.buildKey(rec.id, input.agentId, input.threadId);
      const lastUserMessage = input.messages[input.messages.length - 1]?.text ?? "";
      const coldClaudeUserPrompt =
        input.messages.length > 1
          ? `[Contexto recente da conversa]\n${input.messages
              .slice(-7, -1)
              .map((m) => `${m.role === "user" ? "Usuário" : "Assistente"}: ${m.text}`)
              .join("\n")}\n\n${lastUserMessage}`
          : lastUserMessage;

      const runClaudeAttempt = async (resumeSessionId: string | null) => {
        const candidateSessionId = resumeSessionId ?? randomUUID();
        let tempMcpDir: string | null = null;
        let mcpConfigFile: string | null = null;

        if (!isLightTurn && effectiveMcpConfig && Object.keys(effectiveMcpConfig).length > 0) {
          tempMcpDir = mkdtempSync(join(tmpdir(), "criativo-claude-mcp-"));
          mcpConfigFile = join(tempMcpDir, "mcp-config.json");
          writeFileSync(mcpConfigFile, JSON.stringify(effectiveMcpConfig, null, 2), "utf8");
        }

        const claudeArgs = buildClaudeCliArgs({
          targetModel,
          mcpConfigFile,
          resumeSessionId,
          newSessionId: resumeSessionId ? null : candidateSessionId,
          systemPrompt: resumeSessionId ? undefined : input.systemPrompt,
          turnMode: input.turnMode,
        });

        try {
          const res = await spawnCommandWithStdin({
            executable,
            args: claudeArgs,
            env,
            cwd: ctx.workspaceCwd,
            stdinText: resumeSessionId ? lastUserMessage : coldClaudeUserPrompt,
            timeoutMs: input.timeoutMs ?? EXEC_TIMEOUT_MS,
            stallMode: true,
            signal: input.signal,
            agentId: input.agentId,
          });
          return { res, usedSessionId: candidateSessionId };
        } finally {
          if (tempMcpDir) {
            try {
              rmSync(tempMcpDir, { recursive: true, force: true });
            } catch {
              // ignora falha de limpeza temporária
            }
          }
        }
      };

      const cachedSession = claudeSessionCache.getValid(sessionKey, claudeFingerprint);
      let attempt = await runClaudeAttempt(cachedSession?.sessionId ?? null);

      if (cachedSession && attempt.res.code !== 0) {
        claudeSessionCache.delete(sessionKey);
        attempt = await runClaudeAttempt(null);
      }

      if (attempt.res.code !== 0) {
        throw new Error(attempt.res.stderr.trim() || attempt.res.stdout.trim() || "Claude CLI retornou erro.");
      }

      const parsed = JSON.parse(attempt.res.stdout.trim()) as {
        result?: string;
        is_error?: boolean;
        session_id?: string;
        usage?: {
          input_tokens?: number;
          cache_read_input_tokens?: number;
          output_tokens?: number;
        };
      };

      if (parsed.is_error || !parsed.result?.trim()) {
        throw new Error(parsed.result || "Claude retornou resposta vazia ou erro de sessão.");
      }

      claudeSessionCache.set(sessionKey, {
        sessionId: parsed.session_id || attempt.usedSessionId,
        fingerprint: claudeFingerprint,
        updatedAtMs: Date.now(),
      });

      return {
        text: parsed.result.trim(),
        modelUsed: targetModel,
        accountId: rec.id,
        accountEmail: rec.email,
        usage: {
          uncachedInput: Number(
            parsed.usage?.input_tokens ??
              Math.round((cachedSession ? lastUserMessage : coldClaudeUserPrompt).length / 4)
          ),
          cachedInput: Number(parsed.usage?.cache_read_input_tokens ?? 0),
          output: Number(parsed.usage?.output_tokens ?? Math.round(parsed.result.length / 4)),
        },
      };
    }

    // OpenAI / Codex CLI (`codex exec --json --skip-git-repo-check --sandbox read-only -`)
    const env: Record<string, string | undefined> = {
      ...process.env,
      CODEX_HOME: absDir,
    };
    const targetModel =
      input.modelId.toLowerCase().includes("gpt") || input.modelId.toLowerCase().startsWith("o")
        ? input.modelId
        : "gpt-5.4";

    const mcpConfigObj =
      input.mcpConfig !== undefined
        ? input.mcpConfig
        : (ctx.getMcpConfigResolver()?.(input.agentId ?? null) ?? null);
    // buildCodexConfigOverrideArgs serializa -c features.* e -c mcp_servers.<chave> apenas no modo action
    const codexOverrideArgs = buildCodexConfigOverrideArgs({
      mcpConfig: mcpConfigObj,
      turnMode: input.turnMode,
    });
    const configFingerprint = computeCodexSessionFingerprint({
      modelId: targetModel,
      systemPrompt: input.systemPrompt,
      mcpConfig: mcpConfigObj,
      turnMode: input.turnMode,
    });
    const lastUserMessage = input.messages[input.messages.length - 1]?.text ?? "";
    const coldCodexPromptParts: string[] = [];
    if (input.messages.length > 1) {
      coldCodexPromptParts.push(
        `[Contexto recente da conversa]\n${input.messages
          .slice(-7, -1)
          .map((m) => `${m.role === "user" ? "Usuário" : "Assistente"}: ${m.text}`)
          .join("\n")}`
      );
    }
    coldCodexPromptParts.push(lastUserMessage);
    const coldCodexPrompt = coldCodexPromptParts.join("\n\n");

    let appServerFallback = false;
    try {
      const appServerRes = await codexAppServerPool.executeTurn({
        executable,
        cwd: ctx.workspaceCwd,
        codexHome: absDir,
        accountId: rec.id,
        modelId: targetModel,
        agenteId: input.agentId,
        threadId: input.threadId,
        systemPrompt: input.systemPrompt,
        coldPrompt: coldCodexPrompt,
        incrementalPrompt: lastUserMessage,
        overrideArgs: codexOverrideArgs,
        configFingerprint,
        timeoutMs: input.timeoutMs ?? EXEC_TIMEOUT_MS,
        signal: input.signal,
        onDelta: input.onDelta,
        onToolStep: input.onToolStep,
      });

      const finalAppText = appServerRes.text.trim();
      if (finalAppText) {
        return {
          text: finalAppText,
          modelUsed: targetModel,
          accountId: rec.id,
          accountEmail: rec.email,
          usage: {
            uncachedInput: appServerRes.usage.uncachedInput,
            cachedInput: appServerRes.usage.cachedInput,
            output: appServerRes.usage.output || Math.round(finalAppText.length / 4),
          },
        };
      }
      appServerFallback = true;
    } catch (appErr) {
      if (appErr instanceof CodexAppServerUnsupportedError) {
        appServerFallback = true;
      } else {
        throw appErr;
      }
    }

    if (appServerFallback) {
      // fallback transparente para `codex exec` quando o binário local não suportar `app-server`
    }

    const runCodexExec = (execPath: string) =>
      spawnCommandWithStdin({
        executable: execPath,
        args: [
          "exec",
          "--json",
          "--skip-git-repo-check",
          "--sandbox",
          "read-only",
          ...codexOverrideArgs,
          "--model",
          targetModel,
          "-",
        ],
        env,
        cwd: ctx.workspaceCwd,
        stdinText: fullPrompt,
        timeoutMs: input.timeoutMs ?? EXEC_TIMEOUT_MS,
        stallMode: true,
        signal: input.signal,
        agentId: input.agentId,
      });

    let res = await runCodexExec(executable);
    if (res.code !== 0 && isCodexSchemaMismatchError(res.stderr)) {
      const cacheFile = join(absDir, "models_cache.json");
      if (existsSync(cacheFile)) {
        try {
          rmSync(cacheFile, { force: true });
        } catch {
          // ignora
        }
      }
      const upgraded = await forceUpgradeProviderRuntime("codex", {
        appDataDir: ctx.appDataDir,
        codexHomeToResetCache: absDir,
      }).catch(() => null);
      if (upgraded?.executable) {
        ctx.invalidateModelCache("openai");
        res = await runCodexExec(upgraded.executable);
      }
    }

    if (res.code !== 0) {
      throw new Error(extractCleanCodexError(res.stderr, res.stdout));
    }

    const answerChunks: string[] = [];
    let uncachedInput = Math.round(fullPrompt.length / 4);
    let cachedInput = 0;
    let output = 0;

    for (const line of res.stdout.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) continue;
      try {
        const evt = JSON.parse(trimmed) as {
          type?: string;
          item?: { type?: string; text?: string; content?: Array<{ text?: string }> };
          usage?: { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number };
        };
        if (evt.type === "item.completed" && evt.item?.type === "agent_message") {
          if (typeof evt.item.text === "string" && evt.item.text) {
            answerChunks.push(evt.item.text);
          } else if (Array.isArray(evt.item.content)) {
            for (const c of evt.item.content) {
              if (c.text) answerChunks.push(c.text);
            }
          }
        }
        if (evt.type === "turn.completed" && evt.usage) {
          const totalIn = Number(evt.usage.input_tokens ?? 0);
          cachedInput = Number(evt.usage.cached_input_tokens ?? 0);
          uncachedInput = Math.max(0, totalIn - cachedInput);
          output = Number(evt.usage.output_tokens ?? 0);
        }
      } catch {
        // ignora linha não JSON
      }
    }

    const finalText = answerChunks.join("\n").trim();
    if (!finalText) {
      throw new Error("Codex CLI concluiu a execução sem retornar conteúdo de texto.");
    }

    return {
      text: finalText,
      modelUsed: targetModel,
      accountId: rec.id,
      accountEmail: rec.email,
      usage: {
        uncachedInput,
        cachedInput,
        output: output || Math.round(finalText.length / 4),
      },
    };
    } finally {
      releaseTurn?.();
    }
  }
