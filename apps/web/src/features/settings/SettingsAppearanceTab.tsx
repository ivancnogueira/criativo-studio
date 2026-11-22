import React, {
  useEffect,
  useState,
} from "react";
import type {
  StudioUserSettings,
} from "@criativo/contracts";
import {
  Check,
  Palette,
} from "lucide-react";
import {
  StudioColorPicker,
} from "../../components/StudioColorPicker";
import {
  CarbonSelect,
} from "../../components/ui/CarbonControls";
import {
  getCriativoDesktopBridge,
} from "../../types/desktop-bridge";
import {
  computeBubbleColors,
  OPERATOR_BUBBLE_SWATCHES,
} from "../chat/chat-bubble-theme";
import { ACCENT_COLORS, UI_FONT_OPTIONS, CODE_FONT_OPTIONS, LANGUAGE_OPTIONS, ToggleRow } from "./SettingsGeneralTab";

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

        <StudioColorPicker
          value={aparencia.cor_balao_usuario ?? "#2A2A2A"}
          onChange={(hex) => onChange({ ...aparencia, cor_balao_usuario: hex })}
          allowDefaultReset
          isDefaultSelected={(aparencia.cor_balao_usuario ?? "#2A2A2A").toUpperCase() === "#2A2A2A"}
          onResetDefault={() => onChange({ ...aparencia, cor_balao_usuario: "#2A2A2A" })}
          ariaLabelPrefix="Cor do balão do operador"
        />

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

