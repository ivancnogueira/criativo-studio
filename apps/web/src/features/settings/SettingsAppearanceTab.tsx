import React, {
  useEffect,
  useState,
} from "react";
import type {
  ExternalThemePalette,
  StudioBackdropId,
  StudioUserSettings,
} from "@criativo/contracts";
import {
  Check,
  Palette,
  RefreshCw,
  Upload,
} from "lucide-react";
import {
  StudioColorPicker,
} from "../../components/StudioColorPicker";
import {
  CarbonSelect,
  type CarbonSelectOption,
} from "../../components/ui/CarbonControls";
import { daemonApi } from "../../services/websocket-client";
import { applyExternalThemePalette, clearExternalThemeTokens } from "../../theme/theme-palette";
import {
  getCriativoDesktopBridge,
} from "../../types/desktop-bridge";
import {
  computeBubbleColors,
  OPERATOR_BUBBLE_SWATCHES,
} from "../chat/chat-bubble-theme";
import { ACCENT_COLORS, UI_FONT_OPTIONS, CODE_FONT_OPTIONS, LANGUAGE_OPTIONS, ToggleRow } from "./SettingsGeneralTab";
import { useI18n } from "../../i18n/I18nContext";

const BACKDROP_OPTIONS: CarbonSelectOption<StudioBackdropId>[] = [
  { value: "none", label: "Sem backdrop (Carbono Puro)" },
  { value: "nebula", label: "Nebula Azul/Violeta Sutil" },
  { value: "grid_soft", label: "Grade Técnica Discreta" },
  { value: "warm_amber", label: "Âmbar Quente Cinematográfico" },
];

export interface SettingsAppearanceTabProps {
  aparencia: StudioUserSettings["aparencia"];
  onChange: (next: StudioUserSettings["aparencia"]) => void;
  initialExternalThemes?: ExternalThemePalette[];
}

export const SettingsAppearanceTab: React.FC<SettingsAppearanceTabProps> = ({
  aparencia,
  onChange,
  initialExternalThemes = [],
}) => {
  const { t } = useI18n();
  const [externalThemes, setExternalThemes] = useState<ExternalThemePalette[]>(initialExternalThemes);
  const [themeFeedback, setThemeFeedback] = useState<string | null>(null);
  const [desktopDockState, setDesktopDockState] = useState<{
    available: boolean;
    visible: boolean;
    pinned: boolean;
  }>({ available: false, visible: true, pinned: true });

  useEffect(() => {
    const bridge = getCriativoDesktopBridge();
    if (bridge?.dockGetState) {
      void bridge.dockGetState().then((st) => {
        setDesktopDockState({
          available: true,
          visible: Boolean(st?.visible),
          pinned: st?.pinned !== false,
        });
      });
    }
    if (initialExternalThemes.length === 0) {
      void daemonApi
        .listExternalThemes()
        .then((res) => setExternalThemes(res.themes ?? []))
        .catch(() => {});
    }
  }, [initialExternalThemes.length]);

  const themeOptions: CarbonSelectOption<string>[] = [
    { value: "", label: "Usar tema nativo padrão" },
    ...externalThemes.map((item) => ({
      value: item.id,
      label: `${item.name} (${item.base === "light" ? "Claro" : "Escuro"})`,
    })),
  ];

  const handleImportThemeFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const content = await file.text();
      const res = await daemonApi.importExternalTheme(content);
      setExternalThemes(res.themes);
      applyExternalThemePalette(res.theme);
      onChange({
        ...aparencia,
        tema_externo_id: res.theme.id,
        backdrop_id: res.theme.backdrop ?? aparencia.backdrop_id ?? "none",
      });
      setThemeFeedback(`Tema '${res.theme.name}' importado e aplicado.`);
    } catch (err) {
      setThemeFeedback(err instanceof Error ? err.message : "Falha ao importar JSON de tema.");
    }
  };

  const opPalette = computeBubbleColors(aparencia.cor_balao_usuario, "#2A2A2A");

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/[0.06] bg-[#212121] p-4 space-y-3">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-white">
          <Palette className="h-4 w-4 text-[var(--studio-accent,#B9FC01)]" />
          <span>{t("settings.appearance.theme")}</span>
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
                    ? "border-[var(--studio-accent,#B9FC01)] bg-[#2A2A2A]"
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
        <div className="text-[13px] font-semibold text-white">{t("settings.appearance.accent")}</div>
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
                {active && (
                  <Check
                    className={`h-4 w-4 ${
                      c.hex.toUpperCase() === "#B9FC01" ? "text-[#0D0D0D]" : "text-white drop-shadow"
                    }`}
                  />
                )}
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
                {active && (
                  <Check
                    className={`h-4 w-4 ${
                      c.hex.toUpperCase() === "#B9FC01" ? "text-[#0D0D0D]" : "text-white drop-shadow"
                    }`}
                  />
                )}
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
          <span className="block text-[12px] font-medium text-[#DCDCDC]">{t("settings.appearance.language")}</span>
          <CarbonSelect
            ariaLabel={t("settings.appearance.language")}
            value={aparencia.idioma}
            options={LANGUAGE_OPTIONS}
            onChange={(v) =>
              onChange({ ...aparencia, idioma: v as StudioUserSettings["aparencia"]["idioma"] })
            }
          />
          <span className="block text-[10.5px] text-[#8E8E8E]">
            {t("settings.appearance.languageDesc")}
          </span>
        </div>
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-[#212121] p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[13px] font-semibold text-white">
              Temas Externos JSON (Hot-Reload) & Backdrop
            </div>
            <div className="text-[11.5px] text-[#979797]">
              Carrega arquivos JSON de <code className="text-[#DCDCDC]">dados/themes/</code> com atualização ao vivo.
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                void daemonApi
                  .reloadExternalThemes()
                  .then((res) => {
                    setExternalThemes(res.themes);
                    setThemeFeedback(`${res.themes.length} tema(s) recarregado(s).`);
                  })
                  .catch(() => {});
              }}
              className="inline-flex items-center gap-1 rounded-lg bg-[#2A2A2A] hover:bg-[#333336] px-2.5 py-1 text-[11px] text-[#DCDCDC]"
            >
              <RefreshCw className="h-3 w-3" />
              <span>Recarregar</span>
            </button>
            <label className="inline-flex items-center gap-1 rounded-lg bg-[#007CF7]/20 hover:bg-[#007CF7]/30 border border-[#007CF7]/40 px-2.5 py-1 text-[11px] font-medium text-[#42A0FF] cursor-pointer">
              <Upload className="h-3 w-3" />
              <span>Importar JSON</span>
              <input
                type="file"
                accept=".json,application/json"
                onChange={(e) => void handleImportThemeFile(e)}
                className="hidden"
              />
            </label>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <span className="block text-[12px] font-medium text-[#DCDCDC]">Tema JSON externo</span>
            <CarbonSelect
              ariaLabel="Selecionar tema JSON externo"
              value={aparencia.tema_externo_id ?? ""}
              options={themeOptions}
              onChange={(val) => {
                const selected = externalThemes.find((x) => x.id === val) ?? null;
                if (selected) applyExternalThemePalette(selected);
                else clearExternalThemeTokens();
                onChange({ ...aparencia, tema_externo_id: val || null });
              }}
            />
          </div>
          <div className="space-y-1.5">
            <span className="block text-[12px] font-medium text-[#DCDCDC]">Backdrop do estúdio</span>
            <CarbonSelect
              ariaLabel="Selecionar backdrop do estúdio"
              value={(aparencia.backdrop_id as StudioBackdropId) || "none"}
              options={BACKDROP_OPTIONS}
              onChange={(val) => onChange({ ...aparencia, backdrop_id: val })}
            />
          </div>
        </div>
        {themeFeedback && (
          <div className="text-[11px] text-[#42A0FF]">{themeFeedback}</div>
        )}
      </div>

      {desktopDockState.available && (
        <div className="space-y-3" data-testid="desktop-dock-settings-card">
          <ToggleRow
            label="Translucidez nativa da janela (Desktop)"
            description="Aplica efeito acrílico/vibrancy na janela principal do aplicativo Desktop."
            checked={Boolean(aparencia.desktop_vibrancy)}
            onChange={(next) => {
              onChange({ ...aparencia, desktop_vibrancy: next });
              void getCriativoDesktopBridge()?.setWindowVibrancy?.(next);
            }}
          />
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

