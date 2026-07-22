import { expect, test } from "@playwright/test";

import { emitMenu } from "./helpers";
import { installTauriMock } from "./tauri-mock";

/**
 * 工作台关键用户流程的行为护栏。注入 Tauri mock 运行时后，真实驱动组件
 * （文件树点击 / CodeMirror 输入 / 原生菜单命令），断言真实渲染结果。
 *
 * 选择器优先级：可见文本 > role > 稳定 class。需要触发原生菜单命令时走
 * `__emitTauriEvent`（最稳，复用应用已注册的 listen 回调）。
 */

/**
 * 流程 1：打开文件 → 编辑器显示内容 + 出现对应 Tab。
 * 打开文件夹后点击文件树里的 README.md（tree-row 按钮），断言编辑器渲染 mock 文件内容，
 * 并出现对应的编辑器 Tab。
 */
test("流程：打开文件树文件后编辑器显示内容并出现 Tab", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");

  await emitMenu(page, "menu-open-folder");

  // 双击文件树里的 README.md 行（tree-row 按钮）打开文件（单击仅选中、双击才打开）
  const readmeRow = page.locator(".tree-row", { hasText: "README.md" });
  await expect(readmeRow).toBeVisible();
  await readmeRow.dblclick();

  // 编辑器渲染 mock 文件内容
  await expect(page.locator(".cm-content")).toContainText("Mock Project");

  // 出现 README.md 的编辑器 Tab（role=tab）
  await expect(page.getByRole("tab", { name: /README\.md/ })).toBeVisible();
});

/**
 * 流程 2：编辑 → 脏标记 → 保存 → 已保存。
 * 打开 README.md 后在 CodeMirror 输入文本，断言状态栏出现 "Unsaved"；
 * 触发 menu-save-file（mock 的 save_text_file 返回 NativeSavedTextFile），
 * 断言状态栏回到 "Saved"。
 */
test("流程：编辑产生脏标记后保存回到已保存", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");

  await emitMenu(page, "menu-open-folder");
  await page.locator(".tree-row", { hasText: "README.md" }).dblclick();
  await expect(page.locator(".cm-content")).toContainText("Mock Project");

  // 打开后应为已保存
  await expect(page.getByRole("tab", { name: /README\.md/ })).not.toContainText("•");

  // 在编辑器输入文本，产生本地改动
  await page.locator(".cm-content").click();
  await page.keyboard.type("EDITED");

  // 状态栏出现未保存指示
  await expect(page.getByRole("tab", { name: /README\.md/ })).toContainText("•");

  // 触发原生保存命令（save_text_file）
  await emitMenu(page, "menu-save-file");

  // 状态栏回到已保存
  await expect(page.getByRole("tab", { name: /README\.md/ })).not.toContainText("•");
});

/**
 * 流程 3：多 Tab 切换。
 * 打开 README.md 与 src/main.tsx（先展开 src 目录），断言出现两个 Tab，
 * 点击切换后编辑器内容随之变化。
 */
test("流程：打开多个文件后切换 Tab 编辑器内容随之变化", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");

  await emitMenu(page, "menu-open-folder");

  // 打开 README.md
  await page.locator(".tree-row", { hasText: "README.md" }).dblclick();
  await expect(page.locator(".cm-content")).toContainText("Mock Project");

  // 展开 src 目录后打开 main.tsx
  await page.locator(".tree-row", { hasText: "src" }).dblclick();
  const mainRow = page.locator(".tree-row", { hasText: "main.tsx" });
  await expect(mainRow).toBeVisible();
  await mainRow.dblclick();
  await expect(page.locator(".cm-content")).toContainText("hello from mock");

  // 两个 Tab 均存在
  const readmeTab = page.getByRole("tab", { name: /README\.md/ });
  const mainTab = page.getByRole("tab", { name: /main\.tsx/ });
  await expect(readmeTab).toBeVisible();
  await expect(mainTab).toBeVisible();

  // 切回 README.md，编辑器内容随之变化
  await readmeTab.click();
  await expect(page.locator(".cm-content")).toContainText("Mock Project");
  await expect(page.locator(".cm-content")).not.toContainText("hello from mock");
});

/** 已存盘文件关闭前会静默自动保存；只有未命名文档仍需丢弃确认。 */
test("流程：关闭有未保存改动的已存盘文档时自动保存", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");

  await emitMenu(page, "menu-open-folder");

  // 打开两个文件，使 Tab 可关闭（closable 需 openDocuments.length > 1）
  await page.locator(".tree-row", { hasText: "README.md" }).dblclick();
  await expect(page.locator(".cm-content")).toContainText("Mock Project");
  await page.locator(".tree-row", { hasText: "src" }).dblclick();
  await page.locator(".tree-row", { hasText: "main.tsx" }).dblclick();
  await expect(page.locator(".cm-content")).toContainText("hello from mock");

  // 在当前活动文档（main.tsx）产生改动
  await page.locator(".cm-content").click();
  await page.keyboard.type("EDITED");
  await expect(page.getByRole("tab", { name: /main\.tsx/ })).toContainText("•");

  // 点击该 Tab 上的关闭按钮（活动 Tab 才显示关闭按钮）
  await page.getByRole("button", { name: /Close main\.tsx/ }).click();

  await expect(page.getByRole("tab", { name: /main\.tsx/ })).toHaveCount(0);
  const calls = await page.evaluate(() => {
    return (window as unknown as { __tauriInvokeCalls?: Array<{ cmd: string }> }).__tauriInvokeCalls ?? [];
  });
  expect(calls.some((call) => call.cmd === "save_text_file")).toBe(true);
});
