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
import { decodeJwtPayload, openExternalUrlIfNeeded, resolveCliBinaryForProvider, type CliAccountRecord, type CliServiceRuntimeContext } from "./cli-types-and-helpers.ts";
import { signInCliCodexViaAppServer } from "./cli-login-flows.ts";

export function registerCliLoopbackTargetFromAuthUrl(
  ctx: CliServiceRuntimeContext,
provedor: "claude" | "openai", rawUrl: string): void {
    try {
      const parsed = new URL(rawUrl);
      const redirectUri = parsed.searchParams.get("redirect_uri")?.trim();
      if (!redirectUri) return;
      const redUrl = new URL(redirectUri);
      const host = redUrl.hostname.toLowerCase();
      if (host !== "127.0.0.1" && host !== "localhost") return;
      const port = Number(redUrl.port);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) return;
      ctx.pendingLoopbackTarget.set(provedor, { host: "127.0.0.1", port });
    } catch {
      // ignora URL de redirect inválida
    }
  }

export function registerCliPendingLoopbackPort(
  ctx: CliServiceRuntimeContext,
provedor: "claude" | "openai", port: number): void {
    if (Number.isInteger(port) && port >= 1024 && port <= 65535) {
      ctx.pendingLoopbackTarget.set(provedor, { host: "127.0.0.1", port });
    }
  }

  /**
   * Executa login ChatGPT/Codex no Desktop em pasta temporária isolada e devolve o payload
   * `auth.json` apenas para exportação segura a um servidor remoto (VPS), sem gravar localmente.
   */
export async function signInCliCodexIsolatedForRemoteExport(
  ctx: CliServiceRuntimeContext,

    label?: string,
    onAuthUrl?: (url: string) => void
  ): Promise<{
    authJson: string;
    email: string | null;
    plano: string | null;
    label?: string;
  }> {
    ctx.cancelPendingSignIn("openai");
    let executable = resolveCliBinaryForProvider("openai", ctx.appDataDir).executable;
    if (!executable) {
      const installed = await ensureProviderRuntimeInstalled("codex", { appDataDir: ctx.appDataDir });
      executable = installed.executable;
      if (!executable) {
        const extraReason = installed.error ? ` (${installed.error})` : "";
        throw new Error(
          `Runtime Codex CLI (codex) não encontrado e não pôde ser instalado automaticamente${extraReason}.`
        );
      }
    }

    const tempDir = mkdtempSync(join(tmpdir(), "criativo-codex-remote-"));
    try {
      const appResult = await signInCliCodexViaAppServer(ctx, {
        executable,
        codexHome: tempDir,
        onAuthUrl: (url) => {
          onAuthUrl?.(url);
          openExternalUrlIfNeeded(url);
        },
        onRegisterAbort: (abortFn) => {
          ctx.pendingSignInAbort.set("openai", abortFn);
        },
      });

      const authPath = join(tempDir, "auth.json");
      if (!existsSync(authPath)) {
        throw new Error("Login ChatGPT concluído, porém o arquivo auth.json não foi gerado para exportação.");
      }

      const authJson = readFileSync(authPath, "utf8");
      let email = appResult.email;
      let plano = appResult.plano;
      try {
        const auth = JSON.parse(authJson) as { tokens?: { id_token?: string } };
        const jwt = auth.tokens?.id_token ? decodeJwtPayload(auth.tokens.id_token) : null;
        if (jwt && typeof jwt.email === "string") email = email ?? jwt.email;
        const authMeta = jwt?.["https://api.openai.com/auth"] as { chatgpt_plan_type?: string } | undefined;
        if (authMeta?.chatgpt_plan_type) plano = plano ?? `ChatGPT ${authMeta.chatgpt_plan_type}`;
      } catch {
        // segue com os metadados obtidos pelo app-server
      }

      return {
        authJson,
        email,
        plano,
        ...(label?.trim() ? { label: label.trim() } : {}),
      };
    } finally {
      ctx.pendingSignInAbort.delete("openai");
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignora erro ao remover pasta temporária
      }
    }
  }

  /**
   * Importa uma sessão `auth.json` do Codex/ChatGPT em pasta isolada no servidor destino (ex.: VPS)
   * e garante em best-effort que o runtime `codex` esteja instalado para cotas e execução.
   */
export async function importCliCodexAuthAccount(
  ctx: CliServiceRuntimeContext,
input: {
    authJson: string;
    email?: string | null;
    plano?: string | null;
    label?: string;
  }): Promise<ContaProvedorInfo> {
    let parsedAuth: { tokens?: { id_token?: string; access_token?: string }; OPENAI_API_KEY?: string };
    try {
      parsedAuth = JSON.parse(input.authJson) as typeof parsedAuth;
    } catch {
      throw new Error("Payload 'auth_json' inválido para conta ChatGPT/Codex.");
    }
    if (!parsedAuth?.tokens && !parsedAuth?.OPENAI_API_KEY) {
      throw new Error("Arquivo auth.json sem credenciais OAuth válidas.");
    }

    let email = input.email?.trim() || null;
    let plano = input.plano?.trim() || null;
    if (parsedAuth.tokens?.id_token) {
      const jwt = decodeJwtPayload(parsedAuth.tokens.id_token);
      if (!email && jwt && typeof jwt.email === "string") email = jwt.email;
      const authMeta = jwt?.["https://api.openai.com/auth"] as { chatgpt_plan_type?: string } | undefined;
      if (!plano && authMeta?.chatgpt_plan_type) plano = `ChatGPT ${authMeta.chatgpt_plan_type}`;
    }

    const id = `oa-${randomUUID().slice(0, 8)}`;
    const configDir = resolve(ctx.accountsRootDir, "openai", id);
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "auth.json"), JSON.stringify(parsedAuth, null, 2), "utf8");

    const records = ctx.getStoredRecords();
    const cleaned = records.filter((r) => {
      if (r.provedor !== "openai") return true;
      if (email && r.email && r.email.toLowerCase() === email.toLowerCase()) {
        try {
          rmSync(resolve(r.configDir), { recursive: true, force: true });
        } catch {
          // ignora remoção da pasta duplicada antiga
        }
        return false;
      }
      return true;
    });

    cleaned.push({
      id,
      provedor: "openai",
      configDir,
      label: input.label?.trim() || null,
      email,
      plano,
    });
    ctx.saveStoredRecords(cleaned);
    ctx.invalidateModelCache("openai");
    ctx.invalidateQuotaCache("openai");

    if (!resolveCliBinaryForProvider("openai", ctx.appDataDir).executable) {
      await ensureProviderRuntimeInstalled("codex", { appDataDir: ctx.appDataDir }).catch(() => null);
    }

    const list = await ctx.listAccountsWithQuotas("openai", true).catch(() => ctx.listAccounts("openai"));
    return (
      list.find((a) => a.id === id) ?? {
        id,
        provedor: "openai",
        rotulo: input.label?.trim() || null,
        email,
        plano: plano ?? "ChatGPT Plus / Pro",
        estado: "conectado",
        padrao: list.length <= 1,
        token_valido: true,
        grupos_cota: [],
        origem: "criativo",
      }
    );
  }

  /**
   * Entrega localmente o callback OAuth capturado pelo App Desktop (ou colado manualmente)
   * ao servidor loopback interno aberto pela CLI (`codex` / `claude`) nesta máquina.
   */
export async function relayCliLoopbackCallback(
  ctx: CliServiceRuntimeContext,

    provedor: "claude" | "openai",
    rawCallbackInput: string
  ): Promise<{
    status: number;
    body: string;
    contentType: string;
    accepted: boolean;
    errorMessage?: string;
  }> {
    const cleanInput = rawCallbackInput.trim();
    if (!cleanInput) {
      throw new Error("URL ou caminho de callback OAuth vazio.");
    }

    let target = ctx.pendingLoopbackTarget.get(provedor);
    let safePath = "";

    if (/^https?:\/\//i.test(cleanInput)) {
      const parsed = new URL(cleanInput);
      const host = parsed.hostname.toLowerCase();
      if (host !== "127.0.0.1" && host !== "localhost") {
        throw new Error("Callback OAuth deve apontar para 127.0.0.1 ou localhost.");
      }
      safePath = `${parsed.pathname || "/"}${parsed.search || ""}`;
      if (!target && parsed.port) {
        const portNum = Number(parsed.port);
        if (Number.isInteger(portNum) && portNum >= 1024 && portNum <= 65535) {
          target = { host: "127.0.0.1", port: portNum };
        }
      }
    } else {
      safePath = cleanInput.startsWith("/") ? cleanInput : `/${cleanInput}`;
    }

    if (!target) {
      throw new Error(
        "Nenhum fluxo de login aguardando retorno neste servidor. Clique em Conectar novamente."
      );
    }
    if (safePath.startsWith("//") || /[\r\n]/.test(safePath)) {
      throw new Error("Caminho de callback OAuth inválido.");
    }

    const parsedPath = new URL(safePath, `http://localhost:${target.port}`);
    const lowerPath = parsedPath.pathname.toLowerCase();
    if (lowerPath === "/cancel" || lowerPath.endsWith("/cancel")) {
      throw new Error("Retorno /cancel bloqueado pelo relay OAuth.");
    }
    if (!parsedPath.searchParams.has("code") && !parsedPath.searchParams.has("error") && !(lowerPath.includes("callback") && parsedPath.search.length > 1)) {
      throw new Error("Callback OAuth sem parâmetros de autorização ('code' ou 'error').");
    }

    const upstream = await ctx.fetchImpl(`http://${target.host}:${target.port}${safePath}`, {
      method: "GET",
      headers: {
        Host: `localhost:${target.port}`,
      },
      redirect: "manual",
    });
    const body = await upstream.text().catch(() => "");
    let errorMessage: string | undefined;
    let isErrorRedirect = false;

    if (upstream.status >= 300 && upstream.status < 400) {
      const locationHeader = upstream.headers.get("location")?.trim() || "";
      if (locationHeader) {
        const lowerLoc = locationHeader.toLowerCase();
        if (lowerLoc.includes("/cancel") || lowerLoc.includes("error=")) {
          isErrorRedirect = true;
          errorMessage = "O servidor OAuth local cancelou ou recusou a autorização.";
        } else if (
          lowerLoc.startsWith("/success") ||
          lowerLoc.includes("://localhost") ||
          lowerLoc.includes("://127.0.0.1")
        ) {
          const confirmUrl = locationHeader.startsWith("/")
            ? `http://${target.host}:${target.port}${locationHeader}`
            : locationHeader;
          await ctx.fetchImpl(confirmUrl, {
            method: "GET",
            headers: { Host: `localhost:${target.port}` },
            redirect: "manual",
          }).catch(() => null);
        }
      }
    }

    const accepted = upstream.status >= 200 && upstream.status < 400 && !isErrorRedirect;
    if (!accepted && !errorMessage) {
      errorMessage = `Servidor OAuth respondeu HTTP ${upstream.status}.`;
    }

    return {
      status: upstream.status,
      body,
      contentType: upstream.headers.get("content-type") ?? "text/html; charset=utf-8",
      accepted,
      ...(errorMessage ? { errorMessage } : {}),
    };
  }
