import { Compartment, EditorState, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Plus, X } from "lucide-react";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { createCodeMirrorExtensions } from "../codemirror-setup";
import { EDITOR_SCROLLBAR_SIZE, emptyEditorScrollMetrics } from "../constants";
import {
  FULL_LANGUAGE_PARSER_SIZE_LIMIT_BYTES,
  loadHighlightExtensions,
  resolveHighlightMode,
} from "../editor-highlighting";
import type {
  EditorScrollbarOrientation,
  EditorScrollMetrics,
  EditorTabLayout,
  EditorTabPosition,
  EditorTabPreview,
  TabFoldStacks,
  WorkbenchDocument,
} from "../types";
import {
  clamp,
  formatFileSize,
  getEditorScrollbarGeometry,
  getFileTreeIcon,
  getTabAccent,
  getTabBorderAccent,
  isDocumentDirty,
} from "../workbench-utils";
import { TabFoldStack } from "./titlebar";

export function EditorSurface({
  document,
  error,
  isDirty,
  openDocuments,
  onChange,
  onCloseDocument,
  onCreateFile,
  onSelectDocument,
}: {
  document: WorkbenchDocument;
  error: string | null;
  isDirty: boolean;
  openDocuments: WorkbenchDocument[];
  onChange: (content: string) => void;
  onCloseDocument: (document: WorkbenchDocument) => void;
  onCreateFile: () => void;
  onSelectDocument: (document: WorkbenchDocument) => void;
}) {
  const editorFrameRef = useRef<HTMLDivElement>(null);
  const editorElementRef = useRef<HTMLDivElement>(null);
  const tabScrollRef = useRef<HTMLDivElement>(null);
  const tabButtonRefs = useRef<Record<string, HTMLElement | null>>({});
  const tabScrollLeftRef = useRef(0);
  const tabLayoutFrameRef = useRef<number | null>(null);
  const tabScrollAnimationFrameRef = useRef<number | null>(null);
  const tabScrollSettleTimerRef = useRef<number | null>(null);
  const suppressTabBellowsUntilRef = useRef(0);
  const scrollDOMRef = useRef<HTMLElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const languageCompartmentRef = useRef(new Compartment());
  const dragRef = useRef<{
    maxScroll: number;
    orientation: EditorScrollbarOrientation;
    pointerStart: number;
    scrollStart: number;
    thumbSize: number;
    trackSize: number;
  } | null>(null);
  const [activePreviewTabId, setActivePreviewTabId] = useState(document.id);
  const [editingPreviewTabId, setEditingPreviewTabId] = useState<string | null>(null);
  const [editingPreviewTabName, setEditingPreviewTabName] = useState("");
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

  const commitPreviewTabName = () => {
    if (!editingPreviewTabId) {
      return;
    }

    const nextName = editingPreviewTabName.trim();

    if (nextName) {
      // Tab renaming is visual-only for now; file rename stays in the file tree command.
    }

    setEditingPreviewTabId(null);
  };

  const addPreviewTab = () => {
    setEditingPreviewTabId(null);
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

  const getCoveredEdgesForPositions = (index: number, positions: EditorTabPosition[], zIndexes: number[]) => {
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

  const getTabPositionsForScroll = (widths: number[], scrollLeft: number) => {
    const tabScroll = tabScrollRef.current;

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

      return { left, naturalLeft, side, stickyLeft, stickyRight: rightSlot.stickyRight, width };
    });
  };

  const getVisualCenterIndexForPositions = (positions: EditorTabPosition[]) => {
    const tabScroll = tabScrollRef.current;

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

  const getZIndexesForPositions = (positions: EditorTabPosition[]) => {
    const visualCenterIndex = getVisualCenterIndexForPositions(positions);

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

  const getTabVisibilityForPositions = (
    index: number,
    positions: EditorTabPosition[],
    railPadding: number,
    zIndexes: number[],
  ) => {
    const tabScroll = tabScrollRef.current;
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
      const positions = getTabPositionsForScroll(widths, scrollLeft);
      const zIndexes = getZIndexesForPositions(positions);
      const visibility = getTabVisibilityForPositions(activeIndex, positions, railPadding, zIndexes);

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

      const positions = getTabPositionsForScroll(widths, target);
      const zIndexes = getZIndexesForPositions(positions);
      const visibility = getTabVisibilityForPositions(activeIndex, positions, railPadding, zIndexes);

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

    tabScroll.addEventListener("scroll", handleTabScroll, { passive: true });
    window.addEventListener("resize", scheduleTabLayout);

    return () => {
      tabScroll.removeEventListener("scroll", handleTabScroll);
      window.removeEventListener("resize", scheduleTabLayout);

      if (tabScrollSettleTimerRef.current) {
        window.clearTimeout(tabScrollSettleTimerRef.current);
      }

      if (tabLayoutFrameRef.current !== null) {
        window.cancelAnimationFrame(tabLayoutFrameRef.current);
        tabLayoutFrameRef.current = null;
      }
    };
  }, [previewTabs]);

  useEffect(() => {
    if (!editingPreviewTabId) {
      return;
    }

    window.requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
  }, [editingPreviewTabId]);
  const [scrollMetrics, setScrollMetrics] = useState<EditorScrollMetrics>(emptyEditorScrollMetrics);
  const [highlightWarning, setHighlightWarning] = useState<string | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const parent = editorElementRef.current;
    const frame = editorFrameRef.current;

    if (!parent || !frame) {
      return;
    }

    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: document.content,
        extensions: createCodeMirrorExtensions(languageCompartmentRef.current, document, (content) =>
          onChangeRef.current(content),
        ),
      }),
    });

    viewRef.current = view;
    scrollDOMRef.current = view.scrollDOM;
    setHighlightWarning(null);

    let isCurrentDocument = true;

    const mode =
      document.mode === "large-readonly" ||
      (typeof document.size === "number" && document.size > FULL_LANGUAGE_PARSER_SIZE_LIMIT_BYTES)
        ? ({ kind: "plain-text", label: "Plain Text", reason: "large-file" } as const)
        : resolveHighlightMode(document);

    loadHighlightExtensions(mode)
      .then((extensions) => {
        if (!isCurrentDocument || viewRef.current !== view) {
          return;
        }

        setHighlightWarning(null);
        view.dispatch({
          effects: languageCompartmentRef.current.reconfigure(extensions),
        });
      })
      .catch((highlightError) => {
        if (!isCurrentDocument || viewRef.current !== view) {
          return;
        }

        setHighlightWarning(`Syntax highlighting for ${mode.label} could not be loaded. Showing plain text instead.`);
        view.dispatch({
          effects: languageCompartmentRef.current.reconfigure([]),
        });
        console.error("Failed to load editor highlighting", highlightError);
      });

    let animationFrame: number | null = null;

    const readScrollMetrics = () => {
      const gutterElement = view.scrollDOM.querySelector(".cm-gutters") as HTMLElement | null;
      const frameRect = frame.getBoundingClientRect();

      return {
        clientHeight: view.scrollDOM.clientHeight,
        clientWidth: view.scrollDOM.clientWidth,
        gutterWidth: gutterElement?.getBoundingClientRect().width ?? emptyEditorScrollMetrics.gutterWidth,
        scrollHeight: view.scrollDOM.scrollHeight,
        scrollLeft: view.scrollDOM.scrollLeft,
        scrollTop: view.scrollDOM.scrollTop,
        scrollWidth: view.scrollDOM.scrollWidth,
        shellHeight: frameRect.height,
        shellWidth: frameRect.width,
      };
    };

    const updateScrollMetrics = () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }

      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        setScrollMetrics(readScrollMetrics());
      });
    };

    view.dispatch({
      effects: StateEffect.appendConfig.of(EditorView.updateListener.of(updateScrollMetrics)),
    });

    const resizeObserver = new ResizeObserver(updateScrollMetrics);
    resizeObserver.observe(frame);
    resizeObserver.observe(view.scrollDOM);
    resizeObserver.observe(view.contentDOM);

    const gutterElement = view.scrollDOM.querySelector(".cm-gutters");

    if (gutterElement) {
      resizeObserver.observe(gutterElement);
    }

    const mutationObserver = new MutationObserver(updateScrollMetrics);
    mutationObserver.observe(parent, { childList: true, characterData: true, subtree: true });

    view.scrollDOM.addEventListener("scroll", updateScrollMetrics, { passive: true });
    updateScrollMetrics();

    return () => {
      isCurrentDocument = false;

      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }

      resizeObserver.disconnect();
      mutationObserver.disconnect();
      view.scrollDOM.removeEventListener("scroll", updateScrollMetrics);
      view.destroy();
      viewRef.current = null;
      scrollDOMRef.current = null;
    };
  }, [document.id, document.name]);

  const setScrollPosition = (orientation: EditorScrollbarOrientation, value: number) => {
    const scrollDOM = scrollDOMRef.current;

    if (!scrollDOM) {
      return;
    }

    if (orientation === "horizontal") {
      scrollDOM.scrollLeft = value;
      return;
    }

    scrollDOM.scrollTop = value;
  };

  const handleScrollbarTrackPointerDown = (
    orientation: EditorScrollbarOrientation,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (event.target !== event.currentTarget) {
      return;
    }

    const geometry = getEditorScrollbarGeometry(orientation, scrollMetrics);

    if (!geometry) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const pointerPosition = orientation === "horizontal" ? event.clientX - rect.left : event.clientY - rect.top;
    const pageSize =
      orientation === "horizontal"
        ? Math.max(1, scrollMetrics.clientWidth - scrollMetrics.gutterWidth)
        : Math.max(1, scrollMetrics.clientHeight);
    const direction = pointerPosition < geometry.thumbOffset ? -1 : 1;

    event.preventDefault();
    setScrollPosition(orientation, clamp(geometry.scrollPosition + direction * pageSize, 0, geometry.maxScroll));
  };

  const handleScrollbarThumbPointerDown = (
    orientation: EditorScrollbarOrientation,
    event: ReactPointerEvent<HTMLSpanElement>,
  ) => {
    const geometry = getEditorScrollbarGeometry(orientation, scrollMetrics);

    if (!geometry) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    dragRef.current = {
      maxScroll: geometry.maxScroll,
      orientation,
      pointerStart: orientation === "horizontal" ? event.clientX : event.clientY,
      scrollStart: geometry.scrollPosition,
      thumbSize: geometry.thumbSize,
      trackSize: geometry.trackSize,
    };

    const handlePointerMove = (pointerEvent: globalThis.PointerEvent) => {
      const drag = dragRef.current;

      if (!drag) {
        return;
      }

      const pointerPosition = drag.orientation === "horizontal" ? pointerEvent.clientX : pointerEvent.clientY;
      const draggableSize = Math.max(1, drag.trackSize - drag.thumbSize);
      const scrollDelta = ((pointerPosition - drag.pointerStart) / draggableSize) * drag.maxScroll;

      setScrollPosition(drag.orientation, clamp(drag.scrollStart + scrollDelta, 0, drag.maxScroll));
    };

    const handlePointerUp = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  // Compute stack depth per tab for progressive height reduction.
  // Left-stacked tabs: sort by zIndex asc → deeper (leftmost) = index 0.
  // Right-stacked tabs: same sort → deeper (rightmost) = index 0.
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

  return (
    <section className="editor-surface-panel flex min-h-0 min-w-0 flex-col overflow-hidden bg-[hsl(var(--editor-background))]">
      <div
        className={cn(
          "editor-file-tabs",
          tabOverflow.left && "editor-file-tabs-has-left",
          tabOverflow.right && "editor-file-tabs-has-right",
        )}
        role="tablist"
        aria-label="Open files"
      >
        <TabFoldStack open={tabBellows === "left"} side="left" tabs={tabFoldStacks.left} />
        <div className="editor-file-tabs-scroll" ref={tabScrollRef}>
          {previewTabs.map((tab) => {
            const active = tab.id === activePreviewTabId;
            const editing = tab.id === editingPreviewTabId;
            const tabDocument = openDocuments.find((openDocument) => openDocument.id === tab.id);
            const layout = tabLayouts[tab.id];
            const isStacked = layout?.side === "left" || layout?.side === "right";
            const hideCloseButton = !active || isStacked || hiddenCloseTabIds.has(tab.id);
            const { className: tabIconClassName, Icon: TabIcon } = getFileTreeIcon({
              kind: "file",
              name: tab.name,
              path: tab.name,
              relativePath: tab.name,
            });
            const stackInfo = stackDepthMap[tab.id];
            const positionFromActive = stackInfo ? stackInfo.total - stackInfo.depth : 0;
            const stackScale = stackInfo ? Math.max(0.68, 1 - positionFromActive * 0.08) : 1;
            const tabStyle = {
              "--editor-tab-accent": tab.accent,
              "--editor-tab-border-accent": getTabBorderAccent(tab.name),
              "--hide-left": `${layout?.hideLeft ?? 0}%`,
              "--hide-right": `${layout?.hideRight ?? 0}%`,
              "--sticky-left": `${layout?.stickyLeft ?? 0}px`,
              "--sticky-right": `${layout?.stickyRight ?? 0}px`,
              "--tab-stack-scale": String(stackScale),
              zIndex: layout?.zIndex,
            } as CSSProperties;

            return (
              <Tooltip key={tab.id}>
                <TooltipTrigger asChild>
                  <div
                    className={cn(
                      "editor-file-tab",
                      active && "editor-file-tab-active",
                      layout?.side !== "right" && "editor-file-tab-left-sticky",
                      layout?.side === "right" && "editor-file-tab-right-sticky",
                      layout?.side === "right" && "editor-file-tab-right-stacked",
                      layout?.side === "left" && "editor-file-tab-left-stacked",
                    )}
                    ref={(element) => {
                      tabButtonRefs.current[tab.id] = element;
                    }}
                    style={tabStyle}
                    role="tab"
                    aria-selected={active}
                    tabIndex={active ? 0 : -1}
                    onClick={() => {
                      if (tabDocument) {
                        onSelectDocument(tabDocument);
                      }
                    }}
                    onDoubleClick={() => {
                      if (tabDocument) {
                        onSelectDocument(tabDocument);
                      }
                      setEditingPreviewTabId(tab.id);
                      setEditingPreviewTabName(tab.name);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        if (tabDocument) {
                          onSelectDocument(tabDocument);
                        }
                      }
                    }}
                  >
                    <TabIcon className={cn("editor-file-tab-icon", tabIconClassName)} aria-hidden="true" />
                    {editing ? (
                      <input
                        ref={renameInputRef}
                        className="editor-file-tab-input"
                        value={editingPreviewTabName}
                        onChange={(event) => setEditingPreviewTabName(event.target.value)}
                        onBlur={commitPreviewTabName}
                        onClick={(event) => event.stopPropagation()}
                        onDoubleClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            commitPreviewTabName();
                          }

                          if (event.key === "Escape") {
                            event.preventDefault();
                            setEditingPreviewTabId(null);
                          }
                        }}
                      />
                    ) : (
                      <span className="truncate">{tab.name}</span>
                    )}
                    {!editing ? (
                      <span
                        className={cn("editor-file-tab-trailing", hideCloseButton && "editor-file-tab-trailing-hidden")}
                      >
                        <span className="editor-file-tab-dirty" aria-hidden={!tab.dirty}>
                          {tab.dirty ? "•" : ""}
                        </span>
                        {tab.closable && (
                          <button
                            className="editor-file-tab-close"
                            aria-label={`Close ${tab.name}`}
                            title={`Close ${tab.name}`}
                            type="button"
                            tabIndex={hideCloseButton ? -1 : 0}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();

                              if (!hideCloseButton && tabDocument) {
                                onCloseDocument(tabDocument);
                              }
                            }}
                            onDoubleClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                            }}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </span>
                    ) : null}
                  </div>
                </TooltipTrigger>
                <TooltipContent className="editor-file-tab-tooltip" side="bottom" align="start" sideOffset={8}>
                  <div className="editor-file-tab-tooltip-path">{tabDocument?.path ?? tab.name}</div>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
        <TabFoldStack open={tabBellows === "right"} side="right" tabs={tabFoldStacks.right} />
        <button
          className="editor-file-tab-add"
          type="button"
          aria-label="Add test tab"
          title="Add test tab"
          onClick={addPreviewTab}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {error ? (
        <div className="border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-ui text-destructive">
          {error}
        </div>
      ) : null}
      {highlightWarning ? (
        <div className="border-b border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-ui text-amber-700 dark:text-amber-300">
          {highlightWarning}
        </div>
      ) : null}
      {document.mode === "large-readonly" ? (
        <div className="border-b border-border bg-muted/40 px-3 py-1.5 text-ui text-muted-foreground">
          Large file browsing mode{document.size ? ` (${formatFileSize(document.size)})` : ""}. This view is read-only
          and shows a loaded text range.
        </div>
      ) : null}
      <div className="codemirror-shell-frame min-h-0 flex-1" ref={editorFrameRef}>
        <div className="codemirror-shell min-h-0 flex-1" ref={editorElementRef} />
        <EditorScrollbar
          metrics={scrollMetrics}
          orientation="vertical"
          onThumbPointerDown={handleScrollbarThumbPointerDown}
          onTrackPointerDown={handleScrollbarTrackPointerDown}
        />
        <EditorScrollbar
          metrics={scrollMetrics}
          orientation="horizontal"
          onThumbPointerDown={handleScrollbarThumbPointerDown}
          onTrackPointerDown={handleScrollbarTrackPointerDown}
        />
      </div>
    </section>
  );
}

export function EditorScrollbar({
  metrics,
  orientation,
  onThumbPointerDown,
  onTrackPointerDown,
}: {
  metrics: EditorScrollMetrics;
  orientation: EditorScrollbarOrientation;
  onThumbPointerDown: (orientation: EditorScrollbarOrientation, event: ReactPointerEvent<HTMLSpanElement>) => void;
  onTrackPointerDown: (orientation: EditorScrollbarOrientation, event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const geometry = getEditorScrollbarGeometry(orientation, metrics);
  const hasVerticalScrollbar = metrics.scrollHeight - metrics.clientHeight > 1;

  if (!geometry) {
    return null;
  }

  return (
    <div
      aria-orientation={orientation}
      aria-valuemax={Math.round(geometry.maxScroll)}
      aria-valuemin={0}
      aria-valuenow={Math.round(geometry.scrollPosition)}
      className={cn("editor-scrollbar", `editor-scrollbar-${orientation}`)}
      role="scrollbar"
      style={
        orientation === "horizontal"
          ? {
              bottom: 0,
              height: EDITOR_SCROLLBAR_SIZE,
              left: metrics.gutterWidth,
              right: hasVerticalScrollbar ? EDITOR_SCROLLBAR_SIZE : 0,
            }
          : {
              bottom: 0,
              right: 0,
              top: 0,
              width: EDITOR_SCROLLBAR_SIZE,
            }
      }
      tabIndex={-1}
      onPointerDown={(event) => onTrackPointerDown(orientation, event)}
    >
      <span
        className="editor-scrollbar-thumb"
        style={
          orientation === "horizontal"
            ? { left: geometry.thumbOffset, width: geometry.thumbSize }
            : { height: geometry.thumbSize, top: geometry.thumbOffset }
        }
        onPointerDown={(event) => onThumbPointerDown(orientation, event)}
      />
    </div>
  );
}
