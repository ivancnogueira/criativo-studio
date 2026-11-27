import React, { useRef, useState } from "react";
import type { AvatarShape, BrowserTabSummary } from "@criativo/contracts";
import { ArrowUp, Monitor, RotateCw } from "lucide-react";
import {
  MascoteAvatar,
  type AgentAvatarVisual,
} from "../../components/MascoteAvatar";

export interface BrowserLiveFrame {
  tabId: string;
  dataUrl: string;
  width: number;
  height: number;
  url: string;
  title: string;
  userControl: boolean;
}

export interface BrowserMouseKeyboardInput {
  type:
    | "mousePressed"
    | "mouseReleased"
    | "mouseMoved"
    | "wheel"
    | "keyDown"
    | "keyUp"
    | "insertText";
  x?: number;
  y?: number;
  button?: "left" | "right" | "middle";
  clickCount?: number;
  deltaX?: number;
  deltaY?: number;
  key?: string;
  code?: string;
  text?: string;
  modifiers?: number;
}

export interface InAppBrowserViewportProps {
  activeTab: BrowserTabSummary | null;
  resolvedTabId: string;
  liveFrame?: BrowserLiveFrame;
  currentUrl: string;
  currentTitle: string;
  isUserControlling: boolean;
  takeoverPending: boolean;
  agentName: string;
  agentAvatar?: Partial<AgentAvatarVisual> | null;
  agentAvatarShape: AvatarShape;
  agentAvatarColor: string;
  agentWorking: boolean;
  busy: boolean;
  onReload: (tabId: string) => void | Promise<void>;
  onCompleteControl: (tabId: string) => void | Promise<void>;
  onSendInput: (
    tabId: string,
    input: BrowserMouseKeyboardInput,
    autoAssume?: boolean
  ) => void | Promise<void>;
  onSendQuickChat?: (text: string) => void | Promise<void>;
}

function resolveButton(btn: number): "left" | "right" | "middle" {
  if (btn === 2) return "right";
  if (btn === 1) return "middle";
  return "left";
}

function computeModifiers(e: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): number {
  return (
    (e.altKey ? 1 : 0) |
    (e.ctrlKey ? 2 : 0) |
    (e.metaKey ? 4 : 0) |
    (e.shiftKey ? 8 : 0)
  );
}

export const InAppBrowserViewport: React.FC<InAppBrowserViewportProps> = ({
  activeTab,
  resolvedTabId,
  liveFrame,
  currentUrl,
  currentTitle,
  isUserControlling,
  takeoverPending,
  agentName,
  agentAvatar = null,
  agentAvatarShape,
  agentAvatarColor,
  agentWorking,
  busy,
  onReload,
  onCompleteControl,
  onSendInput,
  onSendQuickChat,
}) => {
  const [quickChatDraft, setQuickChatDraft] = useState("");
  const [sendingQuickChat, setSendingQuickChat] = useState(false);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const lastMoveAtRef = useRef<number>(0);

  const frameWidth = liveFrame?.width || 1280;
  const frameHeight = liveFrame?.height || 800;
  const isUnloaded = Boolean(activeTab?.unloaded && !liveFrame?.dataUrl);

  const mapPointerCoords = (
    event: React.PointerEvent<HTMLElement> | React.WheelEvent<HTMLElement>
  ): { x: number; y: number } => {
    const targetEl = imgRef.current ?? surfaceRef.current;
    if (!targetEl) return { x: 0, y: 0 };
    const rect = targetEl.getBoundingClientRect();
    const normX = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)));
    const normY = Math.min(1, Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height)));
    return {
      x: Math.round(normX * frameWidth),
      y: Math.round(normY * frameHeight),
    };
  };

  const handleQuickChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = quickChatDraft.trim();
    if (!text || !onSendQuickChat || sendingQuickChat) return;
    setSendingQuickChat(true);
    setQuickChatDraft("");
    try {
      await onSendQuickChat(text);
    } finally {
      setSendingQuickChat(false);
    }
  };

  return (
    <div className="relative flex-1 overflow-hidden bg-[#18181B] flex items-center justify-center p-2 pb-20">
      <div
        ref={surfaceRef}
        tabIndex={0}
        aria-label="Viewport interativa do navegador integrado"
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          surfaceRef.current?.focus();
          if (!resolvedTabId || isUnloaded) return;
          const coords = mapPointerCoords(e);
          void onSendInput(
            resolvedTabId,
            {
              type: "mousePressed",
              x: coords.x,
              y: coords.y,
              button: resolveButton(e.button),
              clickCount: 1,
              modifiers: computeModifiers(e),
            },
            true
          );
        }}
        onPointerUp={(e) => {
          if (!resolvedTabId || isUnloaded) return;
          const coords = mapPointerCoords(e);
          void onSendInput(
            resolvedTabId,
            {
              type: "mouseReleased",
              x: coords.x,
              y: coords.y,
              button: resolveButton(e.button),
              clickCount: 1,
              modifiers: computeModifiers(e),
            },
            true
          );
        }}
        onPointerMove={(e) => {
          if (!resolvedTabId || !isUserControlling || isUnloaded) return;
          const now = Date.now();
          if (now - lastMoveAtRef.current < 50) return;
          lastMoveAtRef.current = now;
          const coords = mapPointerCoords(e);
          void onSendInput(resolvedTabId, {
            type: "mouseMoved",
            x: coords.x,
            y: coords.y,
          });
        }}
        onWheel={(e) => {
          if (!resolvedTabId || isUnloaded) return;
          const coords = mapPointerCoords(e);
          void onSendInput(
            resolvedTabId,
            {
              type: "wheel",
              x: coords.x,
              y: coords.y,
              deltaX: Math.round(e.deltaX),
              deltaY: Math.round(e.deltaY),
            },
            true
          );
        }}
        onKeyDown={(e) => {
          if (!resolvedTabId || isUnloaded) return;
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") return;
          e.preventDefault();
          const modifiers = computeModifiers(e);
          void onSendInput(
            resolvedTabId,
            { type: "keyDown", key: e.key, code: e.code, modifiers },
            true
          );
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            void onSendInput(resolvedTabId, { type: "insertText", text: e.key }, true);
          }
        }}
        onKeyUp={(e) => {
          if (!resolvedTabId || isUnloaded) return;
          e.preventDefault();
          void onSendInput(
            resolvedTabId,
            { type: "keyUp", key: e.key, code: e.code, modifiers: computeModifiers(e) },
            true
          );
        }}
        onPaste={(e) => {
          if (!resolvedTabId || isUnloaded) return;
          const clipText = e.clipboardData?.getData("text/plain");
          if (!clipText) return;
          e.preventDefault();
          void onSendInput(resolvedTabId, { type: "insertText", text: clipText }, true);
        }}
        className="relative flex h-full w-full max-w-[1360px] items-center justify-center overflow-hidden rounded-xl border border-white/[0.08] bg-[#101012] outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
      >
        {liveFrame?.dataUrl ? (
          <img
            ref={imgRef}
            src={liveFrame.dataUrl}
            alt={currentTitle}
            draggable={false}
            className="max-h-full max-w-full select-none object-contain cursor-pointer"
          />
        ) : isUnloaded && resolvedTabId ? (
          <div className="flex flex-col items-center gap-3 p-6 text-center max-w-md">
            <Monitor className="h-9 w-9 text-[#979797]" />
            <p className="text-[14px] font-semibold text-white">
              Aba suspensa para economizar memória
            </p>
            <p className="text-[12.5px] font-medium text-[#DCDCDC] truncate max-w-full">
              {currentTitle}
            </p>
            <p className="text-[11.5px] font-mono text-[#8E8E93] truncate max-w-full">
              {currentUrl}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void onReload(resolvedTabId)}
              className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-[#007CF7] hover:bg-[#198BFF] px-4 py-1.5 text-[12px] font-semibold text-white transition disabled:opacity-50"
            >
              <RotateCw className="h-3.5 w-3.5" />
              <span>Recarregar aba agora</span>
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 p-6 text-center">
            <Monitor className="h-9 w-9 text-[#42A0FF]" />
            <p className="text-[14px] font-semibold text-white">
              Navegador integrado aguardando quadro da página...
            </p>
            <p className="max-w-md text-[12px] text-[#979797]">
              Digite um endereço acima ou clique para interagir diretamente sem sair do CriativoOS.
            </p>
          </div>
        )}
      </div>

      {/* Barra inferior flutuante: aviso de takeover + quick chat input */}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
        {(takeoverPending || isUserControlling) && resolvedTabId && (
          <div className="pointer-events-auto inline-flex items-center gap-3 rounded-full border border-white/15 bg-[#1B1B20]/95 backdrop-blur-xl px-4 py-1.5 shadow-2xl">
            <span className="h-2 w-2 rounded-full bg-[#31CF76] animate-pulse" />
            <span className="text-[12px] font-medium text-[#E5E5EA]">
              {agentName} aguarda você concluir nesta página
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => void onCompleteControl(resolvedTabId)}
              className="rounded-full bg-[#F0F0F0] hover:bg-white px-3 py-0.5 text-[11.5px] font-semibold text-[#141414] transition disabled:opacity-50"
            >
              Terminei
            </button>
          </div>
        )}

        {onSendQuickChat && (
          <form
            onSubmit={(e) => void handleQuickChatSubmit(e)}
            className="pointer-events-auto flex w-full max-w-[460px] items-center gap-2 rounded-full border border-white/12 bg-[#1B1B20]/95 backdrop-blur-xl p-1.5 pl-2.5 shadow-2xl"
          >
            <MascoteAvatar
              avatar={agentAvatar}
              shape={agentAvatarShape}
              color={agentAvatarColor}
              size={22}
              animated={agentWorking}
              mood={takeoverPending ? "waiting" : agentWorking ? "working" : "idle"}
              activity={takeoverPending ? "approval" : agentWorking ? "research" : "idle"}
            />
            <input
              type="text"
              value={quickChatDraft}
              onChange={(e) => setQuickChatDraft(e.target.value)}
              placeholder={`Mensagem para ${agentName}`}
              className="flex-1 min-w-0 bg-transparent text-[13px] text-white outline-none placeholder:text-[#8E8E93]"
            />
            <button
              type="submit"
              disabled={!quickChatDraft.trim() || sendingQuickChat}
              aria-label={`Enviar mensagem para ${agentName}`}
              className="h-7 w-7 rounded-full bg-[#F0F0F0] hover:bg-white text-[#141414] flex items-center justify-center transition disabled:opacity-40 shrink-0"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
