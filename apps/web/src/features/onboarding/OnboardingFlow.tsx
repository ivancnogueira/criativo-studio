import React, { useMemo, useState } from "react";
import type { OnboardingEstado, ProvedorStatusInfo, ProviderName } from "@criativo/contracts";
import {
  Check,
  ChevronRight,
  FileText,
  ImagePlus,
  KeyRound,
  MonitorSmartphone,
  Palette,
  Smartphone,
  Sparkles,
  Upload,
} from "lucide-react";
import { MascoteAvatar } from "../../components/MascoteAvatar";
import { ProviderLogo } from "../../components/ProviderLogo";

export type OnboardingUploadCategoria = "logo" | "foto" | "referencia" | "ficha_pdf";

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

const ARCH_MASCOTS = [
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
export const OnboardingFlow: React.FC<OnboardingFlowProps> = ({
  initialState,
  initialStep = 1,
  provedores,
  unlockedAgentsCount,
  onConnectProvider,
  onConnectProviderViaBrowser,
  onCancelProviderBrowserSignIn,
  pendingAuthUrl,
  onUploadCategorizedFile,
  onSaveBrandIdentity,
  onTestInstagram,
  onOpenWhatsAppModal,
  onComplete,
  activeServerName,
  isSecondaryServer,
  onBackToPrimaryServer,
}) => {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(initialStep);
  const [providerModeChoice, setProviderModeChoice] = useState<"gratuito" | "assinatura">(
    initialState?.modo_provedor_inicial === "gratuito" ? "gratuito" : "assinatura"
  );
  const [telemetria, setTelemetria] = useState(initialState?.telemetria_anonima ?? true);
  const [marcaNome, setMarcaNome] = useState(
    initialState?.marca_nome && !initialState.marca_nome.includes("[NOME_DA_MARCA]")
      ? initialState.marca_nome
      : ""
  );
  const [perfilHandle, setPerfilHandle] = useState(
    initialState?.perfil_handle && !initialState.perfil_handle.includes("[@SEU_PERFIL]")
      ? initialState.perfil_handle
      : ""
  );
  const [nichoInput, setNichoInput] = useState("");
  const [publicoInput, setPublicoInput] = useState("");
  const [corFundo, setCorFundo] = useState("#141414");
  const [corPrimaria, setCorPrimaria] = useState("#31CF76");
  const [corAcento, setCorAcento] = useState("#F59E0B");
  const [uploadedItems, setUploadedItems] = useState<
    Array<{ categoria: OnboardingUploadCategoria; nome: string; caminho: string }>
  >([]);
  const [uploadingCategory, setUploadingCategory] = useState<OnboardingUploadCategoria | null>(null);
  const [pdfNotice, setPdfNotice] = useState<string | null>(null);

  const [igLabel, setIgLabel] = useState("Principal");
  const [igUserId, setIgUserId] = useState("");
  const [igToken, setIgToken] = useState("");
  const [testingIg, setTestingIg] = useState(false);
  const [igTestStatus, setIgTestStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  const [selectedProvider, setSelectedProvider] = useState<ProviderName | null>(
    initialState?.provedor_selecionado ?? null
  );
  const [showMoreProviders, setShowMoreProviders] = useState(false);
  const [editingKeyFor, setEditingKeyFor] = useState<ProviderName | null>(null);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [busyProvider, setBusyProvider] = useState<ProviderName | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [termsModalOpen, setTermsModalOpen] = useState(false);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [errorNote, setErrorNote] = useState<string | null>(null);

  const mainProviders = useMemo(() => {
    const order: ProviderName[] = ["openai", "claude", "gemini"];
    return order
      .map((id) => provedores.find((p) => p.provedor === id))
      .filter((item): item is ProvedorStatusInfo => Boolean(item));
  }, [provedores]);

  const extraProviders = useMemo(
    () =>
      provedores.filter(
        (p) => p.provedor === "opencode" || p.provedor === "grok" || p.provedor === "ollama"
      ),
    [provedores]
  );

  const opencodeFreeCount = useMemo(
    () => provedores.find((p) => p.provedor === "opencode")?.modelos.length ?? 0,
    [provedores]
  );

  const activeProviderConnected = useMemo(() => {
    if (!selectedProvider) return provedores.some((p) => p.conectado);
    return provedores.find((p) => p.provedor === selectedProvider)?.conectado ?? false;
  }, [provedores, selectedProvider]);

  const buildBrandPatch = (): Partial<OnboardingEstado> => {
    const patch: Partial<OnboardingEstado> = {};
    if (marcaNome.trim()) patch.marca_nome = marcaNome.trim();
    if (perfilHandle.trim()) {
      const clean = perfilHandle.trim();
      patch.perfil_handle = clean.startsWith("@") ? clean : `@${clean}`;
    }
    return patch;
  };

  const persistStep3BrandDraft = async () => {
    if (!onSaveBrandIdentity) return;
    await onSaveBrandIdentity({
      ...(marcaNome.trim() ? { marca_nome: marcaNome.trim() } : {}),
      ...(perfilHandle.trim()
        ? {
            perfil_handle: perfilHandle.trim().startsWith("@")
              ? perfilHandle.trim()
              : `@${perfilHandle.trim()}`,
          }
        : {}),
      ...(nichoInput.trim() ? { nicho: nichoInput.trim() } : {}),
      ...(publicoInput.trim() ? { publico_alvo: publicoInput.trim() } : {}),
      cores: {
        fundo: corFundo,
        texto: "#FFFFFF",
        primaria: corPrimaria,
        secundaria: "#42A0FF",
        acento: corAcento,
      },
    });
  };

  const handleFinishStudio = async (explicitMode?: "gratuito" | "assinatura") => {
    setSubmitting(true);
    try {
      await persistStep3BrandDraft().catch(() => {});
      const chosenMode = explicitMode ?? providerModeChoice;
      const openCodeConnected = provedores.some((p) => p.provedor === "opencode" && p.conectado);
      await onComplete({
        onboarding_concluido: true,
        modo_provedor_inicial: chosenMode,
        provedor_selecionado:
          chosenMode === "gratuito"
            ? selectedProvider ?? (openCodeConnected ? "opencode" : "ollama")
            : selectedProvider ?? "gemini",
        telemetria_anonima: telemetria,
        ...buildBrandPatch(),
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleChooseFree = async () => {
    setProviderModeChoice("gratuito");
    const openCodeReady = provedores.some((p) => p.provedor === "opencode" && p.conectado);
    if (!openCodeReady) {
      setStatusNote("Preparando OpenCode gratuito...");
      void onConnectProvider("opencode", "").catch(() => {});
    }
    await handleFinishStudio("gratuito");
  };

  const handleConfirmSubscription = async () => {
    setProviderModeChoice("assinatura");
    await handleFinishStudio("assinatura");
  };

  const handleUploadCategory = async (
    categoria: OnboardingUploadCategoria,
    fileList: FileList | null
  ) => {
    if (!fileList || fileList.length === 0 || !onUploadCategorizedFile) return;
    setUploadingCategory(categoria);
    setErrorNote(null);
    setPdfNotice(null);
    try {
      for (const file of Array.from(fileList)) {
        const res = await onUploadCategorizedFile(file, categoria);
        setUploadedItems((prev) => [
          ...prev,
          {
            categoria,
            nome: res.arquivo.nome_original,
            caminho: res.arquivo.caminho_relativo,
          },
        ]);
        if (categoria === "ficha_pdf" && res.brandExtraction?.ok) {
          const patch = res.brandExtraction.patch as Record<string, string | undefined>;
          if (patch.marca_nome && !marcaNome.trim()) setMarcaNome(patch.marca_nome);
          if (patch.perfil_handle && !perfilHandle.trim()) setPerfilHandle(patch.perfil_handle);
          if (patch.nicho && !nichoInput.trim()) setNichoInput(patch.nicho);
          if (patch.publico_alvo && !publicoInput.trim()) setPublicoInput(patch.publico_alvo);
          setPdfNotice(
            `Ficha PDF lida (${res.brandExtraction.extracted_chars} caracteres extraídos para perfil-da-marca.md).`
          );
        }
      }
    } catch (err) {
      setErrorNote(err instanceof Error ? err.message : "Falha ao enviar arquivo.");
    } finally {
      setUploadingCategory(null);
    }
  };

  const handleValidateInstagramStep = async () => {
    if (!onTestInstagram) return;
    if (!igUserId.trim() || !igToken.trim()) {
      setIgTestStatus({
        ok: false,
        msg: "Informe o IG User ID e o Token de Acesso antes de testar.",
      });
      return;
    }
    setTestingIg(true);
    setIgTestStatus(null);
    try {
      const res = await onTestInstagram({
        contaRotulo: igLabel,
        igUserId,
        accessToken: igToken,
      });
      setIgTestStatus({
        ok: res.ok,
        msg: res.username ? `${res.resumo} (@${res.username})` : res.resumo,
      });
    } catch (err) {
      setIgTestStatus({
        ok: false,
        msg: err instanceof Error ? err.message : "Erro ao testar Meta Graph API v27.0.",
      });
    } finally {
      setTestingIg(false);
    }
  };

  const handleBrowserConnect = async (prov: "gemini" | "claude" | "openai") => {
    if (!onConnectProviderViaBrowser) {
      setSelectedProvider(prov);
      setEditingKeyFor(prov);
      return;
    }
    setSelectedProvider(prov);
    setBusyProvider(prov);
    setEditingKeyFor(null);
    setStatusNote("Abrindo tela oficial de login no navegador...");
    setErrorNote(null);
    try {
      const res = await onConnectProviderViaBrowser(prov);
      if (res.ok) {
        setStatusNote(`${prov.toUpperCase()} conectado via navegador com sucesso!`);
      } else if (res.canceled) {
        setStatusNote("Login cancelado.");
        setErrorNote(null);
      } else {
        setStatusNote(null);
        setErrorNote(res.erro ?? "Não foi possível concluir o login no navegador.");
      }
    } catch (err) {
      setStatusNote(null);
      setErrorNote(err instanceof Error ? err.message : "Erro ao abrir login no navegador.");
    } finally {
      setBusyProvider(null);
    }
  };

  const handleSaveProvider = async (provedor: ProviderName, key?: string) => {
    setBusyProvider(provedor);
    setStatusNote(
      provedor === "opencode" && !key
        ? "Baixando OpenCode gratuito..."
        : null
    );
    setErrorNote(null);
    try {
      await onConnectProvider(provedor, key);
      setSelectedProvider(provedor);
      setEditingKeyFor(null);
      setApiKeyDraft("");
      setStatusNote(
        provedor === "opencode" && !key
          ? "OpenCode instalado e modelos gratuitos prontos!"
          : `Provedor ${provedor.toUpperCase()} conectado com segurança no Cofre.`
      );
    } catch (err) {
      setStatusNote(null);
      setErrorNote(
        err instanceof Error ? err.message : `Não foi possível conectar ${provedor}.`
      );
    } finally {
      setBusyProvider(null);
    }
  };

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
      ) : step === 2 ? (
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
            Entre uma vez. Todos os seus agentes liberados usam seu provedor preferido.
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
                                ? `${prov.cli_versao} · Conta pronta para seus agentes`
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
              Você pode alterar isso para cada agente depois.
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
              ? "Provedor pronto para os agentes."
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
      ) : step === 3 ? (
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
      ) : (
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
