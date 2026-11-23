import {
  Crown,
  MessageSquare,
  PanelLeft,
  PanelRightClose,
  PanelRightOpen,
  Search,
  Settings,
  Users,
  Workflow,
  X,
} from "lucide-react";
import {
  inferTaskContextFromActivity,
  MascoteAvatar,
  resolveAgentAvatarConfig,
  type AvatarTaskContext,
  type MascotEyeMood,
} from "../../components/MascoteAvatar";
import { AgentRoutinesSettings } from "../../features/routines/AgentRoutinesSettings";
import { RoutineFlowsCanvas } from "../../features/routines/RoutineFlowsCanvas";
import { DEFAULT_INSPECTOR_WIDTH, DEFAULT_SIDEBAR_WIDTH, getAgentAvatar, getThreadLaneKey, INSPECTOR_WIDTH_KEY, mergeUniqueMessages, SIDEBAR_WIDTH_KEY, writeStoredWidth } from "../../utils/studio-storage";
import type { StudioUiCtx } from "./studio-ui-ctx";

export function StudioRoutinesWorkspace({ ctx }: { ctx: StudioUiCtx }) {
  const { state, boot, nav, derived } = ctx;
  const {
    activeSection,
    setActiveSection,
    agentes,
    canais,
    setSidebarViewMode,
    routineCountsByAgent,
    setRoutinesRefreshNonce,
    flowRefreshNonce,
    setFlowRefreshNonce,
    setActiveSideThreadId,
    routinesAgentId,
    setRoutinesAgentId,
    routinesAgentSearch,
    setRoutinesAgentSearch,
    routinesSelectedRoutineId,
    setRoutinesSelectedRoutineId,
    routinesRightOpen,
    setRoutinesRightOpen,
    agentDockPinned,
  } = state;
  const { refreshRoutineCounts } = boot;

  const { handleSelectAgent, handleSelectChannel } = nav;
  const { activeAgent } = derived;

  return (
    <>
          {activeSection === "rotinas" && (() => {
            const unlockedAgents = agentes.filter(
              (a) =>
                a.agente_id !== "assistente_setup" &&
                a.agente_id !== "assistente_servidor_vps" &&
                (a.config as Record<string, unknown>)?.upgrade_desbloqueado !== false
            );
            const poolAgents = unlockedAgents.length > 0 ? unlockedAgents : agentes;
            const query = routinesAgentSearch.trim().toLowerCase();
            const visibleAgents = query
              ? poolAgents.filter(
                  (a) =>
                    a.nome.toLowerCase().includes(query) ||
                    (a.papel ?? "").toLowerCase().includes(query)
                )
              : poolAgents;
            const selectedRoutineAgent =
              poolAgents.find((a) => a.agente_id === routinesAgentId) ??
              poolAgents.find((a) => a.agente_id === activeAgent?.agente_id) ??
              poolAgents[0] ??
              null;

            return (
              <div className="flex-1 min-w-0 flex overflow-hidden bg-[#0F0F11]">
                {/* Lista lateral de agentes para navegação entre rotinas */}
                <aside className="w-[264px] shrink-0 border-r border-white/[0.06] bg-[#141416] flex flex-col overflow-hidden">
                  <div className="px-4 py-3.5 border-b border-white/[0.06]">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Workflow className="h-4 w-4 text-[#42A0FF]" />
                        <h2 className="text-[13.5px] font-semibold text-[#F4F4F5]">Rotinas</h2>
                      </div>
                      <span className="rounded-md bg-white/[0.06] px-2 py-0.5 text-[10.5px] font-semibold text-[#A1A1AA]">
                        {Object.values(routineCountsByAgent).reduce((acc, n) => acc + n, 0)} ativas
                      </span>
                    </div>
                    <p className="mt-1 text-[11.5px] text-[#7A7A85]">
                      Automações e gatilhos organizados por especialista.
                    </p>
                    <div className="mt-2.5 relative">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#7A7A85]" />
                      <input
                        type="text"
                        value={routinesAgentSearch}
                        onChange={(e) => setRoutinesAgentSearch(e.target.value)}
                        placeholder="Filtrar Criativos..."
                        className="w-full rounded-lg border border-white/[0.08] bg-[#1B1B1F] pl-8 pr-3 py-1.5 text-[12px] text-[#E4E4E7] placeholder:text-[#6B6B76] focus:border-[#42A0FF]/50 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
                    {visibleAgents.length === 0 ? (
                      <div className="px-3 py-6 text-center text-[12px] text-[#7A7A85]">
                        Nenhum Criativo encontrado para "{routinesAgentSearch}".
                      </div>
                    ) : (
                      visibleAgents.map((ag) => {
                        const isSelected = selectedRoutineAgent?.agente_id === ag.agente_id;
                        const count = routineCountsByAgent[ag.agente_id] ?? 0;
                        const av = getAgentAvatar(ag);
                        return (
                          <button
                            key={ag.agente_id}
                            type="button"
                            onClick={() => {
                              setRoutinesAgentId(ag.agente_id);
                              setRoutinesSelectedRoutineId(null);
                            }}
                            className={`w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition ${
                              isSelected
                                ? "bg-white/[0.09] text-[#F4F4F5] ring-1 ring-white/[0.12]"
                                : "text-[#B4B4BE] hover:bg-white/[0.04] hover:text-[#F4F4F5]"
                            }`}
                          >
                            <MascoteAvatar
                              avatar={av}
                              agentKey={ag.agente_id}
                              size={26}
                              label={ag.nome}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[12.5px] font-medium">{ag.nome}</div>
                              <div className="truncate text-[10.5px] text-[#7A7A85]">
                                {ag.papel ?? "Especialista"}
                              </div>
                            </div>
                            {count > 0 && (
                              <span
                                className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold ${
                                  isSelected
                                    ? "bg-[#42A0FF]/20 text-[#60B4FF]"
                                    : "bg-white/[0.06] text-[#9E9EA8]"
                                }`}
                              >
                                {count}
                              </span>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                </aside>

                {/* Canvas central de fluxos de rotina */}
                <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
                  {selectedRoutineAgent ? (
                    <>
                      <div className="h-[46px] shrink-0 border-b border-white/[0.06] bg-[#141416] px-4 flex items-center justify-between gap-3">
                        <div className="min-w-0 flex items-center gap-2.5">
                          <MascoteAvatar
                            avatar={getAgentAvatar(selectedRoutineAgent)}
                            agentKey={selectedRoutineAgent.agente_id}
                            size={24}
                            label={selectedRoutineAgent.nome}
                          />
                          <div className="min-w-0">
                            <div className="truncate text-[13px] font-semibold text-[#F4F4F5]">
                              {selectedRoutineAgent.nome}
                            </div>
                          </div>
                          <span className="rounded-md bg-white/[0.06] px-2 py-0.5 text-[10.5px] text-[#9E9EA8]">
                            {routineCountsByAgent[selectedRoutineAgent.agente_id] ?? 0} rotina(s)
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setActiveSection("agentes");
                              setSidebarViewMode("agents");
                              handleSelectAgent(selectedRoutineAgent.agente_id);
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#1E1E22] px-2.5 py-1 text-[11.5px] font-medium text-[#DCDCDC] hover:bg-[#27272C]"
                          >
                            <MessageSquare className="h-3.5 w-3.5 text-[#42A0FF]" />
                            <span>Abrir chat</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setRoutinesRightOpen((o) => !o)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#1E1E22] px-2.5 py-1 text-[11.5px] font-medium text-[#DCDCDC] hover:bg-[#27272C]"
                          >
                            {routinesRightOpen ? (
                              <>
                                <PanelRightClose className="h-3.5 w-3.5 text-[#9E9EA8]" />
                                <span>Ocultar painel</span>
                              </>
                            ) : (
                              <>
                                <PanelRightOpen className="h-3.5 w-3.5 text-[#42A0FF]" />
                                <span>Configurar rotinas</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      <div className="flex-1 min-h-0 flex overflow-hidden">
                        <RoutineFlowsCanvas
                          agente={selectedRoutineAgent}
                          allAgentes={agentes}
                          refreshSignal={flowRefreshNonce}
                          onOpenRoutineSettings={(rotinaId) => {
                            setRoutinesSelectedRoutineId(rotinaId ?? "__new__");
                            setRoutinesRightOpen(true);
                          }}
                          onOpenAgentChat={(agenteId) => {
                            setActiveSection("agentes");
                            setSidebarViewMode("agents");
                            handleSelectAgent(agenteId);
                          }}
                        />

                        {routinesRightOpen && (
                          <div
                            data-testid="routines-right-panel"
                            className={`w-[380px] xl:w-[420px] shrink-0 border-l border-white/[0.06] bg-[#141416] flex flex-col min-h-0 overflow-y-auto px-5 py-5 pb-12 ${
                              agentDockPinned ? "pr-16" : ""
                            }`}
                          >
                            <AgentRoutinesSettings
                              key={selectedRoutineAgent.agente_id}
                              ownerKind="agente"
                              ownerId={selectedRoutineAgent.agente_id}
                              ownerName={selectedRoutineAgent.nome}
                              canais={canais}
                              initialSelectedRoutineId={routinesSelectedRoutineId}
                              onBackToHub={() => setRoutinesSelectedRoutineId(null)}
                              onOpenThreadOrChat={(canalId) => {
                                setActiveSection("agentes");
                                setSidebarViewMode("agents");
                                if (canalId.startsWith("rotina:")) {
                                  setActiveSideThreadId(canalId);
                                } else if (canalId.startsWith("agente:")) {
                                  handleSelectAgent(canalId.slice("agente:".length));
                                } else {
                                  handleSelectChannel(canalId);
                                }
                              }}
                              onRoutinesChanged={() => {
                                void refreshRoutineCounts();
                                setRoutinesRefreshNonce((n) => n + 1);
                                setFlowRefreshNonce((n) => n + 1);
                              }}
                            />
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-[13px] text-[#7A7A85]">
                      Nenhum Criativo disponível para configurar rotinas.
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
    </>
  );
}
