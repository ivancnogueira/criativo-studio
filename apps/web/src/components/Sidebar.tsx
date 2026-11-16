import React, { useMemo, useState } from "react";
import type {
  AgenteRegistro,
  AvatarShape,
  CanalEquipe,
  StatusMensageria,
} from "@criativo/contracts";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Search,
  Smartphone,
  Sparkles,
  Users,
} from "lucide-react";
import {
  ChannelMascoteCluster,
  getDefaultMascotForAgent,
  MascoteAvatar,
} from "./MascoteAvatar";

export interface SidebarProps {
  agentes: Array<
    AgenteRegistro & {
      nao_lidas?: number;
      ultima_mensagem?: string | null;
      ultima_mensagem_em?: string | null;
    }
  >;
  canais?: CanalEquipe[];
  selectedAgentId: string | null;
  selectedChannelId?: string | null;
  onSelectAgent: (agenteId: string) => void;
  onSelectChannel?: (canalId: string) => void;
  onChangeModel?: (agenteId: string, modelo: string) => void;
  onCreateAgent?: () => void;
  onCreateChannel?: () => void;
  whatsappStatus?: StatusMensageria;
  onOpenWhatsAppModal?: () => void;
}

function getAgentVisual(ag: AgenteRegistro): { shape: AvatarShape; color: string } {
  const cfg = (ag.config ?? {}) as Record<string, unknown>;
  const fallback = getDefaultMascotForAgent(ag.agente_id);
  return {
    shape: (typeof cfg.avatar_shape === "string" ? cfg.avatar_shape : fallback.shape) as AvatarShape,
    color: typeof cfg.avatar_color === "string" ? cfg.avatar_color : fallback.color,
  };
}

function formatHour(iso?: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function stripMarkdownPreview(text?: string | null): string {
  if (!text) return "";
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*_]{3,}\s*$/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(^|\s)_([^_]+)_(\s|$)/g, "$1$2$3")
    .replace(/^>\s?/gm, "")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Barra lateral estilo OpenBot (`~265px`) com busca, pastas colapsáveis, Canais em Equipe,
 * badges #74B9FF em Não lidas e card inferior 'Criativo no WhatsApp'.
 */
export const Sidebar: React.FC<SidebarProps> = ({
  agentes,
  canais = [],
  selectedAgentId,
  selectedChannelId = null,
  onSelectAgent,
  onSelectChannel,
  onCreateAgent,
  onCreateChannel,
  whatsappStatus = "desconectado",
  onOpenWhatsAppModal,
}) => {
  const [search, setSearch] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [dismissWhatsAppCard, setDismissWhatsAppCard] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});

  const toggleFolder = (key: string) => {
    setCollapsedFolders((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const filteredAgents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return agentes;
    return agentes.filter(
      (a) =>
        a.nome.toLowerCase().includes(q) ||
        a.papel.toLowerCase().includes(q) ||
        a.modelo_padrao.toLowerCase().includes(q)
    );
  }, [agentes, search]);

  const filteredChannels = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return canais;
    return canais.filter(
      (c) =>
        c.nome.toLowerCase().includes(q) ||
        c.descricao.toLowerCase().includes(q)
    );
  }, [canais, search]);

  const unreadAgents = useMemo(
    () => filteredAgents.filter((a) => (a.nao_lidas ?? 0) > 0),
    [filteredAgents]
  );

  const folders = useMemo(() => {
    const groups = [
      {
        key: "conteudo",
        label: "Conteúdo Base",
        items: filteredAgents.filter(
          (a) => a.frente === "conteudo" || (a.config as Record<string, unknown>)?.frente === "conteudo"
        ),
      },
      {
        key: "bonus",
        label: "Agentes Bônus",
        items: filteredAgents.filter(
          (a) => a.frente === "bonus" || (a.config as Record<string, unknown>)?.frente === "bonus"
        ),
      },
      {
        key: "video",
        label: "Estúdio de Vídeo",
        items: filteredAgents.filter(
          (a) => a.frente === "video" || (a.config as Record<string, unknown>)?.frente === "video"
        ),
      },
      {
        key: "custom",
        label: "Customizados",
        items: filteredAgents.filter(
          (a) =>
            a.frente === "custom" ||
            (a.config as Record<string, unknown>)?.customizado === true ||
            (a.config as Record<string, unknown>)?.frente === "custom"
        ),
      },
    ];
    return groups.filter((g) => g.items.length > 0);
  }, [filteredAgents]);

  const renderAgentRow = (
    ag: SidebarProps["agentes"][number],
    keyPrefix: string,
    showUnreadBadge = false
  ) => {
    const vis = getAgentVisual(ag);
    const selected = selectedAgentId === ag.agente_id && !selectedChannelId;
    const isWorking = ag.status === "trabalhando";
    const timeLabel = formatHour(ag.ultima_mensagem_em);
    return (
      <button
        key={`${keyPrefix}${ag.agente_id}`}
        type="button"
        onClick={() => onSelectAgent(ag.agente_id)}
        className={`w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-left transition-colors ${
          selected ? "bg-[#252527]" : "hover:bg-[#202022]"
        }`}
      >
        <div className="relative shrink-0">
          <MascoteAvatar
            shape={vis.shape}
            color={vis.color}
            size={38}
            animated={isWorking}
            mood={isWorking ? "working" : (ag.nao_lidas ?? 0) > 0 ? "waiting" : "idle"}
          />
          {showUnreadBadge && (ag.nao_lidas ?? 0) > 0 && (
            <span className="absolute -bottom-0.5 -right-0.5 h-4 min-w-[16px] px-1 rounded-full bg-[#74B9FF] text-[#0D0D0D] text-[10px] font-bold flex items-center justify-center ring-2 ring-[#1A1A1A]">
              {ag.nao_lidas}
            </span>
          )}
          {!showUnreadBadge && isWorking && (
            <span
              title="Trabalhando agora"
              className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-[#31CF76] ring-2 ring-[#1A1A1A] animate-pulse"
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13.5px] font-medium text-white truncate">
              {ag.nome}
            </span>
            {timeLabel && (
              <span className="text-[11px] text-[#737378] tabular-nums shrink-0">
                {timeLabel}
              </span>
            )}
          </div>
          <p className="text-[12px] text-[#8E8E93] truncate mt-0.5">
            {stripMarkdownPreview(ag.ultima_mensagem) || ag.papel}
          </p>
        </div>
      </button>
    );
  };

  return (
    <aside
      aria-label={`Roster (${agentes.length} Agentes)`}
      className="w-[276px] shrink-0 bg-[#1A1A1A] border-r border-white/[0.06] flex flex-col h-full overflow-hidden select-none"
    >
      {/* Cabeçalho: Busca + botão '+' */}
      <div className="p-2.5 flex items-center gap-2 relative">
        <div className="relative flex-1">
          <Search className="h-3.5 w-3.5 text-[#6A6A6A] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            id="sidebar-search-agents"
            name="sidebar_search"
            aria-label="Buscar agentes e canais"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar"
            className="w-full h-[32px] rounded-xl bg-[#242424] border border-white/[0.05] pl-8 pr-3 text-[12.5px] text-white placeholder-[#6A6A6A] focus:outline-none focus:border-white/20"
          />
        </div>

        <button
          type="button"
          onClick={() => (onCreateChannel || onCreateAgent ? setMenuOpen((o) => !o) : undefined)}
          title="Novo agente ou canal"
          aria-label="Criar novo agente ou canal"
          className="h-[32px] w-[32px] rounded-xl flex items-center justify-center text-[#979797] hover:text-white hover:bg-[#242424] transition-colors shrink-0"
        >
          <Plus className="h-4 w-4" />
        </button>

        {menuOpen && (
          <div className="absolute right-2.5 top-12 z-40 w-48 rounded-xl bg-[#242424] border border-white/10 shadow-[0_14px_35px_rgba(0,0,0,0.65)] p-1">
            {onCreateAgent && (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onCreateAgent();
                }}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-[12px] text-white hover:bg-white/[0.06] text-left"
              >
                <Sparkles className="h-3.5 w-3.5 text-[#38bdf8]" />
                <span>Novo agente IA</span>
              </button>
            )}
            {onCreateChannel && (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onCreateChannel();
                }}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-[12px] text-white hover:bg-white/[0.06] text-left"
              >
                <Users className="h-3.5 w-3.5 text-[#31cf76]" />
                <span>Novo canal em equipe</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Lista rolável por seções e pastas */}
      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-3">
        {unreadAgents.length > 0 && (
          <div>
            <div className="px-2 pb-1 flex items-center justify-between text-[11px] font-medium text-[#7A7A80]">
              <span>Não lidas</span>
              <span>{unreadAgents.length}</span>
            </div>
            <div className="space-y-0.5">
              {unreadAgents.map((ag) => renderAgentRow(ag, "unread-", true))}
            </div>
          </div>
        )}

        {/* Canais em Equipe (Multi-agente) */}
        {filteredChannels.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => toggleFolder("canais")}
              className="w-full px-2 py-1 flex items-center justify-between text-[11px] font-medium text-[#7A7A80] hover:text-white transition-colors"
            >
              <span className="flex items-center gap-1.5">
                {collapsedFolders.canais ? (
                  <ChevronRight className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
                Canais em Equipe
              </span>
            </button>

            {!collapsedFolders.canais && (
              <div className="mt-1 space-y-0.5">
                {filteredChannels.map((canal) => {
                  const selected = selectedChannelId === canal.canal_id;
                  const members = canal.membros_agentes.map((id) => {
                    const match = agentes.find((a) => a.agente_id === id);
                    const vis = match ? getAgentVisual(match) : getDefaultMascotForAgent(id);
                    return { agente_id: id, shape: vis.shape, color: vis.color };
                  });
                  return (
                    <button
                      key={canal.canal_id}
                      type="button"
                      onClick={() => onSelectChannel?.(canal.canal_id)}
                      className={`w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-left transition-colors ${
                        selected ? "bg-[#252527]" : "hover:bg-[#202022]"
                      }`}
                    >
                      <ChannelMascoteCluster members={members} size={38} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[13.5px] font-medium text-white truncate">
                            {canal.nome}
                          </span>
                          <span className="text-[11px] text-[#737378] tabular-nums shrink-0">
                            {canal.membros_agentes.length} agentes
                          </span>
                        </div>
                        <p className="text-[12px] text-[#8E8E93] truncate mt-0.5">
                          {stripMarkdownPreview(canal.ultima_mensagem) || canal.descricao}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Pastas de Especialistas (15 agentes + customizados) */}
        {folders.map((folder) => {
          const isCollapsed = Boolean(collapsedFolders[folder.key]);
          return (
            <div key={folder.key}>
              <button
                type="button"
                onClick={() => toggleFolder(folder.key)}
                className="w-full px-2 py-1 flex items-center justify-between text-[11px] font-medium text-[#7A7A80] hover:text-white transition-colors"
              >
                <span className="flex items-center gap-1.5">
                  {isCollapsed ? (
                    <ChevronRight className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                  {folder.label}
                </span>
              </button>

              {!isCollapsed && (
                <div className="mt-1 space-y-0.5">
                  {folder.items.map((ag) => renderAgentRow(ag, ""))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Card fixo inferior estilo 'OpenBot para celular' (Screenshot 3) adaptado para WhatsApp */}
      {!dismissWhatsAppCard && (
        <div className="p-2.5 border-t border-white/[0.06]">
          <div className="relative rounded-xl bg-[#212121] border border-white/[0.07] p-3">
            <button
              type="button"
              onClick={() => setDismissWhatsAppCard(true)}
              aria-label="Fechar aviso WhatsApp"
              className="absolute top-2 right-2 text-[#6A6A6A] hover:text-white text-[12px] leading-none"
            >
              ×
            </button>
            <div className="flex items-center gap-2 text-[12.5px] font-medium text-white mb-1">
              <Smartphone className="h-3.5 w-3.5 text-[#31CF76]" />
              <span>Criativo no WhatsApp</span>
            </div>
            <p className="text-[11px] text-[#979797] leading-snug mb-2.5">
              {whatsappStatus === "conectado"
                ? "Conectado ao celular. Aprove artes e peça Reels por áudio."
                : "Pareie seu WhatsApp via QR para enviar áudios e aprovar posts."}
            </p>
            <button
              type="button"
              onClick={onOpenWhatsAppModal}
              className="w-full rounded-lg bg-[#2A2A2A] hover:bg-[#333336] text-white py-1.5 text-[11.5px] font-medium transition-colors"
            >
              {whatsappStatus === "conectado" ? "Gerenciar Pareamento" : "Conectar Agora"}
            </button>
          </div>
        </div>
      )}
    </aside>
  );
};
