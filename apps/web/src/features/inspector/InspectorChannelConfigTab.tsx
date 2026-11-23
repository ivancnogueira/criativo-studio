import {
  ChevronRight,
  Crown,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { MascoteAvatar, resolveAgentAvatarConfig } from "../../components/MascoteAvatar";
import { CarbonSelect } from "../../components/ui/CarbonControls";
import { CHANNEL_BROWSER_OPTIONS } from "./inspector-types";
import type { RightInspectorPanelProps } from "./inspector-types";
import type { RightInspectorController } from "./useRightInspectorController";

export function InspectorChannelConfigTab({
  ctrl,
  props,
}: {
  ctrl: RightInspectorController;
  props: RightInspectorPanelProps;
}) {
  const {
    agente,
    canal = null,
    allAgentes = [],
    channelRoutineCount = 0,
    onSaveChannelSettings,
    onDeleteChannel,
    onNewChannelConversation,
    onCompactChannelContext,
    onClearChannelHistory,
  } = props;
  const {
    subView,
    setSubView,
    saving,
    setSaving,
    channelNomeDraft,
    setChannelNomeDraft,
    channelDescDraft,
    setChannelDescDraft,
    channelInstDraft,
    setChannelInstDraft,
    channelMembersDraft,
    setChannelMembersDraft,
    channelLeaderDraft,
    setChannelLeaderDraft,
    channelBrowserDraft,
    setChannelBrowserDraft,
    channelKeepMemDraft,
    setChannelKeepMemDraft,
    channelMemories,
    channelAddMemberOpen,
    setChannelAddMemberOpen,
    channelActionBusy,
    setChannelActionBusy,
    confirmClearChannelHist,
    setConfirmClearChannelHist,
    confirmDeleteChannelModal,
    setConfirmDeleteChannelModal,
  } = ctrl;

  return (
    <>
        {subView === "channel_config" && canal && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!onSaveChannelSettings) return;
              setSaving(true);
              try {
                await onSaveChannelSettings(canal.canal_id, {
                  nome: channelNomeDraft.trim() || canal.nome,
                  descricao: channelDescDraft.trim(),
                  instrucoes: channelInstDraft.trim(),
                  membros_agentes: channelMembersDraft,
                  lider_agente_id: channelLeaderDraft,
                  navegador_modo: channelBrowserDraft,
                  manter_memorias: channelKeepMemDraft,
                });
              } finally {
                setSaving(false);
              }
            }}
            className="space-y-4"
          >
            <div>
              <label htmlFor="ch-cfg-name" className="block text-[11.5px] font-medium text-[#A8A8A8] mb-1">
                Nome
              </label>
              <input
                id="ch-cfg-name"
                type="text"
                required
                value={channelNomeDraft}
                onChange={(e) => setChannelNomeDraft(e.target.value)}
                className="w-full rounded-xl bg-[#212121] border border-white/[0.08] px-3 py-2 text-[13px] text-white focus:outline-none focus:border-white/25"
              />
            </div>

            <div>
              <label htmlFor="ch-cfg-desc" className="block text-[11.5px] font-medium text-[#A8A8A8] mb-1">
                Título
              </label>
              <input
                id="ch-cfg-desc"
                type="text"
                value={channelDescDraft}
                onChange={(e) => setChannelDescDraft(e.target.value)}
                placeholder="Descreva o que esta equipe faz"
                className="w-full rounded-xl bg-[#212121] border border-white/[0.08] px-3 py-2 text-[12.5px] text-white placeholder-[#6A6A6A] focus:outline-none focus:border-white/25"
              />
            </div>

            <div>
              <label htmlFor="ch-cfg-inst" className="block text-[11.5px] font-medium text-[#A8A8A8] mb-1">
                Instruções
              </label>
              <textarea
                id="ch-cfg-inst"
                rows={4}
                value={channelInstDraft}
                onChange={(e) => setChannelInstDraft(e.target.value)}
                placeholder="Em que esta equipe vai trabalhar?"
                className="w-full rounded-xl bg-[#212121] border border-white/[0.08] px-3 py-2 text-[12.5px] text-white placeholder-[#6A6A6A] focus:outline-none focus:border-white/25 resize-y"
              />
            </div>

            <div>
              <span className="block text-[11.5px] font-medium text-[#A8A8A8] mb-1">
                Navegador
              </span>
              <CarbonSelect
                ariaLabel="Navegador da equipe"
                value={channelBrowserDraft}
                options={CHANNEL_BROWSER_OPTIONS}
                onChange={(val) => {
                  setChannelBrowserDraft(val);
                  void onSaveChannelSettings?.(canal.canal_id, { navegador_modo: val });
                }}
              />
            </div>

            <div className="rounded-xl bg-[#212121] border border-white/[0.06] divide-y divide-white/[0.05] overflow-hidden">
              <div className="px-3.5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[12.5px] font-semibold text-white">
                    Manter as memórias neste canal
                  </div>
                  <p className="text-[11px] text-[#8E8E93] mt-0.5 leading-snug">
                    Os Criativos guardam o que aprendem aqui como memórias do canal. As outras conversas deles não as veem.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={channelKeepMemDraft}
                  aria-label="Manter as memórias neste canal"
                  onClick={() => {
                    const next = !channelKeepMemDraft;
                    setChannelKeepMemDraft(next);
                    void onSaveChannelSettings?.(canal.canal_id, { manter_memorias: next });
                  }}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                    channelKeepMemDraft ? "bg-[#007CF7]" : "bg-[#2A2A2A]"
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      channelKeepMemDraft ? "translate-x-4.5" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              <button
                type="button"
                onClick={() => setSubView("channel_memories")}
                className="w-full px-3.5 py-2.5 flex items-center justify-between gap-2 text-[12.5px] hover:bg-[#262626] transition-colors"
              >
                <span className="font-medium text-white">Memórias</span>
                <span className="flex items-center gap-1.5 text-[11.5px] text-[#A8A8A8]">
                  <span>
                    {(canal.memorias_count ?? channelMemories.length) === 1
                      ? "1 salva"
                      : `${Math.max(canal.memorias_count ?? 0, channelMemories.length)} salvas`}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 text-[#6A6A6A]" />
                </span>
              </button>

              <button
                type="button"
                onClick={() => setSubView("channel_routines")}
                className="w-full px-3.5 py-2.5 flex items-center justify-between gap-2 text-[12.5px] hover:bg-[#262626] transition-colors"
              >
                <span className="font-medium text-white">Rotinas</span>
                <span className="flex items-center gap-1.5 text-[11.5px] text-[#A8A8A8]">
                  <span>
                    {(channelRoutineCount || canal.rotinas_count || 0) === 1
                      ? "1 configurada"
                      : `${channelRoutineCount || canal.rotinas_count || 0} configuradas`}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 text-[#6A6A6A]" />
                </span>
              </button>
            </div>

            {/* Ações de conversa e contexto (Nova conversa, Compactar contexto, Excluir histórico) */}
            <div className="rounded-xl bg-[#212121] border border-white/[0.06] divide-y divide-white/[0.05] overflow-hidden">
              <div className="px-3.5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[12.5px] font-semibold text-white">Nova conversa</div>
                  <p className="text-[11px] text-[#8E8E93] leading-snug">
                    Os membros esquecem as mensagens anteriores. A configuração do canal permanece.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!onNewChannelConversation || channelActionBusy !== null}
                  onClick={async () => {
                    if (!onNewChannelConversation) return;
                    setChannelActionBusy("new");
                    try {
                      await onNewChannelConversation(canal.canal_id);
                    } finally {
                      setChannelActionBusy(null);
                    }
                  }}
                  className="rounded-lg bg-[#2A2A2E] hover:bg-[#34343A] px-3 py-1.5 text-[11.5px] font-semibold text-white shrink-0 disabled:opacity-50"
                >
                  {channelActionBusy === "new" ? "Iniciando..." : "Iniciar"}
                </button>
              </div>

              <div className="px-3.5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[12.5px] font-semibold text-white">Compactar contexto</div>
                  <p className="text-[11px] text-[#8E8E93] leading-snug">
                    Os membros mantêm um resumo curto da sessão do canal e usam menos tokens.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!onCompactChannelContext || channelActionBusy !== null}
                  onClick={async () => {
                    if (!onCompactChannelContext) return;
                    setChannelActionBusy("compact");
                    try {
                      await onCompactChannelContext(canal.canal_id);
                    } finally {
                      setChannelActionBusy(null);
                    }
                  }}
                  className="rounded-lg bg-[#2A2A2E] hover:bg-[#34343A] px-3 py-1.5 text-[11.5px] font-semibold text-white shrink-0 disabled:opacity-50"
                >
                  {channelActionBusy === "compact" ? "Compactando..." : "Compactar agora"}
                </button>
              </div>

              <div className="px-3.5 py-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-semibold text-white">Excluir histórico</div>
                    <p className="text-[11px] text-[#8E8E93] leading-snug">
                      As mensagens são excluídas e os membros as esquecem. A configuração do canal continua.
                    </p>
                  </div>
                  {!confirmClearChannelHist && (
                    <button
                      type="button"
                      disabled={!onClearChannelHistory || channelActionBusy !== null}
                      onClick={() => setConfirmClearChannelHist(true)}
                      className="rounded-lg bg-[#FD2F3B]/15 hover:bg-[#FD2F3B]/25 border border-[#FD2F3B]/30 px-3 py-1.5 text-[11.5px] font-semibold text-[#FF7675] shrink-0"
                    >
                      Excluir
                    </button>
                  )}
                </div>
                {confirmClearChannelHist && (
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setConfirmClearChannelHist(false)}
                      className="rounded-lg bg-[#2A2A2E] px-2.5 py-1 text-[11px] text-[#DCDCDC]"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      disabled={channelActionBusy !== null}
                      onClick={async () => {
                        if (!onClearChannelHistory) return;
                        setChannelActionBusy("clear");
                        try {
                          await onClearChannelHistory(canal.canal_id);
                          setConfirmClearChannelHist(false);
                        } finally {
                          setChannelActionBusy(null);
                        }
                      }}
                      className="rounded-lg bg-[#FD2F3B] px-3 py-1 text-[11px] font-semibold text-white"
                    >
                      {channelActionBusy === "clear" ? "Excluindo..." : "Confirmar"}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Membros da equipe (com Coroa de líder e provedor próprio de cada agente) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <span className="text-[11.5px] font-medium text-[#8E8E93]">
                  {`Membros (${channelMembersDraft.length})`}
                </span>
                <button
                  type="button"
                  onClick={() => setChannelAddMemberOpen((v) => !v)}
                  className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#42A0FF] hover:underline"
                >
                  <Plus className="h-3 w-3" />
                  <span>Adicionar membro</span>
                </button>
              </div>

              {channelAddMemberOpen && (
                <div className="rounded-xl bg-[#18181A] border border-white/[0.08] p-2 space-y-1 max-h-40 overflow-y-auto">
                  {allAgentes
                    .filter(
                      (ag) =>
                        ag.agente_id !== "assistente_setup" &&
                        ag.agente_id !== "assistente_servidor_vps" &&
                        (ag.config as Record<string, unknown>)?.upgrade_desbloqueado !== false &&
                        !channelMembersDraft.includes(ag.agente_id)
                    )
                    .map((ag) => (
                      <button
                        key={ag.agente_id}
                        type="button"
                        onClick={() => {
                          const next = [...channelMembersDraft, ag.agente_id];
                          setChannelMembersDraft(next);
                          void onSaveChannelSettings?.(canal.canal_id, {
                            membros_agentes: next,
                          });
                        }}
                        className="w-full flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-[#DCDCDC] hover:bg-[#242428] hover:text-white"
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <MascoteAvatar
                            avatar={resolveAgentAvatarConfig(ag, ag.agente_id)}
                            agentKey={ag.agente_id}
                            size={20}
                          />
                          <span className="truncate">{ag.nome}</span>
                        </span>
                        <span className="text-[10px] text-[#787878] shrink-0">
                          {ag.modelo_padrao}
                        </span>
                      </button>
                    ))}
                </div>
              )}

              <div className="rounded-xl bg-[#212121] border border-white/[0.06] divide-y divide-white/[0.05] overflow-hidden">
                {channelMembersDraft.map((mId) => {
                  const ag = allAgentes.find((a) => a.agente_id === mId);
                  const vis = resolveAgentAvatarConfig(ag, mId);
                  const isLeader = (channelLeaderDraft ?? channelMembersDraft[0]) === mId;
                  return (
                    <div
                      key={mId}
                      className="px-3 py-2 flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <MascoteAvatar avatar={vis} agentKey={mId} size={26} />
                        <div className="min-w-0">
                          <div className="text-[12.5px] font-medium text-white truncate">
                            {ag?.nome ?? mId}
                          </div>
                          {ag?.modelo_padrao && (
                            <div className="text-[10.5px] text-[#787878] truncate">
                              {ag.modelo_padrao}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          title={isLeader ? "Líder da equipe" : "Definir como líder da equipe"}
                          aria-label={`Definir ${ag?.nome ?? mId} como líder`}
                          onClick={() => {
                            setChannelLeaderDraft(mId);
                            void onSaveChannelSettings?.(canal.canal_id, {
                              lider_agente_id: mId,
                            });
                          }}
                          className={`h-7 w-7 rounded-lg flex items-center justify-center transition-colors ${
                            isLeader
                              ? "text-[#FDCB6E] bg-[#FDCB6E]/10"
                              : "text-[#6A6A6A] hover:text-white hover:bg-white/[0.06]"
                          }`}
                        >
                          <Crown className="h-3.5 w-3.5" />
                        </button>
                        {channelMembersDraft.length > 1 && (
                          <button
                            type="button"
                            title="Remover membro da equipe"
                            aria-label={`Remover ${ag?.nome ?? mId} da equipe`}
                            onClick={() => {
                              const next = channelMembersDraft.filter((id) => id !== mId);
                              const nextLeader =
                                channelLeaderDraft === mId ? next[0] ?? null : channelLeaderDraft;
                              setChannelMembersDraft(next);
                              setChannelLeaderDraft(nextLeader);
                              void onSaveChannelSettings?.(canal.canal_id, {
                                membros_agentes: next,
                                lider_agente_id: nextLeader,
                              });
                            }}
                            className="h-7 w-7 rounded-lg flex items-center justify-center text-[#787878] hover:text-[#FF7675] hover:bg-[#FD2F3B]/10"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="studio-btn-primary w-full py-2 text-[12.5px]"
            >
              {saving ? "Salvando..." : "Salvar configurações da equipe"}
            </button>

            {onDeleteChannel && (
              confirmDeleteChannelModal ? (
                <div className="rounded-xl border border-[#FD2F3B]/40 bg-[#141414] p-3 space-y-2">
                  <p className="text-[11.5px] text-[#FF7675] font-medium">
                    Excluir a equipe {canal.nome} permanentemente?
                  </p>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteChannelModal(false)}
                      className="rounded-lg bg-[#2A2A2A] px-2.5 py-1 text-[11.5px] text-[#DCDCDC]"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await onDeleteChannel(canal.canal_id);
                        setConfirmDeleteChannelModal(false);
                      }}
                      className="rounded-lg bg-[#FD2F3B] px-3 py-1 text-[11.5px] font-semibold text-white"
                    >
                      Excluir equipe
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDeleteChannelModal(true)}
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#FD2F3B]/30 bg-[#FD2F3B]/10 hover:bg-[#FD2F3B]/20 px-3 py-2 text-[12px] font-semibold text-[#FF7675] transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Excluir equipe</span>
                </button>
              )
            )}
          </form>
        )}
    </>
  );
}
