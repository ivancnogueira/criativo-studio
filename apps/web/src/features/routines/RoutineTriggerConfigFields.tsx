import {
  Webhook,
} from "lucide-react";
import { CarbonSelect, SlidingTabs } from "../../components/ui/CarbonControls";
import { daemonApi } from "../../services/websocket-client";
import { WebhookRoutineEditor } from "./WebhookRoutineEditor";
import { COMMON_IANA_TIMEZONES } from "./routine-schedule-format";
import { SCHEDULE_KIND_OPTIONS, WEEKDAY_CHIPS, buildDefaultScheduleForKind, defaultTomorrowDate, type ScheduleKind, type AgentRoutinesSettingsProps } from "./routine-settings-types";
import type { AgentRoutinesController } from "./useAgentRoutinesController";

export function RoutineTriggerConfigFields({
  ctrl,
  props,
}: {
  ctrl: AgentRoutinesController;
  props: AgentRoutinesSettingsProps;
}) {
  
  const {
    draft,
    setDraft,
    revealedSecret,
    setRevealedSecret,
    setStatusBanner,
    selectedRoutine,
    reloadRoutines,
    handleSave,
  } = ctrl;

  return (
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
  );
}
