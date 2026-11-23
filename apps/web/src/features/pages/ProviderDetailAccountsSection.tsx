import {
  ArrowLeft,
  ExternalLink,
  MoreHorizontal,
  UserPlus,
} from "lucide-react";
import {
  ProviderLogo,
} from "../../components/ProviderLogo";
import { SwitchPill, browserConnectLabel } from "./providers-catalog-helpers";
import type { ProvidersCatalogController } from "./useProvidersCatalogController";

export function ProviderDetailAccountsSection({ ctrl }: { ctrl: ProvidersCatalogController }) {
  const {
    authError,
    onStartBrowserSignIn,
    onCancelBrowserSignIn,
    onConnectApiKey,
    onRefreshProviders,
    onTogglePool,
    onSetAccountActive,
    onToggleAccountExcluded,
    onRemoveAccount,
    onAddManualAccount,
    onSubmitManualOAuthCallback,
    onShowToast,
    selectDetailProvider,
    setModelQuery,
    setEditingKey,
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
    installingOpenCode,
    setInstallingOpenCode,
    manualCallbackDraft,
    setManualCallbackDraft,
    sendingManualCallback,
    setSendingManualCallback,
    isRemoteServer,
    detailProvider,
    isBrowserProvider,
    isAuthorizing,
    authLink,
    contas,
    agentCount,
    isDefault,
    statusBadge,
  } = ctrl;
  if (!detailProvider) return null;
  return (
    <>
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
                {isDefault ? "Padrão para novos Criativos · " : ""}
                {agentCount === 0
                  ? "Nenhum Criativo usa"
                  : agentCount === 1
                    ? "1 Criativo usa"
                    : `${agentCount} Criativos usam`}
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
                  {contas.length} de 10. Os Criativos compartilham estas contas.
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
              <div className="px-4 py-3.5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="text-[13px] font-medium text-white">Conectando</div>
                    <p className="text-[11.5px] text-[#8E8E93]">
                      {isRemoteServer
                        ? "Conclua o login no navegador do seu computador; a ponte local enviará a sessão automaticamente para este servidor."
                        : "Conclua o login se uma página do navegador abrir."}
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

                {isRemoteServer &&
                  (detailProvider.provedor === "openai" || detailProvider.provedor === "claude") &&
                  onSubmitManualOAuthCallback && (
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const clean = manualCallbackDraft.trim();
                        if (!clean) return;
                        setSendingManualCallback(true);
                        try {
                          await onSubmitManualOAuthCallback(
                            detailProvider.provedor as "claude" | "openai",
                            clean
                          );
                          setManualCallbackDraft("");
                          onShowToast("Retorno OAuth encaminhado ao servidor remoto.");
                        } catch (err) {
                          onShowToast(
                            err instanceof Error ? err.message : "Erro ao encaminhar URL de retorno."
                          );
                        } finally {
                          setSendingManualCallback(false);
                        }
                      }}
                      className="pt-2.5 border-t border-white/[0.06] flex flex-col sm:flex-row gap-2 items-stretch sm:items-center"
                    >
                      <input
                        type="text"
                        value={manualCallbackDraft}
                        onChange={(e) => setManualCallbackDraft(e.target.value)}
                        placeholder="Plano B: se o navegador parar em http://127.0.0.1:..., cole a URL aqui"
                        className="flex-1 rounded-xl bg-[#111113] border border-white/10 px-3 py-1.5 text-[11.5px] text-white placeholder-[#6E6E73]"
                      />
                      <button
                        type="submit"
                        disabled={sendingManualCallback || !manualCallbackDraft.trim()}
                        className="rounded-xl bg-[#242428] hover:bg-[#303036] disabled:opacity-50 border border-white/[0.08] px-3 py-1.5 text-[11.5px] font-medium text-white shrink-0"
                      >
                        {sendingManualCallback ? "Enviando..." : "Enviar retorno"}
                      </button>
                    </form>
                  )}
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
                          Os Criativos usam uma conta até ela chegar perto de um limite de uso e
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
                        ? isRemoteServer
                          ? "Autentique sua conta Google pelo navegador do Desktop (salva isoladamente neste servidor) ou cole uma Gemini API Key abaixo."
                          : "Autentique sua conta Google no navegador (requer Antigravity CLI) ou cole uma Gemini API Key abaixo sem instalar nada."
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

    </>
  );
}
