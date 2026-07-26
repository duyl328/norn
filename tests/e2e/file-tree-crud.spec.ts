import { expect, type Page, test } from "@playwright/test";

import { getTauriInvokeCalls, openMockFolder, openRootContextMenu } from "./helpers";
import {
  clearMockInvokeError,
  deleteMockPath,
  installTauriMock,
  setMockInvokeError,
  type TauriMockScenario,
} from "./tauri-mock";

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
  await expect(page.locator(".tree-row", { hasText: "README.md" })).toBeVisible();
}

async function mount(page: Page, scenario: TauriMockScenario = {}): Promise<void> {
  await installTauriMock(page, scenario);
  await page.goto("/");
  await openFolder(page);
}

const treeRow = (page: Page, name: string) => page.locator(".tree-row", { hasText: name }).first();

async function openNodeMenu(page: Page, name: string): Promise<void> {
  await treeRow(page, name).click({ button: "right" });
  await expect(page.locator(".file-tree-context-menu")).toBeVisible();
}

async function chooseMenu(page: Page, label: string): Promise<void> {
  await page.locator(".file-tree-context-item", { hasText: label }).click();
}

/**
 * 用例 1：新建文件。
 * 对根目录右键 → New File → 在命名对话框输入名字 → Create →
 * 断言新文件出现在文件树（create_file 写入可变目录表，刷新后可见）。
 */
test("TREE-CRUD-001：在根目录和嵌套目录新建文件后刷新并打开新文件", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");
  await openFolder(page);

  // 新建前不存在该文件。
  await expect(page.locator(".tree-row", { hasText: "notes.txt" })).toHaveCount(0);

  await openRootContextMenu(page);
  await page.locator(".file-tree-context-item", { hasText: "New File" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "New File" })).toBeVisible();
  await dialog.getByRole("textbox").fill("notes.txt");
  await dialog.getByRole("button", { name: "Create" }).click();

  // 成功后刷新该目录的 list_directory，可变 mock 返回包含新文件 → 树里出现。
  await expect(page.locator(".tree-row", { hasText: "notes.txt" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /notes\.txt/ })).toBeVisible();

  await treeRow(page, "src").dblclick();
  await openNodeMenu(page, "src");
  await chooseMenu(page, "New File");
  await page.getByRole("dialog").getByRole("textbox").fill("nested.txt");
  await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
  await expect(treeRow(page, "nested.txt")).toBeVisible();
  await expect(page.getByRole("tab", { name: /nested\.txt/ })).toBeVisible();
});

/**
 * 用例 2：新建文件夹（走 create_directory）。
 */
test("TREE-CRUD-002：在根目录和嵌套目录新建文件夹后节点可展开", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");
  await openFolder(page);

  await expect(page.locator(".tree-row", { hasText: "components" })).toHaveCount(0);

  await openRootContextMenu(page);
  await page.locator(".file-tree-context-item", { hasText: "New Folder" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "New Folder" })).toBeVisible();
  await dialog.getByRole("textbox").fill("components");
  await dialog.getByRole("button", { name: "Create" }).click();

  await expect(page.locator(".tree-row", { hasText: "components" })).toBeVisible();
  await treeRow(page, "components").dblclick();
  await expect(treeRow(page, "components")).toHaveAttribute("aria-expanded", "true");

  await treeRow(page, "src").dblclick();
  await openNodeMenu(page, "src");
  await chooseMenu(page, "New Folder");
  await page.getByRole("dialog").getByRole("textbox").fill("nested-folder");
  await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
  await expect(treeRow(page, "nested-folder")).toBeVisible();
});

/**
 * 用例 3：重命名文件。
 * 右键文件行 README.md → Rename → 在命名对话框清空后输入新名字 → Rename →
 * 断言新名字出现、旧名字消失（rename_path 修改可变目录表，刷新后反映）。
 */
test("TREE-CRUD-007：重命名文件后旧路径消失且选择迁移到新路径", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");
  await openFolder(page);

  await page.locator(".tree-row", { hasText: "README.md" }).click({ button: "right" });
  await expect(page.locator(".file-tree-context-menu")).toBeVisible();
  await page.locator(".file-tree-context-item", { hasText: "Rename" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Rename" })).toBeVisible();
  const input = dialog.getByRole("textbox");
  await input.fill("");
  await input.fill("renamed.md");
  await dialog.getByRole("button", { name: "Rename" }).click();

  // 成功后刷新目录，可变 mock 返回新名字 → 树里旧名消失、新名出现。
  await expect(page.locator(".tree-row", { hasText: "README.md" })).toHaveCount(0);
  await expect(page.locator(".tree-row", { hasText: "renamed.md" })).toBeVisible();
  await expect(treeRow(page, "renamed.md")).toHaveAttribute("aria-selected", "true");
});

/**
 * 用例 4：删除到回收站。
 * 右键文件行 package.json → Move to Trash → 在回收站对话框确认 →
 * 断言该文件从树消失（trash_path 从可变目录表移除，刷新后不再出现）。
 */
test("TREE-CRUD-011：回收站成功后节点消失且过期选择不可再操作", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");
  await openFolder(page);

  await expect(page.locator(".tree-row", { hasText: "package.json" })).toBeVisible();

  await page.locator(".tree-row", { hasText: "package.json" }).click({ button: "right" });
  await expect(page.locator(".file-tree-context-menu")).toBeVisible();
  await page.locator(".file-tree-context-item", { hasText: "Move to Trash" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Move to Trash?" })).toBeVisible();
  await dialog.getByRole("button", { name: "Move to Trash" }).click();

  // 成功后刷新目录，可变 mock 已移除该条目 → 树里不再出现。
  await expect(page.locator(".tree-row", { hasText: "package.json" })).toHaveCount(0);
  await page.getByRole("tree", { name: "project" }).press("Control+C");
  const calls = await getTauriInvokeCalls(page);
  expect(
    calls?.some(
      (call) =>
        call.cmd === "copy_files_to_clipboard" &&
        Array.isArray(call.args.paths) &&
        call.args.paths.includes("/mock/project/package.json"),
    ),
  ).toBe(false);
});

test("TREE-CRUD-003：空白名称阻止新建和重命名且保留对话框", async ({ page }) => {
  await mount(page);
  await openRootContextMenu(page);
  await chooseMenu(page, "New File");
  const createDialog = page.getByRole("dialog");
  await createDialog.getByRole("textbox").fill("   ");
  await createDialog.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("Enter a name.")).toBeVisible();
  await expect(createDialog).toBeVisible();
  await createDialog.getByRole("button", { name: "Cancel" }).click();

  await openNodeMenu(page, "README.md");
  await chooseMenu(page, "Rename");
  const renameDialog = page.getByRole("dialog");
  await renameDialog.getByRole("textbox").fill("");
  await renameDialog.getByRole("button", { name: "Rename" }).click();
  await expect(page.getByText("Enter a name.")).toBeVisible();
  await expect(renameDialog).toBeVisible();
});

test("TREE-CRUD-004/005：非法名和同名项被拒绝后保留输入以便修改", async ({ page }) => {
  await mount(page);
  await openRootContextMenu(page);
  await chooseMenu(page, "New File");
  const dialog = page.getByRole("dialog");
  const input = dialog.getByRole("textbox");

  await setMockInvokeError(page, "create_file", "Invalid Windows file name");
  await input.fill("CON.txt");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("Invalid Windows file name")).toBeVisible();
  await expect(input).toHaveValue("CON.txt");

  await setMockInvokeError(page, "create_file", "README.md already exists");
  await input.fill("README.md");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("README.md already exists")).toBeVisible();
  await expect(input).toHaveValue("README.md");
});

test("TREE-CRUD-006：提交新建时父目录消失后刷新掉幽灵目录", async ({ page }) => {
  await mount(page);
  await treeRow(page, "src").dblclick();
  await openNodeMenu(page, "src");
  await chooseMenu(page, "New File");
  await page.getByRole("dialog").getByRole("textbox").fill("orphan.txt");
  await deleteMockPath(page, "/mock/project/src");
  await setMockInvokeError(page, "create_file", "Parent directory no longer exists");
  await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();

  await expect(page.getByText("Parent directory no longer exists")).toBeVisible();
  await expect(treeRow(page, "orphan.txt")).toHaveCount(0);
  await expect(treeRow(page, "src")).toHaveCount(0);
});

test("TREE-CRUD-008：仅修改文件名大小写后路径正确刷新", async ({ page }) => {
  await mount(page);
  await openNodeMenu(page, "README.md");
  await chooseMenu(page, "Rename");
  await page.getByRole("dialog").getByRole("textbox").fill("readme.md");
  await page.getByRole("dialog").getByRole("button", { name: "Rename" }).click();
  await expect(treeRow(page, "readme.md")).toBeVisible();
  await expect(page.locator('.tree-row[title="/mock/project/README.md"]')).toHaveCount(0);
});

test("TREE-CRUD-009：重命名期间目标被外部删除后显示错误并刷新父目录", async ({ page }) => {
  const path = "/mock/project/README.md";
  await mount(page);
  await openNodeMenu(page, "README.md");
  await chooseMenu(page, "Rename");
  await page.getByRole("dialog").getByRole("textbox").fill("renamed.md");
  await deleteMockPath(page, path);
  await setMockInvokeError(page, `rename_path:${path}`, "Rename source no longer exists");
  await page.getByRole("dialog").getByRole("button", { name: "Rename" }).click();

  await expect(page.getByText("Rename source no longer exists")).toBeVisible();
  await expect(treeRow(page, "README.md")).toHaveCount(0);
  await expect(treeRow(page, "renamed.md")).toHaveCount(0);
});

test("TREE-CRUD-010：取消、Esc 和关闭删除确认均不调用回收站", async ({ page }) => {
  await mount(page);
  const openTrashDialog = async () => {
    await openNodeMenu(page, "package.json");
    await chooseMenu(page, "Move to Trash");
    await expect(page.getByRole("dialog")).toBeVisible();
  };

  await openTrashDialog();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await openTrashDialog();
  await page.keyboard.press("Escape");
  await openTrashDialog();
  await page.getByRole("dialog").getByRole("button", { name: "关闭" }).click();

  const calls = await getTauriInvokeCalls(page);
  expect(calls?.filter((call) => call.cmd === "trash_path")).toHaveLength(0);
});

test("TREE-CRUD-012：回收站失败后保留真实节点并允许重试", async ({ page }) => {
  const path = "/mock/project/package.json";
  await mount(page);
  await setMockInvokeError(page, `trash_path:${path}`, "Trash is temporarily unavailable");
  await openNodeMenu(page, "package.json");
  await chooseMenu(page, "Move to Trash");
  await page.getByRole("dialog").getByRole("button", { name: "Move to Trash" }).click();
  await expect(page.getByText("Trash is temporarily unavailable")).toBeVisible();
  await expect(treeRow(page, "package.json")).toBeVisible();

  await clearMockInvokeError(page, `trash_path:${path}`);
  await openNodeMenu(page, "package.json");
  await chooseMenu(page, "Move to Trash");
  await page.getByRole("dialog").getByRole("button", { name: "Move to Trash" }).click();
  await expect(treeRow(page, "package.json")).toHaveCount(0);
});

test("TREE-CRUD-013：根目录禁止重命名、剪切和删除", async ({ page }) => {
  await mount(page);
  await openRootContextMenu(page);
  await expect(page.locator(".file-tree-context-item", { hasText: "Rename" })).toBeDisabled();
  await expect(page.locator(".file-tree-context-item", { hasText: "Cut" })).toBeDisabled();
  await expect(page.locator(".file-tree-context-item", { hasText: "Move to Trash" })).toBeDisabled();
});

test("TREE-CRUD-014：不同目录同名文件只重命名完整路径对应项", async ({ page }) => {
  await mount(page, {
    directories: {
      "/mock/project/src": [
        { name: "README.md", path: "/mock/project/src/README.md", relativePath: "src/README.md", kind: "file" },
      ],
    },
  });
  await treeRow(page, "src").dblclick();
  const nested = page.locator('.tree-row[title="/mock/project/src/README.md"]');
  await nested.click({ button: "right" });
  await chooseMenu(page, "Rename");
  await page.getByRole("dialog").getByRole("textbox").fill("nested-readme.md");
  await page.getByRole("dialog").getByRole("button", { name: "Rename" }).click();

  await expect(page.locator('.tree-row[title="/mock/project/README.md"]')).toBeVisible();
  await expect(page.locator('.tree-row[title="/mock/project/src/nested-readme.md"]')).toBeVisible();
});

test("TREE-CRUD-015：中文空格 emoji 和无扩展名可完成新建重命名删除", async ({ page }) => {
  await mount(page);
  await openRootContextMenu(page);
  await chooseMenu(page, "New File");
  await page.getByRole("dialog").getByRole("textbox").fill("中文 空格 🚀");
  await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
  await expect(treeRow(page, "中文 空格 🚀")).toBeVisible();

  await openNodeMenu(page, "中文 空格 🚀");
  await chooseMenu(page, "Rename");
  await page.getByRole("dialog").getByRole("textbox").fill("改名 🚀");
  await page.getByRole("dialog").getByRole("button", { name: "Rename" }).click();
  await openNodeMenu(page, "改名 🚀");
  await chooseMenu(page, "Move to Trash");
  await page.getByRole("dialog").getByRole("button", { name: "Move to Trash" }).click();
  await expect(treeRow(page, "改名 🚀")).toHaveCount(0);
});

test("TREE-CRUD-016：操作成功但刷新失败后再次刷新收敛到真实状态", async ({ page }) => {
  const refreshKey = "list_directory:/mock/project";
  await mount(page);
  await openRootContextMenu(page);
  await chooseMenu(page, "New Folder");
  await page.getByRole("dialog").getByRole("textbox").fill("created-before-refresh-error");
  await setMockInvokeError(page, refreshKey, "Refresh failed after create");
  await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("Refresh failed after create")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await clearMockInvokeError(page, refreshKey);
  await openRootContextMenu(page);
  await chooseMenu(page, "Refresh");
  await expect(treeRow(page, "created-before-refresh-error")).toBeVisible();
});
