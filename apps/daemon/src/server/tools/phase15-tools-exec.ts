import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import type { BrowserTakeoverReason, BrowserTargetSelector } from "@criativo/contracts";
import type { BrowserCdpActionName } from "../../engine/tools/browser-automation.ts";
import { readImageTool } from "../../engine/tools/image-reader.ts";
import { readVideoTool } from "../../engine/tools/video-reader.ts";
import { executeShowcaseTool, SHOWCASE_AGENT_TOOL_NAMES } from "../showcase-service.ts";
import { executeSidebarTool, SIDEBAR_AGENT_TOOL_NAMES } from "../sidebar-service.ts";
import { assertAgentPermissionForPath, readAgentGovernance } from "./phase15-governance.ts";
import {
  normalizeBrowserTargetInput,
  type Phase15ToolContext,
  type Phase15ToolServices,
} from "./phase15-tools-schema.ts";
import { readStringArg, readStringArrayArg } from "./studio-tool-helpers.ts";
export async function executePhase15ToolCall(
  toolName: string,
  args: Record<string, unknown>,
  ctx: Phase15ToolContext,
  services: Phase15ToolServices,
): Promise<unknown> {
  const governance = readAgentGovernance(services.db, ctx.agenteId);
  const permissionLevel = ctx.permissionLevel ?? governance.permissionLevel;
  const browserProfileId = ctx.browserProfileId ?? governance.browserProfileId;

  if (toolName === "criativo_browser" || toolName.startsWith("browser_")) {
    if (!services.browserService) {
      throw new Error("BrowserAutomationService não inicializado neste daemon.");
    }
    const rawAction =
      toolName === "criativo_browser"
        ? readStringArg(args, "action", "acao")
        : toolName.slice("browser_".length);
    if (!rawAction) {
      throw new Error("Informe 'action' para criativo_browser.");
    }
    const action = rawAction as BrowserCdpActionName;

    if (action === "upload_files") {
      const paths = readStringArrayArg(args, "paths", "files");
      for (const p of paths) {
        assertAgentPermissionForPath({
          rawPath: p,
          workspaceRoot: services.workspaceRoot,
          permissionLevel,
          agenteId: ctx.agenteId,
          operation: "read",
          allowedFolders: governance.allowedFolders,
        });
      }
    }

    if (action === "submit_secret") {
      const tabId = readStringArg(args, "tabId");
      if (!tabId) {
        throw new Error("Informe 'tabId' em submit_secret.");
      }
      const loginId = readStringArg(args, "loginId");
      const targets = Array.isArray(args.targets)
        ? args.targets
            .map((raw) => normalizeBrowserTargetInput(raw))
            .filter((item): item is BrowserTargetSelector => Boolean(item))
        : [];
      const normalizedSubmitTarget = normalizeBrowserTargetInput(args.submitTarget) ?? null;
      const method =
        args.method === "otp" || args.method === "authenticator" ? args.method : "password";

      if (loginId) {
        return await services.browserService.submitSecret({
          tabId,
          method,
          targets,
          loginId,
          username: readStringArg(args, "username") ?? null,
          submission:
            args.submission === "click" || args.submission === "none" ? args.submission : "enter",
          submitTarget: normalizedSubmitTarget,
        });
      }

      const tab = services.browserService.sessionManager.getTab(tabId);
      let host = "site";
      try {
        host = new URL(tab?.page ? tab.page.url() : tab?.virtualUrl || "https://example.invalid").hostname;
      } catch {
        host = "site";
      }

      return {
        ok: false,
        requiresSecretInput: true,
        secretRequest: {
          requestId: `sec-${randomUUID().slice(0, 8)}`,
          tabId,
          agenteId: ctx.agenteId,
          canalId: ctx.canalId,
          host,
          method,
          targets,
          digits: typeof args.digits === "number" ? args.digits : method === "otp" ? 6 : undefined,
          loginId: null,
          username: readStringArg(args, "username") ?? null,
          submission:
            args.submission === "click" || args.submission === "none" ? args.submission : "enter",
          submitTarget: normalizedSubmitTarget,
        },
      };
    }

    const normalizedFields = Array.isArray(args.fields)
      ? args.fields
          .map((item) => {
            if (!item || typeof item !== "object") return null;
            const rec = item as Record<string, unknown>;
            const target = normalizeBrowserTargetInput(rec.target);
            if (!target) return null;
            return {
              target,
              value: typeof rec.value === "string" ? rec.value : String(rec.value ?? ""),
            };
          })
          .filter((entry): entry is { target: BrowserTargetSelector; value: string } => Boolean(entry))
      : undefined;

    return await services.browserService.executeAction({
      action,
      agenteId: ctx.agenteId,
      canalId: ctx.canalId,
      perfilId: readStringArg(args, "perfilId") ?? browserProfileId ?? undefined,
      permissionLevel,
      tabId: readStringArg(args, "tabId"),
      url: readStringArg(args, "url"),
      target: normalizeBrowserTargetInput(args.target),
      toTarget: normalizeBrowserTargetInput(args.toTarget),
      text: typeof args.text === "string" ? args.text : undefined,
      clear: typeof args.clear === "boolean" ? args.clear : undefined,
      pressEnter: typeof args.pressEnter === "boolean" ? args.pressEnter : undefined,
      key: readStringArg(args, "key"),
      fields: normalizedFields,
      deltaX: typeof args.deltaX === "number" ? args.deltaX : undefined,
      deltaY: typeof args.deltaY === "number" ? args.deltaY : undefined,
      values: Array.isArray(args.values) ? args.values.map(String) : undefined,
      checked: typeof args.checked === "boolean" ? args.checked : undefined,
      paths: Array.isArray(args.paths) ? args.paths.map(String) : undefined,
      waitKind:
        args.waitKind === "text" ||
        args.waitKind === "selector" ||
        args.waitKind === "url" ||
        args.waitKind === "load"
          ? args.waitKind
          : undefined,
      waitValue: readStringArg(args, "waitValue"),
      timeoutMs: typeof args.timeoutMs === "number" ? args.timeoutMs : undefined,
      image: typeof args.image === "boolean" ? args.image : undefined,
      expression: typeof args.expression === "string" ? args.expression : undefined,
      accept: typeof args.accept === "boolean" ? args.accept : undefined,
      promptText: typeof args.promptText === "string" ? args.promptText : undefined,
      viewport:
        args.viewport && typeof args.viewport === "object"
          ? (args.viewport as { width: number; height: number })
          : undefined,
      userAgent: readStringArg(args, "userAgent"),
      locale: readStringArg(args, "locale"),
      timezoneId: readStringArg(args, "timezoneId"),
      colorScheme:
        args.colorScheme === "dark" || args.colorScheme === "light" ? args.colorScheme : undefined,
      reason: readStringArg(args, "reason") as BrowserTakeoverReason | undefined,
      waitForTakeover: typeof args.waitForTakeover === "boolean" ? args.waitForTakeover : undefined,
    });
  }

  if (toolName === "read_video") {
    const url = readStringArg(args, "url") ?? "";
    const frames = typeof args.frames === "number" ? args.frames : undefined;
    const timeoutMs = typeof args.timeoutMs === "number" ? args.timeoutMs : undefined;
    return await readVideoTool(
      { url, frames, timeoutMs },
      { transcription: services.transcription },
    );
  }

  if (toolName === "read_image") {
    const rawPath = readStringArg(args, "path", "caminho") ?? "";
    assertAgentPermissionForPath({
      rawPath,
      workspaceRoot: services.workspaceRoot,
      permissionLevel,
      agenteId: ctx.agenteId,
      operation: "read",
      allowedFolders: governance.allowedFolders,
    });
    const maxDimension =
      typeof args.maxDimension === "number" ? args.maxDimension : undefined;
    return await readImageTool({ path: rawPath, maxDimension }, services.workspaceRoot);
  }

  if (toolName === "capture_screen") {
    if (!services.screenCapture) {
      throw new Error("ScreenCaptureBridge não inicializado neste daemon.");
    }
    const purpose = readStringArg(args, "purpose", "motivo") ?? "Inspecionar a tela atual.";
    const targetHint = readStringArg(args, "targetHint") ?? null;
    const timeoutMs = typeof args.timeoutMs === "number" ? args.timeoutMs : undefined;
    return await services.screenCapture.requestCapture({
      agenteId: ctx.agenteId,
      canalId: ctx.canalId,
      purpose,
      targetHint,
      timeoutMs,
    });
  }

  if ((SIDEBAR_AGENT_TOOL_NAMES as readonly string[]).includes(toolName)) {
    return executeSidebarTool(services.db, toolName, args, services.wsHub);
  }

  if ((SHOWCASE_AGENT_TOOL_NAMES as readonly string[]).includes(toolName)) {
    if (!services.showcaseService) {
      throw new Error("ShowcaseSiteService não inicializado neste daemon.");
    }
    const sourceDir = readStringArg(args, "sourceDir", "source_dir");
    if (sourceDir && (toolName === "publish_site" || toolName === "replace_site")) {
      assertAgentPermissionForPath({
        rawPath: sourceDir,
        workspaceRoot: services.workspaceRoot,
        permissionLevel,
        agenteId: ctx.agenteId,
        operation: "publish",
        allowedFolders: governance.allowedFolders,
      });
    }
    return executeShowcaseTool(services.showcaseService, toolName, args, {
      agenteId: ctx.agenteId,
      aprovadoPorHumano: ctx.aprovadoPorHumano,
    });
  }

  if (toolName === "create_server_install_command") {
    if (!services.remoteClaimService) {
      throw new Error("RemoteClaimService não inicializado neste daemon.");
    }
    const serverName = readStringArg(args, "server_name", "nome") ?? "Servidor VPS";
    const approved = ctx.aprovadoPorHumano === true || args.aprovadoPorHumano === true;
    if (!approved) {
      return {
        requiresApproval: true,
        action: "create_server_install_command",
        server_name: serverName,
        mensagem: `Confirme que deseja gerar o comando único de instalação para a VPS '${serverName}' (expira em 15 minutos).`,
      };
    }
    const ticket = await services.remoteClaimService.createRemoteClaim(serverName);
    return {
      ok: true,
      claim_id: ticket.claim_id,
      server_name: ticket.server_name,
      expires_at: ticket.expires_at,
      ttl_seconds: ticket.ttl_seconds,
      command_bash: ticket.command_bash,
      aviso_seguranca:
        "Comando de uso único (15 minutos). Não salve o token CRIATIVO_CLAIM em arquivos permanentes ou memórias.",
    };
  }

  if (toolName === "gerar_comando_claim_vps") {
    if (!services.remoteClaimService) {
      throw new Error("RemoteClaimService não inicializado neste daemon.");
    }
    const serverName = readStringArg(args, "server_name", "nome") ?? "Servidor VPS";
    const claim = await services.remoteClaimService.createRemoteClaim(serverName);
    return {
      ok: true,
      claim,
    };
  }

  if (toolName === "instalar_parear_servidor_vps") {
    const action = readStringArg(args, "action") === "health_check" ? "health_check" : "install";
    const host = readStringArg(args, "host")?.trim() ?? "";
    const sshPort = typeof args.port === "number" && args.port > 0 ? Math.floor(args.port) : 22;
    const username = readStringArg(args, "username")?.trim() || "root";
    const privateKeyPath = readStringArg(args, "private_key_path")?.trim() || "";
    const serverName = readStringArg(args, "server_name", "nome") ?? "Servidor VPS";
    const serverPort =
      typeof args.server_port === "number" && args.server_port > 0 ? Math.floor(args.server_port) : 3000;

    if (!host) {
      const claim = services.remoteClaimService
        ? await services.remoteClaimService.createRemoteClaim(serverName).catch(() => null)
        : null;
      return {
        ok: false,
        requires_manual_ssh_or_key: true,
        diagnostico:
          "Nenhum host/IP da VPS foi informado ainda. Peça ao usuário o IP/domínio e chave SSH (ou peça para colar o comando seguro diretamente no console SSH da VPS).",
        command_bash: claim?.command_bash ?? null,
        claim_id: claim?.claim_id ?? null,
      };
    }

    const checkVpsHealth = async () => {
      const healthUrl = `http://${host}:${serverPort}/health`;
      try {
        const res = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
        const bodyText = await res.text().catch(() => "");
        return {
          reachable: res.ok,
          status: res.status,
          url: healthUrl,
          body: bodyText.slice(0, 300),
        };
      } catch (err) {
        return {
          reachable: false,
          status: 0,
          url: healthUrl,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    };

    if (action === "health_check") {
      const health = await checkVpsHealth();
      return {
        ok: health.reachable,
        action: "health_check",
        host,
        server_port: serverPort,
        health,
      };
    }

    if (!privateKeyPath) {
      const claim = services.remoteClaimService
        ? await services.remoteClaimService.createRemoteClaim(serverName).catch(() => null)
        : null;
      const health = await checkVpsHealth();
      return {
        ok: false,
        requires_manual_ssh_or_key: true,
        diagnostico:
          "Para executar instalação remota automática a partir deste computador, informe `private_key_path` (caminho da chave SSH sem senha interativa) ou execute o comando abaixo diretamente na VPS via SSH/console do provedor.",
        command_bash: claim?.command_bash ?? null,
        claim_id: claim?.claim_id ?? null,
        health,
      };
    }

    if (!existsSync(privateKeyPath)) {
      return {
        ok: false,
        error: `Arquivo de chave privada SSH não encontrado em '${privateKeyPath}'.`,
      };
    }

    let commandToRun = "";
    let claimSecret = readStringArg(args, "claim_secret")?.trim() || "";
    let claimId: string | null = null;
    if (services.remoteClaimService) {
      const ticket = await services.remoteClaimService.createRemoteClaim(serverName);
      claimId = ticket.claim_id;
      if (claimSecret) {
        commandToRun = ticket.command_bash.replace(/CRIATIVO_CLAIM=[^; ]+/, `CRIATIVO_CLAIM=${claimSecret}`);
      } else {
        commandToRun = ticket.command_bash;
      }
    } else if (claimSecret) {
      commandToRun = `{ echo CRIATIVO_CLAIM=${claimSecret}; curl -fsSL https://painel.criativoaistudio.com.br/api/releases/install-server.sh; } | sudo bash -s -- --name "${serverName.replace(/[^a-zA-Z0-9 _.-]/g, "") || "Servidor VPS"}"`;
    } else {
      throw new Error("RemoteClaimService indisponível e nenhum claim_secret informado.");
    }

    const execFileAsync = promisify(execFile);
    const sshArgs = [
      "-i",
      privateKeyPath,
      "-p",
      String(sshPort),
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "-o",
      "StrictHostKeyChecking=accept-new",
      `${username}@${host}`,
      commandToRun,
    ];

    try {
      const { stdout, stderr } = await execFileAsync("ssh", sshArgs, {
        timeout: 180_000,
        windowsHide: true,
      });
      const health = await checkVpsHealth();
      return {
        ok: true,
        action: "install",
        host,
        claim_id: claimId,
        health,
        stdout_tail: String(stdout || "").slice(-1500),
        stderr_tail: String(stderr || "").slice(-800),
      };
    } catch (err) {
      const e = err as { message?: string; stdout?: string; stderr?: string };
      return {
        ok: false,
        action: "install",
        host,
        claim_id: claimId,
        error: e?.message || String(err),
        diagnostico:
          "Falha ao executar SSH não-interativo. Verifique IP, usuário, porta, permissões da chave SSH ou execute o comando diretamente na VPS.",
        command_bash: commandToRun,
        stdout_tail: String(e?.stdout || "").slice(-1000),
        stderr_tail: String(e?.stderr || "").slice(-1000),
      };
    }
  }

  throw new Error(`Ferramenta da Fase 15 desconhecida: ${toolName}`);
}

export async function executePhase15ChatTool(params: {
  toolName: string;
  args: Record<string, unknown>;
  agenteId: string;
  canalId: string;
  deps: Phase15ToolServices;
  aprovadoPorHumano?: boolean;
}): Promise<unknown> {
  return await executePhase15ToolCall(
    params.toolName,
    params.args,
    {
      agenteId: params.agenteId,
      canalId: params.canalId,
      aprovadoPorHumano: params.aprovadoPorHumano,
    },
    params.deps,
  );
}
