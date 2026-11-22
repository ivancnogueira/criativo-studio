import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AgentRoutine,
  RoutineDestinationOption,
  RoutineResultDelivery,
  RoutineRun,
} from "@criativo/contracts";
import { daemonApi } from "../../services/websocket-client";
import { validateRoutineFormDraft } from "./routine-schedule-format";
import {
  createEmptyDraft,
  draftFromRoutine,
  isPastOnceRoutine,
  type AgentRoutinesSettingsProps,
  type RoutineDraft,
} from "./routine-settings-types";

export function useAgentRoutinesController(props: AgentRoutinesSettingsProps) {
  const {
    ownerKind,
    ownerId,
    canais = [],
    initialRoutines,
    initialSelectedRoutineId = null,
    onRoutinesChanged
  } = props;

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

  return {
    routines,
    setRoutines,
    loadingList,
    setLoadingList,
    mode,
    setMode,
    draft,
    setDraft,
    baselineSnapshot,
    setBaselineSnapshot,
    revealedSecret,
    setRevealedSecret,
    saving,
    setSaving,
    testingNow,
    setTestingNow,
    confirmDeleteOpen,
    setConfirmDeleteOpen,
    unsavedConfirmOpen,
    setUnsavedConfirmOpen,
    errorMsg,
    setErrorMsg,
    statusBanner,
    setStatusBanner,
    runs,
    setRuns,
    deliveries,
    setDeliveries,
    destOptions,
    setDestOptions,
    destMenuOpen,
    setDestMenuOpen,
    selectedRoutine,
    isDirty,
    reloadRoutines,
    loadRoutineHistory,
    openEditorForRoutine,
    openNewRoutineEditor,
    handleSave,
    handleToggleActiveInList,
    handleBackFromEditor,
    deliveryByExecId,
    groupedDestinationSections
  };
}

export type AgentRoutinesController = ReturnType<typeof useAgentRoutinesController>;
