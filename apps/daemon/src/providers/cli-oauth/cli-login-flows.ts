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
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import type {
  ContaProvedorInfo,
  GrupoCotaConta,
  ModeloProvedorInfo,
  NivelEsforco,
  PoolContasConfig,
  ProviderName,
} from "@criativo/contracts";
import {
  ensureProviderRuntimeInstalled,
  resolveManagedProviderRuntime,
  spawnProviderProcess,
} from "../provider-runtime-resolver.ts";
import { LOGIN_TIMEOUT_MS, createBrowserCaptureShim, decodeJwtPayload, openExternalUrlIfNeeded, resolveCliBinaryForProvider, spawnCommandWithStdin, type CliAccountRecord, type CliServiceRuntimeContext } from "./cli-types-and-helpers.ts";

export async function connectCliAccountViaBrowser(
  ctx: CliServiceRuntimeContext,

    provedor: "claude" | "openai",
    label?: string,
    onAuthUrl?: (url: string) => void
  ): Promise<ContaProvedorInfo> {
    ctx.cancelPendingSignIn(provedor);
    let executable = resolveCliBinaryForProvider(provedor, ctx.appDataDir).executable;
    if (!executable) {
      const installed = await ensureProviderRuntimeInstalled(
        provedor === "claude" ? "claude" : "codex",
        { appDataDir: ctx.appDataDir }
      );
      executable = installed.executable;
      if (!executable) {
        const extraReason = installed.error ? ` (${installed.error})` : "";
        throw new Error(
          provedor === "claude"
            ? `Runtime Claude Code (claude) não encontrado e não pôde ser instalado automaticamente${extraReason}.`
            : `Runtime Codex CLI (codex) não encontrado e não pôde ser instalado automaticamente${extraReason}.`
        );
      }
    }
    const resolvedExecutable = executable;

    const prefix = provedor === "claude" ? "cl" : "oa";
    const id = `${prefix}-${randomUUID().slice(0, 8)}`;
    const configDir = resolve(ctx.accountsRootDir, provedor, id);
    mkdirSync(configDir, { recursive: true });

    try {
      let email: string | null = null;
      let plano: string | null = null;

      if (provedor === "claude") {
        // `stdio: "ignore"` força o CLI a usar callback HTTP localhost
        // (em vez de fallback manual "Paste code here") e envia a URL real apenas para `BROWSER=browser.cmd`.
        let openedFallbackBrowser = false;
        const launchBrowserOnce = (url: string) => {
          if (openedFallbackBrowser) return;
          openedFallbackBrowser = true;
          ctx.registerLoopbackTargetFromAuthUrl("claude", url);
          onAuthUrl?.(url);
          openExternalUrlIfNeeded(url);
        };
        const shim = createBrowserCaptureShim(launchBrowserOnce);
        const env: Record<string, string | undefined> = {
          ...process.env,
          CLAUDE_CONFIG_DIR: configDir,
          DISABLE_AUTOUPDATER: "1",
          BROWSER: shim.commandPath,
        };
        try {
          await new Promise<void>((resolvePromise, rejectPromise) => {
            const child = spawnProviderProcess(
              resolvedExecutable,
              ["auth", "login", "--claudeai"],
              {
                cwd: ctx.workspaceCwd,
                env,
                stdio: "ignore",
                windowsHide: process.platform === "win32",
              }
            );
            let finished = false;
            const timer = setTimeout(() => {
              if (finished) return;
              finished = true;
              try {
                child.kill();
              } catch {
                // ignora
              }
              rejectPromise(new Error("Tempo limite aguardando conclusão do login Claude no navegador."));
            }, LOGIN_TIMEOUT_MS);
            timer.unref?.();

            ctx.pendingSignInAbort.set("claude", () => {
              if (finished) return;
              finished = true;
              clearTimeout(timer);
              try {
                child.kill();
              } catch {
                // ignora
              }
              rejectPromise(new Error("Autenticação Claude cancelada pelo usuário."));
            });

            child.on("error", (err) => {
              if (finished) return;
              finished = true;
              clearTimeout(timer);
              rejectPromise(err instanceof Error ? err : new Error(String(err)));
            });

            child.on("close", (code) => {
              if (finished) return;
              finished = true;
              clearTimeout(timer);
              if (code === 0) resolvePromise();
              else rejectPromise(new Error("Login Claude no navegador não foi concluído."));
            });
          });
        } finally {
          ctx.pendingSignInAbort.delete("claude");
          ctx.pendingLoopbackTarget.delete("claude");
          shim.cleanup();
        }

        // Lê status autenticado do CLAUDE_CONFIG_DIR
        try {
          const statusRes = await spawnCommandWithStdin({
            executable,
            args: ["auth", "status", "--json"],
            env: {
              ...process.env,
              CLAUDE_CONFIG_DIR: configDir,
              DISABLE_AUTOUPDATER: "1",
            },
            cwd: ctx.workspaceCwd,
            timeoutMs: 15_000,
          });
          const statusJson = JSON.parse(statusRes.stdout.trim() || "{}") as {
            loggedIn?: boolean;
            email?: string;
            subscriptionType?: string;
          };
          if (statusJson.email) email = statusJson.email;
          if (statusJson.subscriptionType) plano = `Claude ${statusJson.subscriptionType}`;
        } catch {
          // tenta leitura direta do .claude.json abaixo em listAccounts
        }
      } else {
        // Fluxo oficial de autenticação via `codex app-server` + `account/login/start`
        const appResult = await signInCliCodexViaAppServer(ctx, {
          executable: resolvedExecutable,
          codexHome: configDir,
          onAuthUrl: (url) => {
            ctx.registerLoopbackTargetFromAuthUrl("openai", url);
            onAuthUrl?.(url);
            openExternalUrlIfNeeded(url);
          },
          onRegisterAbort: (abortFn) => {
            ctx.pendingSignInAbort.set("openai", abortFn);
          },
        }).finally(() => {
          ctx.pendingSignInAbort.delete("openai");
          ctx.pendingLoopbackTarget.delete("openai");
        });
        email = appResult.email;
        plano = appResult.plano;

        const authPath = join(configDir, "auth.json");
        if (existsSync(authPath)) {
          const auth = JSON.parse(readFileSync(authPath, "utf8")) as {
            tokens?: { id_token?: string };
          };
          const jwt = auth.tokens?.id_token ? decodeJwtPayload(auth.tokens.id_token) : null;
          if (jwt && typeof jwt.email === "string") email = email ?? jwt.email;
          const authMeta = jwt?.["https://api.openai.com/auth"] as { chatgpt_plan_type?: string } | undefined;
          if (authMeta?.chatgpt_plan_type) plano = plano ?? `ChatGPT ${authMeta.chatgpt_plan_type}`;
        }
      }

      const records = ctx.getStoredRecords();
      const cleaned = records.filter((r) => {
        if (r.provedor !== provedor) return true;
        if (email && r.email && r.email.toLowerCase() === email.toLowerCase()) {
          try {
            rmSync(resolve(r.configDir), { recursive: true, force: true });
          } catch {
            // ignora remoção da pasta antiga duplicada
          }
          return false;
        }
        return true;
      });

      cleaned.push({
        id,
        provedor,
        configDir,
        label: label?.trim() || null,
        email,
        plano,
      });
      ctx.saveStoredRecords(cleaned);
      ctx.invalidateModelCache(provedor);
      ctx.invalidateQuotaCache(provedor);

      const list = ctx.listAccounts(provedor);
      return (
        list.find((a) => a.id === id) ?? {
          id,
          provedor,
          rotulo: label?.trim() || null,
          email,
          plano: plano ?? (provedor === "claude" ? "Claude.ai" : "ChatGPT"),
          estado: "conectado",
          padrao: list.length <= 1,
          token_valido: true,
          grupos_cota: [],
          origem: "criativo",
        }
      );
    } catch (err) {
      try {
        rmSync(configDir, { recursive: true, force: true });
      } catch {
        // ignora falha na limpeza
      }
      throw err;
    }
  }

  /**
   * Executa login oficial ChatGPT/Codex usando `codex app-server` JSON-RPC (`account/login/start`),
   * obtendo imediatamente a `authUrl` e aguardando `account/login/completed`.
   */
export async function signInCliCodexViaAppServer(
  ctx: CliServiceRuntimeContext,
input: {
    executable: string;
    codexHome: string;
    onAuthUrl: (url: string) => void;
    timeoutMs?: number;
    onRegisterAbort?: (abortFn: () => void) => void;
  }): Promise<{ email: string | null; plano: string | null }> {
    const timeoutMs = input.timeoutMs ?? LOGIN_TIMEOUT_MS;
    const child = spawnProviderProcess(input.executable, ["app-server"], {
      cwd: ctx.workspaceCwd,
      env: {
        ...process.env,
        CODEX_HOME: input.codexHome,
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdin.on("error", () => {});

    return new Promise<{ email: string | null; plano: string | null }>((resolvePromise, rejectPromise) => {
      let nextId = 1;
      let activeLoginId: string | null = null;
      let loginStartSent = false;
      let settled = false;
      let stderrTail = "";
      const pending = new Map<number, (msg: Record<string, unknown>) => void>();
      const rl = createInterface({ input: child.stdout });

      child.stderr.on("data", (chunk) => {
        stderrTail = (stderrTail + chunk.toString("utf8")).slice(-800);
      });

      const finish = (err: Error | null, res?: { email: string | null; plano: string | null }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err && activeLoginId) {
          try {
            child.stdin.write(
              `${JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "account/login/cancel", params: { loginId: activeLoginId } })}\n`
            );
          } catch {
            // ignora erro ao enviar cancelamento no fechamento
          }
        }
        rl.close();
        try {
          child.stdin.end();
          child.kill();
        } catch {
          // ignora
        }
        if (err) rejectPromise(err);
        else resolvePromise(res ?? { email: null, plano: null });
      };

      const sendJsonRpc = (payload: Record<string, unknown>) => {
        if (settled) return;
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...payload })}\n`);
      };

      const requestRpc = (method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> =>
        new Promise((resReq, rejReq) => {
          const id = nextId++;
          pending.set(id, (msg) => {
            if (msg.error && typeof msg.error === "object") {
              const e = msg.error as { message?: string };
              rejReq(new Error(e.message || `Falha em '${method}' do Codex app-server.`));
            } else {
              resReq((msg.result as Record<string, unknown>) ?? {});
            }
          });
          try {
            sendJsonRpc({ id, method, params });
          } catch (err) {
            pending.delete(id);
            rejReq(err instanceof Error ? err : new Error(String(err)));
          }
        });

      const timer = setTimeout(() => {
        if (activeLoginId) {
          try {
            sendJsonRpc({ id: nextId++, method: "account/login/cancel", params: { loginId: activeLoginId } });
          } catch {
            // ignora
          }
        }
        finish(new Error("Tempo limite aguardando conclusão do login ChatGPT no navegador."));
      }, timeoutMs);
      timer.unref?.();

      input.onRegisterAbort?.(() => {
        if (activeLoginId) {
          try {
            sendJsonRpc({ id: nextId++, method: "account/login/cancel", params: { loginId: activeLoginId } });
          } catch {
            // ignora
          }
        }
        finish(new Error("Login ChatGPT cancelado pelo usuário."));
      });

      child.on("error", (err) => finish(err instanceof Error ? err : new Error(String(err))));
      child.on("exit", (code) => {
        if (!settled) {
          const detail = stderrTail.trim() ? ` (${stderrTail.trim().slice(-240)})` : "";
          finish(
            new Error(
              `Codex app-server encerrou antes de concluir o login (código ${code ?? "null"})${detail}.`
            )
          );
        }
      });

      rl.on("line", (line) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) return;
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          return;
        }

        if (typeof msg.id === "number") {
          const handler = pending.get(msg.id);
          if (handler) {
            pending.delete(msg.id);
            handler(msg);
          }
          return;
        }

        if (msg.method === "account/login/completed" && msg.params && typeof msg.params === "object") {
          const params = msg.params as { loginId?: string | null; success?: boolean; error?: string | null };
          if (activeLoginId && params.loginId && params.loginId !== activeLoginId) return;
          if (!params.success) {
            finish(new Error(params.error || "Login ChatGPT cancelado ou não autorizado no navegador."));
            return;
          }

          void requestRpc("account/read", { refreshToken: true })
            .then((accRes) => {
              const acc = accRes.account as { email?: string; planType?: string } | undefined;
              finish(null, {
                email: typeof acc?.email === "string" ? acc.email : null,
                plano: typeof acc?.planType === "string" ? `ChatGPT ${acc.planType}` : "ChatGPT",
              });
            })
            .catch(() => finish(null, { email: null, plano: "ChatGPT" }));
        }
      });

      void requestRpc("initialize", {
        clientInfo: { name: "criativo-ai-studio", title: "Criativo AI Studio", version: "1.0.0" },
        capabilities: { experimentalApi: true },
      })
        .then(async () => {
          if (loginStartSent || settled) return;
          loginStartSent = true;
          sendJsonRpc({ method: "initialized", params: {} });
          const loginRes = await requestRpc("account/login/start", {
            type: "chatgpt",
            codexStreamlinedLogin: true,
            useHostedLoginSuccessPage: false,
          });
          const loginId = typeof loginRes.loginId === "string" ? loginRes.loginId : null;
          const authUrl = typeof loginRes.authUrl === "string" ? loginRes.authUrl : null;
          if (!authUrl) {
            throw new Error("Codex app-server não retornou URL de login ChatGPT.");
          }
          activeLoginId = loginId;
          input.onAuthUrl(authUrl);
        })
        .catch((err) => {
          finish(err instanceof Error ? err : new Error(String(err)));
        });
    });
  }
