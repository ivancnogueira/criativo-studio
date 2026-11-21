import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ServerConnectionKind,
  ServerQuotaSummary,
  ServerRuntimeStatus,
  StudioServerRecord,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import type { LicenseClientService } from "../license/license-service.ts";
import type { VaultService } from "../vault/vault-service.ts";
import type { WebSocketHub } from "../server/websocket-hub.ts";
import { LOCAL_SERVER_READY_PREFIX } from "./local-child-entry.ts";
import { assertServerCreationAllowed, evaluateServerQuota } from "./server-quota.ts";

interface ServerDbRow {
  server_id: string;
  nome: string;
  slug: string;
  kind: ServerConnectionKind;
  cor_hex: string;
  base_url: string;
  workspace_path: string | null;
  port: number | null;
  remote_ip: string | null;
  access_token_vault_key: string | null;
  version: string | null;
  is_active: number;
  created_at: string;
  last_seen_at: string | null;
  last_error: string | null;
}

const SHARED_PROVIDER_VAULT_KEYS = [
  "gemini_api_key",
  "google_api_key",
  "anthropic_api_key",
  "claude_api_key",
  "openai_api_key",
  "xai_api_key",
  "grok_api_key",
  "opencode_api_key",
];

function slugifyServerName(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return base || "servidor";
}

function resolveChildEntryFile(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = dirname(currentFile);
  const productRoot = process.env.CRIATIVO_PRODUCT_ROOT ? resolve(process.env.CRIATIVO_PRODUCT_ROOT) : null;
  if (currentFile.endsWith(".ts")) {
    return resolve(currentDir, "local-child-entry.ts");
  }
  const candidates = [
    resolve(currentDir, "local-child-entry.js"),
    resolve(currentDir, "../servers/local-child-entry.js"),
    productRoot ? resolve(productRoot, "apps/daemon/dist/servers/local-child-entry.js") : null,
    productRoot ? resolve(productRoot, "apps/daemon/dist/server/local-child-entry.js") : null,
  ].filter((c): c is string => Boolean(c));
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return resolve(currentDir, "local-child-entry.js");
}

export interface LocalServerManagerOptions {
  db: CriativoDatabase;
  vault: VaultService;
  licenseService: LicenseClientService;
  wsHub?: WebSocketHub;
  workspaceRoot: string;
  primaryPortProvider?: () => number;
}

export class LocalServerManager {
  readonly #db: CriativoDatabase;
  readonly #vault: VaultService;
  readonly #licenseService: LicenseClientService;
  readonly #wsHub?: WebSocketHub;
  readonly #workspaceRoot: string;
  readonly #primaryPortProvider?: () => number;
  readonly #children = new Map<string, { proc: ChildProcess; port: number; baseUrl: string }>();
  readonly #startingPromises = new Map<string, Promise<StudioServerRecord>>();

  constructor(options: LocalServerManagerOptions) {
    this.#db = options.db;
    this.#vault = options.vault;
    this.#licenseService = options.licenseService;
    this.#wsHub = options.wsHub;
    this.#workspaceRoot = resolve(options.workspaceRoot);
    this.#primaryPortProvider = options.primaryPortProvider;
  }

  private mapRow(row: ServerDbRow): StudioServerRecord {
    let status: ServerRuntimeStatus = "offline";
    let baseUrl = row.base_url;
    let port = row.port;

    if (row.kind === "primary") {
      status = "online";
      const p = this.#primaryPortProvider?.() ?? row.port ?? 3000;
      port = p;
      baseUrl = `http://127.0.0.1:${p}`;
    } else if (row.kind === "local_child") {
      const running = this.#children.get(row.server_id);
      if (running && running.proc.exitCode === null && !running.proc.killed) {
        status = "online";
        port = running.port;
        baseUrl = running.baseUrl;
      } else if (this.#startingPromises.has(row.server_id)) {
        status = "starting";
      } else {
        status = row.last_error ? "error" : "offline";
      }
    } else {
      status = row.last_error ? "error" : "online";
    }

    return {
      server_id: row.server_id,
      nome: row.nome,
      slug: row.slug,
      kind: row.kind,
      status,
      cor_hex: row.cor_hex,
      base_url: baseUrl,
      workspace_path: row.workspace_path,
      port,
      remote_ip: row.remote_ip,
      version: row.version,
      is_active: row.is_active === 1,
      created_at: row.created_at,
      last_seen_at: row.last_seen_at,
      last_error: row.last_error,
    };
  }

  listServers(): StudioServerRecord[] {
    const rows = this.#db.connection
      .prepare(
        `SELECT * FROM projecao_servidores_conectados
         ORDER BY CASE WHEN kind = 'primary' THEN 0 ELSE 1 END ASC, created_at ASC;`,
      )
      .all() as unknown as ServerDbRow[];
    return rows.map((r) => this.mapRow(r));
  }

  getServer(serverId: string): StudioServerRecord | null {
    const row = this.#db.connection
      .prepare(`SELECT * FROM projecao_servidores_conectados WHERE server_id = ?;`)
      .get(serverId) as ServerDbRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  getActiveServerId(): string {
    const row = this.#db.connection
      .prepare(`SELECT server_id FROM projecao_servidores_conectados WHERE is_active = 1 LIMIT 1;`)
      .get() as { server_id: string } | undefined;
    return row?.server_id ?? "primary";
  }

  getServerAccessToken(serverId: string): string | null {
    const row = this.#db.connection
      .prepare(`SELECT access_token_vault_key FROM projecao_servidores_conectados WHERE server_id = ?;`)
      .get(serverId) as { access_token_vault_key: string | null } | undefined;
    if (!row?.access_token_vault_key) return null;
    return this.#vault.getSecret(row.access_token_vault_key);
  }

  getQuotaSummary(requestedKind?: Exclude<ServerConnectionKind, "primary">): ServerQuotaSummary {
    return evaluateServerQuota(this.#licenseService.getStatus(), this.listServers(), requestedKind);
  }

  private emitUpdated(): void {
    this.#wsHub?.broadcast("servers:updated", {
      servers: this.listServers(),
      active_server_id: this.getActiveServerId(),
    });
  }

  private buildUniqueSlug(baseName: string): string {
    const base = slugifyServerName(baseName);
    let candidate = base;
    let i = 2;
    while (
      this.#db.connection
        .prepare(`SELECT 1 FROM projecao_servidores_conectados WHERE slug = ? LIMIT 1;`)
        .get(candidate)
    ) {
      candidate = `${base}-${i}`;
      i += 1;
    }
    return candidate;
  }

  private resolveSharedAuthDir(): string {
    const appsContas = join(this.#workspaceRoot, "apps", "daemon", "dados", "contas");
    if (existsSync(appsContas) || existsSync(join(this.#workspaceRoot, "apps", "daemon", "dados"))) {
      return appsContas;
    }
    return join(this.#workspaceRoot, "dados", "contas");
  }

  private collectSharedAiKeys(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const key of SHARED_PROVIDER_VAULT_KEYS) {
      const val = this.#vault.getSecret(key);
      if (val) out[key] = val;
    }
    return out;
  }

  /** Cria e inicia um novo servidor local isolado neste computador (Print 3). */
  async createLocalServer(input: { nome: string; cor_hex?: string }): Promise<StudioServerRecord> {
    const nome = String(input.nome || "").trim();
    if (nome.length < 2 || nome.length > 48) {
      const err = new Error("O nome do servidor deve ter entre 2 e 48 caracteres.") as Error & { statusCode?: number };
      err.statusCode = 400;
      throw err;
    }

    assertServerCreationAllowed(this.#licenseService.getStatus(), this.listServers(), "local_child");

    const serverId = `srv_local_${randomUUID().slice(0, 8)}`;
    const slug = this.buildUniqueSlug(nome);
    const corHex = /^#[0-9a-fA-F]{6}$/.test(input.cor_hex || "") ? input.cor_hex! : "#F59E0B";
    const childRoot = join(this.#workspaceRoot, "servidores", slug);
    mkdirSync(childRoot, { recursive: true });

    const vaultKey = `server_token_${serverId}`;
    const accessToken = randomBytes(32).toString("hex");
    this.#vault.setSecret(vaultKey, accessToken);

    const nowIso = new Date().toISOString();
    this.#db.connection
      .prepare(
        `INSERT INTO projecao_servidores_conectados (
          server_id, nome, slug, kind, cor_hex, base_url, workspace_path,
          access_token_vault_key, is_active, created_at, last_seen_at
        ) VALUES (?, ?, ?, 'local_child', ?, 'http://127.0.0.1:0', ?, ?, 0, ?, ?);`,
      )
      .run(serverId, nome, slug, corHex, childRoot, vaultKey, nowIso, nowIso);

    const started = await this.ensureRunning(serverId);
    this.emitUpdated();
    return started;
  }

  /** Registra um servidor remoto pareado via CRIATIVO_CLAIM ou convite. */
  registerRemoteServer(input: {
    nome: string;
    kind: "remote_vps" | "joined";
    base_url: string;
    access_token: string;
    remote_ip?: string | null;
    version?: string | null;
    cor_hex?: string;
  }): StudioServerRecord {
    const nome = String(input.nome || "").trim() || "Servidor Remoto";
    assertServerCreationAllowed(this.#licenseService.getStatus(), this.listServers(), input.kind);

    const serverId = `srv_rem_${randomUUID().slice(0, 8)}`;
    const slug = this.buildUniqueSlug(nome);
    const corHex = /^#[0-9a-fA-F]{6}$/.test(input.cor_hex || "") ? input.cor_hex! : "#42A0FF";
    const vaultKey = `server_token_${serverId}`;
    this.#vault.setSecret(vaultKey, input.access_token);

    const cleanUrl = input.base_url.replace(/\/+$/, "");
    const nowIso = new Date().toISOString();
    this.#db.connection
      .prepare(
        `INSERT INTO projecao_servidores_conectados (
          server_id, nome, slug, kind, cor_hex, base_url, remote_ip,
          access_token_vault_key, version, is_active, created_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?);`,
      )
      .run(
        serverId,
        nome,
        slug,
        input.kind,
        corHex,
        cleanUrl,
        input.remote_ip ?? null,
        vaultKey,
        input.version ?? null,
        nowIso,
        nowIso,
      );

    this.emitUpdated();
    return this.getServer(serverId)!;
  }

  /** Garante que um servidor local_child esteja rodando em processo filho headless. */
  async ensureRunning(serverId: string): Promise<StudioServerRecord> {
    const existing = this.getServer(serverId);
    if (!existing) {
      throw new Error(`Servidor '${serverId}' não encontrado.`);
    }
    if (existing.kind !== "local_child") {
      return existing;
    }

    const running = this.#children.get(serverId);
    if (running && running.proc.exitCode === null && !running.proc.killed) {
      return existing;
    }

    const inflight = this.#startingPromises.get(serverId);
    if (inflight) {
      return inflight;
    }

    const promise = this.spawnLocalChild(serverId, existing);
    this.#startingPromises.set(serverId, promise);
    try {
      return await promise;
    } finally {
      this.#startingPromises.delete(serverId);
    }
  }

  private async spawnLocalChild(serverId: string, record: StudioServerRecord): Promise<StudioServerRecord> {
    const row = this.#db.connection
      .prepare(`SELECT * FROM projecao_servidores_conectados WHERE server_id = ?;`)
      .get(serverId) as ServerDbRow | undefined;
    if (!row || !row.workspace_path || !row.access_token_vault_key) {
      throw new Error(`Metadados inválidos para servidor local '${serverId}'.`);
    }

    const accessToken = this.#vault.getSecret(row.access_token_vault_key);
    if (!accessToken) {
      throw new Error(`Token de acesso do servidor '${serverId}' ausente no Cofre.`);
    }

    const entryFile = resolveChildEntryFile();
    const childVaultKey = randomBytes(32).toString("hex");
    const sharedAiKeys = this.collectSharedAiKeys();

    const proc = spawn(process.execPath, [entryFile], {
      cwd: this.#workspaceRoot,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        ...(process.env.CRIATIVO_DESKTOP_PACKAGED === "1" ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
        CRIATIVO_USER_DATA_DIR: row.workspace_path,
        CRIATIVO_LOCAL_CHILD: "1",
        CRIATIVO_CHILD_SERVER_ID: serverId,
        CRIATIVO_CHILD_SERVER_NAME: record.nome,
        CRIATIVO_CHILD_ROOT_DIR: row.workspace_path,
        CRIATIVO_SERVER_ACCESS_TOKEN: accessToken,
        CRIATIVO_VAULT_KEY: childVaultKey,
        CRIATIVO_SHARED_AUTH_DIR: this.resolveSharedAuthDir(),
        CRIATIVO_CHILD_SHARED_AI_KEYS: JSON.stringify(sharedAiKeys),
        CRIATIVO_CHILD_BYPASS_LICENSE: this.#licenseService.isBypassedForTests() ? "1" : "1",
      },
    });

    const readyInfo = await new Promise<{ port: number; baseUrl: string }>((resolveReady, rejectReady) => {
      let stdoutBuf = "";
      let stderrBuf = "";
      const timer = setTimeout(() => {
        proc.kill();
        rejectReady(new Error(`Timeout aguardando servidor local '${record.nome}'. ${stderrBuf}`));
      }, 15_000);

      proc.stdout?.on("data", (chunk: Buffer) => {
        stdoutBuf += chunk.toString("utf8");
        const lines = stdoutBuf.split(/\r?\n/);
        stdoutBuf = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith(LOCAL_SERVER_READY_PREFIX)) {
            clearTimeout(timer);
            try {
              const info = JSON.parse(line.slice(LOCAL_SERVER_READY_PREFIX.length)) as {
                port: number;
                baseUrl: string;
              };
              resolveReady(info);
              return;
            } catch (err) {
              rejectReady(err);
              return;
            }
          }
        }
      });

      proc.stderr?.on("data", (chunk: Buffer) => {
        stderrBuf = (stderrBuf + chunk.toString("utf8")).slice(-1000);
      });

      proc.once("exit", (code) => {
        clearTimeout(timer);
        if (!this.#children.has(serverId)) {
          rejectReady(new Error(`Servidor local encerrou antes de ficar pronto (code ${code}): ${stderrBuf}`));
        }
      });
    });

    this.#children.set(serverId, { proc, port: readyInfo.port, baseUrl: readyInfo.baseUrl });
    proc.once("exit", () => {
      const current = this.#children.get(serverId);
      if (current?.proc === proc) {
        this.#children.delete(serverId);
        this.emitUpdated();
      }
    });

    const nowIso = new Date().toISOString();
    this.#db.connection
      .prepare(
        `UPDATE projecao_servidores_conectados
         SET base_url = ?, port = ?, last_seen_at = ?, last_error = NULL
         WHERE server_id = ?;`,
      )
      .run(readyInfo.baseUrl, readyInfo.port, nowIso, serverId);

    this.emitUpdated();
    return this.getServer(serverId)!;
  }

  async stopLocalChild(serverId: string): Promise<void> {
    const running = this.#children.get(serverId);
    if (!running) return;
    this.#children.delete(serverId);
    const { proc } = running;
    if (proc.exitCode !== null || proc.killed) return;

    await new Promise<void>((resolveExit) => {
      const killTimer = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          // ignora
        }
        resolveExit();
      }, 3000);
      proc.once("exit", () => {
        clearTimeout(killTimer);
        resolveExit();
      });
      try {
        proc.stdin?.end();
        proc.kill("SIGTERM");
      } catch {
        clearTimeout(killTimer);
        resolveExit();
      }
    });
  }

  async stopAll(): Promise<void> {
    const ids = Array.from(this.#children.keys());
    await Promise.all(ids.map((id) => this.stopLocalChild(id)));
  }

  async selectActiveServer(serverId: string): Promise<StudioServerRecord> {
    const srv = this.getServer(serverId);
    if (!srv) {
      const err = new Error(`Servidor '${serverId}' não encontrado.`) as Error & { statusCode?: number };
      err.statusCode = 404;
      throw err;
    }
    if (srv.kind === "local_child") {
      await this.ensureRunning(serverId);
    }
    this.#db.runInTransaction(() => {
      this.#db.connection.prepare(`UPDATE projecao_servidores_conectados SET is_active = 0;`).run();
      this.#db.connection
        .prepare(`UPDATE projecao_servidores_conectados SET is_active = 1, last_seen_at = ? WHERE server_id = ?;`)
        .run(new Date().toISOString(), serverId);
    });
    this.emitUpdated();
    return this.getServer(serverId)!;
  }

  renameOrUpdateServer(
    serverId: string,
    patch: { nome?: string; cor_hex?: string },
  ): StudioServerRecord {
    const srv = this.getServer(serverId);
    if (!srv) {
      const err = new Error(`Servidor '${serverId}' não encontrado.`) as Error & { statusCode?: number };
      err.statusCode = 404;
      throw err;
    }
    const nextNome = typeof patch.nome === "string" && patch.nome.trim() ? patch.nome.trim() : srv.nome;
    const nextCor =
      typeof patch.cor_hex === "string" && /^#[0-9a-fA-F]{6}$/.test(patch.cor_hex)
        ? patch.cor_hex
        : srv.cor_hex;

    this.#db.connection
      .prepare(`UPDATE projecao_servidores_conectados SET nome = ?, cor_hex = ? WHERE server_id = ?;`)
      .run(nextNome, nextCor, serverId);

    this.emitUpdated();
    return this.getServer(serverId)!;
  }

  async deleteServer(serverId: string, deleteFiles = false): Promise<void> {
    if (serverId === "primary") {
      const err = new Error("O Servidor Principal não pode ser excluído.") as Error & { statusCode?: number };
      err.statusCode = 400;
      throw err;
    }
    const row = this.#db.connection
      .prepare(`SELECT * FROM projecao_servidores_conectados WHERE server_id = ?;`)
      .get(serverId) as ServerDbRow | undefined;
    if (!row) return;

    await this.stopLocalChild(serverId);
    if (row.access_token_vault_key) {
      this.#vault.deleteSecret(row.access_token_vault_key);
    }
    const wasActive = row.is_active === 1;
    this.#db.connection
      .prepare(`DELETE FROM projecao_servidores_conectados WHERE server_id = ?;`)
      .run(serverId);
    if (wasActive) {
      this.#db.connection
        .prepare(`UPDATE projecao_servidores_conectados SET is_active = 1 WHERE server_id = 'primary';`)
        .run();
    }
    if (deleteFiles && row.workspace_path && row.kind === "local_child") {
      try {
        rmSync(row.workspace_path, { recursive: true, force: true });
      } catch {
        // ignora falha de limpeza em disco
      }
    }
    this.emitUpdated();
  }
}
