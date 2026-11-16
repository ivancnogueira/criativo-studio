import React, { useMemo, useState } from "react";
import type { OnboardingEstado, ProvedorStatusInfo, ProviderName } from "@criativo/contracts";
import { Check, ChevronRight, KeyRound, MonitorSmartphone } from "lucide-react";
import { MascoteAvatar } from "../../components/MascoteAvatar";
import { ProviderLogo } from "../../components/ProviderLogo";

export interface OnboardingFlowProps {
  initialState: OnboardingEstado;
  initialStep?: 1 | 2;
  provedores: ProvedorStatusInfo[];
  onConnectProvider: (provedor: ProviderName, apiKey?: string) => Promise<void>;
  onConnectProviderViaBrowser?: (
    provedor: "gemini" | "claude" | "openai",
    label?: string
  ) => Promise<{ ok: boolean; canceled?: boolean; erro?: string }>;
  onCancelProviderBrowserSignIn?: (
    provedor: "gemini" | "claude" | "openai"
  ) => Promise<void>;
  pendingAuthUrl?: { provedor: "gemini" | "claude" | "openai"; url: string } | null;
  onComplete: (patch: Partial<OnboardingEstado>) => Promise<void>;
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
 * Fluxo guiado em 2 etapas espelhado fielmente nas telas iniciais do OpenBot (Screenshots 1 e 2).
 */
export const OnboardingFlow: React.FC<OnboardingFlowProps> = ({
  initialState,
  initialStep = 1,
  provedores,
  onConnectProvider,
  onConnectProviderViaBrowser,
  onCancelProviderBrowserSignIn,
  pendingAuthUrl,
  onComplete,
}) => {
  const [step, setStep] = useState<1 | 2>(initialStep);
  const [telemetria, setTelemetria] = useState(initialState.telemetria_anonima);
  const [marcaNome, setMarcaNome] = useState(
    initialState.marca_nome && !initialState.marca_nome.includes("[NOME_DA_MARCA]")
      ? initialState.marca_nome
      : ""
  );
  const [perfilHandle, setPerfilHandle] = useState(
    initialState.perfil_handle && !initialState.perfil_handle.includes("[@SEU_PERFIL]")
      ? initialState.perfil_handle
      : ""
  );
  const [selectedProvider, setSelectedProvider] = useState<ProviderName | null>(
    initialState.provedor_selecionado
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

  const handleChooseFree = async () => {
    setSubmitting(true);
    try {
      const openCodeConnected = provedores.some((p) => p.provedor === "opencode" && p.conectado);
      await onComplete({
        onboarding_concluido: true,
        modo_provedor_inicial: "gratuito",
        provedor_selecionado: openCodeConnected ? "opencode" : "ollama",
        telemetria_anonima: telemetria,
        ...buildBrandPatch(),
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmSubscription = async () => {
    setSubmitting(true);
    try {
      await onComplete({
        onboarding_concluido: true,
        modo_provedor_inicial: "assinatura",
        provedor_selecionado: selectedProvider ?? "gemini",
        telemetria_anonima: telemetria,
        ...buildBrandPatch(),
      });
    } finally {
      setSubmitting(false);
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
    setStatusNote(null);
    setErrorNote(null);
    try {
      await onConnectProvider(provedor, key);
      setSelectedProvider(provedor);
      setEditingKeyFor(null);
      setApiKeyDraft("");
      setStatusNote(`Provedor ${provedor.toUpperCase()} conectado com segurança no Cofre.`);
    } finally {
      setBusyProvider(null);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#141414] text-[#FFFFFF] flex flex-col items-center justify-center relative px-4 py-10 overflow-y-auto">
      {/* Pílula de status de runtime no canto superior direito (Screenshot 1 & 2) */}
      <div className="fixed top-4 right-4 z-30 w-72 rounded-xl bg-[#212121] border border-white/10 px-3.5 py-2.5 shadow-xl">
        <div className="flex items-start gap-2.5">
          <MonitorSmartphone className="h-4 w-4 text-[#DCDCDC] mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1 text-left">
            <p className="text-[12px] font-semibold text-white leading-snug">
              Criativo Runtime atualizado
            </p>
            <p className="text-[11px] text-[#979797] mt-0.5">
              {initialState.runtime_versao || "v2.3.0"} · Node + SQLite
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
            O Criativo Studio é gratuito para uso local. Escolha a IA dos seus 15 agentes criativos.
          </p>

          {/* Caixa agrupada estilo OpenBot */}
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
                    : "Sem assinatura externa · OpenCode ou Ollama local."}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-[#6A6A6A]" />
            </button>

            <button
              type="button"
              onClick={() => setStep(2)}
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
      ) : (
        <div className="w-full max-w-[440px] flex flex-col items-center">
          {/* Indicador de passo OpenBot (• —) */}
          <div className="flex items-center gap-1.5 mb-5" aria-label="Etapa 2 de 2">
            <span className="h-1.5 w-1.5 rounded-full bg-[#6A6A6A]" />
            <span className="h-1.5 w-5 rounded-full bg-white" />
          </div>

          <h2 className="text-[28px] font-bold tracking-tight text-white mb-1.5 text-center">
            Conecte seu plano
          </h2>
          <p className="text-[13px] text-[#979797] mb-7 text-center">
            Entre uma vez. Todos os 15 agentes usam seu provedor preferido.
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
                                ? `${prov.cli_versao} · Conta pronta para os 15 agentes`
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
                        onClick={() => {
                          setSelectedProvider(prov.provedor);
                          if (prov.provedor === "grok") {
                            setEditingKeyFor(isEditingExtra ? null : "grok");
                          } else if (prov.conectado) {
                            setStatusNote(`${prov.rotulo} selecionado como provedor inicial.`);
                          } else {
                            void handleSaveProvider(prov.provedor);
                          }
                        }}
                        className="rounded-full bg-[#242424] hover:bg-[#2A2A2A] border border-white/10 px-3 py-1 text-[11.5px] font-medium text-white"
                      >
                        {prov.conectado ? "Usar" : prov.provedor === "grok" ? "API Key" : "Verificar"}
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

          {/* CTAs em pílula idênticos à Screenshot 2 */}
          <div className="w-full max-w-[300px] flex flex-col gap-2.5 mt-7">
            <button
              type="button"
              disabled={submitting}
              onClick={handleConfirmSubscription}
              className="openbot-btn-primary w-full py-2.5 text-[13.5px] shadow-lg"
            >
              Abrir Criativo Studio
            </button>
            <button
              type="button"
              onClick={() => setStep(1)}
              className="openbot-btn-secondary w-full py-2.5 text-[13px]"
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
            onClick={handleChooseFree}
            className="mt-4 text-[12px] text-[#979797] hover:text-white underline-offset-4 hover:underline"
          >
            Prefiro modelos gratuitos
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
              className="openbot-btn-primary px-4 py-1.5 text-[12.5px]"
            >
              Entendi
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
