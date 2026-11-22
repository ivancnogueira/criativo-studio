import type {
  AgentAllowedFolder,
  AgentNotificationLevel,
  AgenteRegistro,
  AgenteThreadRegistro,
  ArquivoStudio,
  AvatarShape,
  AvatarStyle,
  BackupModelsConfig,
  BrowserProfileInfo,
  BrowserProfileProxyPayload,
  BrowserProxyConfig,
  CanalEquipe,
  CanalMemoria,
  CanalNavegadorModo,
  NivelEsforco,
  PermissionLevel,
  ProvedorStatusInfo,
  TarefaRegistro,
} from "@criativo/contracts";
import type { CarbonSelectOption } from "../../components/ui/CarbonControls";

export type InspectorSubView =
  | "hub"
  | "config"
  | "channel_config"
  | "channel_memories"
  | "channel_routines"
  | "preview"
  | "files"
  | "routines"
  | "backup_models"
  | "browser_profiles"
  | "subconversations"
  | "folders"
  | "instructions"
  | "memories"
  | "advanced";

export interface RightInspectorPanelProps {
  open: boolean;
  widthPx?: number;
  initialSubView?: InspectorSubView;
  agente: AgenteRegistro | null;
  canal?: CanalEquipe | null;
  allAgentes?: AgenteRegistro[];
  arquivos: ArquivoStudio[];
  canais?: CanalEquipe[];
  threads?: AgenteThreadRegistro[];
  activeThreadId?: string | null;
  skillsCount?: number;
  tablesCount?: number;
  routineCount?: number;
  channelRoutineCount?: number;
  routineFocusSignal?: {
    subView?: InspectorSubView;
    rotinaId?: string | null;
    nonce: number;
  } | null;
  previewTarefa: TarefaRegistro | null;
  provedores?: ProvedorStatusInfo[];
  browserProfiles?: BrowserProfileInfo[];
  browserProxies?: BrowserProxyConfig[];
  activeBrowserTabsCount?: number;
  userBrowsingStepsCount?: number;
  onClose: () => void;
  onOpenFilesPage: () => void;
  onOpenUsagePage?: () => void;
  onOpenStorePage?: () => void;
  onOpenTablesModal?: () => void;
  onSelectThread?: (threadId: string | null) => void;
  onCreateSubconversation?: () => void;
  onClearChatHistory?: (agenteId: string) => Promise<void>;
  onDeleteFile?: (arquivoId: string) => Promise<void>;
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
      avatar_style?: AvatarStyle;
      avatar_variant?: string;
      avatar_image_url?: string | null;
      chat_color?: string | null;
      allowed_folders?: AgentAllowedFolder[];
      auto_memory_enabled?: boolean;
      effort?: NivelEsforco;
      backup_models?: BackupModelsConfig;
      permission_level?: PermissionLevel;
      allow_new_chat?: boolean;
      allow_quick_ack?: boolean;
      browser_profile_id?: string | null;
      notification_level?: AgentNotificationLevel;
    }
  ) => Promise<void>;
  onRestoreAgentDefaults?: (agenteId: string) => Promise<void>;
  onAddMemory?: (agenteId: string, texto: string) => Promise<void>;
  onLoadMemories?: (
    agenteId: string
  ) => Promise<Array<{ memoria_id: string; texto: string; criado_em: string }>>;
  onApproveTask: (tarefaId: string) => Promise<void>;
  onRequestRevision: (tarefa: TarefaRegistro) => Promise<void>;
  onCreateBrowserProfile?: (input: { nome: string; cor_hex?: string }) => Promise<void>;
  onUpdateBrowserProfile?: (
    perfilId: string,
    patch: { nome?: string; cor_hex?: string; proxy_json?: BrowserProfileProxyPayload | null }
  ) => Promise<void>;
  onClearBrowserProfile?: (perfilId: string) => Promise<void>;
  onDeleteBrowserProfile?: (perfilId: string) => Promise<void>;
  onSaveBrowserProxy?: (input: {
    nome: string;
    servidor: string;
    usuario?: string | null;
    senha?: string | null;
  }) => Promise<BrowserProxyConfig>;
  onDeleteBrowserProxy?: (proxyId: string) => Promise<void>;
  onOpenAgentBrowserTakeover?: (agenteId: string) => void | Promise<void>;
  onInspectAgentBrowsingLog?: (agenteId: string) => void | Promise<void>;
  onSaveChannelSettings?: (
    canalId: string,
    patch: {
      nome?: string;
      descricao?: string;
      instrucoes?: string;
      membros_agentes?: string[];
      lider_agente_id?: string | null;
      navegador_modo?: CanalNavegadorModo;
      manter_memorias?: boolean;
    }
  ) => Promise<void>;
  onDeleteChannel?: (canalId: string) => Promise<void>;
  onNewChannelConversation?: (canalId: string) => Promise<void>;
  onCompactChannelContext?: (canalId: string) => Promise<void>;
  onClearChannelHistory?: (canalId: string) => Promise<void>;
  onLoadChannelMemories?: (canalId: string) => Promise<CanalMemoria[]>;
  onAddChannelMemory?: (canalId: string, texto: string) => Promise<CanalMemoria[]>;
  onDeleteChannelMemory?: (canalId: string, memoriaId: string) => Promise<void>;
}

export const CHANNEL_BROWSER_OPTIONS: readonly CarbonSelectOption<CanalNavegadorModo>[] = [
  {
    value: "all",
    label: "Todos os membros",
    description: "Qualquer especialista da equipe pode usar o navegador",
  },
  {
    value: "leader",
    label: "Apenas o líder",
    description: "Somente o líder/coordenador da equipe aciona o navegador",
  },
  {
    value: "none",
    label: "Desativado",
    description: "Nenhum membro usa o navegador neste canal",
  },
];

export const PERMISSION_RANK: Record<PermissionLevel, number> = {
  workspace: 0,
  ask: 1,
  full: 2,
};

export const PERMISSION_OPTIONS: readonly CarbonSelectOption<PermissionLevel>[] = [
  {
    value: "workspace",
    label: "Apenas workspace",
    description: "Restrito a recursos/, saidas/, previas/ e Pastas Autorizadas",
  },
  {
    value: "ask",
    label: "Perguntar fora do workspace",
    description: "Solicita aprovação antes de gravar fora das pastas padrão",
  },
  {
    value: "full",
    label: "Acesso completo",
    description: "Permite operar todo o workspace do projeto sem barreira extra",
  },
];

export const FOLDER_MODE_OPTIONS: readonly CarbonSelectOption<"read_write" | "read">[] = [
  {
    value: "read_write",
    label: "Leitura e escrita",
    description: "Agente pode ler e criar/editar arquivos dentro desta pasta",
  },
  {
    value: "read",
    label: "Somente leitura",
    description: "Agente apenas consulta arquivos desta pasta",
  },
];

export function formatTotalBytes(arquivos: ArquivoStudio[]): string {
  const bytes = arquivos.reduce((acc, a) => acc + (a.tamanho_bytes ?? 0), 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

