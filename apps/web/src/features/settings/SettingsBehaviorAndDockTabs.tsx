import React, {
  useEffect,
  useState,
} from "react";
import type {
  AgenteRegistro,
  StudioDockSettings,
  StudioUserSettings,
} from "@criativo/contracts";
import {
  LayoutTemplate,
} from "lucide-react";
import {
  MascoteAvatar,
  resolveAgentAvatarConfig,
} from "../../components/MascoteAvatar";
import {
  CarbonSelect,
  type CarbonSelectOption,
} from "../../components/ui/CarbonControls";
import {
  getCriativoDesktopBridge,
} from "../../types/desktop-bridge";
import { ToggleRow } from "./SettingsGeneralTab";

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

export const DEFAULT_FRONTEND_DOCK_SETTINGS: StudioDockSettings = {
  mostrar_dock: true,
  posicao: "sobre_outros_apps",
  tela: "principal",
  borda: "right",
  tamanho_percentual: 100,
  ocultar_quando_inativo: false,
  mostrar_faixa_borda: true,
  mostrar_trabalho_concluido: true,
  mostrar_agentes_com_novidades: false,
  agentes_ids: null,
};

export function resolveEffectiveDockAgentIds(
  agentes: ReadonlyArray<AgenteRegistro & { nao_lidas?: number }>,
  explicitIds: ReadonlyArray<string> | null | undefined,
  pinnedIds: ReadonlyArray<string> = [],
): string[] {
  const unlocked = agentes.filter(
    (a) =>
      !a.hidden &&
      (a.config as Record<string, unknown> | undefined)?.upgrade_desbloqueado !== false,
  );
  const pool = unlocked.length > 0 ? unlocked : [...agentes];
  const validIds = new Set(pool.map((a) => a.agente_id));

  if (Array.isArray(explicitIds)) {
    return explicitIds.filter((id) => validIds.has(id));
  }

  const fromPins = pinnedIds.filter((id) => validIds.has(id));
  if (fromPins.length > 0) {
    return fromPins.slice(0, 6);
  }
  return pool.slice(0, 6).map((a) => a.agente_id);
}

const DOCK_POSITION_OPTIONS: CarbonSelectOption<StudioDockSettings["posicao"]>[] = [
  {
    value: "sobre_outros_apps",
    label: "Sobre outros apps",
    description: "Mantém o dock visível mesmo quando o Criativo AI Studio está em segundo plano",
  },
  {
    value: "apenas_janela",
    label: "Apenas na janela do estúdio",
    description: "Exibe o dock somente quando a janela principal do estúdio está em uso",
  },
];

const DOCK_EDGE_OPTIONS: CarbonSelectOption<StudioDockSettings["borda"]>[] = [
  { value: "right", label: "Direita" },
  { value: "left", label: "Esquerda" },
];

export interface SettingsDockTabProps {
  dock: StudioDockSettings;
  agentes: AgenteRegistro[];
  pinnedIds?: string[];
  activeServerName?: string;
  onChange: (next: StudioDockSettings) => void;
}

export const SettingsDockTab: React.FC<SettingsDockTabProps> = ({
  dock,
  agentes,
  pinnedIds = [],
  activeServerName = "Servidor Principal",
  onChange,
}) => {
  const [displays, setDisplays] = useState<Array<{ id: string; label: string; primary: boolean }>>([
    { id: "principal", label: "Tela principal", primary: true },
    { id: "secundaria", label: "Tela secundária", primary: false },
  ]);

  useEffect(() => {
    const bridge = getCriativoDesktopBridge();
    if (!bridge?.dockGetDisplays) return;
    void bridge
      .dockGetDisplays()
      .then((list) => {
        if (Array.isArray(list) && list.length > 0) {
          setDisplays(list);
        }
      })
      .catch(() => {});
  }, []);

  const displayOptions: CarbonSelectOption<string>[] = displays.map((d) => ({
    value: d.id,
    label: d.label,
  }));

  const safeDock: StudioDockSettings = {
    ...DEFAULT_FRONTEND_DOCK_SETTINGS,
    ...dock,
  };

  const applyPatch = (patch: Partial<StudioDockSettings>) => {
    const next: StudioDockSettings = { ...safeDock, ...patch };
    onChange(next);
    void getCriativoDesktopBridge()?.dockConfigure?.({
      visible: next.mostrar_dock,
      side: next.borda,
      pinned: !next.ocultar_quando_inativo,
      scalePercent: next.tamanho_percentual,
      alwaysOnTop: next.posicao === "sobre_outros_apps",
      displayId: next.tela,
    });
  };

  const eligibleAgents = agentes.filter(
    (a) => (a.config as Record<string, unknown> | undefined)?.upgrade_desbloqueado !== false,
  );
  const includedIds = resolveEffectiveDockAgentIds(eligibleAgents, safeDock.agentes_ids, pinnedIds);
  const includedSet = new Set(includedIds);

  const toggleAgentInDock = (agenteId: string, enabled: boolean) => {
    const baseIds = Array.isArray(safeDock.agentes_ids)
      ? [...safeDock.agentes_ids]
      : [...includedIds];
    const nextIds = enabled
      ? Array.from(new Set([...baseIds, agenteId]))
      : baseIds.filter((id) => id !== agenteId);
    applyPatch({ agentes_ids: nextIds });
  };

  return (
    <div className="space-y-6" data-testid="settings-dock-tab">
      <div className="space-y-2.5">
        <div className="px-0.5 text-[12px] font-semibold text-[#A8A8A8]">Comportamento</div>
        <div className="rounded-xl border border-white/[0.06] bg-[#212121] divide-y divide-white/[0.06]">
          <div className="flex items-center justify-between gap-4 px-4 py-3.5">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-white">Mostrar o dock de agentes</div>
              <div className="text-[11.5px] text-[#979797]">
                Mostra seus agentes na borda da tela, prontos para uma conversa rápida.
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={safeDock.mostrar_dock}
              aria-label="Mostrar o dock de agentes"
              onClick={() => applyPatch({ mostrar_dock: !safeDock.mostrar_dock })}
              className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border transition-colors ${
                safeDock.mostrar_dock
                  ? "border-[#007CF7] bg-[#007CF7]"
                  : "border-white/15 bg-[#141414]"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-3.5 w-3.5 translate-y-0.5 rounded-full bg-white transition-transform ${
                  safeDock.mostrar_dock ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between gap-4 px-4 py-3.5">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-white">Posição</div>
              <div className="text-[11.5px] text-[#979797]">
                &ldquo;Sobre outros apps&rdquo; mantém o dock na tela quando o Criativo AI Studio está em segundo plano.
              </div>
            </div>
            <div className="w-[215px] shrink-0">
              <CarbonSelect
                ariaLabel="Posição do dock de agentes"
                value={safeDock.posicao}
                options={DOCK_POSITION_OPTIONS}
                onChange={(val) => applyPatch({ posicao: val })}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 px-4 py-3.5">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-white">Tela</div>
              <div className="text-[11.5px] text-[#979797]">
                Se essa tela não estiver conectada, o dock vai para a tela da janela do Criativo AI Studio.
              </div>
            </div>
            <div className="w-[215px] shrink-0">
              <CarbonSelect
                ariaLabel="Tela do dock de agentes"
                value={safeDock.tela}
                options={displayOptions}
                onChange={(val) => applyPatch({ tela: val })}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 px-4 py-3.5">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-white">Borda da tela</div>
              <div className="text-[11.5px] text-[#979797]">
                Arraste o dock para cima ou para baixo para movê-lo pela borda.
              </div>
            </div>
            <div className="w-[155px] shrink-0">
              <CarbonSelect
                ariaLabel="Borda da tela do dock de agentes"
                value={safeDock.borda}
                options={DOCK_EDGE_OPTIONS}
                onChange={(val) => applyPatch({ borda: val })}
              />
            </div>
          </div>

          <div className="px-4 py-3.5 space-y-2.5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-white">Tamanho do dock</div>
                <div className="text-[11.5px] text-[#979797]">
                  Arraste para mudar o tamanho do dock sobre os outros apps. Na janela principal, o dock segue o tamanho da interface.
                </div>
              </div>
              <span className="text-[12.5px] font-semibold text-[#DCDCDC] tabular-nums shrink-0">
                {safeDock.tamanho_percentual}%
              </span>
            </div>
            <input
              type="range"
              aria-label="Tamanho do dock"
              min={80}
              max={150}
              step={1}
              value={safeDock.tamanho_percentual}
              onChange={(e) =>
                applyPatch({ tamanho_percentual: Number(e.target.value) || 100 })
              }
              className="w-full accent-[#E5E5E5] cursor-pointer"
            />
          </div>

          <div className="flex items-center justify-between gap-4 px-4 py-3.5">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-white">Ocultar quando não estiver em uso</div>
              <div className="text-[11.5px] text-[#979797]">
                O dock desliza para dentro da borda. Leve o ponteiro até a borda para mostrá-lo.
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={safeDock.ocultar_quando_inativo}
              aria-label="Ocultar quando não estiver em uso"
              onClick={() =>
                applyPatch({ ocultar_quando_inativo: !safeDock.ocultar_quando_inativo })
              }
              className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border transition-colors ${
                safeDock.ocultar_quando_inativo
                  ? "border-[#007CF7] bg-[#007CF7]"
                  : "border-white/15 bg-[#141414]"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-3.5 w-3.5 translate-y-0.5 rounded-full bg-white transition-transform ${
                  safeDock.ocultar_quando_inativo ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between gap-4 px-4 py-3.5">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-white">Mostrar uma faixa na borda</div>
              <div className="text-[11.5px] text-[#979797]">
                Uma faixa fina fica onde o dock se esconde. Aproxime o ponteiro para mostrar o dock. Uma onda de cor sobe pela faixa quando um agente pergunta algo.
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={safeDock.mostrar_faixa_borda}
              aria-label="Mostrar uma faixa na borda"
              onClick={() =>
                applyPatch({ mostrar_faixa_borda: !safeDock.mostrar_faixa_borda })
              }
              className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border transition-colors ${
                safeDock.mostrar_faixa_borda
                  ? "border-[#007CF7] bg-[#007CF7]"
                  : "border-white/15 bg-[#141414]"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-3.5 w-3.5 translate-y-0.5 rounded-full bg-white transition-transform ${
                  safeDock.mostrar_faixa_borda ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between gap-4 px-4 py-3.5">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-white">Mostrar trabalho concluído</div>
              <div className="text-[11.5px] text-[#979797]">
                Os resultados dos agentes aparecem por pouco tempo ao lado do dock.
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={safeDock.mostrar_trabalho_concluido}
              aria-label="Mostrar trabalho concluído"
              onClick={() =>
                applyPatch({
                  mostrar_trabalho_concluido: !safeDock.mostrar_trabalho_concluido,
                })
              }
              className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border transition-colors ${
                safeDock.mostrar_trabalho_concluido
                  ? "border-[#007CF7] bg-[#007CF7]"
                  : "border-white/15 bg-[#141414]"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-3.5 w-3.5 translate-y-0.5 rounded-full bg-white transition-transform ${
                  safeDock.mostrar_trabalho_concluido ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between gap-4 px-4 py-3.5">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-white">Mostrar agentes com novidades</div>
              <div className="text-[11.5px] text-[#979797]">
                Um agente ou equipe que não está no dock aparece nele enquanto tem uma nova mensagem ou espera por você.
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={safeDock.mostrar_agentes_com_novidades}
              aria-label="Mostrar agentes com novidades"
              onClick={() =>
                applyPatch({
                  mostrar_agentes_com_novidades: !safeDock.mostrar_agentes_com_novidades,
                })
              }
              className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border transition-colors ${
                safeDock.mostrar_agentes_com_novidades
                  ? "border-[#007CF7] bg-[#007CF7]"
                  : "border-white/15 bg-[#141414]"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-3.5 w-3.5 translate-y-0.5 rounded-full bg-white transition-transform ${
                  safeDock.mostrar_agentes_com_novidades ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-2.5">
        <div className="px-0.5">
          <div className="text-[12.5px] font-semibold text-white">Agentes no dock</div>
          <div className="text-[11.5px] text-[#979797]">
            Os agentes de {activeServerName}. Cada servidor tem seu próprio dock.
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-[#212121] divide-y divide-white/[0.06]">
          {eligibleAgents.length === 0 ? (
            <div className="px-4 py-4 text-[12px] text-[#979797]">
              Nenhum agente disponível neste servidor ainda.
            </div>
          ) : (
            eligibleAgents.map((ag) => {
              const included = includedSet.has(ag.agente_id);
              const vis = resolveAgentAvatarConfig(ag);
              return (
                <div
                  key={ag.agente_id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <MascoteAvatar
                      avatar={vis}
                      agentKey={ag.agente_id}
                      size={26}
                      hoverAnimate={false}
                    />
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-white truncate">{ag.nome}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={included}
                    aria-label={`Incluir ${ag.nome} no dock`}
                    onClick={() => toggleAgentInDock(ag.agente_id, !included)}
                    className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border transition-colors ${
                      included
                        ? "border-[#007CF7] bg-[#007CF7]"
                        : "border-white/15 bg-[#141414]"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-3.5 w-3.5 translate-y-0.5 rounded-full bg-white transition-transform ${
                        included ? "translate-x-4" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

