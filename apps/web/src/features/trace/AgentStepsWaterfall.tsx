import { useState } from "react";
import { ChevronDown, ChevronRight, Terminal, Wrench } from "lucide-react";

export interface AgentStepLog {
  id: string;
  tarefa_id: string;
  agente_id: string;
  step_index: number;
  ferramenta: string;
  input: unknown;
  timestamp: string;
}

interface AgentStepsWaterfallProps {
  steps: AgentStepLog[];
  thoughtStream: string;
  selectedTaskId: string | null;
}

export function AgentStepsWaterfall({
  steps,
  thoughtStream,
  selectedTaskId,
}: AgentStepsWaterfallProps) {
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  const visibleSteps = selectedTaskId
    ? steps.filter((s) => s.tarefa_id === selectedTaskId)
    : steps;

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <section className="flex flex-col rounded-2xl border border-white/[0.07] bg-[#141414] p-4">
      <div className="mb-2 flex items-center justify-between border-b border-white/[0.06] pb-2">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-[#42A0FF]" />
          <h3 className="text-sm font-semibold text-white">
            Execução ao Vivo (Agent Steps Waterfall)
          </h3>
        </div>
        <span className="font-terminal text-[11px] text-[#979797]">
          {visibleSteps.length} tool calls
        </span>
      </div>

      {thoughtStream && (
        <div className="mb-3 rounded-xl border border-white/10 bg-[#212121] p-2.5">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-[#42A0FF]">
            Raciocínio do Criativo (Streaming)
          </span>
          <p className="font-terminal max-h-24 overflow-y-auto whitespace-pre-wrap text-[#DCDCDC]">
            {thoughtStream}
          </p>
        </div>
      )}

      {visibleSteps.length === 0 ? (
        <p className="font-terminal py-4 text-center text-[#979797]">
          Aguardando transmissão de passos e tool calls via WebSocket...
        </p>
      ) : (
        <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
          {visibleSteps.map((step) => {
            const isOpen = Boolean(expandedIds[step.id]);
            return (
              <div
                key={step.id}
                className="rounded-xl border border-white/[0.06] bg-[#212121]"
              >
                <button
                  type="button"
                  onClick={() => toggleExpand(step.id)}
                  className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {isOpen ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#979797]" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#979797]" />
                    )}
                    <Wrench className="h-3.5 w-3.5 shrink-0 text-[#31CF76]" />
                    <span className="font-terminal truncate font-medium text-white">
                      #{step.step_index} {step.ferramenta}
                    </span>
                  </div>
                  <span className="font-terminal shrink-0 text-[11px] text-[#979797]">
                    {step.agente_id}
                  </span>
                </button>

                {isOpen && (
                  <pre className="font-terminal overflow-x-auto border-t border-white/[0.06] bg-[#101010] p-2.5 text-[12px] text-[#31CF76]">
                    {JSON.stringify(step.input, null, 2)}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
