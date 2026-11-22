import React, { useEffect, useState } from "react";
import type { TelemetryStatusSnapshot } from "@criativo/contracts";
import { ShieldCheck } from "lucide-react";
import { daemonApi } from "../../services/websocket-client";

export const SettingsTelemetryCard: React.FC<{
  optIn: boolean;
  onChangeOptIn: (next: boolean) => void;
}> = ({ optIn, onChangeOptIn }) => {
  const [status, setStatus] = useState<TelemetryStatusSnapshot | null>(null);
  const [showSample, setShowSample] = useState(false);

  useEffect(() => {
    void daemonApi
      .getTelemetryStatus()
      .then(setStatus)
      .catch(() => {});
  }, []);

  const handleToggle = () => {
    const next = !optIn;
    onChangeOptIn(next);
    void daemonApi
      .setTelemetryOptIn(next)
      .then(setStatus)
      .catch(() => {});
  };

  return (
    <div
      data-testid="telemetry-optin-card"
      className="rounded-xl border border-white/[0.06] bg-[#212121] p-4 space-y-3"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-white">
            <ShieldCheck className="h-4 w-4 text-[#31CF76]" />
            <span>Telemetria técnica diagnóstica (Opt-in)</span>
          </div>
          <p className="text-[11.5px] text-[#979797]">
            Desativada por padrão. Quando ativa, registra apenas versão, SO, código de erro (`CRV-*`) e duração após remoção automática de caminhos pessoais, tokens, e-mails, handles `@` e prompts.
          </p>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={optIn}
          aria-label="Telemetria técnica diagnóstica"
          onClick={handleToggle}
          className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border transition-colors ${
            optIn ? "border-[#007CF7] bg-[#007CF7]" : "border-white/15 bg-[#141414]"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-3.5 w-3.5 translate-y-0.5 rounded-full bg-white transition-transform ${
              optIn ? "translate-x-4" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      <div className="flex items-center justify-between gap-2 text-[11px] text-[#8E8E93]">
        <span>
          Status: {optIn ? "Ativa (redação estrita)" : "Desativada (zero coleta)"} · Eventos no buffer:{" "}
          {status?.bufferedCount ?? 0}
        </span>
        <button
          type="button"
          onClick={() => setShowSample((s) => !s)}
          className="text-[#74B9FF] hover:underline"
        >
          {showSample ? "Ocultar amostra redigida" : "Inspecionar amostra redigida"}
        </button>
      </div>

      {showSample && status?.lastSample && (
        <pre className="rounded-lg bg-[#141414] border border-white/[0.06] p-2.5 text-[11px] font-mono text-[#DCDCDC] overflow-x-auto">
          {JSON.stringify(status.lastSample, null, 2)}
        </pre>
      )}
    </div>
  );
};
