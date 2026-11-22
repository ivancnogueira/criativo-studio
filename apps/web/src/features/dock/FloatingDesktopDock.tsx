import React from "react";
import type { FloatingDesktopDockProps } from "./floating-dock-helpers";
import { useFloatingDockController } from "./useFloatingDockController";
import { FloatingDesktopDockView } from "./FloatingDesktopDockView";

export * from "./floating-dock-helpers";

export const FloatingDesktopDock: React.FC<FloatingDesktopDockProps> = (props) => {
  const ctrl = useFloatingDockController(props);
  return <FloatingDesktopDockView ctrl={ctrl} />;
};
