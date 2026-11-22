import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgenteRegistro,
  AvatarShape,
  CanalEquipe,
  RoutineCalendar,
  RoutineOwnerKind,
  RoutineRunStatus,
} from "@criativo/contracts";
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Loader2,
  PauseCircle,
  Plus,
  XCircle,
} from "lucide-react";
import {
  MascoteAvatar,
  resolveAgentAvatarConfig,
} from "../../components/MascoteAvatar";
import { SlidingTabs } from "../../components/ui/CarbonControls";
import { daemonApi } from "../../services/websocket-client";
import { EditorialCalendarPage } from "../social-studio/EditorialCalendarPage";
import {
  buildCalendarPeriodRange,
  formatRelativeExecutionLabel,
  formatScheduleSummaryPt,
} from "../routines/routine-schedule-format";

interface SchedulePageProps {
  agentes: AgenteRegistro[];
  canais?: CanalEquipe[];
  refreshNonce?: number;
  initialAgenda?: RoutineCalendar | null;
  onOpenRoutine: (ownerKind: RoutineOwnerKind, ownerId: string, rotinaId: string) => void;
  onOpenAgentChat: (agenteId: string, prefillPrompt?: string) => void;
  onCreateFirstRoutine: (defaultAgentId: string) => void;
}

type CalendarView = "day" | "week" | "month";

const WEEK_HEADER_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

function toLocalDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatHourMinute(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "--:--";
  return `${String(parsed.getHours()).padStart(2, "0")}:${String(parsed.getMinutes()).padStart(2, "0")}`;
}

function renderStatusIcon(status: RoutineRunStatus | "scheduled"): React.ReactNode {
  switch (status) {
    case "succeeded":
      return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#31CF76]" />;
    case "running":
      return <Loader2 className="h-3.5 w-3.5 shrink-0 text-[#007CF7] animate-spin" />;
    case "needs-attention":
    case "queued":
      return <PauseCircle className="h-3.5 w-3.5 shrink-0 text-[#FF9412]" />;
    case "failed":
    case "cancelled":
    case "interrupted":
      return <XCircle className="h-3.5 w-3.5 shrink-0 text-[#FD2F3B]" />;
    default:
      return <Clock3 className="h-3.5 w-3.5 shrink-0 text-[#979797]" />;
  }
}

function statusBadgeMeta(status: RoutineRunStatus | "scheduled"): {
  label: string;
  colorClass: string;
} {
  switch (status) {
    case "succeeded":
      return { label: "Concluída", colorClass: "text-[#31CF76] bg-[#31CF76]/15" };
    case "running":
      return { label: "Executando", colorClass: "text-[#42A0FF] bg-[#007CF7]/15" };
    case "needs-attention":
      return { label: "Atenção", colorClass: "text-[#FF9412] bg-[#FF9412]/15" };
    case "queued":
      return { label: "Na fila", colorClass: "text-[#FF9412] bg-[#FF9412]/15" };
    case "failed":
      return { label: "Falha", colorClass: "text-[#FD2F3B] bg-[#FD2F3B]/15" };
    case "cancelled":
    case "interrupted":
      return { label: "Interrompida", colorClass: "text-[#FD2F3B] bg-[#FD2F3B]/15" };
    default:
      return { label: "Agendada", colorClass: "text-[#DCDCDC] bg-white/[0.06]" };
  }
}

function getAgentAvatarProps(ag: AgenteRegistro | undefined, fallbackId: string) {
  return resolveAgentAvatarConfig(ag, fallbackId);
}

export const SchedulePage: React.FC<SchedulePageProps> = ({
  agentes,
  canais = [],
  refreshNonce = 0,
  initialAgenda = null,
  onOpenRoutine,
  onOpenAgentChat,
  onCreateFirstRoutine,
}) => {
  const [viewMode, setViewMode] = useState<CalendarView>("week");
  const [calendarDomain, setCalendarDomain] = useState<"editorial" | "rotinas">("rotinas");
  const [anchorDate, setAnchorDate] = useState<Date>(() => new Date());
  const [agenda, setAgenda] = useState<RoutineCalendar | null>(initialAgenda);
  const [loading, setLoading] = useState<boolean>(initialAgenda === null);
  const [error, setError] = useState<string | null>(null);
  const [localReloadTick, setLocalReloadTick] = useState(0);
  const hasInteractedRef = useRef(false);

  const localTimeZone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";
    } catch {
      return "America/Sao_Paulo";
    }
  }, []);

  const periodRange = useMemo(
    () => buildCalendarPeriodRange(anchorDate, viewMode),
    [anchorDate, viewMode]
  );

  const hasDstTransition = useMemo(() => {
    if (periodRange.days.length <= 1) return false;
    const baseOffset = periodRange.days[0].getTimezoneOffset();
    return periodRange.days.some((d) => d.getTimezoneOffset() !== baseOffset);
  }, [periodRange.days]);

  const loadAgenda = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await daemonApi.getAgenda(
        periodRange.from.toISOString(),
        periodRange.to.toISOString()
      );
      setAgenda(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar a agenda de rotinas.");
    } finally {
      setLoading(false);
    }
  }, [periodRange.from, periodRange.to]);

  useEffect(() => {
    if (
      initialAgenda !== null &&
      !hasInteractedRef.current &&
      refreshNonce === 0 &&
      localReloadTick === 0
    ) {
      return;
    }
    void loadAgenda();
  }, [loadAgenda, initialAgenda, refreshNonce, localReloadTick]);

  const todayKey = toLocalDateKey(new Date());
  const isTodayInRange = useMemo(() => {
    const nowMs = Date.now();
    return nowMs >= periodRange.from.getTime() && nowMs <= periodRange.to.getTime();
  }, [periodRange.from, periodRange.to]);

  const routineById = useMemo(() => {
    const map = new Map<string, RoutineCalendar["rotinas"][number]>();
    for (const r of agenda?.rotinas ?? []) {
      map.set(r.rotina_id, r);
    }
    return map;
  }, [agenda?.rotinas]);

  const agentById = useMemo(() => {
    const map = new Map<string, AgenteRegistro>();
    for (const a of agentes) map.set(a.agente_id, a);
    return map;
  }, [agentes]);

  const canalById = useMemo(() => {
    const map = new Map<string, CanalEquipe>();
    for (const c of canais) map.set(c.canal_id, c);
    return map;
  }, [canais]);

  const executionsByDateKey = useMemo(() => {
    const map = new Map<string, RoutineCalendar["execucoes"]>();
    for (const item of agenda?.execucoes ?? []) {
      const d = new Date(item.at);
      if (Number.isNaN(d.getTime())) continue;
      const key = toLocalDateKey(d);
      const bucket = map.get(key) ?? [];
      bucket.push(item);
      map.set(key, bucket);
    }
    for (const [, bucket] of map) {
      bucket.sort((a, b) => a.at.localeCompare(b.at));
    }
    return map;
  }, [agenda?.execucoes]);

  const upcomingSix = useMemo(() => {
    const nowMs = Date.now();
    return (agenda?.execucoes ?? [])
      .filter((item) => item.status === "scheduled" && new Date(item.at).getTime() >= nowMs - 60_000)
      .sort((a, b) => a.at.localeCompare(b.at))
      .slice(0, 6);
  }, [agenda?.execucoes]);

  const dayExecutionsByHour = useMemo(() => {
    if (viewMode !== "day") return [];
    const targetKey = toLocalDateKey(periodRange.days[0]);
    const list = executionsByDateKey.get(targetKey) ?? [];
    const groups = new Map<string, RoutineCalendar["execucoes"]>();
    for (const item of list) {
      const hour = `${String(new Date(item.at).getHours()).padStart(2, "0")}:00`;
      const bucket = groups.get(hour) ?? [];
      bucket.push(item);
      groups.set(hour, bucket);
    }
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [viewMode, periodRange.days, executionsByDateKey]);

  const shiftPeriod = (direction: -1 | 1) => {
    hasInteractedRef.current = true;
    setAnchorDate((prev) => {
      const next = new Date(prev.getTime());
      if (viewMode === "day") {
        next.setDate(next.getDate() + direction);
      } else if (viewMode === "week") {
        next.setDate(next.getDate() + direction * 7);
      } else {
        next.setMonth(next.getMonth() + direction);
      }
      return next;
    });
  };

  const defaultAgentId = agentes[0]?.agente_id ?? "estrategista";

  const resolveOwnerName = (ownerKind: RoutineOwnerKind, ownerId: string): string => {
    if (ownerKind === "canal") {
      return canalById.get(ownerId)?.nome ?? ownerId;
    }
    return agentById.get(ownerId)?.nome ?? ownerId;
  };

  const renderCompactExecCard = (item: RoutineCalendar["execucoes"][number]) => {
    const routine = routineById.get(item.rotina_id);
    if (!routine) return null;
    const ownerAgent = routine.owner_kind === "agente" ? agentById.get(routine.owner_id) : undefined;
    const vis = getAgentAvatarProps(ownerAgent, routine.owner_id);

    return (
      <button
        key={item.id}
        type="button"
        onClick={() => onOpenRoutine(routine.owner_kind, routine.owner_id, routine.rotina_id)}
        className="w-full rounded-lg bg-[#1A1A1A] hover:bg-[#2A2A2A] border border-white/[0.06] p-2 text-left transition-colors"
      >
        <div className="flex items-center justify-between gap-1">
          <span className="inline-flex items-center gap-1 text-[12px] font-normal text-[#979797] tabular-nums">
            {renderStatusIcon(item.status)}
            {formatHourMinute(item.at)}
          </span>
          <MascoteAvatar avatar={vis} agentKey={routine.owner_id} size={18} />
        </div>
        <p className="mt-1 truncate text-[14px] font-semibold text-[#F0F0F0]">{routine.nome}</p>
      </button>
    );
  };

  return (
    <section
      aria-label={calendarDomain === "editorial" ? "Calendário Editorial de Posts" : "Agenda de Rotinas"}
      className="flex-1 h-full overflow-y-auto bg-[#1A1A1A] text-[#F0F0F0] p-6"
    >
      {/* Alternador limpo de domínios: Editorial (Posts) vs Rotinas (Automações) */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-[#141414] px-4 py-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[#979797]">
            Calendário do Estúdio
          </p>
          <p className="text-xs text-[#6A6A6A]">
            {calendarDomain === "editorial"
              ? "Pautas e publicações Instagram separadas das automações técnicas."
              : "Execuções agendadas e recorrências cron dos seus agentes."}
          </p>
        </div>
        <SlidingTabs
          ariaLabel="Alternar entre Calendário Editorial e Rotinas Técnicas"
          value={calendarDomain}
          onChange={(v) => setCalendarDomain(v)}
          tabs={[
            { id: "editorial", label: "Editorial (Posts)" },
            { id: "rotinas", label: "Rotinas (Automações)" },
          ]}
        />
      </div>

      {calendarDomain === "editorial" ? (
        <EditorialCalendarPage
          agentes={agentes}
          onOpenAgentChat={(agenteId) => onOpenAgentChat(agenteId)}
        />
      ) : (
        <>
      {/* Cabeçalho */}
      <header className="flex flex-col gap-4 pb-6 border-b border-white/[0.06]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold leading-tight text-[#F0F0F0]">
              Agenda de Rotinas
            </h1>
            <p className="mt-1 text-[12px] font-normal text-[#979797]">
              Fuso horário local: {localTimeZone}
              {hasDstTransition
                ? " · Aviso: o período selecionado inclui mudança de horário de verão."
                : ""}
            </p>
          </div>

          <button
            type="button"
            onClick={() => onCreateFirstRoutine(defaultAgentId)}
            className="inline-flex items-center gap-2 rounded-xl bg-[#F0F0F0] hover:bg-white px-4 py-2 text-[14px] font-semibold text-[#141414] transition-colors"
          >
            <Plus className="h-4 w-4" />
            <span>Criar rotina</span>
          </button>
        </div>

        {/* Barra de controles do período */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Período anterior"
              onClick={() => shiftPeriod(-1)}
              className="h-9 w-9 rounded-xl bg-[#212121] hover:bg-[#2A2A2A] border border-white/[0.06] flex items-center justify-center text-[#DCDCDC] transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              disabled={isTodayInRange}
              onClick={() => {
                hasInteractedRef.current = true;
                setAnchorDate(new Date());
              }}
              className="h-9 rounded-xl bg-[#212121] hover:bg-[#2A2A2A] border border-white/[0.06] px-4 text-[14px] font-normal text-[#F0F0F0] transition-colors disabled:opacity-40"
            >
              Voltar para hoje
            </button>
            <button
              type="button"
              aria-label="Próximo período"
              onClick={() => shiftPeriod(1)}
              className="h-9 w-9 rounded-xl bg-[#212121] hover:bg-[#2A2A2A] border border-white/[0.06] flex items-center justify-center text-[#DCDCDC] transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <span className="ml-2 text-[14px] font-semibold text-[#F0F0F0]">
              {periodRange.label}
            </span>
          </div>

          <SlidingTabs<CalendarView>
            ariaLabel="Visualização do calendário"
            value={viewMode}
            onChange={(next) => {
              hasInteractedRef.current = true;
              setViewMode(next);
            }}
            tabs={[
              { id: "day", label: "Dia" },
              { id: "week", label: "Semana" },
              { id: "month", label: "Mês" },
            ]}
          />
        </div>
      </header>

      {/* Corpo principal em 2 colunas */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6 items-start">
        {/* Coluna da Grade */}
        <div className="min-w-0">
          {loading ? (
            <div className="grid grid-cols-7 gap-2" aria-label="Carregando agenda">
              {Array.from({ length: 7 }).map((_, idx) => (
                <div
                  key={idx}
                  className="h-[340px] rounded-xl bg-[#212121] border border-white/[0.06] animate-pulse"
                />
              ))}
            </div>
          ) : error ? (
            <div className="rounded-xl bg-[#212121] border border-[#FD2F3B]/40 p-6 space-y-4">
              <div className="flex items-center gap-2 text-[#FD2F3B]">
                <AlertCircle className="h-5 w-5" />
                <p className="text-[14px] font-semibold">Não foi possível carregar a agenda</p>
              </div>
              <p className="text-[14px] font-normal text-[#DCDCDC]">{error}</p>
              <button
                type="button"
                onClick={() => {
                  hasInteractedRef.current = true;
                  setLocalReloadTick((n) => n + 1);
                }}
                className="rounded-xl bg-[#2A2A2A] hover:bg-[#333336] px-4 py-2 text-[14px] font-semibold text-[#F0F0F0] transition-colors"
              >
                Tentar carregar novamente
              </button>
            </div>
          ) : (agenda?.rotinas.length ?? 0) === 0 ? (
            <div className="relative rounded-2xl border border-white/[0.06] bg-[#1A1A1A] p-8 overflow-hidden min-h-[380px] flex items-center justify-center">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-4 grid grid-cols-7 gap-2 opacity-20"
              >
                {Array.from({ length: 14 }).map((_, i) => (
                  <div key={i} className="rounded-xl bg-[#212121] border border-white/[0.06]" />
                ))}
              </div>
              <div className="relative z-10 max-w-md rounded-2xl bg-[#212121] border border-white/[0.08] p-8 text-center space-y-4 shadow-2xl">
                <CalendarClock className="h-8 w-8 text-[#007CF7] mx-auto" />
                <h2 className="text-[20px] font-semibold text-[#F0F0F0]">
                  Nenhuma rotina agendada ainda
                </h2>
                <p className="text-[14px] font-normal text-[#DCDCDC]">
                  Crie rotinas recorrentes ou webhooks autenticados para seus agentes produzirem relatórios, alertas e entregas automaticamente no calendário.
                </p>
                <button
                  type="button"
                  onClick={() => onCreateFirstRoutine(defaultAgentId)}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#F0F0F0] hover:bg-white px-4 py-2 text-[14px] font-semibold text-[#141414] transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  <span>Criar rotina</span>
                </button>
              </div>
            </div>
          ) : viewMode === "week" ? (
            <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
              {periodRange.days.map((dayDate, colIdx) => {
                const key = toLocalDateKey(dayDate);
                const isToday = key === todayKey;
                const isPast = key < todayKey;
                const items = executionsByDateKey.get(key) ?? [];
                const visible = items.slice(0, 4);
                const extraCount = Math.max(0, items.length - 4);
                return (
                  <div
                    key={key}
                    aria-current={isToday ? "date" : undefined}
                    className={`min-h-[300px] rounded-xl bg-[#212121] p-2 flex flex-col gap-2 border ${
                      isToday ? "border-[#007CF7]" : "border-white/[0.06]"
                    } ${isPast ? "opacity-80" : ""}`}
                  >
                    <div className="flex items-center justify-between px-1 pb-1 border-b border-white/[0.06]">
                      <span className="text-[12px] font-normal text-[#979797]">
                        {WEEK_HEADER_LABELS[colIdx]} {dayDate.getDate()}
                      </span>
                      {isToday && (
                        <span className="rounded-full border border-[#007CF7] px-2 py-0.5 text-[12px] font-semibold text-[#42A0FF]">
                          Hoje
                        </span>
                      )}
                    </div>
                    <div className="space-y-2 flex-1">
                      {visible.map((item) => renderCompactExecCard(item))}
                      {extraCount > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            hasInteractedRef.current = true;
                            setAnchorDate(dayDate);
                            setViewMode("day");
                          }}
                          className="w-full rounded-lg bg-[#2A2A2A] hover:bg-[#333336] py-1 text-[12px] font-semibold text-[#42A0FF]"
                        >
                          +{extraCount} execuções
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : viewMode === "month" ? (
            <div className="space-y-2">
              <div className="grid grid-cols-7 gap-2 px-1">
                {WEEK_HEADER_LABELS.map((wd) => (
                  <div key={wd} className="text-[12px] font-semibold text-[#979797]">
                    {wd}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-2">
                {periodRange.days.map((dayDate) => {
                  const key = toLocalDateKey(dayDate);
                  const isToday = key === todayKey;
                  const isPast = key < todayKey;
                  const sameMonth = dayDate.getMonth() === anchorDate.getMonth();
                  const items = executionsByDateKey.get(key) ?? [];
                  const visible = items.slice(0, 3);
                  const extraCount = Math.max(0, items.length - 3);
                  return (
                    <div
                      key={key}
                      aria-current={isToday ? "date" : undefined}
                      className={`min-h-[120px] rounded-xl bg-[#212121] p-2 flex flex-col gap-1 border ${
                        isToday ? "border-[#007CF7]" : "border-white/[0.06]"
                      } ${!sameMonth ? "opacity-45" : isPast ? "opacity-80" : ""}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[12px] font-normal text-[#979797]">
                          {dayDate.getDate()}
                        </span>
                        {isToday && (
                          <span className="rounded-full border border-[#007CF7] px-1.5 text-[12px] font-semibold text-[#42A0FF]">
                            Hoje
                          </span>
                        )}
                      </div>
                      <div className="space-y-1">
                        {visible.map((item) => renderCompactExecCard(item))}
                        {extraCount > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              hasInteractedRef.current = true;
                              setAnchorDate(dayDate);
                              setViewMode("day");
                            }}
                            className="w-full rounded-md bg-[#2A2A2A] py-0.5 text-[12px] font-semibold text-[#42A0FF]"
                          >
                            +{extraCount} execuções
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {dayExecutionsByHour.length === 0 ? (
                <div className="rounded-xl bg-[#212121] border border-white/[0.06] p-8 text-center">
                  <p className="text-[14px] font-normal text-[#979797]">
                    Nenhuma execução prevista ou registrada para este dia.
                  </p>
                </div>
              ) : (
                dayExecutionsByHour.map(([hourLabel, bucket]) => (
                  <div
                    key={hourLabel}
                    className="rounded-xl bg-[#212121] border border-white/[0.06] p-4 space-y-2"
                  >
                    <h3 className="text-[12px] font-semibold text-[#979797] tabular-nums">
                      {hourLabel}
                    </h3>
                    <div className="space-y-2">
                      {bucket.map((item) => {
                        const routine = routineById.get(item.rotina_id);
                        if (!routine) return null;
                        const badge = statusBadgeMeta(item.status);
                        return (
                          <div
                            key={item.id}
                            className="rounded-xl bg-[#1A1A1A] border border-white/[0.06] p-4 flex flex-wrap items-center justify-between gap-4"
                          >
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex items-center gap-2">
                                {renderStatusIcon(item.status)}
                                <span className="text-[12px] font-normal text-[#979797] tabular-nums">
                                  {formatHourMinute(item.at)}
                                </span>
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ${badge.colorClass}`}
                                >
                                  {badge.label}
                                </span>
                                {item.silenciada && (
                                  <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[12px] font-normal text-[#979797]">
                                    Silenciada
                                  </span>
                                )}
                              </div>
                              <p className="text-[14px] font-semibold text-[#F0F0F0]">
                                {routine.nome}
                              </p>
                              <p className="text-[12px] font-normal text-[#979797]">
                                {formatScheduleSummaryPt(
                                  routine.schedule,
                                  routine.timezone,
                                  routine.trigger_kind
                                )}{" "}
                                · {resolveOwnerName(routine.owner_kind, routine.owner_id)}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  onOpenRoutine(
                                    routine.owner_kind,
                                    routine.owner_id,
                                    routine.rotina_id
                                  )
                                }
                                className="rounded-xl bg-[#2A2A2A] hover:bg-[#333336] px-4 py-2 text-[14px] font-semibold text-[#F0F0F0] transition-colors"
                              >
                                Editar rotina
                              </button>
                              {routine.owner_kind === "agente" && (
                                <button
                                  type="button"
                                  onClick={() => onOpenAgentChat(routine.owner_id)}
                                  className="rounded-xl border border-white/10 hover:bg-[#242424] px-4 py-2 text-[14px] font-normal text-[#42A0FF] transition-colors"
                                >
                                  Abrir agente
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Painel Lateral Direita: Próximas execuções */}
        <aside className="rounded-xl bg-[#212121] border border-white/[0.06] p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[20px] font-semibold text-[#F0F0F0]">Próximas execuções</h2>
          </div>
          {upcomingSix.length === 0 ? (
            <p className="text-[12px] font-normal text-[#979797]">
              Sem novas ocorrências futuras neste período.
            </p>
          ) : (
            <div className="space-y-2">
              {upcomingSix.map((item) => {
                const routine = routineById.get(item.rotina_id);
                if (!routine) return null;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() =>
                      onOpenRoutine(routine.owner_kind, routine.owner_id, routine.rotina_id)
                    }
                    className="w-full rounded-xl bg-[#1A1A1A] hover:bg-[#2A2A2A] border border-white/[0.06] p-3 text-left transition-colors space-y-1"
                  >
                    <p className="text-[12px] font-normal text-[#42A0FF]">
                      {formatRelativeExecutionLabel(item.at)}
                    </p>
                    <p className="text-[14px] font-semibold text-[#F0F0F0] truncate">
                      {routine.nome}
                    </p>
                    <p className="text-[12px] font-normal text-[#979797] truncate">
                      {resolveOwnerName(routine.owner_kind, routine.owner_id)}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </aside>
      </div>
        </>
      )}
    </section>
  );
};
