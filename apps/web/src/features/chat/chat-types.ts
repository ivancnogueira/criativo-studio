import type {
  AgenteEspera,
  AgenteRegistro,
  AgenteThreadBranch,
  AgenteThreadRegistro,
  AnexoChat,
  ArquivoStudio,
  BackupModelChoice,
  BrowserSecretRequest,
  BrowserTakeoverReason,
  CanalEquipe,
  FilaChatEntrega,
  FilaChatSnapshot,
  MensagemChat,
  MensagemFixada,
  NivelEsforco,
  PassoChat,
  ProvedorStatusInfo,
  UiBlockSubmitPayload,
  UsageLimitAskPayload,
} from "@criativo/contracts";
import type { MarketplaceAppSuggestionItem, McpSignInCardState } from "./McpSignInChatCard";

export interface ChatLiveRunState {
  agenteId: string | null;
  agenteNome: string;
  startedAt: number;
  statusText: string;
  steps: PassoChat[];
  streamingText: string;
}

export interface AgentConversationViewProps {
  mode: "agent" | "channel";
  agente?: AgenteRegistro | null;
  canal?: CanalEquipe | null;
  allAgentes?: AgenteRegistro[];
  arquivos?: ArquivoStudio[];
  mensagens: MensagemChat[];
  provedores: ProvedorStatusInfo[];
  sending: boolean;
  liveRun?: ChatLiveRunState | null;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
  onOpenChannelSettings?: () => void;
  onSendMessage: (conteudo: string, anexos: AnexoChat[], pageContext?: string | null) => Promise<void>;
  onUploadFile: (file: File) => Promise<AnexoChat>;
  onUpdateModelAndEffort: (modelo: string, effort: NivelEsforco) => Promise<void>;
  onOpenConnectors?: () => void;
  pendingMcpSignIn?: McpSignInCardState | null;
  suggestedApps?: MarketplaceAppSuggestionItem[];
  onAuthenticateMcp?: (mcpId: string) => void;
  onOpenStoreApp?: (appSlug: string) => void;
  onRetryMcpContinue?: (mcpId: string) => void;
  prefilledDraft?: string | null;
  // Fase 13 — Threads, Branch, Esperas, Fila, Paginação, Pins, Reset & Pergunta Lateral
  threads?: AgenteThreadRegistro[];
  activeThread?: AgenteThreadRegistro | null;
  onSelectThread?: (threadId: string | null) => void;
  onCreateQuickThread?: () => void;
  onDismissThreadTab?: (threadId: string) => void;
  hideInlineThreadTabs?: boolean;
  pagination?: {
    has_older: boolean;
    older_count?: number;
    has_newer?: boolean;
    loading_older?: boolean;
  };
  highlightedMessageId?: string | null;
  onLoadOlderMessages?: () => Promise<void>;
  onJumpToLatest?: () => Promise<void>;
  onJumpToMessage?: (threadId: string, mensagemId: string) => Promise<void>;
  onNavigateBranchOrigin?: (branch: AgenteThreadBranch) => Promise<void>;
  esperas?: AgenteEspera[];
  filaSnapshot?: FilaChatSnapshot | null;
  editingQueueItem?: FilaChatEntrega | null;
  onCloseWait?: (esperaId: string) => Promise<void>;
  onBeginEditQueueItem?: (entrega: FilaChatEntrega) => Promise<void>;
  onSaveEditQueueItem?: (entregaId: string, conteudo: string, anexos: AnexoChat[]) => Promise<void>;
  onDiscardEditQueueItem?: (entregaId: string) => Promise<void>;
  onCancelOrDeleteQueueItem?: (entregaId: string, deleteAfter?: boolean) => Promise<void>;
  onReorderQueue?: (ids: string[]) => Promise<void>;
  onSteerQueueItem?: (entregaId: string) => Promise<void>;
  onMoveQueueItemToTask?: (entregaId: string) => Promise<void>;
  onInterruptTurn?: () => Promise<void>;
  pins?: MensagemFixada[];
  onBranchFromMessage?: (mensagemId: string) => Promise<void>;
  onTogglePinMessage?: (mensagem: MensagemChat, pinned: boolean) => Promise<void>;
  onAskSideQuestion?: (
    pergunta: string,
    historico: Array<{ pergunta: string; resposta: string }>
  ) => Promise<string>;
  onStartNewChat?: () => Promise<void>;
  // Fase 14 — Generative UI, UI Blocks, Sugestões de Habilidade, Tabelas SQL & Previews Ricos
  onSubmitUiBlock?: (payload: UiBlockSubmitPayload) => Promise<void>;
  onSaveSkillSuggestion?: (mensagemId: string) => Promise<void>;
  onDismissSkillSuggestion?: (mensagemId: string) => Promise<void>;
  onOpenSharedTables?: () => void;
  onOpenFilePreview?: (anexo: AnexoChat) => void;
  onOpenImageLightbox?: (url: string, alt?: string) => void;
  // Fase 15 — Navegador CDP, Segredos, Captura de Tela, Backup Models, Atalho & Voz Contínua
  takeoverSession?: {
    takeoverId: string;
    tabId: string;
    reason: BrowserTakeoverReason;
    url: string;
    title: string;
    previewDataUrl?: string | null;
  } | null;
  secretRequest?: BrowserSecretRequest | null;
  captureRequest?: {
    captureId: string;
    purpose: string;
    targetHint?: string;
  } | null;
  usageLimitAsk?: UsageLimitAskPayload | null;
  sendShortcut?: "enter" | "mod_enter";
  compactActions?: boolean;
  showAgentSteps?: boolean;
  userBubbleColor?: string;
  solidBubbles?: boolean;
  onClearHistory?: () => Promise<void>;
  liveVoiceEnabled?: boolean;
  liveVoiceActive?: boolean;
  onOpenTakeover?: (tabId: string) => void;
  onCancelTakeover?: (tabId: string) => Promise<void> | void;
  onSubmitSecret?: (
    tabId: string,
    payload: { username?: string; secret: string; saveToVault?: boolean; loginLabel?: string }
  ) => Promise<void> | void;
  onAuthorizeScreenCapture?: (
    captureId: string,
    payload: { dataUrl: string; width: number; height: number }
  ) => Promise<void> | void;
  onDeclineScreenCapture?: (captureId: string, reason?: string) => Promise<void> | void;
  onResolveUsageLimit?: (payload: {
    askId: string;
    choice?: BackupModelChoice;
    remember?: boolean;
    action: "switch" | "wait";
  }) => Promise<void> | void;
  onToggleLiveVoice?: () => void;
}

export const EFFORT_LABELS: Record<NivelEsforco, string> = {
  baixo: "Baixo",
  medio: "Médio",
  alto: "Alto",
};

