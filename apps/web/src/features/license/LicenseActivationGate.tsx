import React, { useState } from "react";
import type { LicenseActivationStatus, LicenseDeviceRecord } from "@criativo/contracts";
import { AlertTriangle, CheckCircle2, KeyRound, Laptop, RefreshCw, ShieldAlert, Trash2 } from "lucide-react";
import { DaemonHttpError } from "../../services/websocket-client";

export interface LicenseActivationGateProps {
  status: LicenseActivationStatus;
  onActivate: (payload: { license_key: string; email: string }) => Promise<LicenseActivationStatus>;
  onDeactivateDevice: (payload: {
    target_machine_id: string;
    license_key?: string;
    email?: string;
  }) => Promise<{ ok: boolean; devices: LicenseDeviceRecord[]; status?: LicenseActivationStatus }>;
  onRefreshStatus?: () => Promise<void>;
}

const STATUS_BANNER: Record<
  string,
  { title: string; tone: "neutral" | "danger" | "warn"; description: string }
> = {
  missing: {
    title: "Ative sua licença do Criativo AI Studio",
    tone: "neutral",
    description:
      "Informe o e-mail usado na compra e a chave de licença enviada para liberar os 15 agentes e a operação 24/7.",
  },
  revoked: {
    title: "Licença revogada ou suspensa",
    tone: "danger",
    description:
      "Esta chave foi cancelada ou reembolsada no servidor central. Caso seja um engano, ative uma nova chave abaixo.",
  },
  expired: {
    title: "Vigência do plano expirada",
    tone: "warn",
    description:
      "O período contratado desta licença chegou ao fim. Renove sua assinatura ou informe uma nova chave ativa.",
  },
  grace_exceeded: {
    title: "Validação online necessária",
    tone: "warn",
    description:
      "O prazo de tolerância offline de 7 dias foi atingido. Conecte-se à internet e valide sua licença novamente.",
  },
  machine_limit: {
    title: "Limite de computadores atingido",
    tone: "warn",
    description:
      "Você atingiu a quantidade máxima de PCs simultâneos da sua licença. Desvincule um dispositivo antigo abaixo para ativar este computador.",
  },
  invalid_signature: {
    title: "Certificado de licença inválido",
    tone: "danger",
    description:
      "O certificado local falhou na verificação criptográfica Ed25519. Reative com sua chave e e-mail de compra.",
  },
};

export const LicenseActivationGate: React.FC<LicenseActivationGateProps> = ({
  status,
  onActivate,
  onDeactivateDevice,
  onRefreshStatus,
}) => {
  const [email, setEmail] = useState(status.customer_email ?? "");
  const [licenseKey, setLicenseKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(status.message ?? null);
  const [limitDevices, setLimitDevices] = useState<LicenseDeviceRecord[]>(status.devices ?? []);
  const [machineLimitReached, setMachineLimitReached] = useState(
    status.status_code === "machine_limit" && (status.devices?.length ?? 0) > 0
  );

  const banner = STATUS_BANNER[machineLimitReached ? "machine_limit" : status.status_code] ?? STATUS_BANNER.missing;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !licenseKey.trim()) {
      setErrorMsg("Preencha seu e-mail de compra e a chave de licença.");
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    setMachineLimitReached(false);

    try {
      await onActivate({
        email: email.trim(),
        license_key: licenseKey.trim().toUpperCase(),
      });
    } catch (err) {
      if (err instanceof DaemonHttpError && err.code === "machine_limit") {
        const rawDevices = Array.isArray(err.payload?.devices)
          ? (err.payload.devices as LicenseDeviceRecord[])
          : [];
        setLimitDevices(rawDevices);
        setMachineLimitReached(true);
        setErrorMsg(err.message);
      } else {
        setErrorMsg(err instanceof Error ? err.message : "Falha ao ativar licença.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleUnlinkAndRetry = async (targetMachineId: string) => {
    setLoading(true);
    setErrorMsg(null);
    try {
      await onDeactivateDevice({
        target_machine_id: targetMachineId,
        email: email.trim() || status.customer_email,
        license_key: licenseKey.trim().toUpperCase(),
      });
      if (email.trim() && licenseKey.trim()) {
        await onActivate({
          email: email.trim(),
          license_key: licenseKey.trim().toUpperCase(),
        });
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Não foi possível desvincular este computador.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#0D0D0D] text-[#F0F0F0] flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-[520px] rounded-2xl border border-white/[0.08] bg-[#1A1A1A] p-7 shadow-2xl space-y-6">
        <div className="flex items-start gap-4">
          <div className="h-12 w-12 rounded-2xl bg-[#242424] border border-white/10 flex items-center justify-center shrink-0 p-1.5">
            <img
              src="/logo-criativo.png"
              alt="Criativo AI Studio"
              className="h-full w-full object-contain"
            />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-[#242424] border border-white/[0.06] px-2.5 py-0.5 text-[11px] font-semibold text-[#979797]">
              <KeyRound className="h-3 w-3 text-[#31CF76]" />
              <span>Criativo AI Studio Online</span>
            </div>
            <h1 className="text-[20px] font-semibold text-white tracking-tight leading-snug">
              {banner.title}
            </h1>
            <p className="text-[12.5px] text-[#979797] leading-relaxed">{banner.description}</p>
          </div>
        </div>

        {errorMsg && (
          <div
            role="alert"
            className={`rounded-xl border px-3.5 py-2.5 flex items-start gap-2.5 text-[12px] ${
              banner.tone === "danger"
                ? "bg-[#FF7675]/10 border-[#FF7675]/30 text-[#FFB8B8]"
                : "bg-[#F59E0B]/10 border-[#F59E0B]/30 text-[#FDE68A]"
            }`}
          >
            {banner.tone === "danger" ? (
              <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-[#FF7675]" />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-[#F59E0B]" />
            )}
            <span className="leading-relaxed">{errorMsg}</span>
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="license-email" className="block text-[12px] font-semibold text-[#DCDCDC]">
              E-mail usado na compra
            </label>
            <input
              id="license-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu-email@dominio.com"
              className="w-full rounded-xl border border-white/10 bg-[#141414] px-3.5 py-2.5 text-[13px] text-white placeholder:text-[#6A6A6A] focus:border-[#42A0FF] focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="license-key" className="block text-[12px] font-semibold text-[#DCDCDC]">
              Chave de licença
            </label>
            <input
              id="license-key"
              type="text"
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value)}
              placeholder="CRIA-IND-XXXX-XXXX-XXXX"
              className="w-full rounded-xl border border-white/10 bg-[#141414] px-3.5 py-2.5 font-mono text-[13px] tracking-wider text-white placeholder:text-[#6A6A6A] focus:border-[#42A0FF] focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-[#F0F0F0] px-4 py-2.5 text-[13px] font-semibold text-[#141414] hover:bg-white transition-colors disabled:opacity-50"
            >
              {loading ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span>Validando licença...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Ativar licença agora</span>
                </>
              )}
            </button>

            {onRefreshStatus && status.status_code !== "missing" && (
              <button
                type="button"
                disabled={loading}
                onClick={() => void onRefreshStatus()}
                title="Verificar novamente"
                className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-[#212121] px-3.5 py-2.5 text-[12.5px] font-semibold text-[#DCDCDC] hover:bg-[#2A2A2A] disabled:opacity-50"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            )}
          </div>
        </form>

        {machineLimitReached && limitDevices.length > 0 && (
          <div className="rounded-xl border border-white/[0.08] bg-[#141414] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-semibold text-white">
                Computadores vinculados nesta licença ({limitDevices.length})
              </span>
              <span className="text-[11px] text-[#979797]">Troca self-service</span>
            </div>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {limitDevices.map((dev) => (
                <div
                  key={dev.machine_id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-[#212121] px-3 py-2"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Laptop className="h-4 w-4 text-[#979797] shrink-0" />
                    <div className="min-w-0">
                      <div className="text-[12px] font-semibold text-white truncate">{dev.hostname}</div>
                      <div className="text-[10.5px] text-[#787878] truncate">
                        {dev.os_platform} · Ativo em {new Date(dev.last_heartbeat_at).toLocaleDateString("pt-BR")}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void handleUnlinkAndRetry(dev.machine_id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-[#2A2A2A] px-2.5 py-1.5 text-[11px] font-semibold text-[#F0F0F0] hover:bg-[#3A3A3A] shrink-0 disabled:opacity-50"
                  >
                    <Trash2 className="h-3 w-3 text-[#FF7675]" />
                    <span>Desvincular e ativar aqui</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="border-t border-white/[0.06] pt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-[#141414] border border-white/[0.05] px-2 py-2">
            <div className="text-[11px] font-semibold text-[#DCDCDC]">Individual</div>
            <div className="text-[10.5px] text-[#787878]">2 servidores · 2 PCs</div>
          </div>
          <div className="rounded-xl bg-[#141414] border border-white/[0.05] px-2 py-2">
            <div className="text-[11px] font-semibold text-[#DCDCDC]">Agência 10</div>
            <div className="text-[10.5px] text-[#787878]">10 servidores · 3 PCs</div>
          </div>
          <div className="rounded-xl bg-[#141414] border border-white/[0.05] px-2 py-2">
            <div className="text-[11px] font-semibold text-[#31CF76]">Agência Ilimitada</div>
            <div className="text-[10.5px] text-[#787878]">∞ servidores · 5 PCs</div>
          </div>
        </div>
      </div>
    </div>
  );
};
