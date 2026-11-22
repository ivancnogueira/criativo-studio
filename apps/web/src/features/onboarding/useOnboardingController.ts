import React, { useMemo, useState } from "react";
import type {
  OnboardingEstado,
  ProvedorStatusInfo,
  ProviderName,
} from "@criativo/contracts";
export type OnboardingUploadCategoria = "logo" | "foto" | "referencia" | "ficha_pdf";
import type { OnboardingFlowProps } from "./OnboardingFlow";

export function useOnboardingController({
  initialState,
  initialStep = 1,
  provedores,
  unlockedAgentsCount,
  isSecondaryServer = false,
  activeServerName,
  onConnectProvider,
  onConnectProviderViaBrowser,
  onCancelProviderBrowserSignIn,
  pendingAuthUrl,
  onSaveBrandIdentity,
  onUploadCategorizedFile,
  onTestInstagram,
  onComplete,
}: OnboardingFlowProps) {
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


  return {
    step,
    setStep,
    providerModeChoice,
    setProviderModeChoice,
    telemetria,
    setTelemetria,
    marcaNome,
    setMarcaNome,
    perfilHandle,
    setPerfilHandle,
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
    pdfNotice,
    igLabel,
    setIgLabel,
    igUserId,
    setIgUserId,
    igToken,
    setIgToken,
    testingIg,
    igTestStatus,
    selectedProvider,
    setSelectedProvider,
    showMoreProviders,
    setShowMoreProviders,
    editingKeyFor,
    setEditingKeyFor,
    apiKeyDraft,
    setApiKeyDraft,
    busyProvider,
    setBusyProvider,
    submitting,
    termsModalOpen,
    setTermsModalOpen,
    statusNote,
    setStatusNote,
    errorNote,
    mainProviders,
    extraProviders,
    opencodeFreeCount,
    activeProviderConnected,
    unlockedAgentsCount,
    isSecondaryServer,
    activeServerName,
    provedores,
    initialState,
    onConnectProvider,
    onConnectProviderViaBrowser,
    onCancelProviderBrowserSignIn,
    pendingAuthUrl,
    onTestInstagram,
    persistStep3BrandDraft,
    handleFinishStudio,
    handleChooseFree,
    handleConfirmSubscription,
    handleUploadCategory,
    handleValidateInstagramStep,
    handleBrowserConnect,
    handleSaveProvider,
  };
}

export type OnboardingController = ReturnType<typeof useOnboardingController>;
