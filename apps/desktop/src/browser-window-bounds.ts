/**
 * Cálculo puro de posicionamento multi-monitor da janela destacada do navegador (Fase 43 — UX43-01).
 * Não importa `electron` para poder ser testado com `node --test`.
 */

export interface DetachedDisplayInfo {
  id: string | number;
  primary?: boolean;
  workArea: { x: number; y: number; width: number; height: number };
}

export interface DetachedWindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  displayId: string;
}

export function computeDetachedWindowBounds(
  displays: DetachedDisplayInfo[],
  targetDisplayId?: string | null,
  width = 1180,
  height = 780
): DetachedWindowBounds {
  const target =
    (targetDisplayId != null
      ? displays.find((d) => String(d.id) === String(targetDisplayId))
      : undefined) ??
    displays.find((d) => d.primary) ??
    displays[0];

  if (!target) {
    return { x: 0, y: 0, width, height, displayId: "primary" };
  }
  const w = Math.min(width, target.workArea.width);
  const h = Math.min(height, target.workArea.height);
  return {
    x: Math.round(target.workArea.x + (target.workArea.width - w) / 2),
    y: Math.round(target.workArea.y + (target.workArea.height - h) / 2),
    width: w,
    height: h,
    displayId: String(target.id),
  };
}
