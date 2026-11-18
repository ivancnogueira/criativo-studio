import React, { useEffect, useState } from "react";
import type {
  AgenteRegistro,
  ArquivoStudio,
  AvatarShape,
  CanalEquipe,
  NivelEsforco,
  TarefaRegistro,
} from "@criativo/contracts";
import {
  ArrowLeft,
  AudioLines,
  Brain,
  CalendarClock,
  FolderOpen,
  Settings,
  Smartphone,
  Sparkles,
  X,
} from "lucide-react";
import { MascoteAppearancePicker } from "../../components/MascoteAvatar";
import { ApprovalBridge } from "../preview/ApprovalBridge";
import { InstagramMobilePreview } from "../preview/InstagramMobilePreview";
import { AgentRoutinesSettings } from "../routines/AgentRoutinesSettings";

interface RightInspectorPanelProps {
  open: boolean;
  agente: AgenteRegistro | null;
  arquivos: ArquivoStudio[];
  canais?: CanalEquipe[];
  routineCount?: number;
  routineFocusSignal?: {
    subView?: "routines";
    rotinaId?: string | null;
    nonce: number;
  } | null;
  previewTarefa: TarefaRegistro | null;
  onClose: () => void;
  onOpenFilesPage: () => void;
  onOpenWhatsAppModal: () => void;
  onOpenRoutineThread?: (canalId: string) => void;
  onRoutinesChanged?: () => void;
  onSaveAgentSettings: (
    agenteId: string,
    patch: {
      nome?: string;
      papel?: string;
      prompt_base?: string;
      avatar_shape?: AvatarShape;
      avatar_color?: string;
      effort?: NivelEsforco;
    }
  ) => Promise<void>;
  onRestoreAgentDefaults?: (agenteId: string) => Promise<void>;
  onAddMemory?: (agenteId: string, texto: string) => Promise<void>;
  onLoadMemories?: (
    agenteId: string
  ) => Promise<Array<{ memoria_id: string; texto: string; criado_em: string }>>;
  onApproveTask: (tarefaId: string) => Promise<void>;
  onRequestRevision: (tarefa: TarefaRegistro) => Promise<void>;
}

/**
 * Painel inspetor direito estilo OpenBot (Screenshot 5): 3 botões de atalho rápido no centro
 * ('Abrir Arquivos', 'Abrir Configurações do agente', 'Abrir Voz') + vitrine Mobile Instagram e editor do agente.
 */
export const RightInspectorPanel: React.FC<RightInspectorPanelProps> = ({
  open,
  agente,
  arquivos,
  canais = [],
  routineCount = 0,
  routineFocusSignal = null,
  previewTarefa,
  onClose,
  onOpenFilesPage,
  onOpenWhatsAppModal,
  onOpenRoutineThread,
  onRoutinesChanged,
  onSaveAgentSettings,
  onRestoreAgentDefaults,
  onAddMemory,
  onLoadMemories,
  onApproveTask,
  onRequestRevision,
}) => {
  const [subView, setSubView] = useState<"hub" | "config" | "preview" | "files" | "routines">(
    routineFocusSignal?.subView === "routines" ? "routines" : "hub"
  );
  const [nomeDraft, setNomeDraft] = useState(agente?.nome ?? "");
  const [promptDraft, setPromptDraft] = useState("");
  const [shapeDraft, setShapeDraft] = useState<AvatarShape>("blob");
  const [colorDraft, setColorDraft] = useState("#38bdf8");
  const [saving, setSaving] = useState(false);
  const [memoryDraft, setMemoryDraft] = useState("");
  const [memories, setMemories] = useState<
    Array<{ memoria_id: string; texto: string; criado_em: string }>
  >([]);

  useEffect(() => {
    if (routineFocusSignal?.subView === "routines") {
      setSubView("routines");
    }
  }, [routineFocusSignal?.nonce, routineFocusSignal?.subView]);

  useEffect(() => {
    if (!agente) return;
    const cfg = (agente.config ?? {}) as Record<string, unknown>;
    setNomeDraft(agente.nome);
    setPromptDraft(typeof cfg.prompt_base === "string" ? cfg.prompt_base : "");
    setShapeDraft(
      (typeof cfg.avatar_shape === "string" ? cfg.avatar_shape : "blob") as AvatarShape
    );
    setColorDraft(typeof cfg.avatar_color === "string" ? cfg.avatar_color : "#38bdf8");
  }, [agente]);

  useEffect(() => {
    if (subView === "config" && agente && onLoadMemories) {
      void onLoadMemories(agente.agente_id).then(setMemories).catch(() => {});
    }
  }, [subView, agente, onLoadMemories]);

  if (!open) return null;

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agente) return;
    setSaving(true);
    try {
      await onSaveAgentSettings(agente.agente_id, {
        nome: nomeDraft.trim() || agente.nome,
        prompt_base: promptDraft,
        avatar_shape: shapeDraft,
        avatar_color: colorDraft,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleAddMemory = async () => {
    if (!agente || !onAddMemory || !memoryDraft.trim()) return;
    const txt = memoryDraft.trim();
    setMemoryDraft("");
    await onAddMemory(agente.agente_id, txt);
    if (onLoadMemories) {
      const updated = await onLoadMemories(agente.agente_id);
      setMemories(updated);
    }
  };

  const panelTitle =
    subView === "files"
      ? `Arquivos (${arquivos.length})`
      : subView === "config"
        ? "Configurações do agente"
        : subView === "routines"
          ? "Rotinas do agente"
          : subView === "preview"
            ? "Preview Instagram"
            : "";

  return (
    <aside
      aria-label="Inspetor contextual do agente"
      className="w-[300px] xl:w-[330px] shrink-0 bg-[#1A1A1A] border-l border-white/[0.06] flex flex-col h-full overflow-hidden"
    >
      {/* Topo estilo OpenBot SidePanelHeader: no launcher só fechar discreto; nos subpainéis exibe Voltar + título + fechar */}
      <div className="h-[48px] shrink-0 px-3.5 flex items-center justify-between gap-2 border-b border-white/[0.06]">
        {subView === "hub" ? (
          <span className="text-[12px] font-medium text-[#787878]">Painel do agente</span>
        ) : (
          <button
            type="button"
            onClick={() => setSubView("hub")}
            className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[#DCDCDC] hover:text-white transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>{panelTitle}</span>
          </button>
        )}

        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar inspetor lateral"
          className="h-7 w-7 rounded-lg flex items-center justify-center text-[#979797] hover:text-white hover:bg-[#242424] ml-auto"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 min-w-0">
        {subView === "hub" && (
          <div className="h-full flex flex-col justify-between gap-4">
            {/* Launcher central limpo fiel ao SidePanelLauncher do OpenBot */}
            <div className="my-auto space-y-2.5 py-4">
              <button
                type="button"
                onClick={() => setSubView("files")}
                className="w-full flex items-center gap-3 rounded-xl bg-[#212121] hover:bg-[#262626] border border-white/[0.07] px-4 py-3 text-[13px] font-medium text-white transition-colors"
              >
                <FolderOpen className="h-4 w-4 text-[#979797]" />
                <span>Abrir Arquivos ({arquivos.length})</span>
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
            </div>

            {/* Vitrine rápida abaixo caso haja criativo em aprovação */}
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

        {subView === "files" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] font-semibold text-white">
                ImagePaths &amp; Mídias
              </span>
              <button
                type="button"
                onClick={onOpenFilesPage}
                className="text-[11.5px] text-[#42A0FF] hover:underline"
              >
                Ver galeria completa
              </button>
            </div>
            {arquivos.length === 0 ? (
              <p className="text-[12px] text-[#979797] rounded-xl bg-[#212121] p-4 border border-white/[0.06]">
                Nenhum arquivo enviado ainda. Use o botão <strong>+</strong> no chat para subir referências faciais ou logos.
              </p>
            ) : (
              <div className="space-y-2">
                {arquivos.slice(0, 12).map((arq) => (
                  <a
                    key={arq.arquivo_id}
                    href={arq.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2.5 rounded-xl bg-[#212121] hover:bg-[#262626] border border-white/[0.06] p-2.5 transition-colors"
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
            onBackToHub={() => setSubView("hub")}
            onOpenThreadOrChat={onOpenRoutineThread}
            onRoutinesChanged={onRoutinesChanged}
          />
        )}

        {subView === "config" && agente && (
          <div className="space-y-5">
            <form onSubmit={handleSaveConfig} className="space-y-3.5">
              <div className="rounded-xl bg-[#212121] border border-white/[0.06] p-3">
                <MascoteAppearancePicker
                  color={colorDraft}
                  shape={shapeDraft}
                  onChangeColor={setColorDraft}
                  onChangeShape={setShapeDraft}
                />
              </div>

              <div>
                <label
                  htmlFor="inspector-agent-name"
                  className="block text-[11.5px] text-[#979797] mb-1"
                >
                  Nome do agente
                </label>
                <input
                  id="inspector-agent-name"
                  name="inspector_agent_name"
                  aria-label="Nome do agente"
                  type="text"
                  value={nomeDraft}
                  onChange={(e) => setNomeDraft(e.target.value)}
                  className="w-full rounded-xl bg-[#212121] border border-white/10 px-3 py-2 text-[12.5px] text-white focus:outline-none focus:border-white/30"
                />
              </div>

              <div>
                <label
                  htmlFor="inspector-agent-prompt"
                  className="block text-[11.5px] text-[#979797] mb-1"
                >
                  Instruções permanentes
                </label>
                <textarea
                  id="inspector-agent-prompt"
                  name="inspector_agent_prompt"
                  aria-label="Instruções do agente"
                  rows={4}
                  value={promptDraft}
                  onChange={(e) => setPromptDraft(e.target.value)}
                  className="w-full rounded-xl bg-[#212121] border border-white/10 px-3 py-2 text-[12px] text-white focus:outline-none focus:border-white/30"
                />
              </div>

              <div className="rounded-xl bg-[#212121] border border-white/[0.06] p-3 space-y-2 text-[11.5px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#8E8E93]">Modelo ativo</span>
                  <span className="text-white font-mono text-[11px] truncate max-w-[165px]">
                    {agente.modelo_padrao}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#8E8E93]">Habilidade (SKILL.md)</span>
                  <span className="text-[#31CF76] font-mono text-[11px]">
                    {String((agente.config as Record<string, unknown>)?.skill_slug ?? agente.agente_id)}
                  </span>
                </div>
                {Array.isArray((agente.config as Record<string, unknown>)?.ferramentas) && (
                  <div className="pt-1 border-t border-white/[0.05]">
                    <span className="text-[#8E8E93] block mb-1">Ferramentas nativas</span>
                    <div className="flex flex-wrap gap-1">
                      {((agente.config as Record<string, unknown>).ferramentas as string[]).map((tool) => (
                        <span
                          key={tool}
                          className="px-1.5 py-0.5 rounded bg-white/[0.06] text-[#DCDCDC] font-mono text-[10px]"
                        >
                          {tool}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="openbot-btn-primary flex-1 py-2 text-[12.5px]"
                >
                  {saving ? "Salvando..." : "Salvar configurações"}
                </button>
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
                    className="openbot-btn-secondary px-3 py-2 text-[12px]"
                  >
                    Restaurar
                  </button>
                )}
              </div>
            </form>

            {/* Memória persistente no SQLite */}
            <div className="pt-4 border-t border-white/[0.06] space-y-2.5">
              <div className="text-[12px] font-semibold text-white flex items-center gap-1.5">
                <Brain className="h-3.5 w-3.5 text-[#38bdf8]" />
                <span>Memória Persistente ({memories.length})</span>
              </div>
              <div className="flex gap-1.5">
                <input
                  id="inspector-new-memory"
                  name="new_memory"
                  aria-label="Adicionar memória permanente do agente"
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
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {memories.map((m) => (
                  <div
                    key={m.memoria_id}
                    className="rounded-lg bg-[#212121] border border-white/[0.05] px-2.5 py-2 text-[11.5px] text-[#DCDCDC]"
                  >
                    {m.texto}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
