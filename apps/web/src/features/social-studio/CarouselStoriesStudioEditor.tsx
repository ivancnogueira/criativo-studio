import React, { useMemo, useState } from "react";
import type { EditorialPostRecord, EditorialSlideItem, MetaTrialGraduationStrategy } from "@criativo/contracts";
import { MetaFirstCommentPanel } from "./MetaFirstCommentPanel";
import { MetaTrialReelControlCard } from "./MetaTrialReelControlCard";
import {
  ArrowLeft, ArrowRight, Check, Copy, Eye, Film, Grid3x3, Heart, Image as ImageIcon,
  Layers, Loader2, MessageCircle, Plus, Save, Send, ShieldAlert, Smartphone, Trash2, X,
} from "lucide-react";

type EditorAspectMode = "carousel_4_5" | "stories_9_16";

export interface StudioEditorialSavePayload {
  slides: EditorialSlideItem[];
  legenda: string;
  formato?: EditorialPostRecord["formato"];
  trial_reel_enabled?: boolean;
  trial_graduation_strategy?: MetaTrialGraduationStrategy;
  primeiro_comentario?: string | null;
  primeiro_comentario_aprovado?: boolean;
  primeiro_comentario_delay_seg?: number;
}

export interface CarouselStoriesStudioEditorProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  initialMode?: EditorAspectMode;
  initialSlides: EditorialSlideItem[];
  initialCaption: string;
  editorialPost?: EditorialPostRecord | null;
  onSaveEditorial?: (payload: StudioEditorialSavePayload) => Promise<void>;
  onApproveCreative?: (payload: StudioEditorialSavePayload) => Promise<void>;
}

const IG_CAPTION_LIMIT = 2200;
const IG_FOLD_LIMIT = 125;
const MAX_CAROUSEL_SLIDES = 10;

function isVideoMedia(url: string): boolean {
  return /\.(mp4|webm|mov)(\?.*)?$/i.test(url);
}

export const CarouselStoriesStudioEditor: React.FC<CarouselStoriesStudioEditorProps> = ({
  open,
  onClose,
  title = "Editor Visual Instagram",
  initialMode = "carousel_4_5",
  initialSlides,
  initialCaption,
  editorialPost,
  onSaveEditorial,
  onApproveCreative,
}) => {
  const [mode, setMode] = useState<EditorAspectMode>(
    editorialPost?.formato === "story" || editorialPost?.formato === "reels"
      ? "stories_9_16"
      : initialMode
  );
  const [slides, setSlides] = useState<EditorialSlideItem[]>(() =>
    initialSlides.length > 0
      ? initialSlides.slice(0, MAX_CAROUSEL_SLIDES).map((s, idx) => ({ ...s, ordem: idx }))
      : []
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const [caption, setCaption] = useState(initialCaption);
  const [showSquareCropGuide, setShowSquareCropGuide] = useState(true);
  const [showSafeZones, setShowSafeZones] = useState(true);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [newSlideUrl, setNewSlideUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [trialReelEnabled, setTrialReelEnabled] = useState(Boolean(editorialPost?.trial_reel_enabled));
  const [trialStrategy, setTrialStrategy] = useState<MetaTrialGraduationStrategy>(editorialPost?.trial_graduation_strategy ?? "SS_PERFORMANCE");
  const [firstComment, setFirstComment] = useState(editorialPost?.primeiro_comentario ?? "");
  const [firstCommentApproved, setFirstCommentApproved] = useState(Boolean(editorialPost?.primeiro_comentario_aprovado));
  const [firstCommentDelay, setFirstCommentDelay] = useState(editorialPost?.primeiro_comentario_delay_seg ?? 30);

  const safeActiveIndex = slides.length > 0 ? Math.min(activeIndex, slides.length - 1) : 0;
  const currentSlide = slides[safeActiveIndex] ?? null;

  const captionFold = useMemo(() => {
    const clean = caption.trim();
    if (clean.length <= IG_FOLD_LIMIT) {
      return { before: clean, truncated: false };
    }
    return { before: clean.slice(0, IG_FOLD_LIMIT).trimEnd(), truncated: true };
  }, [caption]);

  if (!open) return null;

  const reindexSlides = (next: EditorialSlideItem[]) =>
    next.slice(0, MAX_CAROUSEL_SLIDES).map((item, idx) => ({ ...item, ordem: idx }));

  const handleMoveSlide = (from: number, to: number) => {
    if (to < 0 || to >= slides.length || from === to) return;
    const copy = [...slides];
    const [moved] = copy.splice(from, 1);
    copy.splice(to, 0, moved);
    setSlides(reindexSlides(copy));
    setActiveIndex(to);
  };

  const handleDuplicateSlide = (idx: number) => {
    if (slides.length >= MAX_CAROUSEL_SLIDES) return;
    const source = slides[idx];
    if (!source) return;
    const dup: EditorialSlideItem = {
      ...source,
      id: `slide-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    };
    const copy = [...slides];
    copy.splice(idx + 1, 0, dup);
    setSlides(reindexSlides(copy));
    setActiveIndex(idx + 1);
  };

  const handleRemoveSlide = (idx: number) => {
    const copy = slides.filter((_, i) => i !== idx);
    setSlides(reindexSlides(copy));
    setActiveIndex(Math.max(0, Math.min(idx, copy.length - 1)));
  };

  const handleAddSlide = () => {
    const url = newSlideUrl.trim();
    if (!url || slides.length >= MAX_CAROUSEL_SLIDES) return;
    const added: EditorialSlideItem = {
      id: `slide-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      url,
      ordem: slides.length,
      titulo_overlay: null,
      legenda_slide: null,
    };
    const next = reindexSlides([...slides, added]);
    setSlides(next);
    setActiveIndex(next.length - 1);
    setNewSlideUrl("");
  };

  const handleUpdateSlideOverlay = (text: string) => {
    if (!currentSlide) return;
    setSlides((prev) =>
      prev.map((item, idx) =>
        idx === safeActiveIndex ? { ...item, titulo_overlay: text } : item
      )
    );
  };

  const resolvedFormato: EditorialPostRecord["formato"] =
    editorialPost?.formato === "reels" ? "reels"
      : mode === "stories_9_16" ? "story"
        : slides.length > 1 ? "carrossel" : "feed_4_5";

  const buildSavePayload = (includeFormato: boolean): StudioEditorialSavePayload => ({
    slides,
    legenda: caption,
    ...(includeFormato ? { formato: resolvedFormato } : {}),
    trial_reel_enabled: trialReelEnabled,
    trial_graduation_strategy: trialStrategy,
    primeiro_comentario: firstComment.trim() || null,
    primeiro_comentario_aprovado: firstCommentApproved,
    primeiro_comentario_delay_seg: firstCommentDelay,
  });

  const runEditorialAction = async (
    action: ((p: StudioEditorialSavePayload) => Promise<void>) | undefined,
    includeFormato: boolean, setBusy: (v: boolean) => void, okMsg: string, errMsg: string
  ) => {
    if (!action) return;
    setBusy(true);
    setFeedback(null);
    try {
      await action(buildSavePayload(includeFormato));
      setFeedback(okMsg);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : errMsg);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveEditorial = () =>
    runEditorialAction(onSaveEditorial, true, setSaving, "Alterações salvas no Post Editorial.", "Erro ao salvar no Post Editorial.");

  const handleApprove = () =>
    runEditorialAction(onApproveCreative, false, setApproving, "Criativo aprovado com sucesso.", "Falha ao aprovar criativo.");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
    >
      <div className="flex h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#141414] text-[#F0F0F0] shadow-2xl">
        {/* Cabeçalho do Editor */}
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] bg-[#0D0D0D] px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#212121] text-[#31CF76]">
              <Layers className="h-4.5 w-4.5" />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold text-white">{title}</h2>
              <p className="text-[11.5px] text-[#979797]">
                {editorialPost
                  ? `Pauta: ${editorialPost.titulo}`
                  : "Prévia avançada 4:5 (corte 1:1) & Stories 9:16 (Safe Zones)"}
              </p>
            </div>
          </div>

          {/* Seletor de Modo: Carrossel 4:5 vs Stories 9:16 */}
          <div className="flex items-center gap-1 rounded-xl border border-white/[0.08] bg-[#1A1A1A] p-1">
            <button
              type="button"
              onClick={() => setMode("carousel_4_5")}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === "carousel_4_5"
                  ? "bg-[#2A2A2A] text-white"
                  : "text-[#979797] hover:text-white"
              }`}
            >
              <Grid3x3 className="h-3.5 w-3.5 text-[#42A0FF]" />
              <span>Carrossel 4:5 (1080×1350)</span>
            </button>
            <button
              type="button"
              onClick={() => setMode("stories_9_16")}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === "stories_9_16"
                  ? "bg-[#2A2A2A] text-white"
                  : "text-[#979797] hover:text-white"
              }`}
            >
              <Smartphone className="h-3.5 w-3.5 text-[#31CF76]" />
              <span>Stories 9:16 (Safe Zones)</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar editor visual"
            className="rounded-xl p-2 text-[#979797] hover:bg-[#212121] hover:text-white"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </header>

        {/* Corpo Principal: Palco Visual + Painel Lateral de Legenda & Controles */}
        <div className="flex flex-1 min-h-0 flex-col lg:flex-row">
          {/* Coluna Esquerda / Centro: Palco 4:5 ou 9:16 + Faixa de Miniaturas */}
          <div className="flex flex-1 min-h-0 flex-col justify-between bg-[#101010] p-4">
            {/* Barra de Overlays do Palco */}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs text-[#979797]">
                <span className="rounded-md border border-white/10 bg-[#1A1A1A] px-2 py-0.5 font-mono text-[11px] text-[#DCDCDC]">
                  Slide {slides.length > 0 ? safeActiveIndex + 1 : 0} / {MAX_CAROUSEL_SLIDES}
                </span>
                {mode === "carousel_4_5" ? (
                  <span>Proporção 4:5 · Área central destacada representa o corte 1:1 no Grid</span>
                ) : (
                  <span>Proporção 9:16 · Safe Zones oficiais para topo, base e laterais</span>
                )}
              </div>

              {mode === "carousel_4_5" ? (
                <button
                  type="button"
                  onClick={() => setShowSquareCropGuide((prev) => !prev)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                    showSquareCropGuide
                      ? "border-[#42A0FF]/50 bg-[#42A0FF]/15 text-[#42A0FF]"
                      : "border-white/10 bg-[#1A1A1A] text-[#979797] hover:text-white"
                  }`}
                >
                  <Grid3x3 className="h-3.5 w-3.5" />
                  <span>{showSquareCropGuide ? "Ocultar guia 1:1" : "Mostrar guia 1:1"}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowSafeZones((prev) => !prev)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                    showSafeZones
                      ? "border-[#FF9412]/50 bg-[#FF9412]/15 text-[#FF9412]"
                      : "border-white/10 bg-[#1A1A1A] text-[#979797] hover:text-white"
                  }`}
                >
                  <ShieldAlert className="h-3.5 w-3.5" />
                  <span>{showSafeZones ? "Ocultar Safe Zones" : "Mostrar Safe Zones"}</span>
                </button>
              )}
            </div>

            {/* Palco Central */}
            <div className="flex flex-1 min-h-0 items-center justify-center overflow-hidden">
              {mode === "carousel_4_5" ? (
                <div className="relative aspect-[4/5] h-full max-h-[430px] overflow-hidden rounded-xl border border-white/10 bg-[#1D1D1D] shadow-xl">
                  {currentSlide ? (
                    isVideoMedia(currentSlide.url) ? (
                      <video
                        src={currentSlide.url}
                        controls
                        playsInline
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <img
                        src={currentSlide.url}
                        alt={`Slide ${safeActiveIndex + 1}`}
                        className="h-full w-full object-cover"
                      />
                    )
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center text-[#979797]">
                      <ImageIcon className="h-10 w-10 text-[#42A0FF]" />
                      <p className="text-xs font-medium text-white">Nenhuma mídia adicionada</p>
                      <p className="text-[11px]">
                        Adicione imagens/vídeos abaixo ou gere criativos pelo Criativo no Calendário Editorial.
                      </p>
                    </div>
                  )}

                  {currentSlide?.titulo_overlay && (
                    <div className="pointer-events-none absolute inset-x-4 top-1/2 -translate-y-1/2 rounded-lg bg-black/55 px-3 py-2 text-center text-sm font-semibold text-white backdrop-blur-[2px]">
                      {currentSlide.titulo_overlay}
                    </div>
                  )}

                  {/* Overlay de guia de corte 1:1 (em 4:5, altura 1:1 ocupa 80% centrais; 10% topo e 10% base ficam fora do grid quadrado) */}
                  {showSquareCropGuide && (
                    <div className="pointer-events-none absolute inset-0 flex flex-col">
                      <div className="flex h-[10%] items-center justify-center bg-black/45 border-b border-dashed border-[#42A0FF]/70">
                        <span className="rounded bg-black/75 px-1.5 py-0.5 font-mono text-[9.5px] text-[#42A0FF]">
                          Fora do corte 1:1 (Topo 10%)
                        </span>
                      </div>
                      <div className="flex-1 border-x border-[#42A0FF]/35 flex items-end justify-end p-2">
                        <span className="rounded bg-[#0D0D0D]/80 px-1.5 py-0.5 font-mono text-[9.5px] text-[#31CF76]">
                          Área visível no Grid 1:1
                        </span>
                      </div>
                      <div className="flex h-[10%] items-center justify-center bg-black/45 border-t border-dashed border-[#42A0FF]/70">
                        <span className="rounded bg-black/75 px-1.5 py-0.5 font-mono text-[9.5px] text-[#42A0FF]">
                          Fora do corte 1:1 (Base 10%)
                        </span>
                      </div>
                    </div>
                  )}

                  {slides.length > 1 && (
                    <>
                      <button
                        type="button"
                        aria-label="Slide anterior"
                        disabled={safeActiveIndex === 0}
                        onClick={() => setActiveIndex(Math.max(0, safeActiveIndex - 1))}
                        className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/65 p-1.5 text-white hover:bg-black/85 disabled:opacity-30"
                      >
                        <ArrowLeft className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="Próximo slide"
                        disabled={safeActiveIndex >= slides.length - 1}
                        onClick={() => setActiveIndex(Math.min(slides.length - 1, safeActiveIndex + 1))}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/65 p-1.5 text-white hover:bg-black/85 disabled:opacity-30"
                      >
                        <ArrowRight className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
              ) : (
                /* Moldura Stories 9:16 com Safe Zones */
                <div className="relative aspect-[9/16] h-full max-h-[450px] overflow-hidden rounded-[22px] border border-white/15 bg-[#1B1B1B] shadow-2xl">
                  {currentSlide ? (
                    isVideoMedia(currentSlide.url) ? (
                      <video
                        src={currentSlide.url}
                        controls
                        playsInline
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <img
                        src={currentSlide.url}
                        alt={`Story ${safeActiveIndex + 1}`}
                        className="h-full w-full object-cover"
                      />
                    )
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-5 text-center text-[#979797]">
                      <Film className="h-9 w-9 text-[#31CF76]" />
                      <p className="text-xs font-medium text-white">Prévia Story 9:16</p>
                      <p className="text-[11px]">
                        1080×1920 com simulação de barra superior e resposta inferior.
                      </p>
                    </div>
                  )}

                  {currentSlide?.titulo_overlay && (
                    <div className="pointer-events-none absolute inset-x-5 top-1/2 -translate-y-1/2 rounded-xl bg-black/60 px-3 py-2 text-center text-sm font-semibold text-white">
                      {currentSlide.titulo_overlay}
                    </div>
                  )}

                  {/* Chrome realista do Instagram Stories (topo + base) */}
                  <div className="pointer-events-none absolute inset-x-0 top-0 z-10 p-2.5 bg-gradient-to-b from-black/70 to-transparent">
                    <div className="mb-2 flex gap-1">
                      {(slides.length > 0 ? slides : [{ id: "empty" }]).map((s, idx) => (
                        <div
                          key={s.id}
                          className={`h-0.5 flex-1 rounded-full ${
                            idx === safeActiveIndex ? "bg-white" : "bg-white/35"
                          }`}
                        />
                      ))}
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-tr from-[#31CF76] to-[#42A0FF] text-[9px] font-bold text-[#0D0D0D]">
                          IG
                        </div>
                        <span className="text-[11px] font-semibold text-white">[@SEU_PERFIL]</span>
                        <span className="text-[10px] text-white/70">2h</span>
                      </div>
                      <span className="text-xs text-white/80">×</span>
                    </div>
                  </div>

                  <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-center gap-2 bg-gradient-to-t from-black/75 to-transparent px-3 py-2.5">
                    <div className="flex-1 rounded-full border border-white/35 px-3 py-1 text-[10.5px] text-white/80">
                      Enviar mensagem para [@SEU_PERFIL]...
                    </div>
                    <Heart className="h-4 w-4 text-white" />
                    <Send className="h-4 w-4 text-white" />
                  </div>

                  {/* Overlay Interativo das Safe Zones Oficiais (14% topo, 18% base, 6% laterais) */}
                  {showSafeZones && (
                    <div className="pointer-events-none absolute inset-0 z-20">
                      <div className="absolute inset-x-0 top-0 flex h-[14%] items-end justify-center border-b-2 border-dashed border-[#FD2F3B] bg-[#FD2F3B]/20 pb-1">
                        <span className="rounded bg-black/80 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-[#FF8A90]">
                          ZONA DE RISCO TOPO (~14% / 250px)
                        </span>
                      </div>
                      <div className="absolute inset-x-0 bottom-0 flex h-[18%] items-start justify-center border-t-2 border-dashed border-[#FD2F3B] bg-[#FD2F3B]/20 pt-1">
                        <span className="rounded bg-black/80 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-[#FF8A90]">
                          ZONA DE RISCO BASE (~18% / 340px)
                        </span>
                      </div>
                      <div className="absolute inset-y-[14%] left-0 w-[6%] border-r border-dashed border-[#FF9412]/80 bg-[#FF9412]/15" />
                      <div className="absolute inset-y-[14%] right-0 w-[6%] border-l border-dashed border-[#FF9412]/80 bg-[#FF9412]/15" />
                      <div className="absolute bottom-[20%] left-1/2 -translate-x-1/2 rounded bg-black/75 px-2 py-0.5 font-mono text-[9px] text-[#31CF76]">
                        Área segura para textos e stickers
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Faixa Inferior de Miniaturas com Reordenação Drag-and-Drop + Setas */}
            <div className="mt-3 rounded-xl border border-white/[0.06] bg-[#141414] p-2.5">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11.5px] font-medium text-[#DCDCDC]">
                  Lâminas ({slides.length}/{MAX_CAROUSEL_SLIDES}) — arraste ou use as setas para reordenar
                </span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={newSlideUrl}
                    onChange={(e) => setNewSlideUrl(e.target.value)}
                    placeholder="/api/arquivos/raw?path=saidas/slide.png"
                    className="w-56 rounded-lg border border-white/10 bg-[#0D0D0D] px-2.5 py-1 text-[11px] text-white placeholder:text-[#6A6A6A] focus:border-[#42A0FF] focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={!newSlideUrl.trim() || slides.length >= MAX_CAROUSEL_SLIDES}
                    onClick={handleAddSlide}
                    className="inline-flex items-center gap-1 rounded-lg bg-[#212121] px-2.5 py-1 text-[11px] font-medium text-white hover:bg-[#2A2A2A] disabled:opacity-40"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Adicionar</span>
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {slides.map((slide, idx) => {
                  const selected = idx === safeActiveIndex;
                  return (
                    <div
                      key={slide.id}
                      draggable
                      onDragStart={() => setDragIndex(idx)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (dragIndex !== null && dragIndex !== idx) {
                          handleMoveSlide(dragIndex, idx);
                        }
                        setDragIndex(null);
                      }}
                      onClick={() => setActiveIndex(idx)}
                      className={`group relative flex h-20 w-16 shrink-0 cursor-pointer flex-col overflow-hidden rounded-lg border transition-all ${
                        selected
                          ? "border-[#42A0FF] ring-1 ring-[#42A0FF]"
                          : "border-white/10 hover:border-white/30"
                      } bg-[#212121]`}
                    >
                      {isVideoMedia(slide.url) ? (
                        <div className="flex h-full w-full items-center justify-center text-[#979797]">
                          <Film className="h-5 w-5" />
                        </div>
                      ) : (
                        <img
                          src={slide.url}
                          alt={`Miniatura ${idx + 1}`}
                          className="h-full w-full object-cover"
                        />
                      )}
                      <span className="absolute left-1 top-1 rounded bg-black/75 px-1 font-mono text-[9.5px] font-semibold text-white">
                        {idx + 1}
                      </span>
                      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/80 px-1 py-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          type="button"
                          title="Mover para esquerda"
                          disabled={idx === 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMoveSlide(idx, idx - 1);
                          }}
                          className="text-white disabled:opacity-30"
                        >
                          <ArrowLeft className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          title="Duplicar slide"
                          disabled={slides.length >= MAX_CAROUSEL_SLIDES}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDuplicateSlide(idx);
                          }}
                          className="text-[#42A0FF] disabled:opacity-30"
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          title="Remover slide"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveSlide(idx);
                          }}
                          className="text-[#FD2F3B]"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          title="Mover para direita"
                          disabled={idx >= slides.length - 1}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMoveSlide(idx, idx + 1);
                          }}
                          className="text-white disabled:opacity-30"
                        >
                          <ArrowRight className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
                {slides.length === 0 && (
                  <p className="py-3 text-xs text-[#6A6A6A]">
                    Nenhuma lâmina na sequência ainda. Cole um caminho/URL acima para testar no palco.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Painel Lateral: Legenda & CTA + Preview "ver mais" + Ações */}
          <aside className="flex w-full shrink-0 flex-col justify-between border-t border-white/[0.06] bg-[#141414] p-4 lg:w-[340px] lg:border-l lg:border-t-0">
            <div className="space-y-4 overflow-y-auto pr-1">
              {currentSlide && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-[#DCDCDC]">
                    Texto / Sticker simulado no Slide {safeActiveIndex + 1}
                  </label>
                  <input
                    type="text"
                    value={currentSlide.titulo_overlay ?? ""}
                    onChange={(e) => handleUpdateSlideOverlay(e.target.value)}
                    placeholder="Ex.: CTA ou manchete de capa"
                    className="w-full rounded-xl border border-white/10 bg-[#0D0D0D] px-3 py-2 text-xs text-white placeholder:text-[#6A6A6A] focus:border-[#42A0FF] focus:outline-none"
                  />
                </div>
              )}

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-xs font-medium text-[#DCDCDC]">Legenda & CTA</label>
                  <span
                    className={`font-mono text-[11px] ${
                      caption.length > IG_CAPTION_LIMIT ? "text-[#FD2F3B]" : "text-[#979797]"
                    }`}
                  >
                    {caption.length} / {IG_CAPTION_LIMIT}
                  </span>
                </div>
                <textarea
                  rows={7}
                  maxLength={IG_CAPTION_LIMIT + 200}
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Escreva a legenda com gancho na primeira linha, desenvolvimento e CTA..."
                  className="w-full resize-none rounded-xl border border-white/10 bg-[#0D0D0D] p-3 text-xs leading-relaxed text-white placeholder:text-[#6A6A6A] focus:border-[#42A0FF] focus:outline-none"
                />
              </div>

              {/* Preview exato da dobra "... ver mais" do Instagram */}
              <div className="rounded-xl border border-white/[0.06] bg-[#1A1A1A] p-3">
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-[#979797]">
                  <Eye className="h-3.5 w-3.5 text-[#42A0FF]" />
                  <span>Preview de quebra no feed (~{IG_FOLD_LIMIT} chars)</span>
                </div>
                <p className="text-xs leading-relaxed text-[#DCDCDC]">
                  <span className="mr-1 font-semibold text-white">[@SEU_PERFIL]</span>
                  {captionFold.before || "Sua primeira linha aparecerá aqui antes do corte."}
                  {captionFold.truncated && (
                    <span className="ml-1 text-[#979797]">... mais</span>
                  )}
                </p>
              </div>

              <MetaTrialReelControlCard
                visible={mode === "stories_9_16" || editorialPost?.formato === "reels"}
                enabled={trialReelEnabled}
                strategy={trialStrategy}
                onChangeEnabled={setTrialReelEnabled}
                onChangeStrategy={setTrialStrategy}
              />

              <MetaFirstCommentPanel
                commentText={firstComment}
                approved={firstCommentApproved}
                delaySeconds={firstCommentDelay}
                mediaId={editorialPost?.meta_media_id}
                editorialPostId={editorialPost?.id}
                onChangeCommentText={setFirstComment}
                onChangeApproved={setFirstCommentApproved}
                onChangeDelaySeconds={setFirstCommentDelay}
              />

              <div className="rounded-xl border border-white/[0.06] bg-[#1A1A1A] p-3 text-[11px] text-[#979797] space-y-1">
                <p className="font-medium text-[#DCDCDC] flex items-center gap-1.5">
                  <MessageCircle className="h-3.5 w-3.5 text-[#31CF76]" />
                  <span>Checklist de publicação segura</span>
                </p>
                <p>• Lâminas em 4:5 (1080×1350) ou Story 9:16 (1080×1920).</p>
                <p>• Headline principal dentro do corte 1:1 para não cortar no grid.</p>
                <p>• Textos e stickers no Story fora das zonas de risco vermelhas.</p>
              </div>
            </div>

            <div className="mt-4 space-y-2 border-t border-white/[0.06] pt-3">
              {feedback && (
                <p className="rounded-lg bg-[#212121] px-3 py-2 text-xs text-[#31CF76]">
                  {feedback}
                </p>
              )}
              <div className="flex flex-col gap-2">
                {onSaveEditorial && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={handleSaveEditorial}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-[#212121] px-4 py-2 text-xs font-semibold text-white hover:bg-[#2A2A2A] disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    <span>Salvar no Post Editorial</span>
                  </button>
                )}
                {onApproveCreative && (
                  <button
                    type="button"
                    disabled={approving}
                    onClick={handleApprove}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#31CF76] px-4 py-2 text-xs font-semibold text-[#0D0D0D] hover:bg-[#3CE084] disabled:opacity-50"
                  >
                    {approving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    <span>Aprovar Criativo</span>
                  </button>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};
