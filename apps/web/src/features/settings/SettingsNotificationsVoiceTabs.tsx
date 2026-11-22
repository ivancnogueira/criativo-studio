import React, { useEffect, useState } from "react";
import type {
  AgentNotificationLevel,
  AgenteRegistro,
  CanalEquipe,
  NativeNotificationLevel,
  StudioUserSettings,
  VoiceExecutionMode,
  VoiceHostStatusSnapshot,
} from "@criativo/contracts";
import { Bell, Mic, Volume2 } from "lucide-react";
import { CarbonSelect, type CarbonSelectOption } from "../../components/ui/CarbonControls";
import { daemonApi } from "../../services/websocket-client";

type SoundPreset = StudioUserSettings["notificacoes"]["som_tarefa"];

const SOUND_OPTIONS: CarbonSelectOption[] = [
  { value: "cristal", label: "Cristal" },
  { value: "suave", label: "Suave" },
  { value: "pulso", label: "Pulso" },
  { value: "silencio", label: "Silêncio" },
];

const DICTATION_OPTIONS: CarbonSelectOption[] = [
  { value: "web_speech", label: "Web Speech", description: "Reconhecimento nativo do navegador" },
  { value: "whisper", label: "Whisper API", description: "Alta precisão multilíngue" },
  { value: "gemini", label: "Gemini Audio", description: "Compreensão contextual avançada" },
];

const TTS_OPTIONS: CarbonSelectOption[] = [
  { value: "edge_tts", label: "Edge TTS", description: "Rápido e gratuito em pt-BR" },
  { value: "elevenlabs", label: "ElevenLabs", description: "Síntese expressiva configurada no Cofre" },
  { value: "fish_audio", label: "Fish Audio", description: "Baixa latência configurada no Cofre" },
];

const NATIVE_LEVEL_OPTIONS: CarbonSelectOption<NativeNotificationLevel>[] = [
  { value: "all", label: "Todas as notificações", description: "Aprovações, erros e entregas concluídas" },
  { value: "approvals_only", label: "Apenas aprovações", description: "Somente quando um agente aguarda revisão" },
  { value: "errors_only", label: "Apenas erros", description: "Falhas críticas e quedas de integração" },
  { value: "muted", label: "Silenciado", description: "Desativar notificações nativas do sistema" },
];

/**
 * Sintetiza prévia curta via Web Audio API sem depender de arquivos externos.
 */
export function playStudioPreviewSound(preset: SoundPreset): boolean {
  if (preset === "silencio") return false;
  if (typeof window === "undefined") return false;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return false;
  try {
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;

    if (preset === "cristal") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(1320, now + 0.14);
    } else if (preset === "suave") {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.16);
    } else {
      osc.type = "sine";
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(554.37, now + 0.12);
    }

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.24);
    osc.onended = () => {
      void ctx.close().catch(() => undefined);
    };
    return true;
  } catch {
    return false;
  }
}

function SwitchItem({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.06] bg-[#212121] px-4 py-3">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-white">{label}</div>
        <div className="text-[11.5px] text-[#979797]">{description}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border transition-colors ${
          checked ? "border-[#007CF7] bg-[#007CF7]" : "border-white/15 bg-[#141414]"
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-3.5 w-3.5 translate-y-0.5 rounded-full bg-white transition-transform ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

export interface NotificationMatrixProps {
  agentes: AgenteRegistro[];
  canais: CanalEquipe[];
  matriz: Record<string, AgentNotificationLevel>;
  onChangeLevel: (id: string, level: AgentNotificationLevel) => void;
}

export const NotificationMatrix: React.FC<NotificationMatrixProps> = ({
  agentes,
  canais,
  matriz,
  onChangeLevel,
}) => {
  const rows: Array<{ id: string; nome: string; kind: string }> = [
    ...agentes.map((a) => ({ id: a.agente_id, nome: a.nome, kind: "Agente" })),
    ...canais.map((c) => ({ id: `canal:${c.canal_id}`, nome: c.nome, kind: "Canal" })),
  ];

  const levels: Array<{ value: AgentNotificationLevel; label: string }> = [
    { value: "all", label: "Todas" },
    { value: "mentions", label: "Menções" },
    { value: "muted", label: "Silenciado" },
  ];

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#212121] p-4 space-y-2.5">
      <div className="text-[13px] font-semibold text-white">
        Matriz por agente e canal
      </div>
      <div className="max-h-56 overflow-y-auto divide-y divide-white/[0.06]">
        {rows.map((row) => {
          const current = matriz[row.id] ?? "all";
          return (
            <div
              key={row.id}
              className="py-2 flex flex-wrap items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <span className="text-[12.5px] font-medium text-white truncate block">
                  {row.nome}
                </span>
                <span className="text-[10.5px] text-[#6A6A6A]">{row.kind}</span>
              </div>
              <div className="inline-flex rounded-lg border border-white/[0.06] bg-[#141414] p-0.5 gap-0.5">
                {levels.map((lv) => (
                  <button
                    key={lv.value}
                    type="button"
                    onClick={() => onChangeLevel(row.id, lv.value)}
                    className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-colors ${
                      current === lv.value
                        ? "bg-[#2A2A2A] text-white"
                        : "text-[#979797] hover:text-white"
                    }`}
                  >
                    {lv.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export interface SettingsNotificationsTabProps {
  notificacoes: StudioUserSettings["notificacoes"];
  agentes: AgenteRegistro[];
  canais: CanalEquipe[];
  onChange: (next: StudioUserSettings["notificacoes"]) => void;
}

export const SettingsNotificationsTab: React.FC<SettingsNotificationsTabProps> = ({
  notificacoes,
  agentes,
  canais,
  onChange,
}) => {
  const [previewBanner, setPreviewBanner] = useState<string | null>(null);

  const handleToggleWeb = async (next: boolean) => {
    if (next && typeof Notification !== "undefined" && Notification.permission === "default") {
      try {
        await Notification.requestPermission();
      } catch {
        // Ignorado em contextos sem permissão interativa
      }
    }
    onChange({ ...notificacoes, web_habilitadas: next });
  };

  const handleTestNotification = () => {
    playStudioPreviewSound(notificacoes.som_tarefa);
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification("Criativo AI Studio", {
        body: notificacoes.mostrar_preview
          ? "Exemplo de notificação concluída com prévia visível."
          : "Nova notificação de tarefa concluída.",
      });
      setPreviewBanner("Notificação Web enviada com sucesso.");
      return;
    }
    setPreviewBanner(
      "Prévia local: Tarefa concluída no estúdio (permissão do navegador não concedida)."
    );
  };

  return (
    <div className="space-y-4">
      <SwitchItem
        label="Ativar notificações Web"
        description="Alerta quando agentes finalizam entregas ou solicitam intervenção no navegador."
        checked={notificacoes.web_habilitadas}
        onChange={(next) => void handleToggleWeb(next)}
      />

      <SwitchItem
        label="Mostrar prévia da mensagem"
        description="Exibe trecho da resposta nas notificações fora da aba ativa."
        checked={notificacoes.mostrar_preview}
        onChange={(next) => onChange({ ...notificacoes, mostrar_preview: next })}
      />

      <div className="rounded-xl border border-white/[0.06] bg-[#212121] p-4 space-y-2">
        <div className="text-[13px] font-semibold text-white">Notificações nativas do sistema (Desktop)</div>
        <div className="text-[11.5px] text-[#979797]">
          Define quando o app Electron envia alertas nativos com foco automático ao clicar.
        </div>
        <CarbonSelect<NativeNotificationLevel>
          ariaLabel="Nível de notificações nativas do sistema"
          value={notificacoes.notificacao_nativa_nivel ?? "all"}
          options={NATIVE_LEVEL_OPTIONS}
          onChange={(nextLevel) =>
            onChange({ ...notificacoes, notificacao_nativa_nivel: nextLevel })
          }
        />
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-[#212121] p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-white">
            <Bell className="h-4 w-4 text-[#42A0FF]" />
            <span>Alertas sonoros locais</span>
          </div>
          <button
            type="button"
            onClick={handleTestNotification}
            className="rounded-lg bg-[#2A2A2A] px-3 py-1.5 text-[12px] font-semibold text-[#F0F0F0] hover:bg-[#333333]"
          >
            Testar notificação
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <span className="block text-[12px] font-medium text-[#DCDCDC]">Som de Tarefa Concluída</span>
            <CarbonSelect
              ariaLabel="Som de Tarefa Concluída"
              value={notificacoes.som_tarefa}
              options={SOUND_OPTIONS}
              onChange={(v) => onChange({ ...notificacoes, som_tarefa: v as SoundPreset })}
            />
            <button
              type="button"
              onClick={() => playStudioPreviewSound(notificacoes.som_tarefa)}
              className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-[#141414] px-2.5 py-1 text-[11px] font-semibold text-[#42A0FF] hover:bg-[#242424]"
            >
              <Volume2 className="h-3 w-3" />
              <span>Ouvir prévia</span>
            </button>
          </div>

          <div className="space-y-1.5">
            <span className="block text-[12px] font-medium text-[#DCDCDC]">Som de Feedback</span>
            <CarbonSelect
              ariaLabel="Som de Feedback"
              value={notificacoes.som_feedback}
              options={SOUND_OPTIONS}
              onChange={(v) => onChange({ ...notificacoes, som_feedback: v as SoundPreset })}
            />
            <button
              type="button"
              onClick={() => playStudioPreviewSound(notificacoes.som_feedback)}
              className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-[#141414] px-2.5 py-1 text-[11px] font-semibold text-[#42A0FF] hover:bg-[#242424]"
            >
              <Volume2 className="h-3 w-3" />
              <span>Ouvir prévia</span>
            </button>
          </div>
        </div>

        {previewBanner && (
          <div className="rounded-lg border border-[#007CF7]/40 bg-[#007CF7]/10 px-3 py-2 text-[12px] text-[#42A0FF]">
            {previewBanner}
          </div>
        )}
      </div>

      <NotificationMatrix
        agentes={agentes}
        canais={canais}
        matriz={notificacoes.matriz}
        onChangeLevel={(id, level) =>
          onChange({
            ...notificacoes,
            matriz: { ...notificacoes.matriz, [id]: level },
          })
        }
      />
    </div>
  );
};

export interface SettingsVoiceTabProps {
  voz: StudioUserSettings["voz"];
  onChange: (next: StudioUserSettings["voz"]) => void;
}

const VOICE_MODE_OPTIONS: CarbonSelectOption[] = [
  { value: "auto", label: "Automático (Local com fallback Nuvem)" },
  { value: "local", label: "Local Isolado (Privado / Offline)" },
  { value: "cloud", label: "Nuvem (OpenAI / Gemini / ElevenLabs)" },
];

export const SettingsVoiceTab: React.FC<SettingsVoiceTabProps> = ({ voz, onChange }) => {
  const [hostStatus, setHostStatus] = useState<VoiceHostStatusSnapshot | null>(null);

  const reloadHost = () => {
    void daemonApi
      .getVoiceHostStatus()
      .then(setHostStatus)
      .catch(() => {});
  };

  useEffect(() => {
    reloadHost();
  }, []);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/[0.06] bg-[#212121] p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[13px] font-semibold text-white">
              Motor de Voz Local Isolado (STT/TTS Host)
            </div>
            <div className="text-[11.5px] text-[#979797]">
              Executa inferência local em processo filho dedicado com fallback automático para a nuvem.
            </div>
          </div>
          <span className="rounded-full bg-white/[0.06] px-2.5 py-0.5 text-[10.5px] text-[#DCDCDC]">
            {hostStatus?.running ? `Worker PID ${hostStatus.pid}` : "Sob demanda"}
          </span>
        </div>

        <CarbonSelect
          ariaLabel="Modo de execução do motor de voz"
          value={hostStatus?.mode ?? "auto"}
          options={VOICE_MODE_OPTIONS}
          onChange={(val) => {
            void daemonApi
              .updateVoiceHostMode({ mode: val as VoiceExecutionMode })
              .then(setHostStatus)
              .catch(() => {});
          }}
        />

        {hostStatus && hostStatus.models.length > 0 && (
          <div className="space-y-1.5 pt-1">
            {hostStatus.models.map((m) => (
              <div
                key={m.modelId}
                className="flex items-center justify-between gap-2 rounded-lg bg-[#141414] border border-white/[0.05] px-3 py-2 text-[11.5px]"
              >
                <div className="min-w-0">
                  <span className="text-white font-medium">{m.label}</span>
                  <span className="text-[#8E8E93] ml-2">
                    ({m.kind.toUpperCase()} · {m.sizeMb} MB)
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const op = m.installed
                      ? daemonApi.removeLocalVoiceModel(m.modelId)
                      : daemonApi.installLocalVoiceModel(m.modelId);
                    void op.then(() => reloadHost());
                  }}
                  className="rounded-md bg-[#2A2A2E] hover:bg-[#34343A] px-2.5 py-1 text-[11px] font-medium text-white"
                >
                  {m.installed ? "Remover" : "Instalar"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl border border-white/[0.06] bg-[#212121] p-4">
        <div className="space-y-1.5">
          <span className="block text-[12px] font-medium text-[#DCDCDC]">Provedor de ditado</span>
          <CarbonSelect
            ariaLabel="Provedor de ditado por voz"
            value={voz.provedor_ditado}
            options={DICTATION_OPTIONS}
            onChange={(v) =>
              onChange({
                ...voz,
                provedor_ditado: v as StudioUserSettings["voz"]["provedor_ditado"],
              })
            }
          />
        </div>
        <div className="space-y-1.5">
          <span className="block text-[12px] font-medium text-[#DCDCDC]">Síntese de voz (TTS)</span>
          <CarbonSelect
            ariaLabel="Modelo de síntese de voz TTS"
            value={voz.modelo_tts}
            options={TTS_OPTIONS}
            onChange={(v) =>
              onChange({
                ...voz,
                modelo_tts: v as StudioUserSettings["voz"]["modelo_tts"],
              })
            }
          />
        </div>
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-[#212121] p-4 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-[13px] font-semibold text-white">
            <Mic className="h-4 w-4 text-[#42A0FF]" />
            <span>Velocidade da fala</span>
          </span>
          <span className="font-mono text-[12px] text-[#42A0FF] tabular-nums">
            {voz.velocidade.toFixed(2)}x
          </span>
        </div>
        <input
          type="range"
          min={0.85}
          max={1.35}
          step={0.05}
          aria-label="Velocidade da fala TTS"
          value={voz.velocidade}
          onChange={(e) => onChange({ ...voz, velocidade: Number(e.target.value) })}
          className="w-full accent-[#007CF7]"
        />
      </div>

      <SwitchItem
        label="Leitura automática de respostas"
        description="Sintetiza e lê respostas do agente ativo automaticamente via SpeechSynthesis."
        checked={voz.leitura_automatica}
        onChange={(next) => onChange({ ...voz, leitura_automatica: next })}
      />

      <SwitchItem
        label="Voz Contínua Web (Live Voice)"
        description="Habilita sessão viva com detecção de silêncio VAD para conversar sem apertar botões."
        checked={voz.live_voice_habilitada}
        onChange={(next) => onChange({ ...voz, live_voice_habilitada: next })}
      />
    </div>
  );
};
