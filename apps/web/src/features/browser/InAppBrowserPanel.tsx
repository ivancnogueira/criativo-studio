import React, { useEffect, useMemo, useState } from "react";
import type { AvatarShape, BrowserTabSummary } from "@criativo/contracts";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Globe,
  Lock,
  Maximize2,
  Minimize2,
  Monitor,
  Plus,
  RotateCw,
  X,
} from "lucide-react";
import {
  MascoteAvatar,
  type AgentAvatarVisual,
} from "../../components/MascoteAvatar";
import { BrowserTeachBar } from "./BrowserTeachBar";
import { BrowserWindowActionsBar } from "./BrowserWindowActionsBar";
import { InAppBrowserRecorderPipControls } from "./InAppBrowserRecorderPipControls";
import {
  InAppBrowserViewport,
  type BrowserLiveFrame,
  type BrowserMouseKeyboardInput,
} from "./InAppBrowserViewport";

export type { BrowserLiveFrame, BrowserMouseKeyboardInput };

export interface InAppBrowserPanelProps {
  mode: "sidebar" | "expanded";
  /** `true` quando renderizado na janela separada multi-monitor (sem ações de destacar). */
  detached?: boolean;
  tabs: BrowserTabSummary[];
  activeTabId: string | null;
  framesByTab: Record<string, BrowserLiveFrame>;
  agentName: string;
  agentAvatar?: Partial<AgentAvatarVisual> | null;
  agentAvatarShape?: AvatarShape;
  agentAvatarColor?: string;
  agentWorking?: boolean;
  takeoverPending?: boolean;
  profileLabel?: string;
  teachRecording?: boolean;
  teachStartedAt?: number | null;
  teachStepsCount?: number;
  busy?: boolean;
  onSelectTab: (tabId: string) => void;
  onNewTab: () => void | Promise<void>;
  onCloseTab: (tabId: string) => void | Promise<void>;
  onNavigate: (tabId: string, url: string) => void | Promise<void>;
  onGoBack: (tabId: string) => void | Promise<void>;
  onGoForward: (tabId: string) => void | Promise<void>;
  onReload: (tabId: string) => void | Promise<void>;
  onExpand: () => void;
  onCollapseToChat: () => void;
  onClosePanel: () => void;
  onAssumeControl: (tabId: string) => void | Promise<void>;
  onCompleteControl: (tabId: string) => void | Promise<void>;
  onSendInput: (
    tabId: string,
    input: BrowserMouseKeyboardInput,
    autoAssume?: boolean
  ) => void | Promise<void>;
  onSendQuickChat?: (text: string) => void | Promise<void>;
  onStartTeach?: () => void | Promise<void>;
  onStopTeach?: (action: "save" | "discard") => void | Promise<void>;
}

function normalizeUrlInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "https://www.google.com";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.includes(".") && !trimmed.includes(" ")) return `https://${trimmed}`;
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

export const InAppBrowserPanel: React.FC<InAppBrowserPanelProps> = ({
  mode,
  detached = false,
  tabs,
  activeTabId,
  framesByTab,
  agentName,
  agentAvatar = null,
  agentAvatarShape = "hex",
  agentAvatarColor = "#42A0FF",
  agentWorking = false,
  takeoverPending = false,
  profileLabel = "Perfil Compartilhado",
  teachRecording = false,
  teachStartedAt = null,
  teachStepsCount = 0,
  busy = false,
  onSelectTab,
  onNewTab,
  onCloseTab,
  onNavigate,
  onGoBack,
  onGoForward,
  onReload,
  onExpand,
  onCollapseToChat,
  onClosePanel,
  onAssumeControl,
  onCompleteControl,
  onSendInput,
  onSendQuickChat,
  onStartTeach,
  onStopTeach,
}) => {
  const activeTab = tabs.find((t) => t.tabId === activeTabId) ?? tabs[0] ?? null;
  const resolvedTabId = activeTab?.tabId ?? "";
  const liveFrame = resolvedTabId ? framesByTab[resolvedTabId] : undefined;
  const currentUrl = liveFrame?.url || activeTab?.url || "about:blank";
  const currentTitle = liveFrame?.title || activeTab?.title || "Navegador";
  const isUserControlling = Boolean(liveFrame?.userControl ?? activeTab?.userControl);
  const isActiveTabUnloaded = Boolean(activeTab?.unloaded && !liveFrame?.dataUrl);

  const [addressDraft, setAddressDraft] = useState(currentUrl);
  const [showTeachBar, setShowTeachBar] = useState(false);
  const [tabOrder, setTabOrder] = useState<string[]>([]);
  const [dragTabId, setDragTabId] = useState<string | null>(null);

  const orderedTabs = useMemo(() => {
    const idx = new Map(tabOrder.map((id, i) => [id, i] as const));
    const rank = (t: BrowserTabSummary): number =>
      idx.get(t.tabId) ?? tabOrder.length + tabs.indexOf(t);
    return [...tabs].sort((a, b) => rank(a) - rank(b));
  }, [tabs, tabOrder]);
  const activeOrderIndex = orderedTabs.findIndex((t) => t.tabId === resolvedTabId);

  const moveTab = (tabId: string, direction: "left" | "right"): void => {
    const ids = orderedTabs.map((t) => t.tabId);
    const from = ids.indexOf(tabId);
    const to = direction === "left" ? from - 1 : from + 1;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to]!, ids[from]!];
    setTabOrder(ids);
  };

  const dropTabBefore = (targetId: string): void => {
    if (!dragTabId || dragTabId === targetId) return;
    const ids = orderedTabs.map((t) => t.tabId).filter((id) => id !== dragTabId);
    ids.splice(ids.indexOf(targetId), 0, dragTabId);
    setTabOrder(ids);
    setDragTabId(null);
  };

  const windowActions =
    !detached && resolvedTabId ? (
      <BrowserWindowActionsBar
        tabId={resolvedTabId}
        canMoveLeft={activeOrderIndex > 0}
        canMoveRight={activeOrderIndex >= 0 && activeOrderIndex < orderedTabs.length - 1}
        onMoveTab={(dir) => moveTab(resolvedTabId, dir)}
      />
    ) : null;

  useEffect(() => {
    setAddressDraft(currentUrl);
  }, [currentUrl, resolvedTabId]);

  if (mode === "sidebar") {
    return (
      <aside
        data-testid="inapp-browser-sidebar"
        className="w-full h-full flex flex-col bg-[#141416] text-[#F0F0F0] border-l border-white/[0.06] overflow-hidden"
      >
        {/* Header da coluna Navegador */}
        <div className="h-[48px] shrink-0 px-3.5 border-b border-white/[0.06] flex items-center justify-between gap-2 bg-[#111113]">
          <div className="flex items-center gap-2 min-w-0">
            <Globe className="h-4 w-4 text-[#42A0FF] shrink-0" />
            <span className="text-[13px] font-semibold truncate">Navegador</span>
            {isUserControlling && (
              <span className="rounded-full bg-[#007CF7]/15 px-2 py-0.5 text-[10px] font-semibold text-[#42A0FF]">
                Seu controle
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={onExpand}
              title="Expandir navegador"
              aria-label="Expandir navegador"
              className="h-7 w-7 rounded-lg flex items-center justify-center text-[#979797] hover:bg-[#242428] hover:text-white transition-colors"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onClosePanel}
              title="Fechar painel do navegador"
              aria-label="Fechar painel do navegador"
              className="h-7 w-7 rounded-lg flex items-center justify-center text-[#979797] hover:bg-[#242428] hover:text-white transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Corpo com preview clicável ao vivo */}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
          {windowActions}
          {tabs.length > 1 && (
            <div className="flex items-center gap-1 overflow-x-auto pb-1 no-scrollbar">
              {orderedTabs.map((tab) => {
                const selected = tab.tabId === resolvedTabId;
                return (
                  <button
                    key={tab.tabId}
                    type="button"
                    onClick={() => onSelectTab(tab.tabId)}
                    title={tab.unloaded ? `${tab.title || tab.url} (Suspensa)` : tab.title || tab.url}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium truncate max-w-[140px] border transition-colors ${
                      selected
                        ? "bg-[#212126] border-[#42A0FF]/40 text-white"
                        : "bg-[#19191C] border-white/[0.06] text-[#979797] hover:text-white"
                    } ${tab.unloaded ? "opacity-65" : ""}`}
                  >
                    {tab.unloaded ? `⏸ ${tab.title || tab.url}` : tab.title || tab.url}
                  </button>
                );
              })}
            </div>
          )}

          <button
            type="button"
            onClick={onExpand}
            aria-label="Abrir navegador em tela cheia"
            className="group w-full overflow-hidden rounded-xl border border-white/[0.08] bg-[#0D0D0F] text-left transition hover:border-[#42A0FF]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
          >
            <div className="relative aspect-[16/10] w-full bg-[#0A0A0C] flex items-center justify-center overflow-hidden">
              {liveFrame?.dataUrl ? (
                <img
                  src={liveFrame.dataUrl}
                  alt={currentTitle}
                  className="h-full w-full object-contain select-none"
                  draggable={false}
                />
              ) : isActiveTabUnloaded ? (
                <div className="flex flex-col items-center gap-2 p-4 text-center">
                  <Monitor className="h-6 w-6 text-[#979797]" />
                  <span className="text-[11.5px] font-medium text-[#DCDCDC]">
                    Aba suspensa para economizar memória
                  </span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 p-4 text-center">
                  <Monitor className="h-6 w-6 text-[#42A0FF]" />
                  <span className="text-[11.5px] text-[#979797]">
                    Carregando transmissão ao vivo...
                  </span>
                </div>
              )}
              <div className="pointer-events-none absolute inset-0 bg-black/0 group-hover:bg-black/25 transition flex items-center justify-center">
                <span className="opacity-0 group-hover:opacity-100 transition rounded-full bg-[#141416]/90 border border-white/10 px-3 py-1 text-[11px] font-semibold text-white">
                  Clique para expandir e interagir
                </span>
              </div>
            </div>
          </button>

          <div className="space-y-1 px-0.5">
            <p className="text-[13px] font-semibold text-white truncate">{currentTitle}</p>
            <p className="text-[11px] font-mono text-[#979797] truncate">{currentUrl}</p>
          </div>

          {resolvedTabId && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={onExpand}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#242429] hover:bg-[#2E2E35] border border-white/10 px-3 py-2 text-[12px] font-semibold text-white transition"
              >
                <Maximize2 className="h-3.5 w-3.5" />
                <span>Expandir</span>
              </button>

              {isUserControlling || takeoverPending ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onCompleteControl(resolvedTabId)}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#31CF76] hover:bg-[#3CE084] px-3 py-2 text-[12px] font-semibold text-[#0B1610] transition disabled:opacity-50"
                >
                  <Check className="h-3.5 w-3.5" />
                  <span>Terminei</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void onAssumeControl(resolvedTabId);
                    onExpand();
                  }}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#007CF7] hover:bg-[#198BFF] px-3 py-2 text-[12px] font-semibold text-white transition disabled:opacity-50"
                >
                  <Monitor className="h-3.5 w-3.5" />
                  <span>Assumir</span>
                </button>
              )}
            </div>
          )}
        </div>
      </aside>
    );
  }

  // Modo expanded (Tela cheia integrada no app)
  const isHttps = currentUrl.startsWith("https://");

  return (
    <div
      data-testid="inapp-browser-expanded"
      className="fixed inset-0 z-40 flex flex-col bg-[#0D0D0F] text-[#F0F0F0]"
    >
      {/* Top Bar com abas + Dynamic Pill do Agente + Voltar ao chat */}
      <header className="relative h-[46px] shrink-0 border-b border-white/[0.06] bg-[#0D0D0D] px-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-x-auto no-scrollbar">
          {orderedTabs.map((tab) => {
            const active = tab.tabId === resolvedTabId;
            return (
              <div
                key={tab.tabId}
                draggable
                onDragStart={() => setDragTabId(tab.tabId)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => dropTabBefore(tab.tabId)}
                className={`group flex items-center gap-1.5 h-[30px] pl-2.5 pr-1.5 rounded-lg text-[12px] max-w-[200px] shrink-0 transition-colors ${
                  active
                    ? "bg-[#1A1A1E] text-white border border-white/10"
                    : "text-[#979797] hover:bg-[#1A1A1E]/60 hover:text-white"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectTab(tab.tabId)}
                  title={tab.unloaded ? `${tab.title || tab.url || "Nova aba"} — Suspensa para economizar RAM` : undefined}
                  className={`flex items-center gap-1.5 min-w-0 text-left ${tab.unloaded ? "opacity-65" : ""}`}
                >
                  <Globe className={`h-3.5 w-3.5 shrink-0 ${tab.unloaded ? "text-[#979797]" : "text-[#31CF76]"}`} />
                  <span className="truncate font-medium">
                    {tab.title || tab.url || "Nova aba"}
                  </span>
                  {tab.unloaded && (
                    <span className="shrink-0 rounded bg-white/10 px-1 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-[#B4B4BD]">
                      Suspensa
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void onCloseTab(tab.tabId);
                  }}
                  aria-label={`Fechar aba ${tab.title || tab.url}`}
                  className="h-4 w-4 rounded flex items-center justify-center text-[#777777] hover:text-white hover:bg-white/10"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}

          <button
            type="button"
            onClick={() => void onNewTab()}
            title="Nova aba do navegador"
            aria-label="Nova aba do navegador"
            className="h-7 w-7 rounded-lg flex items-center justify-center text-[#979797] hover:bg-[#212121] hover:text-white transition-colors shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Pill central estilo Dynamic Island com agente + Assumir / Terminei */}
        <div className="hidden sm:flex items-center gap-2.5 h-[32px] pl-2.5 pr-1.5 rounded-full bg-[#000000] border border-white/10 shadow-[0_6px_20px_rgba(0,0,0,0.65)] shrink-0">
          <MascoteAvatar
            avatar={agentAvatar}
            shape={agentAvatarShape}
            color={agentAvatarColor}
            size={18}
            animated={agentWorking}
            mood={takeoverPending ? "waiting" : agentWorking ? "working" : "idle"}
            activity={takeoverPending ? "approval" : agentWorking ? "research" : "idle"}
          />
          <span className="text-[12px] font-medium text-[#DCDCDC] max-w-[140px] truncate">
            {agentName}
          </span>
          {resolvedTabId &&
            (isUserControlling ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void onCompleteControl(resolvedTabId)}
                className="inline-flex items-center gap-1 h-[24px] px-3 rounded-full bg-[#31CF76] hover:bg-[#3CE084] text-[#0B1610] text-[11.5px] font-semibold transition disabled:opacity-50"
              >
                <Check className="h-3 w-3" />
                <span>Terminei</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void onAssumeControl(resolvedTabId)}
                className="inline-flex items-center gap-1 h-[24px] px-3 rounded-full bg-[#007CF7] hover:bg-[#198BFF] text-white text-[11.5px] font-semibold transition disabled:opacity-50"
              >
                <Monitor className="h-3 w-3" />
                <span>Assumir</span>
              </button>
            ))}
        </div>

        {/* Direita: Gravar + PiP + Ensinar + Voltar ao chat */}
        <div className="flex items-center gap-2 shrink-0 flex-1 justify-end">
          <InAppBrowserRecorderPipControls tabId={resolvedTabId} />
          {windowActions}
          {onStartTeach && onStopTeach && (
            <button
              type="button"
              onClick={() => setShowTeachBar((v) => !v)}
              className={`h-[30px] px-2.5 rounded-lg text-[11.5px] font-medium border transition-colors ${
                teachRecording
                  ? "bg-[#FD2F3B]/15 border-[#FD2F3B]/40 text-[#FF7675]"
                  : "bg-[#1C1C20] border-white/10 text-[#CCCCCC] hover:text-white"
              }`}
            >
              {teachRecording ? `Gravando (${teachStepsCount})` : "Ensinar passos"}
            </button>
          )}
          <button
            type="button"
            onClick={onCollapseToChat}
            className="inline-flex items-center gap-1.5 h-[30px] rounded-full bg-[#242428] hover:bg-[#2E2E34] border border-white/10 px-3 text-[12px] font-semibold text-[#F0F0F0] transition"
          >
            <Minimize2 className="h-3.5 w-3.5" />
            <span>{detached ? "Fechar janela" : "Voltar ao chat"}</span>
          </button>
        </div>
      </header>

      {/* Barra de Endereço */}
      <div className="h-[42px] shrink-0 border-b border-white/[0.06] bg-[#141417] px-3 flex items-center gap-2">
        <div className="flex items-center gap-1 text-[#979797]">
          <button
            type="button"
            disabled={!resolvedTabId || busy}
            onClick={() => resolvedTabId && void onGoBack(resolvedTabId)}
            aria-label="Voltar página"
            className="h-7 w-7 rounded-md flex items-center justify-center hover:bg-[#242428] hover:text-white disabled:opacity-40"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={!resolvedTabId || busy}
            onClick={() => resolvedTabId && void onGoForward(resolvedTabId)}
            aria-label="Avançar página"
            className="h-7 w-7 rounded-md flex items-center justify-center hover:bg-[#242428] hover:text-white disabled:opacity-40"
          >
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={!resolvedTabId || busy}
            onClick={() => resolvedTabId && void onReload(resolvedTabId)}
            aria-label="Recarregar página"
            className="h-7 w-7 rounded-md flex items-center justify-center hover:bg-[#242428] hover:text-white disabled:opacity-40"
          >
            <RotateCw className="h-3.5 w-3.5" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!resolvedTabId) return;
            void onNavigate(resolvedTabId, normalizeUrlInput(addressDraft));
          }}
          className="flex-1 min-w-0 flex items-center gap-2 rounded-full border border-white/[0.08] bg-[#0B0B0D] px-3 py-1 focus-within:border-[#007CF7]"
        >
          {isHttps ? (
            <Lock className="h-3.5 w-3.5 text-[#31CF76] shrink-0" />
          ) : (
            <Globe className="h-3.5 w-3.5 text-[#979797] shrink-0" />
          )}
          <input
            type="text"
            aria-label="Endereço URL do navegador integrado"
            value={addressDraft}
            onChange={(e) => setAddressDraft(e.target.value)}
            placeholder="Digite uma URL ou pesquisa..."
            className="w-full bg-transparent text-[12px] font-mono text-[#F0F0F0] outline-none placeholder:text-[#666666]"
          />
        </form>

        <span className="hidden md:inline-flex shrink-0 rounded-full bg-[#212126] px-2.5 py-1 text-[11px] text-[#A8A8B3]">
          {profileLabel}
        </span>
      </div>

      {showTeachBar && onStartTeach && onStopTeach && (
        <BrowserTeachBar
          agentName={agentName}
          recording={teachRecording}
          startedAt={teachStartedAt}
          stepsCount={teachStepsCount}
          visible={true}
          busy={busy}
          onStartRecording={onStartTeach}
          onStopRecording={onStopTeach}
          onHideBar={() => setShowTeachBar(false)}
        />
      )}

      {/* Viewport interativa ao vivo extraída */}
      <InAppBrowserViewport
        activeTab={activeTab}
        resolvedTabId={resolvedTabId}
        liveFrame={liveFrame}
        currentUrl={currentUrl}
        currentTitle={currentTitle}
        isUserControlling={isUserControlling}
        takeoverPending={takeoverPending}
        agentName={agentName}
        agentAvatar={agentAvatar}
        agentAvatarShape={agentAvatarShape}
        agentAvatarColor={agentAvatarColor}
        agentWorking={agentWorking}
        busy={busy}
        onReload={onReload}
        onCompleteControl={onCompleteControl}
        onSendInput={onSendInput}
        onSendQuickChat={onSendQuickChat}
      />
    </div>
  );
};
