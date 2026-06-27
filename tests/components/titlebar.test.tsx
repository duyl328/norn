// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MacTitlebar } from "@/features/workbench/components/titlebar";
import { I18nProvider } from "@/features/workbench/i18n-provider";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    close: vi.fn(),
    minimize: vi.fn(),
    show: vi.fn().mockResolvedValue(undefined),
    toggleMaximize: vi.fn(),
  }),
}));

const renderMacTitlebar = (rightPanelOpen = true) =>
  render(
    <I18nProvider>
      <MacTitlebar
        gitBadgeCount={3}
        leftPanelOpen
        leftPanelWidth={260}
        onCloseSearch={() => {}}
        onOpenSearch={() => {}}
        onToggleLeftPanel={() => {}}
        onToggleRightPanel={() => {}}
        rightPanelOpen={rightPanelOpen}
        rightPanelWidth={320}
        searchOpen={false}
      />
    </I18nProvider>,
  );

describe("MacTitlebar", () => {
  it("keeps a draggable editor-region layer when the Git panel is open", () => {
    const { container } = renderMacTitlebar(true);

    const titlebar = container.querySelector<HTMLElement>(".mac-titlebar");
    const dragLayer = container.querySelector<HTMLElement>(".mac-titlebar-drag-layer");
    const rightSide = container.querySelector<HTMLElement>(".mac-titlebar-side-right");

    expect(titlebar).toHaveStyle({
      "--titlebar-editor-left": "260px",
      "--titlebar-editor-right": "320px",
    });
    expect(dragLayer).toHaveAttribute("data-tauri-drag-region");
    expect(rightSide).toHaveClass("mac-titlebar-side-right-passthrough");
  });
});
