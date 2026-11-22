import type { CuaActionRequest, CuaActionType } from "@criativo/contracts";
import { CuaSecurityError } from "../../engine/tools/cua-driver-client.ts";
import { TemplateValidationError } from "../../marketplace/agent-template-publisher.ts";
import { ProcessControlError } from "../resource-monitor.ts";
import { ThemeValidationError } from "../../themes/theme-palette-files.ts";
import type { StudioRouteContext } from "./route-helpers.ts";

export async function tryHandlePhase37EcosystemRoutes(
  ctx: StudioRouteContext,
): Promise<boolean> {
  const { req, res, path, method, url, deps } = ctx;
  const {
    sendJson,
    readJsonBody,
    cuaClient,
    themePaletteFiles,
    agentTemplatePublisher,
    resourceMonitor,
  } = deps;

  // =========================================================================
  // 1. Computer Use Nativo — CUA Driver (G-21)
  // =========================================================================

  if (method === "GET" && path === "/api/cua/status") {
    if (!cuaClient) {
      sendJson(res, 503, { erro: "CuaDriverClient não inicializado." });
      return true;
    }
    sendJson(res, 200, cuaClient.getStatus());
    return true;
  }

  if (method === "POST" && path === "/api/cua/abort") {
    if (!cuaClient) {
      sendJson(res, 503, { erro: "CuaDriverClient não inicializado." });
      return true;
    }
    const body = (await readJsonBody(req).catch(() => ({}))) as Record<string, unknown>;
    const reason =
      typeof body.reason === "string" && body.reason.trim()
        ? body.reason.trim()
        : "Parada de emergência acionada pelo usuário.";
    sendJson(res, 200, { ok: true, status: cuaClient.abortAllCuaActions(reason) });
    return true;
  }

  if (method === "POST" && path === "/api/cua/reset-abort") {
    if (!cuaClient) {
      sendJson(res, 503, { erro: "CuaDriverClient não inicializado." });
      return true;
    }
    sendJson(res, 200, { ok: true, status: cuaClient.clearAbort() });
    return true;
  }

  if (method === "POST" && path === "/api/cua/register-bridge") {
    if (!cuaClient) {
      sendJson(res, 503, { erro: "CuaDriverClient não inicializado." });
      return true;
    }
    const body = await readJsonBody(req);
    const bridgeUrl = typeof body.bridgeUrl === "string" ? body.bridgeUrl.trim() : null;
    const bridgeToken = typeof body.bridgeToken === "string" ? body.bridgeToken.trim() : null;
    if (bridgeUrl && !/^http:\/\/(127\.0\.0\.1|localhost):\d+/.test(bridgeUrl)) {
      sendJson(res, 400, { erro: "bridgeUrl CUA deve apontar apenas para loopback local." });
      return true;
    }
    cuaClient.configureDesktopBridge(bridgeUrl, bridgeToken);
    if (typeof body.permissionGranted === "boolean") {
      cuaClient.setPermissionGranted(body.permissionGranted);
    }
    sendJson(res, 200, { ok: true, status: cuaClient.getStatus() });
    return true;
  }

  if (method === "POST" && path === "/api/cua/execute") {
    if (!cuaClient) {
      sendJson(res, 503, { erro: "CuaDriverClient não inicializado." });
      return true;
    }
    try {
      const body = await readJsonBody(req);
      const reqPayload: CuaActionRequest = {
        action: String(body.action ?? "") as CuaActionType,
        agente_id: String(body.agente_id ?? "").trim(),
        x: typeof body.x === "number" ? body.x : undefined,
        y: typeof body.y === "number" ? body.y : undefined,
        text: typeof body.text === "string" ? body.text : undefined,
        keys: Array.isArray(body.keys) ? body.keys.map((k) => String(k)) : undefined,
        delta_x: typeof body.delta_x === "number" ? body.delta_x : undefined,
        delta_y: typeof body.delta_y === "number" ? body.delta_y : undefined,
        window_title: typeof body.window_title === "string" ? body.window_title : undefined,
        aprovado_por_humano: Boolean(body.aprovado_por_humano),
      };
      const result = await cuaClient.executeAction(reqPayload);
      sendJson(res, 200, result);
    } catch (err) {
      if (err instanceof CuaSecurityError) {
        sendJson(res, err.statusCode, { ok: false, erro: err.message });
        return true;
      }
      sendJson(res, 500, {
        ok: false,
        erro: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  // =========================================================================
  // 2. Temas Externos JSON com Hot-Reload (G-22)
  // =========================================================================

  if (method === "GET" && path === "/api/themes") {
    if (!themePaletteFiles) {
      sendJson(res, 503, { erro: "ThemePaletteFilesService não inicializado." });
      return true;
    }
    sendJson(res, 200, {
      themes: themePaletteFiles.listThemes(),
      themes_dir: themePaletteFiles.getThemesDir(),
    });
    return true;
  }

  if (method === "POST" && path === "/api/themes/reload") {
    if (!themePaletteFiles) {
      sendJson(res, 503, { erro: "ThemePaletteFilesService não inicializado." });
      return true;
    }
    sendJson(res, 200, {
      ok: true,
      themes: themePaletteFiles.reloadFromDisk(null, true),
    });
    return true;
  }

  if (method === "POST" && path === "/api/themes/import") {
    if (!themePaletteFiles) {
      sendJson(res, 503, { erro: "ThemePaletteFilesService não inicializado." });
      return true;
    }
    try {
      const body = await readJsonBody(req);
      const rawTheme =
        typeof body.themeJson === "string"
          ? body.themeJson
          : body.theme && typeof body.theme === "object"
            ? (body.theme as Record<string, unknown>)
            : body;
      const saved = themePaletteFiles.importThemeJson(rawTheme);
      sendJson(res, 200, {
        ok: true,
        theme: saved,
        themes: themePaletteFiles.listThemes(),
      });
    } catch (err) {
      const status = err instanceof ThemeValidationError ? 400 : 400;
      sendJson(res, status, {
        ok: false,
        erro: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  // =========================================================================
  // 3. Templates Versionados de Agentes com SHA-256 (G-23)
  // =========================================================================

  const exportMatch = path.match(/^\/api\/templates\/export\/([^/]+)$/);
  if (method === "GET" && exportMatch) {
    if (!agentTemplatePublisher) {
      sendJson(res, 503, { erro: "AgentTemplatePublisher não inicializado." });
      return true;
    }
    try {
      const agenteId = decodeURIComponent(exportMatch[1]!);
      const version = url.searchParams.get("version") ?? "1.0.0";
      const authorDisplay = url.searchParams.get("author") ?? undefined;
      const description = url.searchParams.get("description") ?? undefined;
      const pkg = agentTemplatePublisher.exportAgentTemplate({
        agenteId,
        version,
        authorDisplay,
        description,
      });
      sendJson(res, 200, { ok: true, package: pkg });
    } catch (err) {
      const status = err instanceof TemplateValidationError ? err.statusCode : 400;
      sendJson(res, status, { ok: false, erro: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (method === "POST" && path === "/api/templates/install") {
    if (!agentTemplatePublisher) {
      sendJson(res, 503, { erro: "AgentTemplatePublisher não inicializado." });
      return true;
    }
    try {
      const body = await readJsonBody(req);
      const agenteIdOverride =
        typeof body.agenteId === "string" && body.agenteId.trim()
          ? body.agenteId.trim()
          : undefined;
      if (typeof body.sourceUrl === "string" && body.sourceUrl.trim()) {
        const installed = await agentTemplatePublisher.installFromUrl(
          body.sourceUrl.trim(),
          agenteIdOverride,
        );
        sendJson(res, 200, { ok: true, installed });
        return true;
      }
      const pkg = body.package ?? body;
      const installed = agentTemplatePublisher.installTemplatePackage({
        pkg,
        agenteIdOverride,
      });
      sendJson(res, 200, { ok: true, installed });
    } catch (err) {
      const status = err instanceof TemplateValidationError ? err.statusCode : 400;
      sendJson(res, status, { ok: false, erro: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  // =========================================================================
  // 4. Monitor de Recursos do Host & Processos em Background (G-24)
  // =========================================================================

  if (method === "GET" && path === "/api/system/resources") {
    if (!resourceMonitor) {
      sendJson(res, 503, { erro: "HostResourceMonitorService não inicializado." });
      return true;
    }
    sendJson(res, 200, resourceMonitor.getSnapshot());
    return true;
  }

  const killProcMatch = path.match(/^\/api\/system\/processes\/(\d+)\/kill$/);
  if (method === "POST" && killProcMatch) {
    if (!resourceMonitor) {
      sendJson(res, 503, { erro: "HostResourceMonitorService não inicializado." });
      return true;
    }
    try {
      const pid = Number(killProcMatch[1]);
      const result = resourceMonitor.killTrackedProcess(pid);
      sendJson(res, 200, result);
    } catch (err) {
      const status = err instanceof ProcessControlError ? err.statusCode : 400;
      sendJson(res, status, { ok: false, erro: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  return false;
}
