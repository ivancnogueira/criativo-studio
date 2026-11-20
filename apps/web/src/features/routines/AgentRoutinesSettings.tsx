import React, { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AgentRoutine,
  CanalEquipe,
  EventFilter,
  RoutineDestinationOption,
  RoutineLimitPolicy,
  RoutineMissedPolicy,
  RoutineOwnerKind,
  RoutineResultDelivery,
  RoutineResultDestination,
  RoutineRun,
  RoutineRunPlace,
  RoutineSchedule,
} from "@criativo/contracts";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  CircleCheck,
  Clock3,
  MessageSquare,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Webhook,
} from "lucide-react";
import { CarbonSelect, SlidingTabs } from "../../components/ui/CarbonControls";
import { daemonApi } from "../../services/websocket-client";
import {
  COMMON_IANA_TIMEZONES,
  formatRelativeExecutionLabel,
  formatScheduleSummaryPt,
  validateRoutineFormDraft,
} from "./routine-schedule-format";
import { WebhookRoutineEditor } from "./WebhookRoutineEditor";

interface AgentRoutinesSettingsProps {
  ownerKind: RoutineOwnerKind;
  ownerId: string;
  ownerName: string;
  canais?: CanalEquipe[];
  initialRoutines?: AgentRoutine[];
  initialSelectedRoutineId?: string | null;
  onBackToHub?: () => void;
  onOpenThreadOrChat?: (canalId: string) => void;
  onRoutinesChanged?: () => void;
}

type ScheduleKind = RoutineSchedule["kind"];

const SCHEDULE_KIND_OPTIONS: Array<{ value: ScheduleKind; label: string; description: string }> = [
  { value: "hourly", label: "A cada hora", description: "Repete todo dia no minuto escolhido" },
  { value: "daily", label: "Diária", description: "Todos os dias no mesmo horário" },
  { value: "weekdays", label: "Dias úteis", description: "Segunda a sexta no horário definido" },
  { value: "weekly", label: "Semanal", description: "Um dia da semana fixo" },
  { value: "monthly", label: "Mensal", description: "Um dia do mês específico" },
  { value: "interval", label: "Intervalo", description: "A cada N minutos, horas ou dias" },
  { value: "advanced", label: "Avançado", description: "Dias múltiplos combinados com horário ou ciclo" },
  { value: "custom", label: "Cron personalizado", description: "Expressão cron de 5 campos" },
  { value: "once", label: "Única vez (once)", description: "Dispara uma única vez e pausa" },
];

const WEEKDAY_CHIPS = [
  { id: 1, label: "Seg" },
  { id: 2, label: "Ter" },
  { id: 3, label: "Qua" },
  { id: 4, label: "Qui" },
  { id: 5, label: "Sex" },
  { id: 6, label: "Sáb" },
  { id: 0, label: "Dom" },
];

interface RoutineDraft {
  rotina_id: string | null;
  nome: string;
  instrucao: string;
  ativa: boolean;
  timezone: string;
  triggerKind: "schedule" | "webhook";
  schedule: RoutineSchedule;
  limitPolicy: RoutineLimitPolicy;
  missedPolicy: RoutineMissedPolicy;
  runIn: RoutineRunPlace;
  destinoResultado: RoutineResultDestination;
  webhookEventType: string;
  webhookFilters: EventFilter[];
}

function defaultTomorrowDate(): string {
  const tomorrow = new Date(Date.now() + 24 * 3_600_000);
  const y = tomorrow.getFullYear();
  const m = String(tomorrow.getMonth() + 1).padStart(2, "0");
  const d = String(tomorrow.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function buildDefaultScheduleForKind(kind: ScheduleKind): RoutineSchedule {
  switch (kind) {
    case "hourly":
      return { kind: "hourly", minute: 0 };
    case "daily":
      return { kind: "daily", time: "09:00" };
    case "weekdays":
      return { kind: "weekdays", time: "09:00" };
    case "weekly":
      return { kind: "weekly", weekday: 1, time: "09:00" };
    case "monthly":
      return { kind: "monthly", day: 1, time: "09:00" };
    case "interval":
      return { kind: "interval", amount: 30, unit: "minutes", anchorAt: new Date().toISOString() };
    case "advanced":
      return {
        kind: "advanced",
        months: [],
        days: { kind: "days-of-week", days: [1, 3, 5] },
        time: { kind: "at-time", time: "09:00" },
      };
    case "custom":
      return { kind: "custom", expression: "*/15 * * * *" };
    case "once":
      return { kind: "once", date: defaultTomorrowDate(), time: "09:00" };
  }
}

function createEmptyDraft(): RoutineDraft {
  return {
    rotina_id: null,
    nome: "",
    instrucao: "",
    ativa: true,
    timezone: COMMON_IANA_TIMEZONES[0] ?? "America/Sao_Paulo",
    triggerKind: "schedule",
    schedule: { kind: "weekdays", time: "09:00" },
    limitPolicy: "wait",
    missedPolicy: "skip",
    runIn: "chat",
    destinoResultado: { tipo: "none" },
    webhookEventType: "",
    webhookFilters: [],
  };
}

function draftFromRoutine(r: AgentRoutine): RoutineDraft {
  return {
    rotina_id: r.rotina_id,
    nome: r.nome,
    instrucao: r.instrucao,
    ativa: r.ativa,
    timezone: r.timezone,
    triggerKind: r.trigger_kind,
    schedule: r.schedule ?? { kind: "weekdays", time: "09:00" },
    limitPolicy: r.limit_policy,
    missedPolicy: r.missed_policy,
    runIn: r.run_in,
    destinoResultado: r.destino_resultado ?? { tipo: "none" },
    webhookEventType: r.webhook?.event_type ?? "",
    webhookFilters: r.webhook?.filters ?? [],
  };
}

function destinationKey(dest: RoutineResultDestination | null | undefined): string {
  if (!dest || dest.tipo === "none") return "none";
  if (dest.tipo === "notificacao") return "notificacao";
  if (dest.tipo === "canal") return `canal:${dest.canal_id}`;
  if (dest.tipo === "telegram") return `telegram:${dest.chat_id}`;
  return `whatsapp:${dest.destino_id}`;
}

function destinationDisplayLabel(
  dest: RoutineResultDestination,
  options: RoutineDestinationOption[]
): string {
  if (dest.tipo === "none") return "Apenas no histórico/chat";
  if (dest.tipo === "notificacao") return dest.destino_nome || "Notificação no Cockpit";
  if (dest.tipo === "canal") {
    const opt = options.find((o) => o.tipo === "canal" && o.id === dest.canal_id);
    return opt?.nome ?? dest.destino_nome ?? dest.canal_id;
  }
  if (dest.tipo === "telegram") {
    const opt = options.find((o) => o.tipo === "telegram" && o.id === dest.chat_id);
    return opt?.nome ?? dest.destino_nome ?? dest.chat_id;
  }
  const opt = options.find((o) => o.tipo === "whatsapp" && o.id === dest.destino_id);
  return opt?.nome ?? dest.destino_nome ?? dest.destino_id;
}

function isPastOnceRoutine(r: AgentRoutine): boolean {
  if (r.trigger_kind !== "schedule" || r.schedule?.kind !== "once") return false;
  if (r.ativa) return false;
  const candidate = new Date(`${r.schedule.date}T${r.schedule.time}:00`);
  return !Number.isNaN(candidate.getTime()) && candidate.getTime() <= Date.now();
}

export const AgentRoutinesSettings: React.FC<AgentRoutinesSettingsProps> = ({
  ownerKind,
  ownerId,
  ownerName,
  canais = [],
  initialRoutines,
  initialSelectedRoutineId = null,
  onBackToHub,
  onOpenThreadOrChat,
  onRoutinesChanged,
}) => {
  const [routines, setRoutines] = useState<AgentRoutine[]>(initialRoutines ?? []);
  const [loadingList, setLoadingList] = useState(initialRoutines === undefined);
  const [mode, setMode] = useState<"list" | "edit">(
    initialSelectedRoutineId ? "edit" : "list"
  );
  const [draft, setDraft] = useState<RoutineDraft>(() => {
    if (initialSelectedRoutineId && initialRoutines) {
      const match = initialRoutines.find((r) => r.rotina_id === initialSelectedRoutineId);
      if (match) return draftFromRoutine(match);
    }
    return createEmptyDraft();
  });
  const [baselineSnapshot, setBaselineSnapshot] = useState<string>(() =>
    JSON.stringify(
      initialSelectedRoutineId && initialRoutines
        ? draftFromRoutine(
            initialRoutines.find((r) => r.rotina_id === initialSelectedRoutineId) ??
              ({} as AgentRoutine)
          )
        : createEmptyDraft()
    )
  );
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testingNow, setTestingNow] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [unsavedConfirmOpen, setUnsavedConfirmOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [runs, setRuns] = useState<RoutineRun[]>([]);
  const [deliveries, setDeliveries] = useState<RoutineResultDelivery[]>([]);
  const [destOptions, setDestOptions] = useState<RoutineDestinationOption[]>([]);
  const [destMenuOpen, setDestMenuOpen] = useState(false);

  const selectedRoutine = useMemo(
    () => routines.find((r) => r.rotina_id === draft.rotina_id) ?? null,
    [routines, draft.rotina_id]
  );

  const isDirty = useMemo(() => {
    if (!draft.rotina_id) return Boolean(draft.nome.trim() || draft.instrucao.trim());
    return JSON.stringify(draft) !== baselineSnapshot;
  }, [draft, baselineSnapshot]);

  const reloadRoutines = useCallback(async () => {
    setLoadingList(true);
    try {
      const list = await daemonApi.listOwnerRoutines(ownerKind, ownerId);
      setRoutines(list);
      if (initialSelectedRoutineId && initialSelectedRoutineId !== "__new__") {
        const found = list.find((r) => r.rotina_id === initialSelectedRoutineId);
        if (found) {
          const next = draftFromRoutine(found);
          setDraft(next);
          setBaselineSnapshot(JSON.stringify(next));
          setMode("edit");
        }
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Erro ao carregar rotinas.");
    } finally {
      setLoadingList(false);
    }
  }, [ownerKind, ownerId, initialSelectedRoutineId]);

  useEffect(() => {
    if (initialRoutines === undefined) {
      void reloadRoutines();
    }
  }, [ownerKind, ownerId, initialRoutines, reloadRoutines]);

  useEffect(() => {
    if (!initialSelectedRoutineId) return;
    if (initialSelectedRoutineId === "__new__") {
      const blank = createEmptyDraft();
      setDraft(blank);
      setBaselineSnapshot(JSON.stringify(blank));
      setMode("edit");
      return;
    }
    const found = routines.find((r) => r.rotina_id === initialSelectedRoutineId);
    if (found) {
      const next = draftFromRoutine(found);
      setDraft(next);
      setBaselineSnapshot(JSON.stringify(next));
      setMode("edit");
    }
  }, [initialSelectedRoutineId, routines]);

  useEffect(() => {
    void daemonApi
      .listRoutineDestinationOptions()
      .then((opts) => setDestOptions(opts))
      .catch(() => {
        setDestOptions(
          canais.map((c) => ({
            tipo: "canal",
            id: c.canal_id,
            nome: c.nome,
            disponivel: true,
          }))
        );
      });
  }, [canais]);

  const loadRoutineHistory = useCallback(async (rotinaId: string) => {
    try {
      const [runList, deliveryList] = await Promise.all([
        daemonApi.listRoutineRuns(rotinaId, { limit: 10 }),
        daemonApi.listRoutineDeliveries(rotinaId),
      ]);
      setRuns(runList);
      setDeliveries(deliveryList);
    } catch {
      // Silencioso em preview offline
    }
  }, []);

  useEffect(() => {
    if (mode === "edit" && draft.rotina_id) {
      void loadRoutineHistory(draft.rotina_id);
    } else {
      setRuns([]);
      setDeliveries([]);
    }
  }, [mode, draft.rotina_id, loadRoutineHistory]);

  const openEditorForRoutine = (r: AgentRoutine) => {
    const next = draftFromRoutine(r);
    setDraft(next);
    setBaselineSnapshot(JSON.stringify(next));
    setRevealedSecret(null);
    setErrorMsg(null);
    setStatusBanner(null);
    setConfirmDeleteOpen(false);
    setUnsavedConfirmOpen(false);
    setMode("edit");
  };

  const openNewRoutineEditor = () => {
    const blank = createEmptyDraft();
    setDraft(blank);
    setBaselineSnapshot(JSON.stringify(blank));
    setRevealedSecret(null);
    setErrorMsg(null);
    setStatusBanner(null);
    setConfirmDeleteOpen(false);
    setUnsavedConfirmOpen(false);
    setMode("edit");
  };

  const handleSave = async (): Promise<AgentRoutine | null> => {
    setErrorMsg(null);
    setStatusBanner(null);
    const validationErr = validateRoutineFormDraft({
      nome: draft.nome,
      instrucao: draft.instrucao,
      triggerKind: draft.triggerKind,
      schedule: draft.schedule,
      timezone: draft.timezone,
      filters: draft.webhookFilters,
    });
    if (validationErr) {
      setErrorMsg(validationErr);
      return null;
    }

    setSaving(true);
    try {
      const res = await daemonApi.saveRoutine(
        draft.rotina_id
          ? {
              rotina_id: draft.rotina_id,
              nome: draft.nome.trim(),
              instrucao: draft.instrucao.trim(),
              ativa: draft.ativa,
              timezone: draft.timezone,
              trigger_kind: draft.triggerKind,
              schedule: draft.triggerKind === "schedule" ? draft.schedule : null,
              limit_policy:
                draft.schedule.kind === "once" ? "wait" : draft.limitPolicy,
              missed_policy: draft.missedPolicy,
              run_in: draft.runIn,
              destino_resultado: draft.destinoResultado,
              webhook_event_type:
                draft.triggerKind === "webhook"
                  ? draft.webhookEventType.trim() || null
                  : undefined,
              webhook_filters:
                draft.triggerKind === "webhook" ? draft.webhookFilters : undefined,
            }
          : {
              owner_kind: ownerKind,
              owner_id: ownerId,
              nome: draft.nome.trim(),
              instrucao: draft.instrucao.trim(),
              ativa: draft.ativa,
              timezone: draft.timezone,
              trigger_kind: draft.triggerKind,
              schedule: draft.triggerKind === "schedule" ? draft.schedule : null,
              limit_policy:
                draft.schedule.kind === "once" ? "wait" : draft.limitPolicy,
              missed_policy: draft.missedPolicy,
              run_in: draft.runIn,
              destino_resultado: draft.destinoResultado,
              webhook_event_type:
                draft.triggerKind === "webhook"
                  ? draft.webhookEventType.trim() || null
                  : undefined,
              webhook_filters:
                draft.triggerKind === "webhook" ? draft.webhookFilters : undefined,
            }
      );

      if (res.secret) {
        setRevealedSecret(res.secret);
      }

      const savedDraft = draftFromRoutine(res.rotina);
      setDraft(savedDraft);
      setBaselineSnapshot(JSON.stringify(savedDraft));
      setStatusBanner("Rotina salva com sucesso.");
      await reloadRoutines();
      onRoutinesChanged?.();
      return res.rotina;
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Erro ao salvar rotina.");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActiveInList = async (r: AgentRoutine) => {
    if (isPastOnceRoutine(r)) {
      openEditorForRoutine(r);
      setErrorMsg("Informe uma data e horário futuros para reativar uma rotina única.");
      return;
    }
    try {
      await daemonApi.saveRoutine({ rotina_id: r.rotina_id, ativa: !r.ativa });
      await reloadRoutines();
      onRoutinesChanged?.();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Erro ao alterar status da rotina.");
    }
  };

  const handleBackFromEditor = () => {
    if (isDirty) {
      setUnsavedConfirmOpen(true);
      return;
    }
    setMode("list");
  };

  const deliveryByExecId = useMemo(() => {
    const map = new Map<string, RoutineResultDelivery>();
    for (const d of deliveries) {
      map.set(d.execucao_id, d);
    }
    return map;
  }, [deliveries]);

  const groupedDestinationSections = useMemo(() => {
    const channelOpts = destOptions.filter((o) => o.tipo === "canal");
    const waOpts = destOptions.filter((o) => o.tipo === "whatsapp");
    const tgOpts = destOptions.filter((o) => o.tipo === "telegram");
    const notifOpts = destOptions.filter((o) => o.tipo === "notificacao");
    return { channelOpts, waOpts, tgOpts, notifOpts };
  }, [destOptions]);

  if (mode === "list") {
    return (
      <div className="w-full min-w-0 space-y-4 text-[#F0F0F0]">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            {onBackToHub && (
              <button
                type="button"
                onClick={onBackToHub}
                className="inline-flex items-center gap-1 text-[12px] text-[#979797] hover:text-white mb-1"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Voltar ao painel</span>
              </button>
            )}
            <h2 className="text-[20px] font-semibold text-[#F0F0F0] truncate">
              Rotinas do agente
            </h2>
            <p className="text-[12px] font-normal text-[#979797] truncate">{ownerName}</p>
          </div>

          <button
            type="button"
            onClick={openNewRoutineEditor}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#F0F0F0] hover:bg-white px-3 py-2 text-[14px] font-semibold text-[#141414] shrink-0"
          >
            <Plus className="h-4 w-4" />
            <span>Criar rotina</span>
          </button>
        </div>

        {errorMsg && (
          <div className="rounded-xl bg-[#FD2F3B]/10 border border-[#FD2F3B]/40 p-3 text-[12px] text-[#FD2F3B]">
            {errorMsg}
          </div>
        )}

        {loadingList ? (
          <div className="space-y-2">
            <div className="h-20 rounded-xl bg-[#212121] animate-pulse" />
            <div className="h-20 rounded-xl bg-[#212121] animate-pulse" />
          </div>
        ) : routines.length === 0 ? (
          <div className="rounded-xl bg-[#212121] border border-white/[0.06] p-6 text-center space-y-3">
            <Clock3 className="h-6 w-6 text-[#979797] mx-auto" />
            <p className="text-[14px] font-normal text-[#DCDCDC]">
              Este proprietário ainda não possui rotinas configuradas.
            </p>
            <button
              type="button"
              onClick={openNewRoutineEditor}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#F0F0F0] hover:bg-white px-4 py-2 text-[14px] font-semibold text-[#141414]"
            >
              <Plus className="h-4 w-4" />
              <span>Criar rotina</span>
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {routines.map((r) => {
              const completedOnce = isPastOnceRoutine(r);
              return (
                <div
                  key={r.rotina_id}
                  className="rounded-xl bg-[#212121] border border-white/[0.06] p-4 flex items-center justify-between gap-3"
                >
                  <button
                    type="button"
                    onClick={() => openEditorForRoutine(r)}
                    className="min-w-0 flex-1 text-left space-y-1"
                  >
                    <div className="flex items-center gap-2">
                      {completedOnce ? (
                        <CircleCheck className="h-4 w-4 shrink-0 text-[#31CF76]" />
                      ) : r.trigger_kind === "webhook" ? (
                        <Webhook className="h-4 w-4 shrink-0 text-[#42A0FF]" />
                      ) : (
                        <Clock3 className="h-4 w-4 shrink-0 text-[#979797]" />
                      )}
                      <span className="text-[14px] font-semibold text-[#F0F0F0] truncate">
                        {r.nome}
                      </span>
                    </div>
                    <p className="text-[12px] font-normal text-[#979797] truncate">
                      {formatScheduleSummaryPt(r.schedule, r.timezone, r.trigger_kind)}
                    </p>
                  </button>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={r.ativa}
                    aria-label={r.ativa ? `Pausar ${r.nome}` : `Ativar ${r.nome}`}
                    title={
                      completedOnce
                        ? "Edite a data para o futuro antes de reativar esta rotina única"
                        : undefined
                    }
                    onClick={() => void handleToggleActiveInList(r)}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                      r.ativa ? "bg-[#31CF76]" : "bg-[#2A2A2A]"
                    }`}
                  >
                    <span
                      className={`block h-4 w-4 rounded-full bg-white transition-transform ${
                        r.ativa ? "translate-x-6" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 space-y-4 text-[#F0F0F0]">
      {/* Cabeçalho do Editor */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={handleBackFromEditor}
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#DCDCDC] hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Voltar à lista</span>
        </button>

        {draft.rotina_id && (
          <button
            type="button"
            onClick={() => setConfirmDeleteOpen((v) => !v)}
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#FD2F3B] hover:underline"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Excluir rotina</span>
          </button>
        )}
      </div>

      {unsavedConfirmOpen && (
        <div className="rounded-xl bg-[#212121] border border-[#FF9412]/50 p-4 space-y-3">
          <div className="flex items-center gap-2 text-[#FF9412]">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-[14px] font-semibold">Há alterações não salvas</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setUnsavedConfirmOpen(false);
                setMode("list");
              }}
              className="rounded-xl bg-[#FD2F3B] px-3 py-1.5 text-[12px] font-semibold text-white"
            >
              Descartar alterações
            </button>
            <button
              type="button"
              onClick={() => setUnsavedConfirmOpen(false)}
              className="rounded-xl bg-[#2A2A2A] px-3 py-1.5 text-[12px] font-semibold text-[#F0F0F0]"
            >
              Continuar editando
            </button>
          </div>
        </div>
      )}

      {confirmDeleteOpen && draft.rotina_id && (
        <div className="rounded-xl bg-[#212121] border border-[#FD2F3B]/50 p-4 space-y-3">
          <p className="text-[14px] font-normal text-[#DCDCDC]">
            Excluir esta rotina removerá também sua agenda e webhook dedicado.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={async () => {
                if (!draft.rotina_id) return;
                await daemonApi.deleteRoutine(draft.rotina_id);
                setConfirmDeleteOpen(false);
                await reloadRoutines();
                onRoutinesChanged?.();
                setMode("list");
              }}
              className="rounded-xl bg-[#FD2F3B] px-3 py-1.5 text-[12px] font-semibold text-white"
            >
              Confirmar exclusão
            </button>
            <button
              type="button"
              onClick={() => setConfirmDeleteOpen(false)}
              className="rounded-xl bg-[#2A2A2A] px-3 py-1.5 text-[12px] font-semibold text-[#F0F0F0]"
            >
              Manter rotina
            </button>
          </div>
        </div>
      )}

      {/* Barra de Ações */}
      <div className="rounded-xl bg-[#212121] border border-white/[0.06] p-4 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={draft.ativa}
          onClick={() => setDraft((d) => ({ ...d, ativa: !d.ativa }))}
          className="inline-flex items-center gap-2 text-[14px] font-semibold text-[#F0F0F0]"
        >
          <span
            className={`inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              draft.ativa ? "bg-[#31CF76]" : "bg-[#2A2A2A]"
            }`}
          >
            <span
              className={`h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                draft.ativa ? "translate-x-4" : "translate-x-1"
              }`}
            />
          </span>
          <span>{draft.ativa ? "Rotina ativa" : "Rotina pausada"}</span>
        </button>

        <div className="flex items-center gap-2">
          {draft.rotina_id && !isDirty && (
            <button
              type="button"
              disabled={testingNow}
              onClick={async () => {
                if (!draft.rotina_id) return;
                setTestingNow(true);
                setErrorMsg(null);
                try {
                  await daemonApi.testRoutine(draft.rotina_id);
                  setStatusBanner("Execução de teste colocada na fila.");
                  await loadRoutineHistory(draft.rotina_id);
                } catch (err) {
                  setErrorMsg(err instanceof Error ? err.message : "Erro ao testar rotina.");
                } finally {
                  setTestingNow(false);
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#2A2A2A] hover:bg-[#333336] px-3 py-1.5 text-[14px] font-semibold text-[#F0F0F0]"
            >
              <Play className="h-3.5 w-3.5 text-[#31CF76]" />
              <span>{testingNow ? "Enfileirando..." : "Testar rotina"}</span>
            </button>
          )}

          <button
            type="button"
            disabled={saving || (Boolean(draft.rotina_id) && !isDirty)}
            onClick={() => void handleSave()}
            className="rounded-xl bg-[#F0F0F0] hover:bg-white px-4 py-1.5 text-[14px] font-semibold text-[#141414] disabled:opacity-45"
          >
            {saving ? "Salvando..." : "Salvar rotina"}
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-xl bg-[#FD2F3B]/10 border border-[#FD2F3B]/40 p-3 text-[12px] text-[#FD2F3B]">
          {errorMsg}
        </div>
      )}
      {statusBanner && (
        <div className="rounded-xl bg-[#31CF76]/10 border border-[#31CF76]/40 p-3 text-[12px] text-[#31CF76]">
          {statusBanner}
        </div>
      )}

      {/* Nome da rotina */}
      <div className="space-y-1">
        <label
          htmlFor="routine-name-input"
          className="block text-[12px] font-semibold text-[#DCDCDC]"
        >
          Nome da rotina
        </label>
        <input
          id="routine-name-input"
          type="text"
          value={draft.nome}
          onChange={(e) => setDraft((d) => ({ ...d, nome: e.target.value }))}
          placeholder="Ex.: Resumo diário de engajamento"
          className="w-full rounded-xl bg-[#212121] border border-white/10 focus:border-[#007CF7] px-3 py-2 text-[14px] font-normal text-[#F0F0F0] focus:outline-none"
        />
      </div>

      {/* Quando executar */}
      <div className="space-y-3">
        <span className="block text-[12px] font-semibold text-[#DCDCDC]">Quando executar</span>
        <SlidingTabs<"schedule" | "webhook">
          ariaLabel="Tipo de gatilho da rotina"
          value={draft.triggerKind}
          onChange={(nextKind) => setDraft((d) => ({ ...d, triggerKind: nextKind }))}
          tabs={[
            { id: "schedule", label: "Agenda" },
            { id: "webhook", label: "Webhook" },
          ]}
        />

        {draft.triggerKind === "schedule" ? (
          <div className="rounded-xl bg-[#212121] border border-white/[0.06] p-4 space-y-4">
            <div className="space-y-1">
              <span className="block text-[12px] font-semibold text-[#DCDCDC]">Frequência</span>
              <CarbonSelect<ScheduleKind>
                ariaLabel="Frequência da rotina"
                value={draft.schedule.kind}
                onChange={(kind) =>
                  setDraft((d) => ({ ...d, schedule: buildDefaultScheduleForKind(kind) }))
                }
                options={SCHEDULE_KIND_OPTIONS}
              />
            </div>

            <div className="space-y-1">
              <span className="block text-[12px] font-semibold text-[#DCDCDC]">
                Fuso horário (IANA)
              </span>
              <CarbonSelect<string>
                ariaLabel="Fuso horário IANA"
                value={draft.timezone}
                onChange={(tz) => setDraft((d) => ({ ...d, timezone: tz }))}
                options={COMMON_IANA_TIMEZONES.map((tz) => ({ value: tz, label: tz }))}
              />
            </div>

            {draft.schedule.kind === "hourly" && (
              <div className="space-y-1">
                <label className="block text-[12px] font-semibold text-[#DCDCDC]">
                  Minuto da hora (0–59)
                </label>
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={draft.schedule.minute}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      schedule: {
                        kind: "hourly",
                        minute: Math.max(0, Math.min(59, Number(e.target.value) || 0)),
                      },
                    }))
                  }
                  className="w-full rounded-xl bg-[#141414] border border-white/10 focus:border-[#007CF7] px-3 py-2 text-[14px] text-[#F0F0F0] focus:outline-none"
                />
              </div>
            )}

            {(draft.schedule.kind === "daily" || draft.schedule.kind === "weekdays") && (
              <div className="space-y-1">
                <label className="block text-[12px] font-semibold text-[#DCDCDC]">Horário</label>
                <input
                  type="time"
                  value={draft.schedule.time}
                  onChange={(e) => {
                    const kind = draft.schedule.kind as "daily" | "weekdays";
                    setDraft((d) => ({
                      ...d,
                      schedule: { kind, time: e.target.value || "09:00" },
                    }));
                  }}
                  className="w-full rounded-xl bg-[#141414] border border-white/10 focus:border-[#007CF7] px-3 py-2 text-[14px] text-[#F0F0F0] focus:outline-none"
                />
              </div>
            )}

            {draft.schedule.kind === "weekly" && (
              <div className="space-y-2">
                <span className="block text-[12px] font-semibold text-[#DCDCDC]">
                  Dia da semana
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {WEEKDAY_CHIPS.map((wd) => {
                    const active =
                      draft.schedule.kind === "weekly" && draft.schedule.weekday === wd.id;
                    return (
                      <button
                        key={wd.id}
                        type="button"
                        onClick={() =>
                          setDraft((d) => ({
                            ...d,
                            schedule: {
                              kind: "weekly",
                              weekday: wd.id,
                              time: d.schedule.kind === "weekly" ? d.schedule.time : "09:00",
                            },
                          }))
                        }
                        className={`rounded-lg px-2.5 py-1 text-[12px] font-semibold ${
                          active
                            ? "bg-[#007CF7] text-white"
                            : "bg-[#141414] text-[#979797] hover:text-white"
                        }`}
                      >
                        {wd.label}
                      </button>
                    );
                  })}
                </div>
                <input
                  type="time"
                  value={draft.schedule.time}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      schedule: {
                        kind: "weekly",
                        weekday: d.schedule.kind === "weekly" ? d.schedule.weekday : 1,
                        time: e.target.value || "09:00",
                      },
                    }))
                  }
                  className="w-full rounded-xl bg-[#141414] border border-white/10 focus:border-[#007CF7] px-3 py-2 text-[14px] text-[#F0F0F0] focus:outline-none"
                />
              </div>
            )}

            {draft.schedule.kind === "monthly" && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[12px] font-semibold text-[#DCDCDC] mb-1">
                    Dia do mês (1–31)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={draft.schedule.day}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        schedule: {
                          kind: "monthly",
                          day: Math.max(1, Math.min(31, Number(e.target.value) || 1)),
                          time: d.schedule.kind === "monthly" ? d.schedule.time : "09:00",
                        },
                      }))
                    }
                    className="w-full rounded-xl bg-[#141414] border border-white/10 focus:border-[#007CF7] px-3 py-2 text-[14px] text-[#F0F0F0] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-[#DCDCDC] mb-1">
                    Horário
                  </label>
                  <input
                    type="time"
                    value={draft.schedule.time}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        schedule: {
                          kind: "monthly",
                          day: d.schedule.kind === "monthly" ? d.schedule.day : 1,
                          time: e.target.value || "09:00",
                        },
                      }))
                    }
                    className="w-full rounded-xl bg-[#141414] border border-white/10 focus:border-[#007CF7] px-3 py-2 text-[14px] text-[#F0F0F0] focus:outline-none"
                  />
                </div>
              </div>
            )}

            {draft.schedule.kind === "interval" && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[12px] font-semibold text-[#DCDCDC] mb-1">
                    Repetir a cada
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={draft.schedule.amount}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        schedule: {
                          kind: "interval",
                          amount: Math.max(1, Number(e.target.value) || 1),
                          unit: d.schedule.kind === "interval" ? d.schedule.unit : "minutes",
                          anchorAt:
                            d.schedule.kind === "interval"
                              ? d.schedule.anchorAt
                              : new Date().toISOString(),
                        },
                      }))
                    }
                    className="w-full rounded-xl bg-[#141414] border border-white/10 focus:border-[#007CF7] px-3 py-2 text-[14px] text-[#F0F0F0] focus:outline-none"
                  />
                </div>
                <div>
                  <span className="block text-[12px] font-semibold text-[#DCDCDC] mb-1">
                    Unidade
                  </span>
                  <CarbonSelect<"minutes" | "hours" | "days">
                    ariaLabel="Unidade do intervalo"
                    value={draft.schedule.unit}
                    onChange={(unit) =>
                      setDraft((d) => ({
                        ...d,
                        schedule: {
                          kind: "interval",
                          amount: d.schedule.kind === "interval" ? d.schedule.amount : 15,
                          unit,
                          anchorAt:
                            d.schedule.kind === "interval"
                              ? d.schedule.anchorAt
                              : new Date().toISOString(),
                        },
                      }))
                    }
                    options={[
                      { value: "minutes", label: "Minutos (mín. 3)" },
                      { value: "hours", label: "Horas" },
                      { value: "days", label: "Dias" },
                    ]}
                  />
                </div>
              </div>
            )}

            {draft.schedule.kind === "advanced" && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  {WEEKDAY_CHIPS.map((wd) => {
                    const selectedDays =
                      draft.schedule.kind === "advanced" &&
                      draft.schedule.days.kind === "days-of-week"
                        ? draft.schedule.days.days
                        : [];
                    const isOn = selectedDays.includes(wd.id);
                    return (
                      <button
                        key={wd.id}
                        type="button"
                        onClick={() => {
                          const nextDays = isOn
                            ? selectedDays.filter((x) => x !== wd.id)
                            : [...selectedDays, wd.id];
                          setDraft((d) => ({
                            ...d,
                            schedule: {
                              kind: "advanced",
                              months: d.schedule.kind === "advanced" ? d.schedule.months : [],
                              days: { kind: "days-of-week", days: nextDays },
                              time:
                                d.schedule.kind === "advanced"
                                  ? d.schedule.time
                                  : { kind: "at-time", time: "09:00" },
                            },
                          }));
                        }}
                        className={`rounded-lg px-2.5 py-1 text-[12px] font-semibold ${
                          isOn
                            ? "bg-[#007CF7] text-white"
                            : "bg-[#141414] text-[#979797] hover:text-white"
                        }`}
                      >
                        {wd.label}
                      </button>
                    );
                  })}
                </div>
                <input
                  type="time"
                  value={
                    draft.schedule.time.kind === "at-time"
                      ? draft.schedule.time.time
                      : "09:00"
                  }
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      schedule: {
                        kind: "advanced",
                        months: d.schedule.kind === "advanced" ? d.schedule.months : [],
                        days:
                          d.schedule.kind === "advanced"
                            ? d.schedule.days
                            : { kind: "every-day" },
                        time: { kind: "at-time", time: e.target.value || "09:00" },
                      },
                    }))
                  }
                  className="w-full rounded-xl bg-[#141414] border border-white/10 focus:border-[#007CF7] px-3 py-2 text-[14px] text-[#F0F0F0] focus:outline-none"
                />
              </div>
            )}

            {draft.schedule.kind === "custom" && (
              <div className="space-y-1">
                <label className="block text-[12px] font-semibold text-[#DCDCDC]">
                  Expressão Cron (5 campos)
                </label>
                <input
                  type="text"
                  value={draft.schedule.expression}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      schedule: { kind: "custom", expression: e.target.value },
                    }))
                  }
                  className="w-full rounded-xl bg-[#141414] border border-white/10 focus:border-[#007CF7] px-3 py-2 font-terminal text-[12px] text-[#F0F0F0] focus:outline-none"
                />
              </div>
            )}

            {draft.schedule.kind === "once" && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[12px] font-semibold text-[#DCDCDC] mb-1">
                    Data
                  </label>
                  <input
                    type="date"
                    value={draft.schedule.date}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        schedule: {
                          kind: "once",
                          date: e.target.value,
                          time: d.schedule.kind === "once" ? d.schedule.time : "09:00",
                        },
                      }))
                    }
                    className="w-full rounded-xl bg-[#141414] border border-white/10 focus:border-[#007CF7] px-3 py-2 text-[14px] text-[#F0F0F0] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-[#DCDCDC] mb-1">
                    Horário
                  </label>
                  <input
                    type="time"
                    value={draft.schedule.time}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        schedule: {
                          kind: "once",
                          date: d.schedule.kind === "once" ? d.schedule.date : defaultTomorrowDate(),
                          time: e.target.value || "09:00",
                        },
                      }))
                    }
                    className="w-full rounded-xl bg-[#141414] border border-white/10 focus:border-[#007CF7] px-3 py-2 text-[14px] text-[#F0F0F0] focus:outline-none"
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          <WebhookRoutineEditor
            rotinaId={draft.rotina_id}
            webhook={selectedRoutine?.webhook ?? null}
            revealedSecret={revealedSecret}
            eventType={draft.webhookEventType}
            filters={draft.webhookFilters}
            onChangeEventType={(val) =>
              setDraft((d) => ({ ...d, webhookEventType: val }))
            }
            onChangeFilters={(nextFilters) =>
              setDraft((d) => ({ ...d, webhookFilters: nextFilters }))
            }
            onGenerateEndpoint={async () => {
              await handleSave();
            }}
            onRotateSecret={async () => {
              if (!draft.rotina_id) return;
              const rotated = await daemonApi.rotateWebhookSecret(draft.rotina_id);
              setRevealedSecret(rotated.secret);
              await reloadRoutines();
            }}
            onApplyCustomSecret={async (sec) => {
              if (!draft.rotina_id) return;
              await daemonApi.setCustomWebhookSecret(draft.rotina_id, sec);
              setStatusBanner("Segredo externo aplicado com sucesso.");
              await reloadRoutines();
            }}
            onClearRevealedSecret={() => setRevealedSecret(null)}
          />
        )}
      </div>

      {/* Instrução da rotina */}
      <div className="space-y-1">
        <label
          htmlFor="routine-instruction-input"
          className="block text-[12px] font-semibold text-[#DCDCDC]"
        >
          Instrução da rotina
        </label>
        <textarea
          id="routine-instruction-input"
          rows={4}
          value={draft.instrucao}
          onChange={(e) => setDraft((d) => ({ ...d, instrucao: e.target.value }))}
          placeholder="Descreva exatamente o que o agente deve analisar ou produzir..."
          className="w-full rounded-xl bg-[#212121] border border-white/10 focus:border-[#007CF7] px-3 py-2 text-[14px] font-normal text-[#F0F0F0] focus:outline-none"
        />
        <p className="text-[12px] font-normal text-[#979797]">
          Execuções automáticas sem novidades podem chamar <code>routine_no_update</code> para não gerar notificação.
        </p>
      </div>

      {/* Políticas de Execução e Thread Isolada */}
      <div className="rounded-xl bg-[#212121] border border-white/[0.06] p-4 space-y-4">
        {!(draft.triggerKind === "schedule" && draft.schedule.kind === "once") && (
          <div className="space-y-1">
            <span className="block text-[12px] font-semibold text-[#DCDCDC]">
              Quando a cota do provedor acabar
            </span>
            <CarbonSelect<RoutineLimitPolicy>
              ariaLabel="Política de limite de cota"
              value={draft.limitPolicy}
              onChange={(val) => setDraft((d) => ({ ...d, limitPolicy: val }))}
              options={[
                { value: "wait", label: "Aguardar reset da cota" },
                { value: "skip", label: "Pular ocorrência" },
              ]}
            />
          </div>
        )}

        <div className="space-y-1">
          <span className="block text-[12px] font-semibold text-[#DCDCDC]">
            Se o servidor esteve desligado
          </span>
          <CarbonSelect<RoutineMissedPolicy>
            ariaLabel="Política para execuções perdidas"
            value={draft.missedPolicy}
            onChange={(val) => setDraft((d) => ({ ...d, missedPolicy: val }))}
            options={[
              { value: "skip", label: "Pular perdidas" },
              { value: "run-once", label: "Executar última perdida" },
            ]}
          />
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-[14px] font-normal text-[#DCDCDC]">
            Executar em conversa isolada (side-thread)
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={draft.runIn === "side_thread"}
            onClick={() =>
              setDraft((d) => ({
                ...d,
                runIn: d.runIn === "side_thread" ? "chat" : "side_thread",
              }))
            }
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
              draft.runIn === "side_thread" ? "bg-[#007CF7]" : "bg-[#2A2A2A]"
            }`}
          >
            <span
              className={`block h-4 w-4 rounded-full bg-white transition-transform ${
                draft.runIn === "side_thread" ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>

        {/* Destino do resultado (RoutineResultDestinationField agrupado sem controle HTML nativo) */}
        <div className="space-y-1 relative">
          <span className="block text-[12px] font-semibold text-[#DCDCDC]">
            Destino do resultado
          </span>
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={destMenuOpen}
            onClick={() => setDestMenuOpen((o) => !o)}
            className="w-full h-9 rounded-xl border border-[#2A2A2A] bg-[#141414] px-3 text-[13px] text-[#F0F0F0] flex items-center justify-between gap-2 hover:border-white/20"
          >
            <span className="truncate">
              {destinationDisplayLabel(draft.destinoResultado, destOptions)}
            </span>
            <ChevronDown className="h-4 w-4 text-[#979797]" />
          </button>

          {destMenuOpen && (
            <div
              role="listbox"
              aria-label="Selecionar destino do resultado"
              className="mt-1 rounded-xl border border-[#2A2A2A] bg-[#212121] p-1 space-y-1 max-h-56 overflow-y-auto shadow-2xl"
            >
              <button
                type="button"
                role="option"
                aria-selected={destinationKey(draft.destinoResultado) === "none"}
                onClick={() => {
                  setDraft((d) => ({ ...d, destinoResultado: { tipo: "none" } }));
                  setDestMenuOpen(false);
                }}
                className="w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[12px] text-[#F0F0F0] hover:bg-[#2A2A2A]"
              >
                <span>Apenas no histórico/chat</span>
                {destinationKey(draft.destinoResultado) === "none" && (
                  <Check className="h-3.5 w-3.5 text-[#007CF7]" />
                )}
              </button>

              {groupedDestinationSections.notifOpts.map((opt) => (
                <button
                  key={`notif:${opt.id}`}
                  type="button"
                  role="option"
                  aria-selected={draft.destinoResultado.tipo === "notificacao"}
                  onClick={() => {
                    setDraft((d) => ({
                      ...d,
                      destinoResultado: { tipo: "notificacao", destino_nome: opt.nome },
                    }));
                    setDestMenuOpen(false);
                  }}
                  className="w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[12px] text-[#F0F0F0] hover:bg-[#2A2A2A]"
                >
                  <span>{opt.nome}</span>
                  {draft.destinoResultado.tipo === "notificacao" && (
                    <Check className="h-3.5 w-3.5 text-[#007CF7]" />
                  )}
                </button>
              ))}

              {groupedDestinationSections.channelOpts.length > 0 && (
                <div>
                  <p className="px-2.5 pt-1 text-[11px] font-semibold text-[#979797]">
                    Canais em Equipe
                  </p>
                  {groupedDestinationSections.channelOpts.map((opt) => {
                    const selected =
                      draft.destinoResultado.tipo === "canal" &&
                      draft.destinoResultado.canal_id === opt.id;
                    return (
                      <button
                        key={`canal:${opt.id}`}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => {
                          setDraft((d) => ({
                            ...d,
                            destinoResultado: {
                              tipo: "canal",
                              canal_id: opt.id,
                              destino_nome: opt.nome,
                            },
                          }));
                          setDestMenuOpen(false);
                        }}
                        className="w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[12px] text-[#F0F0F0] hover:bg-[#2A2A2A]"
                      >
                        <span>{opt.nome}</span>
                        {selected && <Check className="h-3.5 w-3.5 text-[#007CF7]" />}
                      </button>
                    );
                  })}
                </div>
              )}

              {groupedDestinationSections.waOpts.length > 0 && (
                <div>
                  <p className="px-2.5 pt-1 text-[11px] font-semibold text-[#979797]">WhatsApp</p>
                  {groupedDestinationSections.waOpts.map((opt) => {
                    const selected =
                      draft.destinoResultado.tipo === "whatsapp" &&
                      draft.destinoResultado.destino_id === opt.id;
                    return (
                      <button
                        key={`wa:${opt.id}`}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => {
                          setDraft((d) => ({
                            ...d,
                            destinoResultado: {
                              tipo: "whatsapp",
                              destino_id: opt.id,
                              destino_nome: opt.nome,
                            },
                          }));
                          setDestMenuOpen(false);
                        }}
                        className="w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[12px] text-[#F0F0F0] hover:bg-[#2A2A2A]"
                      >
                        <span>{opt.nome}</span>
                        {selected && <Check className="h-3.5 w-3.5 text-[#007CF7]" />}
                      </button>
                    );
                  })}
                </div>
              )}

              {groupedDestinationSections.tgOpts.length > 0 && (
                <div>
                  <p className="px-2.5 pt-1 text-[11px] font-semibold text-[#979797]">Telegram</p>
                  {groupedDestinationSections.tgOpts.map((opt) => {
                    const selected =
                      draft.destinoResultado.tipo === "telegram" &&
                      draft.destinoResultado.chat_id === opt.id;
                    return (
                      <button
                        key={`tg:${opt.id}`}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => {
                          setDraft((d) => ({
                            ...d,
                            destinoResultado: {
                              tipo: "telegram",
                              chat_id: opt.id,
                              destino_nome: opt.nome,
                            },
                          }));
                          setDestMenuOpen(false);
                        }}
                        className="w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[12px] text-[#F0F0F0] hover:bg-[#2A2A2A]"
                      >
                        <span>{opt.nome}</span>
                        {selected && <Check className="h-3.5 w-3.5 text-[#007CF7]" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Histórico de Execuções e Entregas */}
      {draft.rotina_id && (
        <div className="rounded-xl bg-[#212121] border border-white/[0.06] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[14px] font-semibold text-[#F0F0F0]">
              Histórico de execuções ({runs.length})
            </h3>
            <button
              type="button"
              onClick={() => draft.rotina_id && void loadRoutineHistory(draft.rotina_id)}
              aria-label="Atualizar histórico"
              className="text-[#979797] hover:text-white"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>

          {runs.length === 0 ? (
            <p className="text-[12px] text-[#979797]">Nenhuma execução registrada ainda.</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {runs.map((run) => {
                const deliv = deliveryByExecId.get(run.execucao_id);
                const missed = run.missed_count ?? 0;
                return (
                  <div
                    key={run.execucao_id}
                    className="rounded-lg bg-[#141414] border border-white/[0.06] p-3 space-y-1.5 text-[12px]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[#979797]">
                        {formatRelativeExecutionLabel(run.scheduled_for)}
                      </span>
                      <span
                        className={`font-semibold ${
                          run.status === "succeeded"
                            ? "text-[#31CF76]"
                            : run.status === "failed"
                              ? "text-[#FD2F3B]"
                              : run.status === "running"
                                ? "text-[#42A0FF]"
                                : "text-[#FF9412]"
                        }`}
                      >
                        {run.status}
                      </span>
                    </div>

                    {run.silenciada && (
                      <p className="text-[#979797]">Silenciada (sem novidades)</p>
                    )}

                    {missed >= 1 && (
                      <p className="text-[#FF9412]">
                        {missed} ocorrências perdidas enquanto offline
                      </p>
                    )}

                    {run.erro && <p className="text-[#FD2F3B]">{run.erro}</p>}

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {onOpenThreadOrChat && (
                        <button
                          type="button"
                          onClick={() =>
                            onOpenThreadOrChat(
                              run.thread_id ||
                                (draft.runIn === "side_thread"
                                  ? `rotina:${run.rotina_id}`
                                  : `agente:${ownerId}`)
                            )
                          }
                          className="inline-flex items-center gap-1 text-[#42A0FF] hover:underline"
                        >
                          <MessageSquare className="h-3.5 w-3.5" />
                          <span>Abrir conversa</span>
                        </button>
                      )}

                      {deliv && (deliv.status === "failed" || deliv.status === "pending") && (
                        <button
                          type="button"
                          onClick={async () => {
                            if (!draft.rotina_id) return;
                            await daemonApi.resendRoutineDelivery(
                              draft.rotina_id,
                              run.execucao_id
                            );
                            await loadRoutineHistory(draft.rotina_id);
                          }}
                          className="inline-flex items-center gap-1 rounded-md bg-[#2A2A2A] px-2 py-0.5 text-[#F0F0F0] hover:bg-[#333336]"
                        >
                          <RefreshCw className="h-3 w-3" />
                          <span>Reenviar entrega</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
