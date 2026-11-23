import { useState, type TouchEvent } from "react";
import type { EditorialSlideItem, TarefaRegistro } from "@criativo/contracts";
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Film,
  Heart,
  Image as ImageIcon,
  Layers,
  MessageCircle,
  Send,
} from "lucide-react";
import { CarouselStoriesStudioEditor } from "../social-studio/CarouselStoriesStudioEditor";

interface InstagramMobilePreviewProps {
  tarefa: TarefaRegistro | null;
}

export function InstagramMobilePreview({ tarefa }: InstagramMobilePreviewProps) {
  const [slideIndex, setSlideIndex] = useState(0);
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [visualEditorOpen, setVisualEditorOpen] = useState(false);

  if (!tarefa) {
    return (
      <div className="flex min-h-[300px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-[#141414] p-6 text-center">
        <ImageIcon className="mb-2 h-8 w-8 text-[#6A6A6A]" />
        <p className="text-[12.5px] text-[#979797]">
          Nenhum criativo aguardando aprovação no momento.
        </p>
      </div>
    );
  }

  const rawPreviews = Array.isArray(tarefa.resultado?.previews)
    ? (tarefa.resultado?.previews as string[]).slice(0, 10)
    : [];
  const copyText =
    typeof tarefa.resultado?.copy === "string"
      ? tarefa.resultado.copy
      : typeof tarefa.resultado?.texto === "string"
      ? tarefa.resultado.texto
      : "Legenda gerada pelos Criativos especialistas para publicação.";

  const totalSlides = Math.max(1, rawPreviews.length);
  const activeSlide = Math.min(slideIndex, totalSlides - 1);
  const activeMedia = rawPreviews[activeSlide] ?? null;
  const isReels =
    tarefa.tipo === "reels" ||
    tarefa.tipo === "faceless" ||
    tarefa.tipo === "talking_head" ||
    Boolean(activeMedia?.toLowerCase().endsWith(".mp4"));

  const handleTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    setTouchStartX(e.touches[0]?.clientX ?? null);
  };

  const handleTouchEnd = (e: TouchEvent<HTMLDivElement>) => {
    if (touchStartX === null) return;
    const endX = e.changedTouches[0]?.clientX ?? touchStartX;
    const delta = endX - touchStartX;
    if (delta < -40 && activeSlide < rawPreviews.length - 1) {
      setSlideIndex(activeSlide + 1);
    } else if (delta > 40 && activeSlide > 0) {
      setSlideIndex(activeSlide - 1);
    }
    setTouchStartX(null);
  };

  return (
    <div className="mx-auto w-full max-w-[340px] overflow-hidden rounded-2xl border border-white/10 bg-[#141414] shadow-2xl">
      {/* Cabeçalho estilo Instagram */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-tr from-[#31CF76] via-[#42A0FF] to-[#D97757] text-[10px] font-bold text-[#0D0D0D]">
            IG
          </div>
          <div>
            <p className="text-xs font-semibold text-white">@SEU_PERFIL</p>
            <p className="text-[10px] text-[#979797]">[NOME_DA_MARCA] • Prévia</p>
          </div>
        </div>
        <span className="rounded-md bg-[#212121] border border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-[#DCDCDC]">
          {isReels ? "9:16 Reels" : "4:5 Feed"}
        </span>
      </div>

      {/* Área da Mídia (4:5 ou 9:16) */}
      <div
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className={`relative flex w-full items-center justify-center bg-[#212121] ${
          isReels ? "aspect-[9/16] max-h-[420px]" : "aspect-[4/5]"
        }`}
      >
        {activeMedia ? (
          isReels ? (
            <video
              src={activeMedia}
              controls
              playsInline
              className="h-full w-full object-cover"
            />
          ) : (
            <img
              src={activeMedia}
              alt={`Lâmina ${activeSlide + 1}`}
              className="h-full w-full object-cover"
            />
          )
        ) : (
          <div className="flex flex-col items-center gap-2 px-4 text-center text-[#979797]">
            {isReels ? (
              <Film className="h-8 w-8 text-[#42A0FF]" />
            ) : (
              <ImageIcon className="h-8 w-8 text-[#42A0FF]" />
            )}
            <p className="text-xs font-medium text-white">{tarefa.titulo}</p>
            <p className="text-[11px]">
              Prévia estruturada ({tarefa.tipo}) • {tarefa.status}
            </p>
          </div>
        )}

        {rawPreviews.length > 1 && (
          <>
            <button
              type="button"
              aria-label="Lâmina anterior"
              disabled={activeSlide === 0}
              onClick={() => setSlideIndex(Math.max(0, activeSlide - 1))}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-1 text-white disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Próxima lâmina"
              disabled={activeSlide >= rawPreviews.length - 1}
              onClick={() =>
                setSlideIndex(Math.min(rawPreviews.length - 1, activeSlide + 1))
              }
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-1 text-white disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <span className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-medium text-white">
              {activeSlide + 1}/{rawPreviews.length}
            </span>
          </>
        )}
      </div>

      {/* Barra de ações simulada */}
      <div className="flex items-center justify-between px-3 py-2 text-white">
        <div className="flex items-center gap-3">
          <Heart className="h-4 w-4" />
          <MessageCircle className="h-4 w-4" />
          <Send className="h-4 w-4" />
        </div>
        {rawPreviews.length > 1 && (
          <div className="flex gap-1">
            {rawPreviews.map((_, idx) => (
              <span
                key={idx}
                className={`h-1.5 w-1.5 rounded-full ${
                  idx === activeSlide ? "bg-[#42A0FF]" : "bg-[#2A2A2A]"
                }`}
              />
            ))}
          </div>
        )}
        <Bookmark className="h-4 w-4" />
      </div>

      {/* Legenda expansível + botão para Editor Visual 4:5 / Safe Zones */}
      <div className="px-3 pb-3 text-xs text-[#DCDCDC]">
        <p className={captionExpanded ? "whitespace-pre-wrap" : "line-clamp-3"}>
          <span className="mr-1 font-semibold text-white">[@SEU_PERFIL]</span>
          {copyText}
        </p>
        {copyText.length > 110 && (
          <button
            type="button"
            onClick={() => setCaptionExpanded((prev) => !prev)}
            className="mt-1 text-[11px] font-medium text-[#979797] hover:text-white"
          >
            {captionExpanded ? "Ver menos" : "Ver legenda completa"}
          </button>
        )}

        <button
          type="button"
          onClick={() => setVisualEditorOpen(true)}
          className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-[#1D1D1D] px-3 py-1.5 text-[11px] font-medium text-[#DCDCDC] hover:bg-[#272727] hover:text-white transition-colors"
        >
          <Layers className="h-3.5 w-3.5 text-[#31CF76]" />
          <span>Abrir no Editor Visual (4:5 / Safe Zones)</span>
        </button>
      </div>

      {visualEditorOpen && (
        <CarouselStoriesStudioEditor
          open={true}
          onClose={() => setVisualEditorOpen(false)}
          title={`Editor Visual · ${tarefa.titulo}`}
          initialMode={isReels || tarefa.tipo === "story" ? "stories_9_16" : "carousel_4_5"}
          initialSlides={rawPreviews.map(
            (url, idx): EditorialSlideItem => ({
              id: `${tarefa.tarefa_id}-slide-${idx + 1}`,
              url,
              ordem: idx,
            })
          )}
          initialCaption={copyText}
        />
      )}
    </div>
  );
}
