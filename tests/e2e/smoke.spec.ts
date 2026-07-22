import { expect, test } from "@playwright/test";

import { emitMenu } from "./helpers";
import { installTauriMock } from "./tauri-mock";

/**
 * 第一层：浏览器回退模式（无 Tauri 运行时）。
 * 验证拆分后应用仍能正常加载渲染、编辑器带内置 mock 内容、且首屏无运行时报错。
 */
test("浏览器模式：工作台与编辑器正常渲染且无运行时报错", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/");

  await expect(page.locator("#root")).not.toBeEmpty();
  await expect(page.getByText("UTF-8")).toBeVisible();
  await expect(page.getByRole("tab", { name: /Untitled/ })).toBeVisible();

  // 编辑器（CodeMirror）已挂载并准备好默认空白未命名文档
  await expect(page.locator(".cm-content")).toBeVisible();
  await expect(page.locator(".cm-line").first()).toBeVisible();

  expect(pageErrors, `pageerror:\n${pageErrors.join("\n")}`).toHaveLength(0);
  expect(consoleErrors, `console.error:\n${consoleErrors.join("\n")}`).toHaveLength(0);
});

/**
 * 第二层：注入 Tauri mock 运行时，驱动真实 native 流程并用 mock 数据断言渲染效果。
 */
test("Tauri mock：打开文件夹后文件树渲染注入的数据", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");

  // 打开文件夹（openFolderPicker → list_directory，openFolderView 会自动展开左侧面板）
  await emitMenu(page, "menu-open-folder");

  // 文件树渲染出 list_directory 返回的 mock 目录项
  await expect(page.getByText("README.md").first()).toBeVisible();
  await expect(page.getByText("package.json").first()).toBeVisible();
  await expect(page.getByText("src").first()).toBeVisible();
});

/**
 * 第二层补充：打开 Git 面板，验证带 mock 仓库信息时分支渲染。
 */
test("Tauri mock：Git 面板显示 mock 分支", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");

  await emitMenu(page, "menu-open-folder");
  await emitMenu(page, "menu-toggle-git-panel");

  // Git 面板已打开，状态栏显示 mock 仓库的当前分支。
  await expect(page.getByRole("button", { name: "Hide Git panel" })).toBeVisible();
  await expect(page.locator(".status-bar").getByRole("button", { name: "main" })).toBeVisible();
});
