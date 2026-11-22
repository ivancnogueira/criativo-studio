import { LicenseValidationError, type LicenseClientService } from "../../license/license-service.ts";
import type { AutoUpdateService } from "../../updater/auto-update-service.ts";
import {
  activateUpgradePackage,
  computeUnlockedAgentsSummary,
  evaluateAndSyncSetupCompletion,
  getBrandIdentity,
  hasConfiguredBrand,
  importBrandPdfFromBuffer,
  interpolateBrandPlaceholders,
  isSetupAssistantVisible,
  isVpsAssistantVisible,
  listUpgradePackages,
  saveBrandIdentity,
  setSetupAssistantState,
  setVpsAssistantState,
  syncBrandPlaceholdersInDatabase,
} from "../brand-onboarding-service.ts";
import type { StudioRouteContext } from "./route-helpers.ts";

export async function tryHandleLicenseAndUpdatesRoutes(ctx: StudioRouteContext): Promise<boolean> {
  const { req, res, path, method, url, deps, db, wsHub, workspaceRoot } = ctx;
  const { sendJson, readJsonBody } = deps;

  // 0. Licenciamento Comercial (Fase 16)
  if (method === "GET" && path === "/api/studio/license/status") {
    if (!deps.licenseService) {
      sendJson(res, 503, { erro: "Serviço de licenciamento não inicializado." });
      return true;
    }
    const unlockedSummary = computeUnlockedAgentsSummary(db, workspaceRoot, deps.licenseService);
    sendJson(res, 200, {
      license: {
        ...deps.licenseService.getStatus(),
        unlocked_agents_count: unlockedSummary.unlocked_agents_count,
      },
    });
    return true;
  }

  if (method === "POST" && path === "/api/studio/license/activate") {
    if (!deps.licenseService) {
      sendJson(res, 503, { erro: "Serviço de licenciamento não inicializado." });
      return true;
    }
    const body = await readJsonBody(req);
    try {
      const license = await deps.licenseService.activate({
        license_key: String(body.license_key ?? ""),
        email: String(body.email ?? ""),
      });
      sendJson(res, 200, { ok: true, license });
    } catch (err) {
      if (err instanceof LicenseValidationError) {
        sendJson(res, err.statusCode, {
          erro: err.message,
          code: err.code,
          ...(err.details ?? {}),
        });
        return true;
      }
      throw err;
    }
    return true;
  }

  if (method === "POST" && path === "/api/studio/license/heartbeat") {
    if (!deps.licenseService) {
      sendJson(res, 503, { erro: "Serviço de licenciamento não inicializado." });
      return true;
    }
    const license = await deps.licenseService.heartbeat();
    sendJson(res, 200, { ok: license.valid, license });
    return true;
  }

  if (method === "POST" && path === "/api/studio/license/deactivate") {
    if (!deps.licenseService) {
      sendJson(res, 503, { erro: "Serviço de licenciamento não inicializado." });
      return true;
    }
    const body = await readJsonBody(req);
    try {
      const result = await deps.licenseService.deactivateDevice({
        target_machine_id: String(body.target_machine_id ?? ""),
        license_key: typeof body.license_key === "string" ? body.license_key : undefined,
        email: typeof body.email === "string" ? body.email : undefined,
      });
      sendJson(res, 200, result);
    } catch (err) {
      if (err instanceof LicenseValidationError) {
        sendJson(res, err.statusCode, {
          erro: err.message,
          code: err.code,
          ...(err.details ?? {}),
        });
        return true;
      }
      throw err;
    }
    return true;
  }


  // Fase 18 — Auto-Update (Desktop e VPS)
  if (method === "GET" && path === "/api/studio/updates/status") {
    if (!deps.autoUpdateService) {
      sendJson(res, 503, { erro: "AutoUpdateService indisponível." });
      return true;
    }
    sendJson(res, 200, { ok: true, status: deps.autoUpdateService.getStatus() });
    return true;
  }

  if (method === "POST" && path === "/api/studio/updates/check") {
    if (!deps.autoUpdateService) {
      sendJson(res, 503, { erro: "AutoUpdateService indisponível." });
      return true;
    }
    const status = await deps.autoUpdateService.checkForUpdates();
    sendJson(res, 200, { ok: true, status });
    return true;
  }

  if (method === "POST" && path === "/api/studio/updates/apply") {
    if (!deps.autoUpdateService) {
      sendJson(res, 503, { erro: "AutoUpdateService indisponível." });
      return true;
    }
    const body = await readJsonBody(req);
    const status = await deps.autoUpdateService.downloadAndApplyUpdate({
      platform:
        typeof body.platform === "string"
          ? (body.platform as "win32" | "darwin" | "linux" | "vps-tarball")
          : undefined,
      targetProductDir: typeof body.target_product_dir === "string" ? body.target_product_dir : undefined,
      restartAfterApply: body.restart === true,
    });
    sendJson(res, 200, { ok: true, status });
    return true;
  }

  if (method === "POST" && path === "/api/studio/updates/restart") {
    if (!deps.autoUpdateService) {
      sendJson(res, 503, { erro: "AutoUpdateService indisponível." });
      return true;
    }
    const body = await readJsonBody(req).catch(() => ({} as Record<string, unknown>));
    const restartInfo = await deps.autoUpdateService.triggerRestart({
      force: body.force === true,
    });
    sendJson(res, 200, restartInfo);
    return true;
  }

  return false;
}
