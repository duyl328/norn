import type { EditorView } from "@codemirror/view";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";

import {
  getTabPositionsForScroll,
  getTabVisibilityForPositions,
  getZIndexesForPositions,
} from "../editor-tab-geometry";
import type { EditorTabLayout, EditorTabPreview, TabFoldStacks, WorkbenchDocument } from "../types";
import { clamp, getTabAccent, isDocumentDirty } from "../workbench-utils";

interface UseEditorTabsParams {
  openDocuments: WorkbenchDocument[];
  document: WorkbenchDocument;
  onCreateFile: () => void;
  viewRef: RefObject<EditorView | null>;
}

/**
 * 编辑器顶部文件 Tab 的全部状态机：层叠布局测量、滚动动画、折叠堆、
 * 当前 Tab 追踪与相关副作用。把这部分从 EditorSurface 中抽离以控制单文件体量。
 */
export function useEditorTabs({ openDocuments, document, onCreateFile, viewRef }: UseEditorTabsParams) {
  const tabScrollRef = useRef<HTMLDivElement>(null);
  const tabButtonRefs = useRef<Record<string, HTMLElement | null>>({});
  const tabScrollLeftRef = useRef(0);
  const tabLayoutFrameRef = useRef<number | null>(null);
  const tabScrollAnimationFrameRef = useRef<number | null>(null);
  const tabWheelFrameRef = useRef<number | null>(null);
  const tabScrollSettleTimerRef = useRef<number | null>(null);
  const suppressTabBellowsUntilRef = useRef(0);

  const [activePreviewTabId, setActivePreviewTabId] = useState(document.id);
  const [tabBellows, setTabBellows] = useState<"left" | "right" | null>(null);
  const [tabFoldStacks, setTabFoldStacks] = useState<TabFoldStacks>({ left: [], right: [] });
  const [tabLayouts, setTabLayouts] = useState<Record<string, EditorTabLayout>>({});
  const [hiddenCloseTabIds, setHiddenCloseTabIds] = useState<Set<string>>(() => new Set());
  const [tabOverflow, setTabOverflow] = useState({ left: false, right: false });

  const previewTabs = useMemo<EditorTabPreview[]>(
    () =>
      openDocuments.map((openDocument) => ({
        accent: getTabAccent(openDocument.id),
        closable: openDocuments.length > 1,
        id: openDocument.id,
        name: openDocument.name,
        dirty: isDocumentDirty(openDocument) || openDocument.isUntitled,
      })),
    [openDocuments],
  );

  const addPreviewTab = () => {
    onCreateFile();
  };

  const updateTabLayout = () => {
    const tabScroll = tabScrollRef.current;

    if (!tabScroll) {
      setTabOverflow({ left: false, right: false });
      setTabLayouts({});
      setTabFoldStacks({ left: [], right: [] });
      return;
    }

    const tabElements = previewTabs.map((tab) => tabButtonRefs.current[tab.id]).filter(Boolean) as HTMLElement[];

    if (tabElements.length !== previewTabs.length) {
      return;
    }

    const style = window.getComputedStyle(tabScroll);
    const railPadding = Number.parseFloat(style.paddingLeft) || 0;
    const leftStackStep = Number.parseFloat(style.getPropertyValue("--tab-left-stack-step")) || 30;
    const rightStackStep = Number.parseFloat(style.getPropertyValue("--tab-stack-step")) || 20;
    const leftVisibleStackLimit = 4;
    const rightVisibleStackLimit = 4;
    const hideBuffer = 50;
    const widths = tabElements.map((element) => element.offsetWidth);
    const scrollLeft = tabScroll.scrollLeft;
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

    const leftStackOverflow = getStackOverflow(widths, scrollLeft, leftStackStep, leftVisibleStackLimit);
    const reversedWidths = [...widths].reverse();
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
    const positions = widths.map((width, index) => {
      const naturalLeft = cursor - scrollLeft;
      const naturalRight = naturalLeft + width;
      const stickyLeft = (index - leftStackOverflow) * leftStackStep;
      const rightSlot = rightSlots[index];
      const isLeftPinned = naturalLeft <= stickyLeft;
      const isRightPinned = naturalRight >= viewportWidth - rightSlot.stickyRight;
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

      return {
        left,
        side,
        stickyLeft,
        stickyRight: rightSlot.stickyRight,
        width,
      };
    });

    const centerLine = viewportWidth / 2;
    const crossingCenterIndex = positions.findIndex(
      (position) => position.left <= centerLine && position.left + position.width >= centerLine,
    );
    const visualCenterIndex =
      crossingCenterIndex >= 0
        ? crossingCenterIndex
        : positions.reduce((bestIndex, position, index) => {
            const currentCenter = position.left + position.width / 2;
            const best = positions[bestIndex];
            const bestCenter = best.left + best.width / 2;

            return Math.abs(currentCenter - centerLine) < Math.abs(bestCenter - centerLine) ? index : bestIndex;
          }, 0);
    const zIndexes = positions.map((_, index) => {
      if (index === visualCenterIndex) {
        return 10000;
      }

      return index < visualCenterIndex ? 1000 + index : 1000 + positions.length - index;
    });

    const getCoveredEdges = (index: number) => {
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

      for (let index = merged.length - 1; index >= 0; index -= 1) {
        const range = merged[index];

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

    const nextLayouts = previewTabs.reduce<Record<string, EditorTabLayout>>((layouts, tab, index) => {
      const position = positions[index];
      const coveredEdges = getCoveredEdges(index);

      layouts[tab.id] = {
        coveredLeft: clamp((coveredEdges.left / position.width) * 100, 0, 100),
        coveredRight: clamp((coveredEdges.right / position.width) * 100, 0, 100),
        hideLeft: clamp(((coveredEdges.left - hideBuffer) / position.width) * 100, 0, 100),
        hideRight: clamp(((coveredEdges.right - hideBuffer) / position.width) * 100, 0, 100),
        side: position.side,
        stickyLeft: position.stickyLeft,
        stickyRight: position.stickyRight,
        zIndex: zIndexes[index],
      };

      return layouts;
    }, {});

    const viewportStart = scrollLeft;
    const viewportEnd = viewportStart + tabScroll.clientWidth;
    const leftHiddenTabs: EditorTabPreview[] = [];
    const rightHiddenTabs: EditorTabPreview[] = [];

    previewTabs.forEach((tab, index) => {
      const tabElement = tabElements[index];

      if (!tabElement) {
        return;
      }

      const tabStart = tabElement.offsetLeft;
      const tabEnd = tabStart + tabElement.offsetWidth;

      if (tabEnd < viewportStart + 6) {
        leftHiddenTabs.push(tab);
        return;
      }

      if (tabStart > viewportEnd - 6) {
        rightHiddenTabs.push(tab);
      }
    });

    setTabOverflow({
      left: scrollLeft > 2,
      right: scrollLeft < scrollMax - 2,
    });
    setTabLayouts(nextLayouts);
    setTabFoldStacks({
      left: leftHiddenTabs.slice(-3),
      right: rightHiddenTabs.slice(0, 3).reverse(),
    });
    setHiddenCloseTabIds((currentIds) => {
      const nextIds = new Set(currentIds);

      previewTabs.forEach((tab) => {
        const layout = nextLayouts[tab.id];

        if (!layout) {
          nextIds.delete(tab.id);
          return;
        }

        if (layout.coveredLeft >= 60) {
          nextIds.add(tab.id);
          return;
        }

        if (layout.coveredLeft <= 20) {
          nextIds.delete(tab.id);
        }
      });

      if (nextIds.size === currentIds.size && [...nextIds].every((id) => currentIds.has(id))) {
        return currentIds;
      }

      return nextIds;
    });
  };

  const scheduleTabLayout = () => {
    if (tabLayoutFrameRef.current !== null) {
      window.cancelAnimationFrame(tabLayoutFrameRef.current);
    }

    tabLayoutFrameRef.current = window.requestAnimationFrame(() => {
      tabLayoutFrameRef.current = null;
      updateTabLayout();
    });
  };

  const cancelTabScrollAnimation = () => {
    if (tabScrollAnimationFrameRef.current === null) {
      return;
    }

    window.cancelAnimationFrame(tabScrollAnimationFrameRef.current);
    tabScrollAnimationFrameRef.current = null;
  };

  const animateTabScrollTo = (target: number, onDone: (() => void) | null = null) => {
    const tabScroll = tabScrollRef.current;

    if (!tabScroll) {
      return;
    }

    cancelTabScrollAnimation();

    if (tabWheelFrameRef.current !== null) {
      window.cancelAnimationFrame(tabWheelFrameRef.current);
      tabWheelFrameRef.current = null;
    }

    const start = tabScroll.scrollLeft;
    const distance = target - start;
    const duration = 420;
    const startedAt = window.performance.now();

    if (Math.abs(distance) < 1) {
      tabScroll.scrollLeft = target;
      updateTabLayout();
      onDone?.();
      return;
    }

    const tick = (now: number) => {
      const progress = clamp((now - startedAt) / duration, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 3);

      tabScroll.scrollLeft = start + distance * eased;
      updateTabLayout();

      if (progress < 1) {
        tabScrollAnimationFrameRef.current = window.requestAnimationFrame(tick);
        return;
      }

      tabScrollAnimationFrameRef.current = null;
      onDone?.();
    };

    tabScrollAnimationFrameRef.current = window.requestAnimationFrame(tick);
  };

  const scrollPreviewTabIntoView = (tabId: string) => {
    const tabScroll = tabScrollRef.current;
    const tabButton = tabButtonRefs.current[tabId];

    if (!tabScroll || !tabButton) {
      return;
    }

    const activeIndex = previewTabs.findIndex((tab) => tab.id === tabId);

    if (activeIndex < 0) {
      return;
    }

    suppressTabBellowsUntilRef.current = window.performance.now() + 420;

    const style = window.getComputedStyle(tabScroll);
    const railPadding = Number.parseFloat(style.paddingLeft) || 0;
    const widths = previewTabs.map((tab) => tabButtonRefs.current[tab.id]?.offsetWidth ?? 0);
    const scrollMax = Math.max(0, tabScroll.scrollWidth - tabScroll.clientWidth);
    let cursor = railPadding;
    let activeStart = railPadding;
    let activeEnd = railPadding;
    let target = tabScroll.scrollLeft;

    widths.forEach((width, index) => {
      if (index === activeIndex) {
        activeStart = cursor;
      }

      cursor += width;

      if (index === activeIndex) {
        activeEnd = cursor;
      }
    });

    const getFocusStepTarget = (scrollLeft: number) => {
      const positions = getTabPositionsForScroll(tabScroll, widths, scrollLeft);
      const zIndexes = getZIndexesForPositions(tabScroll, positions);
      const visibility = getTabVisibilityForPositions(tabScroll, activeIndex, positions, railPadding, zIndexes);

      if (visibility.insideContainer && visibility.fullyExpanded) {
        return scrollLeft;
      }

      if (activeStart < scrollLeft + railPadding) {
        return activeStart - railPadding;
      }

      if (activeEnd > scrollLeft + tabScroll.clientWidth - railPadding) {
        return activeEnd - tabScroll.clientWidth + railPadding;
      }

      if (visibility.coveredByNext > 2 || visibility.position.side === "left") {
        return scrollLeft - Math.max(20, visibility.coveredByNext);
      }

      if (visibility.coveredByPrevious > 2 || visibility.position.side === "right") {
        return scrollLeft + Math.max(20, visibility.coveredByPrevious);
      }

      return scrollLeft;
    };

    for (let index = 0; index < 24; index += 1) {
      const nextTarget = clamp(getFocusStepTarget(target), 0, scrollMax);

      if (Math.abs(nextTarget - target) < 0.5) {
        break;
      }

      target = nextTarget;

      const positions = getTabPositionsForScroll(tabScroll, widths, target);
      const zIndexes = getZIndexesForPositions(tabScroll, positions);
      const visibility = getTabVisibilityForPositions(tabScroll, activeIndex, positions, railPadding, zIndexes);

      if (visibility.insideContainer && visibility.fullyExpanded) {
        break;
      }
    }

    animateTabScrollTo(clamp(target, 0, scrollMax));
  };

  useEffect(() => {
    setActivePreviewTabId(document.id);

    window.requestAnimationFrame(() => {
      scrollPreviewTabIntoView(document.id);
      updateTabLayout();

      viewRef.current?.focus();
    });
  }, [document.id]);

  useEffect(() => {
    window.requestAnimationFrame(() => {
      scrollPreviewTabIntoView(activePreviewTabId);
      updateTabLayout();
    });
  }, [activePreviewTabId, previewTabs.length]);

  useEffect(() => {
    const tabScroll = tabScrollRef.current;

    if (!tabScroll) {
      return;
    }

    updateTabLayout();
    tabScrollLeftRef.current = tabScroll.scrollLeft;

    const handleTabScroll = () => {
      const currentScrollLeft = tabScroll.scrollLeft;
      const scrollDelta = currentScrollLeft - tabScrollLeftRef.current;

      scheduleTabLayout();

      if (Math.abs(scrollDelta) > 1 && window.performance.now() > suppressTabBellowsUntilRef.current) {
        setTabBellows(scrollDelta > 0 ? "right" : "left");
      }

      tabScrollLeftRef.current = currentScrollLeft;

      if (tabScrollSettleTimerRef.current) {
        window.clearTimeout(tabScrollSettleTimerRef.current);
      }

      tabScrollSettleTimerRef.current = window.setTimeout(() => {
        setTabBellows(null);
      }, 180);
    };

    // 把竖向滚轮(Windows 鼠标只产生 deltaY)转成横向滚动；横向触控板(deltaX)交给浏览器原生处理。
    // 滚轮一格是离散的大跳变，直接累加 scrollLeft 会“一卡一卡”；这里累积到目标值后用
    // requestAnimationFrame 缓动逼近，得到顺滑的连续滚动。
    let wheelTarget = tabScroll.scrollLeft;

    const stepWheelScroll = () => {
      const current = tabScroll.scrollLeft;
      const diff = wheelTarget - current;

      if (Math.abs(diff) < 0.5) {
        tabScroll.scrollLeft = wheelTarget;
        tabWheelFrameRef.current = null;
        return;
      }

      tabScroll.scrollLeft = current + diff * 0.22;
      tabWheelFrameRef.current = window.requestAnimationFrame(stepWheelScroll);
    };

    const handleTabWheel = (event: WheelEvent) => {
      if (event.deltaX !== 0 || event.deltaY === 0) {
        return;
      }

      const maxScroll = Math.max(0, tabScroll.scrollWidth - tabScroll.clientWidth);

      if (maxScroll <= 0) {
        return;
      }

      event.preventDefault();
      cancelTabScrollAnimation();

      if (tabWheelFrameRef.current === null) {
        wheelTarget = tabScroll.scrollLeft;
      }

      wheelTarget = clamp(wheelTarget + event.deltaY, 0, maxScroll);

      if (tabWheelFrameRef.current === null) {
        tabWheelFrameRef.current = window.requestAnimationFrame(stepWheelScroll);
      }
    };

    tabScroll.addEventListener("scroll", handleTabScroll, { passive: true });
    tabScroll.addEventListener("wheel", handleTabWheel, { passive: false });
    window.addEventListener("resize", scheduleTabLayout);

    return () => {
      tabScroll.removeEventListener("scroll", handleTabScroll);
      tabScroll.removeEventListener("wheel", handleTabWheel);
      window.removeEventListener("resize", scheduleTabLayout);

      if (tabWheelFrameRef.current !== null) {
        window.cancelAnimationFrame(tabWheelFrameRef.current);
        tabWheelFrameRef.current = null;
      }

      if (tabScrollSettleTimerRef.current) {
        window.clearTimeout(tabScrollSettleTimerRef.current);
      }

      if (tabLayoutFrameRef.current !== null) {
        window.cancelAnimationFrame(tabLayoutFrameRef.current);
        tabLayoutFrameRef.current = null;
      }
    };
  }, [previewTabs]);

  // 计算每个 Tab 的层叠深度，用于渐进式缩放。
  const leftStackedIds = previewTabs
    .filter((t) => tabLayouts[t.id]?.side === "left")
    .sort((a, b) => (tabLayouts[a.id]?.zIndex ?? 0) - (tabLayouts[b.id]?.zIndex ?? 0))
    .map((t) => t.id);
  const rightStackedIds = previewTabs
    .filter((t) => tabLayouts[t.id]?.side === "right")
    .sort((a, b) => (tabLayouts[a.id]?.zIndex ?? 0) - (tabLayouts[b.id]?.zIndex ?? 0))
    .map((t) => t.id);
  const stackDepthMap: Record<string, { depth: number; total: number }> = {};
  leftStackedIds.forEach((id, i) => {
    stackDepthMap[id] = { depth: i, total: leftStackedIds.length };
  });
  rightStackedIds.forEach((id, i) => {
    stackDepthMap[id] = { depth: i, total: rightStackedIds.length };
  });

  return {
    tabScrollRef,
    tabButtonRefs,
    previewTabs,
    activePreviewTabId,
    tabBellows,
    tabFoldStacks,
    tabLayouts,
    hiddenCloseTabIds,
    tabOverflow,
    stackDepthMap,
    addPreviewTab,
  };
}
