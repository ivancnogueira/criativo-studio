import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { buildCuaDaemonHeaders } from "../../desktop/src/cua-auth-headers.ts";
import { CrmService } from "../src/crm/crm-service.ts";
import { createDaemonServer, type DaemonRuntime } from "../src/server/daemon-server.ts";
import { TeamService } from "../src/team/team-service.ts";

describe("Fase 38 — Débitos de Auditoria Backend (RBAC /api/transfer/* & /api/crm/* e Bearer CUA)", () => {
  let tempDir = "";
  let rbacRuntime: DaemonRuntime | null = null;
  let cuaRuntime: DaemonRuntime | null = null;
  let baseUrl = "";
  let cuaBaseUrl = "";
  let teamSvc: TeamService;
  let crmSvc: CrmService;

  let viewerToken = "";
  let editorToken = "";
  let adminToken = "";
  let editorMemberId = "";
  let editorDisplayName = "Editor Conteudo Sintetico";
  let adminMemberId = "";
  let adminDisplayName = "Admin Operacao Sintetico";

  before(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "criativo-phase38-"));

    rbacRuntime = await createDaemonServer({
      port: 0,
      host: "127.0.0.1",
      dbPath: join(tempDir, "phase38-rbac.db"),
      workspaceRoot: tempDir,
      autoStartLoops: false,
      autoBootWhatsApp: false,
      controlSocketPath: null,
      bypassLicenseForTests: true,
    });
    baseUrl = `http://127.0.0.1:${rbacRuntime.port}`;

    teamSvc = new TeamService(rbacRuntime.db);
    crmSvc = new CrmService(rbacRuntime.db);

    const invViewer = teamSvc.createInvite({ email: "viewer@exemplo.invalid", role: "viewer" });
    const accViewer = teamSvc.acceptInvite({
      inviteToken: invViewer.inviteToken,
      displayName: "Analista Viewer Sintetico",
    });
    viewerToken = accViewer.memberToken;

    const invEditor = teamSvc.createInvite({ email: "editor@exemplo.invalid", role: "editor" });
    const accEditor = teamSvc.acceptInvite({
      inviteToken: invEditor.inviteToken,
      displayName: editorDisplayName,
    });
    editorToken = accEditor.memberToken;
    editorMemberId = accEditor.member.memberId;

    const invAdmin = teamSvc.createInvite({ email: "admin@exemplo.invalid", role: "admin" });
    const accAdmin = teamSvc.acceptInvite({
      inviteToken: invAdmin.inviteToken,
      displayName: adminDisplayName,
    });
    adminToken = accAdmin.memberToken;
    adminMemberId = accAdmin.member.memberId;

    cuaRuntime = await createDaemonServer({
      port: 0,
      host: "127.0.0.1",
      dbPath: join(tempDir, "phase38-cua.db"),
      workspaceRoot: tempDir,
      autoStartLoops: false,
      autoBootWhatsApp: false,
      controlSocketPath: null,
      bypassLicenseForTests: true,
      accessToken: "cua-secret-token-38",
    });
    cuaBaseUrl = `http://127.0.0.1:${cuaRuntime.port}`;
  });

  after(async () => {
    await rbacRuntime?.close().catch(() => {});
    await cuaRuntime?.close().catch(() => {});
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 80 });
      } catch {
        // ignora lock residual no Windows
      }
    }
  });

  it("1. (AUDIT38-01) aplica RBAC fail-closed em /api/transfer/*, grava ator real na auditoria e preserva single_user", async () => {
    const invalidRes = await fetch(`${baseUrl}/api/transfer/history`, {
      headers: { "X-Criativo-Member-Token": "token-invalido-38" },
    });
    assert.equal(invalidRes.status, 401);

    const viewerHist = await fetch(`${baseUrl}/api/transfer/history`, {
      headers: { "X-Criativo-Member-Token": viewerToken },
    });
    assert.equal(viewerHist.status, 200);

    const viewerExport = await fetch(`${baseUrl}/api/transfer/export`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Criativo-Member-Token": viewerToken,
      },
      body: JSON.stringify({ scope: { agents: true } }),
    });
    assert.equal(viewerExport.status, 403);

    const editorHeaders = {
      "Content-Type": "application/json",
      "X-Criativo-Member-Token": editorToken,
    };

    const editorExport = await fetch(`${baseUrl}/api/transfer/export`, {
      method: "POST",
      headers: editorHeaders,
      body: JSON.stringify({ scope: { agents: true } }),
    });
    assert.equal(editorExport.status, 403);

    const editorBegin = await fetch(`${baseUrl}/api/transfer/import/begin`, {
      method: "POST",
      headers: editorHeaders,
      body: JSON.stringify({ manifest: { jobId: "job_x", payloadSha256: "a".repeat(64) } }),
    });
    assert.equal(editorBegin.status, 403);

    const editorChunk = await fetch(`${baseUrl}/api/transfer/chunks/job_x`, {
      method: "POST",
      headers: editorHeaders,
      body: JSON.stringify({ index: 0, totalChunks: 1, chunkSha256: "a".repeat(64), dataBase64: "" }),
    });
    assert.equal(editorChunk.status, 403);

    const editorCommit = await fetch(`${baseUrl}/api/transfer/commit`, {
      method: "POST",
      headers: editorHeaders,
      body: JSON.stringify({ jobId: "job_x" }),
    });
    assert.equal(editorCommit.status, 403);

    const adminExport = await fetch(`${baseUrl}/api/transfer/export`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Criativo-Member-Token": adminToken,
      },
      body: JSON.stringify({ scope: { agents: true } }),
    });
    assert.equal(adminExport.status, 200);
    const exportJson = (await adminExport.json()) as {
      ok: boolean;
      manifest?: { jobId: string };
      chunks?: unknown[];
    };
    assert.equal(exportJson.ok, true);
    assert.ok(exportJson.manifest?.jobId);
    assert.ok(Array.isArray(exportJson.chunks) && exportJson.chunks.length >= 1);

    const auditLogs = teamSvc.audit.list({ action: "instance.transfer.exported", limit: 10 });
    const adminEntry = auditLogs.find((entry) => entry.resourceId === exportJson.manifest?.jobId);
    assert.ok(adminEntry);
    assert.equal(adminEntry.actorMemberId, adminMemberId);
    assert.equal(adminEntry.actorLabel, adminDisplayName);

    const singleUserExport = await fetch(`${baseUrl}/api/transfer/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: { agents: true } }),
    });
    assert.equal(singleUserExport.status, 200);
    const singleUserJson = (await singleUserExport.json()) as { ok: boolean };
    assert.equal(singleUserJson.ok, true);
  });

  it("2. (AUDIT38-01) aplica RBAC fail-closed em /api/crm/*, bloqueia viewer/editor corretamente e registra ator real", async () => {
    const invalidStatus = await fetch(`${baseUrl}/api/crm/status`, {
      headers: { "X-Criativo-Member-Token": "token-invalido-crm" },
    });
    assert.equal(invalidStatus.status, 401);

    const viewerHeaders = {
      "Content-Type": "application/json",
      "X-Criativo-Member-Token": viewerToken,
    };
    for (const getPath of [
      "/api/crm/status",
      "/api/crm/contacts",
      "/api/crm/activities",
      "/api/crm/proposals",
    ]) {
      const res = await fetch(`${baseUrl}${getPath}`, {
        headers: { "X-Criativo-Member-Token": viewerToken },
      });
      assert.equal(res.status, 200, `viewer deveria ler ${getPath}`);
    }

    const viewerToggle = await fetch(`${baseUrl}/api/crm/toggle`, {
      method: "POST",
      headers: viewerHeaders,
      body: JSON.stringify({ enabled: true }),
    });
    assert.equal(viewerToggle.status, 403);

    const viewerCreate = await fetch(`${baseUrl}/api/crm/contacts`, {
      method: "POST",
      headers: viewerHeaders,
      body: JSON.stringify({ name: "Bloqueado Viewer" }),
    });
    assert.equal(viewerCreate.status, 403);

    const viewerApprove = await fetch(`${baseUrl}/api/crm/proposals/prop_1/approve`, {
      method: "POST",
      headers: viewerHeaders,
      body: "{}",
    });
    assert.equal(viewerApprove.status, 403);

    const editorHeaders = {
      "Content-Type": "application/json",
      "X-Criativo-Member-Token": editorToken,
    };
    const editorToggle = await fetch(`${baseUrl}/api/crm/toggle`, {
      method: "POST",
      headers: editorHeaders,
      body: JSON.stringify({ enabled: true }),
    });
    assert.equal(editorToggle.status, 403);

    const adminToggle = await fetch(`${baseUrl}/api/crm/toggle`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Criativo-Member-Token": adminToken,
      },
      body: JSON.stringify({ enabled: true }),
    });
    assert.equal(adminToggle.status, 200);
    const adminToggleJson = (await adminToggle.json()) as { ok: boolean; enabled: boolean };
    assert.equal(adminToggleJson.ok, true);
    assert.equal(adminToggleJson.enabled, true);

    const toggleAudit = teamSvc.audit.list({ action: "crm.module.toggled", limit: 10 });
    assert.ok(toggleAudit.length >= 1);
    assert.equal(toggleAudit[0]?.actorMemberId, adminMemberId);
    assert.equal(toggleAudit[0]?.actorLabel, adminDisplayName);

    const createContact = await fetch(`${baseUrl}/api/crm/contacts`, {
      method: "POST",
      headers: editorHeaders,
      body: JSON.stringify({
        name: "Contato Sintetico 38",
        email: "contato38@exemplo.invalid",
        stage: "lead",
      }),
    });
    assert.equal(createContact.status, 201);
    const createdJson = (await createContact.json()) as {
      ok: boolean;
      contact: { contactId: string };
    };
    assert.equal(createdJson.ok, true);
    assert.ok(createdJson.contact.contactId);

    const patchContact = await fetch(
      `${baseUrl}/api/crm/contacts/${encodeURIComponent(createdJson.contact.contactId)}`,
      {
        method: "PATCH",
        headers: editorHeaders,
        body: JSON.stringify({ stage: "qualificado" }),
      },
    );
    assert.equal(patchContact.status, 200);

    const addActivity = await fetch(`${baseUrl}/api/crm/activities`, {
      method: "POST",
      headers: editorHeaders,
      body: JSON.stringify({
        contactId: createdJson.contact.contactId,
        summary: "Interacao inicial sintetica",
      }),
    });
    assert.equal(addActivity.status, 201);

    const pendingProp = crmSvc.proposeMutation({
      agenteId: "estrategista",
      operation: "create_contact",
      summary: "Lead teste",
      diff: { name: "Lead Sintetico", stage: "lead" },
    });

    const viewerApprovePending = await fetch(
      `${baseUrl}/api/crm/proposals/${encodeURIComponent(pendingProp.proposalId)}/approve`,
      {
        method: "POST",
        headers: viewerHeaders,
        body: "{}",
      },
    );
    assert.equal(viewerApprovePending.status, 403);

    const editorApprovePending = await fetch(
      `${baseUrl}/api/crm/proposals/${encodeURIComponent(pendingProp.proposalId)}/approve`,
      {
        method: "POST",
        headers: editorHeaders,
        body: "{}",
      },
    );
    assert.equal(editorApprovePending.status, 200);
    const approvedJson = (await editorApprovePending.json()) as {
      ok: boolean;
      proposal: { status: string; decidedBy: string | null };
    };
    assert.equal(approvedJson.ok, true);
    assert.equal(approvedJson.proposal.status, "approved");
    assert.equal(approvedJson.proposal.decidedBy, editorDisplayName);

    const propAudit = teamSvc.audit.list({ action: "crm.proposal.approved", limit: 10 });
    const entry = propAudit.find((item) => item.resourceId === pendingProp.proposalId);
    assert.ok(entry);
    assert.equal(entry.actorMemberId, editorMemberId);
    assert.equal(entry.actorLabel, editorDisplayName);
  });

  it("3. (AUDIT38-01) propaga Authorization Bearer no runtime CUA via token explícito e variável de ambiente", async () => {
    const unauthRegister = await fetch(`${cuaBaseUrl}/api/cua/register-bridge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bridgeUrl: "http://127.0.0.1:49999",
        bridgeToken: "bridge-tok-38",
        permissionGranted: true,
      }),
    });
    assert.equal(unauthRegister.status, 401);

    const unauthAbort = await fetch(`${cuaBaseUrl}/api/cua/abort`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Sem auth" }),
    });
    assert.equal(unauthAbort.status, 401);

    const unauthReset = await fetch(`${cuaBaseUrl}/api/cua/reset-abort`, {
      method: "POST",
    });
    assert.equal(unauthReset.status, 401);

    const explicitHeaders = buildCuaDaemonHeaders("cua-secret-token-38", {
      "Content-Type": "application/json",
    });
    assert.equal(explicitHeaders.Authorization, "Bearer cua-secret-token-38");

    const authRegister = await fetch(`${cuaBaseUrl}/api/cua/register-bridge`, {
      method: "POST",
      headers: explicitHeaders,
      body: JSON.stringify({
        bridgeUrl: "http://127.0.0.1:49999",
        bridgeToken: "bridge-tok-38",
        permissionGranted: true,
      }),
    });
    assert.equal(authRegister.status, 200);
    assert.equal(((await authRegister.json()) as { ok: boolean }).ok, true);

    const authAbort = await fetch(`${cuaBaseUrl}/api/cua/abort`, {
      method: "POST",
      headers: explicitHeaders,
      body: JSON.stringify({ reason: "Teste emergencia token explícito" }),
    });
    assert.equal(authAbort.status, 200);
    const authAbortJson = (await authAbort.json()) as {
      ok: boolean;
      status: { aborted: boolean };
    };
    assert.equal(authAbortJson.ok, true);
    assert.equal(authAbortJson.status.aborted, true);

    const authReset = await fetch(`${cuaBaseUrl}/api/cua/reset-abort`, {
      method: "POST",
      headers: buildCuaDaemonHeaders("cua-secret-token-38"),
    });
    assert.equal(authReset.status, 200);
    const authResetJson = (await authReset.json()) as {
      ok: boolean;
      status: { aborted: boolean };
    };
    assert.equal(authResetJson.ok, true);
    assert.equal(authResetJson.status.aborted, false);

    const prevAccessToken = process.env.CRIATIVO_SERVER_ACCESS_TOKEN;
    try {
      process.env.CRIATIVO_SERVER_ACCESS_TOKEN = "cua-secret-token-38";
      const envHeaders = buildCuaDaemonHeaders(null, { "Content-Type": "application/json" });
      assert.equal(envHeaders.Authorization, "Bearer cua-secret-token-38");

      const envRegister = await fetch(`${cuaBaseUrl}/api/cua/register-bridge`, {
        method: "POST",
        headers: envHeaders,
        body: JSON.stringify({
          bridgeUrl: "http://127.0.0.1:49998",
          bridgeToken: "bridge-tok-env-38",
          permissionGranted: true,
        }),
      });
      assert.equal(envRegister.status, 200);
      assert.equal(((await envRegister.json()) as { ok: boolean }).ok, true);

      const envAbort = await fetch(`${cuaBaseUrl}/api/cua/abort`, {
        method: "POST",
        headers: envHeaders,
        body: JSON.stringify({ reason: "Fallback env var" }),
      });
      assert.equal(envAbort.status, 200);
      assert.equal(((await envAbort.json()) as { ok: boolean }).ok, true);

      const envReset = await fetch(`${cuaBaseUrl}/api/cua/reset-abort`, {
        method: "POST",
        headers: buildCuaDaemonHeaders(undefined),
      });
      assert.equal(envReset.status, 200);
      assert.equal(((await envReset.json()) as { ok: boolean }).ok, true);
    } finally {
      if (prevAccessToken === undefined) {
        delete process.env.CRIATIVO_SERVER_ACCESS_TOKEN;
      } else {
        process.env.CRIATIVO_SERVER_ACCESS_TOKEN = prevAccessToken;
      }
    }
  });
});
