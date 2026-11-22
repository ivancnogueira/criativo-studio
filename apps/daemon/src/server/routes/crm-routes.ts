import type { CrmStage } from "@criativo/contracts";
import type { StudioRouteContext } from "./route-helpers.ts";

export async function tryHandleCrmRoutes(ctx: StudioRouteContext): Promise<boolean> {
  const { req, res, path, method, url, deps } = ctx;
  const { sendJson, readJsonBody, crmService, teamService } = deps;

  if (!path.startsWith("/api/crm/")) {
    return false;
  }
  if (!crmService) {
    sendJson(res, 503, { erro: "CrmService não inicializado." });
    return true;
  }

  if (method === "GET" && path === "/api/crm/status") {
    sendJson(res, 200, { enabled: crmService.isEnabled() });
    return true;
  }

  if (method === "POST" && path === "/api/crm/toggle") {
    const body = await readJsonBody(req);
    const enabled = crmService.setEnabled(Boolean(body.enabled));
    teamService?.audit.record({
      actorLabel: "owner",
      action: "crm.module.toggled",
      resourceType: "crm",
      detail: { enabled },
    });
    sendJson(res, 200, { ok: true, enabled });
    return true;
  }

  if (method === "GET" && path === "/api/crm/contacts") {
    const q = url.searchParams.get("q") ?? undefined;
    sendJson(res, 200, {
      enabled: crmService.isEnabled(),
      contacts: crmService.listContacts(q),
    });
    return true;
  }

  if (method === "POST" && path === "/api/crm/contacts") {
    const body = await readJsonBody(req);
    const name = String(body.name ?? "").trim();
    if (!name) {
      sendJson(res, 400, { erro: "Informe o nome do contato." });
      return true;
    }
    const contact = crmService.createContact({
      name,
      email: typeof body.email === "string" ? body.email : null,
      phone: typeof body.phone === "string" ? body.phone : null,
      company: typeof body.company === "string" ? body.company : null,
      stage: (typeof body.stage === "string" ? body.stage : "lead") as CrmStage,
      tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
      ownerAgentId: typeof body.ownerAgentId === "string" ? body.ownerAgentId : null,
      sourceChannel: typeof body.sourceChannel === "string" ? body.sourceChannel : null,
      notes: typeof body.notes === "string" ? body.notes : "",
    });
    sendJson(res, 201, { ok: true, contact });
    return true;
  }

  const contactPatchMatch = path.match(/^\/api\/crm\/contacts\/([^/]+)$/);
  if (method === "PATCH" && contactPatchMatch) {
    const contactId = decodeURIComponent(contactPatchMatch[1]!);
    const body = await readJsonBody(req);
    const updated = crmService.updateContact(contactId, {
      name: typeof body.name === "string" ? body.name : undefined,
      email: body.email === null || typeof body.email === "string" ? body.email : undefined,
      phone: body.phone === null || typeof body.phone === "string" ? body.phone : undefined,
      company: body.company === null || typeof body.company === "string" ? body.company : undefined,
      stage: typeof body.stage === "string" ? (body.stage as CrmStage) : undefined,
      tags: Array.isArray(body.tags) ? body.tags.map(String) : undefined,
      notes: typeof body.notes === "string" ? body.notes : undefined,
    });
    sendJson(res, updated ? 200 : 404, { ok: Boolean(updated), contact: updated });
    return true;
  }

  if (method === "GET" && path === "/api/crm/activities") {
    const contactId = url.searchParams.get("contactId") ?? undefined;
    sendJson(res, 200, { activities: crmService.listActivities(contactId) });
    return true;
  }

  if (method === "POST" && path === "/api/crm/activities") {
    const body = await readJsonBody(req);
    const contactId = String(body.contactId ?? "").trim();
    const summary = String(body.summary ?? "").trim();
    if (!contactId || !summary) {
      sendJson(res, 400, { erro: "Informe contactId e summary." });
      return true;
    }
    const activity = crmService.addActivity({
      contactId,
      channel: typeof body.channel === "string" ? body.channel : "manual",
      summary,
      author: typeof body.author === "string" ? body.author : "operador",
    });
    sendJson(res, 201, { ok: true, activity });
    return true;
  }

  if (method === "GET" && path === "/api/crm/proposals") {
    const status = url.searchParams.get("status") as "pending" | "approved" | "rejected" | null;
    sendJson(res, 200, { proposals: crmService.listProposals(status ?? undefined) });
    return true;
  }

  const propActionMatch = path.match(/^\/api\/crm\/proposals\/([^/]+)\/(approve|reject)$/);
  if (method === "POST" && propActionMatch) {
    try {
      const proposalId = decodeURIComponent(propActionMatch[1]!);
      const approved = propActionMatch[2] === "approve";
      const body = await readJsonBody(req);
      const out = crmService.decideProposal({
        proposalId,
        approved,
        decidedBy: typeof body.decidedBy === "string" ? body.decidedBy : "operador",
        editedDiff:
          body.editedDiff && typeof body.editedDiff === "object"
            ? (body.editedDiff as Record<string, unknown>)
            : undefined,
      });
      teamService?.audit.record({
        actorLabel: typeof body.decidedBy === "string" ? body.decidedBy : "operador",
        action: approved ? "crm.proposal.approved" : "crm.proposal.rejected",
        resourceType: "crm_proposal",
        resourceId: proposalId,
      });
      sendJson(res, 200, { ok: true, ...out });
    } catch (err) {
      sendJson(res, 400, { erro: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  return false;
}
