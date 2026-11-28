import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  ReleaseArtifactInfo,
  ReleaseManifest,
  ServerConnectionKind,
  UpdateBundlePayloadV2,
  UpdatePhaseState,
  UpdateStatusSnapshot,
} from "@criativo/contracts";
import { DADOS_DA_INSTANCIA_ITEMS, type StudioResolvedPaths } from "../config/app-paths.ts";
import type { FetchLike } from "../engine/providers/provider-interface.ts";
import type { LicenseClientService } from "../license/license-service.ts";
import type { WebSocketHub } from "../server/websocket-hub.ts";
import type { IdleWaitCoordinator } from "./idle-wait-coordinator.ts";

export const DEFAULT_UPDATE_POLL_INTERVAL_MS = 15 * 60_000;
export const DEFAULT_UPDATE_INITIAL_DELAY_MS = 8_000;

export interface UpdateRestartContext {
  mode: "hot_bundle" | "native_installer";
  stagedArtifactPath: string | null;
  version: string;
}

export interface AutoUpdateServiceOptions {
  licenseService: LicenseClientService;
  paths: StudioResolvedPaths;
  wsHub?: WebSocketHub;
  fetchImpl?: FetchLike;
  currentVersion?: string;
  serverId?: string;
  serverKind?: ServerConnectionKind;
  idleWaitCoordinator?: IdleWaitCoordinator;
  autoDownload?: boolean;
  onRestartRequested?: (ctx?: UpdateRestartContext) => Promise<void> | void;
}

interface UpdateBundlePayloadV1 {
  format: "criativo-update-bundle-v1";
  version: string;
  files: Record<string, string>;
}

function writeSafeProductEntry(
  targetRoot: string,
  relPath: string,
  content: string | Buffer
): boolean {
  if (!relPath || isAbsolute(relPath) || isProtectedInstancePath(relPath)) {
    return false;
  }
  const dest = resolve(targetRoot, relPath);
  const relCheck = relative(targetRoot, dest);
  if (relCheck.startsWith("..") || isAbsolute(relCheck) || dest === targetRoot) {
    return false;
  }
  if (!dest.startsWith(targetRoot + sep)) {
    return false;
  }
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, content);
  return true;
}

function parseSemver(ver: string): [number, number, number] {
  const clean = String(ver || "0.0.0")
    .replace(/^v/i, "")
    .split("-")[0];
  const parts = clean.split(".").map((n) => Number(n) || 0);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}

function isProtectedInstancePath(relPath: string): boolean {
  const normalized = relPath.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..")) return true;
  const topSegment = normalized.split("/")[0];
  return (DADOS_DA_INSTANCIA_ITEMS as readonly string[]).includes(topSegment);
}

function readProductVersion(productRoot: string, fallback = "1.0.0"): string {
  try {
    const raw = readFileSync(join(productRoot, "produto.json"), "utf8");
    const parsed = JSON.parse(raw) as { versao?: string };
    return parsed.versao || fallback;
  } catch {
    return fallback;
  }
}

export class AutoUpdateService {
  readonly #licenseService: LicenseClientService;
  readonly #paths: StudioResolvedPaths;
  readonly #wsHub?: WebSocketHub;
  readonly #fetchImpl: FetchLike;
  readonly #serverId: string;
  readonly #serverKind: ServerConnectionKind;
  readonly #idleWaitCoordinator?: IdleWaitCoordinator;
  readonly #onRestartRequested?: (ctx?: UpdateRestartContext) => Promise<void> | void;

  #currentVersion: string;
  #latestManifest: ReleaseManifest | null = null;
  #state: UpdatePhaseState = "idle";
  #progressPercent = 0;
  #lastCheckedAt: string | null = null;
  #errorMessage: string | null = null;
  #installMode: "hot_bundle" | "native_installer" | null = null;
  #stagedArtifactPath: string | null = null;
  #stagedArtifactName: string | null = null;
  #initialCheckTimer: NodeJS.Timeout | null = null;
  #periodicCheckTimer: NodeJS.Timeout | null = null;
  #autoDownloadEnabled: boolean;
  #inFlightDownload: Promise<UpdateStatusSnapshot> | null = null;
  #restartPendingAfterDownload = false;

  constructor(options: AutoUpdateServiceOptions) {
    this.#licenseService = options.licenseService;
    this.#paths = options.paths;
    this.#wsHub = options.wsHub;
    this.#fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.#serverId = options.serverId ?? "primary";
    this.#serverKind = options.serverKind ?? "primary";
    this.#idleWaitCoordinator = options.idleWaitCoordinator;
    this.#onRestartRequested = options.onRestartRequested;
    this.#currentVersion = options.currentVersion ?? readProductVersion(options.paths.productRoot);
    const isTestProc =
      process.env.NODE_ENV === "test" ||
      process.execArgv.includes("--test") ||
      process.argv.includes("--test");
    this.#autoDownloadEnabled = options.autoDownload ?? !isTestProc;
  }

  getStagedArtifactPath(): string | null {
    return this.#stagedArtifactPath;
  }

  #isBusyOrReady(): boolean {
    return (
      this.#state === "checking" ||
      this.#state === "downloading" ||
      this.#state === "verifying" ||
      this.#state === "applying" ||
      this.#state === "waiting_idle" ||
      this.#state === "ready_to_restart"
    );
  }

  /**
   * Inicia verificação automática no boot e polling periódico em background,
   * emitindo `update:status` via WebSocket sempre que houver nova release.
   */
  startPeriodicCheck(options?: {
    intervalMs?: number;
    initialDelayMs?: number;
    autoDownload?: boolean;
  }): void {
    this.stopPeriodicCheck();
    if (typeof options?.autoDownload === "boolean") {
      this.#autoDownloadEnabled = options.autoDownload;
    }

    const envInterval = Number(process.env.CRIATIVO_UPDATE_CHECK_INTERVAL_MS || "");
    const rawInterval =
      options?.intervalMs ??
      (Number.isFinite(envInterval) && envInterval > 0
        ? envInterval
        : DEFAULT_UPDATE_POLL_INTERVAL_MS);
    const intervalMs = Math.max(50, rawInterval);
    const initialDelayMs = Math.max(
      0,
      options?.initialDelayMs ?? DEFAULT_UPDATE_INITIAL_DELAY_MS
    );

    const runSilentCheck = () => {
      if (this.#isBusyOrReady()) return;
      void this.checkForUpdates().catch(() => {});
    };

    this.#initialCheckTimer = setTimeout(() => {
      this.#initialCheckTimer = null;
      runSilentCheck();
    }, initialDelayMs);
    this.#initialCheckTimer.unref?.();

    this.#periodicCheckTimer = setInterval(runSilentCheck, intervalMs);
    this.#periodicCheckTimer.unref?.();
  }

  stopPeriodicCheck(): void {
    if (this.#initialCheckTimer) {
      clearTimeout(this.#initialCheckTimer);
      this.#initialCheckTimer = null;
    }
    if (this.#periodicCheckTimer) {
      clearInterval(this.#periodicCheckTimer);
      this.#periodicCheckTimer = null;
    }
  }

  getStatus(): UpdateStatusSnapshot {
    const latestVersion = this.#latestManifest?.version ?? null;
    const updateAvailable =
      Boolean(latestVersion) &&
      compareSemver(latestVersion!, this.#currentVersion) > 0 &&
      this.#state !== "ready_to_restart";

    return {
      current_version: this.#currentVersion,
      latest_version: latestVersion,
      update_available: updateAvailable,
      state: this.#state,
      progress_percent: this.#progressPercent,
      changelog_markdown: this.#latestManifest?.changelog_markdown ?? null,
      requires_active_license: true,
      can_apply_in_app: true,
      is_desktop_packaged: this.#paths.isPackaged,
      install_mode: this.#installMode,
      staged_artifact_name: this.#stagedArtifactName,
      server_id: this.#serverId,
      server_kind: this.#serverKind,
      last_checked_at: this.#lastCheckedAt,
      error_message: this.#errorMessage,
    };
  }

  async triggerRestart(options: { force?: boolean; timeoutMs?: number } = {}): Promise<{
    ok: boolean;
    triggered: boolean;
    waiting_idle?: boolean;
    mode: "hot_bundle" | "native_installer";
    stagedArtifactPath: string | null;
    version: string;
  }> {
    if (this.#idleWaitCoordinator && !options.force) {
      const waitRes = await this.#idleWaitCoordinator.waitUntilIdle({
        timeoutMs: options.timeoutMs ?? 60_000,
        onWaiting: () => {
          this.#state = "waiting_idle";
          this.emitStatus();
        },
      });
      if (!waitRes.proceeded) {
        this.#state = "ready_to_restart";
        this.emitStatus();
        const mode = this.#installMode ?? (this.#stagedArtifactPath && !this.#stagedArtifactPath.endsWith(".json") ? "native_installer" : "hot_bundle");
        return {
          ok: false,
          triggered: false,
          waiting_idle: true,
          mode,
          stagedArtifactPath: this.#stagedArtifactPath,
          version: this.#currentVersion,
        };
      }
    }

    const mode = this.#installMode ?? (this.#stagedArtifactPath && !this.#stagedArtifactPath.endsWith(".json") ? "native_installer" : "hot_bundle");
    const ctx: UpdateRestartContext = {
      mode,
      stagedArtifactPath: this.#stagedArtifactPath,
      version: this.#currentVersion,
    };
    if (this.#onRestartRequested) {
      await this.#onRestartRequested(ctx);
      return { ok: true, triggered: true, ...ctx };
    }
    return { ok: true, triggered: false, ...ctx };
  }

  private emitStatus(): UpdateStatusSnapshot {
    const snap = this.getStatus();
    this.#wsHub?.broadcast("update:status", snap);
    return snap;
  }

  async checkForUpdates(): Promise<UpdateStatusSnapshot> {
    this.#state = "checking";
    this.#errorMessage = null;
    this.#progressPercent = 0;
    this.emitStatus();

    const licStatus = this.#licenseService.getStatus();
    const headers = this.#licenseService.getCredentialHeaders();

    if (!this.#licenseService.isBypassedForTests() && (!licStatus.valid || !headers)) {
      this.#state = "license_blocked";
      this.#latestManifest = null;
      this.#lastCheckedAt = new Date().toISOString();
      this.#errorMessage = "Licença ativa obrigatória para verificar ou instalar atualizações.";
      return this.emitStatus();
    }

    try {
      const res = await this.#fetchImpl(
        `${this.#licenseService.hubBaseUrl}/api/releases/latest`,
        {
          method: "GET",
          headers: headers ?? {},
        },
      );

      this.#lastCheckedAt = new Date().toISOString();

      if (res.status === 401 || res.status === 403) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        this.#state = "license_blocked";
        this.#latestManifest = null;
        this.#errorMessage = body.message || "Sua licença não está ativa para receber atualizações.";
        return this.emitStatus();
      }

      if (res.status === 404) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        if (errBody?.error === "no_release_published") {
          this.#state = "up_to_date";
          this.#latestManifest = null;
          this.#errorMessage = null;
          return this.emitStatus();
        }
        this.#state = "error";
        this.#errorMessage =
          "Servidor de atualizações respondeu 404 em /api/releases/latest. Atualize/reimplante o Painel na VPS ou publique a primeira release.";
        return this.emitStatus();
      }

      if (!res.ok) {
        this.#state = "error";
        this.#errorMessage = `Falha ao consultar servidor de atualizações (HTTP ${res.status}).`;
        return this.emitStatus();
      }

      const manifest = (await res.json()) as ReleaseManifest;
      this.#latestManifest = manifest;

      if (compareSemver(manifest.version, this.#currentVersion) > 0) {
        this.#state = "available";
      } else {
        this.#state = "up_to_date";
      }
      const snap = this.emitStatus();
      if (
        snap.update_available &&
        this.#autoDownloadEnabled &&
        this.selectArtifact(manifest) &&
        !this.#inFlightDownload
      ) {
        void this.downloadAndApplyUpdate({ restartAfterApply: false }).catch(() => {});
      }
      return snap;
    } catch (err) {
      this.#lastCheckedAt = new Date().toISOString();
      this.#state = "error";
      this.#errorMessage =
        err instanceof Error ? err.message : "Erro de rede ao consultar atualizações.";
      return this.emitStatus();
    }
  }

  private selectArtifact(
    manifest: ReleaseManifest,
    preferredPlatform?: ReleaseArtifactInfo["platform"],
  ): ReleaseArtifactInfo | null {
    const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
    if (artifacts.length === 0) return null;

    if (preferredPlatform) {
      const exact = artifacts.find((a) => a.platform === preferredPlatform);
      if (exact) return exact;
    }

    const runtimeTarget: ReleaseArtifactInfo["platform"] = this.#paths.isPackaged
      ? (process.platform === "win32" || process.platform === "darwin" || process.platform === "linux"
          ? process.platform
          : "linux")
      : "vps-tarball";

    return (
      artifacts.find((a) => a.platform === runtimeTarget) ??
      artifacts.find((a) => a.platform === "vps-tarball") ??
      artifacts[0]
    );
  }

  async downloadAndApplyUpdate(options?: {
    platform?: ReleaseArtifactInfo["platform"];
    targetProductDir?: string;
    restartAfterApply?: boolean;
    forceRestart?: boolean;
  }): Promise<UpdateStatusSnapshot> {
    if (this.#inFlightDownload) {
      if (options?.restartAfterApply) {
        this.#restartPendingAfterDownload = true;
      }
      const snap = await this.#inFlightDownload;
      if (options?.restartAfterApply && snap.state === "ready_to_restart") {
        this.#restartPendingAfterDownload = false;
        await this.triggerRestart({ force: options?.forceRestart === true });
      }
      return snap;
    }

    const runDownload = async (): Promise<UpdateStatusSnapshot> => {
      if (!this.#latestManifest || this.#state === "error") {
        await this.checkForUpdates();
      }

      if (this.#state === "license_blocked") {
        const err = new Error(this.#errorMessage || "Licença bloqueada para atualizações.") as Error & {
          statusCode?: number;
          code?: string;
        };
        err.statusCode = 403;
        err.code = "license_not_active_for_updates";
        throw err;
      }

      const manifest = this.#latestManifest;
      if (!manifest || compareSemver(manifest.version, this.#currentVersion) <= 0) {
        this.#state = "up_to_date";
        this.emitStatus();
        return this.getStatus();
      }

      const artifact = this.selectArtifact(manifest, options?.platform);
      if (!artifact) {
        this.#state = "error";
        this.#errorMessage = "Nenhum artefato compatível publicado para esta plataforma.";
        this.emitStatus();
        const err = new Error(this.#errorMessage) as Error & { statusCode?: number };
        err.statusCode = 404;
        throw err;
      }

      mkdirSync(this.#paths.updatesDir, { recursive: true });
      const safeFileName = basename(artifact.filename).replace(/[^a-zA-Z0-9._-]/g, "_") || "update.pkg";
      const stagedPath = join(this.#paths.updatesDir, safeFileName);
      const partPath = `${stagedPath}.part`;
      const expectedSha256 = String(artifact.sha256 || "").trim().toLowerCase();

      const computeFileSha256 = (filePath: string): string => {
        const hash = createHash("sha256");
        const fd = openSync(filePath, "r");
        try {
          const buf = Buffer.allocUnsafe(256 * 1024);
          let bytesRead = 0;
          while ((bytesRead = readSync(fd, buf, 0, buf.length, null)) > 0) {
            hash.update(bytesRead === buf.length ? buf : buf.subarray(0, bytesRead));
          }
        } finally {
          closeSync(fd);
        }
        return hash.digest("hex").toLowerCase();
      };

      const canReuseStaged =
        expectedSha256.length === 64 &&
        existsSync(stagedPath) &&
        (() => {
          try {
            return computeFileSha256(stagedPath) === expectedSha256;
          } catch {
            return false;
          }
        })();

      if (!canReuseStaged) {
        const headers = this.#licenseService.getCredentialHeaders() ?? {};
        this.#state = "downloading";
        this.#progressPercent = 10;
        this.#errorMessage = null;
        this.emitStatus();

        const dlUrl = artifact.download_path.startsWith("http")
          ? artifact.download_path
          : `${this.#licenseService.hubBaseUrl}${artifact.download_path}`;

        const res = await this.#fetchImpl(dlUrl, { method: "GET", headers });
        if (res.status === 401 || res.status === 403) {
          this.#state = "license_blocked";
          this.#progressPercent = 0;
          this.#errorMessage = "Licença revogada ou inválida ao baixar atualização.";
          this.emitStatus();
          const err = new Error(this.#errorMessage) as Error & { statusCode?: number; code?: string };
          err.statusCode = 403;
          err.code = "license_not_active_for_updates";
          throw err;
        }
        if (!res.ok) {
          this.#state = "error";
          this.#progressPercent = 0;
          this.#errorMessage = `Falha no download do pacote (HTTP ${res.status}).`;
          this.emitStatus();
          const err = new Error(this.#errorMessage) as Error & { statusCode?: number };
          err.statusCode = res.status;
          throw err;
        }

        rmSync(partPath, { force: true });
        const contentLenHeader = res.headers?.get?.("content-length");
        const parsedContentLen = contentLenHeader ? Number(contentLenHeader) : 0;
        const expectedTotalBytes =
          Number.isFinite(parsedContentLen) && parsedContentLen > 0
            ? parsedContentLen
            : Number(artifact.size_bytes ?? 0);

        let actualSha256 = "";
        const reader =
          res.body && typeof (res.body as ReadableStream<Uint8Array>).getReader === "function"
            ? (res.body as ReadableStream<Uint8Array>).getReader()
            : null;

        if (reader) {
          const hash = createHash("sha256");
          const fd = openSync(partPath, "w");
          let receivedBytes = 0;
          let lastEmitAt = Date.now();
          let lastEmitPct = 10;
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (!value || value.byteLength === 0) continue;
              const buf = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
              writeSync(fd, buf);
              hash.update(buf);
              receivedBytes += buf.byteLength;
              if (expectedTotalBytes > 0) {
                const pct = Math.min(78, Math.max(10, Math.round(10 + (receivedBytes / expectedTotalBytes) * 68)));
                const now = Date.now();
                if (pct - lastEmitPct >= 3 || now - lastEmitAt >= 400) {
                  lastEmitPct = pct;
                  lastEmitAt = now;
                  this.#progressPercent = pct;
                  this.emitStatus();
                }
              }
            }
          } finally {
            closeSync(fd);
          }
          this.#state = "verifying";
          this.#progressPercent = 80;
          this.emitStatus();
          actualSha256 = hash.digest("hex").toLowerCase();
        } else {
          const rawBytes = Buffer.from(await res.arrayBuffer());
          this.#state = "verifying";
          this.#progressPercent = 80;
          this.emitStatus();
          actualSha256 = createHash("sha256").update(rawBytes).digest("hex").toLowerCase();
          writeFileSync(partPath, rawBytes);
        }

        if (!expectedSha256 || actualSha256 !== expectedSha256) {
          rmSync(partPath, { force: true });
          this.#state = "error";
          this.#progressPercent = 0;
          this.#errorMessage = `Falha na verificação SHA-256 do pacote '${artifact.filename}'. Atualização abortada por segurança.`;
          this.emitStatus();
          const err = new Error(this.#errorMessage) as Error & { statusCode?: number; code?: string };
          err.statusCode = 422;
          err.code = "sha256_mismatch";
          throw err;
        }

        rmSync(stagedPath, { force: true });
        renameSync(partPath, stagedPath);
      }

      this.#state = "applying";
      this.#progressPercent = 88;
      this.emitStatus();

      const targetRoot = resolve(options?.targetProductDir ?? this.#paths.productRoot);
      let appliedHotBundle = false;
      const stagedSizeBytes = statSync(stagedPath).size;
      const shouldInspectHotBundle =
        safeFileName.toLowerCase().endsWith(".json") || stagedSizeBytes <= 10 * 1024 * 1024;
      if (shouldInspectHotBundle) {
        try {
          const maybeText = readFileSync(stagedPath, "utf8");
          if (maybeText.trimStart().startsWith("{")) {
            const parsed = JSON.parse(maybeText) as Partial<UpdateBundlePayloadV1 | UpdateBundlePayloadV2>;
            if (
              parsed.format === "criativo-update-bundle-v1" &&
              parsed.files &&
              typeof parsed.files === "object" &&
              !Array.isArray(parsed.files)
            ) {
              for (const [relPath, fileContent] of Object.entries(parsed.files)) {
                writeSafeProductEntry(targetRoot, relPath, String(fileContent));
              }
              appliedHotBundle = true;
            } else if (
              parsed.format === "criativo-update-bundle-v2" &&
              Array.isArray(parsed.files)
            ) {
              for (const entry of parsed.files) {
                if (!entry || typeof entry.path !== "string" || typeof entry.content !== "string") continue;
                const data =
                  entry.encoding === "base64"
                    ? Buffer.from(entry.content, "base64")
                    : entry.content;
                writeSafeProductEntry(targetRoot, entry.path, data);
              }
              appliedHotBundle = true;
            }
          }
        } catch {
          if (!existsSync(stagedPath)) {
            rmSync(stagedPath, { force: true });
          }
        }
      }

      this.#stagedArtifactPath = stagedPath;
      this.#stagedArtifactName = safeFileName;
      this.#installMode =
        appliedHotBundle || safeFileName.toLowerCase().endsWith(".json")
          ? "hot_bundle"
          : "native_installer";

      this.#currentVersion = manifest.version;
      this.#state = "ready_to_restart";
      this.#progressPercent = 100;
      this.#errorMessage = null;
      return this.emitStatus();
    };

    const promise = runDownload();
    this.#inFlightDownload = promise;
    if (options?.restartAfterApply) {
      this.#restartPendingAfterDownload = true;
    }
    let finalSnapshot: UpdateStatusSnapshot;
    try {
      finalSnapshot = await promise;
    } finally {
      if (this.#inFlightDownload === promise) {
        this.#inFlightDownload = null;
      }
    }

    if ((options?.restartAfterApply || this.#restartPendingAfterDownload) && finalSnapshot.state === "ready_to_restart") {
      this.#restartPendingAfterDownload = false;
      await this.triggerRestart({ force: options?.forceRestart === true });
    }

    return finalSnapshot;
  }
}
