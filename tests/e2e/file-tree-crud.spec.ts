import { expect, type Page, test } from "@playwright/test";

import { openMockFolder, openRootContextMenu } from "./helpers";
import { installTauriMock } from "./tauri-mock";

/**
 * 文件树增删改（CRUD）流程的行为护栏。注入 Tauri mock 运行时后，真实驱动
 * 右键菜单 → 命名对话框 / 回收站对话框，断言操作成功后文件树（经 list_directory
 * 刷新）渲染出的真实结果。
 *
 * mock 的目录表是运行期可变的：create_file / create_directory / rename_path /
 * trash_path / move_path / copy_path 都会修改该表，使应用刷新目录时（再次
 * list_directory）看到更新后的结构。
 *
 * 选择器优先级：可见文本 > role > 稳定 class。右键菜单项与对话框按钮按可见文案命中。
 *
 * 修复说明：文件树行的 onContextMenu 现已 event.stopPropagation()，阻止冒泡到外层
 * .file-tree-scroll 的 onContextMenu（那里会把目标 node 覆盖为 null）。因此右键文件行
 * 能拿到正确的 node，Rename / Copy / Cut / Move to Trash 这些“针对具体节点”的菜单项
 * 不再被禁用，可经真实 UI 驱动（见“重命名文件 / 删除到回收站”用例）。
 */

async function openFolder(page: Page): Promise<void> {
  await openMockFolder(page);
  await expect(page.locator("button.tree-row", { hasText: "README.md" })).toBeVisible();
}

/**
 * 用例 1：新建文件。
 * 对根目录右键 → New File → 在命名对话框输入名字 → Create →
 * 断言新文件出现在文件树（create_file 写入可变目录表，刷新后可见）。
 */
test("CRUD：新建文件后文件出现在文件树", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");
  await openFolder(page);

  // 新建前不存在该文件。
  await expect(page.locator("button.tree-row", { hasText: "notes.txt" })).toHaveCount(0);

  await openRootContextMenu(page);
  await page.locator(".file-tree-context-item", { hasText: "New File" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "New File" })).toBeVisible();
  await dialog.getByRole("textbox").fill("notes.txt");
  await dialog.getByRole("button", { name: "Create" }).click();

  // 成功后刷新该目录的 list_directory，可变 mock 返回包含新文件 → 树里出现。
  await expect(page.locator("button.tree-row", { hasText: "notes.txt" })).toBeVisible();
});

/**
 * 用例 2：新建文件夹（走 create_directory）。
 */
test("CRUD：新建文件夹后目录出现在文件树", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");
  await openFolder(page);

  await expect(page.locator("button.tree-row", { hasText: "components" })).toHaveCount(0);

  await openRootContextMenu(page);
  await page.locator(".file-tree-context-item", { hasText: "New Folder" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "New Folder" })).toBeVisible();
  await dialog.getByRole("textbox").fill("components");
  await dialog.getByRole("button", { name: "Create" }).click();

  await expect(page.locator("button.tree-row", { hasText: "components" })).toBeVisible();
});

/**
 * 用例 3：重命名文件。
 * 右键文件行 README.md → Rename → 在命名对话框清空后输入新名字 → Rename →
 * 断言新名字出现、旧名字消失（rename_path 修改可变目录表，刷新后反映）。
 */
test("CRUD：重命名文件后新名出现旧名消失", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");
  await openFolder(page);

  await page.locator("button.tree-row", { hasText: "README.md" }).click({ button: "right" });
  await expect(page.locator(".file-tree-context-menu")).toBeVisible();
  await page.locator(".file-tree-context-item", { hasText: "Rename" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Rename" })).toBeVisible();
  const input = dialog.getByRole("textbox");
  await input.fill("");
  await input.fill("renamed.md");
  await dialog.getByRole("button", { name: "Rename" }).click();

  // 成功后刷新目录，可变 mock 返回新名字 → 树里旧名消失、新名出现。
  await expect(page.locator("button.tree-row", { hasText: "README.md" })).toHaveCount(0);
  await expect(page.locator("button.tree-row", { hasText: "renamed.md" })).toBeVisible();
});

/**
 * 用例 4：删除到回收站。
 * 右键文件行 package.json → Move to Trash → 在回收站对话框确认 →
 * 断言该文件从树消失（trash_path 从可变目录表移除，刷新后不再出现）。
 */
test("CRUD：删除到回收站后文件从树消失", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");
  await openFolder(page);

  await expect(page.locator("button.tree-row", { hasText: "package.json" })).toBeVisible();

  await page.locator("button.tree-row", { hasText: "package.json" }).click({ button: "right" });
  await expect(page.locator(".file-tree-context-menu")).toBeVisible();
  await page.locator(".file-tree-context-item", { hasText: "Move to Trash" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Move to Trash?" })).toBeVisible();
  await dialog.getByRole("button", { name: "Move to Trash" }).click();

  // 成功后刷新目录，可变 mock 已移除该条目 → 树里不再出现。
  await expect(page.locator("button.tree-row", { hasText: "package.json" })).toHaveCount(0);
});
