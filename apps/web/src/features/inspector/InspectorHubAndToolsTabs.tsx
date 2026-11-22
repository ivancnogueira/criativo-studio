import {
  AudioLines,
  CalendarClock,
  FolderOpen,
  GitFork,
  Plus,
  Settings,
  Smartphone,
  Sparkles,
  Trash2,
} from "lucide-react";
import { ServerBrowserProfilesPanel } from "../browser/ServerBrowserProfilesPanel";
import { ApprovalBridge } from "../preview/ApprovalBridge";
import { InstagramMobilePreview } from "../preview/InstagramMobilePreview";
import { AgentRoutinesSettings } from "../routines/AgentRoutinesSettings";
import { BackupModelsEditor } from "./BackupModelsEditor";
import type { RightInspectorPanelProps } from "./inspector-types";
import type { RightInspectorController } from "./useRightInspectorController";

export function InspectorHubAndToolsTabs({
  ctrl,
  props,
}: {
  ctrl: RightInspectorController;
  props: RightInspectorPanelProps;
}) {
  const {
    agente,
    canal = null,
    arquivos,
    canais = [],
    threads = [],
    activeThreadId = null,
    routineCount = 0,
    channelRoutineCount = 0,
    routineFocusSignal = null,
    previewTarefa,
    provedores = [],
    browserProfiles = [],
    browserProxies = [],
    onOpenFilesPage,
    onSelectThread,
    onCreateSubconversation,
    onDeleteFile,
    onOpenWhatsAppModal,
    onOpenRoutineThread,
    onRoutinesChanged,
    onSaveAgentSettings,
    onApproveTask,
    onRequestRevision,
    onCreateBrowserProfile,
    onUpdateBrowserProfile,
    onClearBrowserProfile,
    onDeleteBrowserProfile,
    onSaveBrowserProxy,
    onDeleteBrowserProxy,
  } = props;
  const {
    subView,
    setSubView,
    backupModelsDraft,
    setBackupModelsDraft,
    confirmDeleteFileId,
    setConfirmDeleteFileId,
    deletingFileId,
    setDeletingFileId,
    deleteFileError,
    setDeleteFileError,
  } = ctrl;

  return (
    <>
        {subView === "hub" && (
          <div className="h-full flex flex-col justify-between gap-4">
            <div className="my-auto space-y-2.5 py-4">
              {canal && !agente ? (
                <>
                  <button
                    type="button"
                    onClick={() => setSubView("channel_config")}
                    className="w-full flex items-center gap-3 rounded-xl bg-[#212121] hover:bg-[#262626] border border-white/[0.07] px-4 py-3 text-[13px] font-medium text-white transition-colors"
                  >
                    <Settings className="h-4 w-4 text-[#42A0FF]" />
                    <span>Configurações da equipe</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSubView("channel_routines")}
                    className="w-full flex items-center gap-3 rounded-xl bg-[#212121] hover:bg-[#262626] border border-white/[0.07] px-4 py-3 text-[13px] font-medium text-white transition-colors"
                  >
                    <CalendarClock className="h-4 w-4 text-[#42A0FF]" />
                    <span>
                      {channelRoutineCount > 0
                        ? `Gerenciar rotinas (${channelRoutineCount})`
                        : "Gerenciar rotinas"}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSubView("files")}
                    className="w-full flex items-center gap-3 rounded-xl bg-[#212121] hover:bg-[#262626] border border-white/[0.07] px-4 py-3 text-[13px] font-medium text-white transition-colors"
                  >
                    <FolderOpen className="h-4 w-4 text-[#979797]" />
                    <span>Abrir Biblioteca ({arquivos.length})</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSubView("preview")}
                    className="w-full flex items-center gap-3 rounded-xl bg-[#212121] hover:bg-[#262626] border border-white/[0.07] px-4 py-3 text-[13px] font-medium text-white transition-colors"
                  >
                    <Smartphone className="h-4 w-4 text-[#42A0FF]" />
                    <span>Abrir Preview Instagram</span>
                  </button>

                  <button
                    type="button"
                    onClick={onOpenWhatsAppModal}
                    className="w-full flex items-center gap-3 rounded-xl bg-[#212121] hover:bg-[#262626] border border-white/[0.07] px-4 py-3 text-[13px] font-medium text-white transition-colors"
                  >
                    <AudioLines className="h-4 w-4 text-[#31CF76]" />
                    <span>Abrir Voz &amp; WhatsApp</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setSubView("files")}
                    className="w-full flex items-center gap-3 rounded-xl bg-[#212121] hover:bg-[#262626] border border-white/[0.07] px-4 py-3 text-[13px] font-medium text-white transition-colors"
                  >
                    <FolderOpen className="h-4 w-4 text-[#979797]" />
                    <span>Abrir Biblioteca ({arquivos.length})</span>
                  </button>

                  <button
                    type="button"
                    disabled={!agente}
                    onClick={() => setSubView("subconversations")}
                    className="w-full flex items-center gap-3 rounded-xl bg-[#212121] hover:bg-[#262626] border border-white/[0.07] px-4 py-3 text-[13px] font-medium text-white transition-colors disabled:opacity-40"
                  >
                    <GitFork className="h-4 w-4 text-[#42A0FF]" />
                    <span>
                      {threads.length > 0 ? `Subconversas (${threads.length})` : "Subconversas"}
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled={!agente}
                    onClick={() => setSubView("config")}
                    className="w-full flex items-center gap-3 rounded-xl bg-[#212121] hover:bg-[#262626] border border-white/[0.07] px-4 py-3 text-[13px] font-medium text-white transition-colors disabled:opacity-40"
                  >
                    <Settings className="h-4 w-4 text-[#979797]" />
                    <span>Abrir Configurações do agente</span>
                  </button>

                  <button
                    type="button"
                    disabled={!agente}
                    onClick={() => setSubView("routines")}
                    className="w-full flex items-center gap-3 rounded-xl bg-[#212121] hover:bg-[#262626] border border-white/[0.07] px-4 py-3 text-[13px] font-medium text-white transition-colors disabled:opacity-40"
                  >
                    <CalendarClock className="h-4 w-4 text-[#42A0FF]" />
                    <span>
                      {routineCount > 0 ? `Gerenciar rotinas (${routineCount})` : "Gerenciar rotinas"}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSubView("preview")}
                    className="w-full flex items-center gap-3 rounded-xl bg-[#212121] hover:bg-[#262626] border border-white/[0.07] px-4 py-3 text-[13px] font-medium text-white transition-colors"
                  >
                    <Smartphone className="h-4 w-4 text-[#42A0FF]" />
                    <span>Abrir Preview Instagram</span>
                  </button>

                  <button
                    type="button"
                    onClick={onOpenWhatsAppModal}
                    className="w-full flex items-center gap-3 rounded-xl bg-[#212121] hover:bg-[#262626] border border-white/[0.07] px-4 py-3 text-[13px] font-medium text-white transition-colors"
                  >
                    <AudioLines className="h-4 w-4 text-[#31CF76]" />
                    <span>Abrir Voz &amp; WhatsApp</span>
                  </button>
                </>
              )}
            </div>

            {previewTarefa && (
              <div className="pt-3 border-t border-white/[0.06]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11.5px] font-medium text-[#979797] flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-[#31CF76]" />
                    Pronto para aprovação
                  </span>
                  <button
                    type="button"
                    onClick={() => setSubView("preview")}
                    className="text-[11px] text-[#42A0FF] hover:underline"
                  >
                    Expandir
                  </button>
                </div>
                <ApprovalBridge
                  tarefa={previewTarefa}
                  onApprove={onApproveTask}
                  onRequestRevision={onRequestRevision}
                />
              </div>
            )}
          </div>
        )}

        {subView === "preview" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium text-[#979797] flex items-center gap-1.5">
                <Smartphone className="h-3.5 w-3.5 text-[#42A0FF]" />
                Vitrine Mobile Instagram
              </span>
            </div>
            <InstagramMobilePreview tarefa={previewTarefa} />
            <ApprovalBridge
              tarefa={previewTarefa}
              onApprove={onApproveTask}
              onRequestRevision={onRequestRevision}
            />
          </div>
        )}

        {subView === "subconversations" && agente && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12.5px] font-semibold text-white">Subconversas ativas</span>
              {onCreateSubconversation && (
                <button
                  type="button"
                  onClick={onCreateSubconversation}
                  className="inline-flex items-center gap-1 rounded-lg bg-[#007CF7] px-2.5 py-1 text-[11.5px] font-semibold text-white hover:bg-[#1688FA]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Nova Subconversa</span>
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => onSelectThread?.(null)}
              className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
                activeThreadId === null
                  ? "border-[#007CF7] bg-[#007CF7]/15 text-white"
                  : "border-white/[0.06] bg-[#212121] text-[#DCDCDC] hover:bg-[#262626]"
              }`}
            >
              <div className="text-[12.5px] font-semibold">Conversa principal</div>
              <div className="text-[11px] text-[#8E8E93]">Fluxo direto com {agente.nome}</div>
            </button>

            {threads.length === 0 ? (
              <p className="rounded-xl border border-white/[0.06] bg-[#212121] p-4 text-[12px] text-[#979797]">
                Nenhuma subconversa aberta ainda. Clique em <strong>Nova Subconversa</strong> para trabalhar em paralelo sem misturar o chat principal.
              </p>
            ) : (
              <div className="space-y-1.5">
                {threads.map((th) => {
                  const active = activeThreadId === th.thread_id;
                  return (
                    <button
                      key={th.thread_id}
                      type="button"
                      onClick={() => onSelectThread?.(th.thread_id)}
                      className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
                        active
                          ? "border-[#007CF7] bg-[#007CF7]/15 text-white"
                          : "border-white/[0.06] bg-[#212121] text-[#DCDCDC] hover:bg-[#262626]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[12.5px] font-semibold">{th.titulo}</span>
                        <span className="text-[10.5px] text-[#8E8E93] shrink-0">{th.estado}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {subView === "files" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] font-semibold text-white">Biblioteca &amp; Mídias</span>
              <button
                type="button"
                onClick={onOpenFilesPage}
                className="text-[11.5px] text-[#42A0FF] hover:underline"
              >
                Ver galeria completa
              </button>
            </div>
            {deleteFileError && (
              <div className="rounded-lg border border-[#FD2F3B]/40 bg-[#FD2F3B]/10 px-2.5 py-1.5 text-[11.5px] text-[#FF7675]">
                {deleteFileError}
              </div>
            )}
            {arquivos.length === 0 ? (
              <p className="text-[12px] text-[#979797] rounded-xl bg-[#212121] p-4 border border-white/[0.06]">
                Nenhum arquivo enviado ainda. Use o botão <strong>+</strong> no chat para subir
                referências faciais ou logos.
              </p>
            ) : (
              <div className="space-y-2">
                {arquivos.slice(0, 12).map((arq) => (
                  <div
                    key={arq.arquivo_id}
                    className="flex items-center gap-2 rounded-xl bg-[#212121] hover:bg-[#262626] border border-white/[0.06] p-2.5 transition-colors"
                  >
                    <a
                      href={arq.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2.5 min-w-0 flex-1"
                    >
                      {arq.mime_type.startsWith("image/") ? (
                        <img
                          src={arq.url}
                          alt={arq.nome_original}
                          className="h-10 w-10 rounded-lg object-cover bg-[#101010] shrink-0"
                        />
                      ) : (
                        <FolderOpen className="h-5 w-5 text-[#42A0FF] shrink-0 ml-1" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-medium text-white truncate">
                          {arq.nome_original}
                        </p>
                        <p className="text-[10.5px] text-[#6A6A6A] truncate">
                          {arq.tipo_uso} · {(arq.tamanho_bytes / 1024).toFixed(1)} KB
                        </p>
                      </div>
                    </a>

                    {onDeleteFile && (
                      confirmDeleteFileId === arq.arquivo_id ? (
                        <div className="flex items-center gap-1 shrink-0 rounded-lg bg-[#141414] border border-[#FD2F3B]/40 px-1.5 py-1 text-[10.5px]">
                          <span className="text-[#FF7675] font-medium">Excluir?</span>
                          <button
                            type="button"
                            disabled={deletingFileId === arq.arquivo_id}
                            onClick={async () => {
                              setDeletingFileId(arq.arquivo_id);
                              setDeleteFileError(null);
                              try {
                                await onDeleteFile(arq.arquivo_id);
                                setConfirmDeleteFileId(null);
                              } catch (err) {
                                setDeleteFileError(
                                  err instanceof Error ? err.message : "Erro ao excluir arquivo."
                                );
                              } finally {
                                setDeletingFileId(null);
                              }
                            }}
                            className="rounded px-1.5 py-0.5 bg-[#FD2F3B] text-white font-semibold hover:bg-[#e12732]"
                          >
                            Sim
                          </button>
                          <button
                            type="button"
                            disabled={deletingFileId === arq.arquivo_id}
                            onClick={() => setConfirmDeleteFileId(null)}
                            className="rounded px-1.5 py-0.5 bg-[#2A2A2A] text-[#DCDCDC] hover:bg-[#333336]"
                          >
                            Não
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          title="Excluir arquivo"
                          aria-label={`Excluir ${arq.nome_original}`}
                          onClick={() => {
                            setDeleteFileError(null);
                            setConfirmDeleteFileId(arq.arquivo_id);
                          }}
                          className="shrink-0 rounded-lg p-1.5 text-[#979797] hover:bg-[#FD2F3B]/15 hover:text-[#FF7675] transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {subView === "routines" && agente && (
          <AgentRoutinesSettings
            ownerKind="agente"
            ownerId={agente.agente_id}
            ownerName={agente.nome}
            canais={canais}
            initialSelectedRoutineId={routineFocusSignal?.rotinaId ?? null}
            onBackToHub={() => setSubView("config")}
            onOpenThreadOrChat={onOpenRoutineThread}
            onRoutinesChanged={onRoutinesChanged}
          />
        )}

        {subView === "backup_models" && agente && (
          <BackupModelsEditor
            primaryModel={agente.modelo_padrao}
            config={backupModelsDraft}
            provedores={provedores}
            onChange={(nextCfg) => {
              setBackupModelsDraft(nextCfg);
              void onSaveAgentSettings(agente.agente_id, { backup_models: nextCfg });
            }}
          />
        )}

        {subView === "browser_profiles" && (
          <ServerBrowserProfilesPanel
            profiles={browserProfiles}
            proxies={browserProxies}
            onCreateProfile={async (input) => {
              if (onCreateBrowserProfile) await onCreateBrowserProfile(input);
            }}
            onUpdateProfile={async (perfilId, patch) => {
              if (onUpdateBrowserProfile) await onUpdateBrowserProfile(perfilId, patch);
            }}
            onClearProfile={async (perfilId) => {
              if (onClearBrowserProfile) await onClearBrowserProfile(perfilId);
            }}
            onDeleteProfile={async (perfilId) => {
              if (onDeleteBrowserProfile) await onDeleteBrowserProfile(perfilId);
            }}
            onSaveProxy={async (input) => {
              if (onSaveBrowserProxy) return await onSaveBrowserProxy(input);
              throw new Error("Serviço de proxy não conectado.");
            }}
            onDeleteProxy={async (proxyId) => {
              if (onDeleteBrowserProxy) await onDeleteBrowserProxy(proxyId);
            }}
          />
        )}
    </>
  );
}
