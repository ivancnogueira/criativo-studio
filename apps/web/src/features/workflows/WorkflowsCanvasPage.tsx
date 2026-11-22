import React from "react";
import {
  cloneCanvasSnapshot,
  computeWorkflowAutoLayout,
  type CanvasHistorySnapshot,
  type WorkflowEventSignal,
  type WorkflowsCanvasPageProps,
} from "./workflow-canvas-types";
import { useWorkflowCanvasController } from "./useWorkflowCanvasController";
import { WorkflowCanvasStage } from "./WorkflowCanvasStage";
import { WorkflowCanvasTopHud } from "./WorkflowCanvasTopHud";
import { WorkflowCanvasOverlays } from "./WorkflowCanvasOverlays";

export {
  cloneCanvasSnapshot,
  computeWorkflowAutoLayout,
  type CanvasHistorySnapshot,
  type WorkflowEventSignal,
  type WorkflowsCanvasPageProps,
};

export const WorkflowsCanvasPage: React.FC<WorkflowsCanvasPageProps> = (props) => {
  const ctrl = useWorkflowCanvasController(props);

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#1A1A1A] text-white">
      <WorkflowCanvasStage ctrl={ctrl} props={props} />
      <WorkflowCanvasTopHud ctrl={ctrl} props={props} />
      <WorkflowCanvasOverlays ctrl={ctrl} props={props} />
    </div>
  );
};
