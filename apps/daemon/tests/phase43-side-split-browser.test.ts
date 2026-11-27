import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addSplitGroup,
  MAX_SIDE_SPLIT_GROUPS,
  MIN_SPLIT_RATIO,
  reconcileSideSplitLayout,
  removeSplitGroup,
  reorderSplitGroup,
  resizeSplitPair,
  type SideSplitLayoutState,
} from "../../web/src/features/inspector/side-split-layout.ts";
import { computeDetachedWindowBounds } from "../../desktop/src/browser-window-bounds.ts";

const sum = (s: SideSplitLayoutState) => s.groups.reduce((a, g) => a + g.ratio, 0);

describe("Fase 43-01 — Multi-split vertical e janela destacada multi-monitor", () => {
  it("addSplitGroup adiciona até 3 grupos e ignora o 4º", () => {
    let state: SideSplitLayoutState = { groups: [] };
    state = addSplitGroup(state, "inspector");
    state = addSplitGroup(state, "browser");
    state = addSplitGroup(state, "preview");
    assert.equal(state.groups.length, 3);
    const after = addSplitGroup(state, "side_thread");
    assert.equal(after.groups.length, MAX_SIDE_SPLIT_GROUPS);
    assert.ok(Math.abs(sum(after) - 1) < 1e-9);
    const promoted = addSplitGroup(state, "preview");
    assert.equal(promoted.groups.length, 3);
    assert.equal(promoted.groups[0]?.kind, "preview");
  });

  it("resizeSplitPair respeita mínimo 0.18 e soma ~1.0", () => {
    let state = addSplitGroup(addSplitGroup({ groups: [] }, "inspector"), "browser");
    state = resizeSplitPair(state, 0, 0.9);
    assert.ok(state.groups.every((g) => g.ratio >= MIN_SPLIT_RATIO - 1e-9));
    assert.ok(Math.abs(sum(state) - 1) < 1e-9);
    state = resizeSplitPair(state, 0, -2);
    assert.ok(Math.abs((state.groups[0]?.ratio ?? 0) - MIN_SPLIT_RATIO) < 1e-9);
    assert.ok(Math.abs(sum(state) - 1) < 1e-9);
  });

  it("reorderSplitGroup, removeSplitGroup e reconcile preservam integridade", () => {
    let state: SideSplitLayoutState = { groups: [] };
    for (const k of ["inspector", "browser", "preview"] as const) state = addSplitGroup(state, k);
    state = reorderSplitGroup(state, "preview", "up");
    assert.deepEqual(
      state.groups.map((g) => g.kind),
      ["inspector", "preview", "browser"]
    );
    state = removeSplitGroup(state, "preview");
    assert.equal(state.groups.length, 2);
    assert.ok(Math.abs(sum(state) - 1) < 1e-9);
    const reconciled = reconcileSideSplitLayout(state, ["browser", "preview"]);
    assert.deepEqual(
      reconciled.groups.map((g) => g.kind),
      ["browser", "preview"]
    );
    assert.ok(Math.abs(sum(reconciled) - 1) < 1e-9);
  });

  it("computeDetachedWindowBounds posiciona no monitor secundário e faz fallback ao primário", () => {
    const displays = [
      { id: 1, primary: true, workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
      { id: 2, workArea: { x: 1920, y: 0, width: 2560, height: 1440 } },
    ];
    const second = computeDetachedWindowBounds(displays, "2");
    assert.equal(second.displayId, "2");
    assert.ok(second.x >= 1920 && second.x + second.width <= 1920 + 2560);
    const fallback = computeDetachedWindowBounds(displays, "desconhecido");
    assert.equal(fallback.displayId, "1");
    assert.ok(fallback.x >= 0 && fallback.x + fallback.width <= 1920);
  });
});
