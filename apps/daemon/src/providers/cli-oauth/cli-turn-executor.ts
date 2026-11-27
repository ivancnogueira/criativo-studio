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

export async function executeCliAgentTurn(
  ctx: CliServiceRuntimeContext,
input: CliExecutionInput): Promise<CliExecutionOutput> {
    if (input.signal?.aborted) {
      const abortErr = new Error("Turno interrompido.");
      abortErr.name = "AbortError";
      throw abortErr;
    }

    const accounts = ctx.listAccounts(input.provedor);
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
    const chosenId = input.preferredAccountId ?? pool?.conta_em_uso ?? accounts[0].id;
    const rec =
      ctx.getStoredRecords().find((r) => r.provedor === input.provedor && r.id === chosenId) ??
      ctx.getStoredRecords().find((r) => r.provedor === input.provedor);
    if (!rec) {
      throw new Error("Conta configurada não localizada em disco.");
    }

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
      const env: Record<string, string | undefined> = {
        ...process.env,
        CLAUDE_CONFIG_DIR: absDir,
        DISABLE_AUTOUPDATER: "1",
      };
      const targetModel = input.modelId.toLowerCase().includes("claude")
        ? input.modelId
        : "claude-sonnet-4-6";

      const mcpConfigObj =
        input.mcpConfig !== undefined
          ? input.mcpConfig
          : (ctx.getMcpConfigResolver()?.(input.agentId ?? null) ?? null);
      let tempMcpDir: string | null = null;
      const claudeArgs = [
        "-p",
        "--output-format",
        "json",
        "--no-session-persistence",
        "--tools",
        "",
      ];

      if (mcpConfigObj && Object.keys(mcpConfigObj).length > 0) {
        tempMcpDir = mkdtempSync(join(tmpdir(), "criativo-claude-mcp-"));
        const mcpConfigFile = join(tempMcpDir, "mcp-config.json");
        writeFileSync(mcpConfigFile, JSON.stringify(mcpConfigObj, null, 2), "utf8");
        claudeArgs.push(
          "--mcp-config",
          mcpConfigFile,
          "--allowedTools",
          "mcp__criativo_studio__*"
        );
      }

      claudeArgs.push("--model", targetModel);

      let res: { code: number | null; stdout: string; stderr: string };
      try {
        res = await spawnCommandWithStdin({
          executable,
          args: claudeArgs,
          env,
          cwd: ctx.workspaceCwd,
          stdinText: fullPrompt,
          timeoutMs: input.timeoutMs ?? EXEC_TIMEOUT_MS,
          stallMode: true,
          signal: input.signal,
          agentId: input.agentId,
        });
      } finally {
        if (tempMcpDir) {
          try {
            rmSync(tempMcpDir, { recursive: true, force: true });
          } catch {
            // ignora falha de limpeza temporária
          }
        }
      }

      if (res.code !== 0) {
        throw new Error(res.stderr.trim() || res.stdout.trim() || "Claude CLI retornou erro.");
      }

      const parsed = JSON.parse(res.stdout.trim()) as {
        result?: string;
        is_error?: boolean;
        usage?: {
          input_tokens?: number;
          cache_read_input_tokens?: number;
          output_tokens?: number;
        };
      };

      if (parsed.is_error || !parsed.result?.trim()) {
        throw new Error(parsed.result || "Claude retornou resposta vazia ou erro de sessão.");
      }

      return {
        text: parsed.result.trim(),
        modelUsed: targetModel,
        accountId: rec.id,
        accountEmail: rec.email,
        usage: {
          uncachedInput: Number(parsed.usage?.input_tokens ?? Math.round(fullPrompt.length / 4)),
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
    const codexMcpArgs: string[] = [];
    const rawMcpServers =
      mcpConfigObj &&
      typeof mcpConfigObj === "object" &&
      mcpConfigObj.mcpServers &&
      typeof mcpConfigObj.mcpServers === "object"
        ? (mcpConfigObj.mcpServers as Record<string, Record<string, unknown>>)
        : null;

    if (rawMcpServers) {
      for (const [srvName, srvSpec] of Object.entries(rawMcpServers)) {
        const safeKey = srvName.replace(/[^a-zA-Z0-9_]/g, "_");
        if (!safeKey || !srvSpec || typeof srvSpec !== "object") continue;
        if (typeof srvSpec.url === "string" && srvSpec.url.trim()) {
          codexMcpArgs.push("-c", `mcp_servers.${safeKey}.url=${JSON.stringify(srvSpec.url.trim())}`);
          if (srvSpec.headers && typeof srvSpec.headers === "object" && !Array.isArray(srvSpec.headers)) {
            const entries = Object.entries(srvSpec.headers as Record<string, unknown>).filter(
              ([k, v]) => k.trim().length > 0 && typeof v === "string",
            );
            if (entries.length > 0) {
              const headerToml = entries
                .map(([k, v]) => `${JSON.stringify(k)} = ${JSON.stringify(String(v))}`)
                .join(", ");
              codexMcpArgs.push("-c", `mcp_servers.${safeKey}.http_headers={ ${headerToml} }`);
            }
          }
        } else if (typeof srvSpec.command === "string" && srvSpec.command.trim()) {
          codexMcpArgs.push(
            "-c",
            `mcp_servers.${safeKey}.command=${JSON.stringify(srvSpec.command.trim())}`,
          );
          if (Array.isArray(srvSpec.args)) {
            codexMcpArgs.push(
              "-c",
              `mcp_servers.${safeKey}.args=${JSON.stringify(srvSpec.args.map(String))}`,
            );
          }
        }
      }
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
          ...codexMcpArgs,
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
  }
