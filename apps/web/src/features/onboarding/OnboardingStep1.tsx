import React, { useMemo, useState } from "react";
import {
  ChevronRight,
} from "lucide-react";
import {
  MascoteAvatar,
} from "../../components/MascoteAvatar";
import {
  ProviderLogo,
} from "../../components/ProviderLogo";
export type OnboardingUploadCategoria = "logo" | "foto" | "referencia" | "ficha_pdf";
import type { OnboardingController } from "./useOnboardingController";
import { ARCH_MASCOTS } from "./OnboardingFlow";

export function OnboardingStep1({ ctrl }: { ctrl: OnboardingController }) {
  const {
    unlockedAgentsCount,
    marcaNome,
    setMarcaNome,
    perfilHandle,
    setPerfilHandle,
    submitting,
    handleChooseFree,
    opencodeFreeCount,
    setProviderModeChoice,
    setStep,
    telemetria,
    setTelemetria,
    setTermsModalOpen,
  } = ctrl;
  return (
        <div className="w-full max-w-[440px] flex flex-col items-center text-center">
          {/* Arco superior de 7 mascotes orgânicos */}
          <div className="flex items-end justify-center gap-2.5 mb-7 h-20">
            {ARCH_MASCOTS.map((m, idx) => (
              <div key={idx} style={{ transform: `translateY(${m.y}px)` }}>
                <MascoteAvatar
                  shape={m.shape}
                  color={m.color}
                  size={m.size}
                  trackCursor
                  animated={idx === 3}
                  label={`Mascote equipe ${idx + 1}`}
                />
              </div>
            ))}
          </div>

          <h1 className="text-[42px] leading-[1.08] font-bold tracking-tight text-white mb-3">
            Monte sua
            <br />
            equipe de IA.
          </h1>

          <p className="text-[13px] text-[#979797] mb-7 max-w-[360px]">
            {unlockedAgentsCount && unlockedAgentsCount > 0
              ? `O Criativo Studio é gratuito para uso local. Escolha a IA dos seus ${unlockedAgentsCount} agentes liberados.`
              : "O Criativo Studio é gratuito para uso local. Escolha a IA para sua equipe criativa."}
          </p>

          {/* Caixa agrupada Carbon Dark */}
          <div className="w-full rounded-2xl bg-[#1A1A1A] border border-white/10 overflow-hidden text-left shadow-2xl">
            <div className="px-4 py-3 border-b border-white/[0.06] grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label htmlFor="onboarding-brand-name" className="block text-[11px] text-[#8E8E93] mb-1">
                  Nome da sua marca (opcional agora)
                </label>
                <input
                  id="onboarding-brand-name"
                  name="marca_nome"
                  type="text"
                  value={marcaNome}
                  onChange={(e) => setMarcaNome(e.target.value)}
                  placeholder="Ex.: Minha Marca"
                  className="w-full rounded-lg bg-[#141414] border border-white/10 px-2.5 py-1.5 text-[12px] text-white placeholder-[#5A5A5F] focus:outline-none focus:border-[#42A0FF]"
                />
              </div>
              <div>
                <label htmlFor="onboarding-brand-handle" className="block text-[11px] text-[#8E8E93] mb-1">
                  @ do Instagram (opcional agora)
                </label>
                <input
                  id="onboarding-brand-handle"
                  name="perfil_handle"
                  type="text"
                  value={perfilHandle}
                  onChange={(e) => setPerfilHandle(e.target.value)}
                  placeholder="Ex.: @seu_perfil"
                  className="w-full rounded-lg bg-[#141414] border border-white/10 px-2.5 py-1.5 text-[12px] text-white placeholder-[#5A5A5F] focus:outline-none focus:border-[#42A0FF]"
                />
              </div>
            </div>
            <button
              type="button"
              disabled={submitting}
              onClick={handleChooseFree}
              className="w-full text-left flex items-center justify-between px-4 py-3.5 hover:bg-[#242424] transition-colors border-b border-white/[0.06]"
            >
              <div>
                <div className="text-[13.5px] font-medium text-white">Usar modelos gratuitos</div>
                <div className="text-[12px] text-[#979797]">
                  {opencodeFreeCount > 0
                    ? `Sem assinatura externa · OpenCode (${opencodeFreeCount} modelos gratuitos prontos).`
                    : "Sem assinatura externa · OpenCode (instalação automática gratuita)."}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-[#6A6A6A]" />
            </button>

            <button
              type="button"
              onClick={() => {
                setProviderModeChoice("assinatura");
                setStep(2);
              }}
              className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-[#242424] transition-colors border-b border-white/[0.06]"
            >
              <div>
                <div className="text-[13.5px] font-medium text-white">Usar minha assinatura de IA</div>
                <div className="text-[12px] text-[#979797]">ChatGPT, Claude, Gemini ou Grok</div>
              </div>
              <div className="flex items-center gap-2 text-[#DCDCDC]">
                <ProviderLogo provider="openai" size={16} />
                <ProviderLogo provider="claude" size={16} />
                <ProviderLogo provider="gemini" size={16} />
                <ProviderLogo provider="grok" size={15} />
                <ChevronRight className="h-4 w-4 text-[#6A6A6A] ml-0.5" />
              </div>
            </button>

            <label
              htmlFor="onboarding-telemetry"
              className="flex items-start gap-3 px-4 py-3.5 cursor-pointer hover:bg-[#212121] transition-colors"
            >
              <input
                id="onboarding-telemetry"
                name="telemetria_anonima"
                aria-label="Ajude a melhorar o Criativo Studio"
                type="checkbox"
                checked={telemetria}
                onChange={(e) => setTelemetria(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-white/25 bg-[#141414] accent-[#42A0FF]"
              />
              <div>
                <div className="text-[13px] font-medium text-[#DCDCDC]">
                  Ajude a melhorar o Criativo Studio
                </div>
                <div className="text-[11.5px] text-[#6A6A6A]">
                  Métricas locais de fila. Nunca vaza chats, chaves do cofre ou arquivos.
                </div>
              </div>
            </label>
          </div>

          <p className="mt-5 text-[11px] text-[#6A6A6A] leading-relaxed">
            Ao continuar, você opera em sua máquina local com{" "}
            <button
              type="button"
              onClick={() => setTermsModalOpen(true)}
              className="underline text-[#979797] hover:text-white"
            >
              Aprovação Humana Meta Segura
            </button>{" "}
            e{" "}
            <button
              type="button"
              onClick={() => setTermsModalOpen(true)}
              className="underline text-[#979797] hover:text-white"
            >
              Cofre AES-256-GCM
            </button>
            .
          </p>
        </div>
  );
}
