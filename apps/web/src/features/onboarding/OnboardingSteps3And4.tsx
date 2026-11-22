import React, { useMemo, useState } from "react";
import {
  Check,
  FileText,
  ImagePlus,
  Palette,
  Smartphone,
  Sparkles,
  Upload,
} from "lucide-react";
export type OnboardingUploadCategoria = "logo" | "foto" | "referencia" | "ficha_pdf";
import type { OnboardingController } from "./useOnboardingController";

export function OnboardingStep3({ ctrl }: { ctrl: OnboardingController }) {
  const {
    errorNote,
    pdfNotice,
    nichoInput,
    setNichoInput,
    publicoInput,
    setPublicoInput,
    corFundo,
    setCorFundo,
    corPrimaria,
    setCorPrimaria,
    corAcento,
    setCorAcento,
    uploadedItems,
    uploadingCategory,
    handleUploadCategory,
    submitting,
    persistStep3BrandDraft,
    setStep,
    handleFinishStudio,
  } = ctrl;
  return (
        <div className="w-full max-w-[540px] flex flex-col items-center">
          <div className="flex items-center gap-1.5 mb-5" aria-label="Etapa 3 de 4">
            <span className="h-1.5 w-1.5 rounded-full bg-[#6A6A6A]" />
            <span className="h-1.5 w-1.5 rounded-full bg-[#6A6A6A]" />
            <span className="h-1.5 w-5 rounded-full bg-white" />
            <span className="h-1.5 w-1.5 rounded-full bg-[#3A3A3D]" />
          </div>

          <h2 className="text-[26px] font-bold tracking-tight text-white mb-1.5 text-center">
            Identidade visual e arquivos
          </h2>
          <p className="text-[13px] text-[#979797] mb-6 text-center">
            Suba logo, fotos, referências ou Ficha PDF para que os agentes criativos já operem no seu estilo (opcional agora).
          </p>

          {errorNote && (
            <div className="w-full mb-3 rounded-xl bg-[#FF7675]/15 border border-[#FF7675]/30 px-3.5 py-2 text-[12px] text-[#FF7675]">
              {errorNote}
            </div>
          )}
          {pdfNotice && (
            <div className="w-full mb-3 rounded-xl bg-[#31CF76]/15 border border-[#31CF76]/30 px-3.5 py-2 text-[12px] text-[#31CF76]">
              {pdfNotice}
            </div>
          )}

          <div className="w-full rounded-2xl bg-[#1A1A1A] border border-white/10 p-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-[#8E8E93] mb-1">Nicho / Mercado</label>
                <input
                  type="text"
                  value={nichoInput}
                  onChange={(e) => setNichoInput(e.target.value)}
                  placeholder="Ex.: Saúde, Educação, SaaS..."
                  className="w-full rounded-lg bg-[#141414] border border-white/10 px-2.5 py-1.5 text-[12px] text-white placeholder-[#5A5A5F] focus:outline-none focus:border-[#42A0FF]"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[#8E8E93] mb-1">Público-alvo</label>
                <input
                  type="text"
                  value={publicoInput}
                  onChange={(e) => setPublicoInput(e.target.value)}
                  placeholder="Ex.: Empreendedores, Mães..."
                  className="w-full rounded-lg bg-[#141414] border border-white/10 px-2.5 py-1.5 text-[12px] text-white placeholder-[#5A5A5F] focus:outline-none focus:border-[#42A0FF]"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 pt-1">
              <div className="flex items-center gap-1.5 text-[12px] text-[#DCDCDC]">
                <Palette className="h-3.5 w-3.5 text-[#42A0FF]" />
                <span>Cores principais:</span>
              </div>
              <label className="inline-flex items-center gap-1.5 text-[11.5px] text-[#979797]">
                <span>Fundo</span>
                <input
                  type="color"
                  aria-label="Cor de fundo da marca"
                  value={corFundo}
                  onChange={(e) => setCorFundo(e.target.value)}
                  className="h-6 w-8 rounded border border-white/15 bg-transparent cursor-pointer"
                />
              </label>
              <label className="inline-flex items-center gap-1.5 text-[11.5px] text-[#979797]">
                <span>Primária</span>
                <input
                  type="color"
                  aria-label="Cor primária da marca"
                  value={corPrimaria}
                  onChange={(e) => setCorPrimaria(e.target.value)}
                  className="h-6 w-8 rounded border border-white/15 bg-transparent cursor-pointer"
                />
              </label>
              <label className="inline-flex items-center gap-1.5 text-[11.5px] text-[#979797]">
                <span>Destaque</span>
                <input
                  type="color"
                  aria-label="Cor de destaque da marca"
                  value={corAcento}
                  onChange={(e) => setCorAcento(e.target.value)}
                  className="h-6 w-8 rounded border border-white/15 bg-transparent cursor-pointer"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {(
                [
                  { cat: "logo", label: "Logo da Marca", hint: "PNG/SVG → recursos/logos", accept: "image/*" },
                  { cat: "foto", label: "Fotos (Rosto / Produto)", hint: "JPG/PNG → recursos/fotos", accept: "image/*" },
                  { cat: "referencia", label: "Referências Visuais", hint: "Artes → recursos/referencias", accept: "image/*" },
                  { cat: "ficha_pdf", label: "Ficha Institucional (PDF)", hint: "Extrai perfil automaticamente", accept: ".pdf,application/pdf" },
                ] as const
              ).map((item) => {
                const count = uploadedItems.filter((u) => u.categoria === item.cat).length;
                const isBusy = uploadingCategory === item.cat;
                return (
                  <label
                    key={item.cat}
                    className="flex items-center gap-3 rounded-xl border border-dashed border-white/15 bg-[#141414] hover:border-[#42A0FF]/60 px-3 py-2.5 cursor-pointer transition-colors"
                  >
                    <input
                      type="file"
                      multiple={item.cat !== "ficha_pdf"}
                      accept={item.accept}
                      className="sr-only"
                      onChange={(e) => {
                        void handleUploadCategory(item.cat, e.target.files);
                        e.currentTarget.value = "";
                      }}
                    />
                    <div className="h-8 w-8 rounded-lg bg-[#242424] flex items-center justify-center shrink-0 text-[#42A0FF]">
                      {item.cat === "ficha_pdf" ? (
                        <FileText className="h-4 w-4" />
                      ) : item.cat === "referencia" ? (
                        <Sparkles className="h-4 w-4" />
                      ) : item.cat === "logo" ? (
                        <Upload className="h-4 w-4" />
                      ) : (
                        <ImagePlus className="h-4 w-4" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 text-left">
                      <div className="text-[12px] font-semibold text-white flex items-center gap-1.5">
                        <span className="truncate">{item.label}</span>
                        {count > 0 && (
                          <span className="rounded-full bg-[#31CF76]/20 px-1.5 py-0.5 text-[10px] text-[#31CF76]">
                            {count}
                          </span>
                        )}
                      </div>
                      <div className="text-[10.5px] text-[#8E8E93] truncate">
                        {isBusy ? "Enviando..." : item.hint}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>

            {uploadedItems.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {uploadedItems.map((it, idx) => (
                  <span
                    key={`${it.caminho}-${idx}`}
                    className="inline-flex items-center gap-1 rounded-full bg-[#242424] border border-white/10 px-2.5 py-1 text-[10.5px] text-[#DCDCDC]"
                  >
                    <Check className="h-3 w-3 text-[#31CF76]" />
                    <span className="truncate max-w-[170px]">{it.nome}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="w-full max-w-[320px] flex flex-col gap-2.5 mt-6">
            <button
              type="button"
              disabled={submitting}
              onClick={() => {
                void persistStep3BrandDraft().catch(() => {});
                setStep(4);
              }}
              className="studio-btn-primary w-full py-2.5 text-[13.5px] shadow-lg"
            >
              Avançar para Instagram e Canais
            </button>
            <button
              type="button"
              onClick={() => setStep(2)}
              className="studio-btn-secondary w-full py-2.5 text-[13px]"
            >
              Voltar
            </button>
          </div>

          <button
            type="button"
            disabled={submitting}
            onClick={() => void handleFinishStudio()}
            className="mt-4 text-[12px] text-[#979797] hover:text-white underline-offset-4 hover:underline"
          >
            Pular e configurar depois
          </button>
        </div>
  );
}

export function OnboardingStep4({
  ctrl,
  onOpenWhatsAppModal,
}: {
  ctrl: OnboardingController;
  onOpenWhatsAppModal?: () => void;
}) {
  const {
    igLabel,
    setIgLabel,
    igUserId,
    setIgUserId,
    igToken,
    setIgToken,
    onTestInstagram,
    testingIg,
    handleValidateInstagramStep,
    igTestStatus,
    submitting,
    handleFinishStudio,
    setStep,
  } = ctrl;
  return (
        <div className="w-full max-w-[500px] flex flex-col items-center">
          <div className="flex items-center gap-1.5 mb-5" aria-label="Etapa 4 de 4">
            <span className="h-1.5 w-1.5 rounded-full bg-[#6A6A6A]" />
            <span className="h-1.5 w-1.5 rounded-full bg-[#6A6A6A]" />
            <span className="h-1.5 w-1.5 rounded-full bg-[#6A6A6A]" />
            <span className="h-1.5 w-5 rounded-full bg-white" />
          </div>

          <h2 className="text-[26px] font-bold tracking-tight text-white mb-1.5 text-center">
            Conectar Instagram &amp; Canais
          </h2>
          <p className="text-[13px] text-[#979797] mb-6 text-center">
            Salve suas credenciais Meta Graph API v27.0 no Cofre local AES-256-GCM ou conclua depois pelo Assistente de Configuração.
          </p>

          <div className="w-full rounded-2xl bg-[#1A1A1A] border border-white/10 p-4 space-y-3 text-left">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-[#8E8E93] mb-1">Rótulo da conta</label>
                <input
                  type="text"
                  value={igLabel}
                  onChange={(e) => setIgLabel(e.target.value)}
                  placeholder="Conta Principal"
                  className="w-full rounded-lg bg-[#141414] border border-white/10 px-2.5 py-1.5 text-[12px] text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[#8E8E93] mb-1">
                  ID da Conta Profissional (IG User ID)
                </label>
                <input
                  type="text"
                  value={igUserId}
                  onChange={(e) => setIgUserId(e.target.value)}
                  placeholder="17841400000000000"
                  className="w-full rounded-lg bg-[#141414] border border-white/10 px-2.5 py-1.5 font-mono text-[12px] text-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-[#8E8E93] mb-1">
                Token de Acesso Longa Duração
              </label>
              <input
                type="password"
                value={igToken}
                onChange={(e) => setIgToken(e.target.value)}
                placeholder="EAAB..."
                className="w-full rounded-lg bg-[#141414] border border-white/10 px-2.5 py-1.5 font-mono text-[12px] text-white"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              {onOpenWhatsAppModal ? (
                <button
                  type="button"
                  onClick={() => onOpenWhatsAppModal()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#242424] px-3 py-1.5 text-[11.5px] text-[#DCDCDC] hover:bg-[#2E2E2E]"
                >
                  <Smartphone className="h-3.5 w-3.5 text-[#31CF76]" />
                  <span>Parear WhatsApp depois</span>
                </button>
              ) : (
                <span className="text-[11px] text-[#6A6A6A]">Cofre AES-256-GCM local</span>
              )}

              {onTestInstagram && (
                <button
                  type="button"
                  disabled={testingIg}
                  onClick={() => void handleValidateInstagramStep()}
                  className="rounded-lg bg-[#242424] hover:bg-[#303036] border border-white/15 px-3.5 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
                >
                  {testingIg ? "Validando Meta..." : "Salvar e testar Graph API"}
                </button>
              )}
            </div>

            {igTestStatus && (
              <div
                className={`rounded-lg px-3 py-2 text-[11.5px] ${
                  igTestStatus.ok
                    ? "bg-[#31CF76]/15 border border-[#31CF76]/30 text-[#31CF76]"
                    : "bg-[#FF7675]/15 border border-[#FF7675]/30 text-[#FF7675]"
                }`}
              >
                {igTestStatus.msg}
              </div>
            )}
          </div>

          <div className="w-full max-w-[320px] flex flex-col gap-2.5 mt-6">
            <button
              type="button"
              disabled={submitting}
              onClick={() => void handleFinishStudio()}
              className="studio-btn-primary w-full py-2.5 text-[13.5px] shadow-lg"
            >
              Finalizar e entrar no Estúdio
            </button>
            <button
              type="button"
              onClick={() => setStep(3)}
              className="studio-btn-secondary w-full py-2.5 text-[13px]"
            >
              Voltar
            </button>
          </div>

          <button
            type="button"
            disabled={submitting}
            onClick={() => void handleFinishStudio()}
            className="mt-4 text-[12px] text-[#979797] hover:text-white underline-offset-4 hover:underline"
          >
            Pular e configurar depois
          </button>
        </div>
  );
}
