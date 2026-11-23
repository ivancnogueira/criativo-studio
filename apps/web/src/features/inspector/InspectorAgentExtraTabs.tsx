import {
  FolderOpen,
  Monitor,
  MousePointerClick,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { CarbonSelect } from "../../components/ui/CarbonControls";
import { getCriativoDesktopBridge } from "../../types/desktop-bridge";
import { FOLDER_MODE_OPTIONS } from "./inspector-types";
import type { RightInspectorPanelProps } from "./inspector-types";
import type { RightInspectorController } from "./useRightInspectorController";

export function InspectorAgentExtraTabs({
  ctrl,
  props,
}: {
  ctrl: RightInspectorController;
  props: RightInspectorPanelProps;
}) {
  const {
    agente,
    activeBrowserTabsCount = 0,
    userBrowsingStepsCount = 0,
    onClearChatHistory,
    onSaveAgentSettings,
    onRestoreAgentDefaults,
    onOpenAgentBrowserTakeover,
    onInspectAgentBrowsingLog,
  } = props;
  const {
    subView,
    setSubView,
    promptDraft,
    setPromptDraft,
    allowedFoldersDraft,
    newFolderPath,
    setNewFolderPath,
    newFolderMode,
    setNewFolderMode,
    folderError,
    autoMemoryDraft,
    setAutoMemoryDraft,
    browserProfileDraft,
    setBrowserProfileDraft,
    allowNewChatDraft,
    setAllowNewChatDraft,
    allowQuickAckDraft,
    setAllowQuickAckDraft,
    saving,
    setSaving,
    confirmClearHistory,
    setConfirmClearHistory,
    clearingHistory,
    setClearingHistory,
    memoryDraft,
    setMemoryDraft,
    memories,
    handleSaveConfig,
    handleAddMemory,
    handleAddAllowedFolderPath,
    handlePickNativeFolder,
    handleRemoveAllowedFolder,
    browserProfileOptions,
    authorizedFoldersLabel,
  } = ctrl;

  return (
    <>
        {subView === "instructions" && agente && (
          <form onSubmit={handleSaveConfig} className="space-y-4">
            <div>
              <label
                htmlFor="inspector-agent-prompt"
                className="block text-[12px] font-semibold text-[#E5E5E5] mb-1.5"
              >
                Instruções permanentes
              </label>
              <textarea
                id="inspector-agent-prompt"
                name="inspector_agent_prompt"
                aria-label="Instruções do Criativo"
                rows={10}
                value={promptDraft}
                onChange={(e) => setPromptDraft(e.target.value)}
                className="w-full rounded-xl bg-[#212121] border border-white/10 px-3 py-2.5 text-[12.5px] text-white focus:outline-none focus:border-white/30"
              />
            </div>
            <button
              type="submit"
              disabled={saving}
              className="studio-btn-primary w-full py-2 text-[12.5px]"
            >
              {saving ? "Salvando..." : "Salvar instruções"}
            </button>
          </form>
        )}

        {subView === "memories" && agente && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-xl bg-[#212121] border border-white/[0.06] px-3.5 py-3">
              <div className="min-w-0">
                <div className="text-[12.5px] font-semibold text-white">
                  Memória automática deste Criativo
                </div>
                <div className="text-[11px] text-[#8E8E93]">
                  Extrai aprendizados relevantes em segundo plano após as conversas.
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={autoMemoryDraft}
                aria-label="Memória automática deste Criativo"
                onClick={() => {
                  const next = !autoMemoryDraft;
                  setAutoMemoryDraft(next);
                  void onSaveAgentSettings(agente.agente_id, { auto_memory_enabled: next });
                }}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                  autoMemoryDraft ? "bg-[#007CF7]" : "bg-[#2A2A2A]"
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    autoMemoryDraft ? "translate-x-4.5" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            <div className="space-y-2">
              <div className="flex gap-1.5">
                <input
                  id="inspector-new-memory"
                  name="new_memory"
                  aria-label="Adicionar memória permanente do Criativo"
                  type="text"
                  value={memoryDraft}
                  onChange={(e) => setMemoryDraft(e.target.value)}
                  placeholder="Ex.: Tom direto sem emojis..."
                  className="flex-1 rounded-xl bg-[#212121] border border-white/10 px-3 py-1.5 text-[12px] text-white placeholder-[#6A6A6A] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void handleAddMemory()}
                  className="rounded-xl bg-[#2A2A2A] hover:bg-[#333336] px-3 py-1.5 text-[12px] font-medium text-white"
                >
                  Fixar
                </button>
              </div>
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {memories.length === 0 ? (
                  <p className="rounded-xl border border-white/[0.06] bg-[#212121] p-3.5 text-[11.5px] text-[#8E8E93]">
                    Nenhuma memória salva para este especialista ainda.
                  </p>
                ) : (
                  memories.map((m) => (
                    <div
                      key={m.memoria_id}
                      className="rounded-lg bg-[#212121] border border-white/[0.05] px-3 py-2 text-[11.5px] text-[#DCDCDC]"
                    >
                      {m.texto}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {subView === "folders" && agente && (
          <div className="space-y-4">
            <div className="rounded-xl bg-[#212121] border border-white/[0.06] p-3.5 space-y-3">
              <div>
                <div className="text-[12.5px] font-semibold text-white">{authorizedFoldersLabel}</div>
                <p className="text-[11px] text-[#8E8E93] mt-0.5">
                  Conceda acesso a diretórios específicos do seu computador fora do workspace padrão do estúdio.
                </p>
              </div>

              <div className="space-y-2">
                <CarbonSelect
                  ariaLabel="Modo de acesso da pasta"
                  value={newFolderMode}
                  options={FOLDER_MODE_OPTIONS}
                  onChange={(val) => setNewFolderMode(val)}
                />

                {getCriativoDesktopBridge()?.pickFolder && (
                  <button
                    type="button"
                    onClick={() => void handlePickNativeFolder()}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#007CF7] hover:bg-[#1688FA] px-3 py-2 text-[12px] font-semibold text-white transition-colors"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    <span>Escolher pasta do computador</span>
                  </button>
                )}

                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={newFolderPath}
                    onChange={(e) => setNewFolderPath(e.target.value)}
                    placeholder="Ex.: D:\Clientes\MarcaX"
                    aria-label="Caminho da pasta autorizada"
                    className="flex-1 min-w-0 rounded-xl bg-[#141414] border border-white/10 px-3 py-1.5 text-[12px] text-white placeholder-[#6A6A6A] focus:outline-none focus:border-white/30"
                  />
                  <button
                    type="button"
                    disabled={!newFolderPath.trim()}
                    onClick={() => void handleAddAllowedFolderPath(newFolderPath, newFolderMode)}
                    className="rounded-xl bg-[#2A2A2A] hover:bg-[#343438] disabled:opacity-40 px-3 py-1.5 text-[12px] font-semibold text-white shrink-0"
                  >
                    Adicionar
                  </button>
                </div>
              </div>

              {folderError && (
                <div className="rounded-lg border border-[#FD2F3B]/40 bg-[#FD2F3B]/10 px-2.5 py-2 text-[11.5px] text-[#FF7675]">
                  {folderError}
                </div>
              )}
            </div>

            {allowedFoldersDraft.length === 0 ? (
              <p className="rounded-xl border border-white/[0.06] bg-[#212121] p-3.5 text-[11.5px] text-[#8E8E93]">
                Nenhuma pasta adicional liberada. O Criativo opera apenas no workspace do estúdio.
              </p>
            ) : (
              <div className="space-y-1.5">
                {allowedFoldersDraft.map((folder) => (
                  <div
                    key={folder.path}
                    className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-[#212121] px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-mono text-white truncate" title={folder.path}>
                        {folder.path}
                      </p>
                      <span className="inline-block mt-0.5 rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-[#A8A8A8]">
                        {folder.mode === "read" ? "Somente leitura" : "Leitura e escrita"}
                      </span>
                    </div>
                    <button
                      type="button"
                      aria-label={`Remover pasta ${folder.path}`}
                      onClick={() => void handleRemoveAllowedFolder(folder.path)}
                      className="rounded-lg p-1.5 text-[#979797] hover:bg-[#FD2F3B]/15 hover:text-[#FF7675]"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {subView === "advanced" && agente && (
          <div className="space-y-4">
            <div className="rounded-xl bg-[#212121] border border-white/[0.06] p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[12px] font-semibold text-[#F0F0F0]">
                  <ShieldCheck size={14} className="text-[#42A0FF]" />
                  <span>Navegador &amp; Sessões</span>
                </span>
                {activeBrowserTabsCount > 0 && (
                  <span className="rounded-full bg-[#31CF76]/15 px-2 py-0.5 text-[11px] font-semibold text-[#31CF76]">
                    {activeBrowserTabsCount} aba(s)
                  </span>
                )}
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] text-[#979797]">Perfil de navegador</span>
                  <button
                    type="button"
                    onClick={() => setSubView("browser_profiles")}
                    className="text-[12px] font-semibold text-[#42A0FF] hover:underline"
                  >
                    Gerenciar perfis de navegador
                  </button>
                </div>
                <CarbonSelect
                  ariaLabel="Perfil de navegador do Criativo"
                  value={browserProfileDraft}
                  options={browserProfileOptions}
                  onChange={(nextVal) => {
                    setBrowserProfileDraft(nextVal);
                    void onSaveAgentSettings(agente.agente_id, {
                      browser_profile_id: nextVal === "shared" ? null : nextVal,
                    });
                  }}
                />
              </div>

              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-semibold text-[#F0F0F0]">
                    Permitir iniciar novo chat
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={allowNewChatDraft}
                    aria-label="Permitir iniciar novo chat"
                    onClick={() => {
                      const next = !allowNewChatDraft;
                      setAllowNewChatDraft(next);
                      void onSaveAgentSettings(agente.agente_id, { allow_new_chat: next });
                    }}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                      allowNewChatDraft ? "bg-[#007CF7]" : "bg-[#2A2A2A]"
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                        allowNewChatDraft ? "translate-x-4.5" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-semibold text-[#F0F0F0]">
                    Mostrar plano antes de tarefas longas
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={allowQuickAckDraft}
                    aria-label="Mostrar plano antes de tarefas longas"
                    onClick={() => {
                      const next = !allowQuickAckDraft;
                      setAllowQuickAckDraft(next);
                      void onSaveAgentSettings(agente.agente_id, { allow_quick_ack: next });
                    }}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                      allowQuickAckDraft ? "bg-[#007CF7]" : "bg-[#2A2A2A]"
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                        allowQuickAckDraft ? "translate-x-4.5" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>
              </div>

              {(onOpenAgentBrowserTakeover || onInspectAgentBrowsingLog) && (
                <div className="grid grid-cols-1 gap-1.5 pt-1">
                  {onOpenAgentBrowserTakeover && (
                    <button
                      type="button"
                      onClick={() => void onOpenAgentBrowserTakeover(agente.agente_id)}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#242424] px-3 py-1.5 text-[12px] font-semibold text-[#F0F0F0] hover:bg-[#2A2A2A]"
                    >
                      <Monitor size={13} className="text-[#42A0FF]" />
                      <span>Assumir navegador</span>
                    </button>
                  )}
                  {onInspectAgentBrowsingLog && (
                    <button
                      type="button"
                      onClick={() => void onInspectAgentBrowsingLog(agente.agente_id)}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#242424] px-3 py-1.5 text-[12px] font-semibold text-[#F0F0F0] hover:bg-[#2A2A2A]"
                    >
                      <MousePointerClick size={13} className="text-[#31CF76]" />
                      <span>Inspecionar log gravado ({userBrowsingStepsCount})</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="rounded-xl bg-[#212121] border border-white/[0.06] p-3.5 space-y-2.5">
              <div className="text-[11.5px] font-semibold text-[#979797]">Manutenção</div>

              {onRestoreAgentDefaults && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={async () => {
                    setSaving(true);
                    try {
                      await onRestoreAgentDefaults(agente.agente_id);
                    } finally {
                      setSaving(false);
                    }
                  }}
                  className="w-full rounded-xl bg-[#2A2A2A] hover:bg-[#333338] px-3 py-2 text-[12px] font-semibold text-white transition-colors"
                >
                  Restaurar padrão do especialista
                </button>
              )}

              {onClearChatHistory && (
                confirmClearHistory ? (
                  <div className="rounded-xl border border-[#FD2F3B]/40 bg-[#141414] p-3 space-y-2">
                    <p className="text-[11.5px] text-[#FF7675] font-medium">
                      Apagar todas as mensagens da conversa principal com {agente.nome}?
                    </p>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        disabled={clearingHistory}
                        onClick={() => setConfirmClearHistory(false)}
                        className="rounded-lg bg-[#2A2A2A] px-2.5 py-1 text-[11.5px] text-[#DCDCDC] hover:bg-[#343438]"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        disabled={clearingHistory}
                        onClick={async () => {
                          setClearingHistory(true);
                          try {
                            await onClearChatHistory(agente.agente_id);
                            setConfirmClearHistory(false);
                          } finally {
                            setClearingHistory(false);
                          }
                        }}
                        className="rounded-lg bg-[#FD2F3B] px-3 py-1 text-[11.5px] font-semibold text-white hover:bg-[#e12732]"
                      >
                        {clearingHistory ? "Apagando..." : "Confirmar exclusão"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmClearHistory(true)}
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#FD2F3B]/30 bg-[#FD2F3B]/10 hover:bg-[#FD2F3B]/20 px-3 py-2 text-[12px] font-semibold text-[#FF7675] transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Apagar histórico do chat</span>
                  </button>
                )
              )}
            </div>
          </div>
        )}
    </>
  );
}
