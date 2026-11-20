import React, { useRef, useState } from "react";
import type { AvatarShape, AvatarStyle } from "@criativo/contracts";
import { ImagePlus, Sparkles, Trash2, Upload } from "lucide-react";
import { daemonApi } from "../../services/websocket-client";
import {
  AVATAR_STYLES,
  AVATAR_VARIANTS_BY_STYLE,
  getDefaultVariantForStyle,
  MASCOT_COLOR_PALETTE,
  MASCOT_SHAPES,
} from "./avatar-catalog";
import type { AvatarExpression } from "./avatar-types";
import { MascoteAvatar } from "./MascoteAvatarBase";

const AI_STYLE_PRESETS = [
  { id: "3D Pixar", label: "3D Pixar" },
  { id: "Ilustração Cartoon", label: "Cartoon" },
  { id: "Retrato Fotográfico", label: "Foto Real" },
  { id: "Anime Moderno", label: "Anime" },
  { id: "Cyberpunk Neon", label: "Cyberpunk" },
  { id: "Minimalista Editorial", label: "Minimalista" },
] as const;

const PREVIEW_EXPRESSION_CHIPS: ReadonlyArray<{
  id: AvatarExpression | null;
  label: string;
}> = [
  { id: null, label: "Vivo" },
  { id: "talking", label: "Falando" },
  { id: "cash", label: "Ads $" },
  { id: "shock", label: "Alerta !" },
  { id: "sleep", label: "Dormindo" },
  { id: "love", label: "Amor" },
];

export interface MascoteAppearancePickerProps {
  color: string;
  shape: AvatarShape;
  style?: AvatarStyle;
  variant?: string;
  imageUrl?: string | null;
  agentName?: string;
  compact?: boolean;
  showLivePreview?: boolean;
  onChangeColor: (color: string) => void;
  onChangeShape: (shape: AvatarShape) => void;
  onChangeStyle?: (style: AvatarStyle) => void;
  onChangeVariant?: (variant: string) => void;
  onChangeImageUrl?: (url: string | null) => void;
}

/**
 * Seletor completo de avatares com 8 estilos, 17 cores, grade de 20 variações por estilo e Upload/IA.
 */
export const AvatarAppearancePicker: React.FC<MascoteAppearancePickerProps> = ({
  color,
  shape,
  style = "classic",
  variant,
  imageUrl = null,
  agentName = "",
  compact = false,
  showLivePreview = false,
  onChangeColor,
  onChangeShape,
  onChangeStyle,
  onChangeVariant,
  onChangeImageUrl,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [previewExp, setPreviewExp] = useState<AvatarExpression | null>(null);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiVisualStyle, setAiVisualStyle] = useState<string>(AI_STYLE_PRESETS[0].id);
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [mediaFeedback, setMediaFeedback] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);

  const activeStyle: AvatarStyle = style ?? "classic";
  const activeVariant = variant || getDefaultVariantForStyle(activeStyle, shape);
  const variants = AVATAR_VARIANTS_BY_STYLE[activeStyle] ?? [];
  const activeVariantMeta = variants.find((v) => v.id === activeVariant) ?? variants[0];

  const handleSelectStyleTab = (nextStyle: AvatarStyle) => {
    setMediaFeedback(null);
    onChangeStyle?.(nextStyle);
    if (nextStyle === "classic") {
      onChangeVariant?.(shape);
    } else if (nextStyle !== "image") {
      onChangeVariant?.(getDefaultVariantForStyle(nextStyle, shape));
    }
  };

  const handleUploadFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setUploading(true);
    setMediaFeedback(null);
    try {
      const uploaded = await daemonApi.uploadAgentAvatar(file);
      onChangeStyle?.("image");
      onChangeImageUrl?.(uploaded.avatar_image_url);
      setMediaFeedback({ kind: "ok", text: "Foto carregada com sucesso." });
    } catch (err) {
      setMediaFeedback({
        kind: "error",
        text: err instanceof Error ? err.message : "Erro ao enviar foto.",
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleGenerateAi = async () => {
    const promptText =
      aiPrompt.trim() ||
      `Avatar carismático para o agente ${agentName || "especialista criativo"}`;
    setGenerating(true);
    setMediaFeedback(null);
    try {
      const res = await daemonApi.generateAgentAvatar({
        prompt: promptText,
        estilo: aiVisualStyle,
        nome_agente: agentName || undefined,
      });
      onChangeStyle?.("image");
      onChangeImageUrl?.(res.avatar_image_url);
      setMediaFeedback({
        kind: "ok",
        text: `Avatar gerado com IA${res.model ? ` (${res.model})` : ""}.`,
      });
    } catch (err) {
      setMediaFeedback({
        kind: "error",
        text: err instanceof Error ? err.message : "Falha ao gerar avatar com IA.",
      });
    } finally {
      setGenerating(false);
    }
  };

  const row1 = MASCOT_COLOR_PALETTE.slice(0, 9);
  const row2 = MASCOT_COLOR_PALETTE.slice(9, 17);

  return (
    <div className="w-full space-y-3">
      {showLivePreview && (
        <div className="flex flex-col items-center gap-2 rounded-xl bg-[#181818] border border-white/[0.06] p-3">
          <MascoteAvatar
            style={activeStyle}
            shape={shape}
            variant={activeVariant}
            color={color}
            imageUrl={imageUrl}
            size={compact ? 64 : 74}
            animated
            trackCursor
            expressionOverride={previewExp}
            mood={
              previewExp === "shock"
                ? "failed"
                : previewExp === "sleep"
                  ? "idle"
                  : previewExp
                    ? "working"
                    : "idle"
            }
          />
          {activeStyle !== "classic" && activeStyle !== "image" && (
            <div className="flex flex-wrap items-center justify-center gap-1 pt-0.5">
              {PREVIEW_EXPRESSION_CHIPS.map((chip) => {
                const active = previewExp === chip.id;
                return (
                  <button
                    key={chip.label}
                    type="button"
                    onClick={() => setPreviewExp(chip.id)}
                    className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                      active
                        ? "bg-[#007CF7] text-white"
                        : "bg-[#242424] text-[#979797] hover:text-white"
                    }`}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Abas dos 8 estilos */}
      {onChangeStyle && (
        <div className="flex flex-wrap items-center justify-center gap-1">
          {AVATAR_STYLES.map((st) => {
            const active = st.id === activeStyle;
            return (
              <button
                key={st.id}
                type="button"
                onClick={() => handleSelectStyleTab(st.id)}
                title={st.description}
                className={`rounded-lg px-2 py-1 text-[11px] font-medium transition-colors ${
                  active
                    ? "bg-[#007CF7] text-white font-semibold"
                    : "bg-[#242424] text-[#979797] hover:text-white hover:bg-[#2A2A2A]"
                }`}
              >
                {compact ? st.shortLabel : st.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Modo Foto / IA */}
      {activeStyle === "image" ? (
        <div className="space-y-3 rounded-xl bg-[#181818] border border-white/[0.06] p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <MascoteAvatar
                style="image"
                shape={shape}
                color={color}
                imageUrl={imageUrl}
                size={42}
              />
              <div className="min-w-0">
                <p className="text-[12px] font-semibold text-white truncate">
                  {imageUrl ? "Foto personalizada ativa" : "Nenhuma foto definida"}
                </p>
                <p className="text-[10.5px] text-[#979797]">
                  PNG, JPG ou WebP até 5 MB · recorte circular
                </p>
              </div>
            </div>
            {imageUrl && (
              <button
                type="button"
                onClick={() => {
                  onChangeImageUrl?.(null);
                  setMediaFeedback(null);
                }}
                title="Remover foto atual"
                className="rounded-lg p-1.5 text-[#979797] hover:bg-[#FD2F3B]/15 hover:text-[#FF7675] transition-colors shrink-0"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => void handleUploadFile(e.target.files)}
          />
          <button
            type="button"
            disabled={uploading || generating}
            onClick={() => fileInputRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-[#242424] hover:bg-[#2C2C2C] px-3 py-2 text-[12px] font-semibold text-white transition-colors disabled:opacity-50"
          >
            {uploading ? (
              <span>Enviando imagem...</span>
            ) : (
              <>
                <Upload className="h-3.5 w-3.5 text-[#42A0FF]" />
                <span>Enviar foto do computador</span>
              </>
            )}
          </button>

          <div className="pt-2 border-t border-white/[0.06] space-y-2">
            <label className="flex items-center gap-1.5 text-[11.5px] font-semibold text-[#DCDCDC]">
              <Sparkles className="h-3.5 w-3.5 text-[#a855f7]" />
              <span>Ou gerar avatar exclusivo com IA</span>
            </label>
            <textarea
              rows={2}
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="Ex.: Robô amigável sorrindo com fones neon azul em fundo escuro..."
              className="w-full rounded-lg bg-[#212121] border border-white/10 px-2.5 py-1.5 text-[11.5px] text-white placeholder-[#6A6A6A] focus:outline-none focus:border-white/30 resize-none"
            />
            <div className="flex flex-wrap gap-1">
              {AI_STYLE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setAiVisualStyle(preset.id)}
                  className={`rounded-md px-2 py-0.5 text-[10.5px] transition-colors ${
                    aiVisualStyle === preset.id
                      ? "bg-[#a855f7]/25 text-[#d8b4fe] border border-[#a855f7]/50 font-semibold"
                      : "bg-[#242424] text-[#979797] border border-transparent hover:text-white"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={generating || uploading}
              onClick={() => void handleGenerateAi()}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-[#007CF7] hover:bg-[#198cff] px-3 py-2 text-[12px] font-semibold text-white transition-colors disabled:opacity-50"
            >
              <ImagePlus className="h-3.5 w-3.5" />
              <span>{generating ? "Gerando avatar com IA..." : "Gerar com IA"}</span>
            </button>
          </div>

          {mediaFeedback && (
            <p
              className={`text-[11px] rounded-lg px-2.5 py-1.5 ${
                mediaFeedback.kind === "error"
                  ? "bg-[#FD2F3B]/15 text-[#FF7675] border border-[#FD2F3B]/30"
                  : "bg-[#31CF76]/15 text-[#31CF76] border border-[#31CF76]/30"
              }`}
            >
              {mediaFeedback.text}
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          {/* Paleta 17 cores */}
          <div className="flex flex-col items-center gap-1.5">
            {[row1, row2].map((row, rIdx) => (
              <div key={rIdx} className="flex items-center gap-1.5 flex-wrap justify-center">
                {row.map((hex) => {
                  const selected = hex.toLowerCase() === color.toLowerCase();
                  return (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => onChangeColor(hex)}
                      aria-label={`Selecionar cor ${hex}`}
                      className={`h-4 w-4 rounded-full transition-transform ${
                        selected
                          ? "ring-2 ring-white ring-offset-2 ring-offset-[#1A1A1A] scale-110"
                          : "hover:scale-110 opacity-90 hover:opacity-100"
                      }`}
                      style={{ backgroundColor: hex }}
                    />
                  );
                })}
              </div>
            ))}
          </div>

          {/* Grade de modelos: 8 no Clássico ou 20 nos novos estilos */}
          {activeStyle === "classic" ? (
            <div className="flex items-center gap-1.5 flex-wrap justify-center pt-1">
              {MASCOT_SHAPES.map((item) => {
                const active = item.id === shape;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onChangeShape(item.id);
                      onChangeVariant?.(item.id);
                    }}
                    title={item.label}
                    aria-label={`Formato ${item.label}`}
                    className={`h-8 w-8 rounded-lg flex items-center justify-center transition-colors ${
                      active
                        ? "bg-[#2A2A2A] ring-1 ring-[#42A0FF]"
                        : "hover:bg-[#242424] opacity-80 hover:opacity-100"
                    }`}
                  >
                    <MascoteAvatar style="classic" shape={item.id} color={color} size={22} />
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="w-full space-y-1.5">
              <div
                className={`max-h-[210px] overflow-y-auto pr-1 grid gap-1.5 ${
                  compact ? "grid-cols-4" : "grid-cols-5"
                }`}
              >
                {variants.map((item) => {
                  const active = item.id === activeVariant;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onChangeVariant?.(item.id)}
                      title={item.label}
                      aria-label={item.label}
                      className={`flex flex-col items-center justify-center gap-0.5 rounded-xl p-1.5 transition-colors ${
                        active
                          ? "bg-[#2A2A2A] ring-1 ring-[#42A0FF]"
                          : "bg-[#181818]/60 hover:bg-[#242424] opacity-85 hover:opacity-100"
                      }`}
                    >
                      <MascoteAvatar
                        style={activeStyle}
                        shape={shape}
                        variant={item.id}
                        color={color}
                        size={compact ? 30 : 34}
                        expressionOverride="cute"
                        hoverAnimate={false}
                      />
                    </button>
                  );
                })}
              </div>
              {activeVariantMeta && (
                <p className="text-center text-[11px] text-[#979797]">
                  Modelo: <span className="text-[#DCDCDC] font-medium">{activeVariantMeta.label}</span>
                  {" "}({variants.length} variações)
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const MascoteAppearancePicker = AvatarAppearancePicker;
