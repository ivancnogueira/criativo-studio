import {
  Check,
  ChevronDown,
} from "lucide-react";
import { CarbonSelect } from "../../components/ui/CarbonControls";
import { destinationKey, destinationDisplayLabel, type AgentRoutinesSettingsProps } from "./routine-settings-types";
import type { AgentRoutinesController } from "./useAgentRoutinesController";
import type { RoutineLimitPolicy, RoutineMissedPolicy } from "@criativo/contracts";

export function RoutinePoliciesAndDestinationFields({
  ctrl,
  props,
}: {
  ctrl: AgentRoutinesController;
  props: AgentRoutinesSettingsProps;
}) {
  
  const {
    draft,
    setDraft,
    destOptions,
    destMenuOpen,
    setDestMenuOpen,
    groupedDestinationSections,
  } = ctrl;

  return (
<>
      {/* Instrução da rotina */}
      <div className="space-y-1">
        <label
          htmlFor="routine-instruction-input"
          className="block text-[12px] font-semibold text-[#DCDCDC]"
        >
          Instrução da rotina
        </label>
        <textarea
          id="routine-instruction-input"
          rows={4}
          value={draft.instrucao}
          onChange={(e) => setDraft((d) => ({ ...d, instrucao: e.target.value }))}
          placeholder="Descreva exatamente o que o agente deve analisar ou produzir..."
          className="w-full rounded-xl bg-[#212121] border border-white/10 focus:border-[#007CF7] px-3 py-2 text-[14px] font-normal text-[#F0F0F0] focus:outline-none"
        />
        <p className="text-[12px] font-normal text-[#979797]">
          Execuções automáticas sem novidades podem chamar <code>routine_no_update</code> para não gerar notificação.
        </p>
      </div>

      {/* Políticas de Execução e Thread Isolada */}
      <div className="rounded-xl bg-[#212121] border border-white/[0.06] p-4 space-y-4">
        {!(draft.triggerKind === "schedule" && draft.schedule.kind === "once") && (
          <div className="space-y-1">
            <span className="block text-[12px] font-semibold text-[#DCDCDC]">
              Quando a cota do provedor acabar
            </span>
            <CarbonSelect<RoutineLimitPolicy>
              ariaLabel="Política de limite de cota"
              value={draft.limitPolicy}
              onChange={(val) => setDraft((d) => ({ ...d, limitPolicy: val }))}
              options={[
                { value: "wait", label: "Aguardar reset da cota" },
                { value: "skip", label: "Pular ocorrência" },
              ]}
            />
          </div>
        )}

        <div className="space-y-1">
          <span className="block text-[12px] font-semibold text-[#DCDCDC]">
            Se o servidor esteve desligado
          </span>
          <CarbonSelect<RoutineMissedPolicy>
            ariaLabel="Política para execuções perdidas"
            value={draft.missedPolicy}
            onChange={(val) => setDraft((d) => ({ ...d, missedPolicy: val }))}
            options={[
              { value: "skip", label: "Pular perdidas" },
              { value: "run-once", label: "Executar última perdida" },
            ]}
          />
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-[14px] font-normal text-[#DCDCDC]">
            Executar em conversa isolada (side-thread)
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={draft.runIn === "side_thread"}
            onClick={() =>
              setDraft((d) => ({
                ...d,
                runIn: d.runIn === "side_thread" ? "chat" : "side_thread",
              }))
            }
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
              draft.runIn === "side_thread" ? "bg-[#007CF7]" : "bg-[#2A2A2A]"
            }`}
          >
            <span
              className={`block h-4 w-4 rounded-full bg-white transition-transform ${
                draft.runIn === "side_thread" ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>

        {/* Destino do resultado (RoutineResultDestinationField agrupado sem controle HTML nativo) */}
        <div className="space-y-1 relative">
          <span className="block text-[12px] font-semibold text-[#DCDCDC]">
            Destino do resultado
          </span>
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={destMenuOpen}
            onClick={() => setDestMenuOpen((o) => !o)}
            className="w-full h-9 rounded-xl border border-[#2A2A2A] bg-[#141414] px-3 text-[13px] text-[#F0F0F0] flex items-center justify-between gap-2 hover:border-white/20"
          >
            <span className="truncate">
              {destinationDisplayLabel(draft.destinoResultado, destOptions)}
            </span>
            <ChevronDown className="h-4 w-4 text-[#979797]" />
          </button>

          {destMenuOpen && (
            <div
              role="listbox"
              aria-label="Selecionar destino do resultado"
              className="mt-1 rounded-xl border border-[#2A2A2A] bg-[#212121] p-1 space-y-1 max-h-56 overflow-y-auto shadow-2xl"
            >
              <button
                type="button"
                role="option"
                aria-selected={destinationKey(draft.destinoResultado) === "none"}
                onClick={() => {
                  setDraft((d) => ({ ...d, destinoResultado: { tipo: "none" } }));
                  setDestMenuOpen(false);
                }}
                className="w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[12px] text-[#F0F0F0] hover:bg-[#2A2A2A]"
              >
                <span>Apenas no histórico/chat</span>
                {destinationKey(draft.destinoResultado) === "none" && (
                  <Check className="h-3.5 w-3.5 text-[#007CF7]" />
                )}
              </button>

              {groupedDestinationSections.notifOpts.map((opt) => (
                <button
                  key={`notif:${opt.id}`}
                  type="button"
                  role="option"
                  aria-selected={draft.destinoResultado.tipo === "notificacao"}
                  onClick={() => {
                    setDraft((d) => ({
                      ...d,
                      destinoResultado: { tipo: "notificacao", destino_nome: opt.nome },
                    }));
                    setDestMenuOpen(false);
                  }}
                  className="w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[12px] text-[#F0F0F0] hover:bg-[#2A2A2A]"
                >
                  <span>{opt.nome}</span>
                  {draft.destinoResultado.tipo === "notificacao" && (
                    <Check className="h-3.5 w-3.5 text-[#007CF7]" />
                  )}
                </button>
              ))}

              {groupedDestinationSections.channelOpts.length > 0 && (
                <div>
                  <p className="px-2.5 pt-1 text-[11px] font-semibold text-[#979797]">
                    Equipes
                  </p>
                  {groupedDestinationSections.channelOpts.map((opt) => {
                    const selected =
                      draft.destinoResultado.tipo === "canal" &&
                      draft.destinoResultado.canal_id === opt.id;
                    return (
                      <button
                        key={`canal:${opt.id}`}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => {
                          setDraft((d) => ({
                            ...d,
                            destinoResultado: {
                              tipo: "canal",
                              canal_id: opt.id,
                              destino_nome: opt.nome,
                            },
                          }));
                          setDestMenuOpen(false);
                        }}
                        className="w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[12px] text-[#F0F0F0] hover:bg-[#2A2A2A]"
                      >
                        <span>{opt.nome}</span>
                        {selected && <Check className="h-3.5 w-3.5 text-[#007CF7]" />}
                      </button>
                    );
                  })}
                </div>
              )}

              {groupedDestinationSections.waOpts.length > 0 && (
                <div>
                  <p className="px-2.5 pt-1 text-[11px] font-semibold text-[#979797]">WhatsApp</p>
                  {groupedDestinationSections.waOpts.map((opt) => {
                    const selected =
                      draft.destinoResultado.tipo === "whatsapp" &&
                      draft.destinoResultado.destino_id === opt.id;
                    return (
                      <button
                        key={`wa:${opt.id}`}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => {
                          setDraft((d) => ({
                            ...d,
                            destinoResultado: {
                              tipo: "whatsapp",
                              destino_id: opt.id,
                              destino_nome: opt.nome,
                            },
                          }));
                          setDestMenuOpen(false);
                        }}
                        className="w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[12px] text-[#F0F0F0] hover:bg-[#2A2A2A]"
                      >
                        <span>{opt.nome}</span>
                        {selected && <Check className="h-3.5 w-3.5 text-[#007CF7]" />}
                      </button>
                    );
                  })}
                </div>
              )}

              {groupedDestinationSections.tgOpts.length > 0 && (
                <div>
                  <p className="px-2.5 pt-1 text-[11px] font-semibold text-[#979797]">Telegram</p>
                  {groupedDestinationSections.tgOpts.map((opt) => {
                    const selected =
                      draft.destinoResultado.tipo === "telegram" &&
                      draft.destinoResultado.chat_id === opt.id;
                    return (
                      <button
                        key={`tg:${opt.id}`}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => {
                          setDraft((d) => ({
                            ...d,
                            destinoResultado: {
                              tipo: "telegram",
                              chat_id: opt.id,
                              destino_nome: opt.nome,
                            },
                          }));
                          setDestMenuOpen(false);
                        }}
                        className="w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[12px] text-[#F0F0F0] hover:bg-[#2A2A2A]"
                      >
                        <span>{opt.nome}</span>
                        {selected && <Check className="h-3.5 w-3.5 text-[#007CF7]" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
