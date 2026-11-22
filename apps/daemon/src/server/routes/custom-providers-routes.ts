import type { StudioRouteContext } from "./route-helpers.ts";

/**
 * Rotas HTTP da Fase 33 (G-08): Provedores OpenAI-Compatíveis Custom e Detecção Local.
 */
export async function tryHandleCustomProvidersRoutes(ctx: StudioRouteContext): Promise<boolean> {
  const { req, res, path, method, url, deps } = ctx;
  const { sendJson, readJsonBody, customEndpoints, localProviderDetector } = deps;

  if (path === "/api/providers/custom" && method === "GET") {
    if (!customEndpoints) {
      sendJson(res, 200, { ok: true, endpoints: [] });
      return true;
    }
    sendJson(res, 200, { ok: true, endpoints: customEndpoints.listEndpoints() });
    return true;
  }

  if (path === "/api/providers/custom" && method === "POST") {
    if (!customEndpoints) {
      sendJson(res, 503, { ok: false, erro: "Serviço de endpoints customizados indisponível." });
      return true;
    }
    const body = await readJsonBody(req);
    const rawModels = Array.isArray(body.models)
      ? body.models.filter((m): m is string => typeof m === "string")
      : typeof body.models === "string"
        ? body.models.split(",").map((s) => s.trim()).filter(Boolean)
        : [];

    try {
      const endpoint = customEndpoints.upsertEndpoint({
        id: typeof body.id === "string" ? body.id : undefined,
        name: String(body.name ?? ""),
        baseUrl: String(body.baseUrl ?? body.base_url ?? ""),
        models: rawModels,
        apiKey: typeof body.apiKey === "string" ? body.apiKey : typeof body.api_key === "string" ? body.api_key : undefined,
        enabled: body.enabled !== false,
        headers:
          body.headers && typeof body.headers === "object"
            ? (body.headers as Record<string, string>)
            : undefined,
      });
      sendJson(res, 200, { ok: true, endpoint });
    } catch (err) {
      sendJson(res, 400, {
        ok: false,
        erro: err instanceof Error ? err.message : "Dados inválidos para provedor customizado.",
      });
    }
    return true;
  }

  const customTestMatch = path.match(/^\/api\/providers\/custom\/([^/]+)\/test$/);
  if (customTestMatch && method === "POST") {
    if (!customEndpoints) {
      sendJson(res, 503, { ok: false, erro: "Serviço de endpoints customizados indisponível." });
      return true;
    }
    const id = decodeURIComponent(customTestMatch[1]);
    const result = await customEndpoints.testEndpoint(id);
    sendJson(res, result.ok ? 200 : 400, result);
    return true;
  }

  const customDelMatch = path.match(/^\/api\/providers\/custom\/([^/]+)$/);
  if (customDelMatch && method === "DELETE") {
    if (!customEndpoints) {
      sendJson(res, 503, { ok: false, erro: "Serviço de endpoints customizados indisponível." });
      return true;
    }
    const id = decodeURIComponent(customDelMatch[1]);
    const removed = customEndpoints.deleteEndpoint(id);
    if (!removed) {
      sendJson(res, 404, { ok: false, erro: `Provedor '${id}' não encontrado.` });
      return true;
    }
    sendJson(res, 200, { ok: true, id });
    return true;
  }

  if (path === "/api/providers/local/detect" && method === "GET") {
    if (!localProviderDetector) {
      sendJson(res, 200, { ok: true, providers: [] });
      return true;
    }
    const refresh = url.searchParams.get("refresh") === "1" || url.searchParams.get("refresh") === "true";
    const providers = await localProviderDetector.detect(refresh);
    sendJson(res, 200, { ok: true, providers });
    return true;
  }

  if (path === "/api/workflows/media-providers" && method === "GET") {
    const providers = deps.mediaCatalog ? deps.mediaCatalog.listProviders() : [];
    sendJson(res, 200, { ok: true, providers });
    return true;
  }

  return false;
}
