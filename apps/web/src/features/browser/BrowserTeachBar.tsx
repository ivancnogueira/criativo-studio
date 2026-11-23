import React, { useEffect, useState } from "react";
import type { UserBrowsingStep } from "@criativo/contracts";
import { Circle, FileText, MousePointerClick, Square, Trash2, X } from "lucide-react";

export function formatTeachElapsed(ms: number): string {
  const safeSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function buildRecordedTaskSummary(steps: UserBrowsingStep[]): string {
  if (!steps || steps.length === 0) {
    return "# Fluxo Gravado (BrowserTeachBar)\n\nNenhum passo gravado ainda.";
  }

  const lines: string[] = [
    "# Fluxo Gravado pelo Usuário (UserBrowsingLog)",
    "# Dica: URLs mantêm somente host + caminho estrutural; textos digitados e senhas não são gravados.",
    "",
  ];

  steps.forEach((step, idx) => {
    const place = `${step.host}${step.path}`;
    if (step.kind === "page") {
      lines.push(`${idx + 1}. Abrir página ${place}${step.title ? ` (${step.title})` : ""}`);
    } else {
      const targetDesc = step.name
        ? `${step.role ?? "elemento"} "${step.name}"`
        : step.role ?? "elemento interativo";
      lines.push(`${idx + 1}. Clicar em ${targetDesc} na página ${place}`);
    }
  });

  return lines.join("\n");
}

export interface BrowserTeachBarProps {
  agentName: string;
  recording: boolean;
  startedAt: number | null;
  stepsCount: number;
  visible?: boolean;
  busy?: boolean;
  onStartRecording: () => void | Promise<void>;
  onStopRecording: (action: "save" | "discard") => void | Promise<void>;
  onHideBar?: () => void;
}

export function BrowserTeachBar({
  agentName,
  recording,
  startedAt,
  stepsCount,
  visible = true,
  busy = false,
  onStartRecording,
  onStopRecording,
  onHideBar,
}: BrowserTeachBarProps) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!recording || !startedAt) {
      setElapsedMs(0);
      return;
    }
    setElapsedMs(Math.max(0, Date.now() - startedAt));
    const timer = setInterval(() => {
      setElapsedMs(Math.max(0, Date.now() - startedAt));
    }, 500);
    return () => clearInterval(timer);
  }, [recording, startedAt]);

  if (!visible) return null;

  return (
    <div
      data-recording={recording ? "true" : "false"}
      className="flex h-[48px] shrink-0 items-center justify-between gap-[8px] border-b border-white/[0.06] bg-[#242424] px-[16px]"
    >
      {recording ? (
        <>
          <div className="flex min-w-0 items-center gap-[8px]">
            <span className="inline-flex h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-[#FD2F3B]" />
            <span className="truncate text-[14px] font-semibold text-[#F0F0F0]">
              Gravando fluxo para o Criativo
            </span>
            <span className="rounded-md bg-[#141414] px-2 py-0.5 font-mono text-[12px] text-[#42A0FF]">
              {stepsCount} {stepsCount === 1 ? "passo" : "passos"}
            </span>
            <span className="font-mono text-[12px] text-[#979797]">
              {formatTeachElapsed(elapsedMs)}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-[8px]">
            <button
              type="button"
              disabled={busy}
              onClick={() => void onStopRecording("save")}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#F0F0F0] px-3 py-1.5 text-[12px] font-semibold text-[#141414] transition hover:bg-white disabled:opacity-50"
            >
              <Square size={12} fill="currentColor" />
              <span>Gravar passos</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void onStopRecording("discard")}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#2A2A2A] px-3 py-1.5 text-[12px] font-semibold text-[#F0F0F0] transition hover:bg-[#333333] disabled:opacity-50"
            >
              <Trash2 size={13} />
              <span>Descartar gravação</span>
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="min-w-0 truncate text-[12px] font-normal text-[#979797]">
            Mostre o caminho na página para{" "}
            <strong className="font-semibold text-[#F0F0F0]">{agentName}</strong> aprender. Senhas
            e textos digitados não são gravados.
          </p>

          <div className="flex shrink-0 items-center gap-[8px]">
            <button
              type="button"
              disabled={busy}
              onClick={() => void onStartRecording()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#FD2F3B] px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-[#e12430] disabled:opacity-50"
            >
              <Circle size={11} fill="currentColor" />
              <span>Iniciar gravação</span>
            </button>
            {onHideBar && (
              <button
                type="button"
                aria-label="Ocultar barra"
                onClick={onHideBar}
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#2A2A2A] text-[#979797] transition hover:bg-[#333333] hover:text-[#F0F0F0]"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export interface UserBrowsingLogInspectorProps {
  open: boolean;
  agentName: string;
  steps: UserBrowsingStep[];
  recordedTaskText?: string;
  loading?: boolean;
  onClose: () => void;
  onAttachRecordedTask?: (recordedTaskText: string) => void | Promise<void>;
  onClearLog?: () => void | Promise<void>;
}

export function UserBrowsingLogInspector({
  open,
  agentName,
  steps,
  recordedTaskText,
  loading = false,
  onClose,
  onAttachRecordedTask,
  onClearLog,
}: UserBrowsingLogInspectorProps) {
  if (!open) return null;

  const summary = recordedTaskText?.trim() || buildRecordedTaskSummary(steps);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-[16px]">
      <div className="flex max-h-[82vh] w-full max-w-[680px] flex-col overflow-hidden rounded-xl border border-white/[0.06] bg-[#212121] shadow-2xl">
        <div className="flex h-[48px] shrink-0 items-center justify-between border-b border-white/[0.06] bg-[#0D0D0D] px-[16px]">
          <div className="flex items-center gap-[8px]">
            <MousePointerClick size={16} className="text-[#42A0FF]" />
            <h2 className="text-[14px] font-semibold text-[#F0F0F0]">
              Passos gravados — {agentName}
            </h2>
            <span className="rounded-full bg-[#242424] px-2 py-0.5 font-mono text-[12px] text-[#979797]">
              {steps.length}
            </span>
          </div>
          <button
            type="button"
            aria-label="Fechar painel"
            onClick={onClose}
            className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] font-semibold text-[#979797] transition hover:bg-[#2A2A2A] hover:text-[#F0F0F0]"
          >
            <X size={15} />
            <span>Fechar painel</span>
          </button>
        </div>

        <div className="flex-1 space-y-[16px] overflow-y-auto p-[16px]">
          {loading ? (
            <p className="text-[14px] text-[#979797]">Carregando histórico gravado...</p>
          ) : steps.length === 0 ? (
            <div className="rounded-xl border border-white/[0.06] bg-[#1A1A1A] p-[24px] text-center">
              <p className="text-[14px] font-semibold text-[#F0F0F0]">
                Nenhum passo gravado ainda
              </p>
              <p className="mt-1 text-[12px] text-[#979797]">
                Inicie o BrowserTakeover e clique em Iniciar gravação para ensinar rotas repetíveis
                ao Criativo.
              </p>
            </div>
          ) : (
            <div className="space-y-[8px]">
              {steps.map((step, idx) => (
                <div
                  key={step.log_id}
                  className="flex items-start justify-between gap-[8px] rounded-xl border border-white/[0.06] bg-[#1A1A1A] p-[12px]"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-[8px]">
                      <span className="rounded bg-[#242424] px-1.5 py-0.5 font-mono text-[12px] text-[#979797]">
                        #{idx + 1}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ${
                          step.kind === "page"
                            ? "bg-[#42A0FF]/15 text-[#42A0FF]"
                            : "bg-[#31CF76]/15 text-[#31CF76]"
                        }`}
                      >
                        {step.kind === "page" ? "Página" : `Clique (${step.role ?? "elemento"})`}
                      </span>
                      <span className="truncate font-mono text-[12px] text-[#F0F0F0]">
                        {step.host}
                        {step.path}
                      </span>
                    </div>
                    {(step.name || step.title) && (
                      <p className="truncate text-[12px] text-[#979797]">
                        {step.name ?? step.title}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {steps.length > 0 && (
            <div className="rounded-xl border border-white/[0.06] bg-[#141414] p-[12px]">
              <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-[#979797]">
                <FileText size={13} />
                <span>recorded-task.txt (redação segura)</span>
              </div>
              <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap font-mono text-[12px] text-[#DCDCDC]">
                {summary}
              </pre>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-[8px] border-t border-white/[0.06] bg-[#1A1A1A] px-[16px] py-[12px]">
          {onClearLog ? (
            <button
              type="button"
              disabled={steps.length === 0}
              onClick={() => void onClearLog()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#2A2A2A] px-3 py-2 text-[12px] font-semibold text-[#FD2F3B] transition hover:bg-[#333333] disabled:opacity-40"
            >
              <Trash2 size={14} />
              <span>Limpar histórico gravado</span>
            </button>
          ) : (
            <span />
          )}

          {onAttachRecordedTask && (
            <button
              type="button"
              disabled={steps.length === 0}
              onClick={() => void onAttachRecordedTask(summary)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#F0F0F0] px-4 py-2 text-[12px] font-semibold text-[#141414] transition hover:bg-white disabled:opacity-40"
            >
              <FileText size={14} />
              <span>Anexar fluxo gravado</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
