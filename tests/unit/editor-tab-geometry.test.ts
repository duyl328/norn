import { afterEach, describe, expect, it, vi } from "vitest";

import { getCoveredEdgesForPositions, getTabPositionsForScroll } from "@/features/workbench/editor-tab-geometry";
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

describe("getTabPositionsForScroll", () => {
  // 在 node 环境下桩 window：railPadding=0、步长取默认值，复刻真实 CSS（rail padding-left:0）。
  const stubWindow = () =>
    vi.stubGlobal("window", {
      getComputedStyle: () => ({ paddingLeft: "0px", getPropertyValue: () => "" }),
    });
  const makeScroll = (clientWidth: number, scrollWidth: number) =>
    ({ clientWidth, scrollWidth }) as unknown as HTMLElement;

  afterEach(() => vi.unstubAllGlobals());

  // 回归:首个 Tab 在静止无溢出(scrollLeft=0、railPadding=0)时,naturalLeft 与 stickyLeft 都为 0。
  // 历史 bug:用 <= 判定 isLeftPinned 会让 0<=0 恒真 → 永远 side:"left" → 常亮折叠边框。
  it("静止无溢出时首个 Tab 不被误判为左折叠", () => {
    stubWindow();
    const positions = getTabPositionsForScroll(makeScroll(1000, 300), [100, 100], 0);
    expect(positions[0].side).toBe("normal");
  });

  // 真正滚动到首个 Tab 被推到沾边位置之下时,才应钉为左折叠。
  it("滚动溢出后首个 Tab 才进入左折叠", () => {
    stubWindow();
    const widths = Array.from({ length: 8 }, () => 120);
    const positions = getTabPositionsForScroll(makeScroll(360, 8 * 120), widths, 300);
    expect(positions[0].side).toBe("left");
  });
});
