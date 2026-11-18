import React, { useMemo, useState } from "react";
import type {
  WorkflowNo,
  WorkflowScheduleConfig,
  WorkflowScheduleKind,
  WorkflowTriggerConfig,
  WorkflowTriggerKind,
  WorkflowTriggerState,
} from "@criativo/contracts";
import { Check, ChevronDown, Copy, RefreshCw, ShieldAlert, X } from "lucide-react";

const TIMEZONES = [
  "America/Sao_Paulo",
  "America/Manaus",
  "America/Belem",
  "America/Fortaleza",
  "America/Recife",
  "America/Cuiaba",
  "UTC",
  "America/New_York",
  "Europe/Lisbon",
  "Europe/London",
];

const SCHEDULE_FREQUENCIES: Array<{ value: WorkflowScheduleKind; label: string }> = [
  { value: "hourly", label: "De hora em hora" },
  { value: "daily", label: "Diário" },
  { value: "weekdays", label: "Dias úteis" },
  { value: "weekly", label: "Semanal" },
  { value: "monthly", label: "Mensal" },
  { value: "interval", label: "Intervalo" },
  { value: "once", label: "Data única" },
  { value: "custom", label: "Expressão Cron" },
];

const WEEKDAYS = [
  { day: 1, label: "Seg" },
  { day: 2, label: "Ter" },
  { day: 3, label: "Qua" },
  { day: 4, label: "Qui" },
  { day: 5, label: "Sex" },
  { day: 6, label: "Sáb" },
  { day: 0, label: "Dom" },
];

const MEDIA_OPTIONS: Array<{ value: "all" | "text" | "audio" | "image"; label: string }> = [
  { value: "all", label: "Todas" },
  { value: "text", label: "Texto" },
  { value: "audio", label: "Áudio" },
  { value: "image", label: "Imagem" },
];

export interface WorkflowTriggerModalProps {
  workflowId: string;
  node: WorkflowNo;
  triggerState?: WorkflowTriggerState | null;
  onApply: (nodeId: string, patch: Partial<WorkflowNo>) => void;
  onRotateWebhook: (
    nodeId: string
  ) => Promise<{ route_id: string; webhook_url: string; secret: string }>;
  onClose: () => void;
}

export const WorkflowTriggerModal: React.FC<WorkflowTriggerModalProps> = ({
  node,
  triggerState,
  onApply,
  onRotateWebhook,
  onClose,
}) => {
  const cfg = node.config ?? {};
  const initialKind: WorkflowTriggerKind =
    node.triggerKind ??
    node.trigger?.kind ??
    (typeof cfg.triggerKind === "string" ? (cfg.triggerKind as WorkflowTriggerKind) : "schedule");
  const initialSchedule: WorkflowScheduleConfig =
    (node.trigger?.kind === "schedule" ? node.trigger.schedule : undefined) ??
    (cfg.schedule as WorkflowScheduleConfig | undefined) ?? {
      kind: "daily",
      hour: 9,
      minute: 0,
      timezone: "America/Sao_Paulo",
    };

  const [kind, setKind] = useState<WorkflowTriggerKind>(initialKind);
  const [freq, setFreq] = useState<WorkflowScheduleKind>(initialSchedule.kind ?? "daily");
  const [freqMenuOpen, setFreqMenuOpen] = useState(false);
  const [hour, setHour] = useState<number>(initialSchedule.hour ?? 9);
  const [minute, setMinute] = useState<number>(initialSchedule.minute ?? 0);
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(initialSchedule.daysOfWeek ?? [1]);
  const [dayOfMonth, setDayOfMonth] = useState<number>(initialSchedule.dayOfMonth ?? 1);
  const [intervalMinutes, setIntervalMinutes] = useState<number>(
    Math.max(3, initialSchedule.intervalMinutes ?? 15)
  );
  const [cronExpression, setCronExpression] = useState<string>(
    initialSchedule.cronExpression ?? "0 9 * * *"
  );
  const [runAt, setRunAt] = useState<string>(initialSchedule.runAt ?? "");
  const [timezone, setTimezone] = useState<string>(
    initialSchedule.timezone ?? triggerState?.timezone ?? "America/Sao_Paulo"
  );
  const [tzQuery, setTzQuery] = useState("");
  const [tzMenuOpen, setTzMenuOpen] = useState(false);

  const [grupoOuNumero, setGrupoOuNumero] = useState<string>(
    node.trigger?.kind === "whatsapp"
      ? (node.trigger.grupoOuNumero ?? "")
      : typeof cfg.grupoOuNumero === "string"
        ? cfg.grupoOuNumero
        : ""
  );
  const [chatId, setChatId] = useState<string>(
    node.trigger?.kind === "telegram"
      ? (node.trigger.chatId ?? "")
      : typeof cfg.chatId === "string"
        ? cfg.chatId
        : ""
  );
  const [conectorId, setConectorId] = useState<string>(
    node.trigger?.kind === "conector"
      ? (node.trigger.conectorId ?? "")
      : typeof cfg.conectorId === "string"
        ? cfg.conectorId
        : ""
  );
  const [evento, setEvento] = useState<string>(
    node.trigger?.kind === "conector"
      ? (node.trigger.evento ?? "")
      : typeof cfg.evento === "string"
        ? cfg.evento
        : ""
  );
  const [palavraChave, setPalavraChave] = useState<string>(
    node.trigger?.kind === "whatsapp" || node.trigger?.kind === "telegram"
      ? (node.trigger.palavraChave ?? "")
      : typeof cfg.palavraChave === "string"
        ? cfg.palavraChave
        : ""
  );
  const [tipoMidia, setTipoMidia] = useState<"all" | "text" | "audio" | "image">(
    node.trigger?.kind === "whatsapp" && node.trigger.tipoMidia
      ? node.trigger.tipoMidia
      : "all"
  );
  const [mediaMenuOpen, setMediaMenuOpen] = useState(false);

  const [rotatedSecret, setRotatedSecret] = useState<string | null>(null);
  const [webhookUrlPreview, setWebhookUrlPreview] = useState<string>(
    triggerState?.webhook_url ?? ""
  );
  const [rotating, setRotating] = useState(false);

  const filteredTimezones = useMemo(
    () =>
      TIMEZONES.filter((tz) => tz.toLowerCase().includes(tzQuery.trim().toLowerCase())),
    [tzQuery]
  );

  const hasExistingSecret = Boolean(triggerState?.webhook_route_id || rotatedSecret);

  const handleApply = () => {
    let trigger: WorkflowTriggerConfig;
    const nextConfig: Record<string, unknown> = { ...cfg, triggerKind: kind };

    if (kind === "schedule") {
      const sched: WorkflowScheduleConfig = {
        kind: freq,
        hour,
        minute,
        daysOfWeek,
        dayOfMonth,
        intervalMinutes: Math.max(3, intervalMinutes),
        cronExpression,
        runAt: runAt || undefined,
        timezone,
      };
      trigger = { kind: "schedule", schedule: sched };
      nextConfig.schedule = sched;
    } else if (kind === "webhook") {
      trigger = { kind: "webhook" };
    } else if (kind === "whatsapp") {
      trigger = {
        kind: "whatsapp",
        grupoOuNumero: grupoOuNumero.trim() || undefined,
        palavraChave: palavraChave.trim() || undefined,
        tipoMidia,
      };
      nextConfig.grupoOuNumero = trigger.grupoOuNumero;
      nextConfig.palavraChave = trigger.palavraChave;
      nextConfig.tipoMidia = tipoMidia;
    } else if (kind === "telegram") {
      trigger = {
        kind: "telegram",
        chatId: chatId.trim() || undefined,
        palavraChave: palavraChave.trim() || undefined,
      };
      nextConfig.chatId = trigger.chatId;
      nextConfig.palavraChave = trigger.palavraChave;
    } else if (kind === "conector") {
      trigger = {
        kind: "conector",
        conectorId: conectorId.trim() || undefined,
        evento: evento.trim() || undefined,
      };
      nextConfig.conectorId = trigger.conectorId;
      nextConfig.evento = trigger.evento;
    } else {
      trigger = { kind: "manual" };
    }

    onApply(node.id, {
      triggerKind: kind,
      trigger,
      config: nextConfig,
    });
    setRotatedSecret(null);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={() => {
        setRotatedSecret(null);
        onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Configurar gatilho do fluxo"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border border-white/[0.12] bg-[#212121] p-6 shadow-2xl space-y-4"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[20px] font-semibold text-white">Configurar gatilho do fluxo</h2>
          <button
            type="button"
            aria-label="Fechar painel"
            onClick={() => {
              setRotatedSecret(null);
              onClose();
            }}
            className="rounded-lg p-1 text-[#979797] hover:bg-[#2A2A2A] hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Abas de tipo do gatilho */}
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ["schedule", "Agendado"],
              ["manual", "Manual"],
              ["webhook", "Webhook"],
              ["whatsapp", "WhatsApp"],
              ["telegram", "Telegram"],
              ["conector", "Conector externo"],
            ] as Array<[WorkflowTriggerKind, string]>
          ).map(([val, lbl]) => (
            <button
              key={val}
              type="button"
              onClick={() => setKind(val)}
              className={`rounded-lg border px-2 py-1 text-[12px] font-semibold ${
                kind === val
                  ? "border-[#007CF7] bg-[#007CF7]/15 text-[#42A0FF]"
                  : "border-white/[0.06] bg-[#242424] text-[#DCDCDC] hover:bg-[#2A2A2A]"
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>

        {kind === "schedule" && (
          <div className="space-y-4">
            <div className="relative">
              <label className="mb-1 block text-[12px] font-semibold text-[#979797]">
                Frequência
              </label>
              <button
                type="button"
                aria-expanded={freqMenuOpen}
                aria-haspopup="listbox"
                onClick={() => setFreqMenuOpen((v) => !v)}
                className="flex w-full items-center justify-between rounded-lg border border-white/[0.12] bg-[#242424] px-3 py-2 text-[14px] text-white"
              >
                <span>{SCHEDULE_FREQUENCIES.find((f) => f.value === freq)?.label}</span>
                <ChevronDown className="h-4 w-4 text-[#979797]" />
              </button>
              {freqMenuOpen && (
                <div
                  role="listbox"
                  className="absolute left-0 top-full z-40 mt-1 max-h-52 w-full overflow-y-auto rounded-xl border border-white/[0.12] bg-[#212121] p-1 shadow-2xl"
                >
                  {SCHEDULE_FREQUENCIES.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      role="option"
                      aria-selected={freq === opt.value}
                      onClick={() => {
                        setFreq(opt.value);
                        setFreqMenuOpen(false);
                      }}
                      className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-left text-[12px] text-[#DCDCDC] hover:bg-[#2A2A2A]"
                    >
                      <span>{opt.label}</span>
                      {freq === opt.value && <Check className="h-3.5 w-3.5 text-[#42A0FF]" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {freq === "weekly" && (
              <div className="flex flex-wrap gap-1">
                {WEEKDAYS.map((wd) => {
                  const selectedDay = daysOfWeek.includes(wd.day);
                  return (
                    <button
                      key={wd.day}
                      type="button"
                      onClick={() =>
                        setDaysOfWeek((prev) =>
                          prev.includes(wd.day)
                            ? prev.filter((d) => d !== wd.day)
                            : [...prev, wd.day]
                        )
                      }
                      className={`rounded-lg border px-2 py-1 text-[12px] font-semibold ${
                        selectedDay
                          ? "border-[#007CF7] bg-[#007CF7]/15 text-[#42A0FF]"
                          : "border-white/[0.06] bg-[#242424] text-[#979797]"
                      }`}
                    >
                      {wd.label}
                    </button>
                  );
                })}
              </div>
            )}

            {(freq === "daily" || freq === "weekdays" || freq === "weekly" || freq === "monthly") && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-[12px] text-[#979797]">Hora (0–23)</label>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={hour}
                    onChange={(e) => setHour(Number(e.target.value) || 0)}
                    className="w-full rounded-lg border border-white/[0.06] bg-[#242424] px-2 py-1 text-[14px] text-white"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[12px] text-[#979797]">Minuto (0–59)</label>
                  <input
                    type="number"
                    min={0}
                    max={59}
                    value={minute}
                    onChange={(e) => setMinute(Number(e.target.value) || 0)}
                    className="w-full rounded-lg border border-white/[0.06] bg-[#242424] px-2 py-1 text-[14px] text-white"
                  />
                </div>
              </div>
            )}

            {freq === "hourly" && (
              <div>
                <label className="mb-1 block text-[12px] text-[#979797]">Minuto da hora</label>
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={minute}
                  onChange={(e) => setMinute(Number(e.target.value) || 0)}
                  className="w-full rounded-lg border border-white/[0.06] bg-[#242424] px-2 py-1 text-[14px] text-white"
                />
              </div>
            )}

            {freq === "monthly" && (
              <div>
                <label className="mb-1 block text-[12px] text-[#979797]">Dia do mês (1–31)</label>
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={dayOfMonth}
                  onChange={(e) => setDayOfMonth(Number(e.target.value) || 1)}
                  className="w-full rounded-lg border border-white/[0.06] bg-[#242424] px-2 py-1 text-[14px] text-white"
                />
              </div>
            )}

            {freq === "interval" && (
              <div>
                <label className="mb-1 block text-[12px] text-[#979797]">
                  Intervalo em minutos (mínimo 3)
                </label>
                <input
                  type="number"
                  min={3}
                  value={intervalMinutes}
                  onChange={(e) => setIntervalMinutes(Math.max(3, Number(e.target.value) || 3))}
                  className="w-full rounded-lg border border-white/[0.06] bg-[#242424] px-2 py-1 text-[14px] text-white"
                />
              </div>
            )}

            {freq === "custom" && (
              <div>
                <label className="mb-1 block text-[12px] text-[#979797]">Expressão Cron (5 campos)</label>
                <input
                  type="text"
                  value={cronExpression}
                  onChange={(e) => setCronExpression(e.target.value)}
                  className="w-full rounded-lg border border-white/[0.06] bg-[#242424] px-2 py-1 font-mono text-[14px] text-white"
                />
              </div>
            )}

            {freq === "once" && (
              <div>
                <label className="mb-1 block text-[12px] text-[#979797]">Data e hora ISO UTC</label>
                <input
                  type="datetime-local"
                  value={runAt.slice(0, 16)}
                  onChange={(e) =>
                    setRunAt(e.target.value ? new Date(e.target.value).toISOString() : "")
                  }
                  className="w-full rounded-lg border border-white/[0.06] bg-[#242424] px-2 py-1 text-[14px] text-white"
                />
              </div>
            )}

            {/* Seletor pesquisável de fuso IANA */}
            <div className="relative">
              <label className="mb-1 block text-[12px] font-semibold text-[#979797]">
                Fuso horário IANA
              </label>
              <button
                type="button"
                aria-expanded={tzMenuOpen}
                onClick={() => setTzMenuOpen((v) => !v)}
                className="flex w-full items-center justify-between rounded-lg border border-white/[0.12] bg-[#242424] px-3 py-2 text-[14px] text-white"
              >
                <span>{timezone}</span>
                <ChevronDown className="h-4 w-4 text-[#979797]" />
              </button>
              {tzMenuOpen && (
                <div className="absolute left-0 top-full z-40 mt-1 w-full rounded-xl border border-white/[0.12] bg-[#212121] p-2 shadow-2xl">
                  <input
                    type="text"
                    value={tzQuery}
                    onChange={(e) => setTzQuery(e.target.value)}
                    placeholder="Filtrar fuso horário..."
                    className="mb-2 w-full rounded-lg border border-white/[0.06] bg-[#242424] px-2 py-1 text-[12px] text-white"
                  />
                  <div className="max-h-40 overflow-y-auto">
                    {filteredTimezones.map((tz) => (
                      <button
                        key={tz}
                        type="button"
                        onClick={() => {
                          setTimezone(tz);
                          setTzMenuOpen(false);
                        }}
                        className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-left text-[12px] text-[#DCDCDC] hover:bg-[#2A2A2A]"
                      >
                        <span>{tz}</span>
                        {timezone === tz && <Check className="h-3.5 w-3.5 text-[#42A0FF]" />}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-white/[0.06] bg-[#141414] p-2 text-[12px] text-[#979797]">
              Execuções são puladas se o fluxo anterior ainda estiver aberto.
            </div>
          </div>
        )}

        {kind === "webhook" && (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-[12px] font-semibold text-[#979797]">
                Endpoint autenticado HMAC-SHA256
              </label>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={webhookUrlPreview || "/api/workflows/webhook/(gere o segredo)"}
                  className="flex-1 rounded-lg border border-white/[0.06] bg-[#242424] px-2 py-1 font-mono text-[12px] text-[#DCDCDC]"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (webhookUrlPreview && navigator.clipboard) {
                      void navigator.clipboard.writeText(webhookUrlPreview);
                    }
                  }}
                  className="flex items-center gap-1 rounded-lg bg-[#2A2A2A] px-2 py-1 text-[12px] font-semibold text-white"
                >
                  <Copy className="h-3.5 w-3.5" />
                  <span>Copiar endereço</span>
                </button>
              </div>
              <p className="mt-1 text-[12px] text-[#979797]">
                Envie o cabeçalho <span className="font-mono text-[#DCDCDC]">X-Criativo-Signature</span> e opcionalmente{" "}
                <span className="font-mono text-[#DCDCDC]">X-Delivery-Id</span>.
              </p>
            </div>

            <button
              type="button"
              disabled={rotating}
              onClick={async () => {
                setRotating(true);
                try {
                  const res = await onRotateWebhook(node.id);
                  setWebhookUrlPreview(res.webhook_url);
                  setRotatedSecret(res.secret);
                } finally {
                  setRotating(false);
                }
              }}
              className="flex items-center gap-2 rounded-lg border border-white/[0.12] bg-[#242424] px-3 py-2 text-[12px] font-semibold text-white hover:bg-[#2A2A2A]"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${rotating ? "animate-spin" : ""}`} />
              <span>{hasExistingSecret ? "Rotacionar segredo" : "Gerar segredo"}</span>
            </button>

            {rotatedSecret && (
              <div className="rounded-xl border border-[#FF9412]/50 bg-[#FF9412]/10 p-4 space-y-2">
                <div className="flex items-center gap-2 text-[12px] font-semibold text-[#FF9412]">
                  <ShieldAlert className="h-4 w-4" />
                  <span>Copie o segredo agora; ele não será exibido novamente.</span>
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded bg-[#141414] px-2 py-1 font-mono text-[12px] text-white">
                    {rotatedSecret}
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      if (navigator.clipboard) void navigator.clipboard.writeText(rotatedSecret);
                    }}
                    className="rounded-lg bg-[#F0F0F0] px-2 py-1 text-[12px] font-semibold text-[#141414]"
                  >
                    Copiar segredo
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {(kind === "whatsapp" || kind === "telegram" || kind === "conector") && (
          <div className="space-y-4">
            {kind === "whatsapp" && (
              <>
                <div>
                  <label className="mb-1 block text-[12px] text-[#979797]">
                    Número ou grupo (opcional)
                  </label>
                  <input
                    type="text"
                    value={grupoOuNumero}
                    onChange={(e) => setGrupoOuNumero(e.target.value)}
                    placeholder="Ex.: 5511999999999 ou @g.us"
                    className="w-full rounded-lg border border-white/[0.06] bg-[#242424] px-2 py-1 text-[14px] text-white"
                  />
                </div>
                <div className="relative">
                  <label className="mb-1 block text-[12px] text-[#979797]">Tipo de mídia</label>
                  <button
                    type="button"
                    onClick={() => setMediaMenuOpen((v) => !v)}
                    className="flex w-full items-center justify-between rounded-lg border border-white/[0.12] bg-[#242424] px-3 py-2 text-[14px] text-white"
                  >
                    <span>{MEDIA_OPTIONS.find((m) => m.value === tipoMidia)?.label}</span>
                    <ChevronDown className="h-4 w-4 text-[#979797]" />
                  </button>
                  {mediaMenuOpen && (
                    <div className="absolute left-0 top-full z-40 mt-1 w-full rounded-xl border border-white/[0.12] bg-[#212121] p-1 shadow-2xl">
                      {MEDIA_OPTIONS.map((m) => (
                        <button
                          key={m.value}
                          type="button"
                          onClick={() => {
                            setTipoMidia(m.value);
                            setMediaMenuOpen(false);
                          }}
                          className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-left text-[12px] text-[#DCDCDC] hover:bg-[#2A2A2A]"
                        >
                          <span>{m.label}</span>
                          {tipoMidia === m.value && <Check className="h-3.5 w-3.5 text-[#42A0FF]" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {kind === "telegram" && (
              <div>
                <label className="mb-1 block text-[12px] text-[#979797]">Chat ID Telegram</label>
                <input
                  type="text"
                  value={chatId}
                  onChange={(e) => setChatId(e.target.value)}
                  placeholder="Opcional (todos os chats se vazio)"
                  className="w-full rounded-lg border border-white/[0.06] bg-[#242424] px-2 py-1 text-[14px] text-white"
                />
              </div>
            )}

            {kind === "conector" && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-[12px] text-[#979797]">ID do conector</label>
                  <input
                    type="text"
                    value={conectorId}
                    onChange={(e) => setConectorId(e.target.value)}
                    placeholder="Ex.: github, instagram"
                    className="w-full rounded-lg border border-white/[0.06] bg-[#242424] px-2 py-1 text-[14px] text-white"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[12px] text-[#979797]">Evento</label>
                  <input
                    type="text"
                    value={evento}
                    onChange={(e) => setEvento(e.target.value)}
                    placeholder="Ex.: comentario.novo"
                    className="w-full rounded-lg border border-white/[0.06] bg-[#242424] px-2 py-1 text-[14px] text-white"
                  />
                </div>
              </div>
            )}

            {(kind === "whatsapp" || kind === "telegram") && (
              <div>
                <label className="mb-1 block text-[12px] text-[#979797]">
                  Palavra-chave de disparo (opcional)
                </label>
                <input
                  type="text"
                  value={palavraChave}
                  onChange={(e) => setPalavraChave(e.target.value)}
                  placeholder="Ex.: /gerar"
                  className="w-full rounded-lg border border-white/[0.06] bg-[#242424] px-2 py-1 text-[14px] text-white"
                />
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => {
              setRotatedSecret(null);
              onClose();
            }}
            className="rounded-lg bg-[#2A2A2A] px-4 py-2 text-[14px] font-semibold text-white hover:bg-[#333335]"
          >
            Fechar painel
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="rounded-lg bg-[#F0F0F0] px-4 py-2 text-[14px] font-semibold text-[#141414] hover:bg-white"
          >
            Aplicar gatilho
          </button>
        </div>
      </div>
    </div>
  );
};
