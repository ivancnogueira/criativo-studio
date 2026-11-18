import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  AgenteEspera,
  AgenteRegistro,
  AgenteThreadBranch,
  AgenteThreadRegistro,
  AnexoChat,
  AvatarShape,
  CanalEquipe,
  FilaChatEntrega,
  FilaChatSnapshot,
  MensagemChat,
  MensagemFixada,
  NivelEsforco,
  PassoChat,
  ProvedorStatusInfo,
} from "@criativo/contracts";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  CornerUpLeft,
  Download,
  FileText,
  GitBranch,
  Image as ImageIcon,
  Loader2,
  MessageCircleQuestion,
  Mic,
  MoreHorizontal,
  PanelRight,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Send,
  Square,
  Wrench,
  X,
} from "lucide-react";
import {
  ChannelMascoteCluster,
  getDefaultMascotForAgent,
  MascoteAvatar,
} from "../../components/MascoteAvatar";
import {
  inferProviderFromModelId,
  ModelProviderPopover,
} from "../../components/ModelProviderPopover";
import { ProviderLogo } from "../../components/ProviderLogo";
import { AppBrandIcon } from "../../components/ui/CarbonControls";
import { BranchDivider } from "./BranchDivider";
import { OpenWaitsCard } from "./OpenWaitsCard";
import { PinnedMessagesPopover } from "./PinnedMessagesPopover";
import { QueuePanel } from "./QueuePanel";
import { SideQuestionPanel } from "./SideQuestionPanel";
import { ThreadTabsBar } from "./ThreadTabsBar";

export interface McpSignInCardState {
  mcpId: string;
  nome: string;
  appSlug?: string | null;
  status: "pending" | "signing_in" | "connected" | "error";
  errorMessage?: string | null;
}

export interface MarketplaceAppSuggestionItem {
  slug: string;
  name: string;
  tagline: string;
}

export interface McpSignInChatCardProps {
  mcpId: string;
  nome: string;
  appSlug?: string | null;
  status: "pending" | "signing_in" | "connected" | "error";
  errorMessage?: string | null;
  onAuthenticate: (mcpId: string) => void;
  onOpenAppPage?: (appSlug: string) => void;
  onRetryContinue?: (mcpId: string) => void;
}

/**
 * Cartão inline no chat disparado por `mcp.oauth_solicitado` e atualizado por `mcp.oauth_concluido`.
 */
export function McpSignInChatCard({
  mcpId,
  nome,
  appSlug,
  status,
  errorMessage,
  onAuthenticate,
  onOpenAppPage,
  onRetryContinue,
}: McpSignInChatCardProps) {
  const borderClass =
    status === "connected"
      ? "border-[#31CF76]/60"
      : status === "signing_in"
        ? "border-[#007CF7]"
        : status === "error"
          ? "border-[#FD2F3B]/60"
          : "border-[#2A2A2A]";

  return (
    <div
      data-testid={`mcp-signin-card-${mcpId}`}
      className={`max-w-[820px] rounded-[12px] border ${borderClass} bg-[#212121] p-4 flex flex-wrap items-center justify-between gap-4`}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <AppBrandIcon slug={appSlug} name={nome} size={32} kind="mcp" />
        <div className="min-w-0 space-y-0.5">
          {onOpenAppPage && (appSlug || mcpId) ? (
            <button
              type="button"
              onClick={() => onOpenAppPage(appSlug || mcpId)}
              className="text-[14px] font-semibold text-[#42A0FF] hover:underline text-left truncate block"
            >
              {nome}
            </button>
          ) : (
            <p className="text-[14px] font-semibold text-[#42A0FF] truncate">{nome}</p>
          )}
          {status === "error" ? (
            <p className="text-[14px] text-[#FD2F3B]">
              {errorMessage || "Autenticação recusada ou expirada no navegador."}
            </p>
          ) : status === "connected" ? (
            <p className="text-[14px] text-[#31CF76] font-semibold">
              Conectado — Ferramentas liberadas para o agente continuar.
            </p>
          ) : (
            <p className="text-[14px] text-[#DCDCDC]">
              Conecte sua conta para liberar as ferramentas solicitadas nesta conversa.
            </p>
          )}
        </div>
      </div>

      <div className="shrink-0 flex items-center gap-2">
        {status === "connected" ? (
          onRetryContinue ? (
            <button
              type="button"
              onClick={() => onRetryContinue(mcpId)}
              className="rounded-full border border-[#31CF76]/50 bg-[#31CF76]/15 px-4 py-1.5 text-[14px] font-semibold text-[#31CF76] hover:bg-[#31CF76]/25"
            >
              Continuar execução
            </button>
          ) : (
            <span className="rounded-full bg-[#31CF76]/20 px-3 py-1 text-[12px] font-semibold text-[#31CF76]">
              Conectado
            </span>
          )
        ) : status === "signing_in" ? (
          <button
            type="button"
            disabled
            className="inline-flex items-center gap-2 rounded-full border border-[#007CF7]/60 bg-[#007CF7]/15 px-4 py-1.5 text-[14px] font-semibold text-[#F0F0F0]"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#007CF7]" />
            Aguardando autenticação...
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onAuthenticate(mcpId)}
            className="rounded-full bg-[#F0F0F0] px-4 py-1.5 text-[14px] font-semibold text-[#141414] hover:bg-white"
          >
            {status === "error" ? "Tentar novamente — Autenticar no navegador" : "Autenticar no navegador"}
          </button>
        )}
      </div>
    </div>
  );
}

export interface ChatLiveRunState {
  agenteId: string | null;
  agenteNome: string;
  startedAt: number;
  statusText: string;
  steps: PassoChat[];
  streamingText: string;
}

interface AgentConversationViewProps {
  mode: "agent" | "channel";
  agente?: AgenteRegistro | null;
  canal?: CanalEquipe | null;
  allAgentes?: AgenteRegistro[];
  mensagens: MensagemChat[];
  provedores: ProvedorStatusInfo[];
  sending: boolean;
  liveRun?: ChatLiveRunState | null;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
  onSendMessage: (conteudo: string, anexos: AnexoChat[]) => Promise<void>;
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
}

const EFFORT_LABELS: Record<NivelEsforco, string> = {
  baixo: "Baixo",
  medio: "Médio",
  alto: "Alto",
};

function formatElapsedClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m} min ${rem} s` : `${m} min`;
}

interface ParsedBlock {
  type: "markdown" | "table" | "code";
  content: string;
  headers?: string[];
  rows?: string[][];
  language?: string;
}

function splitMarkdownBlocks(text: string): ParsedBlock[] {
  const lines = text.split(/\r?\n/);
  const blocks: ParsedBlock[] = [];
  let textAcc: string[] = [];
  let i = 0;

  const flushText = () => {
    const trimmed = textAcc.join("\n").trim();
    if (trimmed) {
      blocks.push({ type: "markdown", content: trimmed });
    }
    textAcc = [];
  };

  while (i < lines.length) {
    const cur = lines[i];
    const trimmedCur = cur.trim();

    if (trimmedCur.startsWith("```")) {
      flushText();
      const lang = trimmedCur.slice(3).trim();
      i += 1;
      const codeLines: string[] = [];
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length && lines[i].trim().startsWith("```")) {
        i += 1;
      }
      blocks.push({
        type: "code",
        language: lang || "texto",
        content: codeLines.join("\n"),
      });
      continue;
    }

    const next = lines[i + 1] ?? "";
    const isTableStart =
      trimmedCur.startsWith("|") &&
      next.trim().startsWith("|") &&
      /^\|[\s:|-]+\|?$/.test(next.trim());

    if (isTableStart) {
      flushText();
      const rawTable: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rawTable.push(lines[i].trim());
        i += 1;
      }
      const parseRow = (line: string) =>
        line
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim());

      const headers = parseRow(rawTable[0] ?? "");
      const rows = rawTable.slice(2).map(parseRow);
      blocks.push({
        type: "table",
        content: rawTable.join("\n"),
        headers,
        rows,
      });
    } else {
      textAcc.push(cur);
      i += 1;
    }
  }
  flushText();
  return blocks;
}

function toCsv(headers: string[], rows: string[][]): string {
  const esc = (cell: string) => `"${cell.replace(/"/g, '""')}"`;
  return [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
}

function renderInlineMarkdown(text: string, depth = 0): React.ReactNode[] {
  const parts = text.split(
    /(\*\*[^*]+?\*\*|__[^_]+?__|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|~~[^~]+?~~|\*[^*\s][^*]*?\*|(?<![A-Za-z0-9_])_[^_\s][^_]*?_(?![A-Za-z0-9_]))/g
  );
  return parts.map((part, idx) => {
    if (
      ((part.startsWith("**") && part.endsWith("**")) ||
        (part.startsWith("__") && part.endsWith("__"))) &&
      part.length > 4
    ) {
      return (
        <strong key={idx} className="font-semibold text-white">
          {depth < 3 ? renderInlineMarkdown(part.slice(2, -2), depth + 1) : part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={idx}
          className="rounded bg-[#2A2A2A] border border-white/10 px-1.5 py-0.5 font-terminal text-[12px] text-[#74B9FF]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("[") && part.includes("](") && part.endsWith(")")) {
      const linkMatch = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
      if (linkMatch) {
        return (
          <a
            key={idx}
            href={linkMatch[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#42A0FF] underline underline-offset-2 hover:text-[#74B9FF]"
          >
            {linkMatch[1]}
          </a>
        );
      }
    }
    if (part.startsWith("~~") && part.endsWith("~~") && part.length > 4) {
      return (
        <del key={idx} className="line-through text-[#888888]">
          {depth < 3 ? renderInlineMarkdown(part.slice(2, -2), depth + 1) : part.slice(2, -2)}
        </del>
      );
    }
    if (
      ((part.startsWith("*") && part.endsWith("*")) ||
        (part.startsWith("_") && part.endsWith("_"))) &&
      part.length > 2
    ) {
      return (
        <em key={idx} className="italic text-[#B5B5B5]">
          {depth < 3 ? renderInlineMarkdown(part.slice(1, -1), depth + 1) : part.slice(1, -1)}
        </em>
      );
    }
    return part;
  });
}

function renderFormattedMarkdownText(content: string): React.ReactNode {
  const lines = content.split(/\r?\n/);
  return (
    <div className="space-y-2">
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={idx} className="h-1" />;

        // Separador horizontal --- / *** / ___
        if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
          return <hr key={idx} className="border-0 border-t border-white/10 my-2.5" />;
        }

        // Títulos Markdown (#, ##, ###, ####)
        const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
        if (headingMatch) {
          const level = headingMatch[1].length;
          const inner = renderInlineMarkdown(headingMatch[2]);
          if (level === 1) {
            return (
              <h1 key={idx} className="text-[17px] font-bold text-white pt-1.5 leading-snug">
                {inner}
              </h1>
            );
          }
          if (level === 2) {
            return (
              <h2 key={idx} className="text-[15.5px] font-bold text-white pt-1.5 leading-snug">
                {inner}
              </h2>
            );
          }
          if (level === 3) {
            return (
              <h3 key={idx} className="text-[14px] font-semibold text-white pt-1 leading-snug">
                {inner}
              </h3>
            );
          }
          return (
            <h4 key={idx} className="text-[13px] font-semibold text-[#E8E8E8] pt-0.5 leading-snug">
              {inner}
            </h4>
          );
        }

        if (trimmed.startsWith("> ")) {
          return (
            <blockquote
              key={idx}
              className="border-l-2 border-[#42A0FF]/70 pl-3 py-0.5 text-[#DCDCDC] italic bg-white/[0.02] rounded-r-lg"
            >
              {renderInlineMarkdown(trimmed.slice(2))}
            </blockquote>
          );
        }

        // Lista numerada (1. item)
        const orderedMatch = line.match(/^(\s*)(\d+\.)\s+(.+)$/);
        if (orderedMatch) {
          const indentLevel = Math.min(2, Math.floor(orderedMatch[1].length / 2));
          return (
            <div
              key={idx}
              style={{ paddingLeft: `${indentLevel * 14 + 4}px` }}
              className="flex items-start gap-2"
            >
              <span className="text-[#8E8E8E] font-medium shrink-0 tabular-nums">
                {orderedMatch[2]}
              </span>
              <span className="flex-1 min-w-0 break-words">
                {renderInlineMarkdown(orderedMatch[3])}
              </span>
            </div>
          );
        }

        // Lista com marcadores (- ou *) inclusive aninhada
        const bulletMatch = line.match(/^(\s*)[-*]\s+(.+)$/);
        if (bulletMatch) {
          const indentLevel = Math.min(2, Math.floor(bulletMatch[1].length / 2));
          return (
            <div
              key={idx}
              style={{ paddingLeft: `${indentLevel * 14 + 4}px` }}
              className="flex items-start gap-2"
            >
              <span className="text-[#787878] mt-0.5 shrink-0">
                {indentLevel > 0 ? "◦" : "•"}
              </span>
              <span className="flex-1 min-w-0 break-words">
                {renderInlineMarkdown(bulletMatch[2])}
              </span>
            </div>
          );
        }

        return (
          <p key={idx} className="break-words leading-relaxed">
            {renderInlineMarkdown(line)}
          </p>
        );
      })}
    </div>
  );
}

/**
 * Tela de Conversa rica por Agente ou Canal em Equipe com fidelidade visual ao OpenBot (Screenshot 5).
 */
export const AgentConversationView: React.FC<AgentConversationViewProps> = ({
  mode,
  agente,
  canal,
  allAgentes = [],
  mensagens,
  provedores,
  sending,
  liveRun,
  inspectorOpen,
  onToggleInspector,
  onSendMessage,
  onUploadFile,
  onUpdateModelAndEffort,
  onOpenConnectors,
  pendingMcpSignIn,
  suggestedApps = [],
  onAuthenticateMcp,
  onOpenStoreApp,
  onRetryMcpContinue,
  prefilledDraft,
  threads = [],
  activeThread = null,
  onSelectThread,
  onCreateQuickThread,
  onDismissThreadTab,
  pagination,
  highlightedMessageId = null,
  onLoadOlderMessages,
  onJumpToLatest,
  onJumpToMessage,
  onNavigateBranchOrigin,
  esperas = [],
  filaSnapshot = null,
  editingQueueItem = null,
  onCloseWait,
  onBeginEditQueueItem,
  onSaveEditQueueItem,
  onDiscardEditQueueItem,
  onCancelOrDeleteQueueItem,
  onReorderQueue,
  onSteerQueueItem,
  onMoveQueueItemToTask,
  onInterruptTurn,
  pins = [],
  onBranchFromMessage,
  onTogglePinMessage,
  onAskSideQuestion,
  onStartNewChat,
}) => {
  const [draft, setDraft] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<AnexoChat[]>([]);

  useEffect(() => {
    if (typeof prefilledDraft === "string" && prefilledDraft.trim().length > 0) {
      setDraft(prefilledDraft);
    }
  }, [prefilledDraft]);

  useEffect(() => {
    if (editingQueueItem) {
      setDraft(editingQueueItem.conteudo_markdown);
      setPendingAttachments(editingQueueItem.anexos ?? []);
    }
  }, [editingQueueItem]);

  const [uploading, setUploading] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [openMessageMenuId, setOpenMessageMenuId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedSteps, setExpandedSteps] = useState<Record<string, boolean>>({});
  const [listeningVoice, setListeningVoice] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const prevScrollHeightRef = useRef<number | null>(null);

  const isWorking = Boolean(liveRun || sending || activeThread?.estado === "executando");
  const currentThreadId =
    activeThread?.thread_id ?? `main:${agente?.agente_id ?? "estrategista"}`;
  const allowNewChat = (agente?.config as Record<string, unknown> | undefined)?.allow_new_chat !== false;

  useEffect(() => {
    if (!isWorking) {
      setElapsedSec(0);
      return;
    }
    const baseStart = liveRun?.startedAt ?? Date.now();
    const tick = () => setElapsedSec(Math.max(0, Math.floor((Date.now() - baseStart) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [isWorking, liveRun?.startedAt]);

  useEffect(() => {
    if (prevScrollHeightRef.current !== null && messagesScrollRef.current) {
      const diff = messagesScrollRef.current.scrollHeight - prevScrollHeightRef.current;
      messagesScrollRef.current.scrollTop += diff;
      prevScrollHeightRef.current = null;
      return;
    }
    if (!highlightedMessageId) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [mensagens.length, liveRun?.steps.length, liveRun?.streamingText, isWorking, highlightedMessageId]);

  useEffect(() => {
    if (!highlightedMessageId || typeof document === "undefined") return;
    const el = document.getElementById(`msg-anchor-${highlightedMessageId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightedMessageId, mensagens.length]);

  const agentConfig = (agente?.config ?? {}) as Record<string, unknown>;
  const fallbackVisual = getDefaultMascotForAgent(agente?.agente_id ?? "estrategista");
  const avatarShape = (
    typeof agentConfig.avatar_shape === "string"
      ? agentConfig.avatar_shape
      : fallbackVisual.shape
  ) as AvatarShape;
  const avatarColor =
    typeof agentConfig.avatar_color === "string"
      ? agentConfig.avatar_color
      : fallbackVisual.color;

  const currentModel = agente?.modelo_padrao ?? "gemini-2.5-pro";
  const currentEffort = (
    typeof agentConfig.effort === "string" ? agentConfig.effort : "alto"
  ) as NivelEsforco;
  const currentProvider = inferProviderFromModelId(currentModel);

  const titleName = mode === "channel" ? canal?.nome ?? "#equipe" : agente?.nome ?? "Agente";

  const channelMembers = useMemo(() => {
    if (mode !== "channel" || !canal) return [];
    return canal.membros_agentes.map((id) => {
      const match = allAgentes.find((a) => a.agente_id === id);
      const cfg = (match?.config ?? {}) as Record<string, unknown>;
      const fb = getDefaultMascotForAgent(id);
      return {
        agente_id: id,
        shape: (typeof cfg.avatar_shape === "string" ? cfg.avatar_shape : fb.shape) as AvatarShape,
        color: typeof cfg.avatar_color === "string" ? cfg.avatar_color : fb.color,
      };
    });
  }, [mode, canal, allAgentes]);

  const handleCopy = async (key: string, value: string) => {
    try {
      await navigator.clipboard?.writeText(value);
    } catch {
      // Fallback silencioso caso ambiente não libere clipboard
    }
    setCopiedId(key);
    setTimeout(() => setCopiedId((prev) => (prev === key ? null : prev)), 1800);
  };

  const handlePickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const uploaded = await onUploadFile(file);
        setPendingAttachments((prev) => [...prev, uploaded]);
      }
    } finally {
      setUploading(false);
    }
  };

  const handleSend = async () => {
    if (uploading) return;
    if (!draft.trim() && pendingAttachments.length === 0) return;

    if (editingQueueItem && onSaveEditQueueItem) {
      setSavingEdit(true);
      setEditError(null);
      try {
        await onSaveEditQueueItem(
          editingQueueItem.entrega_id,
          draft.trim(),
          [...pendingAttachments]
        );
        setDraft("");
        setPendingAttachments([]);
      } catch (err) {
        setEditError(
          err instanceof Error
            ? err.message
            : "Não foi possível salvar a edição; seu texto foi mantido no rascunho."
        );
      } finally {
        setSavingEdit(false);
      }
      return;
    }

    if (mode === "channel" && sending) return;
    const textToSend = draft.trim();
    const filesToSend = [...pendingAttachments];
    setDraft("");
    setPendingAttachments([]);
    await onSendMessage(textToSend, filesToSend);
  };

  const handleVoiceDictation = () => {
    if (typeof window === "undefined") return;
    const SpeechRec =
      (window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;

    if (!SpeechRec) {
      setDraft((prev) =>
        prev ? `${prev} [Pedido por áudio: gerar roteiro e artes]` : "Gerar carrossel estratégico em 5 slides para [@SEU_PERFIL]"
      );
      return;
    }

    const recognition = new SpeechRec() as {
      lang: string;
      interimResults: boolean;
      onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
      onerror: (() => void) | null;
      onend: (() => void) | null;
      start: () => void;
    };
    recognition.lang = "pt-BR";
    recognition.interimResults = false;
    setListeningVoice(true);
    recognition.onresult = (ev) => {
      const spoken = ev.results?.[0]?.[0]?.transcript ?? "";
      if (spoken) {
        setDraft((prev) => (prev ? `${prev} ${spoken}` : spoken));
      }
    };
    recognition.onerror = () => setListeningVoice(false);
    recognition.onend = () => setListeningVoice(false);
    recognition.start();
  };

  return (
    <div className="flex-1 min-w-0 h-full bg-[#1A1A1A] flex overflow-hidden">
      <div className="flex-1 min-w-0 h-full flex flex-col overflow-hidden">
        {mode === "agent" && onSelectThread && onCreateQuickThread && (
          <ThreadTabsBar
            threads={threads}
            activeThreadId={activeThread?.thread_id ?? null}
            onSelectThread={onSelectThread}
            onStartNewTaskTab={onCreateQuickThread}
            onDismissThreadTab={onDismissThreadTab}
          />
        )}

        {/* Cabeçalho da conversa com botão central de Modelo + Esforço (Screenshot 5) */}
        <div className="h-[48px] shrink-0 border-b border-white/[0.06] px-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {mode === "channel" ? (
              <ChannelMascoteCluster members={channelMembers} size={30} />
            ) : (
              <MascoteAvatar
                shape={avatarShape}
                color={avatarColor}
                size={30}
                mood={isWorking ? "working" : "idle"}
                animated={isWorking}
              />
            )}
            <div className="min-w-0">
              <div className="text-[13.5px] font-semibold text-white truncate">
                {activeThread ? `${titleName} · ${activeThread.titulo}` : titleName}
              </div>
              <div className="text-[11px] text-[#6A6A6A] truncate">
                {mode === "channel"
                  ? `${canal?.membros_agentes.length ?? 0} agentes coordenados`
                  : agente?.papel}
              </div>
            </div>
          </div>

          {/* Botão central estilo '[Icon] Modelo · Esforço ⌄' */}
          <button
            type="button"
            onClick={() => setPopoverOpen(true)}
            aria-label="Trocar provedor, modelo e esforço"
            className="inline-flex items-center gap-2 rounded-full bg-[#212121] hover:bg-[#2A2A2A] border border-white/10 px-3.5 py-1.5 text-[12px] font-medium text-white transition-colors shrink-0"
          >
            <ProviderLogo provider={currentProvider} size={14} />
            <span className="max-w-[150px] truncate">{currentModel}</span>
            <span className="text-[#6A6A6A]">·</span>
            <span className="text-[#979797]">{EFFORT_LABELS[currentEffort]}</span>
            <ChevronDown className="h-3.5 w-3.5 text-[#979797]" />
          </button>

          <div className="flex items-center gap-2 shrink-0">
            {mode === "agent" && onTogglePinMessage && onJumpToMessage && (
              <PinnedMessagesPopover
                pins={pins}
                currentThreadId={currentThreadId}
                onJumpToPin={async (pin) => {
                  await onJumpToMessage(pin.thread_id, pin.mensagem_id);
                }}
                onUnpin={async (pin) => {
                  await onTogglePinMessage(
                    {
                      mensagem_id: pin.mensagem_id,
                      canal_id: pin.thread_id,
                      agente_id: agente?.agente_id ?? null,
                      autor: pin.autor,
                      conteudo_markdown: pin.conteudo_resumo,
                      anexos: [],
                      steps: [],
                      thread_id: pin.thread_id,
                      lida: true,
                      criado_em: pin.criado_em,
                    },
                    false
                  );
                }}
              />
            )}

            {mode === "agent" && onAskSideQuestion && (
              <button
                type="button"
                onClick={() => setSidePanelOpen((s) => !s)}
                className={`inline-flex h-8 items-center gap-1 rounded-lg border px-2 text-[12px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7] ${
                  sidePanelOpen
                    ? "border-[#007CF7] bg-[#2A2A2A] text-white"
                    : "border-white/[0.06] bg-[#212121] text-[#DCDCDC] hover:bg-[#242424] hover:text-white"
                }`}
              >
                <MessageCircleQuestion className="h-3.5 w-3.5" />
                <span>Perguntar ao lado</span>
              </button>
            )}

            {mode === "agent" && !activeThread && allowNewChat && onStartNewChat && (
              <button
                type="button"
                onClick={() => void onStartNewChat()}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/[0.06] bg-[#212121] px-2 text-[12px] font-semibold text-[#DCDCDC] transition hover:bg-[#242424] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Reiniciar contexto</span>
              </button>
            )}

            <button
              type="button"
              onClick={onToggleInspector}
              title={inspectorOpen ? "Recolher painel direito" : "Abrir inspetor lateral"}
              aria-label="Alternar inspetor lateral"
              className={`h-8 w-8 rounded-lg flex items-center justify-center transition-colors ${
                inspectorOpen
                  ? "bg-[#2A2A2A] text-white"
                  : "text-[#979797] hover:bg-[#212121] hover:text-white"
              }`}
            >
              <PanelRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Área de mensagens rolável */}
        <div
          ref={messagesScrollRef}
          className="relative flex-1 overflow-y-auto px-5 py-5 space-y-5"
        >
          {pagination?.has_older && onLoadOlderMessages && (
            <div className="flex justify-center">
              <button
                type="button"
                disabled={pagination.loading_older}
                onClick={async () => {
                  if (messagesScrollRef.current) {
                    prevScrollHeightRef.current = messagesScrollRef.current.scrollHeight;
                  }
                  await onLoadOlderMessages();
                }}
                className="inline-flex items-center gap-1 rounded-full border border-white/[0.06] bg-[#212121] px-4 py-1 text-[12px] font-semibold text-[#DCDCDC] transition hover:bg-[#2A2A2A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
              >
                <ChevronUp className="h-3.5 w-3.5" />
                <span>
                  {pagination.loading_older ? "Carregando anteriores..." : "Carregar anteriores"}
                </span>
              </button>
            </div>
          )}
        {mensagens.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto">
            {mode === "channel" ? (
              <ChannelMascoteCluster members={channelMembers} size={64} />
            ) : (
              <MascoteAvatar shape={avatarShape} color={avatarColor} size={68} animated trackCursor />
            )}
            <h3 className="text-[17px] font-semibold text-white mt-4">{titleName}</h3>
            <p className="text-[12.5px] text-[#979797] mt-1">
              {mode === "channel"
                ? "Envie um briefing para coordenar todos os especialistas deste canal simultaneamente."
                : `${agente?.papel}. Envie um tema ou anexe referências ImagePaths em + abaixo.`}
            </p>
          </div>
        ) : (
          mensagens.map((msg) => {
            if (msg.item_type === "context_reset") {
              return (
                <div
                  key={msg.mensagem_id}
                  id={`msg-anchor-${msg.mensagem_id}`}
                  className="my-4 flex items-center gap-4 max-w-[820px] mx-auto"
                >
                  <div className="h-px flex-1 bg-white/[0.06]" />
                  <span className="rounded-full border border-white/[0.06] bg-[#212121] px-4 py-1 text-[12px] font-normal text-[#979797]">
                    Novo chat iniciado — contexto do modelo reiniciado · histórico visual preservado
                  </span>
                  <div className="h-px flex-1 bg-white/[0.06]" />
                </div>
              );
            }

            const isUser = msg.autor === "usuario";
            const blocks = splitMarkdownBlocks(msg.conteudo_markdown);
            const isHighlighted = highlightedMessageId === msg.mensagem_id;
            const isPinned = pins.some((p) => p.mensagem_id === msg.mensagem_id);
            const isBranchCutoff =
              Boolean(activeThread?.branch) &&
              activeThread?.branch?.ate_mensagem_id === msg.mensagem_id;

            return (
              <React.Fragment key={msg.mensagem_id}>
                <div
                  id={`msg-anchor-${msg.mensagem_id}`}
                  className={`group relative flex gap-3 max-w-[820px] rounded-2xl p-1 transition ${
                    isUser ? "ml-auto justify-end" : "mr-auto"
                  } ${isHighlighted ? "ring-2 ring-[#007CF7] bg-[#007CF7]/10" : ""}`}
                >
                {!isUser && (
                  <div className="pt-1 shrink-0">
                    <MascoteAvatar shape={avatarShape} color={avatarColor} size={28} />
                  </div>
                )}

                <div
                  className={`min-w-0 ${
                    isUser
                      ? "bg-[#2A2A2A] border border-white/10 rounded-[18px] px-4 py-2.5 max-w-[78%] text-white"
                      : "flex-1 space-y-3"
                  }`}
                >
                  {!isUser && msg.autor_nome && (
                    <div className="text-[11.5px] font-semibold text-[#979797] flex items-center gap-2">
                      <span>{msg.autor_nome}</span>
                      <span className="text-[#6A6A6A] font-normal">
                        {new Date(msg.criado_em).toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  )}

                  {/* Passos de execução colapsáveis */}
                  {!isUser && msg.steps && msg.steps.length > 0 && (
                    <div className="rounded-xl bg-[#212121] border border-white/[0.06] overflow-hidden">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedSteps((prev) => ({
                            ...prev,
                            [msg.mensagem_id]: !prev[msg.mensagem_id],
                          }))
                        }
                        className="w-full px-3 py-2 flex items-center justify-between text-[11.5px] text-[#979797] hover:text-white"
                      >
                        <span className="flex items-center gap-1.5">
                          <Wrench className="h-3.5 w-3.5 text-[#31CF76]" />
                          <span>{msg.steps.length} etapa(s) de ferramenta executada(s)</span>
                        </span>
                        {expandedSteps[msg.mensagem_id] ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                      </button>

                      {expandedSteps[msg.mensagem_id] && (
                        <div className="px-3 pb-2.5 pt-1 border-t border-white/[0.05] space-y-1.5">
                          {msg.steps.map((st) => (
                            <div
                              key={st.id}
                              className="flex items-start justify-between gap-2 text-[11.5px] text-[#DCDCDC]"
                            >
                              <div className="min-w-0">
                                <span className="font-terminal text-[#42A0FF] mr-1.5">
                                  [{st.ferramenta}]
                                </span>
                                <span>{st.titulo}</span>
                              </div>
                              <span className="text-[10.5px] text-[#6A6A6A] shrink-0">
                                {st.duracao_ms ? `${st.duracao_ms}ms` : "ok"}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Blocos de texto, códigos e tabelas Markdown com formatação inline */}
                  <div className="space-y-3 text-[13.5px] leading-relaxed text-[#DCDCDC]">
                    {blocks.map((block, bIdx) => {
                      if (block.type === "code") {
                        const codeKey = `${msg.mensagem_id}-code-${bIdx}`;
                        return (
                          <div
                            key={bIdx}
                            className="rounded-xl border border-[#303030] bg-[#121212] overflow-hidden"
                          >
                            <div className="px-3 py-1.5 bg-[#191919] border-b border-white/[0.06] flex items-center justify-between text-[11px] text-[#8E8E8E]">
                              <span className="font-terminal">{block.language}</span>
                              <button
                                type="button"
                                onClick={() => handleCopy(codeKey, block.content)}
                                className="inline-flex items-center gap-1 hover:text-white transition-colors"
                              >
                                {copiedId === codeKey ? (
                                  <Check className="h-3 w-3 text-[#31CF76]" />
                                ) : (
                                  <Copy className="h-3 w-3" />
                                )}
                                <span>{copiedId === codeKey ? "Copiado" : "Copiar"}</span>
                              </button>
                            </div>
                            <pre className="p-3 overflow-x-auto text-[12px] font-terminal text-[#E6E6E6] leading-relaxed">
                              <code>{block.content}</code>
                            </pre>
                          </div>
                        );
                      }

                      if (block.type === "table" && block.headers && block.rows) {
                        const mdKey = `${msg.mensagem_id}-md-${bIdx}`;
                        const csvKey = `${msg.mensagem_id}-csv-${bIdx}`;
                        return (
                          <div key={bIdx} className="space-y-2">
                            <div className="overflow-x-auto rounded-xl border border-[#303030] bg-[#141414]">
                              <table className="w-full text-left border-collapse text-[12.5px]">
                                <thead>
                                  <tr className="border-b border-[#303030] bg-[#1A1A1A] text-[#A1A1A1]">
                                    {block.headers.map((h, hIdx) => (
                                      <th key={hIdx} className="px-3.5 py-2 font-medium">
                                        {renderInlineMarkdown(h)}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-[#303030]/70 text-[#F5F5F5]">
                                  {block.rows.map((row, rIdx) => (
                                    <tr key={rIdx} className="hover:bg-white/[0.03]">
                                      {row.map((cell, cIdx) => (
                                        <td key={cIdx} className="px-3.5 py-2 align-top">
                                          {renderInlineMarkdown(cell)}
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            <div className="flex items-center justify-center gap-4 text-[11.5px] text-[#979797]">
                              <button
                                type="button"
                                onClick={() => handleCopy(mdKey, block.content)}
                                className="inline-flex items-center gap-1.5 hover:text-white transition-colors"
                              >
                                {copiedId === mdKey ? (
                                  <Check className="h-3.5 w-3.5 text-[#31CF76]" />
                                ) : (
                                  <Copy className="h-3.5 w-3.5" />
                                )}
                                <span>Copiar como Markdown</span>
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handleCopy(csvKey, toCsv(block.headers ?? [], block.rows ?? []))
                                }
                                className="inline-flex items-center gap-1.5 hover:text-white transition-colors"
                              >
                                {copiedId === csvKey ? (
                                  <Check className="h-3.5 w-3.5 text-[#31CF76]" />
                                ) : (
                                  <Copy className="h-3.5 w-3.5" />
                                )}
                                <span>Copiar como CSV</span>
                              </button>
                            </div>
                          </div>
                        );
                      }

                      return <div key={bIdx}>{renderFormattedMarkdownText(block.content)}</div>;
                    })}
                  </div>

                  {/* Previews inline de Anexos (ImagePaths, PNGs gerados, MP4, Documentos) */}
                  {msg.anexos && msg.anexos.length > 0 && (
                    <div className="flex flex-wrap gap-2.5 pt-1">
                      {msg.anexos.map((anexo, aIdx) => {
                        const isImage = anexo.mime_type.startsWith("image/");
                        const isVideo = anexo.mime_type.startsWith("video/");
                        return (
                          <div
                            key={`${anexo.caminho_relativo}-${aIdx}`}
                            className="rounded-xl bg-[#212121] border border-white/10 overflow-hidden max-w-[260px]"
                          >
                            {isImage && (
                              <img
                                src={anexo.url}
                                alt={anexo.nome}
                                className="max-h-44 w-full object-cover bg-[#101010]"
                              />
                            )}
                            {isVideo && (
                              <video
                                src={anexo.url}
                                controls
                                className="max-h-52 w-full bg-black"
                              />
                            )}
                            <div className="px-3 py-2 flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                {isImage ? (
                                  <ImageIcon className="h-3.5 w-3.5 text-[#31CF76] shrink-0" />
                                ) : (
                                  <FileText className="h-3.5 w-3.5 text-[#42A0FF] shrink-0" />
                                )}
                                <span className="text-[12px] text-white truncate">{anexo.nome}</span>
                              </div>
                              <a
                                href={anexo.url}
                                download={anexo.nome}
                                title="Baixar arquivo"
                                className="text-[#979797] hover:text-white shrink-0"
                              >
                                <Download className="h-3.5 w-3.5" />
                              </a>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {mode === "agent" && msg.status !== "streaming" && (
                    <div className="mt-2 flex items-center gap-2 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                      {onBranchFromMessage && (
                        <button
                          type="button"
                          onClick={() => void onBranchFromMessage(msg.mensagem_id)}
                          className="inline-flex items-center gap-1 rounded-lg bg-[#212121] px-2 py-1 text-[12px] font-semibold text-[#DCDCDC] hover:bg-[#2A2A2A] hover:text-white"
                        >
                          <GitBranch className="h-3 w-3" />
                          <span>Ramificar conversa</span>
                        </button>
                      )}

                      {onTogglePinMessage && (
                        <button
                          type="button"
                          onClick={() => void onTogglePinMessage(msg, !isPinned)}
                          className="inline-flex items-center gap-1 rounded-lg bg-[#212121] px-2 py-1 text-[12px] font-semibold text-[#DCDCDC] hover:bg-[#2A2A2A] hover:text-white"
                        >
                          {isPinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                          <span>{isPinned ? "Desafixar mensagem" : "Fixar mensagem"}</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => void handleCopy(msg.mensagem_id, msg.conteudo_markdown)}
                        className="inline-flex items-center gap-1 rounded-lg bg-[#212121] px-2 py-1 text-[12px] font-semibold text-[#DCDCDC] hover:bg-[#2A2A2A] hover:text-white"
                      >
                        <Copy className="h-3 w-3" />
                        <span>Copiar texto</span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          setDraft((prev) =>
                            `> ${msg.conteudo_markdown.slice(0, 120).replace(/\n/g, " ")}\n\n${prev}`
                          )
                        }
                        className="inline-flex items-center gap-1 rounded-lg bg-[#212121] px-2 py-1 text-[12px] font-semibold text-[#DCDCDC] hover:bg-[#2A2A2A] hover:text-white"
                      >
                        <CornerUpLeft className="h-3 w-3" />
                        <span>Responder mensagem</span>
                      </button>

                      <button
                        type="button"
                        aria-label="Mais ações"
                        onClick={() =>
                          setOpenMessageMenuId((cur) =>
                            cur === msg.mensagem_id ? null : msg.mensagem_id
                          )
                        }
                        className="rounded-lg bg-[#212121] p-1 text-[#979797] hover:text-white"
                      >
                        <MoreHorizontal className="h-3 w-3" />
                      </button>
                      {openMessageMenuId === msg.mensagem_id && (
                        <span className="text-[12px] font-normal text-[#979797]">
                          {isPinned ? "Fixada" : ""}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              {isBranchCutoff && activeThread?.branch && (
                <BranchDivider
                  branch={activeThread.branch}
                  onNavigateToOrigin={onNavigateBranchOrigin}
                />
              )}
              </React.Fragment>
            );
          })
        )}

        {/* Cartão inline OAuth MCP e sugestões de apps da Loja */}
        {pendingMcpSignIn && onAuthenticateMcp && (
          <McpSignInChatCard
            mcpId={pendingMcpSignIn.mcpId}
            nome={pendingMcpSignIn.nome}
            appSlug={pendingMcpSignIn.appSlug}
            status={pendingMcpSignIn.status}
            errorMessage={pendingMcpSignIn.errorMessage}
            onAuthenticate={onAuthenticateMcp}
            onOpenAppPage={onOpenStoreApp}
            onRetryContinue={onRetryMcpContinue}
          />
        )}

        {suggestedApps.length > 0 && (
          <div className="space-y-2 max-w-[820px]">
            {suggestedApps.map((app) => (
              <div
                key={app.slug}
                className="flex items-center justify-between gap-3 rounded-[12px] border border-[#2A2A2A] bg-[#212121] p-3.5"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <AppBrandIcon slug={app.slug} name={app.name} size={32} />
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-[#F0F0F0] truncate">
                      {app.name}
                    </p>
                    <p className="text-[12px] text-[#979797] truncate">{app.tagline}</p>
                  </div>
                </div>
                {onOpenStoreApp && (
                  <button
                    type="button"
                    onClick={() => onOpenStoreApp(app.slug)}
                    className="shrink-0 rounded-full border border-[#2A2A2A] bg-[#242424] px-3 py-1.5 text-[12px] font-semibold text-[#42A0FF] hover:bg-[#2A2A2A]"
                  >
                    Abrir página
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Feedback ao vivo estilo OpenBot/Antigravity enquanto o agente executa */}
        {isWorking && (
          <div className="flex gap-3 max-w-[820px] mr-auto pt-1" role="status" aria-live="polite">
            <div className="pt-0.5 shrink-0 flex flex-col items-center">
              <div className="flex items-center gap-1 mb-1">
                <span className="h-1 w-1 rounded-full bg-[#A855F7] animate-bounce [animation-delay:-0.25s]" />
                <span className="h-1 w-1 rounded-full bg-[#A855F7] animate-bounce [animation-delay:-0.12s]" />
                <span className="h-1 w-1 rounded-full bg-[#A855F7] animate-bounce" />
              </div>
              <MascoteAvatar shape={avatarShape} color={avatarColor} size={28} animated mood="working" />
            </div>

            <div className="flex-1 min-w-0 space-y-2.5">
              <div className="flex items-center gap-2.5 text-[12.5px]">
                <span className="text-[#DCDCDC] font-medium truncate">
                  {liveRun?.statusText || `Executando ${currentModel}...`}
                </span>
                <span className="text-[11.5px] text-[#7A7A7A] tabular-nums shrink-0">
                  {formatElapsedClock(elapsedSec)}
                </span>
              </div>

              {liveRun && liveRun.steps.length > 0 && (
                <div className="rounded-xl bg-[#212121] border border-white/[0.06] px-3 py-2 space-y-1.5">
                  {liveRun.steps.map((st) => (
                    <div
                      key={st.id}
                      className="flex items-center justify-between gap-2 text-[11.5px] text-[#DCDCDC]"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {st.status === "executando" ? (
                          <Loader2 className="h-3 w-3 text-[#42A0FF] animate-spin shrink-0" />
                        ) : st.status === "erro" ? (
                          <X className="h-3 w-3 text-[#FF7675] shrink-0" />
                        ) : (
                          <Check className="h-3 w-3 text-[#31CF76] shrink-0" />
                        )}
                        <span className="truncate">{st.titulo}</span>
                      </div>
                      {st.duracao_ms ? (
                        <span className="text-[10.5px] text-[#6A6A6A] shrink-0 tabular-nums">
                          {st.duracao_ms}ms
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}

              {liveRun && liveRun.streamingText.trim().length > 0 && (
                <div className="space-y-2 text-[13.5px] leading-relaxed text-[#DCDCDC]">
                  {splitMarkdownBlocks(liveRun.streamingText).map((block, bIdx) =>
                    block.type === "table" && block.headers && block.rows ? (
                      <div key={bIdx} className="overflow-x-auto rounded-xl border border-[#303030] bg-[#141414]">
                        <table className="w-full text-left border-collapse text-[12.5px]">
                          <thead>
                            <tr className="border-b border-[#303030] bg-[#1A1A1A] text-[#A1A1A1]">
                              {block.headers.map((h, hIdx) => (
                                <th key={hIdx} className="px-3.5 py-2 font-medium">
                                  {renderInlineMarkdown(h)}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#303030]/70 text-[#F5F5F5]">
                            {block.rows.map((row, rIdx) => (
                              <tr key={rIdx}>
                                {row.map((cell, cIdx) => (
                                  <td key={cIdx} className="px-3.5 py-2 align-top">
                                    {renderInlineMarkdown(cell)}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div key={bIdx}>{renderFormattedMarkdownText(block.content)}</div>
                    )
                  )}
                </div>
              )}
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />

        {pagination?.has_newer && onJumpToLatest && (
          <div className="sticky bottom-2 flex justify-center pointer-events-none">
            <button
              type="button"
              onClick={() => void onJumpToLatest()}
              className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-[#007CF7] bg-[#212121] px-4 py-1 text-[12px] font-semibold text-white shadow-lg hover:bg-[#2A2A2A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
            >
              <span>Voltar ao fim</span>
            </button>
          </div>
        )}
      </div>

      {/* Composer arredondado #212121 (Screenshot 5) */}
      <div className="px-5 pb-4 pt-2 shrink-0">
        <div className="max-w-[820px] mx-auto">
          {mode === "agent" && onCloseWait && (
            <OpenWaitsCard
              esperas={esperas}
              onViewOriginPedido={(w) => {
                if (onJumpToMessage && w.entrega_origem_id) {
                  void onJumpToMessage(currentThreadId, w.entrega_origem_id);
                }
              }}
              onCloseWait={onCloseWait}
            />
          )}

          {mode === "agent" &&
            filaSnapshot &&
            filaSnapshot.entregas.length > 0 &&
            onBeginEditQueueItem &&
            onCancelOrDeleteQueueItem &&
            onReorderQueue &&
            onSteerQueueItem &&
            onMoveQueueItemToTask && (
              <QueuePanel
                entregas={filaSnapshot.entregas}
                suportaSteerNativo={filaSnapshot.suporta_steer_nativo}
                onBeginEdit={onBeginEditQueueItem}
                onCancelOrDelete={onCancelOrDeleteQueueItem}
                onReorder={onReorderQueue}
                onSteer={onSteerQueueItem}
                onMoveToTask={onMoveQueueItemToTask}
              />
            )}

          {editingQueueItem && (
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#007CF7]/40 bg-[#242424] px-4 py-2">
              <div className="min-w-0">
                <div className="text-[12px] font-semibold text-[#42A0FF]">
                  Editando mensagem na fila (travada contra consumo automático)
                </div>
                {editError && (
                  <div className="text-[12px] font-normal text-[#FD2F3B]">{editError}</div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {onDiscardEditQueueItem && (
                  <button
                    type="button"
                    disabled={savingEdit}
                    onClick={async () => {
                      setEditError(null);
                      await onDiscardEditQueueItem(editingQueueItem.entrega_id);
                      setDraft("");
                      setPendingAttachments([]);
                    }}
                    className="rounded-lg border border-white/[0.06] bg-[#141414] px-2 py-1 text-[12px] font-semibold text-[#DCDCDC] hover:bg-[#2A2A2A]"
                  >
                    Descartar edição
                  </button>
                )}
                <button
                  type="button"
                  disabled={savingEdit || !draft.trim()}
                  onClick={() => void handleSend()}
                  className="rounded-lg bg-[#F0F0F0] px-3 py-1 text-[12px] font-semibold text-[#141414] hover:bg-white disabled:opacity-40"
                >
                  {savingEdit ? "Aplicando edição..." : "Aplicar edição"}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="max-w-[820px] mx-auto rounded-[22px] bg-[#212121] border border-white/10 px-3 py-2 shadow-lg">
          {pendingAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-2 pb-2 mb-2 border-b border-white/[0.06]">
              {pendingAttachments.map((att, idx) => (
                <div
                  key={`${att.caminho_relativo}-${idx}`}
                  className="flex items-center gap-2 rounded-lg bg-[#2A2A2A] border border-white/10 px-2.5 py-1 text-[11.5px] text-white"
                >
                  {att.mime_type.startsWith("image/") ? (
                    <img
                      src={att.url}
                      alt={att.nome}
                      className="h-5 w-5 rounded object-cover"
                    />
                  ) : (
                    <FileText className="h-3.5 w-3.5 text-[#42A0FF]" />
                  )}
                  <span className="max-w-[140px] truncate">{att.nome}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setPendingAttachments((prev) => prev.filter((_, pIdx) => pIdx !== idx))
                    }
                    aria-label={`Remover anexo ${att.nome}`}
                    className="text-[#979797] hover:text-white"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              id="composer-imagepaths-input"
              name="composer_attachments"
              aria-label="Anexar imagens ou referências ImagePaths"
              type="file"
              multiple
              accept="image/*,video/mp4,.pdf,.csv,.txt,.srt"
              className="hidden"
              onChange={(e) => {
                void handlePickFiles(e.target.files);
                e.currentTarget.value = "";
              }}
            />
            <div className="relative shrink-0">
              <button
                type="button"
                disabled={uploading}
                onClick={() => {
                  if (mode === "agent" && onAskSideQuestion) {
                    setPlusMenuOpen((prev) => !prev);
                  } else {
                    fileInputRef.current?.click();
                  }
                }}
                title="Anexar foto, logo ou referência facial (ImagePaths)"
                aria-label="Anexar referência ImagePaths"
                className="h-9 w-9 rounded-full flex items-center justify-center text-[#979797] hover:text-white hover:bg-[#2A2A2A] transition-colors shrink-0"
              >
                <Plus className="h-4 w-4" />
              </button>

              {plusMenuOpen && (
                <div className="absolute bottom-full left-0 z-40 mb-2 w-48 rounded-xl border border-white/[0.06] bg-[#141414] p-1 shadow-xl">
                  <button
                    type="button"
                    onClick={() => {
                      setPlusMenuOpen(false);
                      fileInputRef.current?.click();
                    }}
                    className="block w-full rounded-lg px-2 py-2 text-left text-[12px] font-semibold text-[#DCDCDC] hover:bg-[#242424]"
                  >
                    Anexar arquivo
                  </button>
                  {onAskSideQuestion && (
                    <button
                      type="button"
                      onClick={() => {
                        setPlusMenuOpen(false);
                        setSidePanelOpen(true);
                      }}
                      className="block w-full rounded-lg px-2 py-2 text-left text-[12px] font-semibold text-[#DCDCDC] hover:bg-[#242424]"
                    >
                      Perguntar ao lado
                    </button>
                  )}
                </div>
              )}
            </div>

            <textarea
              id="composer-message-input"
              name="composer_message"
              aria-label={`Mensagem para ${titleName}`}
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder={
                uploading ? "Enviando arquivo..." : `Mensagem para ${titleName}`
              }
              className="flex-1 bg-transparent py-2 text-[13.5px] text-white placeholder-[#6A6A6A] focus:outline-none resize-none max-h-32"
            />

            <button
              type="button"
              onClick={handleVoiceDictation}
              title="Ditar pedido por voz"
              aria-label="Gravar ou ditar pedido por voz"
              className={`h-9 w-9 rounded-full flex items-center justify-center transition-colors shrink-0 ${
                listeningVoice
                  ? "bg-[#FD2F3B]/20 text-[#FD2F3B]"
                  : "text-[#979797] hover:text-white hover:bg-[#2A2A2A]"
              }`}
            >
              <Mic className="h-4 w-4" />
            </button>

            {isWorking && onInterruptTurn && mode === "agent" && (
              <button
                type="button"
                onClick={() => void onInterruptTurn()}
                aria-label="Interromper turno"
                className="inline-flex h-9 items-center gap-1 rounded-full border border-[#FD2F3B]/60 bg-[#FD2F3B]/15 px-3 text-[12px] font-semibold text-[#FD2F3B] transition hover:bg-[#FD2F3B]/25 shrink-0"
              >
                <Square className="h-3 w-3 fill-current" />
                <span>Interromper turno</span>
              </button>
            )}

            <button
              type="button"
              disabled={
                (mode === "channel" && sending) ||
                uploading ||
                (!draft.trim() && pendingAttachments.length === 0)
              }
              onClick={() => void handleSend()}
              aria-label="Enviar mensagem"
              className="h-9 w-9 rounded-full bg-[#F0F0F0] hover:bg-white disabled:opacity-40 text-[#141414] flex items-center justify-center transition-colors shrink-0"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

        <ModelProviderPopover
          open={popoverOpen}
          onClose={() => setPopoverOpen(false)}
          provedores={provedores}
          selectedModel={currentModel}
          selectedEffort={currentEffort}
          onSelectModelAndEffort={(m, eff) => {
            void onUpdateModelAndEffort(m, eff);
          }}
          onOpenConnectors={onOpenConnectors}
        />
      </div>

      {mode === "agent" && onAskSideQuestion && (
        <SideQuestionPanel
          open={sidePanelOpen}
          agenteNome={titleName}
          agenteAvatar={{ shape: avatarShape, color: avatarColor }}
          threadId={activeThread?.thread_id ?? null}
          onAsk={onAskSideQuestion}
          onClose={() => setSidePanelOpen(false)}
        />
      )}
    </div>
  );
};
