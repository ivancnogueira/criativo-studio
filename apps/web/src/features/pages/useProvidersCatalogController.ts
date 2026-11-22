import {
  useMemo,
  useState,
} from "react";
import type {
  ProviderName,
} from "@criativo/contracts";
import type { ProvidersCatalogViewProps } from "./providers-catalog-helpers";

export function useProvidersCatalogController(props: ProvidersCatalogViewProps) {
  const {
  provedores,
  defaultProvider,
  initialDetailProviderId = null,
  authorizingProvider,
  authError,
  pendingAuthUrl,
  onSelectDefaultProvider,
  onStartBrowserSignIn,
  onCancelBrowserSignIn,
  onConnectApiKey,
  onDisconnectProvider,
  onRefreshProviders,
  onTogglePool,
  onSetAccountActive,
  onToggleAccountExcluded,
  onRemoveAccount,
  onAddManualAccount,
  onSetModelsVisibility,
  onActiveProviderChange,
  activeServerName,
  activeServerKind,
  onSubmitManualOAuthCallback,
  onShowToast,
} = props;
  const [detailProviderId, setDetailProviderId] = useState<ProviderName | null>(
    initialDetailProviderId
  );

  const selectDetailProvider = (id: ProviderName | null) => {
    setDetailProviderId(id);
    onActiveProviderChange?.(
      id ? provedores.find((p) => p.provedor === id) ?? null : null
    );
  };
  const [providerQuery, setProviderQuery] = useState("");
  const [defaultMenuOpen, setDefaultMenuOpen] = useState(false);

  const [modelQuery, setModelQuery] = useState("");
  const [editingKey, setEditingKey] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [openAccountMenuId, setOpenAccountMenuId] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualEmail, setManualEmail] = useState("");
  const [manualLabel, setManualLabel] = useState("");
  const [manualToken, setManualToken] = useState("");
  const [refreshingRuntime, setRefreshingRuntime] = useState(false);
  const [installingOpenCode, setInstallingOpenCode] = useState(false);
  const [manualCallbackDraft, setManualCallbackDraft] = useState("");
  const [sendingManualCallback, setSendingManualCallback] = useState(false);
  const isRemoteServer = activeServerKind === "remote_vps" || activeServerKind === "joined";

  const activeDefaultInfo = useMemo(
    () => provedores.find((p) => p.provedor === defaultProvider) ?? provedores[0],
    [provedores, defaultProvider]
  );

  const detailProvider = useMemo(
    () => (detailProviderId ? provedores.find((p) => p.provedor === detailProviderId) ?? null : null),
    [provedores, detailProviderId]
  );

  const filteredProviders = useMemo(() => {
    const q = providerQuery.trim().toLowerCase();
    if (!q) return provedores;
    return provedores.filter(
      (p) =>
        p.rotulo.toLowerCase().includes(q) ||
        p.provedor.toLowerCase().includes(q) ||
        (p.contas ?? []).some((c) => (c.email ?? "").toLowerCase().includes(q))
    );
  }, [provedores, providerQuery]);

  const connectedProviders = useMemo(
    () =>
      filteredProviders.filter(
        (p) => p.conectado || authorizingProvider === p.provedor
      ),
    [filteredProviders, authorizingProvider]
  );

  const otherProviders = useMemo(
    () =>
      filteredProviders.filter(
        (p) => !p.conectado && authorizingProvider !== p.provedor
      ),
    [filteredProviders, authorizingProvider]
  );

  const filteredModels = useMemo(() => {
    if (!detailProvider) return [];
    const q = modelQuery.trim().toLowerCase();
    if (!q) return detailProvider.modelos;
    return detailProvider.modelos.filter(
      (m) => m.rotulo.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)
    );
  }, [detailProvider, modelQuery]);

  // =========================================================================
  // MODO DETALHE (< Provedores)
  // =========================================================================
  const isBrowserProvider =
    detailProvider?.provedor === "gemini" ||
    detailProvider?.provedor === "claude" ||
    detailProvider?.provedor === "openai";
  const isAuthorizing = detailProvider ? authorizingProvider === detailProvider.provedor : false;
  const authLink =
    detailProvider && pendingAuthUrl && pendingAuthUrl.provedor === detailProvider.provedor
      ? pendingAuthUrl.url
      : null;
  const contas = detailProvider?.contas ?? [];
  const agentCount = detailProvider?.usado_por_agentes?.length ?? 0;
  const isDefault = detailProvider ? defaultProvider === detailProvider.provedor : false;
  const totalModels = detailProvider?.modelos.length ?? 0;
  const hiddenIds = detailProvider ? detailProvider.modelos.filter((m) => m.oculto).map((m) => m.id) : [];
  const visibleModelsCount = totalModels - hiddenIds.length;
  const statusBadge = isAuthorizing
    ? { label: "Conectando", cls: "bg-[#42A0FF]/15 text-[#74B9FF]", dot: "bg-[#42A0FF]" }
    : detailProvider?.conectado
      ? { label: "Conectado", cls: "bg-[#31CF76]/15 text-[#31CF76]", dot: "bg-[#31CF76]" }
      : { label: "Não conectado", cls: "bg-white/[0.08] text-[#979797]", dot: "bg-[#7D7D7D]" };

  const handleToggleSingleModel = async (modelId: string, currentlyHidden: boolean) => {
    
    if (!detailProvider) return;if (!onSetModelsVisibility) return;
    const nextHidden = currentlyHidden
      ? hiddenIds.filter((id) => id !== modelId)
      : Array.from(new Set([...hiddenIds, modelId]));
    await onSetModelsVisibility(detailProvider.provedor, nextHidden);
  };

  const handleToggleAllModels = async () => {
    
    if (!detailProvider) return;if (!onSetModelsVisibility) return;
    if (visibleModelsCount > 0) {
      await onSetModelsVisibility(
        detailProvider.provedor,
        detailProvider.modelos.map((m) => m.id)
      );
    } else {
      await onSetModelsVisibility(detailProvider.provedor, []);
    }
  };


  return {
    provedores,
    defaultProvider,
    initialDetailProviderId,
    authorizingProvider,
    authError,
    pendingAuthUrl,
    onSelectDefaultProvider,
    onStartBrowserSignIn,
    onCancelBrowserSignIn,
    onConnectApiKey,
    onDisconnectProvider,
    onRefreshProviders,
    onTogglePool,
    onSetAccountActive,
    onToggleAccountExcluded,
    onRemoveAccount,
    onAddManualAccount,
    onSetModelsVisibility,
    onActiveProviderChange,
    activeServerName,
    activeServerKind,
    onSubmitManualOAuthCallback,
    onShowToast,
    detailProviderId,
    setDetailProviderId,
    selectDetailProvider,
    providerQuery,
    setProviderQuery,
    defaultMenuOpen,
    setDefaultMenuOpen,
    modelQuery,
    setModelQuery,
    editingKey,
    setEditingKey,
    keyDraft,
    setKeyDraft,
    openAccountMenuId,
    setOpenAccountMenuId,
    manualOpen,
    setManualOpen,
    manualEmail,
    setManualEmail,
    manualLabel,
    setManualLabel,
    manualToken,
    setManualToken,
    refreshingRuntime,
    setRefreshingRuntime,
    installingOpenCode,
    setInstallingOpenCode,
    manualCallbackDraft,
    setManualCallbackDraft,
    sendingManualCallback,
    setSendingManualCallback,
    isRemoteServer,
    activeDefaultInfo,
    detailProvider,
    filteredProviders,
    connectedProviders,
    otherProviders,
    filteredModels,
    isBrowserProvider,
    isAuthorizing,
    authLink,
    contas,
    agentCount,
    isDefault,
    totalModels,
    hiddenIds,
    visibleModelsCount,
    statusBadge,
    handleToggleSingleModel,
    handleToggleAllModels,
  };
}

export type ProvidersCatalogController = ReturnType<typeof useProvidersCatalogController>;
