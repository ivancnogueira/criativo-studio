import { spawn } from "node:child_process";
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
import { createInterface } from "node:readline";
import type {
  ContaProvedorInfo,
  GrupoCotaConta,
  ModeloProvedorInfo,
  NivelEsforco,
  PoolContasConfig,
  ProviderName,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import {
  buildDualWindowQuotaGroup,
  refreshCachedQuotaGroupCountdowns,
} from "./provider-quota-utils.ts";
import {
  ensureProviderRuntimeInstalled,
  resolveManagedProviderRuntime,
  spawnProviderProcess,
} from "./provider-runtime-resolver.ts";

export interface CliAccountRecord {
  id: string;
  provedor: "claude" | "openai";
  configDir: string;
  label: string | null;
  email: string | null;
  plano: string | null;
}

export interface CliExecutionInput {
  provedor: "claude" | "openai";
  modelId: string;
  systemPrompt?: string;
  messages: Array<{ role: "user" | "assistant"; text: string }>;
  agentId?: string | null;
  preferredAccountId?: string | null;
  mcpConfig?: Record<string, unknown> | null;
  timeoutMs?: number;
}

export interface CliExecutionOutput {
  text: string;
  modelUsed: string;
  accountId: string;
  accountEmail: string | null;
  usage: {
    uncachedInput: number;
    cachedInput: number;
    output: number;
  };
}

const LOGIN_TIMEOUT_MS = 180_000;
const EXEC_TIMEOUT_MS = 90_000;
const MODEL_CATALOG_TTL_MS = 5 * 60_000;
const QUOTA_CACHE_TTL_MS = 2 * 60_000;

function mapEffortList(list?: string[]): NivelEsforco[] | undefined {
  if (!Array.isArray(list) || list.length === 0) return undefined;
  const out = new Set<NivelEsforco>();
  for (const raw of list) {
    const k = String(raw).toLowerCase();
    if (k === "low" || k === "baixo") out.add("baixo");
    else if (k === "medium" || k === "medio") out.add("medio");
    else if (k === "high" || k === "xhigh" || k === "max" || k === "ultra" || k === "alto") out.add("alto");
  }
  return out.size > 0 ? Array.from(out) : undefined;
}

export function resolveCliBinaryForProvider(
  provedor: "claude" | "openai",
  appDataDir?: string
): { executable: string | null; version: string | null } {
  return resolveManagedProviderRuntime(provedor === "claude" ? "claude" : "codex", {
    appDataDir,
  });
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function spawnCommandWithStdin(input: {
  executable: string;
  args: string[];
  env: Record<string, string | undefined>;
  cwd: string;
  stdinText?: string;
  keepStdinOpen?: boolean;
  interactiveWindow?: boolean;
  timeoutMs: number;
  onOutputLine?: (line: string) => void;
  onRegisterAbort?: (abortFn: () => void) => void;
}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawnProviderProcess(input.executable, input.args, {
      cwd: input.cwd,
      env: input.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: !input.interactiveWindow,
    });
    child.stdin.on("error", () => {});

    let stdout = "";
    let stderr = "";
    let finished = false;

    input.onRegisterAbort?.(() => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try {
        child.stdin.end();
        child.kill();
      } catch {
        // ignora
      }
      rejectPromise(new Error("Autenticação no navegador cancelada pelo usuário."));
    });

    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      try {
        child.kill();
      } catch {
        // ignora
      }
      rejectPromise(
        new Error(`Tempo limite (${Math.round(input.timeoutMs / 1000)}s) ao aguardar conclusão do processo.`)
      );
    }, input.timeoutMs);
    timer.unref?.();

    child.stdout.on("data", (chunk) => {
      const str = chunk.toString("utf8");
      stdout += str;
      if (input.onOutputLine) {
        for (const l of str.split(/[\r\n]+/)) {
          if (l.trim()) input.onOutputLine(l);
        }
      }
    });

    child.stderr.on("data", (chunk) => {
      const str = chunk.toString("utf8");
      stderr += str;
      if (input.onOutputLine) {
        for (const l of str.split(/[\r\n]+/)) {
          if (l.trim()) input.onOutputLine(l);
        }
      }
    });

    child.on("error", (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      rejectPromise(err);
    });

    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolvePromise({ code, stdout, stderr });
    });

    if (input.stdinText !== undefined) {
      child.stdin.write(input.stdinText);
    }
    if (!input.keepStdinOpen) {
      child.stdin.end();
    }
  });
}

function openExternalUrlIfNeeded(url: string): void {
  try {
    if (process.platform === "win32") {
      // rundll32 passa a URL inteira por argv sem cmd.exe cortar query params no '&'
      spawn("rundll32.exe", ["url.dll,FileProtocolHandler", url], {
        detached: true,
        stdio: "ignore",
        shell: false,
      }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore", shell: false }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore", shell: false }).unref();
    }
  } catch {
    // fallback silencioso caso ambiente headless bloqueie abertura do navegador
  }
}

function createBrowserCaptureShim(onUrl: (url: string) => void): {
  commandPath: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "criativo-oauth-browser-"));
  const pageFile = join(dir, "page");
  const isWin = process.platform === "win32";
  const commandPath = join(dir, isWin ? "browser.cmd" : "browser.sh");

  if (isWin) {
    writeFileSync(
      commandPath,
      '@echo off\r\nsetlocal EnableDelayedExpansion\r\nset "address=%~1"\r\n>>"%~dp0page" echo(!address!\r\n',
      "utf8"
    );
  } else {
    writeFileSync(
      commandPath,
      `#!/bin/sh\nprintf '%s\\n' "$1" >> '${pageFile.replaceAll("'", "'\\''")}'\n`,
      "utf8"
    );
    chmodSync(commandPath, 0o700);
  }

  let handled = false;
  const poll = setInterval(() => {
    if (handled || !existsSync(pageFile)) return;
    try {
      const content = readFileSync(pageFile, "utf8");
      for (const rawLine of content.split(/\r?\n/)) {
        const candidate = rawLine.trim();
        if (!candidate) continue;
        try {
          const parsed = new URL(candidate);
          if (parsed.protocol === "https:" || parsed.protocol === "http:") {
            handled = true;
            clearInterval(poll);
            onUrl(parsed.toString());
            return;
          }
        } catch {
          // ignora linha inválida
        }
      }
    } catch {
      // ignora leitura concorrente
    }
  }, 200);
  poll.unref?.();

  return {
    commandPath,
    cleanup: () => {
      clearInterval(poll);
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignora erro de remoção temporária
      }
    },
  };
}

/**
 * Gerencia conexões OAuth reais do usuário para Claude (`CLAUDE_CONFIG_DIR`)
 * e ChatGPT / Codex (`CODEX_HOME`) armazenadas exclusivamente em `dados/contas/<provedor>/<id>`.
 */
export class CliOAuthAccountsService {
  private readonly db: CriativoDatabase;
  private readonly workspaceCwd: string;
  private readonly accountsRootDir: string;
  private readonly appDataDir?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly pendingSignInAbort = new Map<"claude" | "openai", () => void>();
  private mcpConfigResolver?: (agentId?: string | null) => Record<string, unknown> | null;
  private readonly dynamicModelsCache = new Map<
    "claude" | "openai",
    { expiresAt: number; modelos: ModeloProvedorInfo[] }
  >();
  private readonly accountsQuotaCache = new Map<
    string,
    { expiresAt: number; grupos: GrupoCotaConta[] }
  >();

  constructor(options: {
    db: CriativoDatabase;
    workspaceCwd?: string;
    accountsRootDir?: string;
    appDataDir?: string;
    fetchImpl?: typeof fetch;
  }) {
    this.db = options.db;
    this.workspaceCwd = resolve(options.workspaceCwd ?? process.cwd());
    this.accountsRootDir = resolve(
      options.accountsRootDir ?? join(this.workspaceCwd, "dados", "contas")
    );
    this.appDataDir = options.appDataDir;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public cancelPendingSignIn(provedor: "claude" | "openai"): boolean {
    const abortFn = this.pendingSignInAbort.get(provedor);
    if (!abortFn) return false;
    this.pendingSignInAbort.delete(provedor);
    try {
      abortFn();
      return true;
    } catch {
      return false;
    }
  }

  private getStoredRecords(): CliAccountRecord[] {
    try {
      const row = this.db.connection
        .prepare(`SELECT valor_json FROM projecao_studio_config WHERE chave = 'studio_cli_accounts';`)
        .get() as { valor_json: string } | undefined;
      const parsed = row ? (JSON.parse(row.valor_json) as CliAccountRecord[]) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private saveStoredRecords(records: CliAccountRecord[]): void {
    this.db.connection
      .prepare(
        `INSERT INTO projecao_studio_config (chave, valor_json, atualizado_em)
         VALUES ('studio_cli_accounts', ?, ?)
         ON CONFLICT(chave) DO UPDATE SET valor_json = excluded.valor_json, atualizado_em = excluded.atualizado_em;`
      )
      .run(JSON.stringify(records), new Date().toISOString());
  }

  public getPoolConfig(provedor: "claude" | "openai"): PoolContasConfig | null {
    const accounts = this.listAccounts(provedor);
    if (accounts.length === 0) return null;

    let override: { habilitado?: boolean; contas_excluidas?: string[]; conta_em_uso?: string | null } = {};
    try {
      const row = this.db.connection
        .prepare(`SELECT valor_json FROM projecao_studio_config WHERE chave = ?;`)
        .get(`studio_cli_pool_${provedor}`) as { valor_json: string } | undefined;
      if (row) {
        override = JSON.parse(row.valor_json) as typeof override;
      }
    } catch {
      // ignora config corrompida
    }

    const excluidas = override.contas_excluidas ?? [];
    const habilitado = override.habilitado !== undefined ? override.habilitado : accounts.length > 1;
    const elegivel =
      accounts.find((a) => override.conta_em_uso && a.id === override.conta_em_uso) ??
      accounts.find((a) => !excluidas.includes(a.id)) ??
      accounts[0] ??
      null;

    return {
      habilitado,
      contas_excluidas: excluidas,
      conta_em_uso: elegivel?.id ?? null,
    };
  }

  public setPoolSettings(
    provedor: "claude" | "openai",
    patch: { habilitado?: boolean; contas_excluidas?: string[]; conta_em_uso?: string | null }
  ): void {
    const current = this.getPoolConfig(provedor);
    const next = {
      habilitado: patch.habilitado ?? current?.habilitado ?? true,
      contas_excluidas: patch.contas_excluidas ?? current?.contas_excluidas ?? [],
      conta_em_uso: patch.conta_em_uso !== undefined ? patch.conta_em_uso : current?.conta_em_uso ?? null,
    };
    this.db.connection
      .prepare(
        `INSERT INTO projecao_studio_config (chave, valor_json, atualizado_em)
         VALUES (?, ?, ?)
         ON CONFLICT(chave) DO UPDATE SET valor_json = excluded.valor_json, atualizado_em = excluded.atualizado_em;`
      )
      .run(`studio_cli_pool_${provedor}`, JSON.stringify(next), new Date().toISOString());
  }

  public listAccounts(provedor: "claude" | "openai"): ContaProvedorInfo[] {
    const records = this.getStoredRecords().filter((r) => r.provedor === provedor);
    const out: ContaProvedorInfo[] = [];

    for (const rec of records) {
      const absDir = resolve(rec.configDir);
      if (!existsSync(absDir)) continue;

      let email = rec.email;
      let plano = rec.plano;
      let hasAuthFile = false;

      if (provedor === "claude") {
        const credPath = join(absDir, ".credentials.json");
        hasAuthFile = existsSync(credPath);
        const claudeJson = join(absDir, ".claude.json");
        if (existsSync(claudeJson)) {
          try {
            const parsed = JSON.parse(readFileSync(claudeJson, "utf8")) as {
              oauthAccount?: { emailAddress?: string; billingType?: string };
            };
            email = parsed.oauthAccount?.emailAddress ?? email;
            plano = parsed.oauthAccount?.billingType ?? plano ?? "Claude.ai";
            if (parsed.oauthAccount?.emailAddress) hasAuthFile = true;
          } catch {
            // ignora
          }
        }
      } else {
        const authPath = join(absDir, "auth.json");
        if (existsSync(authPath)) {
          hasAuthFile = true;
          try {
            const auth = JSON.parse(readFileSync(authPath, "utf8")) as {
              tokens?: { id_token?: string };
            };
            const jwt = auth.tokens?.id_token ? decodeJwtPayload(auth.tokens.id_token) : null;
            if (jwt && typeof jwt.email === "string") email = jwt.email;
            const authMeta = jwt?.["https://api.openai.com/auth"] as { chatgpt_plan_type?: string } | undefined;
            if (authMeta?.chatgpt_plan_type) plano = `ChatGPT ${authMeta.chatgpt_plan_type}`;
          } catch {
            // ignora
          }
        }
      }

      if (!hasAuthFile) continue;

      out.push({
        id: rec.id,
        provedor: provedor as ProviderName,
        rotulo: rec.label,
        email: email ?? null,
        plano: plano ?? (provedor === "claude" ? "Claude Pro / Max" : "ChatGPT Plus / Pro"),
        estado: "conectado",
        padrao: out.length === 0,
        token_valido: true,
        grupos_cota: [],
        origem: "criativo",
      });
    }

    return out;
  }

  public async connectViaBrowser(
    provedor: "claude" | "openai",
    label?: string,
    onAuthUrl?: (url: string) => void
  ): Promise<ContaProvedorInfo> {
    let executable = resolveCliBinaryForProvider(provedor, this.appDataDir).executable;
    if (!executable) {
      const installed = await ensureProviderRuntimeInstalled(
        provedor === "claude" ? "claude" : "codex",
        { appDataDir: this.appDataDir }
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
    const configDir = resolve(this.accountsRootDir, provedor, id);
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
                cwd: this.workspaceCwd,
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

            this.pendingSignInAbort.set("claude", () => {
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
          this.pendingSignInAbort.delete("claude");
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
            cwd: this.workspaceCwd,
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
        const appResult = await this.signInCodexViaAppServer({
          executable: resolvedExecutable,
          codexHome: configDir,
          onAuthUrl: (url) => {
            onAuthUrl?.(url);
            openExternalUrlIfNeeded(url);
          },
          onRegisterAbort: (abortFn) => {
            this.pendingSignInAbort.set("openai", abortFn);
          },
        }).finally(() => {
          this.pendingSignInAbort.delete("openai");
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

      const records = this.getStoredRecords();
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
      this.saveStoredRecords(cleaned);
      this.invalidateModelCache(provedor);
      this.invalidateQuotaCache(provedor);

      const list = this.listAccounts(provedor);
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
  private async signInCodexViaAppServer(input: {
    executable: string;
    codexHome: string;
    onAuthUrl: (url: string) => void;
    timeoutMs?: number;
    onRegisterAbort?: (abortFn: () => void) => void;
  }): Promise<{ email: string | null; plano: string | null }> {
    const timeoutMs = input.timeoutMs ?? LOGIN_TIMEOUT_MS;
    const child = spawnProviderProcess(input.executable, ["app-server"], {
      cwd: this.workspaceCwd,
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
      const pending = new Map<number, (msg: Record<string, unknown>) => void>();
      const rl = createInterface({ input: child.stdout });

      const finish = (err: Error | null, res?: { email: string | null; plano: string | null }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
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
          finish(new Error(`Codex app-server encerrou antes de concluir o login (código ${code ?? "null"}).`));
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

  public invalidateModelCache(provedor?: "claude" | "openai"): void {
    if (provedor) {
      this.dynamicModelsCache.delete(provedor);
    } else {
      this.dynamicModelsCache.clear();
    }
  }

  public invalidateQuotaCache(provedor?: "claude" | "openai"): void {
    if (!provedor) {
      this.accountsQuotaCache.clear();
      return;
    }
    for (const key of this.accountsQuotaCache.keys()) {
      if (key.startsWith(`${provedor}:`)) {
        this.accountsQuotaCache.delete(key);
      }
    }
  }

  /**
   * Consulta ao vivo as cotas reais (5 horas / Semanal) das contas OAuth de Claude e ChatGPT/Codex:
   * - `claude`: GET `https://api.anthropic.com/api/oauth/usage` usando `claudeAiOauth.accessToken`;
   * - `openai`: JSON-RPC `account/rateLimits/read` em `codex app-server` com `CODEX_HOME` da conta.
   */
  public async listAccountsWithQuotas(
    provedor: "claude" | "openai",
    forceRefresh = false
  ): Promise<ContaProvedorInfo[]> {
    const accounts = this.listAccounts(provedor);
    if (accounts.length === 0) return [];

    const records = this.getStoredRecords().filter((r) => r.provedor === provedor);
    const openaiCli =
      provedor === "openai" ? resolveCliBinaryForProvider("openai", this.appDataDir).executable : null;
    const now = Date.now();

    return Promise.all(
      accounts.map(async (acc) => {
        const cacheKey = `${provedor}:${acc.id}`;
        const cached = this.accountsQuotaCache.get(cacheKey);
        if (!forceRefresh && cached && cached.expiresAt > now) {
          return {
            ...acc,
            grupos_cota: refreshCachedQuotaGroupCountdowns(cached.grupos),
          };
        }

        const rec = records.find((r) => r.id === acc.id);
        let grupos: GrupoCotaConta[] = [];

        if (rec) {
          try {
            if (provedor === "claude") {
              grupos = await this.fetchClaudeQuota(resolve(rec.configDir));
            } else if (openaiCli) {
              grupos = await this.probeCodexQuota(openaiCli, resolve(rec.configDir));
            }
          } catch {
            // fallback gracioso abaixo para cache prévio caso indisponível momentaneamente
          }
        }

        if (grupos.length > 0) {
          this.accountsQuotaCache.set(cacheKey, {
            expiresAt: now + QUOTA_CACHE_TTL_MS,
            grupos,
          });
        } else if (cached?.grupos?.length) {
          grupos = refreshCachedQuotaGroupCountdowns(cached.grupos);
        }

        return {
          ...acc,
          grupos_cota: grupos,
        };
      })
    );
  }

  private async fetchClaudeQuota(configDir: string): Promise<GrupoCotaConta[]> {
    const credPath = join(configDir, ".credentials.json");
    if (!existsSync(credPath)) return [];

    let accessToken: string | null = null;
    try {
      const parsed = JSON.parse(readFileSync(credPath, "utf8")) as {
        claudeAiOauth?: { accessToken?: string };
      };
      accessToken = parsed.claudeAiOauth?.accessToken?.trim() || null;
    } catch {
      return [];
    }
    if (!accessToken) return [];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    timer.unref?.();

    try {
      const res = await this.fetchImpl("https://api.anthropic.com/api/oauth/usage", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "anthropic-beta": "oauth-2025-04-20",
          Accept: "application/json",
          "User-Agent": "claude-code/2.1.0",
        },
        signal: controller.signal,
      });
      if (!res.ok) return [];

      const body = (await res.json()) as {
        five_hour?: { utilization?: number; resets_at?: string | null } | null;
        seven_day?: { utilization?: number; resets_at?: string | null } | null;
      };

      const fiveHourRem =
        typeof body.five_hour?.utilization === "number"
          ? 100 - body.five_hour.utilization
          : null;
      const weeklyRem =
        typeof body.seven_day?.utilization === "number"
          ? 100 - body.seven_day.utilization
          : null;

      const group = buildDualWindowQuotaGroup({
        nome: "Claude",
        fiveHourRemaining: fiveHourRem,
        fiveHourResetIso: body.five_hour?.resets_at ?? null,
        weeklyRemaining: weeklyRem,
        weeklyResetIso: body.seven_day?.resets_at ?? null,
      });
      return group ? [group] : [];
    } finally {
      clearTimeout(timer);
    }
  }

  private async probeCodexQuota(
    executable: string,
    codexHome: string
  ): Promise<GrupoCotaConta[]> {
    const result = await this.runCodexAppServerRpc<{
      rateLimits?: {
        primary?: { usedPercent?: number; windowDurationMins?: number; resetsAt?: number | null } | null;
        secondary?: { usedPercent?: number; windowDurationMins?: number; resetsAt?: number | null } | null;
      };
    }>(executable, codexHome, "account/rateLimits/read", {});

    const primary = result?.rateLimits?.primary;
    const secondary = result?.rateLimits?.secondary;
    const toIsoFromEpochSec = (sec: number | null | undefined): string | null =>
      typeof sec === "number" && Number.isFinite(sec) && sec > 0
        ? new Date(sec * 1000).toISOString()
        : null;

    const group = buildDualWindowQuotaGroup({
      nome: "ChatGPT",
      fiveHourRemaining: typeof primary?.usedPercent === "number" ? 100 - primary.usedPercent : null,
      fiveHourResetIso: toIsoFromEpochSec(primary?.resetsAt),
      fiveHourDurationMins: primary?.windowDurationMins ?? 300,
      weeklyRemaining: typeof secondary?.usedPercent === "number" ? 100 - secondary.usedPercent : null,
      weeklyResetIso: toIsoFromEpochSec(secondary?.resetsAt),
      weeklyDurationMins: secondary?.windowDurationMins ?? 10_080,
    });
    return group ? [group] : [];
  }

  private async runCodexAppServerRpc<TResult>(
    executable: string,
    codexHome: string,
    method: string,
    params: Record<string, unknown>
  ): Promise<TResult | null> {
    return new Promise((resolvePromise) => {
      const child = spawnProviderProcess(executable, ["app-server"], {
        cwd: this.workspaceCwd,
        env: {
          ...process.env,
          CODEX_HOME: codexHome,
        },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      child.stdin.on("error", () => {});

      let settled = false;
      const done = (res: TResult | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        rl.close();
        try {
          child.stdin.end();
          child.kill();
        } catch {
          // ignora
        }
        resolvePromise(res);
      };

      const timer = setTimeout(() => done(null), 6_500);
      timer.unref?.();

      const rl = createInterface({ input: child.stdout });
      child.on("error", () => done(null));
      child.on("exit", () => done(null));

      rl.on("line", (line) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) return;
        try {
          const msg = JSON.parse(trimmed) as { id?: number; result?: TResult };
          if (msg.id === 1) {
            child.stdin.write(
              `${JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} })}\n`
            );
            child.stdin.write(
              `${JSON.stringify({ jsonrpc: "2.0", id: 2, method, params })}\n`
            );
          } else if (msg.id === 2) {
            done(msg.result ?? null);
          }
        } catch {
          // ignora JSON parcial
        }
      });

      child.stdin.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            clientInfo: { name: "criativo-ai-studio", version: "1.0.0" },
            capabilities: { experimentalApi: true },
          },
        })}\n`
      );
    });
  }

  /**
   * Consulta ao vivo os modelos reais disponíveis na conta/CLI conectada do provedor:
   * - `openai`: JSON-RPC `model/list` em `codex app-server` usando `CODEX_HOME` da conta;
   * - `claude`: `control_request: initialize` em `claude --input-format stream-json --output-format stream-json`.
   */
  public async listDynamicModels(
    provedor: "claude" | "openai",
    forceRefresh = false
  ): Promise<ModeloProvedorInfo[]> {
    const now = Date.now();
    const cached = this.dynamicModelsCache.get(provedor);
    if (!forceRefresh && cached && cached.expiresAt > now && cached.modelos.length > 0) {
      return cached.modelos;
    }

    const { executable } = resolveCliBinaryForProvider(provedor, this.appDataDir);
    if (!executable) {
      return [];
    }

    const accounts = this.listAccounts(provedor);
    if (provedor === "openai" && accounts.length === 0) {
      return [];
    }

    const pool = this.getPoolConfig(provedor);
    const chosenId = pool?.conta_em_uso ?? accounts[0]?.id ?? null;
    const rec = chosenId
      ? this.getStoredRecords().find((r) => r.provedor === provedor && r.id === chosenId)
      : undefined;

    let modelos: ModeloProvedorInfo[] = [];
    if (provedor === "openai" && rec) {
      modelos = await this.probeCodexModels(executable, resolve(rec.configDir));
    } else if (provedor === "claude") {
      modelos = await this.probeClaudeModels(executable, rec ? resolve(rec.configDir) : null);
    }

    if (modelos.length > 0) {
      this.dynamicModelsCache.set(provedor, {
        expiresAt: now + MODEL_CATALOG_TTL_MS,
        modelos,
      });
    }
    return modelos;
  }

  private async probeCodexModels(
    executable: string,
    codexHome: string
  ): Promise<ModeloProvedorInfo[]> {
    const result = await this.runCodexAppServerRpc<{
      data?: Array<{
        model?: string;
        displayName?: string;
        isDefault?: boolean;
        inputModalities?: string[];
        supportedReasoningEfforts?: Array<{ reasoningEffort?: string }>;
      }>;
    }>(executable, codexHome, "model/list", { limit: 100, includeHidden: true });

    const rawList = Array.isArray(result?.data) ? result.data : [];
    const mapped: ModeloProvedorInfo[] = [];
    const seen = new Set<string>();
    for (const item of rawList) {
      const id = typeof item.model === "string" ? item.model.trim() : "";
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const efforts = mapEffortList(
        (item.supportedReasoningEfforts ?? []).map((e) => String(e.reasoningEffort ?? ""))
      );
      const hasImage =
        Array.isArray(item.inputModalities) && item.inputModalities.includes("image");
      mapped.push({
        id,
        rotulo: item.displayName?.trim() || id,
        padrao: Boolean(item.isDefault) || mapped.length === 0,
        suporta_imagem: hasImage || /image|gpt-6|gpt-5/i.test(id),
        esforcos_suportados: efforts,
        descoberto_em_conta: true,
      });
    }
    return mapped;
  }

  private async probeClaudeModels(
    executable: string,
    configDir: string | null
  ): Promise<ModeloProvedorInfo[]> {
    const args = ["--print", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"];
    return new Promise((resolvePromise) => {
      const child = spawnProviderProcess(executable, args, {
        cwd: this.workspaceCwd,
        env: {
          ...process.env,
          DISABLE_AUTOUPDATER: "1",
          ...(configDir ? { CLAUDE_CONFIG_DIR: configDir } : {}),
        },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      child.stdin.on("error", () => {});

      let settled = false;
      const done = (res: ModeloProvedorInfo[]) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        rl.close();
        try {
          child.stdin.end();
          child.kill();
        } catch {
          // ignora
        }
        resolvePromise(res);
      };

      const timer = setTimeout(() => done([]), 6_000);
      timer.unref?.();

      const rl = createInterface({ input: child.stdout });
      child.on("error", () => done([]));
      child.on("exit", () => done([]));

      rl.on("line", (line) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) return;
        try {
          const msg = JSON.parse(trimmed) as {
            type?: string;
            response?: {
              response?: {
                models?: Array<{
                  value?: string;
                  resolvedModel?: string;
                  displayName?: string;
                  supportedEffortLevels?: string[];
                }>;
              };
            };
          };
          if (msg.type !== "control_response") return;
          const rawList = msg.response?.response?.models;
          if (!Array.isArray(rawList)) {
            done([]);
            return;
          }
          const mapped: ModeloProvedorInfo[] = [];
          const seen = new Set<string>();
          for (const item of rawList) {
            const id = (item.resolvedModel?.trim() || item.value?.trim() || "").replace(/\[1m\]$/i, "");
            if (!id || seen.has(id)) continue;
            seen.add(id);
            const rawName = item.displayName?.trim() || id;
            const rotulo =
              rawName.toLowerCase() === "default (recommended)"
                ? id
                : rawName.toLowerCase().startsWith("claude")
                  ? rawName
                  : `Claude ${rawName}`;
            mapped.push({
              id,
              rotulo,
              padrao: item.value === "default" || mapped.length === 0,
              esforcos_suportados: mapEffortList(item.supportedEffortLevels),
              descoberto_em_conta: Boolean(configDir),
            });
          }
          done(mapped);
        } catch {
          // ignora JSON parcial
        }
      });

      child.stdin.write(
        `${JSON.stringify({
          type: "control_request",
          request_id: "init-models",
          request: { subtype: "initialize" },
        })}\n`
      );
    });
  }

  public setMcpConfigResolver(
    resolver: (agentId?: string | null) => Record<string, unknown> | null
  ): void {
    this.mcpConfigResolver = resolver;
  }

  public removeAccount(provedor: "claude" | "openai", contaId: string): boolean {
    const records = this.getStoredRecords();
    const target = records.find((r) => r.provedor === provedor && r.id === contaId);
    if (!target) return false;

    try {
      rmSync(resolve(target.configDir), { recursive: true, force: true });
    } catch {
      // ignora erro ao apagar pasta
    }

    this.saveStoredRecords(records.filter((r) => !(r.provedor === provedor && r.id === contaId)));
    this.invalidateModelCache(provedor);
    this.invalidateQuotaCache(provedor);
    return true;
  }

  public async executeTurn(input: CliExecutionInput): Promise<CliExecutionOutput> {
    const accounts = this.listAccounts(input.provedor);
    if (accounts.length === 0) {
      throw new Error(
        input.provedor === "claude"
          ? "Nenhuma conta Claude conectada no Studio."
          : "Nenhuma conta ChatGPT/Codex conectada no Studio."
      );
    }

    const { executable } = resolveCliBinaryForProvider(input.provedor, this.appDataDir);
    if (!executable) {
      throw new Error(`Executável CLI de ${input.provedor} não encontrado na máquina.`);
    }

    const pool = this.getPoolConfig(input.provedor);
    const chosenId = input.preferredAccountId ?? pool?.conta_em_uso ?? accounts[0].id;
    const rec =
      this.getStoredRecords().find((r) => r.provedor === input.provedor && r.id === chosenId) ??
      this.getStoredRecords().find((r) => r.provedor === input.provedor);
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
          : (this.mcpConfigResolver?.(input.agentId ?? null) ?? null);
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
          cwd: this.workspaceCwd,
          stdinText: fullPrompt,
          timeoutMs: input.timeoutMs ?? EXEC_TIMEOUT_MS,
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
        : (this.mcpConfigResolver?.(input.agentId ?? null) ?? null);
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

    const res = await spawnCommandWithStdin({
      executable,
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
      cwd: this.workspaceCwd,
      stdinText: fullPrompt,
      timeoutMs: input.timeoutMs ?? EXEC_TIMEOUT_MS,
    });

    if (res.code !== 0) {
      throw new Error(res.stderr.trim() || res.stdout.trim() || "Codex CLI retornou erro.");
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
}
