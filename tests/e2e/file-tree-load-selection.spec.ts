import { expect, type Page, test } from "@playwright/test";

import { emitMenu, getTauriInvokeCalls, openMockFolder } from "./helpers";
import {
  clearMockInvokeError,
  deleteMockPath,
  emitMockFsChange,
  installTauriMock,
  releaseAllMockInvokes,
  releaseMockInvoke,
  renameMockPath,
  setMockFile,
  type TauriMockScenario,
  waitForMockInvoke,
} from "./tauri-mock";

const projectPath = "/mock/project";
const srcPath = `${projectPath}/src`;

const selectionScenario: TauriMockScenario = {
  directories: {
    [projectPath]: [
      { name: "src", path: srcPath, relativePath: "src", kind: "directory" },
      { name: "a.txt", path: `${projectPath}/a.txt`, relativePath: "a.txt", kind: "file", size: 1 },
      { name: "b.txt", path: `${projectPath}/b.txt`, relativePath: "b.txt", kind: "file", size: 1 },
      { name: "c.txt", path: `${projectPath}/c.txt`, relativePath: "c.txt", kind: "file", size: 1 },
      { name: "d.txt", path: `${projectPath}/d.txt`, relativePath: "d.txt", kind: "file", size: 1 },
    ],
    [srcPath]: [
      { name: "main.tsx", path: `${srcPath}/main.tsx`, relativePath: "src/main.tsx", kind: "file", size: 10 },
    ],
  },
  fileContents: {
    [`${projectPath}/a.txt`]: "a",
    [`${projectPath}/b.txt`]: "b",
    [`${projectPath}/c.txt`]: "c",
    [`${projectPath}/d.txt`]: "d",
    [`${srcPath}/main.tsx`]: "main",
  },
};

async function mount(page: Page, scenario: TauriMockScenario = {}): Promise<void> {
  await installTauriMock(page, scenario);
  await page.goto("/");
}

async function openWorkspace(page: Page, scenario: TauriMockScenario = {}): Promise<void> {
  await mount(page, scenario);
  await openMockFolder(page);
}

const row = (page: Page, name: string) => page.locator(".tree-row", { hasText: name }).first();

test("TREE-LOAD-001：根目录加载状态结束后节点只出现一次", async ({ page }) => {
  const gate = `list_directory:${projectPath}`;
  await mount(page, { invokeGates: [gate] });

  await emitMenu(page, "menu-open-folder");
  await waitForMockInvoke(page, gate);
  await expect(page.getByText("Loading folder...")).toBeVisible();
  await releaseMockInvoke(page, gate);

  await expect(row(page, "README.md")).toHaveCount(1);
  await expect(row(page, "package.json")).toHaveCount(1);
  await expect(page.getByText("Loading folder...")).toHaveCount(0);
});

test("TREE-LOAD-002：空目录显示空状态且根目录仍可新建", async ({ page }) => {
  await mount(page, { directories: { [projectPath]: [] } });
  await emitMenu(page, "menu-open-folder");

  await expect(page.getByRole("tree", { name: "project" }).getByText("No files in this folder.")).toBeVisible();
  await page.locator('button.tree-row-root[data-tree-drop-scope="main"]').click({ button: "right" });
  await expect(page.locator(".file-tree-context-item", { hasText: "New File" })).toBeEnabled();
  await expect(page.locator(".file-tree-context-item", { hasText: "New Folder" })).toBeEnabled();
});

test("TREE-LOAD-003：根目录读取失败显示错误且可重新打开其他目录", async ({ page }) => {
  await mount(page, {
    folderDialogPaths: [projectPath, "/mock/healthy"],
    directories: {
      "/mock/healthy": [
        { name: "healthy.txt", path: "/mock/healthy/healthy.txt", relativePath: "healthy.txt", kind: "file" },
      ],
    },
    invokeErrors: { [`list_directory:${projectPath}`]: "Permission denied for project" },
  });

  await emitMenu(page, "menu-open-folder");
  await expect(page.getByText(/permission denied for project/i)).toBeVisible();
  await emitMenu(page, "menu-open-folder");

  await expect(row(page, "healthy.txt")).toBeVisible();
  await expect(page.getByText(/permission denied for project/i)).toHaveCount(0);
});

test("TREE-LOAD-004：切换到工作区 B 后 A 的慢响应不能覆盖 B", async ({ page }) => {
  const pathA = "/mock/a";
  const pathB = "/mock/b";
  const gateA = `list_directory:${pathA}`;
  await mount(page, {
    folderDialogPaths: [pathA, pathB],
    invokeGates: [gateA],
    directories: {
      [pathA]: [{ name: "from-a.txt", path: `${pathA}/from-a.txt`, relativePath: "from-a.txt", kind: "file" }],
      [pathB]: [{ name: "from-b.txt", path: `${pathB}/from-b.txt`, relativePath: "from-b.txt", kind: "file" }],
    },
  });

  await emitMenu(page, "menu-open-folder");
  await waitForMockInvoke(page, gateA);
  await emitMenu(page, "menu-open-folder");
  await expect(row(page, "from-b.txt")).toBeVisible();
  await releaseMockInvoke(page, gateA);

  await expect(row(page, "from-b.txt")).toBeVisible();
  await expect(row(page, "from-a.txt")).toHaveCount(0);
});

test("TREE-LOAD-005：目录快速重复展开只执行一次子目录读取", async ({ page }) => {
  const gate = `list_directory:${srcPath}`;
  await openWorkspace(page, { ...selectionScenario, invokeGates: [gate] });

  await row(page, "src").dblclick();
  await row(page, "src").dblclick();
  await waitForMockInvoke(page, gate);
  await releaseAllMockInvokes(page, gate);

  await expect(row(page, "main.tsx")).toHaveCount(1);
  const calls = await getTauriInvokeCalls(page);
  expect(calls?.filter((call) => call.cmd === "list_directory" && call.args.path === srcPath)).toHaveLength(1);
});

test("TREE-LOAD-006：折叠后重新展开已加载目录不会重复读取", async ({ page }) => {
  await openWorkspace(page, selectionScenario);
  await row(page, "src").dblclick();
  await expect(row(page, "main.tsx")).toBeVisible();
  await row(page, "src").dblclick();
  await expect(row(page, "main.tsx")).toHaveCount(0);
  await row(page, "src").dblclick();
  await expect(row(page, "main.tsx")).toBeVisible();

  const calls = await getTauriInvokeCalls(page);
  expect(calls?.filter((call) => call.cmd === "list_directory" && call.args.path === srcPath)).toHaveLength(1);
});

test("TREE-LOAD-007：子目录读取失败后清除错误可重试成功", async ({ page }) => {
  const key = `list_directory:${srcPath}`;
  await openWorkspace(page, { ...selectionScenario, invokeErrors: { [key]: "src temporarily denied" } });

  await row(page, "src").dblclick();
  await expect(page.getByText("src temporarily denied")).toBeVisible();
  await clearMockInvokeError(page, key);
  await row(page, "src").click({ button: "right" });
  await page.locator(".file-tree-context-item", { hasText: "Refresh" }).click();

  await expect(row(page, "main.tsx")).toBeVisible();
  await expect(page.getByText("src temporarily denied")).toHaveCount(0);
});

test("TREE-LOAD-008：外部新增刷新根目录时保留已展开子目录", async ({ page }) => {
  await openWorkspace(page, selectionScenario);
  await row(page, "src").dblclick();
  await expect(row(page, "main.tsx")).toBeVisible();

  await setMockFile(page, `${projectPath}/external-added.txt`, "added", { lastModified: 1_700_000_000_500 });
  await emitMockFsChange(page, [projectPath]);

  await expect(row(page, "external-added.txt")).toBeVisible();
  await expect(row(page, "main.tsx")).toBeVisible();
  await expect(row(page, "src")).toHaveAttribute("aria-expanded", "true");
});

test("TREE-LOAD-010：展开加载过程中目录被删除会结束 loading 并显示错误", async ({ page }) => {
  const gate = `list_directory:${srcPath}`;
  await openWorkspace(page, { ...selectionScenario, invokeGates: [gate] });

  await row(page, "src").dblclick();
  await waitForMockInvoke(page, gate);
  await deleteMockPath(page, srcPath);
  await releaseMockInvoke(page, gate);

  await expect(page.getByText(/not found/i)).toBeVisible();
  await expect(row(page, "src")).not.toContainText("...");
});

test("TREE-LOAD-011：根目录折叠再展开保留节点数据和选择", async ({ page }) => {
  await openWorkspace(page, selectionScenario);
  await row(page, "b.txt").click();
  await expect(row(page, "b.txt")).toHaveAttribute("aria-selected", "true");

  const mainRoot = page.locator('button.tree-row-root[data-tree-drop-scope="main"]');
  await mainRoot.click();
  await expect(row(page, "b.txt")).toHaveCount(0);
  await mainRoot.click();

  await expect(row(page, "b.txt")).toBeVisible();
  await expect(row(page, "b.txt")).toHaveAttribute("aria-selected", "true");
});

test("TREE-SELECT-001：单击文件只选择，双击后才打开一个 Tab", async ({ page }) => {
  await openWorkspace(page, selectionScenario);

  await row(page, "a.txt").click();
  await expect(row(page, "a.txt")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: /a\.txt/ })).toHaveCount(0);
  await row(page, "a.txt").dblclick();

  await expect(page.getByRole("tab", { name: /a\.txt/ })).toHaveCount(1);
});

test("TREE-SELECT-002：目录单击只选择，双击切换展开且不创建 Tab", async ({ page }) => {
  await openWorkspace(page, selectionScenario);

  await row(page, "src").click();
  await expect(row(page, "src")).toHaveAttribute("aria-selected", "true");
  await expect(row(page, "src")).toHaveAttribute("aria-expanded", "false");
  await row(page, "src").dblclick();

  await expect(row(page, "src")).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("tab", { name: /src/ })).toHaveCount(0);
});

test("TREE-SELECT-003：普通单击新节点清除旧选择", async ({ page }) => {
  await openWorkspace(page, selectionScenario);
  await row(page, "a.txt").click();
  await row(page, "c.txt").click();

  await expect(row(page, "a.txt")).toHaveAttribute("aria-selected", "false");
  await expect(row(page, "c.txt")).toHaveAttribute("aria-selected", "true");
});

test("TREE-SELECT-004：Ctrl 单击追加并再次移除单个节点", async ({ page }) => {
  await openWorkspace(page, selectionScenario);
  await row(page, "a.txt").click();
  await row(page, "c.txt").click({ modifiers: ["Control"] });

  await expect(row(page, "a.txt")).toHaveAttribute("aria-selected", "true");
  await expect(row(page, "c.txt")).toHaveAttribute("aria-selected", "true");
  await row(page, "c.txt").click({ modifiers: ["Control"] });
  await expect(row(page, "a.txt")).toHaveAttribute("aria-selected", "true");
  await expect(row(page, "c.txt")).toHaveAttribute("aria-selected", "false");
});

test("TREE-SELECT-005：Shift 单击按可见顺序正反向连续选择", async ({ page }) => {
  await openWorkspace(page, selectionScenario);
  await row(page, "a.txt").click();
  await row(page, "d.txt").click({ modifiers: ["Shift"] });

  for (const name of ["a.txt", "b.txt", "c.txt", "d.txt"]) {
    await expect(row(page, name)).toHaveAttribute("aria-selected", "true");
  }
  await row(page, "b.txt").click();
  await row(page, "a.txt").click({ modifiers: ["Shift"] });
  await expect(row(page, "a.txt")).toHaveAttribute("aria-selected", "true");
  await expect(row(page, "b.txt")).toHaveAttribute("aria-selected", "true");
  await expect(row(page, "c.txt")).toHaveAttribute("aria-selected", "false");
});

test("TREE-SELECT-007：右键多选中的节点保留整组选区", async ({ page }) => {
  await openWorkspace(page, selectionScenario);
  await row(page, "a.txt").click();
  await row(page, "b.txt").click({ modifiers: ["Control"] });
  await row(page, "b.txt").click({ button: "right" });

  await expect(row(page, "a.txt")).toHaveAttribute("aria-selected", "true");
  await expect(row(page, "b.txt")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".file-tree-context-menu")).toBeVisible();
});

test("TREE-SELECT-008：右键未选节点时只选择该节点", async ({ page }) => {
  await openWorkspace(page, selectionScenario);
  await row(page, "a.txt").click();
  await row(page, "b.txt").click({ modifiers: ["Control"] });
  await row(page, "d.txt").click({ button: "right" });

  await expect(row(page, "a.txt")).toHaveAttribute("aria-selected", "false");
  await expect(row(page, "b.txt")).toHaveAttribute("aria-selected", "false");
  await expect(row(page, "d.txt")).toHaveAttribute("aria-selected", "true");
});

test("TREE-SELECT-009：空白处右键以根目录为目标且不继承旧节点", async ({ page }) => {
  await openWorkspace(page, selectionScenario);
  await row(page, "a.txt").click({ button: "right" });
  await page.keyboard.press("Escape");

  const mainScroll = page.locator(".file-tree-scroll").first();
  const box = await mainScroll.boundingBox();
  if (!box) throw new Error("main file tree scroll area has no bounding box");
  await mainScroll.click({ button: "right", position: { x: box.width - 5, y: box.height - 5 } });

  await expect(page.locator(".file-tree-context-item", { hasText: "New File" })).toBeEnabled();
  await expect(page.locator(".file-tree-context-item", { hasText: "Rename" })).toBeDisabled();
  await expect(page.locator(".file-tree-context-item", { hasText: "Move to Trash" })).toBeDisabled();
});

test("TREE-SELECT-012：活动文件高亮与用户选择可以分别存在", async ({ page }) => {
  await openWorkspace(page, selectionScenario);
  await row(page, "a.txt").dblclick();
  await row(page, "c.txt").click();

  await expect(row(page, "a.txt")).toHaveClass(/tree-row-document-active/);
  await expect(row(page, "c.txt")).toHaveAttribute("aria-selected", "true");
  await expect(row(page, "a.txt")).toHaveAttribute("aria-selected", "false");
});

test("TREE-SELECT-013：外部删除已选节点后不会保留可操作的过期选择", async ({ page }) => {
  const target = `${projectPath}/b.txt`;
  await openWorkspace(page, selectionScenario);
  await row(page, "b.txt").click();
  await deleteMockPath(page, target);

  await emitMockFsChange(page, [projectPath]);

  await expect(row(page, "b.txt")).toHaveCount(0);
  await page.getByRole("tree", { name: "project" }).press("Control+C");
  const calls = await getTauriInvokeCalls(page);
  expect(
    calls?.some(
      (call) =>
        call.cmd === "copy_files_to_clipboard" && Array.isArray(call.args.paths) && call.args.paths.includes(target),
    ),
  ).toBe(false);
});

test("TREE-SELECT-014：外部重命名已选节点后选择跟随新路径", async ({ page }) => {
  const source = `${projectPath}/b.txt`;
  const target = `${projectPath}/renamed-b.txt`;
  await openWorkspace(page, selectionScenario);
  await row(page, "b.txt").click();
  await renameMockPath(page, source, target);

  await emitMockFsChange(page, [projectPath]);

  await expect(row(page, "renamed-b.txt")).toHaveAttribute("aria-selected", "true");
});
