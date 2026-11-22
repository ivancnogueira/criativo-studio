import React, { useMemo, useState } from "react";
import type {
  OnboardingEstado,
  ProvedorStatusInfo,
  ProviderName,
} from "@criativo/contracts";
import {
  MonitorSmartphone,
} from "lucide-react";
export type OnboardingUploadCategoria = "logo" | "foto" | "referencia" | "ficha_pdf";
import { useOnboardingController } from "./useOnboardingController";
import { OnboardingStep1 } from "./OnboardingStep1";
import { OnboardingStep2 } from "./OnboardingStep2";
import { OnboardingStep3, OnboardingStep4 } from "./OnboardingSteps3And4";

export interface OnboardingFlowProps {
  initialState: OnboardingEstado;
  initialStep?: 1 | 2 | 3 | 4;
  provedores: ProvedorStatusInfo[];
  unlockedAgentsCount?: number;
  onConnectProvider: (provedor: ProviderName, apiKey?: string) => Promise<void>;
  onConnectProviderViaBrowser?: (
    provedor: "gemini" | "claude" | "openai",
    label?: string
  ) => Promise<{ ok: boolean; canceled?: boolean; erro?: string }>;
  onCancelProviderBrowserSignIn?: (
    provedor: "gemini" | "claude" | "openai"
  ) => Promise<void>;
  pendingAuthUrl?: { provedor: "gemini" | "claude" | "openai"; url: string } | null;
  onUploadCategorizedFile?: (
    file: File,
    categoria: OnboardingUploadCategoria
  ) => Promise<{
    arquivo: { nome_original: string; url: string; caminho_relativo: string };
    brandExtraction?: { ok: boolean; extracted_chars: number; patch: Record<string, unknown> };
  }>;
  onSaveBrandIdentity?: (patch: {
    marca_nome?: string;
    perfil_handle?: string;
    nicho?: string;
    publico_alvo?: string;
    cores?: { fundo: string; texto: string; primaria: string; secundaria: string; acento: string };
  }) => Promise<void>;
  onTestInstagram?: (payload: {
    contaRotulo?: string;
    igUserId: string;
    accessToken: string;
  }) => Promise<{ ok: boolean; resumo: string; username?: string | null }>;
  onOpenWhatsAppModal?: () => void;
  onComplete: (patch: Partial<OnboardingEstado>) => Promise<void>;
  activeServerName?: string;
  isSecondaryServer?: boolean;
  onBackToPrimaryServer?: () => void;
}

export const ARCH_MASCOTS = [
  { shape: "diamond" as const, color: "#ec4899", size: 32, y: 18 },
  { shape: "triangle" as const, color: "#f97316", size: 28, y: 8 },
  { shape: "hex" as const, color: "#84cc16", size: 46, y: 4 },
  { shape: "hex" as const, color: "#22c55e", size: 70, y: 0 },
  { shape: "blob" as const, color: "#38bdf8", size: 48, y: 6 },
  { shape: "octo" as const, color: "#6366f1", size: 28, y: 8 },
  { shape: "cloud" as const, color: "#ef4444", size: 30, y: 20 },
];

/**
 * Fluxo guiado em 2 etapas nativo do Criativo Studio.
 */

export const OnboardingFlow: React.FC<OnboardingFlowProps> = (props) => {
  const ctrl = useOnboardingController(props);
  const {
    step,
    termsModalOpen,
    setTermsModalOpen,
    initialState,
    isSecondaryServer = false,
    activeServerName,
  } = ctrl;
  const { onBackToPrimaryServer, onOpenWhatsAppModal } = props;

  return (
    <div className="min-h-screen w-full bg-[#141414] text-[#FFFFFF] flex flex-col items-center justify-center relative px-4 py-10 overflow-y-auto">
      {isSecondaryServer && (
        <div className="fixed top-4 left-4 z-30 flex items-center gap-3 rounded-xl bg-[#212121] border border-white/10 px-3.5 py-2 shadow-xl">
          <div className="text-left">
            <p className="text-[11px] uppercase tracking-wider text-[#979797]">
              Configurando servidor
            </p>
            <p className="text-[12.5px] font-semibold text-white truncate max-w-[200px]">
              {activeServerName || "Novo Servidor"}
            </p>
          </div>
          {onBackToPrimaryServer && (
            <button
              type="button"
              onClick={onBackToPrimaryServer}
              className="rounded-lg bg-white/10 hover:bg-white/15 px-2.5 py-1 text-[11.5px] font-medium text-white transition-colors"
            >
              Voltar ao Principal
            </button>
          )}
        </div>
      )}

      {/* Pílula de status de runtime no canto superior direito (Screenshot 1 & 2) */}
      <div className="fixed top-4 right-4 z-30 w-72 rounded-xl bg-[#212121] border border-white/10 px-3.5 py-2.5 shadow-xl">
        <div className="flex items-start gap-2.5">
          <MonitorSmartphone className="h-4 w-4 text-[#DCDCDC] mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1 text-left">
            <p className="text-[12px] font-semibold text-white leading-snug">
              Criativo Runtime atualizado
            </p>
            <p className="text-[11px] text-[#979797] mt-0.5">
              {initialState.runtime_versao || "v1.0.0"} · Node + SQLite
            </p>
          </div>
        </div>
      </div>

      {step === 1 ? (
        <OnboardingStep1 ctrl={ctrl} />
      ) : step === 2 ? (
        <OnboardingStep2 ctrl={ctrl} />
      ) : step === 3 ? (
        <OnboardingStep3 ctrl={ctrl} />
      ) : (
        <OnboardingStep4 ctrl={ctrl} onOpenWhatsAppModal={onOpenWhatsAppModal} />
      )}

      {termsModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-[#212121] border border-white/10 p-5 text-left">
            <h3 className="text-[15px] font-semibold text-white mb-2">
              Privacidade Local & Segurança Meta
            </h3>
            <p className="text-[12.5px] text-[#DCDCDC] leading-relaxed mb-4">
              Todas as chaves API ficam cifradas localmente em AES-256-GCM no banco SQLite
              (<code className="text-[#42A0FF]">dados/criativo.db</code>). Nenhuma publicação
              no Instagram ocorre sem aprovação humana explícita pelo Cockpit ou WhatsApp.
            </p>
            <button
              type="button"
              onClick={() => setTermsModalOpen(false)}
              className="studio-btn-primary px-4 py-1.5 text-[12.5px]"
            >
              Entendi
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
