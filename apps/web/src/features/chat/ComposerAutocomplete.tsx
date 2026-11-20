import React from "react";
import type { AgenteRegistro, ArquivoStudio, AvatarShape } from "@criativo/contracts";
import {
  FileText,
  FolderOpen,
  Image as ImageIcon,
  RotateCcw,
  Sparkles,
  Table2,
  MessageCircleQuestion,
  Paperclip,
  Video,
} from "lucide-react";
import {
  MascoteAvatar,
  resolveAgentAvatarConfig,
  type AgentAvatarVisual,
} from "../../components/MascoteAvatar";

export interface ComposerTriggerMatch {
  kind: "slash" | "mention";
  query: string;
  startIndex: number;
  endIndex: number;
}

export interface SlashCommandOption {
  id: string;
  command: string;
  label: string;
  description: string;
  category: "acao" | "atalho";
  action?: "new_chat" | "side_question" | "attach_file" | "open_tables";
  template?: string;
}

export const SLASH_COMMANDS: SlashCommandOption[] = [
  {
    id: "novo",
    command: "/novo",
    label: "/novo",
    description: "Reiniciar contexto do modelo e iniciar novo chat",
    category: "acao",
    action: "new_chat",
  },
  {
    id: "lateral",
    command: "/lateral",
    label: "/lateral",
    description: "Abrir painel de pergunta lateral sem poluir o histórico",
    category: "acao",
    action: "side_question",
  },
  {
    id: "anexar",
    command: "/anexar",
    label: "/anexar",
    description: "Anexar foto, logo, vídeo ou PDF ao pedido",
    category: "acao",
    action: "attach_file",
  },
  {
    id: "tabelas",
    command: "/tabelas",
    label: "/tabelas",
    description: "Abrir Tabelas SQL compartilhadas do estúdio",
    category: "acao",
    action: "open_tables",
  },
  {
    id: "carrossel",
    command: "/carrossel",
    label: "/carrossel",
    description: "Briefing completo para carrossel estratégico (1080x1350)",
    category: "atalho",
    template:
      "Crie um carrossel estratégico completo (1080x1350) com gancho de alta retenção no primeiro slide, desenvolvimento objetivo nos slides intermediários, CTA no final e legenda pronta sobre: ",
  },
  {
    id: "post",
    command: "/post",
    label: "/post",
    description: "Criativo de post estático individual para o feed",
    category: "atalho",
    template:
      "Desenvolva um post individual (1080x1350) alinhado à identidade visual da marca, com texto curto de arte, direção visual e legenda persuasiva sobre: ",
  },
  {
    id: "reels",
    command: "/reels",
    label: "/reels",
    description: "Roteiro de vídeo curto / Reels com gancho nos 2s iniciais",
    category: "atalho",
    template:
      "Escreva um roteiro de Reels vertical com gancho nos primeiros 2 segundos, marcações visuais cena a cena, narração natural e CTA sobre: ",
  },
  {
    id: "stories",
    command: "/stories",
    label: "/stories",
    description: "Sequência de Stories (9:16) com interação e conversão",
    category: "atalho",
    template:
      "Monte uma sequência estratégica de 5 Stories verticais (1080x1920) com abertura de curiosidade, prova/contexto, enquete interativa e CTA direto sobre: ",
  },
  {
    id: "metricas",
    command: "/metricas",
    label: "/metricas",
    description: "Analisar performance recente e padrões do perfil",
    category: "atalho",
    template:
      "Analise as métricas e publicações recentes do nosso Instagram, identifique os formatos com maior retenção/salvamentos e recomende os ajustes para os próximos conteúdos.",
  },
  {
    id: "calendario",
    command: "/calendario",
    label: "/calendario",
    description: "Planejar calendário editorial semanal conectado à oferta",
    category: "atalho",
    template:
      "Elabore o calendário editorial da próxima semana equilibrando nossos pilares de conteúdo, formatos e chamadas de conversão para a oferta principal.",
  },
];

export type ComposerAutocompleteItem =
  | {
      key: string;
      kind: "slash";
      command: SlashCommandOption;
    }
  | {
      key: string;
      kind: "agent";
      agente: AgenteRegistro;
      avatar: AgentAvatarVisual;
    }
  | {
      key: string;
      kind: "file";
      arquivo: ArquivoStudio;
    };

/**
 * Detecta se o cursor atual no textarea está logo após um comando `/` ou menção `@`.
 * Exige início da string ou espaço/quebra de linha antes do marcador para evitar falsos positivos em URLs ou e-mails.
 */
export function detectComposerTrigger(text: string, cursorPos: number): ComposerTriggerMatch | null {
  const safeCursor = Math.max(0, Math.min(cursorPos, text.length));
  const slice = text.slice(0, safeCursor);
  const match = slice.match(/(?:^|\s)([/@][^\s]*)$/);
  if (!match) return null;

  const token = match[1];
  const startIndex = safeCursor - token.length;
  return {
    kind: token.startsWith("/") ? "slash" : "mention",
    query: token.slice(1),
    startIndex,
    endIndex: safeCursor,
  };
}

/**
 * Constrói a lista filtrada de sugestões de autocomplete para `/` e `@`.
 */
export function buildComposerAutocompleteItems(params: {
  trigger: ComposerTriggerMatch | null;
  agentes: AgenteRegistro[];
  arquivos: ArquivoStudio[];
  capabilities?: {
    allowNewChat?: boolean;
    hasSideQuestion?: boolean;
    hasSharedTables?: boolean;
  };
}): ComposerAutocompleteItem[] {
  const { trigger, agentes, arquivos, capabilities } = params;
  if (!trigger) return [];
  const q = trigger.query.trim().toLowerCase();

  if (trigger.kind === "slash") {
    return SLASH_COMMANDS.filter((cmd) => {
      if (cmd.action === "new_chat" && capabilities?.allowNewChat === false) return false;
      if (cmd.action === "side_question" && !capabilities?.hasSideQuestion) return false;
      if (cmd.action === "open_tables" && !capabilities?.hasSharedTables) return false;
      if (!q) return true;
      return (
        cmd.command.toLowerCase().includes(`/${q}`) ||
        cmd.id.toLowerCase().includes(q) ||
        cmd.description.toLowerCase().includes(q)
      );
    }).map((command) => ({
      key: `slash:${command.id}`,
      kind: "slash",
      command,
    }));
  }

  const unlockedAgents = agentes.filter((ag) => {
    if (ag.agente_id === "assistente_setup") return false;
    const cfg = (ag.config ?? {}) as Record<string, unknown>;
    return cfg.upgrade_desbloqueado !== false;
  });

  const matchingAgents: ComposerAutocompleteItem[] = unlockedAgents
    .filter((ag) => {
      if (!q) return true;
      return (
        ag.nome.toLowerCase().includes(q) ||
        ag.agente_id.toLowerCase().includes(q) ||
        (ag.papel ?? "").toLowerCase().includes(q)
      );
    })
    .slice(0, 8)
    .map((agente) => {
      return {
        key: `agent:${agente.agente_id}`,
        kind: "agent",
        agente,
        avatar: resolveAgentAvatarConfig(agente),
      };
    });

  const matchingFiles: ComposerAutocompleteItem[] = arquivos
    .filter((arq) => {
      if (!q) return true;
      return (
        arq.nome_original.toLowerCase().includes(q) ||
        arq.caminho_relativo.toLowerCase().includes(q) ||
        arq.tipo_uso.toLowerCase().includes(q)
      );
    })
    .slice(0, 8)
    .map((arquivo) => ({
      key: `file:${arquivo.arquivo_id}:${arquivo.caminho_relativo}`,
      kind: "file",
      arquivo,
    }));

  return [...matchingAgents, ...matchingFiles];
}

function renderSlashIcon(cmd: SlashCommandOption) {
  switch (cmd.action) {
    case "new_chat":
      return <RotateCcw className="h-3.5 w-3.5 text-[#42A0FF]" />;
    case "side_question":
      return <MessageCircleQuestion className="h-3.5 w-3.5 text-[#42A0FF]" />;
    case "attach_file":
      return <Paperclip className="h-3.5 w-3.5 text-[#31CF76]" />;
    case "open_tables":
      return <Table2 className="h-3.5 w-3.5 text-[#FF9412]" />;
    default:
      return <Sparkles className="h-3.5 w-3.5 text-[#A855F7]" />;
  }
}

function renderFileIcon(arquivo: ArquivoStudio) {
  if (arquivo.mime_type.startsWith("image/")) {
    return <ImageIcon className="h-3.5 w-3.5 text-[#31CF76]" />;
  }
  if (arquivo.mime_type.startsWith("video/") || arquivo.tipo_uso === "video") {
    return <Video className="h-3.5 w-3.5 text-[#A855F7]" />;
  }
  if (arquivo.tipo_uso === "documento") {
    return <FileText className="h-3.5 w-3.5 text-[#42A0FF]" />;
  }
  return <FolderOpen className="h-3.5 w-3.5 text-[#FF9412]" />;
}

export interface ComposerAutocompleteProps {
  trigger: ComposerTriggerMatch | null;
  items: ComposerAutocompleteItem[];
  selectedIndex: number;
  onHoverIndex: (index: number) => void;
  onSelect: (item: ComposerAutocompleteItem) => void;
}

export const ComposerAutocomplete: React.FC<ComposerAutocompleteProps> = ({
  trigger,
  items,
  selectedIndex,
  onHoverIndex,
  onSelect,
}) => {
  if (!trigger || items.length === 0) return null;

  const slashActions = items.filter(
    (it): it is Extract<ComposerAutocompleteItem, { kind: "slash" }> =>
      it.kind === "slash" && it.command.category === "acao"
  );
  const slashTemplates = items.filter(
    (it): it is Extract<ComposerAutocompleteItem, { kind: "slash" }> =>
      it.kind === "slash" && it.command.category === "atalho"
  );
  const mentionAgents = items.filter(
    (it): it is Extract<ComposerAutocompleteItem, { kind: "agent" }> => it.kind === "agent"
  );
  const mentionFiles = items.filter(
    (it): it is Extract<ComposerAutocompleteItem, { kind: "file" }> => it.kind === "file"
  );

  const indexMap = new Map<string, number>();
  items.forEach((item, idx) => indexMap.set(item.key, idx));

  const renderGroup = (
    title: string,
    groupItems: ComposerAutocompleteItem[],
    badgeLabel?: string
  ) => {
    if (groupItems.length === 0) return null;
    return (
      <div className="py-1">
        <div className="px-3 py-1 flex items-center justify-between text-[10.5px] font-semibold uppercase tracking-wider text-[#7A7A85]">
          <span>{title}</span>
          {badgeLabel && <span className="text-[10px] font-normal normal-case">{badgeLabel}</span>}
        </div>
        {groupItems.map((item) => {
          const idx = indexMap.get(item.key) ?? 0;
          const isSelected = idx === selectedIndex;
          return (
            <button
              key={item.key}
              type="button"
              onMouseDown={(e) => {
                // Evita perda de foco no textarea antes do clique registrar
                e.preventDefault();
              }}
              onMouseEnter={() => onHoverIndex(idx)}
              onClick={() => onSelect(item)}
              className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition ${
                isSelected
                  ? "bg-[#2C2C32] text-white"
                  : "text-[#DCDCDC] hover:bg-white/[0.05]"
              }`}
            >
              {item.kind === "slash" && (
                <>
                  <div className="h-7 w-7 rounded-lg bg-white/[0.06] flex items-center justify-center shrink-0">
                    {renderSlashIcon(item.command)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[12px] font-semibold text-white">
                        {item.command.label}
                      </span>
                    </div>
                    <div className="truncate text-[11.5px] text-[#9A9AA6]">
                      {item.command.description}
                    </div>
                  </div>
                </>
              )}

              {item.kind === "agent" && (
                <>
                  <MascoteAvatar
                    avatar={item.avatar}
                    agentKey={item.agente.agente_id}
                    size={26}
                    label={item.agente.nome}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[12.5px] font-semibold text-white">
                        @{item.agente.agente_id}
                      </span>
                      <span className="truncate text-[11.5px] text-[#9A9AA6]">
                        {item.agente.nome}
                      </span>
                    </div>
                    <div className="truncate text-[11px] text-[#7D7D88]">
                      {item.agente.papel}
                    </div>
                  </div>
                </>
              )}

              {item.kind === "file" && (
                <>
                  <div className="h-7 w-7 rounded-lg bg-white/[0.06] flex items-center justify-center shrink-0">
                    {renderFileIcon(item.arquivo)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[12.5px] font-medium text-white">
                        {item.arquivo.nome_original}
                      </span>
                      <span className="shrink-0 rounded bg-white/[0.08] px-1.5 py-0.5 text-[10px] uppercase text-[#B4B4BE]">
                        {item.arquivo.tipo_uso}
                      </span>
                    </div>
                    <div className="truncate text-[11px] text-[#7D7D88]">
                      {item.arquivo.caminho_relativo}
                    </div>
                  </div>
                </>
              )}
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div
      role="listbox"
      aria-label={trigger.kind === "slash" ? "Comandos rápidos" : "Menções de agentes e arquivos"}
      className="mb-2 max-h-[280px] overflow-y-auto rounded-2xl border border-white/[0.1] bg-[#161619] p-1.5 shadow-2xl"
    >
      {trigger.kind === "slash" ? (
        <>
          {renderGroup("Ações rápidas", slashActions, "↑↓ navegar · Enter aplicar")}
          {renderGroup("Atalhos criativos", slashTemplates)}
        </>
      ) : (
        <>
          {renderGroup("Agentes da equipe", mentionAgents, "↑↓ navegar · Enter mencionar")}
          {renderGroup("Arquivos do estúdio", mentionFiles, "auto-anexa ao chat")}
        </>
      )}
    </div>
  );
};
