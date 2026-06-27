// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsPage } from "@/features/workbench/components/settings";
import { I18nProvider } from "@/features/workbench/i18n-provider";
import { useWorkbenchStore } from "@/features/workbench/store/workbench-store";

function renderSettingsPage(onBack = () => {}) {
  return render(
    <I18nProvider>
      <SettingsPage onBack={onBack} showMacTitlebar={false} />
    </I18nProvider>,
  );
}

describe("SettingsPage", () => {
  beforeEach(() => {
    useWorkbenchStore.getState().setLanguage("zh");
  });

  it("显示通用设置并可返回", () => {
    const onBack = vi.fn();
    renderSettingsPage(onBack);

    expect(screen.getByRole("heading", { name: "通用设置" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /回到软件/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("外观设置里切换面板提示开关会写入 store", () => {
    useWorkbenchStore.getState().setResizeHandleHintsVisible(false);
    renderSettingsPage();

    fireEvent.click(screen.getAllByRole("button", { name: "外观设置" })[0]);
    expect(screen.getByRole("heading", { name: "外观设置" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /显示面板调节提示/ }));
    expect(useWorkbenchStore.getState().resizeHandleHintsVisible).toBe(true);
  });

  it("通用设置里切换 Tab 宽度会写入 store", () => {
    useWorkbenchStore.getState().setEditorTabSize(2);
    renderSettingsPage();

    fireEvent.click(screen.getByRole("button", { name: "增大" }));
    expect(useWorkbenchStore.getState().editorTabSize).toBe(3);
  });

  it("切换英文后更新设置页核心文案", () => {
    renderSettingsPage();

    fireEvent.click(screen.getByRole("button", { name: "English" }));

    expect(useWorkbenchStore.getState().language).toBe("en");
    expect(screen.getByRole("heading", { name: "General" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Back to app/ })).toBeInTheDocument();
  });
});
