import React from "react";
import type {
  DeletedNativeAgentInfo,
  StudioUserSettings,
} from "@criativo/contracts";
import {
  RotateCcw,
  Sliders,
} from "lucide-react";
import {
  type CarbonSelectOption,
} from "../../components/ui/CarbonControls";
import { SettingsTelemetryCard } from "./SettingsTelemetryCard";

export const ACCENT_COLORS = [
  { hex: "#B9FC01", label: "Volt CriativoOS" },
  { hex: "#0031CC", label: "Royal Cobalt" },
  { hex: "#007CF7", label: "Azul Carbon" },
  { hex: "#31CF76", label: "Verde Estúdio" },
  { hex: "#8B5CF6", label: "Violeta Studio" },
  { hex: "#EC4899", label: "Magenta" },
  { hex: "#FF9412", label: "Âmbar" },
] as const;

export const UI_FONT_OPTIONS: CarbonSelectOption[] = [
  { value: "Inter", label: "Inter", description: "Tipografia padrão do Carbon Dark" },
  { value: "System UI", label: "System UI", description: "Fonte nativa do sistema operacional" },
  { value: "Plus Jakarta Sans", label: "Plus Jakarta Sans", description: "Geométrica editorial" },
];

export const CODE_FONT_OPTIONS: CarbonSelectOption[] = [
  { value: "JetBrains Mono", label: "JetBrains Mono", description: "Ligaduras técnicas nítidas" },
  { value: "Fira Code", label: "Fira Code", description: "Monospace compacta" },
  { value: "Monospace", label: "Monospace", description: "Monospace padrão do navegador" },
];

export const LANGUAGE_OPTIONS: CarbonSelectOption[] = [
  { value: "pt-BR", label: "Português (BR)" },
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
];

export function ToggleRow({
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
          checked
            ? "border-[#007CF7] bg-[#007CF7]"
            : "border-white/15 bg-[#141414]"
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

export interface SettingsGeneralTabProps {
  geral: StudioUserSettings["geral"];
  onChange: (next: StudioUserSettings["geral"]) => void;
  onReopenSetupAssistant?: () => Promise<void> | void;
  onResetLayoutWidths?: () => void;
  deletedNativeAgents?: DeletedNativeAgentInfo[];
  onRestoreDeletedAgent?: (agenteId: string) => Promise<void> | void;
  onRestoreAllDeletedAgents?: () => Promise<void> | void;
}

export const SettingsGeneralTab: React.FC<SettingsGeneralTabProps> = ({
  geral,
  onChange,
  onReopenSetupAssistant,
  onResetLayoutWidths,
  deletedNativeAgents = [],
  onRestoreDeletedAgent,
  onRestoreAllDeletedAgents,
}) => {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/[0.06] bg-[#212121] p-4 space-y-2.5">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-white">
          <Sliders className="h-4 w-4 text-[#42A0FF]" />
          <span>Atalho de envio no chat</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[
            { id: "enter" as const, label: "Tecla Enter" },
            { id: "mod_enter" as const, label: "Ctrl/⌘ + Enter" },
          ].map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChange({ ...geral, atalho_envio: opt.id })}
              className={`rounded-lg border px-3 py-2 text-[12px] font-semibold transition-colors ${
                geral.atalho_envio === opt.id
                  ? "border-[#007CF7] bg-[#007CF7]/15 text-white"
                  : "border-white/[0.06] bg-[#141414] text-[#979797] hover:text-white"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-[#212121] p-4 space-y-2.5">
        <div className="text-[13px] font-semibold text-white">Ordenação da barra lateral</div>
        <div className="grid grid-cols-3 gap-2">
          {[
            { id: "secoes" as const, label: "Por diretórios" },
            { id: "recente" as const, label: "Atividade recente" },
            { id: "alfabetica" as const, label: "Alfabética" },
          ].map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChange({ ...geral, ordenacao_sidebar: opt.id })}
              className={`rounded-lg border px-2.5 py-2 text-[12px] font-semibold transition-colors ${
                geral.ordenacao_sidebar === opt.id
                  ? "border-[#007CF7] bg-[#007CF7]/15 text-white"
                  : "border-white/[0.06] bg-[#141414] text-[#979797] hover:text-white"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <ToggleRow
        label="Exibir passos das ferramentas"
        description="Mostra os cards colapsáveis de etapas executadas pelos agentes durante o turno."
        checked={geral.exibir_passos_agente}
        onChange={(next) => onChange({ ...geral, exibir_passos_agente: next })}
      />

      <ToggleRow
        label="Ações compactas de mensagem"
        description="Reduz espaçamento dos botões do cabeçalho e ações inline nas conversas."
        checked={geral.acoes_compactas}
        onChange={(next) => onChange({ ...geral, acoes_compactas: next })}
      />

      <SettingsTelemetryCard
        optIn={Boolean(geral.telemetry_opt_in)}
        onChangeOptIn={(next) => onChange({ ...geral, telemetry_opt_in: next })}
      />

      {(onReopenSetupAssistant || onResetLayoutWidths) && (
        <div className="rounded-xl border border-white/[0.06] bg-[#212121] p-4 space-y-2.5">
          <div className="text-[13px] font-semibold text-white">Setup Inicial &amp; Colunas do Estúdio</div>
          <p className="text-[11.5px] text-[#979797]">
            Reabra o assistente guiado caso precise ajustar marca/arquivos/Instagram depois ou restaure a largura padrão das 3 colunas.
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {onReopenSetupAssistant && (
              <button
                type="button"
                onClick={() => void onReopenSetupAssistant()}
                className="rounded-lg border border-[#007CF7]/40 bg-[#007CF7]/15 px-3 py-1.5 text-[12px] font-semibold text-[#74B9FF] hover:bg-[#007CF7]/25"
              >
                Reabrir Assistente de Configuração
              </button>
            )}
            {onResetLayoutWidths && (
              <button
                type="button"
                onClick={() => onResetLayoutWidths()}
                className="rounded-lg border border-white/10 bg-[#141414] px-3 py-1.5 text-[12px] font-semibold text-[#DCDCDC] hover:bg-[#2A2A2A]"
              >
                Restaurar larguras padrão das colunas
              </button>
            )}
          </div>
        </div>
      )}

      {deletedNativeAgents.length > 0 && (onRestoreDeletedAgent || onRestoreAllDeletedAgents) && (
        <div
          data-testid="deleted-native-agents-card"
          className="rounded-xl border border-white/[0.06] bg-[#212121] p-4 space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[13px] font-semibold text-white">
                Agentes padrão excluídos ({deletedNativeAgents.length})
              </div>
              <p className="text-[11.5px] text-[#979797]">
                Estes especialistas nativos foram removidos por você e não voltarão automaticamente. Restaure quando desejar.
              </p>
            </div>
            {onRestoreAllDeletedAgents && (
              <button
                type="button"
                onClick={() => void onRestoreAllDeletedAgents()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#007CF7]/40 bg-[#007CF7]/15 px-3 py-1.5 text-[12px] font-semibold text-[#74B9FF] hover:bg-[#007CF7]/25 shrink-0"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Restaurar todos</span>
              </button>
            )}
          </div>
          <div className="space-y-1.5 max-h-44 overflow-y-auto">
            {deletedNativeAgents.map((ag) => (
              <div
                key={ag.agente_id}
                className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-[#141414] px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-[12.5px] font-semibold text-white truncate">{ag.nome}</p>
                  <p className="text-[11px] text-[#8E8E93] truncate">{ag.papel}</p>
                </div>
                {onRestoreDeletedAgent && (
                  <button
                    type="button"
                    onClick={() => void onRestoreDeletedAgent(ag.agente_id)}
                    className="rounded-lg bg-[#2A2A2A] px-2.5 py-1 text-[11.5px] font-semibold text-white hover:bg-[#353538] shrink-0"
                  >
                    Restaurar
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

