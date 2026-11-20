import React, { useMemo, useState } from "react";
import type { ProvedorStatusInfo, ProviderName } from "@criativo/contracts";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  ChevronsUpDown,
  ExternalLink,
  MoreHorizontal,
  RefreshCw,
  Search,
  UserPlus,
} from "lucide-react";
import { ProviderLogo } from "../../components/ProviderLogo";

export interface ProvidersCatalogViewProps {
  provedores: ProvedorStatusInfo[];
  defaultProvider: ProviderName;
  initialDetailProviderId?: ProviderName | null;
  authorizingProvider: string | null;
  authError: string | null;
  pendingAuthUrl?: { provedor: "gemini" | "claude" | "openai"; url: string } | null;
  onSelectDefaultProvider?: (provedor: ProviderName) => Promise<void>;
  onStartBrowserSignIn: (prov: "gemini" | "claude" | "openai", label?: string) => Promise<void>;
  onCancelBrowserSignIn?: (prov: "gemini" | "claude" | "openai") => Promise<void>;
  onConnectApiKey: (provedor: ProviderName, apiKey: string) => Promise<void>;
  onDisconnectProvider: (provedor: ProviderName) => Promise<void>;
  onRefreshProviders?: () => Promise<void>;
  onTogglePool?: (provedor: ProviderName, habilitado: boolean) => Promise<void>;
  onSetAccountActive?: (provedor: ProviderName, contaId: string) => Promise<void>;
  onToggleAccountExcluded?: (
    provedor: ProviderName,
    contaId: string,
    exclude: boolean
  ) => Promise<void>;
  onRemoveAccount?: (provedor: ProviderName, contaId: string) => Promise<void>;
  onAddManualAccount?: (
    provedor: ProviderName,
    payload: { email: string; access_token: string; label?: string }
  ) => Promise<void>;
  onSetModelsVisibility?: (provedor: ProviderName, hiddenIds: string[]) => Promise<void>;
  onActiveProviderChange?: (prov: ProvedorStatusInfo | null) => void;
  onShowToast: (msg: string) => void;
}

const SwitchPill: React.FC<{
  checked: boolean;
  onChange: () => void;
  ariaLabel: string;
  disabled?: boolean;
}> = ({ checked, onChange, ariaLabel, disabled }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={ariaLabel}
    disabled={disabled}
    onClick={onChange}
    className={`relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
      checked ? "bg-[#42A0FF]" : "bg-[#2C2C30]"
    }`}
  >
    <span
      className={`inline-block h-[16px] w-[16px] rounded-full bg-white shadow transition-transform ${
        checked ? "translate-x-[19px]" : "translate-x-[3px]"
      }`}
    />
  </button>
);

function formatAccountSummary(prov: ProvedorStatusInfo, authorizing: string | null): string {
  if (authorizing === prov.provedor) return "Conectando...";
  const contas = prov.contas ?? [];
  if (contas.length > 0) {
    const primary = contas.find((c) => c.padrao) ?? contas[0];
    const base = primary.email ?? primary.rotulo ?? "Conta conectada";
    return contas.length > 1 ? `${base} (+${contas.length - 1})` : base;
  }
  if (prov.provedor === "opencode" && prov.conectado) {
    return "Disponível neste computador";
  }
  if (prov.provedor === "ollama" && prov.conectado) {
    return "Daemon local ativo em 127.0.0.1:11434";
  }
  if (prov.vault_configurado) {
    return "Chave de API no Cofre";
  }
  if (prov.conectado) {
    return "Conectado";
  }
  return prov.cli_detectado && prov.cli_versao
    ? `${prov.cli_versao} · Não conectado`
    : "Não conectado";
}

function browserConnectLabel(prov: ProviderName): string {
  if (prov === "gemini") return "Conectar com Google (abrir navegador)";
  if (prov === "claude") return "Conectar Claude (abrir navegador)";
  return "Conectar ChatGPT (abrir navegador)";
}

/**
 * Visual Master/Detail de Provedores de IA do Criativo AI Studio.
 */
export const ProvidersCatalogView: React.FC<ProvidersCatalogViewProps> = ({
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
  onShowToast,
}) => {
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
  if (detailProvider) {
    const isBrowserProvider =
      detailProvider.provedor === "gemini" ||
      detailProvider.provedor === "claude" ||
      detailProvider.provedor === "openai";
    const isAuthorizing = authorizingProvider === detailProvider.provedor;
    const authLink =
      pendingAuthUrl && pendingAuthUrl.provedor === detailProvider.provedor
        ? pendingAuthUrl.url
        : null;
    const contas = detailProvider.contas ?? [];
    const agentCount = detailProvider.usado_por_agentes?.length ?? 0;
    const isDefault = defaultProvider === detailProvider.provedor;
    const totalModels = detailProvider.modelos.length;
    const hiddenIds = detailProvider.modelos.filter((m) => m.oculto).map((m) => m.id);
    const visibleModelsCount = totalModels - hiddenIds.length;

    const statusBadge = isAuthorizing
      ? { label: "Conectando", cls: "bg-[#42A0FF]/15 text-[#74B9FF]", dot: "bg-[#42A0FF]" }
      : detailProvider.conectado
        ? { label: "Conectado", cls: "bg-[#31CF76]/15 text-[#31CF76]", dot: "bg-[#31CF76]" }
        : { label: "Não conectado", cls: "bg-white/[0.08] text-[#979797]", dot: "bg-[#7D7D7D]" };

    const handleToggleSingleModel = async (modelId: string, currentlyHidden: boolean) => {
      if (!onSetModelsVisibility) return;
      const nextHidden = currentlyHidden
        ? hiddenIds.filter((id) => id !== modelId)
        : Array.from(new Set([...hiddenIds, modelId]));
      await onSetModelsVisibility(detailProvider.provedor, nextHidden);
    };

    const handleToggleAllModels = async () => {
      if (!onSetModelsVisibility) return;
      if (visibleModelsCount > 0) {
        await onSetModelsVisibility(
          detailProvider.provedor,
          detailProvider.modelos.map((m) => m.id)
        );
      } else {
        await onSetModelsVisibility(detailProvider.provedor, []);
      }
    };

    return (
      <div className="max-w-[780px] mx-auto space-y-6">
        <button
          type="button"
          onClick={() => {
            selectDetailProvider(null);
            setEditingKey(false);
            setManualOpen(false);
            setOpenAccountMenuId(null);
            setModelQuery("");
          }}
          className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[#979797] hover:text-white transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Provedores</span>
        </button>

        {/* Cabeçalho do provedor */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3.5">
            <div className="h-11 w-11 rounded-2xl bg-[#1F1F22] border border-white/[0.08] flex items-center justify-center shrink-0">
              <ProviderLogo provider={detailProvider.provedor} size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h3 className="text-[18px] font-semibold text-white">
                  {detailProvider.rotulo}
                </h3>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${statusBadge.cls}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${statusBadge.dot}`} />
                  {statusBadge.label}
                </span>
              </div>
              <p className="text-[12px] text-[#8E8E93] mt-0.5">
                {isDefault ? "Padrão para novos agentes · " : ""}
                {agentCount === 0
                  ? "Nenhum agente usa"
                  : agentCount === 1
                    ? "1 agente usa"
                    : `${agentCount} agentes usam`}
              </p>
            </div>
          </div>
        </div>

        {/* Seção Contas / Sign-in */}
        <section className="space-y-2">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h4 className="text-[13px] font-medium text-[#E5E5E7]">
                {isBrowserProvider ? "Contas" : "Sign-in"}
              </h4>
              {isBrowserProvider && contas.length > 0 && (
                <p className="text-[11.5px] text-[#8E8E93] mt-0.5">
                  {contas.length} de 10. Os agentes compartilham estas contas.
                </p>
              )}
            </div>
            {isBrowserProvider && !isAuthorizing && (
              <button
                type="button"
                onClick={() =>
                  void onStartBrowserSignIn(
                    detailProvider.provedor as "gemini" | "claude" | "openai"
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#222225] hover:bg-[#2B2B2F] border border-white/[0.1] px-3 py-1.5 text-[12px] font-medium text-white transition-colors"
              >
                <UserPlus className="h-3.5 w-3.5" />
                <span>Adicionar conta</span>
              </button>
            )}
          </div>

          {authError && (
            <div className="rounded-xl bg-[#FD2F3B]/15 border border-[#FD2F3B]/30 px-3.5 py-2.5 text-[12px] text-[#FF858B]">
              {authError}
            </div>
          )}

          <div className="rounded-2xl bg-[#18181A] border border-white/[0.07] divide-y divide-white/[0.05]">
            {isAuthorizing ? (
              <div className="px-4 py-3.5 flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <div className="text-[13px] font-medium text-white">Conectando</div>
                  <p className="text-[11.5px] text-[#8E8E93]">
                    Conclua o login se uma página do navegador abrir.
                  </p>
                  {authLink && (
                    <a
                      href={authLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[#74B9FF] hover:text-white underline pt-0.5"
                    >
                      <span>Abrir login aqui</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {onCancelBrowserSignIn && (
                    <button
                      type="button"
                      onClick={() =>
                        void onCancelBrowserSignIn(
                          detailProvider.provedor as "gemini" | "claude" | "openai"
                        )
                      }
                      className="rounded-xl bg-[#242428] hover:bg-[#303036] border border-white/[0.08] px-3 py-1.5 text-[12px] font-medium text-[#E5E5E7]"
                    >
                      Cancelar
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={async () => {
                      const targetProv = detailProvider.provedor as
                        | "gemini"
                        | "claude"
                        | "openai";
                      await onCancelBrowserSignIn?.(targetProv);
                      void onStartBrowserSignIn(targetProv);
                    }}
                    className="rounded-xl bg-[#242428] hover:bg-[#303036] border border-white/[0.08] px-3 py-1.5 text-[12px] font-medium text-white"
                  >
                    Reiniciar
                  </button>
                </div>
              </div>
            ) : isBrowserProvider ? (
              contas.length > 0 ? (
                <>
                  {detailProvider.pool && onTogglePool && (
                    <div className="px-4 py-3.5 flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-white">
                          Agrupar contas
                        </div>
                        <p className="text-[11.5px] text-[#8E8E93] mt-0.5 leading-relaxed">
                          Os agentes usam uma conta até ela chegar perto de um limite de uso e
                          depois a conta cujo limite reinicia primeiro.
                        </p>
                      </div>
                      <SwitchPill
                        checked={detailProvider.pool.habilitado}
                        onChange={() =>
                          void onTogglePool(
                            detailProvider.provedor,
                            !detailProvider.pool?.habilitado
                          )
                        }
                        ariaLabel="Agrupar contas"
                      />
                    </div>
                  )}

                  {contas.map((acc) => {
                    const isExcluded =
                      detailProvider.pool?.contas_excluidas?.includes(acc.id) ?? false;
                    const isInUse =
                      detailProvider.pool?.conta_em_uso === acc.id || acc.padrao;
                    const statusLabel = isExcluded
                      ? "Fora do grupo"
                      : isInUse
                        ? "Padrão"
                        : "Disponível";
                    const menuOpen = openAccountMenuId === acc.id;

                    return (
                      <div
                        key={acc.id}
                        className="px-4 py-3 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-medium text-white truncate">
                              {acc.email ?? acc.rotulo ?? acc.id}
                            </span>
                            {acc.plano && (
                              <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-white/[0.06] text-[#A8A8B0] shrink-0">
                                {acc.plano}
                              </span>
                            )}
                          </div>
                          {acc.grupos_cota.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] text-[#8E8E93]">
                              {acc.grupos_cota.map((grp) => (
                                <span key={grp.nome}>
                                  {grp.nome}:{" "}
                                  <strong className="text-[#DCDCDC]">
                                    {grp.janela_5h?.restante_percentual ?? 100}%
                                  </strong>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0 relative">
                          <span className="text-[12px] text-[#8E8E93]">{statusLabel}</span>
                          <button
                            type="button"
                            aria-label={`Ações para ${acc.email ?? acc.id}`}
                            onClick={() =>
                              setOpenAccountMenuId(menuOpen ? null : acc.id)
                            }
                            className="h-7 w-7 rounded-lg hover:bg-white/[0.06] flex items-center justify-center text-[#979797] hover:text-white"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>

                          {menuOpen && (
                            <div className="absolute right-0 top-8 w-48 rounded-xl bg-[#242428] border border-white/[0.12] shadow-2xl p-1 z-30">
                              {onSetAccountActive && (
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await onSetAccountActive(detailProvider.provedor, acc.id);
                                    setOpenAccountMenuId(null);
                                  }}
                                  className="w-full text-left px-3 py-1.5 rounded-lg text-[12px] text-[#E5E5E7] hover:bg-white/[0.08]"
                                >
                                  Usar esta conta agora
                                </button>
                              )}
                              {detailProvider.pool && onToggleAccountExcluded && (
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await onToggleAccountExcluded(
                                      detailProvider.provedor,
                                      acc.id,
                                      !isExcluded
                                    );
                                    setOpenAccountMenuId(null);
                                  }}
                                  className="w-full text-left px-3 py-1.5 rounded-lg text-[12px] text-[#E5E5E7] hover:bg-white/[0.08]"
                                >
                                  {isExcluded ? "Incluir no grupo" : "Tirar do grupo"}
                                </button>
                              )}
                              {onRemoveAccount && (
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await onRemoveAccount(detailProvider.provedor, acc.id);
                                    setOpenAccountMenuId(null);
                                  }}
                                  className="w-full text-left px-3 py-1.5 rounded-lg text-[12px] text-[#FF858B] hover:bg-[#FD2F3B]/15"
                                >
                                  Remover conta
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </>
              ) : (
                <div className="px-4 py-3.5 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[13px] font-medium text-white">Não conectado</div>
                    <p className="text-[11.5px] text-[#8E8E93] mt-0.5">
                      {detailProvider.provedor === "gemini"
                        ? "Autentique sua conta Google no navegador (requer Antigravity CLI) ou cole uma Gemini API Key abaixo sem instalar nada."
                        : "Autentique sua conta diretamente no navegador em pasta isolada do Studio."}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      void onStartBrowserSignIn(
                        detailProvider.provedor as "gemini" | "claude" | "openai"
                      )
                    }
                    className="rounded-xl bg-[#F0F0F0] hover:bg-white text-[#141414] px-3.5 py-1.5 text-[12px] font-semibold transition-colors shrink-0"
                  >
                    {browserConnectLabel(detailProvider.provedor)}
                  </button>
                </div>
              )
            ) : (
              <div className="px-4 py-3.5 flex items-center justify-between gap-3">
                <div>
                  <div className="text-[13px] font-medium text-white">
                    {detailProvider.conectado ? "Conectado" : "Não conectado"}
                  </div>
                  <p className="text-[11.5px] text-[#8E8E93] mt-0.5">
                    {detailProvider.provedor === "opencode" && !detailProvider.conectado
                      ? "Instalação automática gratuita (sem conta e sem precisar de Node.js)."
                      : detailProvider.subtitulo}
                  </p>
                </div>
                {detailProvider.provedor === "opencode" && !detailProvider.conectado ? (
                  <button
                    type="button"
                    disabled={installingOpenCode}
                    onClick={async () => {
                      setInstallingOpenCode(true);
                      try {
                        await onConnectApiKey("opencode", "");
                        await onRefreshProviders?.();
                        onShowToast("OpenCode instalado e modelos gratuitos prontos!");
                      } catch (err) {
                        onShowToast(
                          err instanceof Error
                            ? err.message
                            : "Não foi possível instalar o OpenCode automaticamente."
                        );
                      } finally {
                        setInstallingOpenCode(false);
                      }
                    }}
                    className="rounded-xl bg-[#F0F0F0] hover:bg-white disabled:opacity-60 text-[#141414] px-3.5 py-1.5 text-[12px] font-semibold transition-colors shrink-0"
                  >
                    {installingOpenCode ? "Instalando..." : "Instalar OpenCode (Grátis)"}
                  </button>
                ) : (
                  onRefreshProviders && (
                    <button
                      type="button"
                      onClick={async () => {
                        await onRefreshProviders();
                        onShowToast(`Status de ${detailProvider.rotulo} atualizado.`);
                      }}
                      className="rounded-xl bg-[#242428] hover:bg-[#303036] border border-white/[0.08] px-3.5 py-1.5 text-[12px] font-medium text-white"
                    >
                      Reconectar
                    </button>
                  )
                )}
              </div>
            )}
          </div>

          {isBrowserProvider && detailProvider.provedor === "gemini" && onAddManualAccount && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setManualOpen((v) => !v)}
                className="text-[11.5px] text-[#8E8E93] hover:text-white underline"
              >
                {manualOpen
                  ? "Ocultar importação manual"
                  : "Ambiente sem navegador? Importar token OAuth manualmente"}
              </button>
              {manualOpen && (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!manualEmail.trim() || !manualToken.trim()) return;
                    await onAddManualAccount(detailProvider.provedor, {
                      email: manualEmail.trim(),
                      label: manualLabel.trim() || undefined,
                      access_token: manualToken.trim(),
                    });
                    setManualEmail("");
                    setManualLabel("");
                    setManualToken("");
                    setManualOpen(false);
                    onShowToast("Conta OAuth importada para o Studio!");
                  }}
                  className="mt-2 rounded-2xl bg-[#18181A] border border-white/[0.07] p-3.5 grid grid-cols-1 md:grid-cols-4 gap-2"
                >
                  <input
                    id="manual-acc-email"
                    name="manual_acc_email"
                    type="email"
                    required
                    value={manualEmail}
                    onChange={(e) => setManualEmail(e.target.value)}
                    placeholder="E-mail da conta"
                    className="rounded-lg bg-[#111113] border border-white/10 px-3 py-1.5 text-[12px] text-white"
                  />
                  <input
                    id="manual-acc-label"
                    name="manual_acc_label"
                    type="text"
                    value={manualLabel}
                    onChange={(e) => setManualLabel(e.target.value)}
                    placeholder="Rótulo opcional"
                    className="rounded-lg bg-[#111113] border border-white/10 px-3 py-1.5 text-[12px] text-white"
                  />
                  <input
                    id="manual-acc-token"
                    name="manual_acc_token"
                    type="password"
                    required
                    value={manualToken}
                    onChange={(e) => setManualToken(e.target.value)}
                    placeholder="Access Token OAuth"
                    className="rounded-lg bg-[#111113] border border-white/10 px-3 py-1.5 text-[12px] text-white"
                  />
                  <button
                    type="submit"
                    className="rounded-lg bg-[#31CF76] text-[#0D0D0D] px-3 py-1.5 text-[12px] font-semibold"
                  >
                    Salvar conta
                  </button>
                </form>
              )}
            </div>
          )}
        </section>

        {/* Seção API key (compacta igual Screenshot 1 & 3) */}
        {detailProvider.provedor !== "ollama" && (
          <section className="space-y-2">
            <h4 className="text-[13px] font-medium text-[#E5E5E7]">Chave de API</h4>
            <div className="rounded-2xl bg-[#18181A] border border-white/[0.07] px-4 py-3.5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[13px] font-medium text-white">
                    {detailProvider.vault_configurado ? "Chave ativa no Cofre" : "Sem chave"}
                  </div>
                  <p className="text-[11.5px] text-[#8E8E93] mt-0.5">
                    {detailProvider.provedor === "opencode"
                      ? "Opcional. Uma chave adiciona modelos pagos do OpenCode Go."
                      : `Ou cole uma chave de API ${detailProvider.rotulo} no Cofre AES-256-GCM.`}
                  </p>
                </div>
                <div className="flex items-center gap-2.5 shrink-0">
                  {detailProvider.provedor === "opencode" && !detailProvider.vault_configurado && (
                    <span className="text-[11.5px] font-medium text-[#8E8E93]">Grátis</span>
                  )}
                  <button
                    type="button"
                    onClick={() => setEditingKey((v) => !v)}
                    className="rounded-xl bg-[#242428] hover:bg-[#303036] border border-white/[0.08] px-3 py-1.5 text-[12px] font-medium text-white"
                  >
                    {detailProvider.vault_configurado ? "Alterar key" : "Add key"}
                  </button>
                </div>
              </div>

              {editingKey && (
                <div className="pt-2.5 border-t border-white/[0.06] flex flex-col sm:flex-row gap-2">
                  <input
                    id={`studio-key-${detailProvider.provedor}`}
                    name={`studio_key_${detailProvider.provedor}`}
                    aria-label={`Chave API de ${detailProvider.rotulo}`}
                    type="password"
                    value={keyDraft}
                    onChange={(e) => setKeyDraft(e.target.value)}
                    placeholder={`Cole sua chave ${detailProvider.rotulo}...`}
                    className="flex-1 rounded-xl bg-[#111113] border border-white/10 px-3 py-2 text-[12px] text-white placeholder-[#6A6A6A]"
                  />
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingKey(false);
                        setKeyDraft("");
                      }}
                      className="rounded-xl bg-[#242428] hover:bg-[#303036] px-3 py-2 text-[12px] text-[#B5B5B5]"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const clean = keyDraft.trim();
                        if (!clean) {
                          onShowToast("Cole uma chave válida antes de salvar.");
                          return;
                        }
                        await onConnectApiKey(detailProvider.provedor, clean);
                        setKeyDraft("");
                        setEditingKey(false);
                        onShowToast(`Chave ${detailProvider.rotulo} salva no Cofre.`);
                      }}
                      className="rounded-xl bg-[#F0F0F0] hover:bg-white text-[#141414] px-3.5 py-2 text-[12px] font-semibold"
                    >
                      Salvar
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Seção Runtime */}
        <section className="space-y-2">
          <h4 className="text-[13px] font-medium text-[#E5E5E7]">Runtime</h4>
          <div className="rounded-2xl bg-[#18181A] border border-white/[0.07] divide-y divide-white/[0.05]">
            <div className="px-4 py-3.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-white">Versão</div>
                <p className="text-[11.5px] text-[#8E8E93] mt-0.5 truncate">
                  {detailProvider.cli_detectado
                    ? `${detailProvider.cli_versao ?? "Instalada na máquina"}${
                        detailProvider.cli_executavel
                          ? ` · ${detailProvider.cli_executavel}`
                          : ""
                      }`
                    : "CLI não detectada localmente"}
                </p>
              </div>
              {onRefreshProviders && (
                <button
                  type="button"
                  disabled={refreshingRuntime}
                  onClick={async () => {
                    setRefreshingRuntime(true);
                    try {
                      await onRefreshProviders();
                      onShowToast("Detecção de runtime atualizada.");
                    } finally {
                      setRefreshingRuntime(false);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#242428] hover:bg-[#303036] border border-white/[0.08] px-3 py-1.5 text-[12px] font-medium text-white shrink-0"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${refreshingRuntime ? "animate-spin" : ""}`} />
                  <span>Atualizar</span>
                </button>
              )}
            </div>

            {detailProvider.conectado && (
              <div className="px-4 py-3.5 flex items-center justify-between gap-3">
                <div>
                  <div className="text-[13px] font-medium text-white">Desconectar sessão</div>
                  <p className="text-[11.5px] text-[#8E8E93] mt-0.5">
                    Remove credenciais e contas salvas no Studio para este provedor.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await onDisconnectProvider(detailProvider.provedor);
                    onShowToast(`${detailProvider.rotulo} desconectado.`);
                  }}
                  className="rounded-xl bg-[#242428] hover:bg-[#FD2F3B]/20 border border-white/[0.08] hover:border-[#FD2F3B]/40 px-3 py-1.5 text-[12px] font-medium text-[#E5E5E7] hover:text-[#FF858B] shrink-0"
                >
                  Desconectar
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Seção Modelos (lista vertical 1-por-linha com switches + Ocultar todos) */}
        <section className="space-y-2.5 pb-6">
          <div className="flex items-end justify-between gap-2">
            <div>
              <h4 className="text-[13px] font-medium text-[#E5E5E7]">Modelos</h4>
              <p className="text-[11.5px] text-[#8E8E93] mt-0.5">
                {visibleModelsCount} de {totalModels} modelos aparecem no seletor de modelos.
              </p>
            </div>
            {totalModels > 0 && onSetModelsVisibility && (
              <button
                type="button"
                onClick={() => void handleToggleAllModels()}
                className="text-[12px] font-medium text-[#B5B5BD] hover:text-white transition-colors"
              >
                {visibleModelsCount > 0 ? "Ocultar todos" : "Mostrar todos"}
              </button>
            )}
          </div>

          <input
            id="studio-search-models"
            name="studio_search_models"
            aria-label="Buscar modelos"
            type="text"
            value={modelQuery}
            onChange={(e) => setModelQuery(e.target.value)}
            placeholder="Buscar modelos"
            className="w-full rounded-xl bg-[#18181A] border border-white/[0.08] px-3.5 py-2 text-[12.5px] text-white placeholder-[#78787D] focus:outline-none focus:border-white/25"
          />

          <div className="rounded-2xl bg-[#18181A] border border-white/[0.07] divide-y divide-white/[0.05]">
            {filteredModels.map((model) => {
              const isVisible = !model.oculto;
              return (
                <div
                  key={model.id}
                  className="px-4 py-2.5 flex items-center justify-between gap-3"
                >
                  <div className="flex flex-wrap items-baseline gap-2 min-w-0">
                    <span className="text-[12.5px] font-medium text-white truncate">
                      {model.rotulo}
                    </span>
                    <span className="text-[11.5px] font-mono text-[#7D7D85] truncate">
                      {model.id}
                    </span>
                    {model.suporta_imagem && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#42A0FF]/15 text-[#74B9FF]">
                        Imagem
                      </span>
                    )}
                    {model.gratuito && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#31CF76]/15 text-[#31CF76]">
                        Grátis
                      </span>
                    )}
                    {typeof model.restante_percentual === "number" && (
                      <span className="text-[10.5px] font-semibold text-[#31CF76] tabular-nums">
                        {model.restante_percentual}%
                      </span>
                    )}
                  </div>
                  <SwitchPill
                    checked={isVisible}
                    onChange={() => void handleToggleSingleModel(model.id, Boolean(model.oculto))}
                    ariaLabel={`Exibir modelo ${model.rotulo}`}
                    disabled={!onSetModelsVisibility}
                  />
                </div>
              );
            })}
            {filteredModels.length === 0 && (
              <div className="px-4 py-6 text-center text-[12px] text-[#7D7D85]">
                Nenhum modelo encontrado para &ldquo;{modelQuery}&rdquo;.
              </div>
            )}
          </div>
        </section>
      </div>
    );
  }

  // =========================================================================
  // MODO MASTER (Provedor padrão + Conectados + Outros provedores)
  // =========================================================================
  return (
    <div className="max-w-[780px] mx-auto space-y-6 pb-6">
      {/* Card Provedor padrão */}
      <div className="rounded-2xl bg-[#18181A] border border-white/[0.07] px-4 py-3.5 flex items-center justify-between gap-4">
        <div>
          <div className="text-[13px] font-medium text-white">Provedor padrão</div>
          <p className="text-[11.5px] text-[#8E8E93] mt-0.5">
            Novos agentes começam com este provedor.
          </p>
        </div>
        <div className="relative shrink-0">
          <button
            type="button"
            aria-label="Selecionar provedor padrão"
            onClick={() => setDefaultMenuOpen((v) => !v)}
            className="inline-flex items-center gap-2 rounded-xl bg-[#222226] hover:bg-[#2B2B30] border border-white/[0.08] px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors"
          >
            {activeDefaultInfo && <ProviderLogo provider={activeDefaultInfo.provedor} size={15} />}
            <span>{activeDefaultInfo?.rotulo ?? defaultProvider}</span>
            <ChevronsUpDown className="h-3.5 w-3.5 text-[#8E8E93]" />
          </button>

          {defaultMenuOpen && (
            <div className="absolute right-0 mt-1.5 w-52 rounded-xl bg-[#222226] border border-white/[0.12] shadow-2xl p-1 z-30">
              {provedores.map((prov) => {
                const selected = prov.provedor === defaultProvider;
                return (
                  <button
                    key={prov.provedor}
                    type="button"
                    onClick={async () => {
                      setDefaultMenuOpen(false);
                      await onSelectDefaultProvider?.(prov.provedor);
                      onShowToast(`${prov.rotulo} definido como provedor padrão.`);
                    }}
                    className={`w-full text-left px-3 py-1.5 rounded-lg text-[12.5px] flex items-center justify-between gap-2 transition-colors ${
                      selected
                        ? "bg-white/[0.1] text-white font-medium"
                        : "text-[#D4D4D8] hover:bg-white/[0.06]"
                    }`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <ProviderLogo provider={prov.provedor} size={14} />
                      <span className="truncate">{prov.rotulo}</span>
                    </span>
                    {selected && <Check className="h-3.5 w-3.5 text-[#31CF76] shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Conectados + Buscar provedores */}
      <section className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-[13px] font-medium text-[#E5E5E7]">Conectados</h3>
          <div className="relative w-full sm:w-64">
            <Search className="h-3.5 w-3.5 text-[#78787D] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              id="studio-search-providers"
              name="studio_search_providers"
              aria-label="Buscar provedores"
              type="text"
              value={providerQuery}
              onChange={(e) => setProviderQuery(e.target.value)}
              placeholder="Buscar provedores"
              className="w-full rounded-xl bg-[#18181A] border border-white/[0.08] pl-8 pr-3 py-1.5 text-[12px] text-white placeholder-[#78787D] focus:outline-none focus:border-white/25"
            />
          </div>
        </div>

        <div className="rounded-2xl bg-[#18181A] border border-white/[0.07] divide-y divide-white/[0.05]">
          {connectedProviders.map((prov) => {
            const isConn = authorizingProvider === prov.provedor;
            return (
              <button
                key={prov.provedor}
                type="button"
                onClick={() => selectDetailProvider(prov.provedor)}
                className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-white/[0.03] transition-colors first:rounded-t-2xl last:rounded-b-2xl"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-8 w-8 rounded-xl bg-white/[0.04] flex items-center justify-center shrink-0">
                    <ProviderLogo provider={prov.provedor} size={18} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-white truncate">
                      {prov.rotulo}
                    </div>
                    <div className="text-[11.5px] text-[#8E8E93] truncate">
                      {formatAccountSummary(prov, authorizingProvider)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {isConn && (
                    <span className="h-3.5 w-3.5 rounded-full border-2 border-[#74B9FF] border-t-transparent animate-spin" />
                  )}
                  <ChevronRight className="h-4 w-4 text-[#6E6E73]" />
                </div>
              </button>
            );
          })}
          {connectedProviders.length === 0 && (
            <div className="px-4 py-4 text-[12px] text-[#7D7D85]">
              Nenhum provedor conectado no momento. Selecione um abaixo para conectar.
            </div>
          )}
        </div>
      </section>

      {/* Outros provedores */}
      {otherProviders.length > 0 && (
        <section className="space-y-2.5">
          <h3 className="text-[13px] font-medium text-[#E5E5E7]">Outros provedores</h3>
          <div className="rounded-2xl bg-[#18181A] border border-white/[0.07] divide-y divide-white/[0.05]">
            {otherProviders.map((prov) => (
              <button
                key={prov.provedor}
                type="button"
                onClick={() => selectDetailProvider(prov.provedor)}
                className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-white/[0.03] transition-colors first:rounded-t-2xl last:rounded-b-2xl"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-8 w-8 rounded-xl bg-white/[0.04] flex items-center justify-center shrink-0">
                    <ProviderLogo provider={prov.provedor} size={18} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-white truncate">
                      {prov.rotulo}
                    </div>
                    <div className="text-[11.5px] text-[#8E8E93] truncate">
                      {formatAccountSummary(prov, authorizingProvider)}
                    </div>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-[#6E6E73] shrink-0" />
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
