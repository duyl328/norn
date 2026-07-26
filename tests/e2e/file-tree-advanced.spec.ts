import { expect, type Locator, type Page, test } from "@playwright/test";

import { emitMenu, getTauriInvokeCalls, openMockFolder } from "./helpers";
import {
  clearMockInvokeError,
  deleteMockPath,
  gateNextMockInvokeSnapshot,
  installTauriMock,
  releaseMockInvoke,
  setMockFile,
  setMockInvokeError,
  type TauriMockScenario,
  waitForMockInvoke,
} from "./tauri-mock";

const projectPath = "/mock/project";
const scratchPath = "/mock/scratch";

const directory = (name: string, parent = projectPath, extra: Record<string, unknown> = {}) => ({
  name,
  path: `${parent}/${name}`,
  relativePath: parent === projectPath ? name : `${parent.slice(projectPath.length + 1)}/${name}`,
  kind: "directory",
  ...extra,
});

const file = (name: string, parent = projectPath, extra: Record<string, unknown> = {}) => ({
  name,
  path: `${parent}/${name}`,
  relativePath: parent === projectPath ? name : `${parent.slice(projectPath.length + 1)}/${name}`,
  kind: "file",
  size: 1,
  ...extra,
});

async function openWorkspace(page: Page, scenario: TauriMockScenario): Promise<void> {
  await installTauriMock(page, scenario);
  await page.goto("/");
  await openMockFolder(page);
}

const mainRegion = (page: Page) => page.locator(".project-panel-main-region");
const scratchRegion = (page: Page) => page.locator(".project-panel-scratch");
const row = (region: Locator, name: string) => region.locator(".tree-row", { hasText: name }).first();

async function refreshFromContextMenu(page: Page, target: Locator): Promise<void> {
  await target.click({ button: "right" });
  await page.locator(".file-tree-context-item", { hasText: "Refresh" }).click();
}

test("TREE-LOAD-009：较旧的刷新响应不能覆盖较新的目录内容", async ({ page }) => {
  const gate = `list_directory:${projectPath}`;
  await openWorkspace(page, {
    directories: {
      [projectPath]: [file("old.txt")],
      [scratchPath]: [],
    },
    fileContents: { [`${projectPath}/old.txt`]: "old" },
  });

  await gateNextMockInvokeSnapshot(page, gate);
  const root = mainRegion(page).locator('button.tree-row-root[data-tree-drop-scope="main"]');
  await refreshFromContextMenu(page, root);
  await waitForMockInvoke(page, gate);

  await deleteMockPath(page, `${projectPath}/old.txt`);
  await setMockFile(page, `${projectPath}/new.txt`, "new");
  await refreshFromContextMenu(page, root);
  await expect(row(mainRegion(page), "new.txt")).toBeVisible();

  await releaseMockInvoke(page, gate);
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  await expect(row(mainRegion(page), "new.txt")).toBeVisible();
  await expect(row(mainRegion(page), "old.txt")).toHaveCount(0);
});

const nestedScenario: TauriMockScenario = {
  directories: {
    [projectPath]: [directory("loaded"), directory("untouched")],
    [`${projectPath}/loaded`]: [directory("nested", `${projectPath}/loaded`), file("one.txt", `${projectPath}/loaded`)],
    [`${projectPath}/loaded/nested`]: [file("deep.txt", `${projectPath}/loaded/nested`)],
    [`${projectPath}/untouched`]: [file("not-loaded.txt", `${projectPath}/untouched`)],
    [scratchPath]: [],
  },
};

async function loadNestedDirectories(page: Page): Promise<void> {
  await row(mainRegion(page), "loaded").dblclick();
  await row(mainRegion(page), "nested").dblclick();
  await expect(row(mainRegion(page), "deep.txt")).toBeVisible();
}

test("TREE-LOAD-012：全部展开只恢复已安全加载的目录且不触发递归读取", async ({ page }) => {
  await openWorkspace(page, nestedScenario);
  await loadNestedDirectories(page);
  await mainRegion(page).getByRole("button", { name: "Collapse all folders" }).click();

  await mainRegion(page).getByRole("button", { name: "Expand all folders" }).click();
  await expect(row(mainRegion(page), "nested")).toBeVisible();
  await expect(row(mainRegion(page), "deep.txt")).toBeVisible();
  await expect(row(mainRegion(page), "not-loaded.txt")).toHaveCount(0);

  const calls = await getTauriInvokeCalls(page);
  expect(
    calls?.filter((call) => call.cmd === "list_directory" && call.args.path === `${projectPath}/untouched`),
  ).toHaveLength(0);
});

test("TREE-LOAD-013：全部折叠收起所有后代且之后仍可恢复展开", async ({ page }) => {
  await openWorkspace(page, nestedScenario);
  await loadNestedDirectories(page);

  await mainRegion(page).getByRole("button", { name: "Collapse all folders" }).click();
  await expect(row(mainRegion(page), "loaded")).toHaveAttribute("aria-expanded", "false");
  await expect(row(mainRegion(page), "nested")).toHaveCount(0);

  await row(mainRegion(page), "loaded").dblclick();
  await expect(row(mainRegion(page), "nested")).toBeVisible();
  await row(mainRegion(page), "nested").dblclick();
  await expect(row(mainRegion(page), "deep.txt")).toBeVisible();
});

test("TREE-LOAD-015：隐藏项、点文件、Git 目录、忽略文件和普通文件按规则展示", async ({ page }) => {
  await openWorkspace(page, {
    directories: {
      [projectPath]: [
        directory(".git", projectPath, { isHidden: true }),
        file(".env", projectPath, { isHidden: true }),
        file("ignored.log"),
        file("normal.txt"),
      ],
      [scratchPath]: [],
    },
    gitIgnoredFiles: ["ignored.log"],
  });

  await expect(row(mainRegion(page), ".git")).toHaveClass(/tree-row-hidden/);
  await expect(row(mainRegion(page), ".env")).toHaveClass(/tree-row-hidden/);
  await expect(row(mainRegion(page), "ignored.log")).toHaveClass(/tree-row-git-ignored/);
  await expect(row(mainRegion(page), "normal.txt")).not.toHaveClass(/tree-row-hidden/);
});

test("TREE-LOAD-016：指回祖先的符号链接标记循环且禁止继续展开", async ({ page }) => {
  const realPath = `${projectPath}/real`;
  const loopPath = `${realPath}/back-to-real`;
  await openWorkspace(page, {
    directories: {
      [projectPath]: [directory("real", projectPath, { canonicalPath: realPath })],
      [realPath]: [
        directory("back-to-real", realPath, {
          canonicalPath: realPath,
          isSymlink: true,
          targetKind: "directory",
        }),
      ],
      [loopPath]: [file("must-not-load.txt", loopPath)],
      [scratchPath]: [],
    },
  });

  await row(mainRegion(page), "real").dblclick();
  const loop = row(mainRegion(page), "back-to-real");
  await expect(loop).toContainText("loop");
  await expect(loop).toHaveClass(/tree-row-muted/);
  await loop.dblclick();

  const calls = await getTauriInvokeCalls(page);
  expect(calls?.filter((call) => call.cmd === "list_directory" && call.args.path === loopPath)).toHaveLength(0);
});

test("TREE-LOAD-018：主工作区与临时树的加载和错误状态互不串扰", async ({ page }) => {
  const mainError = `list_directory:${projectPath}`;
  const scratchError = `list_directory:${scratchPath}`;
  await openWorkspace(page, {
    directories: {
      [projectPath]: [file("main.txt")],
      [scratchPath]: [file("scratch.txt", scratchPath)],
    },
    invokeErrors: { [mainError]: "main denied" },
  });

  await expect(mainRegion(page).getByText("main denied")).toBeVisible();
  await expect(row(scratchRegion(page), "scratch.txt")).toBeVisible();

  await clearMockInvokeError(page, mainError);
  await refreshFromContextMenu(page, mainRegion(page).locator('button.tree-row-root[data-tree-drop-scope="main"]'));
  await expect(row(mainRegion(page), "main.txt")).toBeVisible();

  await setMockInvokeError(page, scratchError, "scratch denied");
  await refreshFromContextMenu(
    page,
    scratchRegion(page).locator('button.tree-row-root[data-tree-drop-scope="scratch"]'),
  );
  await expect(scratchRegion(page).getByText("scratch denied")).toBeVisible();
  await expect(row(mainRegion(page), "main.txt")).toBeVisible();
  await expect(mainRegion(page).getByText("scratch denied")).toHaveCount(0);
});

test("TREE-SELECT-006：折叠后复制不会包含不可见的过期选中路径", async ({ page }) => {
  const srcPath = `${projectPath}/src`;
  await openWorkspace(page, {
    directories: {
      [projectPath]: [directory("src"), file("visible.txt")],
      [srcPath]: [file("hidden.txt", srcPath)],
      [scratchPath]: [],
    },
  });

  await row(mainRegion(page), "src").dblclick();
  await row(mainRegion(page), "visible.txt").click();
  await row(mainRegion(page), "hidden.txt").click({ modifiers: ["Control"] });
  await row(mainRegion(page), "src").locator(".tree-row-toggle").click();
  await expect(row(mainRegion(page), "hidden.txt")).toHaveCount(0);

  await page.getByRole("tree", { name: "project" }).press("Control+C");
  const calls = await getTauriInvokeCalls(page);
  const copyCall = calls?.filter((call) => call.cmd === "copy_files_to_clipboard").at(-1);
  expect(copyCall?.args.paths).toEqual([`${projectPath}/visible.txt`]);
});

test("TREE-SELECT-010：主工作区与临时树选择互斥且操作使用正确作用域", async ({ page }) => {
  await openWorkspace(page, {
    directories: {
      [projectPath]: [file("main.txt")],
      [scratchPath]: [file("scratch.txt", scratchPath)],
    },
  });

  const mainFile = row(mainRegion(page), "main.txt");
  const scratchFile = row(scratchRegion(page), "scratch.txt");
  await mainFile.click();
  await expect(mainFile).toHaveAttribute("aria-selected", "true");
  await scratchFile.click();
  await expect(mainFile).toHaveAttribute("aria-selected", "false");
  await expect(scratchFile).toHaveAttribute("aria-selected", "true");

  await page.getByRole("tree", { name: "Temporary Folder" }).press("Control+C");
  const calls = await getTauriInvokeCalls(page);
  const copyCall = calls?.filter((call) => call.cmd === "copy_files_to_clipboard").at(-1);
  expect(copyCall?.args.paths).toEqual([`${scratchPath}/scratch.txt`]);
});

test("TREE-SELECT-011：再次点击已选虚拟行不改变文件树滚动位置", async ({ page }) => {
  const manyFiles = Array.from({ length: 160 }, (_, index) => file(`item-${String(index).padStart(3, "0")}.txt`));
  await openWorkspace(page, {
    directories: { [projectPath]: manyFiles, [scratchPath]: [] },
  });

  const scroll = mainRegion(page).locator(".file-tree-scroll");
  await scroll.evaluate((element) => {
    element.scrollTop = 1_800;
  });
  await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(1_000);

  const visibleRow = mainRegion(page).locator(".file-tree-virtual-row .tree-row").nth(4);
  const targetName = await visibleRow.locator(".tree-row-name").textContent();
  if (!targetName) throw new Error("virtualized file row has no name");
  const targetRow = row(mainRegion(page), targetName);
  await targetRow.click();
  const before = await scroll.evaluate((element) => element.scrollTop);
  await targetRow.click();
  const after = await scroll.evaluate((element) => element.scrollTop);
  expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
});
