import {
  AlertTriangle,
  ArrowLeft,
  Blocks,
  Bot,
  Check,
  Copy,
  Download,
  ExternalLink,
  Github,
  KeyRound,
  Loader2,
  Plug,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import {
  AppBrandIcon,
  CarbonSelect,
  SlidingTabs,
  type CarbonSelectOption,
} from "../../components/ui/CarbonControls";
import { daemonApi } from "../../services/websocket-client";
import type { MarketplacePageController, MarketplacePageProps } from "./useMarketplacePageController";

export function MarketplaceAppDetailView({
  ctrl,
  props,
}: {
  ctrl: MarketplacePageController;
  props: MarketplacePageProps;
}) {
  const { agentes, onTryPromptInChat } = props;
  const {
    setExpandedCategory,
    setSelectedAppSlug,
    appDetail,
    appAccounts,
    nativeAccounts,
    selectedNativeContaId,
    nativeCreatingNew,
    testingContaId,
    activeFlowIndex,
    setActiveFlowIndex,
    fieldValues,
    setFieldValues,
    contaRotuloInput,
    setContaRotuloInput,
    connectBusy,
    connectFeedback,
    accessFeedback,
    localInstructions,
    accessServerId,
    accessMode,
    setAccessMode,
    accessAgents,
    agentSelectOptions,
    setAccessAgents,
    tryTargetAgentId,
    setTryTargetAgentId,
    unlockedAgents,
    loadCatalogAndApps,
    selectNativeAccount,
    handleStartNewNativeAccount,
    handleConnectAppFlow,
    handleTestNativeAccount,
    handleDeleteNativeAccount,
    handleApplyAgentAccess,
  } = ctrl;

    if (!appDetail) return null;
    const flows = appDetail.authFlows ?? [];
    const activeFlow = flows[activeFlowIndex] ?? flows[0];
    const hasConnected = appAccounts.length > 0 || nativeAccounts.length > 0;
    const selectedNativeAcc =
      (!nativeCreatingNew
        ? nativeAccounts.find((a) => a.conta_id === selectedNativeContaId)
        : undefined) ?? null;

    return (
      <div className="space-y-6">
        <nav aria-label="Breadcrumb da Loja" className="flex items-center gap-2 text-[12px] text-[#979797]">
          <button
            type="button"
            onClick={() => setSelectedAppSlug(null)}
            className="text-[#42A0FF] hover:text-[#F0F0F0]"
          >
            Apps
          </button>
          <span>&gt;</span>
          <button
            type="button"
            onClick={() => {
              setExpandedCategory(appDetail.category);
              setSelectedAppSlug(null);
            }}
            className="text-[#42A0FF] hover:text-[#F0F0F0]"
          >
            {appDetail.category}
          </button>
          <span>&gt;</span>
          <span className="text-[#F0F0F0]">{appDetail.name}</span>
        </nav>

        <section className="rounded-[14px] border border-[#2A2A2A] bg-[#212121] p-6 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <AppBrandIcon slug={appDetail.slug} name={appDetail.name} size={48} />
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h1 className="text-[28px] font-semibold leading-[1.2] text-[#F0F0F0]">
                    {appDetail.name}
                  </h1>
                  {appDetail.verified && (
                    <span className="rounded-full bg-[#31CF76]/15 px-2.5 py-0.5 text-[12px] font-semibold text-[#31CF76]">
                      Verificado
                    </span>
                  )}
                </div>
                <p className="text-[12px] text-[#979797]">
                  {appDetail.creatorName} · {appDetail.category}
                </p>
                <p className="text-[14px] text-[#DCDCDC]">{appDetail.description}</p>
              </div>
            </div>

            {activeFlow && (
              <div className="flex items-center gap-2">
                {appDetail.isNative && hasConnected && !nativeCreatingNew && (
                  <button
                    type="button"
                    disabled={connectBusy}
                    onClick={handleStartNewNativeAccount}
                    className="rounded-full border border-[#2A2A2A] bg-[#242424] px-4 py-2 text-[13px] font-semibold text-[#F0F0F0] hover:bg-[#2A2A2A]"
                  >
                    + Adicionar outra conta
                  </button>
                )}
                <button
                  type="button"
                  disabled={connectBusy}
                  onClick={() => void handleConnectAppFlow(activeFlow)}
                  className="rounded-full bg-[#F0F0F0] px-5 py-2 text-[14px] font-semibold text-[#141414] hover:bg-white disabled:opacity-50"
                >
                  {appDetail.isNative && selectedNativeAcc
                    ? "Atualizar e validar"
                    : hasConnected
                      ? "Adicionar outra conta"
                      : "Conectar aplicativo"}
                </button>
              </div>
            )}
          </div>

          {flows.length > 1 && (
            <SlidingTabs<string>
              ariaLabel="Fluxos de autenticação suportados"
              value={activeFlow?.id ?? "0"}
              onChange={(flowId) => {
                const idx = flows.findIndex((f) => f.id === flowId);
                if (idx >= 0) setActiveFlowIndex(idx);
              }}
              tabs={flows.map((f) => ({ id: f.id, label: f.label }))}
            />
          )}

          {activeFlow && (
            <div className="space-y-4 rounded-[12px] border border-[#2A2A2A] bg-[#1A1A1A] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[14px] font-semibold text-[#F0F0F0]">
                  {activeFlow.label}
                </span>
                {activeFlow.kind === "oauth" && (
                  <button
                    type="button"
                    disabled={connectBusy}
                    onClick={() => void handleConnectAppFlow(activeFlow)}
                    className="rounded-full bg-[#F0F0F0] px-4 py-1.5 text-[14px] font-semibold text-[#141414]"
                  >
                    Autenticar no navegador
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="block text-[12px] font-semibold text-[#979797]">
                    Rótulo da conta
                  </label>
                  <input
                    type="text"
                    value={contaRotuloInput}
                    onChange={(e) => setContaRotuloInput(e.target.value)}
                    placeholder={`Conta ${Math.max(appAccounts.length, nativeAccounts.length) + 1}`}
                    className="w-full rounded-[8px] border border-[#2A2A2A] bg-[#242424] px-3 py-2 text-[14px] text-[#F0F0F0]"
                  />
                </div>
                {(activeFlow.fields ?? []).map((fld) => {
                  const maskedStored = selectedNativeAcc?.campos_mascarados?.[fld.key];
                  return (
                    <div key={fld.key} className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <label className="block text-[12px] font-semibold text-[#979797]">
                          {fld.label}
                        </label>
                        {maskedStored && (
                          <span className="rounded-full bg-[#31CF76]/15 px-2 py-0.5 text-[10px] font-semibold text-[#31CF76]">
                            Salvo no Cofre ({maskedStored})
                          </span>
                        )}
                      </div>
                      <input
                        type={fld.secret ? "password" : "text"}
                        value={fieldValues[fld.key] ?? ""}
                        onChange={(e) =>
                          setFieldValues((prev) => ({ ...prev, [fld.key]: e.target.value }))
                        }
                        placeholder={
                          maskedStored
                            ? `Salvo (${maskedStored}) — deixe vazio para manter`
                            : fld.placeholder ?? ""
                        }
                        className="w-full rounded-[8px] border border-[#2A2A2A] bg-[#242424] px-3 py-2 font-mono text-[12px] text-[#F0F0F0]"
                      />
                    </div>
                  );
                })}
              </div>

              {activeFlow.kind !== "oauth" && (
                <div className="flex items-center justify-end gap-2">
                  {activeFlow.helpUrl && (
                    <a
                      href={activeFlow.helpUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[12px] text-[#42A0FF] hover:underline"
                    >
                      {activeFlow.docsLabel || "Abrir documentação"} <ExternalLink size={12} />
                    </a>
                  )}
                  <button
                    type="button"
                    disabled={connectBusy}
                    onClick={() => void handleConnectAppFlow(activeFlow)}
                    className="rounded-full border border-[#2A2A2A] bg-[#242424] px-4 py-1.5 text-[14px] font-semibold text-[#F0F0F0] hover:bg-[#2A2A2A]"
                  >
                    {connectBusy ? "Testando..." : "Testar conexão"}
                  </button>
                </div>
              )}

              {localInstructions.length > 0 && (
                <ol className="list-decimal space-y-1 pl-5 text-[12px] text-[#DCDCDC]">
                  {localInstructions.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              )}

              {connectFeedback && (
                <p
                  className={`text-[12px] font-semibold ${
                    connectFeedback.ok ? "text-[#31CF76]" : "text-[#FD2F3B]"
                  }`}
                >
                  {connectFeedback.text}
                </p>
              )}
            </div>
          )}
        </section>

        {nativeAccounts.length > 0 && (
          <section className="rounded-[14px] border border-[#2A2A2A] bg-[#212121] p-6 space-y-3">
            <h2 className="text-[20px] font-semibold text-[#F0F0F0]">Contas conectadas</h2>
            {nativeAccounts.map((acc) => {
              const isSelected = !nativeCreatingNew && selectedNativeContaId === acc.conta_id;
              const isTesting = testingContaId === acc.conta_id;
              const handleLabel = acc.perfil_conectado?.username
                ? `@${acc.perfil_conectado.username}`
                : acc.campos_visiveis?.IG_USER_ID || acc.campos_visiveis?.META_WABA_ID || "";
              return (
                <div
                  key={acc.conta_id}
                  className={`flex flex-wrap items-center justify-between gap-3 rounded-[10px] border p-4 ${
                    isSelected
                      ? "border-[#007CF7]/60 bg-[#142030]"
                      : "border-[#2A2A2A] bg-[#1A1A1A]"
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[14px] font-semibold text-[#F0F0F0]">
                        {acc.conta_rotulo || "Conta"}
                      </p>
                      {handleLabel && (
                        <span className="font-mono text-[12px] text-[#42A0FF]">{handleLabel}</span>
                      )}
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          acc.testado_ok
                            ? "bg-[#31CF76]/15 text-[#31CF76]"
                            : acc.ultimo_erro
                              ? "bg-[#FD2F3B]/15 text-[#FD2F3B]"
                              : "bg-[#FF9412]/15 text-[#FF9412]"
                        }`}
                      >
                        {acc.testado_ok
                          ? "Conectada"
                          : acc.ultimo_erro
                            ? "Falha na validação"
                            : "Salva no Cofre"}
                      </span>
                    </div>
                    <p className="text-[12px] text-[#979797]">
                      {acc.perfil_conectado?.followers_count != null
                        ? `${acc.perfil_conectado.followers_count} seguidores · ${acc.perfil_conectado.media_count ?? 0} mídias · `
                        : ""}
                      Acesso:{" "}
                      {acc.acesso?.mode === "agents"
                        ? `${acc.acesso.agentIds.length} agente(s) liberado(s)`
                        : "Todos os agentes"}
                    </p>
                    {acc.ultimo_erro && (
                      <p className="text-[11px] text-[#FD2F3B]">{acc.ultimo_erro}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => selectNativeAccount(acc)}
                      className="rounded-full border border-[#2A2A2A] bg-[#242424] px-3 py-1.5 text-[12px] font-semibold text-[#F0F0F0] hover:bg-[#2A2A2A]"
                    >
                      {isSelected ? "Editando" : "Selecionar"}
                    </button>
                    <button
                      type="button"
                      disabled={isTesting}
                      onClick={() => void handleTestNativeAccount(acc.conta_id)}
                      className="rounded-full border border-[#2A2A2A] bg-[#242424] px-3 py-1.5 text-[12px] font-semibold text-[#F0F0F0] hover:bg-[#2A2A2A] disabled:opacity-50"
                    >
                      {isTesting ? "Testando..." : "Testar conexão"}
                    </button>
                    <button
                      type="button"
                      disabled={connectBusy}
                      onClick={() => void handleDeleteNativeAccount(acc.conta_id)}
                      className="rounded-full border border-[#FD2F3B]/40 bg-[#FD2F3B]/10 px-3 py-1.5 text-[12px] font-semibold text-[#FD2F3B] hover:bg-[#FD2F3B]/20"
                    >
                      Desconectar conta
                    </button>
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {appAccounts.length > 0 && (
          <section className="rounded-[14px] border border-[#2A2A2A] bg-[#212121] p-6 space-y-3">
            <h2 className="text-[20px] font-semibold text-[#F0F0F0]">Contas conectadas</h2>
            {appAccounts.map((acc, idx) => (
              <div
                key={acc.server.mcp_id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-[#2A2A2A] bg-[#1A1A1A] p-4"
              >
                <div>
                  <p className="text-[14px] font-semibold text-[#F0F0F0]">
                    {acc.contaRotulo || `Conta #${idx + 1}`} (#account-{idx + 1})
                  </p>
                  <p className="text-[12px] text-[#979797]">
                    {acc.server.qtdFerramentas} ferramentas descobertas ·{" "}
                    {acc.oauthStatus === "lost" ? "Reautenticar" : acc.server.ativo ? "Conectado" : "Inativo"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void daemonApi.testMcpServer(acc.server.mcp_id).then(() => loadCatalogAndApps())}
                    className="rounded-full border border-[#2A2A2A] bg-[#242424] px-3 py-1.5 text-[12px] font-semibold text-[#F0F0F0]"
                  >
                    Testar conexão
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void daemonApi
                        .disconnectMcpOAuth(acc.server.mcp_id)
                        .then(() => daemonApi.deleteMcpServer(acc.server.mcp_id))
                        .then(() => loadCatalogAndApps())
                    }
                    className="rounded-full border border-[#FD2F3B]/40 bg-[#FD2F3B]/10 px-3 py-1.5 text-[12px] font-semibold text-[#FD2F3B]"
                  >
                    Desconectar conta
                  </button>
                </div>
              </div>
            ))}
          </section>
        )}

        <section className="rounded-[14px] border border-[#2A2A2A] bg-[#212121] p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[20px] font-semibold text-[#F0F0F0]">Acesso de agentes</h2>
              <p className="text-[12px] text-[#979797]">
                Defina quais agentes da sua licença podem usar as ferramentas deste conector no chat e em fluxos.
              </p>
            </div>
            <SlidingTabs<"everyone" | "agents">
              ariaLabel="Controle de acesso por agente"
              value={accessMode}
              onChange={setAccessMode}
              tabs={[
                { id: "everyone", label: "Todos os agentes" },
                { id: "agents", label: "Agentes selecionados" },
              ]}
            />
          </div>
          {accessMode === "agents" && (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              {unlockedAgents.map((ag) => {
                const checked = accessAgents.includes(ag.agente_id);
                return (
                  <label
                    key={ag.agente_id}
                    className="flex cursor-pointer items-center gap-2 rounded-[8px] border border-[#2A2A2A] bg-[#1A1A1A] px-3 py-2 text-[14px] text-[#F0F0F0]"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setAccessAgents((prev) =>
                          checked
                            ? prev.filter((id) => id !== ag.agente_id)
                            : [...prev, ag.agente_id]
                        )
                      }
                      className="accent-[#007CF7]"
                    />
                    <span className="truncate">{ag.nome}</span>
                  </label>
                );
              })}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="min-h-[18px]">
              {accessFeedback && (
                <p className="text-[12px] font-semibold text-[#31CF76]">{accessFeedback}</p>
              )}
            </div>
            {(accessServerId || appDetail.isNative) && (
              <button
                type="button"
                onClick={() => void handleApplyAgentAccess()}
                className="rounded-full bg-[#F0F0F0] px-4 py-1.5 text-[14px] font-semibold text-[#141414] hover:bg-white"
              >
                Aplicar acesso
              </button>
            )}
          </div>
        </section>

        {appDetail.prompts && appDetail.prompts.length > 0 && (
          <section className="rounded-[14px] border border-[#2A2A2A] bg-[#212121] p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-[20px] font-semibold text-[#F0F0F0]">Experimentar no chat</h2>
              <div className="w-64">
                <CarbonSelect
                  ariaLabel="Selecionar agente destino para testar prompt"
                  value={tryTargetAgentId}
                  options={agentSelectOptions}
                  onChange={setTryTargetAgentId}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {appDetail.prompts.map((pr, idx) => (
                <div
                  key={`${pr.id}-${idx}`}
                  className="flex flex-col justify-between gap-3 rounded-[12px] border border-[#2A2A2A] bg-[#1A1A1A] p-4"
                >
                  <div className="space-y-1">
                    {pr.title && (
                      <p className="text-[14px] font-semibold text-[#F0F0F0]">{pr.title}</p>
                    )}
                    <p className="text-[14px] text-[#979797]">{pr.text}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onTryPromptInChat?.(tryTargetAgentId, pr.text)}
                    className="self-start text-[14px] font-semibold text-[#42A0FF] hover:underline"
                  >
                    Experimentar prompt
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    );
}
