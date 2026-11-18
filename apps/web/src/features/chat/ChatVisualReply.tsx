import React, { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2, RefreshCw, Sparkles } from "lucide-react";
import type { ChatVisualMeta } from "@criativo/contracts";
import { daemonApi } from "../../services/websocket-client";

export interface ChatVisualReplyProps {
  agenteId: string;
  visualMeta: ChatVisualMeta;
  initialHtml?: string;
  onSendMessageFromPage?: (text: string) => void;
  onUpdatePageContext?: (contextText: string) => void;
  onOpenImageLightbox?: (url: string, alt?: string) => void;
}

function clampVisualHeight(raw: unknown, fallback = 240): number {
  const num = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(80, Math.min(2000, Math.round(num)));
}

function isSafeExternalUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl, typeof window !== "undefined" ? window.location.origin : "http://localhost");
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function isSafeImagePreviewUrl(rawUrl: string): boolean {
  if (!rawUrl) return false;
  if (rawUrl.startsWith("/api/arquivos/")) return true;
  if (/^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);base64,/i.test(rawUrl)) return true;
  return isSafeExternalUrl(rawUrl);
}

/**
 * Renderizador isolado de Generative UI (CHAT-01) em iframe de origem opaca.
 * Conecta-se via postMessage JSON-RPC 2.0 ao objeto window.criativoPage injetado no srcDoc.
 */
export function ChatVisualReply({
  agenteId,
  visualMeta,
  initialHtml,
  onSendMessageFromPage,
  onUpdatePageContext,
  onOpenImageLightbox,
}: ChatVisualReplyProps): React.ReactElement {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const initialClamped = clampVisualHeight(visualMeta.altura_inicial, 240);
  const [height, setHeight] = useState<number>(initialClamped);
  const [compiledHtml, setCompiledHtml] = useState<string>(initialHtml ?? "");
  const [loading, setLoading] = useState<boolean>(!initialHtml);
  const [loadError, setLoadError] = useState<boolean>(false);
  const [displayMode, setDisplayMode] = useState<"inline" | "fullscreen">("inline");
  const [hasActiveContext, setHasActiveContext] = useState<boolean>(false);
  const [reloadNonce, setReloadNonce] = useState<number>(0);

  const fetchCompiledHtml = useCallback(async () => {
    if (initialHtml && reloadNonce === 0) return;
    setLoading(true);
    setLoadError(false);
    try {
      const page = await daemonApi.getVisualPage(agenteId, visualMeta.arquivo_id);
      setCompiledHtml(page.html);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [agenteId, initialHtml, reloadNonce, visualMeta.arquivo_id]);

  useEffect(() => {
    void fetchCompiledHtml();
  }, [fetchCompiledHtml]);

  const notifyIframeDisplayMode = useCallback((mode: "inline" | "fullscreen") => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    try {
      win.postMessage(
        {
          jsonrpc: "2.0",
          method: "ui/notifications/host-context-changed",
          params: { displayMode: mode },
        },
        "*",
      );
    } catch {
      // ignora iframe desmontado
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleMessage = (event: MessageEvent): void => {
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) {
        return;
      }
      const data = event.data;
      if (!data || typeof data !== "object") return;
      const msg = data as {
        jsonrpc?: string;
        id?: number | string;
        method?: string;
        params?: Record<string, unknown>;
      };

      const replyRpc = (result: Record<string, unknown>): void => {
        if (msg.id === undefined || !iframeRef.current?.contentWindow) return;
        iframeRef.current.contentWindow.postMessage(
          { jsonrpc: "2.0", id: msg.id, result },
          "*",
        );
      };

      const method = msg.method ?? "";
      const params = msg.params ?? {};

      if (method === "ui/notifications/size-changed") {
        setHeight((prev) => clampVisualHeight(params.height, prev));
        return;
      }

      if (method === "ui/message") {
        const userActive =
          typeof navigator === "undefined" ||
          !("userActivation" in navigator) ||
          navigator.userActivation.isActive !== false;
        const text = typeof params.text === "string" ? params.text.trim() : "";
        if (userActive && text && onSendMessageFromPage) {
          onSendMessageFromPage(text);
          replyRpc({ ok: true });
        } else {
          replyRpc({ ok: false });
        }
        return;
      }

      if (method === "ui/update-model-context") {
        const text =
          typeof params.text === "string"
            ? params.text.trim()
            : typeof params.context === "string"
              ? params.context.trim()
              : JSON.stringify(params);
        setHasActiveContext(Boolean(text));
        onUpdatePageContext?.(text);
        replyRpc({ ok: true });
        return;
      }

      if (method === "ui/request-display-mode") {
        const requested = params.mode === "fullscreen" ? "fullscreen" : "inline";
        setDisplayMode(requested);
        notifyIframeDisplayMode(requested);
        replyRpc({ mode: requested });
        return;
      }

      if (method === "criativo/notifications/image-click") {
        const src = typeof params.src === "string" ? params.src : "";
        const alt = typeof params.alt === "string" ? params.alt : visualMeta.titulo;
        if (isSafeImagePreviewUrl(src)) {
          onOpenImageLightbox?.(src, alt);
        }
        return;
      }

      if (method === "ui/open-link") {
        const url = typeof params.url === "string" ? params.url : "";
        const userActive =
          typeof navigator !== "undefined" &&
          ("userActivation" in navigator ? navigator.userActivation.isActive : true);
        if (userActive && isSafeExternalUrl(url)) {
          window.open(url, "_blank", "noopener,noreferrer");
          replyRpc({ ok: true });
        } else {
          replyRpc({ ok: false });
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [notifyIframeDisplayMode, onOpenImageLightbox, onSendMessageFromPage, onUpdatePageContext, visualMeta.titulo]);

  useEffect(() => {
    if (displayMode !== "fullscreen" || typeof window === "undefined") return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        setDisplayMode("inline");
        notifyIframeDisplayMode("inline");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [displayMode, notifyIframeDisplayMode]);

  const toggleFullscreen = (next: "inline" | "fullscreen"): void => {
    setDisplayMode(next);
    notifyIframeDisplayMode(next);
  };

  const iframeElement = (
    <iframe
      ref={iframeRef}
      title={visualMeta.titulo}
      sandbox="allow-scripts allow-forms"
      referrerPolicy="no-referrer"
      srcDoc={compiledHtml}
      style={{ height: displayMode === "fullscreen" ? "calc(100vh - 64px)" : `${height}px` }}
      className="w-full border-0 bg-transparent block"
    />
  );

  if (displayMode === "fullscreen") {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label={visualMeta.titulo}
        className="fixed inset-0 z-50 flex flex-col bg-[#0D0D0D]"
      >
        <div className="flex items-center justify-between bg-[#141414] border-b border-[rgba(255,255,255,0.12)] p-4">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-[20px] font-semibold leading-[1.4] text-[#FFFFFF] truncate">
              {visualMeta.titulo}
            </h2>
            {hasActiveContext && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#242424] px-2 py-1 text-[12px] font-normal text-[#42A0FF]">
                <Sparkles className="w-3.5 h-3.5" />
                Contexto ativo
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setReloadNonce((n) => n + 1)}
              className="inline-flex items-center gap-2 rounded-lg bg-[#242424] hover:bg-[#2A2A2A] border border-[rgba(255,255,255,0.12)] px-4 py-2 text-[14px] font-semibold text-[#DCDCDC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
            >
              <RefreshCw className="w-4 h-4" />
              Recarregar prévia
            </button>
            <button
              type="button"
              onClick={() => toggleFullscreen("inline")}
              className="inline-flex items-center gap-2 rounded-lg bg-[#F0F0F0] px-4 py-2 text-[14px] font-semibold text-[#141414] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
            >
              <Minimize2 className="w-4 h-4" />
              Sair da tela cheia
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden bg-[#1A1A1A]">{iframeElement}</div>
      </div>
    );
  }

  return (
    <div className="w-full rounded-[14px] bg-[#212121] border border-[rgba(255,255,255,0.12)] overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-[rgba(255,255,255,0.06)] px-4 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[14px] font-semibold leading-[1.43] text-[#FFFFFF] truncate">
            {visualMeta.titulo}
          </span>
          {hasActiveContext && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#242424] px-2 py-1 text-[12px] font-normal leading-[1.33] text-[#42A0FF]">
              <Sparkles className="w-3.5 h-3.5" />
              Contexto ativo
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setReloadNonce((n) => n + 1)}
            aria-label="Recarregar prévia"
            title="Recarregar prévia"
            className="inline-flex items-center gap-1 rounded-md bg-[#242424] hover:bg-[#2A2A2A] border border-[rgba(255,255,255,0.06)] px-2 py-1 text-[12px] font-semibold text-[#DCDCDC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Recarregar prévia</span>
          </button>
          <button
            type="button"
            onClick={() => toggleFullscreen("fullscreen")}
            className="inline-flex items-center gap-1 rounded-md bg-[#242424] hover:bg-[#2A2A2A] border border-[rgba(255,255,255,0.12)] px-2 py-1 text-[12px] font-semibold text-[#42A0FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            <span>Abrir em tela cheia</span>
          </button>
        </div>
      </div>

      {loadError ? (
        <div className="p-4 flex flex-col gap-2 bg-[#212121] border-t border-[#FD2F3B]">
          <p className="text-[14px] font-normal leading-[1.43] text-[#DCDCDC]">
            Não foi possível exibir o artefato interativo dentro dos limites seguros do sandbox.
          </p>
          <div>
            <button
              type="button"
              onClick={() => setReloadNonce((n) => n + 1)}
              className="inline-flex items-center gap-2 rounded-lg bg-[#242424] hover:bg-[#2A2A2A] border border-[rgba(255,255,255,0.12)] px-4 py-2 text-[14px] font-semibold text-[#FFFFFF]"
            >
              <RefreshCw className="w-4 h-4" />
              Recarregar prévia
            </button>
          </div>
        </div>
      ) : (
        <div className="relative w-full bg-[#1A1A1A]">
          {loading && !compiledHtml && (
            <div className="p-4 text-[12px] font-normal text-[#979797]">
              Carregando prévia interativa isolada...
            </div>
          )}
          {iframeElement}
        </div>
      )}
    </div>
  );
}
