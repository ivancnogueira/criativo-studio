import type {
  AgenteRegistro,
  CanalEquipe,
  DeletedNativeAgentInfo,
  SidebarLayoutMutation,
  SidebarLayoutSnapshot,
  StatusMensageria,
  UpdateStatusSnapshot,
} from "@criativo/contracts";
import {
  resolveAgentAvatarConfig,
  type AvatarTaskContext,
  type MascotEyeMood,
} from "../MascoteAvatar";

export interface SidebarProps {
  agentes: Array<
    AgenteRegistro & {
      nao_lidas?: number;
      ultima_mensagem?: string | null;
      ultima_mensagem_em?: string | null;
    }
  >;
  canais?: CanalEquipe[];
  deletedNativeAgents?: DeletedNativeAgentInfo[];
  selectedAgentId: string | null;
  selectedChannelId?: string | null;
  onSelectAgent: (agenteId: string) => void;
  onSelectChannel?: (canalId: string) => void;
  onChangeModel?: (agenteId: string, modelo: string) => void;
  onCreateAgent?: () => void;
  onCreateChannel?: () => void;
  whatsappStatus?: StatusMensageria;
  onOpenWhatsAppModal?: () => void;
  viewMode?: "agents" | "routines";
  onChangeViewMode?: (mode: "agents" | "routines") => void;
  showModeTabs?: boolean;
  routineCountsByAgent?: Record<string, number>;
  // Fase 15 — Diretórios aninhados, Fixados, Ocultos, D&D e Duplicação
  sidebarLayout?: SidebarLayoutSnapshot | null;
  sortMode?: "custom" | "alphabetical" | "recent";
  onMutateSidebar?: (mutation: SidebarLayoutMutation) => Promise<void> | void;
  onDuplicateAgent?: (agentId: string) => Promise<void> | void;
  onReorderPins?: (pins: string[]) => Promise<void> | void;
  onRestoreDeletedAgent?: (agentId: string) => Promise<void> | void;
  onRestoreAllDeletedAgents?: () => Promise<void> | void;
  onToggleUnreadAgent?: (agentId: string, markUnread: boolean) => Promise<void> | void;
  onToggleMuteAgent?: (agentId: string, nextLevel: "all" | "muted") => Promise<void> | void;
  onNewSubconversation?: (agentId: string) => Promise<void> | void;
  onOpenAgentNewWindow?: (agentId: string) => Promise<void> | void;
  onEditAgent?: (agentId: string) => void;
  onDeleteAgent?: (agentId: string) => Promise<void> | void;
  onEditChannel?: (canalId: string) => void;
  onDeleteChannel?: (canalId: string) => Promise<void> | void;
  updateStatus?: UpdateStatusSnapshot | null;
  onApplyUpdate?: () => void;
  onOpenUpdateSettings?: () => void;
  widthPx?: number;
  workingAgentIds?: Set<string> | ReadonlyArray<string>;
  agentActivityByAgentId?: Record<
    string,
    { mood?: MascotEyeMood; activity?: AvatarTaskContext | null }
  >;
  onDismissSetupAssistant?: () => Promise<void> | void;
  onDismissVpsAssistant?: () => Promise<void> | void;
}

export function getAgentVisual(ag: AgenteRegistro) {
  return resolveAgentAvatarConfig(ag);
}

export function formatHour(iso?: string | null): string {
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

export function stripMarkdownPreview(text?: string | null): string {
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
