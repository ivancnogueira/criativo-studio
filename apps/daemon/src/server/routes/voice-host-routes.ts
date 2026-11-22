import type { VoiceExecutionMode } from "@criativo/contracts";
import type { StudioRouteContext } from "./route-helpers.ts";

export async function tryHandleVoiceHostRoutes(ctx: StudioRouteContext): Promise<boolean> {
  const { req, res, path, method, deps } = ctx;
  const { sendJson, readJsonBody, voiceHostService } = deps;

  if (!path.startsWith("/api/voice/")) {
    return false;
  }
  if (!voiceHostService) {
    sendJson(res, 503, { erro: "VoiceHostService não inicializado." });
    return true;
  }

  if (method === "GET" && path === "/api/voice/status") {
    sendJson(res, 200, voiceHostService.getStatus());
    return true;
  }

  if (method === "POST" && path === "/api/voice/mode") {
    const body = await readJsonBody(req);
    const rawMode = String(body.mode ?? "auto");
    const mode: VoiceExecutionMode =
      rawMode === "local" || rawMode === "cloud" ? rawMode : "auto";
    const status = voiceHostService.updateSettings({
      mode,
      activeSttModel:
        typeof body.activeSttModel === "string" ? body.activeSttModel : undefined,
      activeTtsVoice:
        typeof body.activeTtsVoice === "string" ? body.activeTtsVoice : undefined,
    });
    sendJson(res, 200, { ok: true, status });
    return true;
  }

  if (method === "GET" && path === "/api/voice/models") {
    sendJson(res, 200, { models: voiceHostService.listModels() });
    return true;
  }

  if (method === "POST" && path === "/api/voice/models/install") {
    try {
      const body = await readJsonBody(req);
      const modelId = String(body.modelId ?? "").trim();
      const models = voiceHostService.installLocalModel(modelId);
      sendJson(res, 200, { ok: true, models });
    } catch (err) {
      sendJson(res, 400, { erro: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  const removeMatch = path.match(/^\/api\/voice\/models\/([^/]+)$/);
  if (method === "DELETE" && removeMatch) {
    const modelId = decodeURIComponent(removeMatch[1]!);
    const models = voiceHostService.removeLocalModel(modelId);
    sendJson(res, 200, { ok: true, models });
    return true;
  }

  return false;
}
