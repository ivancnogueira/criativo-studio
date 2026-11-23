import React from "react";
import type { RoutineFlowsCanvasProps } from "./routine-flows-helpers";
import { useRoutineFlowsController } from "./useRoutineFlowsController";
import { RoutineFlowsStageView } from "./RoutineFlowsStageView";
import { RoutineFlowsInspectorAside } from "./RoutineFlowsInspectorAside";

export { computeConnectProblem } from "./routine-flows-helpers";

export const RoutineFlowsCanvas: React.FC<RoutineFlowsCanvasProps> = (props) => {
  const ctrl = useRoutineFlowsController(props);
  if (!ctrl.agente) {
    return (
      <div className="flex-1 h-full flex items-center justify-center bg-[#1A1A1A] text-[#979797] text-[14px]">
        Selecione um Criativo na barra lateral para visualizar os fluxos de rotinas.
      </div>
    );
  }
  return (
    <RoutineFlowsStageView ctrl={ctrl}>
      <RoutineFlowsInspectorAside ctrl={ctrl} />
    </RoutineFlowsStageView>
  );
};
