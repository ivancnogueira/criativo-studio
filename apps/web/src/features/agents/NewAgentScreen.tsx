import React, { useState } from "react";
import type {
  AvatarShape,
  AvatarStyle,
  NivelEsforco,
  ProvedorStatusInfo,
} from "@criativo/contracts";
import { ChevronDown } from "lucide-react";
import {
  getDefaultVariantForStyle,
  MascoteAppearancePicker,
  MascoteAvatar,
} from "../../components/MascoteAvatar";
import {
  inferProviderFromModelId,
  ModelProviderPopover,
} from "../../components/ModelProviderPopover";
import { ProviderLogo } from "../../components/ProviderLogo";

export interface NewAgentPayload {
  nome: string;
  prompt_base: string;
  papel: string;
  modelo_padrao: string;
  avatar_shape: AvatarShape;
  avatar_color: string;
  avatar_style?: AvatarStyle;
  avatar_variant?: string;
  avatar_image_url?: string | null;
  effort: NivelEsforco;
}

interface NewAgentScreenProps {
  provedores: ProvedorStatusInfo[];
  onCreateAgent: (payload: NewAgentPayload) => Promise<void>;
  onOpenConnectors?: () => void;
}

const AGENT_SUGGESTIONS: Array<{
  nome: string;
  descricao: string;
  prompt: string;
  shape: AvatarShape;
  color: string;
  modelo: string;
  effort: NivelEsforco;
}> = [
  {
    nome: "Curador de Ganchos Virais",
    descricao: "Cria aberturas magnéticas de 3s para Reels e carrosséis de [NOME_DA_MARCA].",
    prompt:
      "Atue como especialista em retenção nos 3 primeiros segundos. Gere 10 ganchos curtos de alta curiosidade sem promessas irreais para [@SEU_PERFIL].",
    shape: "blob",
    color: "#d946ef",
    modelo: "claude-3-7-sonnet-latest",
    effort: "alto",
  },
  {
    nome: "Diretor de Oferta & Meta Ads",
    descricao: "Compara ângulos de anúncio A/B e valida legibilidade mobile.",
    prompt:
      "Estruture variações A/B de anúncios estáticos com título forte, prova e CTA direto usando generate_image 3:4.",
    shape: "triangle",
    color: "#38bdf8",
    modelo: "gpt-4o",
    effort: "medio",
  },
  {
    nome: "Organizador de Calendário",
    descricao: "Transforma notas e áudios soltos em pautas da semana para a equipe.",
    prompt:
      "Converte ideias em uma tabela semanal pronta com pilar, formato (Carrossel/Reels/Stories) e objetivo de negócio.",
    shape: "hex",
    color: "#eab308",
    modelo: "gemini-2.5-pro",
    effort: "alto",
  },
  {
    nome: "Auditor de Consistência Visual",
    descricao: "Confere referências ImagePaths e enquadramento antes do render.",
    prompt:
      "Garanta que todas as lâminas respeitem margens seguras, tipografia contrastante e identidade visual de [NOME_DA_MARCA].",
    shape: "rounded_square",
    color: "#22c55e",
    modelo: "gemini-2.5-flash-image",
    effort: "medio",
  },
  {
    nome: "Parceiro de Legendas & CTA",
    descricao: "Escreve legendas naturais com narrativa escaneável e CTA de comentário.",
    prompt:
      "Produza legendas em português brasileiro claro com 1ª linha de impacto, bullets escaneáveis e fechamento focado em salvamentos.",
    shape: "cloud",
    color: "#f97316",
    modelo: "claude-3-7-sonnet-latest",
    effort: "medio",
  },
  {
    nome: "Revisor de Métricas IG",
    descricao: "Sintetiza alcance e salvamentos para sugerir os próximos temas.",
    prompt:
      "Analise métricas em CSV ou tabela Markdown e destaque exatamente quais pilares repetir e quais otimizar na próxima semana.",
    shape: "octo",
    color: "#6366f1",
    modelo: "grok-4.6",
    effort: "alto",
  },
];

const EFFORT_LABELS: Record<NivelEsforco, string> = {
  baixo: "Baixo",
  medio: "Médio",
  alto: "Alto",
};

/**
 * Construtor 'Novo agente' nativo do Criativo Studio.
 */
export const NewAgentScreen: React.FC<NewAgentScreenProps> = ({
  provedores,
  onCreateAgent,
  onOpenConnectors,
}) => {
  const [nome, setNome] = useState("Novo agente");
  const [prompt, setPrompt] = useState("");
  const [color, setColor] = useState("#38bdf8");
  const [shape, setShape] = useState<AvatarShape>("rounded_square");
  const [style, setStyle] = useState<AvatarStyle>("classic");
  const [variant, setVariant] = useState<string>("rounded_square");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [modelo, setModelo] = useState("gemini-2.5-flash");
  const [effort, setEffort] = useState<NivelEsforco>("alto");
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const activeProvider = inferProviderFromModelId(modelo);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onCreateAgent({
        nome: nome.trim(),
        prompt_base:
          prompt.trim() ||
          `Atue como ${nome.trim()} do Criativo AI Studio auxiliando [NOME_DA_MARCA] em conteúdo estratégico.`,
        papel: prompt.trim().slice(0, 96) || "Especialista customizado do estúdio",
        modelo_padrao: modelo,
        avatar_shape: shape,
        avatar_color: color,
        avatar_style: style,
        avatar_variant: variant || getDefaultVariantForStyle(style, shape),
        avatar_image_url: style === "image" ? imageUrl : null,
        effort,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex-1 h-full bg-[#1A1A1A] flex flex-col justify-between overflow-y-auto px-6 py-8">
      <div className="my-auto mx-auto w-full max-w-[460px] flex flex-col items-center">
        {/* Mascote interativo no centro */}
        <div className="mb-4">
          <MascoteAvatar
            style={style}
            shape={shape}
            variant={variant}
            color={color}
            imageUrl={imageUrl}
            size={84}
            trackCursor
            animated
            label={`Preview do mascote ${nome}`}
          />
        </div>

        {/* Seletor completo: 8 estilos + 17 cores + 20 variações + Foto/IA */}
        <div className="mb-6 w-full">
          <MascoteAppearancePicker
            color={color}
            shape={shape}
            style={style}
            variant={variant}
            imageUrl={imageUrl}
            agentName={nome}
            onChangeColor={setColor}
            onChangeShape={setShape}
            onChangeStyle={setStyle}
            onChangeVariant={setVariant}
            onChangeImageUrl={setImageUrl}
          />
        </div>

        <form onSubmit={handleSubmit} className="w-full space-y-3.5">
          <div>
            <label
              htmlFor="new-agent-name"
              className="block text-[11.5px] font-medium text-[#979797] mb-1.5"
            >
              Nome <span className="text-[#FD2F3B]">*</span>
            </label>
            <input
              id="new-agent-name"
              name="agent_name"
              aria-label="Nome do agente"
              required
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Novo agente"
              className="w-full rounded-xl bg-[#212121] border border-white/10 px-3.5 py-2.5 text-[13px] text-white placeholder-[#6A6A6A] focus:outline-none focus:border-white/30"
            />
          </div>

          <div>
            <label
              htmlFor="new-agent-prompt"
              className="block text-[11.5px] font-medium text-[#979797] mb-1.5"
            >
              Em que este agente deve ajudar?
            </label>
            <textarea
              id="new-agent-prompt"
              name="agent_prompt"
              aria-label="Objetivo e instruções do agente"
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Planejar campanhas, revisar carrosséis ou criar variações para [@SEU_PERFIL]."
              className="w-full rounded-xl bg-[#212121] border border-white/10 px-3.5 py-2.5 text-[13px] text-white placeholder-[#6A6A6A] focus:outline-none focus:border-white/30 resize-none"
            />
          </div>

          {/* Linha seletora de Modelo + Esforço idêntica à Screenshot 3 */}
          <button
            type="button"
            onClick={() => setPopoverOpen(true)}
            className="w-full rounded-xl bg-[#212121] hover:bg-[#242424] border border-white/10 px-3.5 py-2.5 flex items-center justify-between transition-colors"
          >
            <span className="text-[12.5px] text-[#979797]">Modelo</span>
            <span className="inline-flex items-center gap-2 text-[12.5px] font-medium text-white">
              <ProviderLogo provider={activeProvider} size={15} />
              <span>{modelo}</span>
              <span className="text-[#6A6A6A]">·</span>
              <span className="text-[#979797]">{EFFORT_LABELS[effort]}</span>
              <ChevronDown className="h-3.5 w-3.5 text-[#979797]" />
            </span>
          </button>

          <div className="pt-2 flex justify-center">
            <button
              type="submit"
              disabled={submitting || !nome.trim()}
              className="studio-btn-primary px-6 py-2 text-[13px] shadow-md disabled:opacity-50"
            >
              {submitting ? "Criando..." : "Criar agente"}
            </button>
          </div>
        </form>
      </div>

      {/* Faixa inferior de cards de Sugestões (Screenshot 3) */}
      <div className="w-full max-w-[1120px] mx-auto pt-8">
        <p className="text-[11.5px] font-medium text-[#6A6A6A] mb-2.5">Sugestões</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2.5">
          {AGENT_SUGGESTIONS.map((sug) => (
            <button
              key={sug.nome}
              type="button"
              onClick={() => {
                setNome(sug.nome);
                setPrompt(sug.prompt);
                setStyle("classic");
                setShape(sug.shape);
                setVariant(sug.shape);
                setImageUrl(null);
                setColor(sug.color);
                setModelo(sug.modelo);
                setEffort(sug.effort);
              }}
              className="rounded-xl bg-[#212121] hover:bg-[#262626] border border-white/[0.06] p-3 text-left flex items-start gap-2.5 transition-colors"
            >
              <MascoteAvatar shape={sug.shape} color={sug.color} size={32} />
              <div className="min-w-0">
                <div className="text-[12.5px] font-semibold text-white truncate">{sug.nome}</div>
                <p className="text-[11px] text-[#979797] line-clamp-2 mt-0.5 leading-snug">
                  {sug.descricao}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>

      <ModelProviderPopover
        open={popoverOpen}
        onClose={() => setPopoverOpen(false)}
        provedores={provedores}
        selectedModel={modelo}
        selectedEffort={effort}
        onSelectModelAndEffort={(nextModel, nextEffort) => {
          setModelo(nextModel);
          setEffort(nextEffort);
        }}
        onOpenConnectors={onOpenConnectors}
      />
    </div>
  );
};
