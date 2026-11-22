import React, { useEffect, useState } from "react";
import type { InstanceTransferJob, InstanceTransferScope } from "@criativo/contracts";
import { ArrowRightLeft, Download, ShieldCheck, X } from "lucide-react";
import { daemonApi } from "../../services/websocket-client";

export const InstanceTransferModal: React.FC<{
  open: boolean;
  onClose: () => void;
}> = ({ open, onClose }) => {
  const [scope, setScope] = useState<InstanceTransferScope>({
    agents: true,
    memories: true,
    workflows: true,
    routines: true,
    library: true,
    preferences: true,
  });
  const [history, setHistory] = useState<InstanceTransferJob[]>([]);
  const [lastExport, setLastExport] = useState<{
    jobId: string;
    chunksCount: number;
    sha256: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadHistory = async () => {
    try {
      setHistory(await daemonApi.listTransferHistory());
    } catch {
      // ignora em offline/SSR
    }
  };

  useEffect(() => {
    if (open) void loadHistory();
  }, [open]);

  if (!open) return null;

  const handleExport = async () => {
    setBusy(true);
    try {
      const res = await daemonApi.exportInstanceBundle(scope);
      setLastExport({
        jobId: res.manifest.jobId,
        chunksCount: res.chunks.length,
        sha256: res.manifest.payloadSha256,
      });
      const blob = new Blob([JSON.stringify(res, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `criativo-transfer-${res.manifest.jobId}.criativo-transfer.json`;
      a.click();
      URL.revokeObjectURL(url);
      await loadHistory();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Migração e Transferência de Instância"
      data-testid="instance-transfer-modal"
      className="fixed inset-0 z-[75] bg-black/75 flex items-center justify-center p-4"
    >
      <div className="w-full max-w-[540px] rounded-2xl bg-[#1E1E22] border border-white/15 shadow-2xl p-5 space-y-4">
        <header className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4 text-[#31CF76]" />
            <h3 className="text-[14.5px] font-semibold text-white">
              Migração / Transferência de Instância
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar transferência"
            className="text-[#9E9EA6] hover:text-white p-1"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="rounded-xl bg-[#141414] border border-white/[0.06] p-3 flex items-center gap-2.5 text-[12px] text-[#DCDCDC]">
          <ShieldCheck className="h-4 w-4 text-[#31CF76] shrink-0" />
          <span>
            Pacotes gerados em chunks verificados por SHA-256. Chaves e senhas do Cofre são excluídas automaticamente por padrão.
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["agents", "Agentes & Prompts"],
              ["memories", "Memórias"],
              ["workflows", "Workflows"],
              ["routines", "Rotinas"],
              ["library", "Biblioteca / Arquivos"],
              ["preferences", "Preferências"],
            ] as const
          ).map(([key, label]) => (
            <label
              key={key}
              className="flex items-center gap-2 rounded-xl bg-[#141414] border border-white/[0.07] px-3 py-2 text-[12px] text-white cursor-pointer"
            >
              <input
                type="checkbox"
                checked={scope[key]}
                onChange={(e) =>
                  setScope((prev) => ({ ...prev, [key]: e.target.checked }))
                }
                className="accent-[#31CF76]"
              />
              <span>{label}</span>
            </label>
          ))}
        </div>

        {lastExport && (
          <div className="rounded-xl bg-[#31CF76]/10 border border-[#31CF76]/30 p-3 text-[11.5px] text-[#31CF76] font-mono">
            Exportado {lastExport.jobId} ({lastExport.chunksCount} chunk(s)) · SHA-256:{" "}
            {lastExport.sha256.slice(0, 16)}…
          </div>
        )}

        {history.length > 0 && (
          <div className="max-h-28 overflow-y-auto space-y-1 text-[11px] text-[#9E9EA6]">
            {history.slice(0, 5).map((h) => (
              <div key={h.jobId} className="flex justify-between">
                <span>
                  {h.direction.toUpperCase()} · {h.jobId} ({h.status})
                </span>
                <span>
                  {h.completedChunks}/{h.totalChunks} chunks
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-3.5 py-2 text-[12.5px] text-[#DCDCDC] hover:text-white"
          >
            Fechar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleExport()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#F0F0F0] hover:bg-white px-4 py-2 text-[12.5px] font-semibold text-[#141414] disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            <span>{busy ? "Gerando pacote..." : "Exportar pacote (.criativo-transfer)"}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
