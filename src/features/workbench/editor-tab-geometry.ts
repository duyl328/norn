import type { EditorTabLayout, EditorTabPosition } from "./types";
import { clamp } from "./workbench-utils";

/**
 * 编辑器 Tab 的纯几何计算：根据各 Tab 宽度、滚动位置与容器度量，推算每个 Tab 的
 * 摆放位置、层叠 z 序、相互遮挡范围与可见性。全部为纯函数，便于单测与复用。
 * 调用方传入 tab 滚动容器元素(可为 null),不直接依赖任何 ref。
 */

export const getCoveredEdgesForPositions = (index: number, positions: EditorTabPosition[], zIndexes: number[]) => {
  const position = positions[index];
  const left = position.left;
  const right = position.left + position.width;
  const coveredRanges: Array<[number, number]> = [];

  positions.forEach((other, otherIndex) => {
    if (otherIndex === index || zIndexes[otherIndex] <= zIndexes[index]) {
      return;
    }

    const overlapLeft = Math.max(left, other.left);
    const overlapRight = Math.min(right, other.left + other.width);

    if (overlapRight - overlapLeft > 0) {
      coveredRanges.push([overlapLeft - left, overlapRight - left]);
    }
  });

  if (!coveredRanges.length) {
    return { left: 0, right: 0 };
  }

  coveredRanges.sort((a, b) => a[0] - b[0]);

  const merged: Array<[number, number]> = [];

  coveredRanges.forEach((range) => {
    const last = merged[merged.length - 1];

    if (!last || range[0] > last[1]) {
      merged.push([...range]);
      return;
    }

    last[1] = Math.max(last[1], range[1]);
  });

  let coveredLeft = 0;
  let cursorLeft = 0;

  merged.forEach((range) => {
    if (range[0] <= cursorLeft) {
      coveredLeft = Math.max(coveredLeft, range[1]);
      cursorLeft = coveredLeft;
    }
  });

  let coveredRight = 0;
  let cursorRight = position.width;

  for (let i = merged.length - 1; i >= 0; i -= 1) {
    const range = merged[i];

    if (range[1] >= cursorRight) {
      coveredRight = Math.max(coveredRight, cursorRight - range[0]);
      cursorRight = range[0];
    }
  }

  return {
    left: clamp(coveredLeft, 0, position.width),
    right: clamp(coveredRight, 0, position.width),
  };
};

export const getTabPositionsForScroll = (
  tabScroll: HTMLElement | null,
  widths: number[],
  scrollLeft: number,
): EditorTabPosition[] => {
  if (!tabScroll) {
    return [];
  }

  const style = window.getComputedStyle(tabScroll);
  const railPadding = Number.parseFloat(style.paddingLeft) || 0;
  const leftStackStep = Number.parseFloat(style.getPropertyValue("--tab-left-stack-step")) || 30;
  const rightStackStep = Number.parseFloat(style.getPropertyValue("--tab-stack-step")) || 20;
  const leftVisibleStackLimit = 4;
  const rightVisibleStackLimit = 4;
  const scrollMax = Math.max(0, tabScroll.scrollWidth - tabScroll.clientWidth);

  const getStackOverflow = (
    orderedWidths: number[],
    scrollOffset: number,
    stackStep: number,
    visibleStackLimit: number,
  ) => {
    let cursor = railPadding;
    let overflow = 0;

    orderedWidths.forEach((width, index) => {
      if (index >= visibleStackLimit) {
        const triggerScroll = cursor - index * stackStep;
        const rawProgress = (scrollOffset - triggerScroll) / stackStep;

        if (rawProgress > 0) {
          overflow = Math.max(overflow, index - visibleStackLimit + clamp(rawProgress, 0, 1));
        }
      }

      cursor += width;
    });

    return Math.max(0, overflow);
  };

  const reversedWidths = [...widths].reverse();
  const leftStackOverflow = getStackOverflow(widths, scrollLeft, leftStackStep, leftVisibleStackLimit);
  const rightStackOverflow = getStackOverflow(
    reversedWidths,
    scrollMax - scrollLeft,
    rightStackStep,
    rightVisibleStackLimit,
  );
  const viewportWidth = tabScroll.clientWidth;
  let reverseCursor = railPadding;
  const rightSlots: Array<{ right: number; stickyRight: number }> = [];

  reversedWidths.forEach((width, reversedIndex) => {
    const originalIndex = widths.length - 1 - reversedIndex;
    const naturalLeft = reverseCursor - (scrollMax - scrollLeft);
    const stickyRight = (reversedIndex - rightStackOverflow) * rightStackStep;

    rightSlots[originalIndex] = {
      right: Math.max(naturalLeft, stickyRight),
      stickyRight,
    };
    reverseCursor += width;
  });

  let cursor = railPadding;

  return widths.map<EditorTabPosition>((width, index) => {
    const naturalLeft = cursor - scrollLeft;
    const naturalRight = naturalLeft + width;
    const stickyLeft = (index - leftStackOverflow) * leftStackStep;
    const rightSlot = rightSlots[index];
    // 严格不等:标签只有真正滚到沾边位置「之下」(被覆盖/折叠)时才算钉住。
    // 用 <= / >= 会让首个标签在静止无溢出时被误判:naturalLeft 与 stickyLeft 都恰为 0
    // (railPadding=0、scrollLeft=0、index 0),0<=0 恒真 → 永远 side:"left" → 常亮折叠边框。
    const isLeftPinned = naturalLeft < stickyLeft;
    const isRightPinned = naturalRight > viewportWidth - rightSlot.stickyRight;
    let side: EditorTabLayout["side"] = "normal";
    let left = naturalLeft;

    if (isLeftPinned && isRightPinned) {
      side = naturalLeft + width / 2 < viewportWidth / 2 ? "left" : "right";
    } else if (isLeftPinned) {
      side = "left";
    } else if (isRightPinned) {
      side = "right";
    }

    if (side === "left") {
      left = Math.max(naturalLeft, stickyLeft);
    } else if (side === "right") {
      left = viewportWidth - width - rightSlot.right;
    }

    cursor += width;

    return { left, naturalLeft, side, stickyLeft, stickyRight: rightSlot.stickyRight, width };
  });
};

export const getVisualCenterIndexForPositions = (tabScroll: HTMLElement | null, positions: EditorTabPosition[]) => {
  if (!tabScroll) {
    return 0;
  }

  const centerLine = tabScroll.clientWidth / 2;
  const crossingIndex = positions.findIndex(
    (position) => position.left <= centerLine && position.left + position.width >= centerLine,
  );

  if (crossingIndex >= 0) {
    return crossingIndex;
  }

  return positions.reduce((bestIndex, position, index) => {
    const center = position.left + position.width / 2;
    const best = positions[bestIndex];
    const bestCenter = best.left + best.width / 2;

    return Math.abs(center - centerLine) < Math.abs(bestCenter - centerLine) ? index : bestIndex;
  }, 0);
};

export const getZIndexesForPositions = (tabScroll: HTMLElement | null, positions: EditorTabPosition[]) => {
  const visualCenterIndex = getVisualCenterIndexForPositions(tabScroll, positions);

  return positions.map((_, index) => {
    if (index === visualCenterIndex) {
      return 10000;
    }

    if (index < visualCenterIndex) {
      return 1000 + index;
    }

    return 1000 + positions.length - index;
  });
};

export const getTabVisibilityForPositions = (
  tabScroll: HTMLElement | null,
  index: number,
  positions: EditorTabPosition[],
  railPadding: number,
  zIndexes: number[],
) => {
  const position = positions[index];
  const previous = positions[index - 1];
  const next = positions[index + 1];
  const tolerance = 2;
  const left = position.left;
  const right = position.left + position.width;
  const visibleStart = railPadding;
  const visibleEnd = (tabScroll?.clientWidth ?? 0) - railPadding;
  const previousOverlap = previous ? Math.max(0, previous.left + previous.width - left) : 0;
  const nextOverlap = next ? Math.max(0, right - next.left) : 0;
  const coveredByPrevious = position.side === "right" ? previousOverlap : 0;
  const coveredByNext = position.side === "left" ? nextOverlap : 0;
  const coveredEdges = getCoveredEdgesForPositions(index, positions, zIndexes);

  return {
    coveredByNext,
    coveredByPrevious,
    fullyExpanded: coveredEdges.left <= tolerance && coveredEdges.right <= tolerance,
    insideContainer: left >= visibleStart - tolerance && right <= visibleEnd + tolerance,
    position,
  };
};
