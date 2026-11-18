import React, { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Maximize2,
  Minimize2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { AnexoChat, ArquivoStudio } from "@criativo/contracts";
import { CodePreview } from "./CodePreview";
import { MarkdownFilePreview, MermaidDiagram } from "./MarkdownMathMermaidPreview";
import { SpreadsheetFilePreview } from "./SpreadsheetFilePreview";

export interface ImageLightboxProps {
  open: boolean;
  url: string;
  alt?: string;
  gallery?: Array<{ url: string; alt?: string }>;
  onClose: () => void;
}

/**
 * Lightbox fullscreen sobre fundo #0D0D0D com zoom 1x..4x, drag-to-pan,
 * navegacao por setas (ArrowLeft/ArrowRight), Escape e botao Baixar arquivo (CHAT-03).
 */
export function ImageLightbox({
  open,
  url,
  alt = "Visualização de imagem",
  gallery,
  onClose,
}: ImageLightboxProps): React.ReactElement | null {
  const items = gallery && gallery.length > 0 ? gallery : [{ url, alt }];
  const [activeIndex, setActiveIndex] = useState<number>(() => {
    const found = items.findIndex((item) => item.url === url);
    return found >= 0 ? found : 0;
  });
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState<boolean>(false);
  const [dragOrigin, setDragOrigin] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    const found = items.findIndex((item) => item.url === url);
    if (found >= 0) setActiveIndex(found);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [url]);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && items.length > 1) {
        setActiveIndex((i) => (i - 1 + items.length) % items.length);
      } else if (e.key === "ArrowRight" && items.length > 1) {
        setActiveIndex((i) => (i + 1) % items.length);
      } else if (e.key === "+" || e.key === "=") {
        setZoom((z) => Math.min(4, Number((z + 0.5).toFixed(1))));
      } else if (e.key === "-") {
        setZoom((z) => Math.max(1, Number((z - 0.5).toFixed(1))));
      } else if (e.key === "0") {
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [items.length, onClose, open]);

  if (!open) return null;

  const current = items[activeIndex] ?? { url, alt };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={current.alt ?? alt}
      className="fixed inset-0 z-50 bg-[#0D0D0D] flex flex-col"
    >
      <div className="flex items-center justify-between gap-4 bg-[#141414] border-b border-[rgba(255,255,255,0.12)] p-4">
        <span className="text-[12px] font-semibold text-[#DCDCDC] truncate">
          {current.alt ?? alt}
        </span>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(1, Number((z - 0.5).toFixed(1))))}
            className="rounded-lg bg-[#242424] hover:bg-[#2A2A2A] p-2 text-[#DCDCDC]"
            aria-label="Reduzir zoom"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-[12px] font-semibold text-[#FFFFFF]">{zoom}x</span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(4, Number((z + 0.5).toFixed(1))))}
            className="rounded-lg bg-[#242424] hover:bg-[#2A2A2A] p-2 text-[#DCDCDC]"
            aria-label="Aumentar zoom"
          >
            <ZoomIn className="w-4 h-4" />
          </button>

          <a
            href={current.url}
            download
            className="openbot-btn-primary inline-flex items-center gap-2 rounded-lg bg-[#F0F0F0] px-4 py-2 text-[14px] font-semibold text-[#141414]"
          >
            <Download className="w-4 h-4" />
            Baixar arquivo
          </a>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1 rounded-lg bg-[#242424] hover:bg-[#2A2A2A] px-4 py-2 text-[14px] font-semibold text-[#DCDCDC]"
          >
            <X className="w-4 h-4" />
            Fechar prévia
          </button>
        </div>
      </div>

      <div
        onWheel={(e) => {
          e.preventDefault();
          const delta = e.deltaY < 0 ? 0.25 : -0.25;
          setZoom((z) => Math.max(1, Math.min(4, Number((z + delta).toFixed(2)))));
        }}
        onPointerDown={(e) => {
          if (zoom <= 1) return;
          setDragging(true);
          setDragOrigin({ x: e.clientX - pan.x, y: e.clientY - pan.y });
        }}
        onPointerMove={(e) => {
          if (!dragging) return;
          setPan({ x: e.clientX - dragOrigin.x, y: e.clientY - dragOrigin.y });
        }}
        onPointerUp={() => setDragging(false)}
        onDoubleClick={() => {
          setZoom((z) => (z > 1 ? 1 : 2));
          setPan({ x: 0, y: 0 });
        }}
        className="flex-1 relative overflow-hidden flex items-center justify-center p-12 select-none"
      >
        {items.length > 1 && (
          <button
            type="button"
            onClick={() => setActiveIndex((i) => (i - 1 + items.length) % items.length)}
            aria-label="Imagem anterior"
            className="absolute left-4 z-10 rounded-full bg-[#212121] hover:bg-[#2A2A2A] p-2 text-[#FFFFFF]"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}

        <img
          src={current.url}
          alt={current.alt ?? alt}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
          className="max-h-full max-w-full object-contain transition-transform duration-75"
        />

        {items.length > 1 && (
          <button
            type="button"
            onClick={() => setActiveIndex((i) => (i + 1) % items.length)}
            aria-label="Próxima imagem"
            className="absolute right-4 z-10 rounded-full bg-[#212121] hover:bg-[#2A2A2A] p-2 text-[#FFFFFF]"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
}

export interface MediaFilePreviewProps {
  url: string;
  mimeType: string;
  fileName: string;
}

/**
 * Players HTML5 nativos estilizados sobre #101010 para video e audio (CHAT-03).
 */
export function MediaFilePreview({
  url,
  mimeType,
  fileName,
}: MediaFilePreviewProps): React.ReactElement {
  const isVideo =
    mimeType.startsWith("video/") || /\.(mp4|webm|mov)$/i.test(fileName);

  return (
    <div className="w-full rounded-[14px] bg-[#101010] border border-[rgba(255,255,255,0.12)] p-4 flex flex-col gap-4">
      {isVideo ? (
        <video controls src={url} className="w-full max-h-[420px] rounded-lg bg-[#0D0D0D]">
          Formato de vídeo não suportado diretamente pelo navegador.
        </video>
      ) : (
        <audio controls src={url} className="w-full">
          Formato de áudio não suportado diretamente pelo navegador.
        </audio>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-normal text-[#979797] truncate">{fileName}</span>
        <a
          href={url}
          download={fileName}
          className="inline-flex items-center gap-1 rounded-lg bg-[#242424] hover:bg-[#2A2A2A] border border-[rgba(255,255,255,0.12)] px-4 py-2 text-[12px] font-semibold text-[#FFFFFF]"
        >
          <Download className="w-3.5 h-3.5" />
          Baixar arquivo
        </a>
      </div>
    </div>
  );
}

export type PreviewableFileItem = ArquivoStudio | AnexoChat;

function getFileDisplayName(file: PreviewableFileItem): string {
  return "nome_original" in file ? file.nome_original : file.nome;
}

export interface FilePreviewPanelProps {
  file: PreviewableFileItem | null;
  initialTextContent?: string;
  onClose: () => void;
  onOpenImageLightbox?: (url: string, alt?: string) => void;
}

/**
 * Painel lateral direito redimensionavel e modal expandido unificado para todos os formatos
 * da Biblioteca e anexos do chat (CSV/TSV, Markdown, Mermaid, Codigo, Imagem e Midia - CHAT-03).
 */
export function FilePreviewPanel({
  file,
  initialTextContent,
  onClose,
  onOpenImageLightbox,
}: FilePreviewPanelProps): React.ReactElement | null {
  const [textContent, setTextContent] = useState<string>(initialTextContent ?? "");
  const [loadingText, setLoadingText] = useState<boolean>(false);
  const [expandedModal, setExpandedModal] = useState<boolean>(false);
  const [panelWidth, setPanelWidth] = useState<number>(480);

  const fileName = file ? getFileDisplayName(file) : "";
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const mime = file?.mime_type?.toLowerCase() ?? "";

  const isImage = mime.startsWith("image/") || /^(png|jpg|jpeg|webp|gif|svg)$/.test(ext);
  const isMedia =
    mime.startsWith("video/") ||
    mime.startsWith("audio/") ||
    /^(mp4|webm|mov|mp3|wav|ogg)$/.test(ext);
  const isCsv = mime.includes("csv") || mime.includes("tab-separated") || ext === "csv" || ext === "tsv";
  const isMermaid = ext === "mmd" || ext === "mermaid";
  const isMarkdown = mime.includes("markdown") || ext === "md";
  const isCodeOrText =
    !isImage &&
    !isMedia &&
    !isCsv &&
    !isMermaid &&
    !isMarkdown &&
    (mime.startsWith("text/") ||
      mime.includes("json") ||
      mime.includes("javascript") ||
      mime.includes("yaml") ||
      /^(ts|tsx|js|json|css|html|sql|yml|yaml|txt|sh|py|srt)$/.test(ext));

  const needsTextFetch = Boolean(
    file && initialTextContent === undefined && (isCsv || isMermaid || isMarkdown || isCodeOrText),
  );

  useEffect(() => {
    if (!file || !needsTextFetch) return;
    let cancelled = false;
    setLoadingText(true);
    void (async () => {
      try {
        const res = await fetch(file.url);
        const txt = await res.text();
        if (!cancelled) setTextContent(txt);
      } catch {
        if (!cancelled) setTextContent("");
      } finally {
        if (!cancelled) setLoadingText(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, needsTextFetch]);

  useEffect(() => {
    if (initialTextContent !== undefined) {
      setTextContent(initialTextContent);
    }
  }, [initialTextContent]);

  if (!file) return null;

  const startResize = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panelWidth;

    const onMove = (ev: PointerEvent): void => {
      const delta = startX - ev.clientX;
      setPanelWidth(Math.max(360, Math.min(820, startW + delta)));
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const renderBody = (): React.ReactNode => {
    if (loadingText) {
      return <div className="p-4 text-[12px] text-[#979797]">Carregando arquivo...</div>;
    }
    if (isImage) {
      return (
        <div className="flex flex-col items-center gap-4">
          <img
            src={file.url}
            alt={fileName}
            onClick={() => onOpenImageLightbox?.(file.url, fileName)}
            className="max-w-full max-h-[540px] rounded-lg object-contain cursor-zoom-in bg-[#101010]"
          />
          {onOpenImageLightbox && (
            <button
              type="button"
              onClick={() => onOpenImageLightbox(file.url, fileName)}
              className="inline-flex items-center gap-2 rounded-lg bg-[#242424] hover:bg-[#2A2A2A] border border-[rgba(255,255,255,0.12)] px-4 py-2 text-[14px] font-semibold text-[#FFFFFF]"
            >
              <Maximize2 className="w-4 h-4 text-[#42A0FF]" />
              Expandir prévia
            </button>
          )}
        </div>
      );
    }
    if (isMedia) {
      return <MediaFilePreview url={file.url} mimeType={file.mime_type} fileName={fileName} />;
    }
    if (isCsv) {
      return <SpreadsheetFilePreview content={textContent} fileName={fileName} />;
    }
    if (isMermaid) {
      return <MermaidDiagram chart={textContent} title={fileName} />;
    }
    if (isMarkdown) {
      return <MarkdownFilePreview markdown={textContent} fileName={fileName} />;
    }
    if (isCodeOrText) {
      return <CodePreview code={textContent} fileName={fileName} />;
    }
    return (
      <div className="rounded-[14px] bg-[#212121] border border-[rgba(255,255,255,0.12)] p-6 flex flex-col items-center gap-4 text-center">
        <p className="text-[14px] text-[#DCDCDC]">
          Este formato ({file.mime_type || ext}) pode ser baixado diretamente para inspeção.
        </p>
        <a
          href={file.url}
          download={fileName}
          className="openbot-btn-primary inline-flex items-center gap-2 rounded-lg bg-[#F0F0F0] px-4 py-2 text-[14px] font-semibold text-[#141414]"
        >
          <Download className="w-4 h-4" />
          Baixar arquivo
        </a>
      </div>
    );
  };

  if (expandedModal) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label={fileName}
        className="fixed inset-0 z-50 bg-[#0D0D0D] flex flex-col"
      >
        <div className="flex items-center justify-between gap-4 bg-[#141414] border-b border-[rgba(255,255,255,0.12)] p-4">
          <h2 className="text-[20px] font-semibold leading-[1.4] text-[#FFFFFF] truncate">
            {fileName}
          </h2>
          <div className="flex items-center gap-2">
            <a
              href={file.url}
              download={fileName}
              className="inline-flex items-center gap-2 rounded-lg bg-[#242424] hover:bg-[#2A2A2A] border border-[rgba(255,255,255,0.12)] px-4 py-2 text-[14px] font-semibold text-[#DCDCDC]"
            >
              <Download className="w-4 h-4" />
              Baixar arquivo
            </a>
            <button
              type="button"
              onClick={() => setExpandedModal(false)}
              className="inline-flex items-center gap-2 rounded-lg bg-[#242424] hover:bg-[#2A2A2A] px-4 py-2 text-[14px] font-semibold text-[#DCDCDC]"
            >
              <Minimize2 className="w-4 h-4" />
              Sair da tela cheia
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-lg bg-[#F0F0F0] px-4 py-2 text-[14px] font-semibold text-[#141414]"
            >
              <X className="w-4 h-4" />
              Fechar prévia
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-6 max-w-6xl w-full mx-auto">{renderBody()}</div>
      </div>
    );
  }

  return (
    <aside
      style={{ width: `${panelWidth}px` }}
      className="relative h-full max-w-full shrink-0 bg-[#1A1A1A] border-l border-[rgba(255,255,255,0.12)] flex flex-col overflow-hidden"
    >
      <div
        onPointerDown={startResize}
        title="Redimensionar painel"
        className="hidden md:block absolute left-0 inset-y-0 w-1 cursor-col-resize hover:bg-[#007CF7]"
      />
      <div className="flex items-center justify-between gap-2 border-b border-[rgba(255,255,255,0.06)] bg-[#212121] p-4">
        <h3 className="text-[14px] font-semibold text-[#FFFFFF] truncate">{fileName}</h3>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setExpandedModal(true)}
            className="inline-flex items-center gap-1 rounded bg-[#242424] hover:bg-[#2A2A2A] px-2 py-1 text-[12px] font-semibold text-[#42A0FF]"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            Expandir prévia
          </button>
          <a
            href={file.url}
            download={fileName}
            className="inline-flex items-center gap-1 rounded bg-[#242424] hover:bg-[#2A2A2A] px-2 py-1 text-[12px] font-semibold text-[#DCDCDC]"
          >
            <Download className="w-3.5 h-3.5" />
            Baixar arquivo
          </a>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1 rounded bg-[#242424] hover:bg-[#2A2A2A] px-2 py-1 text-[12px] font-semibold text-[#DCDCDC]"
          >
            <X className="w-3.5 h-3.5" />
            Fechar prévia
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">{renderBody()}</div>
    </aside>
  );
}
