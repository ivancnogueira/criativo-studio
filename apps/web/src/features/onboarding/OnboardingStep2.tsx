import React, { useMemo, useState } from "react";
import type {
  ProvedorStatusInfo,
  ProviderName,
} from "@criativo/contracts";
import {
  Check,
  KeyRound,
} from "lucide-react";
import {
  ProviderLogo,
} from "../../components/ProviderLogo";
export type OnboardingUploadCategoria = "logo" | "foto" | "referencia" | "ficha_pdf";
import type { OnboardingController } from "./useOnboardingController";

export function OnboardingStep2({ ctrl }: { ctrl: OnboardingController }) {
  const {
    statusNote,
    errorNote,
    mainProviders,
    extraProviders,
    selectedProvider,
    setSelectedProvider,
    editingKeyFor,
    setEditingKeyFor,
    apiKeyDraft,
    setApiKeyDraft,
    busyProvider,
    setBusyProvider,
    setStatusNote,
    showMoreProviders,
    setShowMoreProviders,
    submitting,
    activeProviderConnected,
    onConnectProviderViaBrowser,
    onCancelProviderBrowserSignIn,
    pendingAuthUrl,
    handleBrowserConnect,
    handleSaveProvider,
    handleConfirmSubscription,
    setStep,
  } = ctrl;
  return (
        <div className="w-full max-w-[440px] flex flex-col items-center">
          {/* Indicador de 4 passos */}
          <div className="flex items-center gap-1.5 mb-5" aria-label="Etapa 2 de 4">
            <span className="h-1.5 w-1.5 rounded-full bg-[#6A6A6A]" />
            <span className="h-1.5 w-5 rounded-full bg-white" />
            <span className="h-1.5 w-1.5 rounded-full bg-[#3A3A3D]" />
            <span className="h-1.5 w-1.5 rounded-full bg-[#3A3A3D]" />
          </div>

          <h2 className="text-[28px] font-bold tracking-tight text-white mb-1.5 text-center">
            Conecte seu plano
          </h2>
          <p className="text-[13px] text-[#979797] mb-7 text-center">
            Entre uma vez. Todos os seus Criativos liberados usam seu provedor preferido.
          </p>

          <div className="w-full text-left mb-2 flex items-center justify-between gap-2">
            <span className="text-[12px] font-medium text-[#DCDCDC]">
              Escolha seu provedor de IA
            </span>
            {statusNote && (
              <span className="text-[11px] text-[#31CF76] truncate">{statusNote}</span>
            )}
          </div>

          {errorNote && (
            <div className="w-full mb-3 rounded-xl bg-[#FF7675]/15 border border-[#FF7675]/30 px-3.5 py-2 text-[12px] text-[#FF7675] text-left">
              {errorNote}
            </div>
          )}

          <div className="w-full rounded-2xl bg-[#1A1A1A] border border-white/10 divide-y divide-white/[0.06] overflow-visible">
            {mainProviders.map((prov) => {
              const isSelected = selectedProvider === prov.provedor;
              const isEditing = editingKeyFor === prov.provedor;
              const isConnectingBrowser = busyProvider === prov.provedor;
              const linkedEmail = prov.contas?.find((c) => c.email)?.email ?? null;
              const authLink =
                pendingAuthUrl && pendingAuthUrl.provedor === prov.provedor ? pendingAuthUrl.url : null;
              return (
                <div key={prov.provedor} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setSelectedProvider(prov.provedor)}
                      className="flex items-center gap-3 text-left flex-1 min-w-0"
                    >
                      <span
                        className={`h-4 w-4 rounded-full border flex items-center justify-center shrink-0 ${
                          isSelected
                            ? "border-[#42A0FF] bg-[#42A0FF]/20"
                            : "border-white/25"
                        }`}
                      >
                        {isSelected && <span className="h-2 w-2 rounded-full bg-[#42A0FF]" />}
                      </span>
                      <ProviderLogo provider={prov.provedor} size={18} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[13.5px] font-medium text-white flex items-center gap-2 min-w-0">
                          <span className="shrink-0">{prov.rotulo}</span>
                          {prov.conectado && (
                            <span
                              title={linkedEmail || "Conectado"}
                              className="inline-flex items-center gap-1 rounded-full bg-[#31CF76]/15 px-2 py-0.5 text-[10.5px] font-medium text-[#31CF76] min-w-0 max-w-[165px]"
                            >
                              <Check className="h-2.5 w-2.5 shrink-0" />
                              <span className="truncate">{linkedEmail || "Conectado"}</span>
                            </span>
                          )}
                        </div>
                        <div
                          className={`text-[11.5px] truncate ${
                            isConnectingBrowser
                              ? "text-[#74B9FF]"
                              : prov.conectado
                                ? "text-[#979797]"
                                : "text-[#FF9412]"
                          }`}
                        >
                          {isConnectingBrowser
                            ? "Abrindo tela de login no navegador..."
                            : prov.conectado
                              ? prov.cli_versao
                                ? `${prov.cli_versao} · Conta pronta para seus Criativos`
                                : "Credencial ativa no Cofre AES-256-GCM"
                              : prov.cli_detectado
                                ? `${prov.subtitulo} · Clique em Conectar para autenticar no navegador.`
                                : `${prov.subtitulo} · Clique em Conectar ou informe uma API Key.`}
                        </div>
                      </div>
                    </button>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {isConnectingBrowser && onCancelProviderBrowserSignIn ? (
                        <button
                          type="button"
                          onClick={async () => {
                            await onCancelProviderBrowserSignIn(
                              prov.provedor as "gemini" | "claude" | "openai"
                            );
                            setBusyProvider(null);
                            setStatusNote(null);
                          }}
                          className="rounded-full bg-[#2A2A2E] hover:bg-[#36363C] border border-white/10 text-[#E5E5E7] px-3.5 py-1.5 text-[12px] font-medium transition-colors"
                        >
                          Cancelar
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busyProvider !== null}
                          onClick={() =>
                            void handleBrowserConnect(prov.provedor as "gemini" | "claude" | "openai")
                          }
                          className={
                            prov.conectado
                              ? "rounded-full border border-white/15 bg-[#242428] hover:bg-[#303036] disabled:opacity-60 text-[#D4D4D8] px-3 py-1 text-[11.5px] font-medium transition-colors"
                              : "rounded-full bg-[#F0F0F0] hover:bg-white disabled:opacity-60 text-[#141414] px-3.5 py-1.5 text-[12px] font-semibold transition-colors"
                          }
                        >
                          {isConnectingBrowser
                            ? "Aguardando..."
                            : prov.conectado
                              ? "Reconectar"
                              : "Conectar"}
                        </button>
                      )}
                      <button
                        type="button"
                        title="Usar API Key manualmente"
                        onClick={() => {
                          setSelectedProvider(prov.provedor);
                          setEditingKeyFor(isEditing ? null : prov.provedor);
                        }}
                        className="h-8 w-8 rounded-full border border-white/10 bg-[#242424] hover:bg-[#2E2E2E] text-[#979797] hover:text-white flex items-center justify-center transition-colors"
                        aria-label={`Inserir API Key de ${prov.rotulo}`}
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {isConnectingBrowser && authLink && (
                    <div className="mt-2.5 flex items-center justify-between gap-2 rounded-lg bg-[#42A0FF]/10 border border-[#42A0FF]/25 px-3 py-1.5 text-[11.5px] text-[#74B9FF]">
                      <span>Caso a janela não tenha aparecido na frente:</span>
                      <a
                        href={authLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold underline hover:text-white shrink-0"
                      >
                        Abrir página de login
                      </a>
                    </div>
                  )}

                  {isEditing && (
                    <div className="mt-3 pt-3 border-t border-white/[0.06] flex items-center gap-2">
                      <KeyRound className="h-3.5 w-3.5 text-[#979797] shrink-0" />
                      <input
                        id={`onboarding-key-${prov.provedor}`}
                        name={`api_key_${prov.provedor}`}
                        aria-label={`Chave API de ${prov.rotulo}`}
                        type="password"
                        value={apiKeyDraft}
                        onChange={(e) => setApiKeyDraft(e.target.value)}
                        placeholder={`Cole a chave ${prov.rotulo} (ou deixe vazio p/ sessão CLI)`}
                        className="flex-1 rounded-lg bg-[#101010] border border-white/10 px-2.5 py-1.5 text-[12px] text-white placeholder-[#6A6A6A] focus:outline-none focus:border-[#42A0FF]"
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveProvider(prov.provedor, apiKeyDraft)}
                        className="rounded-lg bg-[#31CF76] text-[#0D0D0D] px-3 py-1.5 text-[12px] font-semibold hover:opacity-90"
                      >
                        Salvar
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="w-full flex items-center justify-between mt-3 px-1">
            <span className="text-[11.5px] text-[#6A6A6A]">
              Você pode alterar isso para cada Criativo depois.
            </span>
            <button
              type="button"
              onClick={() => setShowMoreProviders((prev) => !prev)}
              className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#DCDCDC] hover:text-white"
            >
              <ProviderLogo provider="opencode" size={14} />
              <ProviderLogo provider="grok" size={14} />
              <ProviderLogo provider="ollama" size={14} />
              <span>Mais provedores</span>
            </button>
          </div>

          {showMoreProviders && (
            <div className="w-full mt-3 rounded-2xl bg-[#1A1A1A] border border-white/10 divide-y divide-white/[0.06]">
              {extraProviders.map((prov) => {
                const isSelectedExtra = selectedProvider === prov.provedor;
                const isEditingExtra = editingKeyFor === prov.provedor;
                return (
                  <div key={prov.provedor} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => setSelectedProvider(prov.provedor)}
                        className="flex items-center gap-2.5 text-left"
                      >
                        <span
                          className={`h-4 w-4 rounded-full border flex items-center justify-center shrink-0 ${
                            isSelectedExtra
                              ? "border-[#42A0FF] bg-[#42A0FF]/20"
                              : "border-white/25"
                          }`}
                        >
                          {isSelectedExtra && <span className="h-2 w-2 rounded-full bg-[#42A0FF]" />}
                        </span>
                        <ProviderLogo provider={prov.provedor} size={17} />
                        <div>
                          <div className="text-[13px] font-medium text-white flex items-center gap-2">
                            {prov.rotulo}
                            {prov.provedor === "opencode" && prov.conectado && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#31CF76]/15 text-[#31CF76]">
                                Grátis · {prov.modelos.length} modelos
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-[#979797]">{prov.subtitulo}</div>
                        </div>
                      </button>
                      <button
                        type="button"
                        disabled={busyProvider === prov.provedor}
                        onClick={() => {
                          setSelectedProvider(prov.provedor);
                          if (prov.provedor === "grok") {
                            setEditingKeyFor(isEditingExtra ? null : "grok");
                          } else if (prov.conectado) {
                            setStatusNote(`${prov.rotulo} selecionado como provedor inicial.`);
                          } else {
                            void handleSaveProvider(
                              prov.provedor,
                              prov.provedor === "opencode" ? "" : undefined
                            );
                          }
                        }}
                        className="rounded-full bg-[#242424] hover:bg-[#2A2A2A] disabled:opacity-60 border border-white/10 px-3 py-1 text-[11.5px] font-medium text-white"
                      >
                        {prov.conectado
                          ? "Usar"
                          : prov.provedor === "grok"
                            ? "API Key"
                            : prov.provedor === "opencode"
                              ? busyProvider === "opencode"
                                ? "Instalando..."
                                : "Instalar grátis"
                              : "Verificar"}
                      </button>
                    </div>
                    {isEditingExtra && (
                      <div className="mt-3 pt-3 border-t border-white/[0.06] flex items-center gap-2">
                        <KeyRound className="h-3.5 w-3.5 text-[#979797] shrink-0" />
                        <input
                          id={`onboarding-key-${prov.provedor}`}
                          name={`api_key_${prov.provedor}`}
                          aria-label={`Chave API de ${prov.rotulo}`}
                          type="password"
                          value={apiKeyDraft}
                          onChange={(e) => setApiKeyDraft(e.target.value)}
                          placeholder={`Cole a API Key ${prov.rotulo}`}
                          className="flex-1 rounded-lg bg-[#101010] border border-white/10 px-2.5 py-1.5 text-[12px] text-white placeholder-[#6A6A6A] focus:outline-none focus:border-[#42A0FF]"
                        />
                        <button
                          type="button"
                          onClick={() => handleSaveProvider(prov.provedor, apiKeyDraft)}
                          className="rounded-lg bg-[#31CF76] text-[#0D0D0D] px-3 py-1.5 text-[12px] font-semibold hover:opacity-90"
                        >
                          Salvar
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* CTAs Etapa 2 -> Avança para Etapa 3 (Marca/Arquivos) ou pula direto ao Estúdio */}
          <div className="w-full max-w-[320px] flex flex-col gap-2.5 mt-7">
            <button
              type="button"
              disabled={submitting}
              onClick={() => setStep(3)}
              className="studio-btn-primary w-full py-2.5 text-[13.5px] shadow-lg"
            >
              Avançar para marca e arquivos
            </button>
            <button
              type="button"
              onClick={() => setStep(1)}
              className="studio-btn-secondary w-full py-2.5 text-[13px]"
            >
              Voltar
            </button>
          </div>

          <p className="mt-3 text-[11px] text-[#6A6A6A]">
            {activeProviderConnected
              ? "Provedor pronto para os Criativos."
              : "Conecte um provedor acima ou use modelos gratuitos locais."}
          </p>

          <button
            type="button"
            disabled={submitting}
            onClick={handleConfirmSubscription}
            className="mt-4 text-[12px] text-[#979797] hover:text-white underline-offset-4 hover:underline"
          >
            Pular configuração inicial e ir ao Estúdio
          </button>
        </div>
  );
}
