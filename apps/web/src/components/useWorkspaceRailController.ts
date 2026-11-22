import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ContaProvedorInfo,
} from "@criativo/contracts";
import { WorkspaceRailProps, MAX_VISIBLE_ACCOUNT_RINGS, PROVIDER_DISPLAY_ORDER } from "./workspace-rail-quota-rings";

export function useWorkspaceRailController(props: WorkspaceRailProps) {
  const {
  activeSection,
  onSelectSection,
  quotaPercent = 96,
  uso,
  onRefreshUsage,
  whatsappStatus,
  pendingCount = 0,
  onOpenWhatsAppModal,
  onOpenSettings,
  onOpenHelp,
  servers = [],
  activeServerId = "primary",
  serverQuota = null,
  onSelectServer,
  onOpenNewLocalServer,
  onOpenNewRemoteServer,
  onOpenJoinServer,
  onOpenServerSettings,
  onOpenDisplaySettings,
} = props;
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [moreRingsMenuOpen, setMoreRingsMenuOpen] = useState(false);
  const [fallbackPopoverOpen, setFallbackPopoverOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [serverPopoverOpen, setServerPopoverOpen] = useState(false);

  const activeServer = useMemo(
    () => servers.find((s) => s.server_id === activeServerId) ?? servers[0] ?? null,
    [servers, activeServerId]
  );

  const allAccounts = uso?.contas ?? [];
  const hasAnyMissingQuota = useMemo(
    () => allAccounts.some((c) => !c.grupos_cota || c.grupos_cota.length === 0),
    [allAccounts]
  );

  const orderedAccounts = useMemo<ContaProvedorInfo[]>(() => {
    return [...allAccounts].sort((a, b) => {
      const pa = PROVIDER_DISPLAY_ORDER[a.provedor] ?? 99;
      const pb = PROVIDER_DISPLAY_ORDER[b.provedor] ?? 99;
      if (pa !== pb) return pa - pb;
      if (Boolean(a.padrao) !== Boolean(b.padrao)) return a.padrao ? -1 : 1;
      const la = (a.email ?? a.rotulo ?? a.id).toLowerCase();
      const lb = (b.email ?? b.rotulo ?? b.id).toLowerCase();
      return la.localeCompare(lb, "pt-BR");
    });
  }, [allAccounts]);

  const visibleAccounts = useMemo(
    () => orderedAccounts.slice(0, MAX_VISIBLE_ACCOUNT_RINGS),
    [orderedAccounts]
  );
  const hasOverflowAccounts = orderedAccounts.length > MAX_VISIBLE_ACCOUNT_RINGS;

  const activeAccount = useMemo(
    () =>
      activeAccountId
        ? orderedAccounts.find((acc) => acc.id === activeAccountId) ?? null
        : null,
    [orderedAccounts, activeAccountId]
  );

  const popoverOpen =
    activeAccount !== null || (orderedAccounts.length === 0 && fallbackPopoverOpen);
  const popoverAccounts = useMemo<ContaProvedorInfo[]>(
    () => (activeAccount ? [activeAccount] : []),
    [activeAccount]
  );

  const fallbackPercent = Math.max(5, Math.min(100, quotaPercent));
  const hasAnyConnectedAccount = allAccounts.length > 0;
  const autoSyncedAccountsKeyRef = useRef<string | null>(null);
  const lastAutoSyncAtRef = useRef<number>(0);

  const handleRefresh = useCallback(async () => {
    if (!onRefreshUsage || refreshing) return;
    lastAutoSyncAtRef.current = Date.now();
    setRefreshing(true);
    try {
      await onRefreshUsage();
    } finally {
      setRefreshing(false);
    }
  }, [onRefreshUsage, refreshing]);

  const triggerFallbackUsageSync = useCallback(() => {
    if (!onRefreshUsage || refreshing || allAccounts.length === 0 || !hasAnyMissingQuota) {
      return;
    }
    if (Date.now() - lastAutoSyncAtRef.current < 15_000) {
      return;
    }
    void handleRefresh();
  }, [allAccounts.length, handleRefresh, hasAnyMissingQuota, onRefreshUsage, refreshing]);

  useEffect(() => {
    if (!onRefreshUsage || allAccounts.length === 0 || !hasAnyMissingQuota) {
      return;
    }
    const key = `${activeServerId}::${allAccounts
      .map((acc) => `${acc.provedor}:${acc.id}:${acc.grupos_cota?.length ?? 0}`)
      .sort()
      .join("|")}`;
    if (autoSyncedAccountsKeyRef.current === key) {
      return;
    }
    autoSyncedAccountsKeyRef.current = key;
    void handleRefresh();
  }, [activeServerId, allAccounts, handleRefresh, hasAnyMissingQuota, onRefreshUsage]);


  return {
    activeSection,
    onSelectSection,
    quotaPercent,
    uso,
    onRefreshUsage,
    whatsappStatus,
    pendingCount,
    onOpenWhatsAppModal,
    onOpenSettings,
    onOpenHelp,
    servers,
    activeServerId,
    serverQuota,
    onSelectServer,
    onOpenNewLocalServer,
    onOpenNewRemoteServer,
    onOpenJoinServer,
    onOpenServerSettings,
    onOpenDisplaySettings,
    activeAccountId,
    setActiveAccountId,
    moreRingsMenuOpen,
    setMoreRingsMenuOpen,
    fallbackPopoverOpen,
    setFallbackPopoverOpen,
    refreshing,
    setRefreshing,
    serverPopoverOpen,
    setServerPopoverOpen,
    activeServer,
    allAccounts,
    hasAnyMissingQuota,
    orderedAccounts,
    visibleAccounts,
    hasOverflowAccounts,
    activeAccount,
    popoverOpen,
    popoverAccounts,
    fallbackPercent,
    hasAnyConnectedAccount,
    autoSyncedAccountsKeyRef,
    lastAutoSyncAtRef,
    handleRefresh,
    triggerFallbackUsageSync,
  };
}

export type WorkspaceRailController = ReturnType<typeof useWorkspaceRailController>;
