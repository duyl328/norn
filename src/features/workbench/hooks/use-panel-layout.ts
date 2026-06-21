import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

import { leftPanelMaxWidth, leftPanelMinWidth, rightPanelMaxWidth, rightPanelMinWidth } from "../constants";
import { useWorkbenchStore } from "../store/workbench-store";
import { clamp, saveResizeHandleHints } from "../workbench-utils";

export function usePanelLayout() {
  const leftPanelWidth = useWorkbenchStore((state) => state.leftPanelWidth);
  const setLeftPanelOpen = useWorkbenchStore((state) => state.setLeftPanelOpen);
  const setLeftPanelWidth = useWorkbenchStore((state) => state.setLeftPanelWidth);
  const rightPanelWidth = useWorkbenchStore((state) => state.rightPanelWidth);
  const setRightPanelWidth = useWorkbenchStore((state) => state.setRightPanelWidth);
  const setResizingPanel = useWorkbenchStore((state) => state.setResizingPanel);
  const setResizeHandleHintsVisible = useWorkbenchStore((state) => state.setResizeHandleHintsVisible);
  const setSettingsOpen = useWorkbenchStore((state) => state.setSettingsOpen);
  const setSearchOpen = useWorkbenchStore((state) => state.setSearchOpen);

  const toggleFilesTool = () => {
    setLeftPanelOpen((value) => !value);
  };

  const openSearchTool = () => {
    setSearchOpen(true);
  };

  const closeSearchTool = () => {
    setSearchOpen(false);
  };

  const openSettingsTool = () => {
    setSettingsOpen(true);
  };

  const updateSettingsOpen = (open: boolean) => {
    setSettingsOpen(open);
  };

  const updateResizeHandleHintsVisible = (visible: boolean) => {
    setResizeHandleHintsVisible(visible);
    saveResizeHandleHints(visible);
  };

  const resizePanelWithKeyboard = (side: "left" | "right", event: ReactKeyboardEvent<HTMLDivElement>) => {
    const keyDeltas: Record<string, number> = {
      ArrowLeft: -16,
      ArrowRight: 16,
    };

    if (event.key === "Home") {
      event.preventDefault();
      if (side === "left") {
        setLeftPanelWidth(leftPanelMinWidth);
        return;
      }
      setRightPanelWidth(rightPanelMinWidth);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      if (side === "left") {
        setLeftPanelWidth(leftPanelMaxWidth);
        return;
      }
      setRightPanelWidth(rightPanelMaxWidth);
      return;
    }

    const delta = keyDeltas[event.key];

    if (!delta) {
      return;
    }

    event.preventDefault();

    if (side === "left") {
      setLeftPanelWidth((width) => clamp(width + delta, leftPanelMinWidth, leftPanelMaxWidth));
      return;
    }

    setRightPanelWidth((width) => clamp(width - delta, rightPanelMinWidth, rightPanelMaxWidth));
  };

  const startPanelResize = (side: "left" | "right", event: ReactPointerEvent<HTMLDivElement>) => {
    const pointerStart = event.clientX;
    const widthStart = side === "left" ? leftPanelWidth : rightPanelWidth;

    event.preventDefault();
    setResizingPanel(side);

    const previousCursor = globalThis.document.body.style.cursor;
    const previousUserSelect = globalThis.document.body.style.userSelect;
    globalThis.document.body.style.cursor = "col-resize";
    globalThis.document.body.style.userSelect = "none";

    const handlePointerMove = (pointerEvent: globalThis.PointerEvent) => {
      const delta = pointerEvent.clientX - pointerStart;

      if (side === "left") {
        setLeftPanelWidth(clamp(widthStart + delta, leftPanelMinWidth, leftPanelMaxWidth));
        return;
      }

      setRightPanelWidth(clamp(widthStart - delta, rightPanelMinWidth, rightPanelMaxWidth));
    };

    const handlePointerUp = () => {
      setResizingPanel(null);
      globalThis.document.body.style.cursor = previousCursor;
      globalThis.document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  return {
    toggleFilesTool,
    openSearchTool,
    closeSearchTool,
    openSettingsTool,
    updateSettingsOpen,
    updateResizeHandleHintsVisible,
    resizePanelWithKeyboard,
    startPanelResize,
  };
}
