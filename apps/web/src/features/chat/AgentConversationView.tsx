import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  AgenteEspera,
  AgenteRegistro,
  AgenteThreadBranch,
  AgenteThreadRegistro,
  AnexoChat,
  ArquivoStudio,
  AvatarShape,
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
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  CornerUpLeft,
  Database,
  Download,
  Eye,
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
  Radio,
  RotateCcw,
  Send,
  Smartphone,
  Sparkles,
  Square,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import {
  computeBubbleColors,
  splitMarkdownIntoBubbleChunks,
  type BubbleColorPalette,
} from "./chat-bubble-theme";
import {
  ChannelMascoteCluster,
  inferTaskContextFromActivity,
  MascoteAvatar,
  resolveAgentAvatarConfig,
} from "../../components/MascoteAvatar";
import {
  inferProviderFromModelId,
  ModelProviderPopover,
} from "../../components/ModelProviderPopover";
import { ProviderLogo } from "../../components/ProviderLogo";
import { AppBrandIcon } from "../../components/ui/CarbonControls";
import { AcknowledgeRequestCard } from "./AcknowledgeRequestCard";
import { ApiKeyRequestCard } from "./ApiKeyRequestCard";
import { BranchDivider } from "./BranchDivider";
import { ChatVisualReply } from "./ChatVisualReply";
import { CodePreview } from "./CodePreview";
import {
  ComposerAutocomplete,
  buildComposerAutocompleteItems,
  detectComposerTrigger,
  type ComposerAutocompleteItem,
} from "./ComposerAutocomplete";
import { ConversationQuestionPrompt } from "./ConversationQuestionPrompt";
import { daemonApi } from "../../services/websocket-client";
import { MathFormula, MermaidDiagram } from "./MarkdownMathMermaidPreview";
import { OpenWaitsCard } from "./OpenWaitsCard";
import { PinnedMessagesPopover } from "./PinnedMessagesPopover";
import { QueuePanel } from "./QueuePanel";
import { SideQuestionPanel } from "./SideQuestionPanel";
import { SkillSuggestionChatCard } from "./SkillSuggestionChatCard";
import { ThreadTabsBar } from "./ThreadTabsBar";
import { UiBlockPrompt } from "./UiBlockPrompt";
import {
  BrowserSecretCard,
  BrowserTakeoverCard,
  CaptureScreenConsentCard,
} from "../browser/BrowserTakeoverModal";
import { UsageLimitAskCard } from "../inspector/BackupModelsEditor";

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
  arquivos?: ArquivoStudio[];
  mensagens: MensagemChat[];
  provedores: ProvedorStatusInfo[];
  sending: boolean;
  liveRun?: ChatLiveRunState | null;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
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

function renderInlineMarkdown(
  text: string,
  depth = 0,
  palette?: BubbleColorPalette
): React.ReactNode[] {
  const parts = text.split(
    /(\*\*[^*]+?\*\*|__[^_]+?__|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|~~[^~]+?~~|\*[^*\s][^*]*?\*|(?<![A-Za-z0-9_])_[^_\s][^_]*?_(?![A-Za-z0-9_]))/g
  );
  const strongClass = palette?.isLightBg
    ? "font-semibold text-[#0D1117]"
    : "font-semibold text-white";
  const codeClass = palette
    ? `rounded border px-1.5 py-0.5 font-terminal text-[12px] ${palette.codeBgClass}`
    : "rounded bg-[#2A2A2A] border border-white/10 px-1.5 py-0.5 font-terminal text-[12px] text-[#74B9FF]";
  const linkClass = palette?.isLightBg
    ? "text-[#0B4F8A] underline underline-offset-2 font-medium"
    : "text-[#42A0FF] underline underline-offset-2 hover:text-[#74B9FF]";

  return parts.map((part, idx) => {
    if (
      ((part.startsWith("**") && part.endsWith("**")) ||
        (part.startsWith("__") && part.endsWith("__"))) &&
      part.length > 4
    ) {
      return (
        <strong key={idx} className={strongClass}>
          {depth < 3
            ? renderInlineMarkdown(part.slice(2, -2), depth + 1, palette)
            : part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={idx} className={codeClass}>
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
            className={linkClass}
          >
            {linkMatch[1]}
          </a>
        );
      }
    }
    if (part.startsWith("~~") && part.endsWith("~~") && part.length > 4) {
      return (
        <del
          key={idx}
          className={`line-through ${palette?.isLightBg ? "text-[#0D1117]/60" : "text-[#888888]"}`}
        >
          {depth < 3
            ? renderInlineMarkdown(part.slice(2, -2), depth + 1, palette)
            : part.slice(2, -2)}
        </del>
      );
    }
    if (
      ((part.startsWith("*") && part.endsWith("*")) ||
        (part.startsWith("_") && part.endsWith("_"))) &&
      part.length > 2
    ) {
      return (
        <em
          key={idx}
          className={`italic ${palette?.isLightBg ? "text-[#0D1117]/85" : "text-[#B5B5B5]"}`}
        >
          {depth < 3
            ? renderInlineMarkdown(part.slice(1, -1), depth + 1, palette)
            : part.slice(1, -1)}
        </em>
      );
    }
    return part;
  });
}

function renderFormattedMarkdownText(
  content: string,
  palette?: BubbleColorPalette
): React.ReactNode {
  const lines = content.split(/\r?\n/);
  const headingColor = palette?.isLightBg ? "text-[#0D1117]" : "text-white";
  const subHeadingColor = palette?.isLightBg ? "text-[#0D1117]/90" : "text-[#E8E8E8]";
  const markerColor = palette?.isLightBg ? "text-[#0D1117]/75" : "text-[#8E8E93]";
  return (
    <div className="space-y-2">
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={idx} className="h-1" />;

        // Fórmula matemática display $$...$$
        if (trimmed.startsWith("$$") && trimmed.endsWith("$$") && trimmed.length > 4) {
          return (
            <div key={idx} className="my-2 overflow-x-auto">
              <MathFormula formula={trimmed.slice(2, -2).trim()} displayMode />
            </div>
          );
        }

        // Separador horizontal --- / *** / ___
        if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
          return (
            <hr
              key={idx}
              className={`border-0 border-t my-2.5 ${
                palette?.isLightBg ? "border-black/15" : "border-white/10"
              }`}
            />
          );
        }

        // Títulos Markdown (#, ##, ###, ####)
        const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
        if (headingMatch) {
          const level = headingMatch[1].length;
          const inner = renderInlineMarkdown(headingMatch[2], 0, palette);
          if (level === 1) {
            return (
              <h1 key={idx} className={`text-[17px] font-bold pt-1.5 leading-snug ${headingColor}`}>
                {inner}
              </h1>
            );
          }
          if (level === 2) {
            return (
              <h2 key={idx} className={`text-[15.5px] font-bold pt-1.5 leading-snug ${headingColor}`}>
                {inner}
              </h2>
            );
          }
          if (level === 3) {
            return (
              <h3 key={idx} className={`text-[14px] font-semibold pt-1 leading-snug ${headingColor}`}>
                {inner}
              </h3>
            );
          }
          return (
            <h4 key={idx} className={`text-[13px] font-semibold pt-0.5 leading-snug ${subHeadingColor}`}>
              {inner}
            </h4>
          );
        }

        if (trimmed.startsWith("> ")) {
          return (
            <blockquote
              key={idx}
              className={`border-l-2 pl-3 py-0.5 italic rounded-r-lg ${
                palette?.isLightBg
                  ? "border-[#0D1117]/40 text-[#0D1117]/90 bg-black/[0.06]"
                  : "border-[#42A0FF]/70 text-[#DCDCDC] bg-white/[0.04]"
              }`}
            >
              {renderInlineMarkdown(trimmed.slice(2), 0, palette)}
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
              <span className={`font-medium shrink-0 tabular-nums ${markerColor}`}>
                {orderedMatch[2]}
              </span>
              <span className="flex-1 min-w-0 break-words">
                {renderInlineMarkdown(orderedMatch[3], 0, palette)}
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
              <span className={`mt-0.5 shrink-0 ${markerColor}`}>
                {indentLevel > 0 ? "◦" : "•"}
              </span>
              <span className="flex-1 min-w-0 break-words">
                {renderInlineMarkdown(bulletMatch[2], 0, palette)}
              </span>
            </div>
          );
        }

        return (
          <p key={idx} className="break-words leading-relaxed">
            {renderInlineMarkdown(line, 0, palette)}
          </p>
        );
      })}
    </div>
  );
}

/**
 * Tela de Conversa rica por Agente ou Canal em Equipe com fidelidade visual ao criativo .
 */
export const AgentConversationView: React.FC<AgentConversationViewProps> = ({
  mode,
  agente,
  canal,
  allAgentes = [],
  arquivos = [],
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
  hideInlineThreadTabs = false,
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
  onSubmitUiBlock,
  onSaveSkillSuggestion,
  onDismissSkillSuggestion,
  onOpenSharedTables,
  onOpenFilePreview,
  onOpenImageLightbox,
  takeoverSession = null,
  secretRequest = null,
  captureRequest = null,
  usageLimitAsk = null,
  sendShortcut = "enter",
  compactActions = false,
  showAgentSteps = true,
  userBubbleColor = "#2A2A2A",
  solidBubbles = true,
  onClearHistory,
  liveVoiceEnabled = false,
  liveVoiceActive = false,
  onOpenTakeover,
  onCancelTakeover,
  onSubmitSecret,
  onAuthorizeScreenCapture,
  onDeclineScreenCapture,
  onResolveUsageLimit,
  onToggleLiveVoice,
}) => {
  const [draft, setDraft] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<AnexoChat[]>([]);
  const [pageContext, setPageContext] = useState<string | null>(null);
  const [dismissedUsageAskIds, setDismissedUsageAskIds] = useState<string[]>([]);

  const effectiveUsageLimitAsk = useMemo<UsageLimitAskPayload | null>(() => {
    if (usageLimitAsk && !dismissedUsageAskIds.includes(usageLimitAsk.ask_id)) {
      return usageLimitAsk;
    }
    const lastMsg = mensagens[mensagens.length - 1];
    if (!lastMsg || lastMsg.autor === "usuario") return null;
    const meta = (lastMsg as unknown as { metadados?: Record<string, unknown> }).metadados;
    if (!meta || meta.usage_limit_resolved) return null;
    const candidate = meta.usage_limit_ask as UsageLimitAskPayload | undefined;
    if (candidate && typeof candidate.ask_id === "string" && !dismissedUsageAskIds.includes(candidate.ask_id)) {
      return candidate;
    }
    return null;
  }, [dismissedUsageAskIds, mensagens, usageLimitAsk]);

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
  const [cursorPos, setCursorPos] = useState(0);
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);
  const [dismissedTriggerKey, setDismissedTriggerKey] = useState<string | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingLevel, setRecordingLevel] = useState(0);
  const [transcribingVoice, setTranscribingVoice] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [confirmClearHistory, setConfirmClearHistory] = useState(false);
  const [clearingHistory, setClearingHistory] = useState(false);

  const operatorPalette = useMemo(
    () => computeBubbleColors(userBubbleColor, "#2A2A2A"),
    [userBubbleColor]
  );
  const [pendingFailedAudio, setPendingFailedAudio] = useState<{
    file: File;
    message: string;
  } | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const voiceRafRef = useRef<number | null>(null);
  const recordTimerRef = useRef<number | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const cancelledRecordRef = useRef<boolean>(false);
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
  const agentAvatar = resolveAgentAvatarConfig(agente, agente?.agente_id ?? "estrategista");

  const lastLiveStep = liveRun?.steps?.[liveRun.steps.length - 1];
  const liveMood = isWorking
    ? "working"
    : takeoverSession || secretRequest || captureRequest || usageLimitAsk
      ? "waiting"
      : "idle";
  const liveActivity = inferTaskContextFromActivity({
    mood: liveMood,
    toolName: lastLiveStep?.ferramenta ?? null,
    statusText: liveRun?.statusText ?? lastLiveStep?.titulo ?? null,
    isStreaming: Boolean(liveRun?.streamingText),
    awaitingApproval: Boolean(
      takeoverSession || secretRequest || captureRequest || usageLimitAsk
    ),
    agentStatus: agente?.status ?? null,
  });

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
      const vis = resolveAgentAvatarConfig(match, id);
      return {
        agente_id: id,
        ...vis,
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
    const ctxToSend = pageContext;
    setDraft("");
    setPendingAttachments([]);
    await onSendMessage(textToSend, filesToSend, ctxToSend);
  };

  const rawTrigger = useMemo(() => detectComposerTrigger(draft, cursorPos), [draft, cursorPos]);
  const triggerKey = rawTrigger
    ? `${rawTrigger.kind}:${rawTrigger.startIndex}:${rawTrigger.query}`
    : null;
  const activeTrigger =
    rawTrigger && triggerKey && triggerKey !== dismissedTriggerKey ? rawTrigger : null;

  const autocompleteItems = useMemo(
    () =>
      buildComposerAutocompleteItems({
        trigger: activeTrigger,
        agentes: allAgentes,
        arquivos,
        capabilities: {
          allowNewChat: mode === "agent" && !activeThread && allowNewChat && Boolean(onStartNewChat),
          hasSideQuestion: mode === "agent" && Boolean(onAskSideQuestion),
          hasSharedTables: Boolean(onOpenSharedTables),
        },
      }),
    [
      activeThread,
      activeTrigger,
      allAgentes,
      allowNewChat,
      arquivos,
      mode,
      onAskSideQuestion,
      onOpenSharedTables,
      onStartNewChat,
    ]
  );

  useEffect(() => {
    setAutocompleteIndex(0);
  }, [triggerKey]);

  useEffect(() => {
    if (!triggerKey && dismissedTriggerKey) {
      setDismissedTriggerKey(null);
    }
  }, [dismissedTriggerKey, triggerKey]);

  const applyComposerItem = (item: ComposerAutocompleteItem) => {
    if (!activeTrigger) return;
    const before = draft.slice(0, activeTrigger.startIndex);
    const after = draft.slice(activeTrigger.endIndex);

    if (item.kind === "slash") {
      if (item.command.action) {
        const cleaned = `${before}${after.replace(/^\s+/, "")}`;
        setDraft(cleaned);
        setCursorPos(before.length);
        setDismissedTriggerKey(null);
        if (item.command.action === "new_chat") {
          void onStartNewChat?.();
        } else if (item.command.action === "side_question") {
          setSidePanelOpen(true);
        } else if (item.command.action === "attach_file") {
          fileInputRef.current?.click();
        } else if (item.command.action === "open_tables") {
          onOpenSharedTables?.();
        }
        return;
      }

      const insertText = item.command.template ?? `${item.command.command} `;
      const nextText = `${before}${insertText}${after}`;
      const nextCursor = before.length + insertText.length;
      setDraft(nextText);
      setCursorPos(nextCursor);
      setDismissedTriggerKey(null);
      window.requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
      });
      return;
    }

    if (item.kind === "agent") {
      const insertText = `@${item.agente.agente_id} `;
      const nextText = `${before}${insertText}${after}`;
      const nextCursor = before.length + insertText.length;
      setDraft(nextText);
      setCursorPos(nextCursor);
      setDismissedTriggerKey(null);
      window.requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
      });
      return;
    }

    if (item.kind === "file") {
      const insertText = `@${item.arquivo.nome_original} `;
      const nextText = `${before}${insertText}${after}`;
      const nextCursor = before.length + insertText.length;
      setDraft(nextText);
      setCursorPos(nextCursor);
      setDismissedTriggerKey(null);
      setPendingAttachments((prev) => {
        if (prev.some((att) => att.caminho_relativo === item.arquivo.caminho_relativo)) {
          return prev;
        }
        return [
          ...prev,
          {
            arquivo_id: item.arquivo.arquivo_id,
            nome: item.arquivo.nome_original,
            caminho_relativo: item.arquivo.caminho_relativo,
            url: `/api/arquivos/arquivo?path=${encodeURIComponent(item.arquivo.caminho_relativo)}`,
            mime_type: item.arquivo.mime_type,
            tamanho_bytes: item.arquivo.tamanho_bytes,
            tipo_uso: item.arquivo.tipo_uso,
          },
        ];
      });
      window.requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
      });
    }
  };

  const cleanupVoiceCapture = () => {
    if (voiceRafRef.current !== null) {
      window.cancelAnimationFrame(voiceRafRef.current);
      voiceRafRef.current = null;
    }
    if (recordTimerRef.current !== null) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // Ignora falha ao finalizar gravador no cleanup
      }
    }
    mediaRecorderRef.current = null;
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => undefined);
      audioCtxRef.current = null;
    }
    setRecordingLevel(0);
  };

  useEffect(() => {
    return () => {
      cancelledRecordRef.current = true;
      cleanupVoiceCapture();
    };
  }, []);

  const formatRecordingTimer = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  const blobToBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = typeof reader.result === "string" ? reader.result : "";
        const commaIdx = result.indexOf(",");
        resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
      };
      reader.onerror = () => reject(new Error("Falha ao ler o áudio gravado."));
      reader.readAsDataURL(blob);
    });

  const stopRecordingAndTranscribe = () => {
    cancelledRecordRef.current = false;
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.stop();
    } else {
      cleanupVoiceCapture();
      setListeningVoice(false);
    }
  };

  const cancelVoiceRecording = () => {
    cancelledRecordRef.current = true;
    setListeningVoice(false);
    setRecordingSeconds(0);
    cleanupVoiceCapture();
  };

  const handleAttachFailedAudio = async () => {
    if (!pendingFailedAudio) return;
    setUploading(true);
    try {
      const uploaded = await onUploadFile(pendingFailedAudio.file);
      setPendingAttachments((prev) => [...prev, uploaded]);
      setVoiceError(null);
      setPendingFailedAudio(null);
    } catch (err) {
      setVoiceError(
        err instanceof Error ? err.message : "Não foi possível anexar o arquivo de áudio."
      );
    } finally {
      setUploading(false);
    }
  };

  const handleVoiceDictation = async () => {
    if (transcribingVoice) return;
    if (listeningVoice) {
      stopRecordingAndTranscribe();
      return;
    }
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setVoiceError("Captura de microfone indisponível neste ambiente.");
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      setVoiceError("MediaRecorder indisponível para gravação de áudio.");
      return;
    }

    setVoiceError(null);
    setPendingFailedAudio(null);
    cancelledRecordRef.current = false;
    recordChunksRef.current = [];
    setRecordingSeconds(0);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      const mimeCandidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ];
      const chosenMime =
        mimeCandidates.find(
          (candidate) =>
            typeof MediaRecorder.isTypeSupported === "function" &&
            MediaRecorder.isTypeSupported(candidate)
        ) ?? "";

      const recorder = chosenMime
        ? new MediaRecorder(stream, { mimeType: chosenMime })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        audioCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const sampleLevel = () => {
          if (!micStreamRef.current) return;
          analyser.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i += 1) sum += data[i];
          const avg = Math.min(100, Math.round((sum / Math.max(1, data.length)) * 1.6));
          setRecordingLevel(avg);
          voiceRafRef.current = window.requestAnimationFrame(sampleLevel);
        };
        voiceRafRef.current = window.requestAnimationFrame(sampleLevel);
      }

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          recordChunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = async () => {
        const wasCancelled = cancelledRecordRef.current;
        const chunks = [...recordChunksRef.current];
        const mimeType = recorder.mimeType || chosenMime || "audio/webm";
        cleanupVoiceCapture();
        setListeningVoice(false);

        if (wasCancelled || chunks.length === 0) {
          setRecordingSeconds(0);
          return;
        }

        const audioBlob = new Blob(chunks, { type: mimeType });
        setTranscribingVoice(true);
        try {
          const base64 = await blobToBase64(audioBlob);
          const res = await daemonApi.transcribeAudio(base64, mimeType);
          const cleanText = res.texto?.trim();
          if (cleanText) {
            setDraft((prev) => (prev.trim() ? `${prev.trim()} ${cleanText}` : cleanText));
            window.requestAnimationFrame(() => textareaRef.current?.focus());
          } else {
            setVoiceError("Nenhuma fala foi detectada na gravação.");
          }
        } catch (err) {
          const msg =
            err instanceof Error
              ? err.message
              : "Não foi possível transcrever o áudio. Verifique sua chave de transcrição em Conexões.";
          const audioFile = new File([audioBlob], "audio-pedido.webm", { type: mimeType });
          setVoiceError(msg);
          setPendingFailedAudio({ file: audioFile, message: msg });
        } finally {
          setTranscribingVoice(false);
          setRecordingSeconds(0);
        }
      };

      recorder.start(250);
      setListeningVoice(true);
      recordTimerRef.current = window.setInterval(() => {
        setRecordingSeconds((sec) => sec + 1);
      }, 1000);
    } catch {
      cleanupVoiceCapture();
      setListeningVoice(false);
      setVoiceError(
        "Permissão de microfone negada ou dispositivo indisponível. Libere o acesso no sistema e tente novamente."
      );
    }
  };

  return (
    <div
      data-compact-actions={compactActions ? "true" : "false"}
      className="flex-1 min-w-0 h-full bg-[#1A1A1A] flex overflow-hidden"
    >
      <div className="flex-1 min-w-0 h-full flex flex-col overflow-hidden">
        {!hideInlineThreadTabs && mode === "agent" && onSelectThread && onCreateQuickThread && (
          <ThreadTabsBar
            threads={threads}
            activeThreadId={activeThread?.thread_id ?? null}
            onSelectThread={onSelectThread}
            onStartNewTaskTab={onCreateQuickThread}
            onDismissThreadTab={onDismissThreadTab}
          />
        )}

        {/* Cabeçalho da conversa com botão central de Modelo + Esforço  */}
        <div className="h-[48px] shrink-0 border-b border-white/[0.06] px-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {mode === "channel" ? (
              <ChannelMascoteCluster members={channelMembers} size={34} />
            ) : (
              <MascoteAvatar
                avatar={agentAvatar}
                agentKey={agente?.agente_id}
                size={36}
                mood={liveMood}
                activity={liveActivity}
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

          <div className={`flex items-center shrink-0 ${compactActions ? "gap-1" : "gap-2"}`}>
            <button
              type="button"
              onClick={() => onOpenSharedTables?.()}
              aria-label="Abrir tabelas SQL compartilhadas"
              title="Tabelas SQL"
              className={`inline-flex items-center gap-1 rounded-lg border border-white/[0.06] bg-[#212121] font-semibold text-[#DCDCDC] transition hover:bg-[#242424] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7] ${
                compactActions ? "h-7 px-1.5 text-[11px]" : "h-8 px-2 text-[12px]"
              }`}
            >
              <Database className="h-3.5 w-3.5 text-[#42A0FF]" />
              <span>Tabelas SQL</span>
            </button>

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

            {onClearHistory && !activeThread && mensagens.length > 0 && (
              confirmClearHistory ? (
                <div className="inline-flex items-center gap-1 rounded-lg border border-[#FD2F3B]/40 bg-[#141414] px-2 py-1 text-[11px]">
                  <span className="text-[#FF7675] font-medium">Apagar histórico?</span>
                  <button
                    type="button"
                    disabled={clearingHistory}
                    onClick={async () => {
                      setClearingHistory(true);
                      try {
                        await onClearHistory();
                        setConfirmClearHistory(false);
                      } finally {
                        setClearingHistory(false);
                      }
                    }}
                    className="rounded px-1.5 py-0.5 bg-[#FD2F3B] text-white font-semibold hover:bg-[#e12732]"
                  >
                    Sim
                  </button>
                  <button
                    type="button"
                    disabled={clearingHistory}
                    onClick={() => setConfirmClearHistory(false)}
                    className="rounded px-1.5 py-0.5 bg-[#2A2A2A] text-[#DCDCDC] hover:bg-[#333336]"
                  >
                    Não
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  title="Apagar histórico do chat"
                  aria-label="Apagar histórico do chat"
                  onClick={() => setConfirmClearHistory(true)}
                  className="h-8 w-8 rounded-lg flex items-center justify-center text-[#979797] hover:bg-[#FD2F3B]/15 hover:text-[#FF7675] transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )
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
              <MascoteAvatar
                avatar={agentAvatar}
                agentKey={agente?.agente_id}
                size={68}
                animated={isWorking}
                trackCursor
                mood={liveMood}
                activity={liveActivity}
              />
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

            if (msg.item_type === "memory-changes") {
              const count = msg.memory_changes?.length ?? 0;
              const summaryText =
                msg.conteudo_markdown?.trim() ||
                (count > 0
                  ? `${count} memória(s) revisada(s) automaticamente em segundo plano`
                  : "Memórias revisadas automaticamente");
              return (
                <div
                  key={msg.mensagem_id}
                  id={`msg-anchor-${msg.mensagem_id}`}
                  className="my-2 flex items-center gap-2 max-w-[820px] mr-auto px-2 text-[12px] font-normal text-[#979797]"
                >
                  <Sparkles className="h-3.5 w-3.5 text-[#42A0FF] shrink-0" />
                  <span className="truncate">{summaryText}</span>
                </div>
              );
            }

            if (msg.item_type?.startsWith("visual-reply:") && msg.visual_page) {
              return (
                <div
                  key={msg.mensagem_id}
                  id={`msg-anchor-${msg.mensagem_id}`}
                  className="max-w-[820px] mr-auto w-full"
                >
                  <ChatVisualReply
                    agenteId={msg.agente_id ?? agente?.agente_id ?? "estrategista"}
                    visualMeta={msg.visual_page}
                    onSendMessageFromPage={(text) => {
                      void onSendMessage(text, [], pageContext);
                    }}
                    onUpdatePageContext={(ctxText) => setPageContext(ctxText || null)}
                    onOpenImageLightbox={onOpenImageLightbox}
                  />
                </div>
              );
            }

            if (msg.item_type === "ui-block" && msg.ui_block) {
              const handleCardSubmit = async (payload: UiBlockSubmitPayload) => {
                await onSubmitUiBlock?.(payload);
              };
              return (
                <div
                  key={msg.mensagem_id}
                  id={`msg-anchor-${msg.mensagem_id}`}
                  className="max-w-[820px] mr-auto w-full"
                >
                  {msg.ui_block.tipo_ferramenta === "ask_user" && (
                    <ConversationQuestionPrompt bloco={msg.ui_block} onSubmit={handleCardSubmit} />
                  )}
                  {msg.ui_block.tipo_ferramenta === "ask_ui" && (
                    <UiBlockPrompt bloco={msg.ui_block} onSubmit={handleCardSubmit} />
                  )}
                  {msg.ui_block.tipo_ferramenta === "acknowledge_request" && (
                    <AcknowledgeRequestCard bloco={msg.ui_block} onSubmit={handleCardSubmit} />
                  )}
                  {msg.ui_block.tipo_ferramenta === "request_api_key" && (
                    <ApiKeyRequestCard bloco={msg.ui_block} onSubmit={handleCardSubmit} />
                  )}
                </div>
              );
            }

            if (msg.item_type?.startsWith("skill-suggestion:") && msg.skill_sugestao) {
              return (
                <div
                  key={msg.mensagem_id}
                  id={`msg-anchor-${msg.mensagem_id}`}
                  className="max-w-[820px] mr-auto w-full"
                >
                  <SkillSuggestionChatCard
                    sugestao={msg.skill_sugestao}
                    onSave={onSaveSkillSuggestion}
                    onDismiss={onDismissSkillSuggestion}
                  />
                </div>
              );
            }

            const isUser = msg.autor === "usuario";
            const blocks = splitMarkdownBlocks(msg.conteudo_markdown);
            const senderAgentForMsg =
              !isUser && mode === "channel" && msg.agente_id
                ? allAgentes.find((a) => a.agente_id === msg.agente_id)
                : !isUser
                  ? agente
                  : undefined;
            const customAgentChatColor = (
              senderAgentForMsg?.config as Record<string, unknown> | undefined
            )?.chat_color as string | null | undefined;
            const agentBubblePalette = computeBubbleColors(customAgentChatColor, "#212121");
            const isHighlighted = highlightedMessageId === msg.mensagem_id;
            const isPinned = pins.some((p) => p.mensagem_id === msg.mensagem_id);
            const isWhatsAppMsg =
              (msg.metadados as Record<string, unknown> | undefined)?.origem === "whatsapp";
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
                {!isUser && (() => {
                  const senderAgent =
                    mode === "channel" && msg.agente_id
                      ? allAgentes.find((a) => a.agente_id === msg.agente_id)
                      : undefined;
                  const msgAvatar = senderAgent
                    ? resolveAgentAvatarConfig(senderAgent, msg.agente_id ?? undefined)
                    : agentAvatar;
                  return (
                    <div className="pt-1 shrink-0">
                      <MascoteAvatar
                        avatar={msgAvatar}
                        agentKey={msg.agente_id ?? agente?.agente_id}
                        size={38}
                      />
                    </div>
                  );
                })()}

                <div
                  className={`min-w-0 ${
                    isUser
                      ? "flex flex-col items-end max-w-[78%]"
                      : "flex-1 space-y-3"
                  }`}
                >
                  <div
                    style={
                      isUser
                        ? {
                            backgroundColor: operatorPalette.backgroundColor,
                            color: operatorPalette.textColor,
                            borderColor: operatorPalette.borderColor,
                          }
                        : undefined
                    }
                    className={`min-w-0 w-full ${
                      isUser
                        ? "border rounded-[18px] px-4 py-2.5 shadow-sm"
                        : "space-y-2.5"
                    }`}
                  >
                  {isUser && isWhatsAppMsg && (
                    <div className="mb-1 inline-flex items-center gap-1 rounded-full bg-[#31CF76]/15 px-2 py-0.5 text-[10.5px] font-semibold text-[#31CF76]">
                      <Smartphone className="h-2.5 w-2.5" />
                      <span>WhatsApp</span>
                    </div>
                  )}
                  {!isUser && msg.autor_nome && (
                    <div className="text-[11.5px] font-semibold text-[#979797] flex items-center gap-2">
                      <span>{msg.autor_nome}</span>
                      {isWhatsAppMsg && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#31CF76]/15 px-2 py-0.5 text-[10.5px] font-semibold text-[#31CF76]">
                          <Smartphone className="h-2.5 w-2.5" />
                          <span>WhatsApp</span>
                        </span>
                      )}
                      <span className="text-[#6A6A6A] font-normal">
                        {new Date(msg.criado_em).toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  )}

                  {/* Passos de execução colapsáveis */}
                  {!isUser && showAgentSteps && msg.steps && msg.steps.length > 0 && (
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
                  <div
                    className={`text-[13.5px] leading-relaxed ${
                      isUser
                        ? "space-y-2"
                        : solidBubbles
                          ? "space-y-1.5"
                          : "space-y-3 text-[#DCDCDC]"
                    }`}
                  >
                    {blocks.map((block, bIdx) => {
                      if (block.type === "code") {
                        if (block.language?.toLowerCase() === "mermaid") {
                          return <MermaidDiagram key={bIdx} chart={block.content} />;
                        }
                        return (
                          <CodePreview
                            key={bIdx}
                            code={block.content}
                            language={block.language}
                          />
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

                      if (isUser) {
                        return (
                          <div key={bIdx}>
                            {renderFormattedMarkdownText(block.content, operatorPalette)}
                          </div>
                        );
                      }

                      if (!solidBubbles) {
                        return <div key={bIdx}>{renderFormattedMarkdownText(block.content)}</div>;
                      }

                      const chunks = splitMarkdownIntoBubbleChunks(block.content);
                      return chunks.map((chunk, cIdx) => (
                        <div
                          key={`${bIdx}-${cIdx}`}
                          data-testid="agent-reply-bubble"
                          style={{
                            backgroundColor: agentBubblePalette.backgroundColor,
                            color: agentBubblePalette.textColor,
                            borderColor: agentBubblePalette.borderColor,
                          }}
                          className="w-fit max-w-full rounded-[18px] border px-4 py-2.5 shadow-sm"
                        >
                          {renderFormattedMarkdownText(chunk, agentBubblePalette)}
                        </div>
                      ));
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
                              <button
                                type="button"
                                onClick={() => {
                                  if (onOpenImageLightbox) {
                                    onOpenImageLightbox(anexo.url, anexo.nome);
                                  } else {
                                    onOpenFilePreview?.(anexo);
                                  }
                                }}
                                aria-label={`Ampliar imagem ${anexo.nome}`}
                                className="block w-full text-left"
                              >
                                <img
                                  src={anexo.url}
                                  alt={anexo.nome}
                                  className="max-h-44 w-full object-cover bg-[#101010]"
                                />
                              </button>
                            )}
                            {isVideo && (
                              <video
                                src={anexo.url}
                                controls
                                className="max-h-52 w-full bg-black"
                              />
                            )}
                            <div className="px-3 py-2 flex items-center justify-between gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  if (isImage && onOpenImageLightbox) {
                                    onOpenImageLightbox(anexo.url, anexo.nome);
                                  } else {
                                    onOpenFilePreview?.(anexo);
                                  }
                                }}
                                className="flex items-center gap-2 min-w-0 text-left hover:opacity-90"
                              >
                                {isImage ? (
                                  <ImageIcon className="h-3.5 w-3.5 text-[#31CF76] shrink-0" />
                                ) : (
                                  <FileText className="h-3.5 w-3.5 text-[#42A0FF] shrink-0" />
                                )}
                                <span className="text-[12px] text-white truncate">{anexo.nome}</span>
                              </button>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {onOpenFilePreview && (
                                  <button
                                    type="button"
                                    onClick={() => onOpenFilePreview(anexo)}
                                    title="Abrir prévia"
                                    aria-label={`Abrir prévia de ${anexo.nome}`}
                                    className="text-[#979797] hover:text-white"
                                  >
                                    <Eye className="h-3.5 w-3.5" />
                                  </button>
                                )}
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

                  {isUser && msg.reacao_emoji && (
                    <span
                      data-testid={`reaction-pill-${msg.mensagem_id}`}
                      aria-label={`Reação do agente: ${msg.reacao_emoji}`}
                      className="mt-1 bg-[#242424] border border-white/12 px-2 py-1 rounded-full text-[12px] leading-none select-none"
                    >
                      {msg.reacao_emoji}
                    </span>
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

        {/* Feedback ao vivo estilo Criativo Studio enquanto o agente executa */}
        {isWorking && (() => {
          const activeImageStep = liveRun?.steps.find(
            (st) => st.ferramenta?.includes("generate_image") && st.status === "executando"
          );
          const previewAspectClass =
            activeImageStep?.formato === "9:16"
              ? "aspect-[9/16] max-w-[210px]"
              : activeImageStep?.formato === "1:1"
                ? "aspect-square max-w-[260px]"
                : activeImageStep?.formato === "16:9"
                  ? "aspect-video max-w-[340px]"
                  : "aspect-[3/4] max-w-[250px]";
          return (
          <div className="flex gap-3 max-w-[820px] mr-auto pt-1" role="status" aria-live="polite">
            <div className="pt-0.5 shrink-0 flex flex-col items-center">
              <div className="flex items-center gap-1 mb-1">
                <span className="h-1 w-1 rounded-full bg-[#A855F7] animate-bounce [animation-delay:-0.25s]" />
                <span className="h-1 w-1 rounded-full bg-[#A855F7] animate-bounce [animation-delay:-0.12s]" />
                <span className="h-1 w-1 rounded-full bg-[#A855F7] animate-bounce" />
              </div>
              <MascoteAvatar
                avatar={agentAvatar}
                agentKey={agente?.agente_id}
                size={44}
                animated
                mood="working"
                activity={liveActivity}
              />
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

              {activeImageStep && (
                <div
                  data-testid="image-generating-preview"
                  className={`studio-image-generating-card w-full ${previewAspectClass} flex flex-col items-center justify-end p-4`}
                >
                  <div className="relative z-10 w-full rounded-xl bg-[#141414]/80 backdrop-blur-md border border-white/10 px-3 py-2 text-center space-y-1">
                    <div className="flex items-center justify-center gap-1.5 text-[12px] font-semibold text-white">
                      <Loader2 className="h-3.5 w-3.5 text-[#42A0FF] animate-spin" />
                      <span>Gerando imagem{activeImageStep.formato ? ` (${activeImageStep.formato})` : ""}...</span>
                    </div>
                    <p className="text-[11px] text-[#979797] truncate">
                      {activeImageStep.titulo || "Compondo iluminação e referências"}
                    </p>
                  </div>
                </div>
              )}

              {showAgentSteps && liveRun && liveRun.steps.length > 0 && (
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

              {liveRun && liveRun.streamingText.trim().length > 0 && (() => {
                const liveAgentColor = (
                  agente?.config as Record<string, unknown> | undefined
                )?.chat_color as string | null | undefined;
                const livePalette = computeBubbleColors(liveAgentColor, "#212121");
                return (
                <div className="space-y-1.5 text-[13.5px] leading-relaxed text-[#DCDCDC]">
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
                    ) : solidBubbles ? (
                      splitMarkdownIntoBubbleChunks(block.content).map((chunk, cIdx) => (
                        <div
                          key={`${bIdx}-${cIdx}`}
                          style={{
                            backgroundColor: livePalette.backgroundColor,
                            color: livePalette.textColor,
                            borderColor: livePalette.borderColor,
                          }}
                          className="w-fit max-w-full rounded-[18px] border px-4 py-2.5 shadow-sm"
                        >
                          {renderFormattedMarkdownText(chunk, livePalette)}
                        </div>
                      ))
                    ) : (
                      <div key={bIdx}>{renderFormattedMarkdownText(block.content)}</div>
                    )
                  )}
                </div>
                );
              })()}
            </div>
          </div>
          );
        })()}

        {takeoverSession && (
          <div className="max-w-[820px] mr-auto">
            <BrowserTakeoverCard
              takeoverId={takeoverSession.takeoverId}
              tabId={takeoverSession.tabId}
              reason={takeoverSession.reason}
              url={takeoverSession.url}
              title={takeoverSession.title}
              previewDataUrl={takeoverSession.previewDataUrl}
              onAssume={(tId) => onOpenTakeover?.(tId)}
              onCancel={async (tId) => {
                await onCancelTakeover?.(tId);
              }}
            />
          </div>
        )}

        {secretRequest && (
          <div className="max-w-[820px] mr-auto">
            <BrowserSecretCard
              request={secretRequest}
              onSubmitSecret={async (tId, payload) => {
                await onSubmitSecret?.(tId, payload);
              }}
              onAssumeManually={onOpenTakeover ? (tId) => onOpenTakeover(tId) : undefined}
            />
          </div>
        )}

        {captureRequest && (
          <div className="max-w-[820px] mr-auto">
            <CaptureScreenConsentCard
              captureId={captureRequest.captureId}
              agentName={titleName}
              purpose={captureRequest.purpose}
              targetHint={captureRequest.targetHint}
              onAuthorizeCapture={async (cId, payload) => {
                await onAuthorizeScreenCapture?.(cId, payload);
              }}
              onDeclineCapture={async (cId, reason) => {
                await onDeclineScreenCapture?.(cId, reason);
              }}
            />
          </div>
        )}

        {effectiveUsageLimitAsk && (
          <div className="max-w-[820px] mr-auto">
            <UsageLimitAskCard
              ask={effectiveUsageLimitAsk}
              onResolve={async (payload) => {
                setDismissedUsageAskIds((prev) =>
                  prev.includes(payload.askId) ? prev : [...prev, payload.askId]
                );
                await onResolveUsageLimit?.(payload);
              }}
            />
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

      {/* Composer arredondado #212121  */}
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
          {pageContext && (
            <div className="mb-2 flex items-center justify-between gap-2 rounded-xl bg-[#242424] border border-white/12 px-3 py-1.5 text-[12px]">
              <div className="flex items-center gap-2 min-w-0">
                <Sparkles className="h-3.5 w-3.5 text-[#42A0FF] shrink-0" />
                <span className="font-semibold text-white shrink-0">
                  Contexto ativo da página
                </span>
                <span className="text-[#DCDCDC] truncate">{pageContext}</span>
              </div>
              <button
                type="button"
                onClick={() => setPageContext(null)}
                aria-label="Remover contexto da página"
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-semibold text-[#979797] hover:text-white shrink-0"
              >
                <X className="h-3.5 w-3.5" />
                <span>Limpar contexto</span>
              </button>
            </div>
          )}
        </div>

        <div className="max-w-[820px] mx-auto">
          <ComposerAutocomplete
            trigger={activeTrigger}
            items={autocompleteItems}
            selectedIndex={autocompleteIndex}
            onHoverIndex={setAutocompleteIndex}
            onSelect={applyComposerItem}
          />
        </div>

        <div className="max-w-[820px] mx-auto rounded-[22px] bg-[#212121] border border-white/10 px-3 py-2 shadow-lg">
          {listeningVoice && (
            <div className="mb-2 flex items-center justify-between gap-3 rounded-xl border border-[#FD2F3B]/35 bg-[#FD2F3B]/10 px-3 py-2 text-[12px]">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="h-2.5 w-2.5 rounded-full bg-[#FD2F3B] animate-pulse shrink-0" />
                <span className="font-semibold text-[#F8FAFC]">Gravando áudio</span>
                <span className="font-mono text-[11.5px] text-[#FCA5A5] tabular-nums">
                  {formatRecordingTimer(recordingSeconds)}
                </span>
                <div
                  className="flex items-end gap-0.5 h-4 ml-1"
                  aria-hidden="true"
                >
                  {[20, 40, 60, 80, 100].map((bar) => (
                    <span
                      key={bar}
                      style={{
                        height: `${Math.max(25, recordingLevel >= bar ? 100 : Math.max(25, Math.round(recordingLevel * 0.9)))}%`,
                      }}
                      className={`w-1 rounded-full transition-all ${
                        recordingLevel >= bar - 15 ? "bg-[#FD2F3B]" : "bg-[#FD2F3B]/35"
                      }`}
                    />
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={cancelVoiceRecording}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-[#1B1B1E] px-2.5 py-1 text-[11.5px] font-medium text-[#DCDCDC] hover:bg-[#2A2A2E]"
                >
                  <X className="h-3.5 w-3.5" />
                  <span>Cancelar</span>
                </button>
                <button
                  type="button"
                  onClick={stopRecordingAndTranscribe}
                  className="inline-flex items-center gap-1 rounded-lg bg-[#F0F0F0] px-2.5 py-1 text-[11.5px] font-semibold text-[#141414] hover:bg-white"
                >
                  <Check className="h-3.5 w-3.5" />
                  <span>Finalizar e transcrever</span>
                </button>
              </div>
            </div>
          )}

          {transcribingVoice && (
            <div className="mb-2 flex items-center gap-2 rounded-xl border border-[#42A0FF]/35 bg-[#42A0FF]/10 px-3 py-2 text-[12px] text-[#E0F2FE]">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#42A0FF]" />
              <span>Transcrevendo áudio...</span>
            </div>
          )}

          {voiceError && (
            <div className="mb-2 rounded-xl border border-[#FD2F3B]/35 bg-[#FD2F3B]/10 px-3 py-2 text-[12px] text-[#FECACA]">
              <div className="flex items-start justify-between gap-2">
                <span>{voiceError}</span>
                <button
                  type="button"
                  onClick={() => {
                    setVoiceError(null);
                    setPendingFailedAudio(null);
                  }}
                  aria-label="Fechar aviso de microfone"
                  className="text-[#FCA5A5] hover:text-white shrink-0"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              {(pendingFailedAudio || onOpenConnectors) && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {pendingFailedAudio && (
                    <button
                      type="button"
                      onClick={() => void handleAttachFailedAudio()}
                      disabled={uploading}
                      className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-[#1B1B1E] px-2.5 py-1 text-[11.5px] font-semibold text-[#F4F4F5] hover:bg-[#27272B]"
                    >
                      Anexar áudio gravado no chat
                    </button>
                  )}
                  {onOpenConnectors && (
                    <button
                      type="button"
                      onClick={() => {
                        setVoiceError(null);
                        onOpenConnectors();
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-[#42A0FF]/40 bg-[#42A0FF]/15 px-2.5 py-1 text-[11.5px] font-semibold text-[#93C5FD] hover:bg-[#42A0FF]/25"
                    >
                      Configurar chave em Conexões
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

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
              ref={textareaRef}
              id="composer-message-input"
              name="composer_message"
              aria-label={`Mensagem para ${titleName}`}
              rows={1}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setCursorPos(e.target.selectionStart ?? e.target.value.length);
              }}
              onClick={(e) => {
                setCursorPos(e.currentTarget.selectionStart ?? e.currentTarget.value.length);
              }}
              onKeyUp={(e) => {
                setCursorPos(e.currentTarget.selectionStart ?? e.currentTarget.value.length);
              }}
              onKeyDown={(e) => {
                if (activeTrigger && autocompleteItems.length > 0) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setAutocompleteIndex((idx) => (idx + 1) % autocompleteItems.length);
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setAutocompleteIndex(
                      (idx) => (idx - 1 + autocompleteItems.length) % autocompleteItems.length
                    );
                    return;
                  }
                  if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault();
                    const picked = autocompleteItems[autocompleteIndex] ?? autocompleteItems[0];
                    if (picked) {
                      applyComposerItem(picked);
                    }
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    if (triggerKey) {
                      setDismissedTriggerKey(triggerKey);
                    }
                    return;
                  }
                }

                if (sendShortcut === "mod_enter") {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    void handleSend();
                  }
                } else if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder={
                uploading
                  ? "Enviando arquivo..."
                  : transcribingVoice
                    ? "Transcrevendo áudio..."
                    : sendShortcut === "mod_enter"
                      ? `Mensagem para ${titleName} (/ comandos · @ menções · Ctrl/⌘+Enter)`
                      : `Mensagem para ${titleName} (/ comandos · @ menções)`
              }
              className="flex-1 bg-transparent py-2 text-[13.5px] text-white placeholder-[#6A6A6A] focus:outline-none resize-none max-h-32"
            />

            {liveVoiceEnabled && onToggleLiveVoice && (
              <button
                type="button"
                onClick={onToggleLiveVoice}
                aria-label={liveVoiceActive ? "Encerrar voz contínua" : "Iniciar voz contínua"}
                title={liveVoiceActive ? "Encerrar voz contínua" : "Iniciar voz contínua"}
                className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold transition shrink-0 ${
                  liveVoiceActive
                    ? "border-[#007CF7] bg-[#007CF7]/20 text-[#42A0FF]"
                    : "border-white/[0.08] bg-[#141414] text-[#DCDCDC] hover:bg-[#242424]"
                }`}
              >
                <Radio className="h-3.5 w-3.5" />
                <span>{liveVoiceActive ? "Encerrar voz contínua" : "Iniciar voz contínua"}</span>
              </button>
            )}

            <button
              type="button"
              disabled={transcribingVoice}
              onClick={() => void handleVoiceDictation()}
              title={listeningVoice ? "Finalizar gravação e transcrever" : "Gravar pedido por voz"}
              aria-label={
                listeningVoice ? "Finalizar gravação de áudio" : "Gravar ou ditar pedido por voz"
              }
              className={`h-9 w-9 rounded-full flex items-center justify-center transition-colors shrink-0 disabled:opacity-40 ${
                listeningVoice
                  ? "bg-[#FD2F3B]/20 text-[#FD2F3B] ring-1 ring-[#FD2F3B]/50"
                  : "text-[#979797] hover:text-white hover:bg-[#2A2A2A]"
              }`}
            >
              {transcribingVoice ? (
                <Loader2 className="h-4 w-4 animate-spin text-[#42A0FF]" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
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
          agenteAvatar={agentAvatar}
          threadId={activeThread?.thread_id ?? null}
          onAsk={onAskSideQuestion}
          onClose={() => setSidePanelOpen(false)}
        />
      )}
    </div>
  );
};
