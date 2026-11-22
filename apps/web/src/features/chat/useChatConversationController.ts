import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AnexoChat,
  NivelEsforco,
  UsageLimitAskPayload,
} from "@criativo/contracts";
import { computeBubbleColors } from "./chat-bubble-theme";
import {
  inferTaskContextFromActivity,
  resolveAgentAvatarConfig,
} from "../../components/MascoteAvatar";
import { inferProviderFromModelId } from "../../components/ModelProviderPopover";
import {
  buildComposerAutocompleteItems,
  detectComposerTrigger,
  type ComposerAutocompleteItem,
} from "./ComposerAutocomplete";
import type { AgentConversationViewProps } from "./chat-types";
import { useChatVoiceRecorder } from "./useChatVoiceRecorder";

export function useChatConversationController(props: AgentConversationViewProps) {
  const {
    mode,
    agente,
    canal,
    allAgentes = [],
    arquivos = [],
    mensagens,
    sending,
    liveRun,
    onSendMessage,
    onUploadFile,
    prefilledDraft,
    activeThread = null,
    highlightedMessageId = null,
    editingQueueItem = null,
    onSaveEditQueueItem,
    onAskSideQuestion,
    onStartNewChat,
    onOpenSharedTables,
    takeoverSession = null,
    secretRequest = null,
    captureRequest = null,
    usageLimitAsk = null,
    userBubbleColor = "#2A2A2A",
  } = props;

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
  const [cursorPos, setCursorPos] = useState(0);
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);
  const [dismissedTriggerKey, setDismissedTriggerKey] = useState<string | null>(null);
  const [confirmClearHistory, setConfirmClearHistory] = useState(false);
  const [clearingHistory, setClearingHistory] = useState(false);

  const operatorPalette = useMemo(
    () => computeBubbleColors(userBubbleColor, "#2A2A2A"),
    [userBubbleColor]
  );

  const [elapsedSec, setElapsedSec] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const prevScrollHeightRef = useRef<number | null>(null);

  const voice = useChatVoiceRecorder({
    textareaRef,
    onUploadFile,
    setDraft,
    setPendingAttachments,
    setUploading,
  });

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
  const liveMood = (isWorking
    ? "working"
    : takeoverSession || secretRequest || captureRequest || usageLimitAsk
      ? "waiting"
      : "idle") as "working" | "waiting" | "idle";
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

  return {
    draft,
    setDraft,
    pendingAttachments,
    setPendingAttachments,
    pageContext,
    setPageContext,
    dismissedUsageAskIds,
    setDismissedUsageAskIds,
    effectiveUsageLimitAsk,
    uploading,
    setUploading,
    popoverOpen,
    setPopoverOpen,
    plusMenuOpen,
    setPlusMenuOpen,
    sidePanelOpen,
    setSidePanelOpen,
    editError,
    setEditError,
    savingEdit,
    openMessageMenuId,
    setOpenMessageMenuId,
    copiedId,
    expandedSteps,
    setExpandedSteps,
    cursorPos,
    setCursorPos,
    autocompleteIndex,
    setAutocompleteIndex,
    dismissedTriggerKey,
    setDismissedTriggerKey,
    confirmClearHistory,
    setConfirmClearHistory,
    clearingHistory,
    setClearingHistory,
    operatorPalette,
    elapsedSec,
    textareaRef,
    fileInputRef,
    messagesScrollRef,
    messagesEndRef,
    prevScrollHeightRef,
    isWorking,
    currentThreadId,
    allowNewChat,
    agentAvatar,
    liveMood,
    liveActivity,
    currentModel,
    currentEffort,
    currentProvider,
    titleName,
    channelMembers,
    handleCopy,
    handlePickFiles,
    handleSend,
    triggerKey,
    activeTrigger,
    autocompleteItems,
    applyComposerItem,
    ...voice,
  };
}

export type ChatConversationController = ReturnType<typeof useChatConversationController>;
