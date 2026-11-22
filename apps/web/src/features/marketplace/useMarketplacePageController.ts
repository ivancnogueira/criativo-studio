import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  AgenteRegistro,
  GithubImportPreview,
  MarketplaceAgentPackage,
  MarketplaceAppItem,
  MarketplaceAuthFlow,
  MarketplaceSkillItem,
  MarketplaceSourceFilter,
  MarketplaceTab,
  McpAcessoAgentes,
  McpOAuthStatus,
  McpProbeResultado,
  McpServidorConfig,
  McpTransporte,
  NativeAppAccountSummary,
} from "@criativo/contracts";
import {
  AppBrandIcon,
  CarbonSelect,
  SlidingTabs,
  type CarbonSelectOption,
} from "../../components/ui/CarbonControls";
import { daemonApi } from "../../services/websocket-client";
import { groupByCategory, isGithubUrlCandidate, type MarketplaceYourAppEntry } from "./marketplace-helpers";

export interface MarketplacePageProps {
  agentes: AgenteRegistro[];
  initialCatalog?: {
    apps?: MarketplaceAppItem[];
    agents?: MarketplaceAgentPackage[];
    skills?: MarketplaceSkillItem[];
    nativeAccounts?: NativeAppAccountSummary[];
    connectedNativeSlugs?: string[];
  };
  initialTab?: MarketplaceTab;
  initialAppSlug?: string | null;
  initialYourApps?: MarketplaceYourAppEntry[];
  initialNativeAccounts?: NativeAppAccountSummary[];
  onRefreshStudio?: () => Promise<void>;
  onTryPromptInChat?: (agentId: string, prompt: string) => void;
  onCreateSkillWithAgent?: (agentId: string, prompt: string) => void;
  onOpenWhatsAppModal?: () => void;
}


export function useMarketplacePageController(props: MarketplacePageProps) {
  const {
    agentes,
    initialCatalog,
    initialTab = "apps",
    initialAppSlug = null,
    initialYourApps = [],
    initialNativeAccounts = [],
    onRefreshStudio,
    onTryPromptInChat,
    onCreateSkillWithAgent,
    onOpenWhatsAppModal,
  } = props;

  const [tab, setTab] = useState<MarketplaceTab>(initialTab);
  const [sourceFilter, setSourceFilter] = useState<MarketplaceSourceFilter>("all");
  const [query, setQuery] = useState("");
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const [apps, setApps] = useState<MarketplaceAppItem[]>(initialCatalog?.apps ?? []);
  const [agentTemplates, setAgentTemplates] = useState<MarketplaceAgentPackage[]>(
    initialCatalog?.agents ?? []
  );
  const [skills, setSkills] = useState<MarketplaceSkillItem[]>(initialCatalog?.skills ?? []);
  const [yourApps, setYourApps] = useState<MarketplaceYourAppEntry[]>(initialYourApps);

  const [selectedAppSlug, setSelectedAppSlug] = useState<string | null>(initialAppSlug);
  const [appDetail, setAppDetail] = useState<MarketplaceAppItem | null>(() =>
    initialAppSlug
      ? (initialCatalog?.apps ?? []).find((a) => a.slug === initialAppSlug) ?? null
      : null
  );
  const [appAccounts, setAppAccounts] = useState<
    Array<{
      server: McpServidorConfig;
      contaRotulo: string | null;
      oauthStatus: McpOAuthStatus;
    }>
  >([]);
  const [nativeAccounts, setNativeAccounts] = useState<NativeAppAccountSummary[]>(initialNativeAccounts);
  const [allNativeAccounts, setAllNativeAccounts] =
    useState<NativeAppAccountSummary[]>(initialNativeAccounts);
  const [connectedNativeSlugs, setConnectedNativeSlugs] = useState<string[]>(() =>
    initialCatalog?.connectedNativeSlugs ??
    Array.from(new Set(initialNativeAccounts.map((a) => a.app_slug)))
  );
  const [selectedNativeContaId, setSelectedNativeContaId] = useState<string | null>(
    initialNativeAccounts[0]?.conta_id ?? null
  );
  const [nativeCreatingNew, setNativeCreatingNew] = useState(false);
  const [testingContaId, setTestingContaId] = useState<string | null>(null);
  const [activeFlowIndex, setActiveFlowIndex] = useState(0);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [contaRotuloInput, setContaRotuloInput] = useState("");
  const [connectBusy, setConnectBusy] = useState(false);
  const [connectFeedback, setConnectFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [accessFeedback, setAccessFeedback] = useState<string | null>(null);
  const [localInstructions, setLocalInstructions] = useState<string[]>([]);

  const unlockedAgents = useMemo(
    () =>
      agentes.filter(
        (ag) =>
          ag.agente_id !== "assistente_setup" &&
          ag.agente_id !== "assistente_servidor_vps" &&
          (ag.config as Record<string, unknown>)?.upgrade_desbloqueado !== false
      ),
    [agentes]
  );

  const [accessServerId, setAccessServerId] = useState<string | null>(null);
  const [accessMode, setAccessMode] = useState<"everyone" | "agents">("everyone");
  const [accessAgents, setAccessAgents] = useState<string[]>([]);
  const [tryTargetAgentId, setTryTargetAgentId] = useState(
    unlockedAgents[0]?.agente_id ?? agentes[0]?.agente_id ?? "estrategista"
  );

  const [customMcpModalOpen, setCustomMcpModalOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<MarketplaceYourAppEntry | null>(null);
  const [createSkillModalOpen, setCreateSkillModalOpen] = useState(false);
  const [batchSkillTarget, setBatchSkillTarget] = useState<MarketplaceSkillItem | null>(null);
  const [skillPendingDelete, setSkillPendingDelete] = useState<MarketplaceSkillItem | null>(null);

  const [githubPreview, setGithubPreview] = useState<GithubImportPreview | null>(null);
  const [githubLoading, setGithubLoading] = useState(false);
  const [githubModalOpen, setGithubModalOpen] = useState(false);
  const [githubUrlInput, setGithubUrlInput] = useState("");

  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);
  const nativeSidebarEntries = useMemo(() => {
    const grouped = new Map<string, NativeAppAccountSummary[]>();
    for (const acc of allNativeAccounts) {
      if (!acc.configurado) continue;
      const list = grouped.get(acc.app_slug) ?? [];
      list.push(acc);
      grouped.set(acc.app_slug, list);
    }
    for (const slug of connectedNativeSlugs) {
      if (!grouped.has(slug)) {
        grouped.set(slug, []);
      }
    }
    return Array.from(grouped.entries()).map(([slug, accounts]) => {
      const meta = apps.find((a) => a.slug === slug);
      const primary = accounts[0];
      const handle = primary?.perfil_conectado?.username
        ? `@${primary.perfil_conectado.username.replace(/^@/, "")}`
        : primary?.conta_rotulo ?? "";
      return {
        slug,
        name: meta?.name ?? slug,
        accountsCount: accounts.length,
        subtitle:
          accounts.length > 1
            ? `${accounts.length} contas conectadas`
            : handle || "Conectado",
        allOk: accounts.length === 0 ? true : accounts.every((a) => a.testado_ok || a.configurado),
      };
    });
  }, [allNativeAccounts, connectedNativeSlugs, apps]);
  const [undoState, setUndoState] = useState<{
    skillId: string;
    skillName: string;
    previousAgentIds: string[];
  } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadCatalogAndApps = async () => {
    try {
      const [snap, servers] = await Promise.all([
        daemonApi.getLojaCatalogo(),
        daemonApi.listMcpServers(),
      ]);
      setApps(snap.apps);
      setAgentTemplates(snap.agents);
      setSkills(snap.skills);
      setYourApps(servers);
      setAllNativeAccounts(snap.nativeAccounts ?? []);
      setConnectedNativeSlugs(
        snap.connectedNativeSlugs ??
          Array.from(new Set((snap.nativeAccounts ?? []).map((a) => a.app_slug)))
      );
    } catch {
      // Silencioso em SSR ou daemon indisponível antes do boot
    }
  };

  useEffect(() => {
    if (!initialCatalog) {
      void loadCatalogAndApps();
    }
  }, []);

  useEffect(() => {
    if (initialAppSlug) {
      setTab("apps");
      setSelectedAppSlug(initialAppSlug);
    }
  }, [initialAppSlug]);

  const applyAppDetailResponse = (
    res: Awaited<ReturnType<typeof daemonApi.getLojaAppDetail>>,
    preferredContaId?: string | null,
    preserveBlankForm = false
  ) => {
    setAppDetail(res.app);
    setAppAccounts(res.accounts);
    const nextNative = res.nativeAccounts ?? [];
    setNativeAccounts(nextNative);

    if (res.app.isNative) {
      setAccessServerId(null);
      if (preserveBlankForm) {
        return;
      }
      const chosen =
        (preferredContaId
          ? nextNative.find((acc) => acc.conta_id === preferredContaId)
          : undefined) ?? nextNative[0];
      if (chosen) {
        setSelectedNativeContaId(chosen.conta_id);
        setNativeCreatingNew(false);
        setContaRotuloInput(chosen.conta_rotulo || "");
        setFieldValues({ ...(chosen.campos_visiveis ?? {}) });
        setAccessMode(chosen.acesso?.mode ?? "everyone");
        setAccessAgents(chosen.acesso?.agentIds ?? []);
      } else {
        setSelectedNativeContaId(null);
        setNativeCreatingNew(false);
        setContaRotuloInput("");
        setFieldValues({});
        setAccessMode("everyone");
        setAccessAgents([]);
      }
      return;
    }

    setNativeAccounts([]);
    setSelectedNativeContaId(null);
    setNativeCreatingNew(false);
    const firstAcc = res.accounts[0]?.server;
    if (firstAcc) {
      setAccessServerId(firstAcc.mcp_id);
      setAccessMode(firstAcc.acesso.mode);
      setAccessAgents(firstAcc.acesso.agentIds);
    } else {
      setAccessServerId(null);
      setAccessMode("everyone");
      setAccessAgents([]);
    }
  };

  useEffect(() => {
    setConnectFeedback(null);
    setAccessFeedback(null);
    setLocalInstructions([]);
    setNativeCreatingNew(false);
    setSelectedNativeContaId(null);
    if (!selectedAppSlug) {
      setAppDetail(null);
      setAppAccounts([]);
      setNativeAccounts([]);
      return;
    }
    const localFound = apps.find((a) => a.slug === selectedAppSlug) ?? null;
    if (localFound) setAppDetail(localFound);

    void daemonApi
      .getLojaAppDetail(selectedAppSlug)
      .then((res) => applyAppDetailResponse(res))
      .catch(() => {
        // Usa versão em memória caso esteja em teste isolado
      });
  }, [selectedAppSlug]);

  useEffect(() => {
    if ((tab === "skills" || tab === "agents") && isGithubUrlCandidate(query)) {
      const kind = tab === "agents" ? "agents" : "skills";
      setGithubLoading(true);
      const timer = setTimeout(() => {
        void daemonApi
          .inspectGithubRepo(query.trim(), kind)
          .then(setGithubPreview)
          .catch(() => setGithubPreview(null))
          .finally(() => setGithubLoading(false));
      }, 280);
      return () => clearTimeout(timer);
    }
    setGithubPreview(null);
  }, [query, tab]);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

  const normalizedQuery = query.trim().toLowerCase();

  const filteredApps = useMemo(() => {
    return apps.filter((app) => {
      if (expandedCategory && app.category !== expandedCategory) return false;
      if (!normalizedQuery) return true;
      return (
        app.name.toLowerCase().includes(normalizedQuery) ||
        app.tagline.toLowerCase().includes(normalizedQuery) ||
        app.category.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [apps, normalizedQuery, expandedCategory]);

  const appGroups = useMemo(() => groupByCategory(filteredApps), [filteredApps]);

  const filteredAgents = useMemo(() => {
    return agentTemplates.filter((ag) => {
      if (sourceFilter === "verified" && !ag.verified) return false;
      if (sourceFilter === "public" && ag.verified) return false;
      if (!normalizedQuery || isGithubUrlCandidate(query)) return true;
      return (
        ag.name.toLowerCase().includes(normalizedQuery) ||
        ag.role.toLowerCase().includes(normalizedQuery) ||
        ag.description.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [agentTemplates, sourceFilter, normalizedQuery, query]);

  const filteredSkills = useMemo(() => {
    return skills.filter((sk) => {
      if (sourceFilter === "verified" && !sk.verified) return false;
      if (sourceFilter === "public" && sk.verified) return false;
      if (!normalizedQuery || isGithubUrlCandidate(query)) return true;
      return (
        sk.name.toLowerCase().includes(normalizedQuery) ||
        sk.description.toLowerCase().includes(normalizedQuery) ||
        sk.category.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [skills, sourceFilter, normalizedQuery, query]);

  const installedSkills = useMemo(
    () => filteredSkills.filter((sk) => sk.installed),
    [filteredSkills]
  );
  const catalogSkillGroups = useMemo(
    () => groupByCategory(filteredSkills.filter((sk) => !sk.installed)),
    [filteredSkills]
  );

  const totalAgentsCount = Math.max(1, unlockedAgents.length);

  const selectNativeAccount = (acc: NativeAppAccountSummary) => {
    setNativeCreatingNew(false);
    setSelectedNativeContaId(acc.conta_id);
    setContaRotuloInput(acc.conta_rotulo || "");
    setFieldValues({ ...(acc.campos_visiveis ?? {}) });
    setAccessMode(acc.acesso?.mode ?? "everyone");
    setAccessAgents(acc.acesso?.agentIds ?? []);
    setConnectFeedback(null);
    setAccessFeedback(null);
  };

  const handleStartNewNativeAccount = () => {
    setNativeCreatingNew(true);
    setSelectedNativeContaId(null);
    setContaRotuloInput("");
    setFieldValues({});
    setConnectFeedback({
      ok: true,
      text: "Preencha as credenciais da nova conta abaixo e clique em Testar conexão.",
    });
  };

  const handleConnectAppFlow = async (flow: MarketplaceAuthFlow) => {
    if (!appDetail) return;
    if (appDetail.slug === "whatsapp" && onOpenWhatsAppModal) {
      onOpenWhatsAppModal();
      return;
    }

    setConnectBusy(true);
    setConnectFeedback(null);
    setAccessFeedback(null);
    setLocalInstructions([]);
    try {
      const targetContaId =
        appDetail.isNative && !nativeCreatingNew && selectedNativeContaId
          ? selectedNativeContaId
          : undefined;
      const res = await daemonApi.connectLojaApp(appDetail.slug, {
        flowId: flow.id,
        kind: flow.kind,
        contaId: targetContaId,
        contaRotulo: contaRotuloInput.trim() || undefined,
        fields: fieldValues,
        acesso: {
          mode: accessMode,
          agentIds: accessMode === "agents" ? accessAgents : [],
        },
      });

      if (res.authorizeUrl && typeof window !== "undefined") {
        window.open(res.authorizeUrl, "_blank", "noopener,noreferrer");
        setConnectFeedback({ ok: true, text: "Aguardando autenticação no navegador..." });
      } else if (res.instructions && res.instructions.length > 0) {
        setLocalInstructions(res.instructions);
        setConnectFeedback({
          ok: res.probe?.status === "passed",
          text:
            res.probe?.status === "passed"
              ? `App local validado (${res.probe.toolCount} ferramentas).`
              : "Siga os passos abaixo no aplicativo local e execute Testar conexão.",
        });
      } else if (res.nativeAccount) {
        const acc = res.nativeAccount;
        const ok = Boolean(res.validationReport?.ok ?? acc.testado_ok);
        const rawHandle = acc.perfil_conectado?.username?.replace(/^@/, "") ?? "";
        const usernameSuffix = rawHandle ? ` (@${rawHandle})` : "";
        const resumo = res.validationReport?.resumo ?? "";
        const resumoHasHandle =
          Boolean(rawHandle) &&
          resumo.toLowerCase().includes(rawHandle.toLowerCase());
        const text = resumo
          ? `${resumo}${resumoHasHandle ? "" : usernameSuffix}`
          : ok
            ? `Conta "${acc.conta_rotulo}" conectada no Cofre${usernameSuffix}.`
            : acc.ultimo_erro || "Credenciais salvas no Cofre AES-256-GCM. Verifique os dados na Meta.";
        setConnectFeedback({ ok, text });
      } else {
        setConnectFeedback({
          ok: true,
          text:
            res.probe?.status === "passed"
              ? `Conectado com ${res.probe.toolCount} ferramentas disponíveis.`
              : "Configuração salva no Cofre AES-256-GCM.",
        });
      }
      await loadCatalogAndApps();
      if (selectedAppSlug) {
        const refreshed = await daemonApi.getLojaAppDetail(selectedAppSlug);
        applyAppDetailResponse(refreshed, res.nativeAccount?.conta_id ?? targetContaId ?? null);
      }
    } catch (err) {
      setConnectFeedback({
        ok: false,
        text: err instanceof Error ? err.message : "Falha ao conectar aplicativo.",
      });
    } finally {
      setConnectBusy(false);
    }
  };

  const handleTestNativeAccount = async (contaId: string) => {
    if (!appDetail) return;
    setTestingContaId(contaId);
    setConnectFeedback(null);
    try {
      const res = await daemonApi.testNativeAppConnection(appDetail.slug, { contaId });
      setConnectFeedback({ ok: res.ok, text: res.resumo });
      await loadCatalogAndApps();
      if (selectedAppSlug) {
        const refreshed = await daemonApi.getLojaAppDetail(selectedAppSlug);
        applyAppDetailResponse(refreshed, contaId);
      }
    } catch (err) {
      setConnectFeedback({
        ok: false,
        text: err instanceof Error ? err.message : "Falha ao testar conta conectada.",
      });
    } finally {
      setTestingContaId(null);
    }
  };

  const handleDeleteNativeAccount = async (contaId: string) => {
    if (!appDetail) return;
    setConnectBusy(true);
    setConnectFeedback(null);
    try {
      await daemonApi.deleteNativeAppAccount(appDetail.slug, contaId);
      setConnectFeedback({ ok: true, text: "Conta removida do Cofre com segurança." });
      await loadCatalogAndApps();
      if (selectedAppSlug) {
        const refreshed = await daemonApi.getLojaAppDetail(selectedAppSlug);
        applyAppDetailResponse(refreshed, null);
      }
    } catch (err) {
      setConnectFeedback({
        ok: false,
        text: err instanceof Error ? err.message : "Falha ao desconectar conta.",
      });
    } finally {
      setConnectBusy(false);
    }
  };

  const handleApplyAgentAccess = async () => {
    if (!appDetail) return;
    const acessoPayload: McpAcessoAgentes = {
      mode: accessMode,
      agentIds: accessMode === "agents" ? accessAgents : [],
    };
    setAccessFeedback(null);
    if (appDetail.isNative) {
      try {
        const res = await daemonApi.updateNativeAppAccess(appDetail.slug, {
          contaId: selectedNativeContaId,
          acesso: acessoPayload,
        });
        setNativeAccounts(res.nativeAccounts);
        const targetAcc =
          (selectedNativeContaId
            ? res.nativeAccounts.find((a) => a.conta_id === selectedNativeContaId)
            : res.nativeAccounts[0]) ?? null;
        if (targetAcc) {
          setAccessMode(targetAcc.acesso.mode);
          setAccessAgents(targetAcc.acesso.agentIds);
        }
        setAccessFeedback(
          accessMode === "everyone"
            ? "Acesso liberado para todos os agentes do estúdio."
            : `Acesso atualizado para ${acessoPayload.agentIds.length} agente(s) selecionado(s).`
        );
        await loadCatalogAndApps();
        await onRefreshStudio?.();
      } catch (err) {
        setAccessFeedback(
          err instanceof Error ? err.message : "Falha ao atualizar permissões deste conector."
        );
      }
      return;
    }

    if (!accessServerId) return;
    await daemonApi.setMcpServerStatus(accessServerId, {
      acesso: acessoPayload,
    });
    setAccessFeedback("Permissões de agentes atualizadas com sucesso.");
    await loadCatalogAndApps();
  };

  const handleInstallAgentTemplate = async (pkg: MarketplaceAgentPackage) => {
    const installed = await daemonApi.installLojaAgent(pkg.slug);
    setFeedbackBanner(`Agente "${installed.agente.nome}" instalado no estúdio.`);
    await onRefreshStudio?.();
  };

  const handleConfirmSkillBatch = async (
    skill: MarketplaceSkillItem,
    nextAgentIds: string[]
  ) => {
    const res = await daemonApi.setSkillAgentsBatch(skill.skillId, nextAgentIds);
    await loadCatalogAndApps();
    await onRefreshStudio?.();

    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoState({
      skillId: res.skillId,
      skillName: skill.name,
      previousAgentIds: res.previousAgentIds,
    });
    undoTimerRef.current = setTimeout(() => {
      setUndoState(null);
    }, 6000);
  };

  const handleUndoSkillBatch = async () => {
    if (!undoState) return;
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    const target = undoState;
    setUndoState(null);
    await daemonApi.setSkillAgentsBatch(target.skillId, target.previousAgentIds);
    await loadCatalogAndApps();
    await onRefreshStudio?.();
  };

  const handleInstallGithubItem = async (
    repoUrl: string,
    kind: "skills" | "agents",
    itemPath: string
  ) => {
    const res = await daemonApi.installFromGithub({
      url: repoUrl,
      kind,
      itemPaths: [itemPath],
      targetAgentIds: ["estrategista"],
    });
    setFeedbackBanner(`${res.installedCount} item(ns) instalados a partir do GitHub.`);
    await loadCatalogAndApps();
    await onRefreshStudio?.();
  };

  const agentSelectOptions: CarbonSelectOption[] = useMemo(
    () =>
      (unlockedAgents.length > 0
        ? unlockedAgents
        : [{ agente_id: "estrategista", nome: "Estrategista Editorial" } as AgenteRegistro]
      ).map((ag) => ({
        value: ag.agente_id,
        label: ag.nome,
      })),
    [unlockedAgents]
  );

  // ------------------------------------------------------------------
  // Render da página detalhada do app (`MarketplaceAppPage`)
  // ------------------------------------------------------------------

  return {
    tab,
    setTab,
    sourceFilter,
    setSourceFilter,
    query,
    setQuery,
    expandedCategory,
    setExpandedCategory,
    apps,
    setApps,
    agentTemplates,
    setAgentTemplates,
    skills,
    setSkills,
    yourApps,
    setYourApps,
    selectedAppSlug,
    setSelectedAppSlug,
    appDetail,
    setAppDetail,
    appAccounts,
    setAppAccounts,
    nativeAccounts,
    setNativeAccounts,
    allNativeAccounts,
    setAllNativeAccounts,
    connectedNativeSlugs,
    setConnectedNativeSlugs,
    selectedNativeContaId,
    setSelectedNativeContaId,
    nativeCreatingNew,
    setNativeCreatingNew,
    testingContaId,
    setTestingContaId,
    activeFlowIndex,
    setActiveFlowIndex,
    fieldValues,
    setFieldValues,
    contaRotuloInput,
    setContaRotuloInput,
    connectBusy,
    setConnectBusy,
    connectFeedback,
    setConnectFeedback,
    accessFeedback,
    setAccessFeedback,
    localInstructions,
    setLocalInstructions,
    accessServerId,
    setAccessServerId,
    accessMode,
    setAccessMode,
    accessAgents,
    setAccessAgents,
    tryTargetAgentId,
    setTryTargetAgentId,
    customMcpModalOpen,
    setCustomMcpModalOpen,
    editingServer,
    setEditingServer,
    createSkillModalOpen,
    setCreateSkillModalOpen,
    batchSkillTarget,
    setBatchSkillTarget,
    skillPendingDelete,
    setSkillPendingDelete,
    githubPreview,
    setGithubPreview,
    githubLoading,
    setGithubLoading,
    githubModalOpen,
    setGithubModalOpen,
    githubUrlInput,
    setGithubUrlInput,
    feedbackBanner,
    setFeedbackBanner,
    undoState,
    setUndoState,
    unlockedAgents,
    nativeSidebarEntries,
    undoTimerRef,
    loadCatalogAndApps,
    applyAppDetailResponse,
    normalizedQuery,
    filteredApps,
    appGroups,
    filteredAgents,
    filteredSkills,
    installedSkills,
    catalogSkillGroups,
    totalAgentsCount,
    agentSelectOptions,
    selectNativeAccount,
    handleStartNewNativeAccount,
    handleConnectAppFlow,
    handleTestNativeAccount,
    handleDeleteNativeAccount,
    handleApplyAgentAccess,
    handleInstallAgentTemplate,
    handleConfirmSkillBatch,
    handleUndoSkillBatch,
    handleInstallGithubItem
  };
}

export type MarketplacePageController = ReturnType<typeof useMarketplacePageController>;
