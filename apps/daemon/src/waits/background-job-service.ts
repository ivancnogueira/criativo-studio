import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { CriativoDatabase } from "../database/client.ts";
import { resolveAgentIdFromDb } from "../server/agent-resolver.ts";
import {
  assertAgentPermissionForPath,
  readAgentGovernance,
} from "../server/tools/phase15-governance.ts";
import type { WebSocketHub } from "../server/websocket-hub.ts";

export const MAX_ACTIVE_BG_JOBS_PER_AGENT = 4;
export const DEFAULT_BG_JOB_TIMEOUT_SECONDS = 3600;
export const MAX_BG_JOB_TIMEOUT_SECONDS = 14400;
export const MAX_OUTPUT_TAIL_CHARS = 12_000;
const MAX_COMPLETED_HISTORY = 100;

export type BackgroundJobStatus =
  | "executando"
  | "concluido"
  | "falha"
  | "cancelado"
  | "timeout";

export type BackgroundJobKind = "command" | "async_task";

export interface BackgroundJobContext {
  agenteId: string;
  canalId?: string | null;
  threadId?: string | null;
  channelOrigin?: "web" | "whatsapp" | string | null;
  whatsappContaId?: string | null;
  whatsappChatJid?: string | null;
  workspaceRoot?: string;
}

export interface StartBackgroundCommandInput {
  label: string;
  command?: string;
  executable?: string;
  args?: string[];
  cwd?: string;
  onCompleteInstruction: string;
  timeoutSeconds?: number;
  notifyOnComplete?: boolean;
}

export interface StartBackgroundAsyncTaskInput {
  label: string;
  onCompleteInstruction: string;
  timeoutSeconds?: number;
  notifyOnComplete?: boolean;
  run: (signal: AbortSignal) => Promise<unknown>;
}

export interface BackgroundJobSnapshot {
  jobId: string;
  agenteId: string;
  threadId: string;
  canalId: string;
  channelOrigin: "web" | "whatsapp";
  whatsappContaId: string | null;
  whatsappChatJid: string | null;
  kind: BackgroundJobKind;
  label: string;
  commandSummary: string;
  cwd: string;
  status: BackgroundJobStatus;
  pid: number | null;
  exitCode: number | null;
  signal: string | null;
  onCompleteInstruction: string;
  notifyOnComplete: boolean;
  logPath: string | null;
  stdoutTail: string;
  stderrTail: string;
  resultSummary: string | null;
  erro: string | null;
  iniciadoEm: string;
  finalizadoEm: string | null;
  duracaoMs: number;
}

export interface BackgroundJobServiceDeps {
  db: CriativoDatabase;
  wsHub?: WebSocketHub;
  workspaceRoot?: string;
}

interface InternalJobRecord {
  snapshot: BackgroundJobSnapshot;
  startedAtMs: number;
  child?: ChildProcess;
  abortController?: AbortController;
  timeoutTimer?: ReturnType<typeof setTimeout>;
  manuallyCancelled: boolean;
}

/**
 * Resolve o comando de shell nativo do sistema operacional atual (Windows, macOS ou Linux).
 */
export function resolveCrossPlatformShellCommand(command: string): {
  file: string;
  args: string[];
} {
  if (process.platform === "win32") {
    return {
      file: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-Command", command],
    };
  }
  return {
    file: "/bin/sh",
    args: ["-c", command],
  };
}

function appendTail(current: string, chunk: string): string {
  const next = current + chunk;
  if (next.length <= MAX_OUTPUT_TAIL_CHARS) return next;
  return next.slice(next.length - MAX_OUTPUT_TAIL_CHARS);
}

function clampTimeoutSeconds(raw?: number): number {
  if (raw === undefined || !Number.isFinite(raw)) {
    return DEFAULT_BG_JOB_TIMEOUT_SECONDS;
  }
  const rounded = Math.round(raw);
  return Math.min(MAX_BG_JOB_TIMEOUT_SECONDS, Math.max(5, rounded));
}

function safeWriteLog(logPath: string | null, text: string): void {
  if (!logPath || !text) return;
  try {
    appendFileSync(logPath, text, "utf8");
  } catch {
    // Falha de disco não interrompe o job
  }
}

function killProcessTree(child: ChildProcess | undefined): void {
  if (!child) return;
  const pid = child.pid;
  if (typeof pid !== "number" || pid <= 0) {
    try {
      child.kill();
    } catch {
      // ignora
    }
    return;
  }
  if (process.platform === "win32") {
    try {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killer.unref?.();
    } catch {
      try {
        child.kill();
      } catch {
        // ignora
      }
    }
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
    const forceTimer = setTimeout(() => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // processo já encerrou
      }
    }, 2000);
    forceTimer.unref?.();
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // ignora
    }
  }
}

function serializeResultSummary(val: unknown): string {
  if (val === undefined) return "ok";
  if (typeof val === "string") {
    return val.length > MAX_OUTPUT_TAIL_CHARS
      ? val.slice(0, MAX_OUTPUT_TAIL_CHARS)
      : val;
  }
  try {
    const json = JSON.stringify(val, null, 2);
    if (json.length <= MAX_OUTPUT_TAIL_CHARS) return json;
    return `${json.slice(0, MAX_OUTPUT_TAIL_CHARS - 24)}\n... [truncado]`;
  } catch {
    return String(val).slice(0, MAX_OUTPUT_TAIL_CHARS);
  }
}

/**
 * Gerenciador universal de tarefas em segundo plano (comandos cross-platform e renders/tasks internas).
 * Mantém processos vivos independentemente do encerramento do turno do modelo e acorda o agente ao terminar.
 */
export class BackgroundJobService {
  private readonly db: CriativoDatabase;
  private readonly wsHub?: WebSocketHub;
  private readonly defaultWorkspaceRoot: string;
  private readonly jobs = new Map<string, InternalJobRecord>();
  private onComplete?: (job: BackgroundJobSnapshot) => Promise<void> | void;
  private disposed = false;

  constructor(deps: BackgroundJobServiceDeps) {
    this.db = deps.db;
    this.wsHub = deps.wsHub;
    this.defaultWorkspaceRoot = resolve(deps.workspaceRoot ?? process.cwd());
  }

  public setOnComplete(
    handler: (job: BackgroundJobSnapshot) => Promise<void> | void
  ): void {
    this.onComplete = handler;
  }

  private resolveCanonicalAgentId(rawAgentId: string): string {
    const trimmed = String(rawAgentId ?? "").trim();
    if (!trimmed) {
      throw new Error("Informe um agente válido para o background job.");
    }
    const resolved = resolveAgentIdFromDb(this.db, trimmed) ?? trimmed;
    const exists = this.db.connection
      .prepare("SELECT agente_id FROM projecao_agentes WHERE agente_id = ? LIMIT 1;")
      .get(resolved) as { agente_id: string } | undefined;
    return exists ? exists.agente_id : trimmed;
  }

  private assertAgentCapacity(agenteId: string): void {
    let activeCount = 0;
    for (const rec of this.jobs.values()) {
      if (rec.snapshot.agenteId === agenteId && rec.snapshot.status === "executando") {
        activeCount += 1;
      }
    }
    if (activeCount >= MAX_ACTIVE_BG_JOBS_PER_AGENT) {
      throw new Error(
        `Limite de ${MAX_ACTIVE_BG_JOBS_PER_AGENT} background jobs ativos atingido para o agente '${agenteId}'. Aguarde ou cancele um job antes de abrir outro.`
      );
    }
  }

  private resolveSafeCwd(
    agenteId: string,
    workspaceRoot: string,
    rawCwd?: string
  ): string {
    const wsAbs = resolve(workspaceRoot);
    if (!rawCwd || !rawCwd.trim()) {
      return wsAbs;
    }
    const trimmed = rawCwd.trim();
    const targetAbs = isAbsolute(trimmed) ? resolve(trimmed) : resolve(wsAbs, trimmed);
    if (targetAbs === wsAbs) {
      return wsAbs;
    }
    const gov = readAgentGovernance(this.db, agenteId);
    assertAgentPermissionForPath({
      rawPath: targetAbs,
      workspaceRoot: wsAbs,
      permissionLevel: gov.permissionLevel,
      agenteId,
      operation: "write",
      allowedFolders: gov.allowedFolders,
    });
    return targetAbs;
  }

  private createLogFile(workspaceRoot: string, jobId: string): string | null {
    try {
      const logDir = join(resolve(workspaceRoot), ".criativo", "bg-jobs");
      mkdirSync(logDir, { recursive: true });
      return join(logDir, `${jobId}.log`);
    } catch {
      return null;
    }
  }

  private emitJobUpdate(snapshot: BackgroundJobSnapshot): void {
    this.wsHub?.broadcast("background_job:updated", {
      job_id: snapshot.jobId,
      agente_id: snapshot.agenteId,
      thread_id: snapshot.threadId,
      kind: snapshot.kind,
      label: snapshot.label,
      status: snapshot.status,
      duracao_ms: snapshot.duracaoMs,
    });
  }

  private pruneHistoryIfNeeded(): void {
    const completed: Array<{ id: string; finishedAt: string }> = [];
    for (const [id, rec] of this.jobs.entries()) {
      if (rec.snapshot.status !== "executando") {
        completed.push({ id, finishedAt: rec.snapshot.finalizadoEm ?? rec.snapshot.iniciadoEm });
      }
    }
    if (completed.length <= MAX_COMPLETED_HISTORY) return;
    completed.sort((a, b) => a.finishedAt.localeCompare(b.finishedAt));
    const excess = completed.length - MAX_COMPLETED_HISTORY;
    for (let i = 0; i < excess; i += 1) {
      this.jobs.delete(completed[i]!.id);
    }
  }

  private finalizeRecord(
    rec: InternalJobRecord,
    finalStatus: Exclude<BackgroundJobStatus, "executando">,
    updates?: {
      exitCode?: number | null;
      signal?: string | null;
      resultSummary?: string | null;
      erro?: string | null;
    }
  ): void {
    if (rec.snapshot.status !== "executando") return;
    if (rec.timeoutTimer) {
      clearTimeout(rec.timeoutTimer);
      rec.timeoutTimer = undefined;
    }
    const nowMs = Date.now();
    rec.snapshot = {
      ...rec.snapshot,
      status: finalStatus,
      exitCode: updates?.exitCode !== undefined ? updates.exitCode : rec.snapshot.exitCode,
      signal: updates?.signal !== undefined ? updates.signal : rec.snapshot.signal,
      resultSummary:
        updates?.resultSummary !== undefined
          ? updates.resultSummary
          : rec.snapshot.resultSummary,
      erro: updates?.erro !== undefined ? updates.erro : rec.snapshot.erro,
      finalizadoEm: new Date(nowMs).toISOString(),
      duracaoMs: Math.max(0, nowMs - rec.startedAtMs),
    };
    this.emitJobUpdate(rec.snapshot);
    this.pruneHistoryIfNeeded();

    if (
      !this.disposed &&
      !rec.manuallyCancelled &&
      finalStatus !== "cancelado" &&
      rec.snapshot.notifyOnComplete &&
      this.onComplete
    ) {
      const snapCopy: BackgroundJobSnapshot = { ...rec.snapshot };
      void Promise.resolve(this.onComplete(snapCopy)).catch(() => {
        // Falha no callback de despertar não derruba o daemon
      });
    }
  }

  public startCommandJob(
    ctx: BackgroundJobContext,
    input: StartBackgroundCommandInput
  ): BackgroundJobSnapshot {
    if (this.disposed) {
      throw new Error("BackgroundJobService já encerrado.");
    }
    const agenteId = this.resolveCanonicalAgentId(ctx.agenteId);
    this.assertAgentCapacity(agenteId);

    const label = String(input.label ?? "").trim();
    const onCompleteInstruction = String(input.onCompleteInstruction ?? "").trim();
    const rawCommand = typeof input.command === "string" ? input.command.trim() : "";
    const rawExecutable = typeof input.executable === "string" ? input.executable.trim() : "";
    const rawArgs = Array.isArray(input.args) ? input.args.map((a) => String(a)) : [];

    if (!label) {
      throw new Error("O campo 'label' é obrigatório em start_background_job.");
    }
    if (!onCompleteInstruction) {
      throw new Error(
        "O campo 'onCompleteInstruction' é obrigatório para saber o que fazer ao despertar."
      );
    }
    if (!rawCommand && !rawExecutable) {
      throw new Error(
        "Informe 'command' (shell cross-platform) ou 'executable' (+ 'args' opcionais) em start_background_job."
      );
    }

    const wsRoot = resolve(ctx.workspaceRoot ?? this.defaultWorkspaceRoot);
    const cwd = this.resolveSafeCwd(agenteId, wsRoot, input.cwd);
    const jobId = `bg_${randomUUID().slice(0, 12)}`;
    const threadId = ctx.threadId && !ctx.threadId.startsWith("main:") ? ctx.threadId : `main:${agenteId}`;
    const canalId =
      ctx.canalId ?? (threadId.startsWith("main:") ? `agente:${agenteId}` : `thread:${threadId}`);
    const channelOrigin = ctx.channelOrigin === "whatsapp" ? "whatsapp" : "web";
    const timeoutSeconds = clampTimeoutSeconds(input.timeoutSeconds);
    const logPath = this.createLogFile(wsRoot, jobId);

    const spawnSpec = rawExecutable
      ? { file: rawExecutable, args: rawArgs }
      : resolveCrossPlatformShellCommand(rawCommand);
    const commandSummary = rawExecutable
      ? `${rawExecutable}${rawArgs.length > 0 ? ` ${rawArgs.join(" ")}` : ""}`.slice(0, 400)
      : rawCommand.slice(0, 400);

    const child = spawn(spawnSpec.file, spawnSpec.args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    });

    const startedAtMs = Date.now();
    const rec: InternalJobRecord = {
      startedAtMs,
      child,
      manuallyCancelled: false,
      snapshot: {
        jobId,
        agenteId,
        threadId,
        canalId,
        channelOrigin,
        whatsappContaId: ctx.whatsappContaId ?? null,
        whatsappChatJid: ctx.whatsappChatJid ?? null,
        kind: "command",
        label: label.slice(0, 160),
        commandSummary,
        cwd,
        status: "executando",
        pid: typeof child.pid === "number" ? child.pid : null,
        exitCode: null,
        signal: null,
        onCompleteInstruction: onCompleteInstruction.slice(0, 4000),
        notifyOnComplete: input.notifyOnComplete !== false,
        logPath,
        stdoutTail: "",
        stderrTail: "",
        resultSummary: null,
        erro: null,
        iniciadoEm: new Date(startedAtMs).toISOString(),
        finalizadoEm: null,
        duracaoMs: 0,
      },
    };
    this.jobs.set(jobId, rec);
    safeWriteLog(logPath, `[criativo-bg] jobId=${jobId} label=${label}\n[criativo-bg] cmd=${commandSummary}\n[criativo-bg] cwd=${cwd}\n\n`);
    this.emitJobUpdate(rec.snapshot);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      const txt = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      rec.snapshot.stdoutTail = appendTail(rec.snapshot.stdoutTail, txt);
      safeWriteLog(logPath, txt);
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      const txt = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      rec.snapshot.stderrTail = appendTail(rec.snapshot.stderrTail, txt);
      safeWriteLog(logPath, txt);
    });

    let timedOut = false;
    rec.timeoutTimer = setTimeout(() => {
      if (rec.snapshot.status !== "executando") return;
      timedOut = true;
      killProcessTree(child);
      this.finalizeRecord(rec, "timeout", {
        erro: `Background job excedeu o timeout de ${timeoutSeconds}s.`,
      });
    }, timeoutSeconds * 1000);
    rec.timeoutTimer.unref?.();

    child.on("error", (err) => {
      if (rec.manuallyCancelled || timedOut) return;
      this.finalizeRecord(rec, "falha", {
        erro: err instanceof Error ? err.message : String(err),
      });
    });

    child.on("close", (code, sig) => {
      if (rec.manuallyCancelled) {
        this.finalizeRecord(rec, "cancelado", {
          exitCode: code,
          signal: sig ? String(sig) : null,
        });
        return;
      }
      if (timedOut) return;
      const ok = code === 0;
      this.finalizeRecord(rec, ok ? "concluido" : "falha", {
        exitCode: code,
        signal: sig ? String(sig) : null,
        ...(ok
          ? {}
          : {
              erro:
                rec.snapshot.stderrTail.trim().slice(-400) ||
                `Processo encerrou com código ${code ?? "null"}.`,
            }),
      });
    });

    return { ...rec.snapshot };
  }

  public startAsyncTask(
    ctx: BackgroundJobContext,
    input: StartBackgroundAsyncTaskInput
  ): BackgroundJobSnapshot {
    if (this.disposed) {
      throw new Error("BackgroundJobService já encerrado.");
    }
    const agenteId = this.resolveCanonicalAgentId(ctx.agenteId);
    this.assertAgentCapacity(agenteId);

    const label = String(input.label ?? "").trim();
    const onCompleteInstruction = String(input.onCompleteInstruction ?? "").trim();
    if (!label || !onCompleteInstruction) {
      throw new Error("Informe 'label' e 'onCompleteInstruction' para tarefa em background.");
    }

    const wsRoot = resolve(ctx.workspaceRoot ?? this.defaultWorkspaceRoot);
    const jobId = `bg_${randomUUID().slice(0, 12)}`;
    const threadId = ctx.threadId && !ctx.threadId.startsWith("main:") ? ctx.threadId : `main:${agenteId}`;
    const canalId =
      ctx.canalId ?? (threadId.startsWith("main:") ? `agente:${agenteId}` : `thread:${threadId}`);
    const channelOrigin = ctx.channelOrigin === "whatsapp" ? "whatsapp" : "web";
    const timeoutSeconds = clampTimeoutSeconds(input.timeoutSeconds);
    const abortController = new AbortController();
    const startedAtMs = Date.now();

    const rec: InternalJobRecord = {
      startedAtMs,
      abortController,
      manuallyCancelled: false,
      snapshot: {
        jobId,
        agenteId,
        threadId,
        canalId,
        channelOrigin,
        whatsappContaId: ctx.whatsappContaId ?? null,
        whatsappChatJid: ctx.whatsappChatJid ?? null,
        kind: "async_task",
        label: label.slice(0, 160),
        commandSummary: label.slice(0, 400),
        cwd: wsRoot,
        status: "executando",
        pid: null,
        exitCode: null,
        signal: null,
        onCompleteInstruction: onCompleteInstruction.slice(0, 4000),
        notifyOnComplete: input.notifyOnComplete !== false,
        logPath: null,
        stdoutTail: "",
        stderrTail: "",
        resultSummary: null,
        erro: null,
        iniciadoEm: new Date(startedAtMs).toISOString(),
        finalizadoEm: null,
        duracaoMs: 0,
      },
    };
    this.jobs.set(jobId, rec);
    this.emitJobUpdate(rec.snapshot);

    let timedOut = false;
    rec.timeoutTimer = setTimeout(() => {
      if (rec.snapshot.status !== "executando") return;
      timedOut = true;
      abortController.abort();
      this.finalizeRecord(rec, "timeout", {
        erro: `Tarefa em background excedeu o timeout de ${timeoutSeconds}s.`,
      });
    }, timeoutSeconds * 1000);
    rec.timeoutTimer.unref?.();

    void Promise.resolve()
      .then(() => input.run(abortController.signal))
      .then((res) => {
        if (rec.manuallyCancelled || timedOut) return;
        this.finalizeRecord(rec, "concluido", {
          exitCode: 0,
          resultSummary: serializeResultSummary(res),
        });
      })
      .catch((err) => {
        if (rec.manuallyCancelled) {
          this.finalizeRecord(rec, "cancelado");
          return;
        }
        if (timedOut) return;
        this.finalizeRecord(rec, "falha", {
          exitCode: 1,
          erro: err instanceof Error ? err.message : String(err),
        });
      });

    return { ...rec.snapshot };
  }

  public listJobs(agenteId?: string, includeCompleted = true): BackgroundJobSnapshot[] {
    const canonical = agenteId ? this.resolveCanonicalAgentId(agenteId) : null;
    const out: BackgroundJobSnapshot[] = [];
    const nowMs = Date.now();
    for (const rec of this.jobs.values()) {
      if (canonical && rec.snapshot.agenteId !== canonical) continue;
      if (!includeCompleted && rec.snapshot.status !== "executando") continue;
      const snap = { ...rec.snapshot };
      if (snap.status === "executando") {
        snap.duracaoMs = Math.max(0, nowMs - rec.startedAtMs);
      }
      out.push(snap);
    }
    return out.sort((a, b) => b.iniciadoEm.localeCompare(a.iniciadoEm));
  }

  public getJob(jobId: string, agenteId?: string): BackgroundJobSnapshot | null {
    const rec = this.jobs.get(jobId.trim());
    if (!rec) return null;
    if (agenteId) {
      const canonical = this.resolveCanonicalAgentId(agenteId);
      if (rec.snapshot.agenteId !== canonical) return null;
    }
    const snap = { ...rec.snapshot };
    if (snap.status === "executando") {
      snap.duracaoMs = Math.max(0, Date.now() - rec.startedAtMs);
    }
    return snap;
  }

  public cancelJob(
    jobId: string,
    agenteId?: string
  ): { ok: boolean; jobId: string; status: string; mensagem: string } {
    const cleanId = jobId.trim();
    const rec = this.jobs.get(cleanId);
    if (!rec) {
      return {
        ok: false,
        jobId: cleanId,
        status: "nao_encontrado",
        mensagem: `Background job '${cleanId}' não encontrado.`,
      };
    }
    if (agenteId) {
      const canonical = this.resolveCanonicalAgentId(agenteId);
      if (rec.snapshot.agenteId !== canonical) {
        throw new Error(`Background job '${cleanId}' pertence a outro agente.`);
      }
    }
    if (rec.snapshot.status !== "executando") {
      return {
        ok: false,
        jobId: cleanId,
        status: rec.snapshot.status,
        mensagem: `Background job '${cleanId}' já está no estado '${rec.snapshot.status}'.`,
      };
    }

    rec.manuallyCancelled = true;
    rec.abortController?.abort();
    killProcessTree(rec.child);
    this.finalizeRecord(rec, "cancelado", { erro: "Cancelado pelo usuário ou agente." });
    return {
      ok: true,
      jobId: cleanId,
      status: "cancelado",
      mensagem: `Background job '${cleanId}' encerrado com sucesso.`,
    };
  }

  public hasActiveJobs(agenteId?: string): boolean {
    const canonical = agenteId ? this.resolveCanonicalAgentId(agenteId) : null;
    for (const rec of this.jobs.values()) {
      if (rec.snapshot.status !== "executando") continue;
      if (!canonical || rec.snapshot.agenteId === canonical) return true;
    }
    return false;
  }

  public getFirstActiveJobSummary(): string | null {
    for (const rec of this.jobs.values()) {
      if (rec.snapshot.status === "executando") {
        return `Background job em execução: ${rec.snapshot.label} (${rec.snapshot.jobId})`;
      }
    }
    return null;
  }

  public dispose(): void {
    this.disposed = true;
    for (const rec of this.jobs.values()) {
      if (rec.timeoutTimer) {
        clearTimeout(rec.timeoutTimer);
        rec.timeoutTimer = undefined;
      }
      if (rec.snapshot.status === "executando") {
        rec.manuallyCancelled = true;
        rec.abortController?.abort();
        killProcessTree(rec.child);
      }
    }
  }
}
