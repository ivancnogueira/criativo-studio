import React, { useEffect, useState } from "react";
import type { HostResourceSnapshot } from "@criativo/contracts";
import { Activity, AlertTriangle, Cpu, HardDrive, RefreshCw, Trash2 } from "lucide-react";
import { daemonApi } from "../services/websocket-client";

function formatUptime(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hrs = Math.floor(min / 60);
  return `${hrs}h ${min % 60}m`;
}

export interface HostResourcesPanelProps {
  initialSnapshot?: HostResourceSnapshot | null;
}

/**
 * Painel leve de recursos do host (CPU, RAM, Disco e processos filhos em background) (G-24).
 */
export const HostResourcesPanel: React.FC<HostResourcesPanelProps> = ({
  initialSnapshot = null,
}) => {
  const [snapshot, setSnapshot] = useState<HostResourceSnapshot | null>(initialSnapshot);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSnapshot = async () => {
    setLoading(true);
    try {
      const data = await daemonApi.getHostResources();
      setSnapshot(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao consultar recursos do host");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialSnapshot) return;
    void loadSnapshot();
    const timer = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void loadSnapshot();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [initialSnapshot]);

  const handleKillProcess = async (pid: number) => {
    try {
      await daemonApi.killTrackedHostProcess(pid);
      await loadSnapshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível encerrar processo");
    }
  };

  const memoryHigh = (snapshot?.memory_percent ?? 0) >= 85;

  return (
    <section
      data-testid="host-resources-panel"
      className="rounded-2xl bg-[#1E1E1E] border border-white/[0.06] p-4 space-y-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-[#42A0FF]" />
          <h3 className="text-[12.5px] font-semibold text-white">
            Recursos do Host & Processos em Background
          </h3>
          {snapshot && (
            <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-white/[0.06] text-[#979797]">
              {snapshot.hostname} · {snapshot.cpus} CPU(s)
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void loadSnapshot()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-[#2A2A2A] hover:bg-[#333336] text-[11px] font-medium text-[#DCDCDC] disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          <span>Atualizar</span>
        </button>
      </div>

      {memoryHigh && (
        <div className="flex items-center gap-2 rounded-xl border border-[#FF9412]/35 bg-[#FF9412]/10 px-3 py-2 text-[11.5px] text-[#FF9412]">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            Uso de memória RAM acima de 85% ({snapshot?.memory_percent}%). Considere encerrar renders ou abas ociosas.
          </span>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-[#FD2F3B]/30 bg-[#FD2F3B]/10 px-3 py-2 text-[11.5px] text-[#FF6069]">
          {error}
        </div>
      )}

      {snapshot && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div className="rounded-xl bg-[#161616] border border-white/[0.05] p-3 space-y-1.5">
              <div className="flex items-center justify-between text-[11.5px] text-[#979797]">
                <span className="inline-flex items-center gap-1">
                  <Cpu className="h-3.5 w-3.5 text-[#42A0FF]" /> CPU
                </span>
                <span className="text-white font-semibold tabular-nums">{snapshot.cpu_percent}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full bg-[#42A0FF]"
                  style={{ width: `${Math.min(100, snapshot.cpu_percent)}%` }}
                />
              </div>
              <div className="text-[10.5px] text-[#6A6A6A]">
                Daemon RSS: {snapshot.daemon_rss_mb} MB
              </div>
            </div>

            <div className="rounded-xl bg-[#161616] border border-white/[0.05] p-3 space-y-1.5">
              <div className="flex items-center justify-between text-[11.5px] text-[#979797]">
                <span>Memória RAM</span>
                <span
                  className={`font-semibold tabular-nums ${
                    memoryHigh ? "text-[#FF9412]" : "text-white"
                  }`}
                >
                  {snapshot.memory_percent}%
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className={`h-full rounded-full ${memoryHigh ? "bg-[#FF9412]" : "bg-[#31CF76]"}`}
                  style={{ width: `${Math.min(100, snapshot.memory_percent)}%` }}
                />
              </div>
              <div className="text-[10.5px] text-[#6A6A6A]">
                {snapshot.memory_used_mb} / {snapshot.memory_total_mb} MB
              </div>
            </div>

            <div className="rounded-xl bg-[#161616] border border-white/[0.05] p-3 space-y-1.5">
              <div className="flex items-center justify-between text-[11.5px] text-[#979797]">
                <span className="inline-flex items-center gap-1">
                  <HardDrive className="h-3.5 w-3.5 text-[#DCDCDC]" /> Disco
                </span>
                <span className="text-white font-semibold tabular-nums">{snapshot.disk_percent}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full bg-[#DCDCDC]"
                  style={{ width: `${Math.min(100, snapshot.disk_percent)}%` }}
                />
              </div>
              <div className="text-[10.5px] text-[#6A6A6A]">
                {snapshot.disk_free_gb} GB livres de {snapshot.disk_total_gb} GB
              </div>
            </div>
          </div>

          <div className="rounded-xl bg-[#161616] border border-white/[0.05] p-3 space-y-2">
            <div className="text-[11.5px] font-medium text-[#DCDCDC]">
              Processos filhos ativos ({snapshot.processes.length})
            </div>
            {snapshot.processes.length === 0 ? (
              <div className="text-[11px] text-[#6A6A6A]">
                Nenhum processo pesado ativo no momento.
              </div>
            ) : (
              <div className="space-y-1.5">
                {snapshot.processes.map((proc) => (
                  <div
                    key={proc.pid}
                    className="flex items-center justify-between gap-2 rounded-lg bg-[#101010] border border-white/[0.04] px-2.5 py-1.5 text-[11.5px]"
                  >
                    <div className="min-w-0">
                      <span className="font-medium text-white truncate">{proc.label}</span>
                      <span className="ml-2 text-[10.5px] text-[#787878] tabular-nums">
                        PID {proc.pid} · {proc.kind} · {formatUptime(proc.uptime_ms)}
                        {proc.memory_mb > 0 ? ` · ${proc.memory_mb} MB` : ""}
                      </span>
                    </div>
                    {proc.can_kill && (
                      <button
                        type="button"
                        onClick={() => void handleKillProcess(proc.pid)}
                        className="inline-flex items-center gap-1 rounded-md bg-[#FD2F3B]/15 hover:bg-[#FD2F3B]/25 text-[#FF6069] px-2 py-1 text-[10.5px] font-medium shrink-0"
                      >
                        <Trash2 className="h-3 w-3" />
                        <span>Encerrar</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
};
