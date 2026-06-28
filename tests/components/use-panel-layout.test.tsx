// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  leftPanelMaxWidth,
  leftPanelMinWidth,
  rightPanelMaxWidth,
  rightPanelMinWidth,
} from "@/features/workbench/constants";
import { usePanelLayout } from "@/features/workbench/hooks/use-panel-layout";
import { useWorkbenchStore } from "@/features/workbench/store/workbench-store";

const keyEvent = (key: string) =>
  ({ key, preventDefault: () => {} }) as unknown as ReactKeyboardEvent<HTMLDivElement>;

const pointerDown = (clientX: number) =>
  ({ clientX, preventDefault: () => {} }) as unknown as ReactPointerEvent<HTMLDivElement>;

beforeEach(() => {
  useWorkbenchStore.setState({
    leftPanelOpen: false,
    leftPanelWidth: 260,
    rightPanelWidth: 320,
    searchOpen: false,
    settingsOpen: false,
    resizingPanel: null,
  });
  window.localStorage.clear();
});

describe("usePanelLayout 工具开关", () => {
  it("toggle / open / close 系列更新 store", () => {
    const { result } = renderHook(() => usePanelLayout());

    act(() => result.current.toggleFilesTool());
    expect(useWorkbenchStore.getState().leftPanelOpen).toBe(true);

    act(() => result.current.openSearchTool());
    expect(useWorkbenchStore.getState().searchOpen).toBe(true);
    act(() => result.current.closeSearchTool());
    expect(useWorkbenchStore.getState().searchOpen).toBe(false);

    act(() => result.current.openSettingsTool());
    expect(useWorkbenchStore.getState().settingsOpen).toBe(true);
    act(() => result.current.updateSettingsOpen(false));
    expect(useWorkbenchStore.getState().settingsOpen).toBe(false);
  });

  it("updateResizeHandleHintsVisible 同步 store 与 localStorage", () => {
    const { result } = renderHook(() => usePanelLayout());

    act(() => result.current.updateResizeHandleHintsVisible(true));
    expect(useWorkbenchStore.getState().resizeHandleHintsVisible).toBe(true);
  });
});

describe("resizePanelWithKeyboard", () => {
  it("Home / End 跳到最小 / 最大宽度", () => {
    const { result } = renderHook(() => usePanelLayout());

    act(() => result.current.resizePanelWithKeyboard("left", keyEvent("Home")));
    expect(useWorkbenchStore.getState().leftPanelWidth).toBe(leftPanelMinWidth);
    act(() => result.current.resizePanelWithKeyboard("left", keyEvent("End")));
    expect(useWorkbenchStore.getState().leftPanelWidth).toBe(leftPanelMaxWidth);

    act(() => result.current.resizePanelWithKeyboard("right", keyEvent("Home")));
    expect(useWorkbenchStore.getState().rightPanelWidth).toBe(rightPanelMinWidth);
    act(() => result.current.resizePanelWithKeyboard("right", keyEvent("End")));
    expect(useWorkbenchStore.getState().rightPanelWidth).toBe(rightPanelMaxWidth);
  });

  it("方向键按步进调整,未知键不变", () => {
    const { result } = renderHook(() => usePanelLayout());

    const before = useWorkbenchStore.getState().leftPanelWidth;
    act(() => result.current.resizePanelWithKeyboard("left", keyEvent("ArrowRight")));
    expect(useWorkbenchStore.getState().leftPanelWidth).toBe(before + 16);
    act(() => result.current.resizePanelWithKeyboard("right", keyEvent("ArrowLeft")));
    expect(useWorkbenchStore.getState().rightPanelWidth).toBe(320 + 16);

    const stable = useWorkbenchStore.getState().leftPanelWidth;
    act(() => result.current.resizePanelWithKeyboard("left", keyEvent("Enter")));
    expect(useWorkbenchStore.getState().leftPanelWidth).toBe(stable);
  });
});

describe("startPanelResize", () => {
  it("拖拽指针更新宽度并在松开后恢复", () => {
    const { result } = renderHook(() => usePanelLayout());

    act(() => result.current.startPanelResize("left", pointerDown(500)));
    expect(useWorkbenchStore.getState().resizingPanel).toBe("left");

    act(() => window.dispatchEvent(new MouseEvent("pointermove", { clientX: 560 })));
    expect(useWorkbenchStore.getState().leftPanelWidth).toBe(260 + 60);

    act(() => window.dispatchEvent(new MouseEvent("pointerup")));
    expect(useWorkbenchStore.getState().resizingPanel).toBeNull();
  });

  it("右侧拖拽方向相反", () => {
    const { result } = renderHook(() => usePanelLayout());

    act(() => result.current.startPanelResize("right", pointerDown(500)));
    act(() => window.dispatchEvent(new MouseEvent("pointermove", { clientX: 460 })));
    expect(useWorkbenchStore.getState().rightPanelWidth).toBe(320 + 40);
    act(() => window.dispatchEvent(new MouseEvent("pointerup")));
  });
});
