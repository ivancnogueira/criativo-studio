import React, { useState } from "react";
import type { LicenseActivationStatus, LicenseDeviceRecord } from "@criativo/contracts";
import { CheckCircle2, KeyRound, Laptop, Lock, RefreshCw, Server, ShieldCheck, Trash2 } from "lucide-react";

export interface SettingsLicenseTabProps {
  status: LicenseActivationStatus | null;
  onRefreshLicense?: () => Promise<void>;
  onDeactivateDevice?: (payload: {
    target_machine_id: string;
    license_key?: string;
    email?: string;
  }) => Promise<{ ok: boolean; devices: LicenseDeviceRecord[]; status?: LicenseActivationStatus }>;
}

function progressPercent(used: number, max: number): number {
  if (max < 0) return Math.min(100, Math.max(12, used * 8));
  if (max <= 0) return 0;
  return Math.min(100, Math.round((used / max) * 100));
}

export const SettingsLicenseTab: React.FC<SettingsLicenseTabProps> = ({
  status,
  onRefreshLicense,
  onDeactivateDevice,
}) => {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  if (!status) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-[#212121] p-5 text-[12.5px] text-[#979797]">
        Carregando informações da licença...
      </div>
    );
  }

  const handleSync = async () => {
    if (!onRefreshLicense) return;
    setBusy(true);
    setFeedback(null);
    try {
      await onRefreshLicense();
      setFeedback("Licença e módulos sincronizados com o servidor central.");
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Falha ao sincronizar licença.");
    } finally {
      setBusy(false);
    }
  };

  const handleUnlink = async (machineId: string) => {
    if (!onDeactivateDevice) return;
    setBusy(true);
    setFeedback(null);
    try {
      await onDeactivateDevice({ target_machine_id: machineId });
      setFeedback("Dispositivo desvinculado com sucesso.");
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Erro ao desvincular computador.");
    } finally {
      setBusy(false);
    }
  };

  const hasBonus = status.upgrades.includes("bonus");
  const hasVideo = status.upgrades.includes("video");
  const serversUnlimited = status.max_servers < 0;

  return (
    <div className="space-y-5">
      {/* Resumo do Plano */}
      <div className="rounded-xl border border-white/[0.08] bg-[#212121] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-[#1A1A1A] border border-white/10 flex items-center justify-center">
              <ShieldCheck className="h-5 w-5 text-[#31CF76]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[14px] font-semibold text-white">{status.plan_label}</h3>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
                    status.valid
                      ? "bg-[#31CF76]/15 text-[#31CF76]"
                      : "bg-[#FF7675]/15 text-[#FF7675]"
                  }`}
                >
                  {status.valid ? "Ativa" : status.status_code}
                </span>
              </div>
              <div className="text-[11.5px] text-[#979797] flex flex-wrap items-center gap-2">
                {status.customer_email && <span>{status.customer_email}</span>}
                {status.masked_key && (
                  <span className="font-mono text-[#DCDCDC] bg-[#141414] px-1.5 py-0.5 rounded">
                    {status.masked_key}
                  </span>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={() => void handleSync()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#2A2A2A] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#333333] disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
            <span>Sincronizar licença / Verificar upgrades</span>
          </button>
        </div>

        {typeof status.offline_days_remaining === "number" && (
          <div className="text-[11px] text-[#787878]">
            Validação local assinada (Ed25519) · Tolerância offline restante:{" "}
            <strong className="text-[#DCDCDC]">{status.offline_days_remaining} dia(s)</strong>
          </div>
        )}
      </div>

      {feedback && (
        <div className="rounded-xl border border-white/10 bg-[#141414] px-3.5 py-2 text-[12px] text-[#DCDCDC]">
          {feedback}
        </div>
      )}

      {/* Barras de Cota */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-xl border border-white/[0.06] bg-[#212121] p-4 space-y-2.5">
          <div className="flex items-center justify-between text-[12px]">
            <span className="inline-flex items-center gap-1.5 font-semibold text-[#DCDCDC]">
              <Server className="h-3.5 w-3.5 text-[#42A0FF]" />
              <span>Servidores (Marcas / VPS)</span>
            </span>
            <span className="font-mono text-white">
              {status.servers_used} / {serversUnlimited ? "Ilimitado" : status.max_servers}
            </span>
          </div>
          <div className="h-2 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-[#42A0FF] transition-all"
              style={{ width: `${progressPercent(status.servers_used, status.max_servers)}%` }}
            />
          </div>
          <p className="text-[11px] text-[#787878]">
            {serversUnlimited
              ? "Crie quantos servidores locais no PC ou VPSs conectadas quiser."
              : "Soma servidores locais neste computador e VPSs pareadas."}
          </p>
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-[#212121] p-4 space-y-2.5">
          <div className="flex items-center justify-between text-[12px]">
            <span className="inline-flex items-center gap-1.5 font-semibold text-[#DCDCDC]">
              <Laptop className="h-3.5 w-3.5 text-[#31CF76]" />
              <span>Computadores da Equipe</span>
            </span>
            <span className="font-mono text-white">
              {status.machines_used} / {status.max_machines}
            </span>
          </div>
          <div className="h-2 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-[#31CF76] transition-all"
              style={{ width: `${progressPercent(status.machines_used, status.max_machines)}%` }}
            />
          </div>
          <p className="text-[11px] text-[#787878]">
            Limite de dispositivos simultâneos vinculados pelo hardware fingerprint.
          </p>
        </div>
      </div>

      {/* Módulos e Upgrades */}
      <div className="rounded-xl border border-white/[0.06] bg-[#212121] p-4 space-y-3">
        <div className="flex items-center gap-2 text-[12.5px] font-semibold text-white">
          <KeyRound className="h-4 w-4 text-[#F59E0B]" />
          <span>Upgrades Assinados na Licença</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {[
            {
              id: "bonus",
              title: "Pacote Criativos Bônus (3 Especialistas)",
              unlocked: hasBonus,
            },
            {
              id: "video",
              title: "Criativo Video Studio (Remotion + Roteiristas)",
              unlocked: hasVideo,
            },
          ].map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-[#1A1A1A] px-3 py-2.5"
            >
              <span className="text-[12px] font-medium text-[#DCDCDC] truncate pr-2">
                {item.title}
              </span>
              {item.unlocked ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#31CF76]/15 px-2 py-0.5 text-[10.5px] font-semibold text-[#31CF76] shrink-0">
                  <CheckCircle2 className="h-3 w-3" />
                  <span>Liberado</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10.5px] font-semibold text-[#979797] shrink-0">
                  <Lock className="h-3 w-3" />
                  <span>Não incluído</span>
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Lista de Dispositivos Vinculados */}
      <div className="rounded-xl border border-white/[0.06] bg-[#212121] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-[12.5px] font-semibold text-white">
            Computadores Vinculados ({status.devices.length})
          </h4>
          <span className="text-[11px] text-[#787878]">Até 2 trocas self-service por mês</span>
        </div>
        <div className="space-y-2">
          {status.devices.map((dev) => (
            <div
              key={dev.machine_id}
              className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-[#1A1A1A] px-3 py-2"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Laptop className="h-4 w-4 text-[#979797] shrink-0" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-semibold text-white truncate">
                      {dev.hostname}
                    </span>
                    {dev.is_current_machine && (
                      <span className="rounded bg-[#007CF7]/20 px-1.5 py-0.5 text-[10px] font-semibold text-[#42A0FF]">
                        Este PC
                      </span>
                    )}
                  </div>
                  <div className="text-[10.5px] text-[#787878] truncate">
                    {dev.os_platform} · Último check:{" "}
                    {new Date(dev.last_heartbeat_at).toLocaleDateString("pt-BR")}
                  </div>
                </div>
              </div>
              {onDeactivateDevice && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleUnlink(dev.machine_id)}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-[#242424] px-2.5 py-1.5 text-[11px] font-semibold text-[#DCDCDC] hover:bg-[#2F2F2F] shrink-0 disabled:opacity-50"
                >
                  <Trash2 className="h-3 w-3 text-[#FF7675]" />
                  <span>{dev.is_current_machine ? "Desativar este PC" : "Desvincular"}</span>
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
