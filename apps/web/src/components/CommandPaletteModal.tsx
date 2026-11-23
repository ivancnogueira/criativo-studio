import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  Bot,
  CalendarClock,
  Eye,
  FileText,
  FolderOpen,
  GitBranch,
  Loader2,
  MessageSquare,
  Plug,
  Plus,
  Search,
  Settings,
  Store,
  WalletCards,
  X,
} from "lucide-react";
import { daemonApi } from "../services/websocket-client";
import type { StudioNavSection } from "./WorkspaceRail";

export interface GlobalSearchResultItem {
  id: string;
  titulo: string;
  subtitulo: string;
  categoria: string;
  section: StudioNavSection;
  agente_id?: string | null;
}

export interface CommandPaletteModalProps {
  open: boolean;
  onClose: () => void;
  onSelectSection: (section: StudioNavSection) => void;
  onSelectAgent: (agenteId: string) => void;
  onCreateNewAgent?: () => void;
  onOpenSettings: () => void;
  onToggleFocusMode?: () => void;
}

interface QuickAction {
  id: string;
  label: string;
  subtitle: string;
  Icon: React.FC<{ className?: string }>;
  run: () => void;
}

export const CommandPaletteModal: React.FC<CommandPaletteModalProps> = ({
  open,
  onClose,
  onSelectSection,
  onSelectAgent,
  onCreateNewAgent,
  onOpenSettings,
  onToggleFocusMode,
}) => {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [remoteItems, setRemoteItems] = useState<GlobalSearchResultItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  const quickActions = useMemo<QuickAction[]>(() => {
    const base: QuickAction[] = [
      { id: "act-agentes", label: "Ir para Estúdio (Criativos)", subtitle: "Navegação rápida", Icon: Bot, run: () => onSelectSection("agentes") },
      { id: "act-fluxos", label: "Ir para Automações (Workflows)", subtitle: "Editor em grafo", Icon: GitBranch, run: () => onSelectSection("fluxos") },
      { id: "act-tarefas", label: "Ir para Fila de Tarefas", subtitle: "Status e aprovações", Icon: WalletCards, run: () => onSelectSection("tarefas") },
      { id: "act-agenda", label: "Ir para Calendário Editorial & Rotinas", subtitle: "Pautas e agendamentos", Icon: CalendarClock, run: () => onSelectSection("agenda") },
      { id: "act-galeria", label: "Ir para Galeria & Métricas Instagram", subtitle: "Alcance, salvamentos e KPIs", Icon: BarChart3, run: () => onSelectSection("galeria_ig") },
      { id: "act-uso", label: "Ir para Consumo & Cotas", subtitle: "Tokens e custo USD", Icon: Activity, run: () => onSelectSection("uso") },
      { id: "act-arquivos", label: "Ir para Biblioteca de Arquivos", subtitle: "Fotos, logos e saídas", Icon: FolderOpen, run: () => onSelectSection("arquivos") },
      { id: "act-loja", label: "Ir para Catálogo / Loja", subtitle: "Apps, skills e upgrade", Icon: Store, run: () => onSelectSection("loja") },
      { id: "act-conexoes", label: "Ir para Integrações & Provedores", subtitle: "OAuth, WhatsApp e API Keys", Icon: Plug, run: () => onSelectSection("conexoes") },
      { id: "act-settings", label: "Abrir Configurações & Diagnóstico", subtitle: "Logs redigidos e preferências", Icon: Settings, run: onOpenSettings },
    ];
    if (onCreateNewAgent) {
      base.splice(1, 0, {
        id: "act-new-agent",
        label: "Criar Novo Criativo Especialista",
        subtitle: "Ação rápida do estúdio",
        Icon: Plus,
        run: onCreateNewAgent,
      });
    }
    if (onToggleFocusMode) {
      base.push({
        id: "act-focus",
        label: "Alternar Modo Foco",
        subtitle: "Recolher painéis laterais",
        Icon: Eye,
        run: onToggleFocusMode,
      });
    }
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (a) => a.label.toLowerCase().includes(q) || a.subtitle.toLowerCase().includes(q)
    );
  }, [query, onSelectSection, onOpenSettings, onCreateNewAgent, onToggleFocusMode]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
  }, [open, query]);

  useEffect(() => {
    if (!open) return;
    const clean = query.trim();
    if (!clean) {
      setRemoteItems([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      daemonApi
        .searchGlobalStudio(clean, 5)
        .then((res) => {
          if (cancelled) return;
          const flat: GlobalSearchResultItem[] = [];
          for (const a of res.grupos.agentes) {
            flat.push({ ...a, categoria: "Criativos", agente_id: a.id });
          }
          for (const e of res.grupos.equipes) {
            flat.push({ ...e, categoria: "Equipes" });
          }
          for (const th of res.grupos.threads) {
            flat.push({ ...th, categoria: "Threads" });
          }
          for (const m of res.grupos.mensagens) {
            flat.push({ ...m, categoria: "Mensagens" });
          }
          for (const w of res.grupos.workflows) {
            flat.push({ ...w, categoria: "Workflows" });
          }
          for (const r of res.grupos.rotinas) {
            flat.push({ ...r, categoria: "Rotinas" });
          }
          for (const f of res.grupos.arquivos) {
            flat.push({ ...f, categoria: "Arquivos" });
          }
          setRemoteItems(flat);
        })
        .catch(() => {
          if (!cancelled) setRemoteItems([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 120);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query]);

  const combinedRows = useMemo(() => {
    const items: Array<{ key: string; title: string; subtitle: string; badge: string; execute: () => void }> = [];
    for (const r of remoteItems) {
      items.push({
        key: `rem-${r.categoria}-${r.id}`,
        title: r.titulo,
        subtitle: r.subtitulo,
        badge: r.categoria,
        execute: () => {
          if (r.agente_id) {
            onSelectSection("agentes");
            onSelectAgent(r.agente_id);
          } else {
            onSelectSection(r.section);
          }
          onClose();
        },
      });
    }
    for (const a of quickActions) {
      items.push({
        key: a.id,
        title: a.label,
        subtitle: a.subtitle,
        badge: "Ação rápida",
        execute: () => {
          a.run();
          onClose();
        },
      });
    }
    return items;
  }, [remoteItems, quickActions, onSelectSection, onSelectAgent, onClose]);

  if (!open) return null;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => (combinedRows.length > 0 ? (prev + 1) % combinedRows.length : 0));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) =>
        combinedRows.length > 0 ? (prev - 1 + combinedRows.length) % combinedRows.length : 0
      );
      return;
    }
    if (e.key === "Enter" && combinedRows[activeIndex]) {
      e.preventDefault();
      combinedRows[activeIndex].execute();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Paleta de Comandos e Busca Global"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/75 px-4 pt-[12vh] backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-white/10 bg-[#141414] text-[#F0F0F0] shadow-2xl"
      >
        <div className="flex items-center gap-2.5 border-b border-white/[0.06] bg-[#0D0D0D] px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-[#42A0FF]" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Buscar Criativos, conversas, workflows, rotinas, arquivos ou ações..."
            className="flex-1 bg-transparent text-sm text-white placeholder:text-[#6A6A6A] focus:outline-none"
          />
          {loading && <Loader2 className="h-4 w-4 animate-spin text-[#42A0FF]" />}
          <kbd className="rounded bg-[#212121] px-1.5 py-0.5 font-mono text-[10px] text-[#979797]">
            ESC
          </kbd>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar busca"
            className="rounded-lg p-1 text-[#979797] hover:bg-[#212121] hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[55vh] overflow-y-auto p-2 space-y-1">
          {combinedRows.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 py-10 text-center text-xs text-[#979797]">
              <FileText className="h-5 w-5 text-[#6A6A6A]" />
              <span>Nenhum resultado encontrado para &ldquo;{query}&rdquo;.</span>
            </div>
          ) : (
            combinedRows.map((row, idx) => {
              const selected = idx === activeIndex;
              return (
                <button
                  key={row.key}
                  type="button"
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={row.execute}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition-colors ${
                    selected ? "bg-[#242429] text-white" : "text-[#DCDCDC] hover:bg-[#1B1B1E]"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-white">{row.title}</p>
                    <p className="truncate text-[11px] text-[#979797]">{row.subtitle}</p>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-white/[0.08] bg-[#1A1A1A] px-2 py-0.5 text-[10px] text-[#979797]">
                    <MessageSquare className="h-2.5 w-2.5 text-[#31CF76]" />
                    {row.badge}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
