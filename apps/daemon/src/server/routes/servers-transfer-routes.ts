import type { InstanceTransferManifest, InstanceTransferScope } from "@criativo/contracts";
import type { TransferChunkPacket } from "../../servers/instance-transfer-chunks.ts";
import type { StudioRouteContext } from "./route-helpers.ts";

export async function tryHandleServersTransferRoutes(
  ctx: StudioRouteContext,
): Promise<boolean> {
  const { req, res, path, method, deps } = ctx;
  const { sendJson, readJsonBody, instanceTransferService, teamService } = deps;

  if (!path.startsWith("/api/transfer/")) {
    return false;
  }
  if (!instanceTransferService) {
    sendJson(res, 503, { erro: "InstanceTransferService não inicializado." });
    return true;
  }

  if (method === "GET" && path === "/api/transfer/history") {
    sendJson(res, 200, { history: instanceTransferService.listHistory() });
    return true;
  }

  if (method === "POST" && path === "/api/transfer/export") {
    const body = await readJsonBody(req);
    const rawScope = (body.scope ?? {}) as Partial<InstanceTransferScope>;
    const scope: InstanceTransferScope = {
      agents: rawScope.agents !== false,
      memories: rawScope.memories !== false,
      workflows: rawScope.workflows !== false,
      routines: rawScope.routines !== false,
      library: rawScope.library !== false,
      preferences: rawScope.preferences !== false,
    };
    const chunkSizeBytes =
      typeof body.chunkSizeBytes === "number" ? body.chunkSizeBytes : undefined;
    const exported = instanceTransferService.exportToChunks({
      scope,
      sourceServerName:
        typeof body.sourceServerName === "string" ? body.sourceServerName : undefined,
      chunkSizeBytes,
    });
    teamService?.audit.record({
      actorLabel: "owner",
      action: "instance.transfer.exported",
      resourceType: "instance_transfer",
      resourceId: exported.manifest.jobId,
      detail: { counts: exported.manifest.counts, chunks: exported.chunks.length },
    });
    sendJson(res, 200, { ok: true, ...exported });
    return true;
  }

  if (method === "POST" && path === "/api/transfer/import/begin") {
    const body = await readJsonBody(req);
    const manifest = body.manifest as InstanceTransferManifest | undefined;
    if (!manifest || !manifest.jobId || !manifest.payloadSha256) {
      sendJson(res, 400, { erro: "Manifesto inválido para iniciar transferência." });
      return true;
    }
    const job = instanceTransferService.beginImportJob(manifest);
    sendJson(res, 200, { ok: true, job });
    return true;
  }

  const chunkMatch = path.match(/^\/api\/transfer\/chunks\/([^/]+)$/);
  if (method === "POST" && chunkMatch) {
    try {
      const jobId = decodeURIComponent(chunkMatch[1]!);
      const body = await readJsonBody(req);
      const out = instanceTransferService.receiveChunk(jobId, body as unknown as TransferChunkPacket);
      sendJson(res, 200, { ok: true, ...out });
    } catch (err) {
      sendJson(res, 400, { erro: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (method === "POST" && path === "/api/transfer/commit") {
    try {
      const body = await readJsonBody(req);
      const jobId = String(body.jobId ?? "").trim();
      if (!jobId) {
        sendJson(res, 400, { erro: "Informe jobId para finalizar importação." });
        return true;
      }
      const out = instanceTransferService.commitImport(jobId);
      teamService?.audit.record({
        actorLabel: "owner",
        action: "instance.transfer.imported",
        resourceType: "instance_transfer",
        resourceId: jobId,
        detail: out.importedCounts,
      });
      sendJson(res, 200, out);
    } catch (err) {
      sendJson(res, 400, { erro: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  return false;
}
