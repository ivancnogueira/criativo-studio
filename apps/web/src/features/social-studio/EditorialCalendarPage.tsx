import React, { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AgenteRegistro,
  EditorialPostFormato,
  EditorialPostRecord,
  EditorialPostStatus,
} from "@criativo/contracts";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Grid3x3,
  Layers,
  List,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { daemonApi } from "../../services/websocket-client";
import { CarbonSelect } from "../../components/ui/CarbonControls";
import { CarouselStoriesStudioEditor } from "./CarouselStoriesStudioEditor";
import { EditorialPostCreateModal } from "./EditorialPostCreateModal";
import {
  FORMAT_META,
  STATUS_META,
  WEEK_LABELS,
  buildMonthGrid,
  getMondayOfWeek,
  toIsoDate,
  toYearMonth,
} from "./social-calendar-utils";

export interface EditorialCalendarPageProps {
  agentes: AgenteRegistro[];
  onOpenAgentChat?: (agenteId: string, prefillPrompt?: string) => void;
}

type EditorialViewMode = "month" | "week" | "list";

export const EditorialCalendarPage: React.FC<EditorialCalendarPageProps> = ({
  agentes,
  onOpenAgentChat,
}) => {
  const [viewMode, setViewMode] = useState<EditorialViewMode>("month");
  const [anchorDate, setAnchorDate] = useState<Date>(() => new Date());
  const [posts, setPosts] = useState<EditorialPostRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formatoFiltro, setFormatoFiltro] = useState<EditorialPostFormato | "todos">("todos");
  const [statusFiltro, setStatusFiltro] = useState<EditorialPostStatus | "todos">("todos");
  const [busca, setBusca] = useState("");
  const [dragPostId, setDragPostId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editorPost, setEditorPost] = useState<EditorialPostRecord | null>(null);

  // Modal de criação rápida
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitulo, setNewTitulo] = useState("");
  const [newFormato, setNewFormato] = useState<EditorialPostFormato>("carrossel");
  const [newStatus, setNewStatus] = useState<EditorialPostStatus>("ideia");
  const [newPilar, setNewPilar] = useState("");
  const [newData, setNewData] = useState(() => toIsoDate(new Date()));
  const [newAgenteId, setNewAgenteId] = useState(() => agentes[0]?.agente_id ?? "designer_chefe");
  const [newLegenda, setNewLegenda] = useState("");
  const [creating, setCreating] = useState(false);

  const loadPosts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await daemonApi.listEditorialPosts({
        formato: formatoFiltro === "todos" ? undefined : formatoFiltro,
        status: statusFiltro === "todos" ? undefined : statusFiltro,
        busca: busca.trim() || undefined,
      });
      setPosts(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar calendário editorial.");
    } finally {
      setLoading(false);
    }
  }, [formatoFiltro, statusFiltro, busca]);

  useEffect(() => {
    void loadPosts();
  }, [loadPosts]);

  const postsByDate = useMemo(() => {
    const map = new Map<string, EditorialPostRecord[]>();
    for (const p of posts) {
      const key = p.data_agendada ? p.data_agendada.slice(0, 10) : "sem_data";
      const list = map.get(key) ?? [];
      list.push(p);
      map.set(key, list);
    }
    return map;
  }, [posts]);

  const monthDays = useMemo(() => buildMonthGrid(anchorDate), [anchorDate]);
  const weekDays = useMemo(() => {
    const mon = getMondayOfWeek(anchorDate);
    return Array.from({ length: 7 }, (_, i) => new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i));
  }, [anchorDate]);

  const periodTitle = useMemo(() => {
    if (viewMode === "week") {
      const start = weekDays[0];
      const end = weekDays[6];
      return `${start.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} – ${end.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}`;
    }
    return anchorDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  }, [anchorDate, viewMode, weekDays]);

  const shiftPeriod = (dir: -1 | 1) => {
    const d = new Date(anchorDate);
    if (viewMode === "week") {
      d.setDate(d.getDate() + dir * 7);
    } else {
      d.setMonth(d.getMonth() + dir);
    }
    setAnchorDate(d);
  };

  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitulo.trim()) return;
    setCreating(true);
    try {
      const created = await daemonApi.createEditorialPost({
        titulo: newTitulo.trim(),
        formato: newFormato,
        status: newStatus,
        pilar: newPilar.trim() || null,
        data_agendada: newData || null,
        agente_id: newAgenteId || null,
        legenda: newLegenda,
      });
      setPosts((prev) => [created, ...prev]);
      setCreateOpen(false);
      setNewTitulo("");
      setNewPilar("");
      setNewLegenda("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar pauta.");
    } finally {
      setCreating(false);
    }
  };

  const handleReschedule = async (postId: string, nextDate: string) => {
    setBusyId(postId);
    try {
      const updated = await daemonApi.updateEditorialPost(postId, { data_agendada: nextDate || null });
      setPosts((prev) => prev.map((p) => (p.id === postId ? updated : p)));
    } finally {
      setBusyId(null);
    }
  };

  const handleStatusChange = async (postId: string, status: EditorialPostStatus) => {
    setBusyId(postId);
    try {
      const updated = await daemonApi.updateEditorialPost(postId, { status });
      setPosts((prev) => prev.map((p) => (p.id === postId ? updated : p)));
    } finally {
      setBusyId(null);
    }
  };

  const handleProduceWithAgent = async (post: EditorialPostRecord) => {
    setBusyId(post.id);
    try {
      const res = await daemonApi.produceEditorialPost(post.id, {
        agente_id: post.agente_id ?? agentes[0]?.agente_id ?? "designer_chefe",
      });
      setPosts((prev) => prev.map((p) => (p.id === post.id ? res.post : p)));
      if (onOpenAgentChat) {
        onOpenAgentChat(res.agente_id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao enviar para produção.");
    } finally {
      setBusyId(null);
    }
  };

  const handleDeletePost = async (postId: string) => {
    setBusyId(postId);
    try {
      await daemonApi.deleteEditorialPost(postId);
      setPosts((prev) => prev.filter((p) => p.id !== postId));
    } finally {
      setBusyId(null);
    }
  };

  const todayIso = toIsoDate(new Date());
  const activeYearMonth = toYearMonth(anchorDate);

  return (
    <div className="space-y-5">
      {/* Barra de Controles do Calendário Editorial */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-[#141414] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl border border-white/[0.08] bg-[#1A1A1A] p-1">
            <button
              type="button"
              onClick={() => setViewMode("month")}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                viewMode === "month" ? "bg-[#2A2A2A] text-white" : "text-[#979797] hover:text-white"
              }`}
            >
              <Grid3x3 className="h-3.5 w-3.5" />
              <span>Mês</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("week")}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                viewMode === "week" ? "bg-[#2A2A2A] text-white" : "text-[#979797] hover:text-white"
              }`}
            >
              <Calendar className="h-3.5 w-3.5" />
              <span>Semana</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                viewMode === "list" ? "bg-[#2A2A2A] text-white" : "text-[#979797] hover:text-white"
              }`}
            >
              <List className="h-3.5 w-3.5" />
              <span>Lista</span>
            </button>
          </div>

          {viewMode !== "list" && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label="Período anterior"
                onClick={() => shiftPeriod(-1)}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-[#1A1A1A] text-[#DCDCDC] hover:bg-[#242424]"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setAnchorDate(new Date())}
                className="rounded-lg border border-white/10 bg-[#1A1A1A] px-2.5 py-1.5 text-xs font-medium text-[#DCDCDC] hover:bg-[#242424]"
              >
                Hoje
              </button>
              <button
                type="button"
                aria-label="Próximo período"
                onClick={() => shiftPeriod(1)}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-[#1A1A1A] text-[#DCDCDC] hover:bg-[#242424]"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <span className="ml-1 text-sm font-semibold capitalize text-white">{periodTitle}</span>
            </div>
          )}
        </div>

        {/* Filtros + Nova Pauta */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-[#6A6A6A]" />
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar pauta ou pilar..."
              className="w-44 rounded-xl border border-white/10 bg-[#0D0D0D] py-1.5 pl-8 pr-2.5 text-xs text-white placeholder:text-[#6A6A6A] focus:border-[#42A0FF] focus:outline-none"
            />
          </div>

          <div className="w-40">
            <CarbonSelect<EditorialPostFormato | "todos">
              ariaLabel="Filtrar por formato"
              value={formatoFiltro}
              onChange={setFormatoFiltro}
              options={[
                { value: "todos", label: "Todos os formatos" },
                { value: "feed_4_5", label: "Feed 4:5" },
                { value: "carrossel", label: "Carrossel" },
                { value: "reels", label: "Reels" },
                { value: "story", label: "Story" },
              ]}
            />
          </div>

          <div className="w-40">
            <CarbonSelect<EditorialPostStatus | "todos">
              ariaLabel="Filtrar por status"
              value={statusFiltro}
              onChange={setStatusFiltro}
              options={[
                { value: "todos", label: "Todos os status" },
                { value: "ideia", label: "Ideia" },
                { value: "rascunho", label: "Rascunho" },
                { value: "em_producao", label: "Em produção" },
                { value: "aprovacao", label: "Aprovação" },
                { value: "agendado", label: "Agendado" },
                { value: "publicado", label: "Publicado" },
              ]}
            />
          </div>

          <button
            type="button"
            onClick={() => {
              setNewData(toIsoDate(anchorDate));
              setCreateOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#31CF76] px-3.5 py-1.5 text-xs font-semibold text-[#0D0D0D] hover:bg-[#3BE085]"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Nova pauta</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-[#FD2F3B]/30 bg-[#FD2F3B]/10 px-4 py-2.5 text-xs text-[#FF8A90]">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-white/[0.06] bg-[#141414] py-14 text-xs text-[#979797]">
          <Loader2 className="h-4 w-4 animate-spin text-[#42A0FF]" />
          <span>Carregando pautas do calendário editorial...</span>
        </div>
      ) : viewMode === "month" ? (
        <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-[#141414]">
          <div className="grid grid-cols-7 border-b border-white/[0.06] bg-[#0D0D0D]">
            {WEEK_LABELS.map((day) => (
              <div key={day} className="px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-[#979797]">
                {day}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {monthDays.map((day) => {
              const iso = toIsoDate(day);
              const isCurrentMonth = toYearMonth(day) === activeYearMonth;
              const isToday = iso === todayIso;
              const dayPosts = postsByDate.get(iso) ?? [];

              return (
                <div
                  key={iso}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragPostId) {
                      void handleReschedule(dragPostId, iso);
                      setDragPostId(null);
                    }
                  }}
                  className={`min-h-[120px] border-b border-r border-white/[0.05] p-2 transition-colors ${
                    isCurrentMonth ? "bg-[#141414]" : "bg-[#0F0F0F] opacity-60"
                  } hover:bg-[#191919]`}
                >
                  <div className="mb-1.5 flex items-center justify-between">
                    <span
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${
                        isToday ? "bg-[#42A0FF] text-[#0D0D0D]" : "text-[#DCDCDC]"
                      }`}
                    >
                      {day.getDate()}
                    </span>
                    <button
                      type="button"
                      title={`Adicionar pauta em ${iso}`}
                      onClick={() => {
                        setNewData(iso);
                        setCreateOpen(true);
                      }}
                      className="rounded p-0.5 text-[#6A6A6A] hover:bg-[#242424] hover:text-white"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    {dayPosts.map((post) => {
                      const fmt = FORMAT_META[post.formato];
                      const st = STATUS_META[post.status];
                      const FmtIcon = fmt.Icon;
                      return (
                        <div
                          key={post.id}
                          draggable
                          onDragStart={() => setDragPostId(post.id)}
                          className="group rounded-lg border border-white/[0.08] bg-[#1E1E1E] p-1.5 text-left hover:border-white/25"
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9.5px] font-medium ${fmt.colorClass}`}>
                              <FmtIcon className="h-2.5 w-2.5" />
                              {fmt.label}
                            </span>
                            <span className={`rounded px-1.5 py-0.5 text-[9.5px] ${st.badgeClass}`}>
                              {st.label}
                            </span>
                          </div>
                          <p className="mt-1 line-clamp-2 text-[11px] font-medium text-white">
                            {post.titulo}
                          </p>
                          <div className="mt-1.5 flex items-center gap-1 opacity-80 group-hover:opacity-100">
                            <button
                              type="button"
                              onClick={() => setEditorPost(post)}
                              className="flex-1 rounded bg-[#2A2A2A] px-1.5 py-0.5 text-[10px] text-[#DCDCDC] hover:bg-[#333333] hover:text-white"
                            >
                              Editor Visual
                            </button>
                            <button
                              type="button"
                              disabled={busyId === post.id}
                              onClick={() => void handleProduceWithAgent(post)}
                              title="Produzir com Criativo"
                              className="rounded bg-[#31CF76]/20 px-1.5 py-0.5 text-[10px] text-[#31CF76] hover:bg-[#31CF76]/30"
                            >
                              <Sparkles className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : viewMode === "week" ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-7">
          {weekDays.map((day) => {
            const iso = toIsoDate(day);
            const dayPosts = postsByDate.get(iso) ?? [];
            return (
              <div
                key={iso}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragPostId) {
                    void handleReschedule(dragPostId, iso);
                    setDragPostId(null);
                  }
                }}
                className="flex min-h-[260px] flex-col rounded-2xl border border-white/[0.06] bg-[#141414] p-3"
              >
                <div className="mb-3 flex items-center justify-between border-b border-white/[0.06] pb-2">
                  <div>
                    <p className="text-xs font-semibold text-white">
                      {day.toLocaleDateString("pt-BR", { weekday: "short" })}
                    </p>
                    <p className="text-[11px] text-[#979797]">
                      {day.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setNewData(iso);
                      setCreateOpen(true);
                    }}
                    className="rounded-lg p-1 text-[#979797] hover:bg-[#212121] hover:text-white"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="space-y-2">
                  {dayPosts.map((post) => {
                    const fmt = FORMAT_META[post.formato];
                    const st = STATUS_META[post.status];
                    return (
                      <div
                        key={post.id}
                        draggable
                        onDragStart={() => setDragPostId(post.id)}
                        className="rounded-xl border border-white/[0.08] bg-[#1B1B1B] p-2.5 space-y-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-1">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${fmt.colorClass}`}>
                            {fmt.label}
                          </span>
                          <span className={`rounded px-1.5 py-0.5 text-[10px] ${st.badgeClass}`}>
                            {st.label}
                          </span>
                        </div>
                        <p className="text-xs font-semibold text-white">{post.titulo}</p>
                        {post.pilar && (
                          <p className="text-[10.5px] text-[#979797]">Pilar: {post.pilar}</p>
                        )}
                        <div className="flex flex-col gap-1 pt-1">
                          <button
                            type="button"
                            onClick={() => setEditorPost(post)}
                            className="w-full rounded-lg bg-[#242424] py-1 text-[11px] font-medium text-white hover:bg-[#2F2F2F]"
                          >
                            Abrir no Editor Visual
                          </button>
                          <button
                            type="button"
                            disabled={busyId === post.id}
                            onClick={() => void handleProduceWithAgent(post)}
                            className="inline-flex w-full items-center justify-center gap-1 rounded-lg bg-[#31CF76]/15 py-1 text-[11px] font-medium text-[#31CF76] hover:bg-[#31CF76]/25"
                          >
                            <Wand2 className="h-3 w-3" />
                            <span>Produzir com Criativo</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {dayPosts.length === 0 && (
                    <p className="py-6 text-center text-[11px] text-[#6A6A6A]">Sem pautas</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Visão Lista */
        <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-[#141414]">
          {posts.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
              <Layers className="h-8 w-8 text-[#6A6A6A]" />
              <p className="text-sm font-medium text-white">Nenhuma pauta editorial cadastrada</p>
              <p className="max-w-md text-xs text-[#979797]">
                Organize aqui seus posts de Feed 4:5, Carrosséis, Reels e Stories separados das automações técnicas.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {posts.map((post) => {
                const fmt = FORMAT_META[post.formato];
                const FmtIcon = fmt.Icon;
                return (
                  <div
                    key={post.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-[#191919]"
                  >
                    <div className="min-w-[220px] flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${fmt.colorClass}`}>
                          <FmtIcon className="h-3 w-3" />
                          {fmt.label}
                        </span>
                        <span className="text-sm font-semibold text-white">{post.titulo}</span>
                        {post.pilar && (
                          <span className="rounded-md bg-white/[0.06] px-2 py-0.5 text-[10.5px] text-[#979797]">
                            {post.pilar}
                          </span>
                        )}
                      </div>
                      {post.legenda && (
                        <p className="mt-1 line-clamp-1 text-xs text-[#979797]">{post.legenda}</p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="date"
                        aria-label={`Data agendada para ${post.titulo}`}
                        value={post.data_agendada ? post.data_agendada.slice(0, 10) : ""}
                        onChange={(e) => void handleReschedule(post.id, e.target.value)}
                        className="rounded-lg border border-white/10 bg-[#0D0D0D] px-2 py-1 text-xs text-[#DCDCDC]"
                      />
                      <div className="w-36">
                        <CarbonSelect<EditorialPostStatus>
                          ariaLabel={`Status de ${post.titulo}`}
                          value={post.status}
                          onChange={(nextStatus) => void handleStatusChange(post.id, nextStatus)}
                          options={Object.entries(STATUS_META).map(([k, v]) => ({
                            value: k as EditorialPostStatus,
                            label: v.label,
                          }))}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => setEditorPost(post)}
                        className="rounded-lg border border-white/10 bg-[#212121] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#2A2A2A]"
                      >
                        Abrir no Editor Visual
                      </button>
                      <button
                        type="button"
                        disabled={busyId === post.id}
                        onClick={() => void handleProduceWithAgent(post)}
                        className="inline-flex items-center gap-1 rounded-lg bg-[#31CF76]/20 px-2.5 py-1 text-xs font-semibold text-[#31CF76] hover:bg-[#31CF76]/30"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>Produzir com Criativo</span>
                      </button>
                      <button
                        type="button"
                        aria-label="Excluir pauta"
                        disabled={busyId === post.id}
                        onClick={() => void handleDeletePost(post.id)}
                        className="rounded-lg p-1.5 text-[#979797] hover:bg-[#FD2F3B]/15 hover:text-[#FD2F3B]"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <EditorialPostCreateModal
        open={createOpen}
        creating={creating}
        titulo={newTitulo}
        formato={newFormato}
        status={newStatus}
        pilar={newPilar}
        dataAgendada={newData}
        agenteId={newAgenteId}
        legenda={newLegenda}
        agentes={agentes}
        onClose={() => setCreateOpen(false)}
        onChangeTitulo={setNewTitulo}
        onChangeFormato={setNewFormato}
        onChangeStatus={setNewStatus}
        onChangePilar={setNewPilar}
        onChangeData={setNewData}
        onChangeAgenteId={setNewAgenteId}
        onChangeLegenda={setNewLegenda}
        onSubmit={handleCreatePost}
      />

      {/* Editor Visual 4:5 + Stories 9:16 conectado ao Post Editorial */}
      {editorPost && (
        <CarouselStoriesStudioEditor
          key={editorPost.id}
          open={true}
          onClose={() => setEditorPost(null)}
          title={`Editor Visual · ${editorPost.titulo}`}
          initialMode={editorPost.formato === "story" || editorPost.formato === "reels" ? "stories_9_16" : "carousel_4_5"}
          initialSlides={editorPost.slides}
          initialCaption={editorPost.legenda}
          editorialPost={editorPost}
          onSaveEditorial={async (payload) => {
            const updated = await daemonApi.updateEditorialPost(editorPost.id, {
              slides: payload.slides,
              legenda: payload.legenda,
              ...(payload.formato ? { formato: payload.formato } : {}),
            });
            setPosts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
            setEditorPost(updated);
          }}
          onApproveCreative={async (payload) => {
            const updated = await daemonApi.updateEditorialPost(editorPost.id, {
              slides: payload.slides,
              legenda: payload.legenda,
              status: "agendado",
            });
            setPosts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
            setEditorPost(updated);
          }}
        />
      )}
    </div>
  );
};
