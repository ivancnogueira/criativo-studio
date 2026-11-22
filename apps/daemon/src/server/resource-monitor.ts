import { statfsSync } from "node:fs";
import os from "node:os";
import type {
  HostResourceSnapshot,
  TrackedBackgroundProcess,
  TrackedBackgroundProcessKind,
} from "@criativo/contracts";

interface TrackedProcessEntry {
  pid: number;
  kind: TrackedBackgroundProcessKind;
  label: string;
  startedAtMs: number;
  startedAtIso: string;
  memoryMbHint?: number;
  onKill?: () => void;
}

interface CpuSample {
  idle: number;
  total: number;
}

function captureCpuSample(): CpuSample {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total +=
      cpu.times.user +
      cpu.times.nice +
      cpu.times.sys +
      cpu.times.idle +
      cpu.times.irq;
  }
  return { idle, total };
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class ProcessControlError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode = 403) {
    super(message);
    this.name = "ProcessControlError";
    this.statusCode = statusCode;
  }
}

/**
 * Monitor leve de recursos do host (CPU, RAM, Disco) e registro seguro de processos filhos (G-24).
 */
export class HostResourceMonitorService {
  private readonly workspaceRoot: string;
  private readonly trackedProcesses = new Map<number, TrackedProcessEntry>();
  private lastCpuSample: CpuSample = captureCpuSample();

  constructor(options: { workspaceRoot?: string } = {}) {
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
  }

  public registerProcess(params: {
    pid: number;
    kind: TrackedBackgroundProcessKind;
    label: string;
    memoryMbHint?: number;
    onKill?: () => void;
  }): void {
    if (!Number.isInteger(params.pid) || params.pid <= 0 || params.pid === process.pid) {
      return;
    }
    const now = Date.now();
    this.trackedProcesses.set(params.pid, {
      pid: params.pid,
      kind: params.kind,
      label: params.label.trim() || params.kind,
      startedAtMs: now,
      startedAtIso: new Date(now).toISOString(),
      memoryMbHint: params.memoryMbHint,
      onKill: params.onKill,
    });
  }

  public unregisterProcess(pid: number): void {
    this.trackedProcesses.delete(pid);
  }

  public isTrackedPid(pid: number): boolean {
    return this.trackedProcesses.has(pid);
  }

  public killTrackedProcess(pid: number): { ok: true; pid: number; label: string } {
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new ProcessControlError("PID inválido.", 400);
    }
    if (pid === process.pid) {
      throw new ProcessControlError("Não é permitido encerrar o próprio processo principal do daemon.", 403);
    }
    const entry = this.trackedProcesses.get(pid);
    if (!entry) {
      throw new ProcessControlError(
        `PID ${pid} não pertence aos processos filhos rastreados pelo Criativo Daemon.`,
        403,
      );
    }

    try {
      if (entry.onKill) {
        entry.onKill();
      } else {
        process.kill(pid, "SIGTERM");
      }
    } catch {
      // Processo pode já ter saído
    }
    this.trackedProcesses.delete(pid);
    return { ok: true, pid, label: entry.label };
  }

  public getSnapshot(): HostResourceSnapshot {
    const now = Date.now();
    const cpus = os.cpus();
    const cpuCount = Math.max(1, cpus.length);
    const nextSample = captureCpuSample();
    const idleDelta = nextSample.idle - this.lastCpuSample.idle;
    const totalDelta = nextSample.total - this.lastCpuSample.total;
    this.lastCpuSample = nextSample;

    let cpuPercent = 0;
    if (totalDelta > 0) {
      cpuPercent = Math.max(0, Math.min(100, Math.round(((totalDelta - idleDelta) / totalDelta) * 1000) / 10));
    } else {
      const load = os.loadavg()[0] ?? 0;
      cpuPercent = Math.max(0, Math.min(100, Math.round((load / cpuCount) * 1000) / 10));
    }

    const totalMemMb = Math.round(os.totalmem() / (1024 * 1024));
    const freeMemMb = Math.round(os.freemem() / (1024 * 1024));
    const usedMemMb = Math.max(0, totalMemMb - freeMemMb);
    const memoryPercent =
      totalMemMb > 0 ? Math.round((usedMemMb / totalMemMb) * 1000) / 10 : 0;
    const daemonRssMb = Math.round(process.memoryUsage().rss / (1024 * 1024));

    let diskTotalGb = 0;
    let diskFreeGb = 0;
    let diskPercent = 0;
    try {
      const fsStat = statfsSync(this.workspaceRoot);
      const totalBytes = Number(fsStat.blocks) * Number(fsStat.bsize);
      const freeBytes = Number(fsStat.bavail) * Number(fsStat.bsize);
      const usedBytes = Math.max(0, totalBytes - freeBytes);
      diskTotalGb = Math.round((totalBytes / (1024 ** 3)) * 10) / 10;
      diskFreeGb = Math.round((freeBytes / (1024 ** 3)) * 10) / 10;
      diskPercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0;
    } catch {
      // Ambiente sem suporte a statfsSync mantém zeros seguros
    }

    const activeProcesses: TrackedBackgroundProcess[] = [];
    for (const [pid, entry] of this.trackedProcesses.entries()) {
      if (!entry.onKill && !isPidAlive(pid)) {
        this.trackedProcesses.delete(pid);
        continue;
      }
      activeProcesses.push({
        pid: entry.pid,
        kind: entry.kind,
        label: entry.label,
        started_at: entry.startedAtIso,
        uptime_ms: Math.max(0, now - entry.startedAtMs),
        memory_mb: entry.memoryMbHint ?? 0,
        can_kill: true,
      });
    }

    return {
      timestamp: new Date(now).toISOString(),
      platform: process.platform,
      hostname: os.hostname(),
      cpus: cpuCount,
      cpu_percent: cpuPercent,
      memory_total_mb: totalMemMb,
      memory_used_mb: usedMemMb,
      memory_free_mb: freeMemMb,
      memory_percent: memoryPercent,
      daemon_rss_mb: daemonRssMb,
      disk_total_gb: diskTotalGb,
      disk_free_gb: diskFreeGb,
      disk_percent: diskPercent,
      processes: activeProcesses.sort((a, b) => b.uptime_ms - a.uptime_ms),
    };
  }
}
