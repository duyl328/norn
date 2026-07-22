import { expect, test } from "@playwright/test";

import { emitMenu, openMockFolder } from "./helpers";
import { installTauriMock } from "./tauri-mock";

test("设置页：可以打开、切换外观设置并返回工作台", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");

  await emitMenu(page, "menu-keyboard-shortcuts");
  await expect(page.getByRole("button", { name: /Back to app/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "General" })).toBeVisible();

  await page.getByRole("button", { name: "Appearance" }).click();
  await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();

  await page.getByRole("button", { name: "Show panel resize hints" }).click();
  await page.getByRole("button", { name: /Back to app/ }).click();

  await expect(page.locator(".workspace-view")).toBeVisible();
  await emitMenu(page, "menu-show-explorer");
  await expect(page.locator(".workbench-layout")).toHaveClass(/workbench-layout-resize-hints-visible/);
});

test("状态栏：打开文件后显示路径、行数、大小和保存状态", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");
  await openMockFolder(page);

  await page.locator(".tree-row", { hasText: "README.md" }).dblclick();

  await expect(page.locator(".status-bar")).toContainText("/mock/project/README.md");
  await expect(page.locator(".status-bar")).toContainText("4 lines");
  await expect(page.locator(".status-bar")).toContainText("65 B");
  await expect(page.getByRole("tab", { name: /README\.md/ })).not.toContainText("•");
});

test("平台适配：浏览器非 Tauri 模式不显示原生标题栏", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator(".mac-titlebar")).toHaveCount(0);
  await expect(page.locator(".windows-titlebar")).toHaveCount(0);
});

test("平台适配：macOS Tauri runtime 显示 Mac 标题栏", async ({ browser }) => {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  });
  const page = await context.newPage();
  await installTauriMock(page);
  await page.goto("/");

  await expect(page.locator(".mac-titlebar")).toBeVisible();
  await expect(page.locator(".windows-titlebar")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Show file tree|Hide file tree/ })).toBeVisible();

  await context.close();
});

test("平台适配：Windows Tauri runtime 显示 Windows 标题栏并可打开文件夹", async ({ browser }) => {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  });
  const page = await context.newPage();
  await installTauriMock(page);
  await page.goto("/");

  await expect(page.locator(".windows-titlebar")).toBeVisible();
  await expect(page.locator(".mac-titlebar")).toHaveCount(0);
  await page.getByRole("button", { name: "Toggle application menu" }).click();
  await page.getByRole("button", { name: "File", exact: true }).hover();
  await page.getByRole("button", { name: "Open Folder" }).click();
  await expect(page.locator(".tree-row", { hasText: "README.md" })).toBeVisible();

  await context.close();
});
