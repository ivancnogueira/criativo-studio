import React, { useEffect, useState } from "react";
import type { DeletedNativeAgentInfo, StudioUserSettings } from "@criativo/contracts";
import { Check, LayoutTemplate, Palette, RotateCcw, Sliders } from "lucide-react";
import { CarbonSelect, type CarbonSelectOption } from "../../components/ui/CarbonControls";
import { getCriativoDesktopBridge } from "../../types/desktop-bridge";
import { computeBubbleColors, OPERATOR_BUBBLE_SWATCHES } from "../chat/chat-bubble-theme";

const ACCENT_COLORS = [
  { hex: "#007CF7", label: "Azul Carbon" },
  { hex: "#31CF76", label: "Verde Estúdio" },
  { hex: "#8B5CF6", label: "Violeta Studio" },
  { hex: "#EC4899", label: "Magenta" },
  { hex: "#FF9412", label: "Âmbar" },
] as const;

const UI_FONT_OPTIONS: CarbonSelectOption[] = [
  { value: "Inter", label: "Inter", description: "Tipografia padrão do Carbon Dark" },
  { value: "System UI", label: "System UI", description: "Fonte nativa do sistema operacional" },
  { value: "Plus Jakarta Sans", label: "Plus Jakarta Sans", description: "Geométrica editorial" },
];

const CODE_FONT_OPTIONS: CarbonSelectOption[] = [
  { value: "JetBrains Mono", label: "JetBrains Mono", description: "Ligaduras técnicas nítidas" },
  { value: "Fira Code", label: "Fira Code", description: "Monospace compacta" },
  { value: "Monospace", label: "Monospace", description: "Monospace padrão do navegador" },
];

const LANGUAGE_OPTIONS: CarbonSelectOption[] = [
  { value: "pt-BR", label: "Português (BR)" },
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
];

function ToggleRow({
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

export interface SettingsAppearanceTabProps {
  aparencia: StudioUserSettings["aparencia"];
  onChange: (next: StudioUserSettings["aparencia"]) => void;
}

export const SettingsAppearanceTab: React.FC<SettingsAppearanceTabProps> = ({
  aparencia,
  onChange,
}) => {
  const [desktopDockState, setDesktopDockState] = useState<{
    available: boolean;
    visible: boolean;
    pinned: boolean;
  }>({ available: false, visible: true, pinned: true });

  useEffect(() => {
    const bridge = getCriativoDesktopBridge();
    if (!bridge?.dockGetState) return;
    void bridge.dockGetState().then((st) => {
      setDesktopDockState({
        available: true,
        visible: Boolean(st?.visible),
        pinned: st?.pinned !== false,
      });
    });
  }, []);

  const opPalette = computeBubbleColors(aparencia.cor_balao_usuario, "#2A2A2A");

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/[0.06] bg-[#212121] p-4 space-y-3">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-white">
          <Palette className="h-4 w-4 text-[#42A0FF]" />
          <span>Tema da interface</span>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          {[
            { id: "carbon_dark" as const, label: "Carbon Dark #1A1A1A", preview: "#1A1A1A" },
            { id: "midnight_contrast" as const, label: "Contraste #0D0D0D", preview: "#0D0D0D" },
            { id: "light" as const, label: "Claro", preview: "#F5F5F7" },
          ].map((theme) => {
            const selected = aparencia.tema === theme.id;
            return (
              <button
                key={theme.id}
                type="button"
                onClick={() => onChange({ ...aparencia, tema: theme.id })}
                className={`rounded-xl border p-2.5 text-left transition-colors ${
                  selected
                    ? "border-[#007CF7] bg-[#2A2A2A]"
                    : "border-white/[0.06] bg-[#141414] hover:bg-[#242424]"
                }`}
              >
                <div
                  className="h-8 w-full rounded-lg border border-white/10 mb-2"
                  style={{ backgroundColor: theme.preview }}
                />
                <div className="text-[11.5px] font-semibold text-white truncate">
                  {theme.label}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-[#212121] p-4 space-y-3">
        <div className="text-[13px] font-semibold text-white">Cor de destaque do estúdio</div>
        <div className="flex flex-wrap items-center gap-2.5">
          {ACCENT_COLORS.map((c) => {
            const active = aparencia.cor_acento.toUpperCase() === c.hex.toUpperCase();
            return (
              <button
                key={c.hex}
                type="button"
                aria-label={`Cor ${c.label}`}
                onClick={() => onChange({ ...aparencia, cor_acento: c.hex })}
                style={{ backgroundColor: c.hex }}
                className={`h-8 w-8 rounded-full flex items-center justify-center transition-transform ${
                  active ? "ring-2 ring-white scale-105" : "opacity-80 hover:opacity-100"
                }`}
              >
                {active && <Check className="h-4 w-4 text-white drop-shadow" />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-[#212121] p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[13px] font-semibold text-white">Cor do balão do operador</div>
            <div className="text-[11.5px] text-[#979797]">
              Define a cor das suas mensagens no chat. A cor dos balões de cada especialista é configurada no painel do agente.
            </div>
          </div>
          <span className="font-mono text-[11.5px] text-[#A8A8A8]">
            {(aparencia.cor_balao_usuario ?? "#2A2A2A").toUpperCase()}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {OPERATOR_BUBBLE_SWATCHES.map((c) => {
            const current = (aparencia.cor_balao_usuario ?? "#2A2A2A").toUpperCase();
            const active = current === c.hex.toUpperCase();
            return (
              <button
                key={c.hex}
                type="button"
                title={c.label}
                aria-label={`Balão operador ${c.label}`}
                onClick={() => onChange({ ...aparencia, cor_balao_usuario: c.hex })}
                style={{ backgroundColor: c.hex }}
                className={`h-8 w-8 rounded-full border border-white/15 flex items-center justify-center transition-transform ${
                  active ? "ring-2 ring-white scale-105" : "opacity-85 hover:opacity-100"
                }`}
              >
                {active && <Check className="h-4 w-4 text-white drop-shadow" />}
              </button>
            );
          })}
          <label
            title="Escolher cor personalizada"
            className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-[#141414] px-2.5 py-1 text-[11.5px] text-[#DCDCDC] cursor-pointer hover:border-white/30"
          >
            <span>Personalizada</span>
            <input
              type="color"
              aria-label="Cor personalizada do balão do operador"
              value={aparencia.cor_balao_usuario ?? "#2A2A2A"}
              onChange={(e) =>
                onChange({ ...aparencia, cor_balao_usuario: e.target.value.toUpperCase() })
              }
              className="h-5 w-5 rounded border-0 bg-transparent cursor-pointer"
            />
          </label>
        </div>

        <ToggleRow
          label="Mensagens do estúdio em blocos sólidos"
          description="Exibe cada bloco de resposta do especialista em balões arredondados coloridos com alto contraste."
          checked={aparencia.baloes_solidos !== false}
          onChange={(next) => onChange({ ...aparencia, baloes_solidos: next })}
        />

        <div className="rounded-xl border border-white/[0.06] bg-[#141414] p-3 space-y-2">
          <div className="flex justify-end">
            <div
              style={{
                backgroundColor: opPalette.backgroundColor,
                color: opPalette.textColor,
                borderColor: opPalette.borderColor,
              }}
              className="rounded-[18px] border px-3.5 py-1.5 text-[12px] font-medium"
            >
              Prévia da sua mensagem no chat
            </div>
          </div>
          <div className="flex justify-start">
            <div
              className={
                aparencia.baloes_solidos !== false
                  ? "rounded-[18px] bg-[#166534] border border-white/10 px-3.5 py-1.5 text-[12px] text-white"
                  : "px-1 text-[12px] text-[#DCDCDC]"
              }
            >
              Resposta do especialista em bloco com cor configurável
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-[#212121] p-4 space-y-2.5">
        <div className="text-[13px] font-semibold text-white">Escala da interface</div>
        <div className="grid grid-cols-5 gap-1.5">
          {([80, 90, 100, 110, 120] as const).map((pct) => (
            <button
              key={pct}
              type="button"
              onClick={() => onChange({ ...aparencia, escala: pct })}
              className={`rounded-lg border py-1.5 text-[12px] font-semibold tabular-nums transition-colors ${
                aparencia.escala === pct
                  ? "border-[#007CF7] bg-[#007CF7]/15 text-white"
                  : "border-white/[0.06] bg-[#141414] text-[#979797] hover:text-white"
              }`}
            >
              {pct}%
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-xl border border-white/[0.06] bg-[#212121] p-4">
        <div className="space-y-1.5">
          <span className="block text-[12px] font-medium text-[#DCDCDC]">Fonte de interface</span>
          <CarbonSelect
            ariaLabel="Selecionar fonte de interface"
            value={aparencia.fonte_interface}
            options={UI_FONT_OPTIONS}
            onChange={(v) => onChange({ ...aparencia, fonte_interface: v })}
          />
        </div>
        <div className="space-y-1.5">
          <span className="block text-[12px] font-medium text-[#DCDCDC]">Fonte de código</span>
          <CarbonSelect
            ariaLabel="Selecionar fonte de código"
            value={aparencia.fonte_codigo}
            options={CODE_FONT_OPTIONS}
            onChange={(v) => onChange({ ...aparencia, fonte_codigo: v })}
          />
        </div>
        <div className="space-y-1.5">
          <span className="block text-[12px] font-medium text-[#DCDCDC]">Idioma</span>
          <CarbonSelect
            ariaLabel="Selecionar idioma da interface"
            value={aparencia.idioma}
            options={LANGUAGE_OPTIONS}
            onChange={(v) =>
              onChange({ ...aparencia, idioma: v as StudioUserSettings["aparencia"]["idioma"] })
            }
          />
        </div>
      </div>

      {desktopDockState.available && (
        <div className="space-y-3" data-testid="desktop-dock-settings-card">
          <ToggleRow
            label="Ilha flutuante de agentes na área de trabalho"
            description="Mantém o acesso rápido aos agentes flutuando sobre outros aplicativos no Desktop."
            checked={desktopDockState.visible}
            onChange={(next) => {
              setDesktopDockState((prev) => ({ ...prev, visible: next }));
              void getCriativoDesktopBridge()?.dockSetVisible?.(next);
            }}
          />
          <ToggleRow
            label="Recolher ilha flutuante na borda da tela"
            description="Quando ativa, a ilha recolhe para uma aba discreta na lateral e abre ao passar o mouse."
            checked={!desktopDockState.pinned}
            onChange={(autoHide) => {
              const nextPinned = !autoHide;
              setDesktopDockState((prev) => ({ ...prev, pinned: nextPinned }));
              void getCriativoDesktopBridge()?.dockSetPinned?.(nextPinned);
            }}
          />
        </div>
      )}
    </div>
  );
};

export interface SettingsBehaviorTabProps {
  comportamento: StudioUserSettings["comportamento"];
  onChange: (next: StudioUserSettings["comportamento"]) => void;
}

export const SettingsBehaviorTab: React.FC<SettingsBehaviorTabProps> = ({
  comportamento,
  onChange,
}) => {
  return (
    <div className="space-y-4">
      <ToggleRow
        label="Restaurar última aba ao abrir"
        description="Reabre automaticamente o último agente ou equipe selecionado no navegador."
        checked={comportamento.restaurar_ultima_aba}
        onChange={(next) => onChange({ ...comportamento, restaurar_ultima_aba: next })}
      />

      <ToggleRow
        label="Exibir Barra de Pulso"
        description="Mantém a cápsula superior com abas rápidas e status ao vivo dos agentes."
        checked={comportamento.exibir_dynamic_island}
        onChange={(next) => onChange({ ...comportamento, exibir_dynamic_island: next })}
      />

      <div className="rounded-xl border border-white/[0.06] bg-[#212121] p-4 space-y-2.5">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-white">
          <LayoutTemplate className="h-4 w-4 text-[#42A0FF]" />
          <span>Detalhe da Barra de Pulso</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[
            { id: "compacto" as const, label: "Compacto" },
            { id: "detalhado" as const, label: "Detalhado" },
          ].map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChange({ ...comportamento, detalhe_dynamic_island: opt.id })}
              className={`rounded-lg border px-3 py-2 text-[12px] font-semibold transition-colors ${
                comportamento.detalhe_dynamic_island === opt.id
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
        label="Habilitar drawer rápido de agentes"
        description="Exibe barra flutuante recolhível com até 6 agentes fixados para troca em 1 clique."
        checked={comportamento.habilitar_drawer_rapido}
        onChange={(next) => onChange({ ...comportamento, habilitar_drawer_rapido: next })}
      />
    </div>
  );
};
