import { expect, type Page } from "@playwright/test";

export async function emitMenu(page: Page, command: string): Promise<void> {
  await page.waitForFunction(() => {
    return (window as unknown as { __tauriMockHasListener?: (event: string) => boolean }).__tauriMockHasListener?.(
      "norn-menu",
    );
  });
  await page.evaluate((value) => {
    (window as unknown as { __emitTauriEvent: (event: string, payload: unknown) => void }).__emitTauriEvent(
      "norn-menu",
      value,
    );
  }, command);
}

export async function openMockFolder(page: Page): Promise<void> {
  await emitMenu(page, "menu-open-folder");
  await expect(page.locator(".tree-row:not(.tree-row-root)").first()).toBeVisible();
}

export async function openRootContextMenu(page: Page): Promise<void> {
  await page.locator("button.tree-row-root").first().click({ button: "right" });
  await expect(page.locator(".file-tree-context-menu")).toBeVisible();
}

export async function getTauriInvokeCalls(page: Page) {
  return await page.evaluate(() => {
    return (window as unknown as { __tauriInvokeCalls?: Array<{ args: Record<string, unknown>; cmd: string }> })
      .__tauriInvokeCalls;
  });
}
