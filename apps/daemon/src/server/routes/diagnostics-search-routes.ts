import {
  getCriativoErrorByCode,
  listCriativoErrorCatalog,
} from "@criativo/contracts";
import { HistorySearchService } from "../../engine/runner/history-search-service.ts";
import { redactSensitiveText } from "../structured-logger.ts";
import type { StudioRouteContext } from "./route-helpers.ts";

/**
 * Rotas de Diagnóstico (`CRV-*`, logs estruturados redigidos) e Busca Global (Fase 31).
 */
export async function tryHandleDiagnosticsSearchRoutes(
  ctx: StudioRouteContext
): Promise<boolean> {
  const { res, path, method, url, deps, db } = ctx;
  const { sendJson } = deps;

  if (path === "/api/busca-global" && method === "GET") {
    const q = url.searchParams.get("q") ?? "";
    const limit = Number(url.searchParams.get("limit") ?? "5");
    const svc =
      deps.historySearch ??
      new HistorySearchService({
        db,
        redactSecrets: (txt) => redactSensitiveText(txt),
      });
    const out = svc.searchGlobalStudio(q, limit);
    sendJson(res, 200, { ok: true, ...out });
    return true;
  }

  if (path === "/api/diagnostico/erros-catalogo" && method === "GET") {
    const code = url.searchParams.get("code")?.trim();
    if (code) {
      const item = getCriativoErrorByCode(code);
      if (!item) {
        sendJson(res, 404, {
          ok: false,
          erro: `Código de erro '${code}' não encontrado no catálogo.`,
        });
        return true;
      }
      sendJson(res, 200, { ok: true, erro_catalogo: item, erros: [item] });
      return true;
    }
    sendJson(res, 200, { ok: true, erros: listCriativoErrorCatalog() });
    return true;
  }

  if (path === "/api/diagnostico/logs" && method === "GET") {
    const levelRaw = url.searchParams.get("level")?.trim();
    const level =
      levelRaw === "info" || levelRaw === "warn" || levelRaw === "error"
        ? levelRaw
        : undefined;
    const code = url.searchParams.get("code")?.trim() || undefined;
    const domain = url.searchParams.get("domain")?.trim() || undefined;
    const limit = Number(url.searchParams.get("limit") ?? "100");
    const logs = deps.structuredLogger
      ? deps.structuredLogger.queryRecentLogs({ level, code, domain, limit })
      : [];
    sendJson(res, 200, {
      ok: true,
      redigido: true,
      arquivo: deps.structuredLogger?.filePath ?? null,
      logs,
    });
    return true;
  }

  return false;
}
