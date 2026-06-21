// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SettingsPage } from "@/features/workbench/components/settings";

describe("SettingsPage", () => {
  it("显示通用设置并可返回", () => {
    const onBack = vi.fn();
    render(
      <SettingsPage
        gitWorkspace={{ kind: "idle" }}
        onBack={onBack}
        onToggleResizeHandleHints={() => {}}
        resizeHandleHintsVisible={false}
        showMacTitlebar={false}
      />,
    );

    expect(screen.getByRole("heading", { name: "通用设置" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /回到软件/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("可以切换到外观设置并触发 resize hints 开关", () => {
    const onToggleResizeHandleHints = vi.fn();
    render(
      <SettingsPage
        gitWorkspace={{ kind: "idle" }}
        onBack={() => {}}
        onToggleResizeHandleHints={onToggleResizeHandleHints}
        resizeHandleHintsVisible={false}
        showMacTitlebar={false}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "外观设置" })[0]);
    expect(screen.getByRole("heading", { name: "外观设置" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /显示面板调节提示/ }));
    expect(onToggleResizeHandleHints).toHaveBeenCalledTimes(1);
  });
});
