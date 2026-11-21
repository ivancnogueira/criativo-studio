import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { MemoryReviewService } from "../src/engine/runner/memory-review-service.ts";
import {
  getDeletedNativeAgentIds,
  seedDefaultAgents,
} from "../src/engine/runner/roster-defaults.ts";
import { createDaemonServer, type DaemonRuntime } from "../src/server/daemon-server.ts";
import { getUserSettings, updateUserSettings } from "../src/server/settings-storage-service.ts";
import {
  assertAgentPermissionForPath,
  readAgentGovernance,
  sanitizeAllowedFoldersList,
  validateAllowedFolderPath,
} from "../src/server/studio-tools-bridge.ts";

const daemonRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("Fase 23 — Pastas Autorizadas, Exclusão/Restauração de Agentes, Chat em Blocos & Multi-Server", () => {
  let tempDir: string;
  let externalRoDir: string;
  let externalRwDir: string;
  let unauthExternalDir: string;
  let dbPath: string;
  let runtime: DaemonRuntime;
  let baseUrl: string;
  let prevSkipProbe: string | undefined;

  before(async () => {
    prevSkipProbe = process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    process.env.CRIATIVO_SKIP_LOCAL_PROBE = "1";

    tempDir = mkdtempSync(join(tmpdir(), "criativo-phase23-"));
    externalRoDir = join(tempDir, "externa-ro");
    externalRwDir = join(tempDir, "externa-rw");
    unauthExternalDir = join(tempDir, "externa-bloqueada");
    const wsDir = join(tempDir, "workspace");

    mkdirSync(wsDir, { recursive: true });
    mkdirSync(join(wsDir, "saidas"), { recursive: true });
    mkdirSync(join(wsDir, "previas"), { recursive: true });
    mkdirSync(join(wsDir, "recursos", "Uploads"), { recursive: true });
    mkdirSync(externalRoDir, { recursive: true });
    mkdirSync(externalRwDir, { recursive: true });
    mkdirSync(unauthExternalDir, { recursive: true });

    dbPath = join(tempDir, "criativo-phase23.db");
    runtime = await createDaemonServer({
      port: 0,
      dbPath,
      workspaceRoot: wsDir,
      autoStartLoops: false,
      controlSocketPath: null,
    });
    seedDefaultAgents(runtime.db);
    baseUrl = `http://127.0.0.1:${runtime.port}`;
  });

  after(async () => {
    await runtime.close();
    rmSync(tempDir, { recursive: true, force: true });
    if (prevSkipProbe === undefined) delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    else process.env.CRIATIVO_SKIP_LOCAL_PROBE = prevSkipProbe;
  });

  it("1. (PERM23-01) validateAllowedFolderPath bloqueia raízes/sistema e assertAgentPermissionForPath respeita read vs read_write", async () => {
    assert.equal(validateAllowedFolderPath("C:\\").ok, false);
    assert.equal(validateAllowedFolderPath("/").ok, false);
    assert.equal(validateAllowedFolderPath("C:\\Windows\\System32").ok, false);
    assert.equal(validateAllowedFolderPath(join(tempDir, ".ssh")).ok, false);

    const validRo = validateAllowedFolderPath(externalRoDir);
    assert.equal(validRo.ok, true);

    const sanitized = sanitizeAllowedFoldersList([
      { path: externalRoDir, mode: "read", label: "Pasta RO" },
      { path: externalRwDir, mode: "read_write", label: "Pasta RW" },
      { path: externalRoDir, mode: "read_write" },
    ]);
    assert.equal(sanitized.ok, true);
    if (!sanitized.ok) throw new Error(sanitized.error);
    assert.equal(sanitized.folders.length, 2);

    const putRes = await fetch(`${baseUrl}/api/agentes/estrategista`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_color: "#22C55E",
        auto_memory_enabled: false,
        allowed_folders: sanitized.folders,
      }),
    });
    assert.equal(putRes.status, 200);
    const putJson = (await putRes.json()) as {
      agente: {
        config: {
          chat_color?: string;
          auto_memory_enabled?: boolean;
          allowed_folders?: Array<{ path: string; mode: string }>;
        };
      };
    };
    assert.equal(putJson.agente.config.chat_color, "#22C55E");
    assert.equal(putJson.agente.config.auto_memory_enabled, false);
    assert.equal(putJson.agente.config.allowed_folders?.length, 2);

    const wsRoot = join(tempDir, "workspace");
    const gov = readAgentGovernance(runtime.db, "estrategista");

    // Pasta externa NÃO autorizada -> sempre bloqueada
    assert.throws(
      () =>
        assertAgentPermissionForPath({
          rawPath: join(unauthExternalDir, "nota.txt"),
          workspaceRoot: wsRoot,
          permissionLevel: gov.permissionLevel,
          agenteId: "estrategista",
          operation: "read",
          allowedFolders: gov.allowedFolders,
        }),
      /Pastas Autorizadas/,
    );

    // Pasta autorizada apenas para leitura -> leitura permitida, escrita bloqueada
    assert.doesNotThrow(() =>
      assertAgentPermissionForPath({
        rawPath: join(externalRoDir, "briefing.md"),
        workspaceRoot: wsRoot,
        permissionLevel: gov.permissionLevel,
        agenteId: "estrategista",
        operation: "read",
        allowedFolders: gov.allowedFolders,
      }),
    );
    assert.throws(
      () =>
        assertAgentPermissionForPath({
          rawPath: join(externalRoDir, "briefing.md"),
          workspaceRoot: wsRoot,
          permissionLevel: gov.permissionLevel,
          agenteId: "estrategista",
          operation: "write",
          allowedFolders: gov.allowedFolders,
        }),
      /Pastas Autorizadas/,
    );

    // Pasta autorizada para leitura+escrita -> leitura e escrita liberadas
    assert.doesNotThrow(() =>
      assertAgentPermissionForPath({
        rawPath: join(externalRwDir, "saida.md"),
        workspaceRoot: wsRoot,
        permissionLevel: gov.permissionLevel,
        agenteId: "estrategista",
        operation: "write",
        allowedFolders: gov.allowedFolders,
      }),
    );
  });

  it("2. (DEL23-01) Exclusão de agente customizado e nativo com tombstone + não-ressurreição no seed + restauração", async () => {
    const createRes = await fetch(`${baseUrl}/api/agentes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: "Especialista Temporário",
        papel: "Teste de exclusão",
        modelo_padrao: "gemini-4-argon",
        prompt_base: "Você ajuda em testes temporários.",
      }),
    });
    assert.equal(createRes.status, 201);
    const createdJson = (await createRes.json()) as { agente: { agente_id: string } };
    const customId = createdJson.agente.agente_id;

    // Excluir customizado
    const delCustomRes = await fetch(`${baseUrl}/api/agentes/${encodeURIComponent(customId)}`, {
      method: "DELETE",
    });
    assert.equal(delCustomRes.status, 200);
    const delCustomJson = (await delCustomRes.json()) as { ok: boolean; nativo: boolean };
    assert.equal(delCustomJson.ok, true);
    assert.equal(delCustomJson.nativo, false);

    // Excluir nativo 'copywriter'
    const delNativeRes = await fetch(`${baseUrl}/api/agentes/copywriter`, {
      method: "DELETE",
    });
    assert.equal(delNativeRes.status, 200);
    const delNativeJson = (await delNativeRes.json()) as { ok: boolean; nativo: boolean };
    assert.equal(delNativeJson.ok, true);
    assert.equal(delNativeJson.nativo, true);

    assert.ok(getDeletedNativeAgentIds(runtime.db).has("copywriter"));

    // Simular reinicialização do studio chamando seedDefaultAgents novamente
    seedDefaultAgents(runtime.db);
    const listAfterSeed = await fetch(`${baseUrl}/api/agentes`);
    const listJson = (await listAfterSeed.json()) as {
      agentes: Array<{ agente_id: string }>;
    };
    assert.equal(
      listJson.agentes.some((a) => a.agente_id === "copywriter"),
      false,
      "Agente nativo excluído não pode ressuscitar após seedDefaultAgents",
    );

    // Endpoint GET /api/agentes/excluidos deve listar copywriter
    const exclRes = await fetch(`${baseUrl}/api/agentes/excluidos`);
    assert.equal(exclRes.status, 200);
    const exclJson = (await exclRes.json()) as {
      excluidos: Array<{ agente_id: string; nome: string }>;
    };
    assert.ok(exclJson.excluidos.some((e) => e.agente_id === "copywriter"));

    // Restaurar individualmente via /restaurar
    const restRes = await fetch(`${baseUrl}/api/agentes/copywriter/restaurar`, {
      method: "POST",
    });
    assert.equal(restRes.status, 200);
    assert.equal(getDeletedNativeAgentIds(runtime.db).has("copywriter"), false);

    // Excluir novamente e testar restauração em lote
    await fetch(`${baseUrl}/api/agentes/copywriter`, { method: "DELETE" });
    const restAllRes = await fetch(`${baseUrl}/api/agentes/restaurar-excluidos`, {
      method: "POST",
    });
    assert.equal(restAllRes.status, 200);
    const restAllJson = (await restAllRes.json()) as { restored_ids: string[] };
    assert.ok(restAllJson.restored_ids.includes("copywriter"));
  });

  it("3. (CHAT23-01 & MEM23-01) Não lida/lida, limpeza de histórico de agente/canal, memória automática desligada e aparência", async () => {
    // Inserir mensagens no chat do agente e de um canal
    runtime.db.connection
      .prepare(
        `INSERT INTO projecao_conversas_chat (mensagem_id, canal_id, agente_id, autor, autor_nome, conteudo_markdown, anexos_json, steps_json, lida, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, '[]', '[]', 1, ?)`,
      )
      .run(
        "msg-p23-1",
        "agente:estrategista",
        "estrategista",
        "operador",
        "Você",
        "Mensagem teste",
        new Date().toISOString(),
      );

    const unreadRes = await fetch(`${baseUrl}/api/agentes/estrategista/mensagens/nao-lida`, {
      method: "POST",
    });
    assert.equal(unreadRes.status, 200);

    const readRes = await fetch(`${baseUrl}/api/agentes/estrategista/mensagens/lidas`, {
      method: "POST",
    });
    assert.equal(readRes.status, 200);

    const clearAgentRes = await fetch(`${baseUrl}/api/agentes/estrategista/mensagens`, {
      method: "DELETE",
    });
    assert.equal(clearAgentRes.status, 200);
    const clearAgentJson = (await clearAgentRes.json()) as { ok: boolean; removidas: number };
    assert.equal(clearAgentJson.ok, true);
    assert.ok(clearAgentJson.removidas >= 1);

    const chCreate = await fetch(`${baseUrl}/api/canais`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: "Equipe Teste 23",
        descricao: "Validar limpeza",
        membros_agentes: ["estrategista"],
      }),
    });
    const chJson = (await chCreate.json()) as { canal: { canal_id: string } };
    runtime.db.connection
      .prepare(
        `INSERT INTO projecao_conversas_chat (mensagem_id, canal_id, agente_id, autor, autor_nome, conteudo_markdown, anexos_json, steps_json, lida, criado_em)
         VALUES (?, ?, NULL, ?, ?, ?, '[]', '[]', 1, ?)`,
      )
      .run(
        "msg-p23-ch-1",
        chJson.canal.canal_id,
        "operador",
        "Você",
        "Oi equipe",
        new Date().toISOString(),
      );

    const clearChRes = await fetch(
      `${baseUrl}/api/canais/${encodeURIComponent(chJson.canal.canal_id)}/mensagens`,
      { method: "DELETE" },
    );
    assert.equal(clearChRes.status, 200);
    const clearChJson = (await clearChRes.json()) as { ok: boolean; removidas: number };
    assert.equal(clearChJson.ok, true);
    assert.ok(clearChJson.removidas >= 1);

    // Configurações de aparência (cor do balão do operador e blocos sólidos)
    const updatedSettings = updateUserSettings(runtime.db, {
      aparencia: {
        cor_balao_usuario: "#1E40AF",
        baloes_solidos: true,
      },
    });
    assert.equal(updatedSettings.aparencia.cor_balao_usuario, "#1E40AF");
    assert.equal(updatedSettings.aparencia.baloes_solidos, true);
    assert.equal(getUserSettings(runtime.db).aparencia.cor_balao_usuario, "#1E40AF");

    // auto_memory_enabled === false ignora triggerNow sem erro
    const memSvc = new MemoryReviewService({
      db: runtime.db,
      providerManager: {
        executeStructured: async () => {
          throw new Error("Não deveria rodar revisão com auto_memory_enabled=false");
        },
      } as never,
    });
    await memSvc.triggerNow("estrategista");
  });

  it("4. (SRV23-01) LocalServerManager isola CRIATIVO_USER_DATA_DIR por servidor local", () => {
    const src = readFileSync(join(daemonRoot, "src", "servers", "local-server-manager.ts"), "utf8");
    assert.match(src, /CRIATIVO_USER_DATA_DIR:\s*row\.workspace_path/);
  });
});
