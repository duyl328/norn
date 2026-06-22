import { describe, expect, it } from "vitest";

import { getCoveredEdgesForPositions } from "@/features/workbench/editor-tab-geometry";
import type { EditorTabPosition } from "@/features/workbench/types";

const pos = (left: number, width: number): EditorTabPosition => ({
  left,
  naturalLeft: left,
  side: "normal",
  stickyLeft: 0,
  stickyRight: 0,
  width,
});

describe("getCoveredEdgesForPositions", () => {
  it("无重叠时左右遮挡均为 0", () => {
    const positions = [pos(0, 100), pos(200, 100)];
    expect(getCoveredEdgesForPositions(0, positions, [1, 2])).toEqual({ left: 0, right: 0 });
  });

  it("仅被更高层的相邻 Tab 遮住右侧", () => {
    // tab0 [0,100] 被 tab1 [50,150] 覆盖，且 tab1 z 序更高
    const positions = [pos(0, 100), pos(50, 100)];
    expect(getCoveredEdgesForPositions(0, positions, [1, 2])).toEqual({ left: 0, right: 50 });
  });

  it("被完全覆盖时左右遮挡都等于自身宽度", () => {
    const positions = [pos(0, 100), pos(0, 100)];
    expect(getCoveredEdgesForPositions(0, positions, [1, 2])).toEqual({ left: 100, right: 100 });
  });

  it("z 序更低的相邻 Tab 不构成遮挡", () => {
    const positions = [pos(0, 100), pos(50, 100)];
    // 目标 z 序更高 → 不被遮挡
    expect(getCoveredEdgesForPositions(0, positions, [2, 1])).toEqual({ left: 0, right: 0 });
  });
});
