import { expect, type Locator, type Page, test } from "@playwright/test";

import { getTauriInvokeCalls, openMockFolder } from "./helpers";
import { installTauriMock, setMockInvokeError } from "./tauri-mock";

const root = "/mock/project";
const scratch = "/mock/scratch";
const external = "/external";
const dir = (name: string, parent = root) => ({
  name,
  path: `${parent}/${name}`,
  relativePath: name,
  kind: "directory",
});
const file = (name: string, parent = root) => ({
  name,
  path: `${parent}/${name}`,
  relativePath: name,
  kind: "file",
  size: 1,
});
const region = (page: Page, scope: "main" | "scratch" = "main") =>
  page.locator(scope === "main" ? ".project-panel-main-region" : ".project-panel-scratch");
const row = (page: Page, name: string, scope: "main" | "scratch" = "main") =>
  region(page, scope).locator(".tree-row:not(.tree-row-root)", { hasText: name }).first();
const rootRow = (page: Page, scope: "main" | "scratch" = "main") =>
  region(page, scope).locator(`button.tree-row-root[data-tree-drop-scope="${scope}"]`);

async function open(page: Page, extra: Parameters<typeof installTauriMock>[1] = {}) {
  await installTauriMock(page, {
    ...extra,
    directories: {
      [root]: [dir("dest"), file("a.txt"), file("b.txt")],
      [`${root}/dest`]: [],
      [scratch]: [dir("scratch-dest", scratch)],
      [`${scratch}/scratch-dest`]: [],
      [external]: [file("outside.txt", external), dir("outside-dir", external)],
      [`${external}/outside-dir`]: [file("nested 中文.txt", `${external}/outside-dir`)],
      ...extra.directories,
    },
    fileContents: {
      [`${root}/a.txt`]: "a",
      [`${root}/b.txt`]: "b",
      [`${external}/outside.txt`]: "outside",
      [`${external}/outside-dir/nested 中文.txt`]: "nested",
      ...extra.fileContents,
    },
  });
  await page.goto("/");
  await openMockFolder(page);
}

async function drag(source: Locator, target: Locator) {
  await source.dragTo(target);
}

async function dispatchHtmlDrag(source: Locator, target: Locator, drop = false) {
  await source.evaluate((element) =>
    element.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: new DataTransfer() })),
  );
  await target.evaluate(
    (element, shouldDrop) => {
      const transfer = new DataTransfer();
      element.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }));
      if (shouldDrop) element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    },
    drop,
  );
}

async function emitNativeDrop(page: Page, target: Locator, paths: string[]) {
  await page.waitForFunction(() =>
    (window as unknown as { __tauriMockHasListener: (event: string) => boolean }).__tauriMockHasListener(
      "tauri://drag-drop",
    ),
  );
  await target.evaluate((element, droppedPaths) => {
    const rect = element.getBoundingClientRect();
    const expectedPath = element.getAttribute("data-tree-drop-path");
    const expectedScope = element.getAttribute("data-tree-drop-scope");
    const candidates = [
      { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      { x: rect.left + rect.width * 0.75, y: rect.top + rect.height / 2 },
      { x: rect.left + rect.width * 0.9, y: rect.top + rect.height / 2 },
    ];
    const position = candidates.find(({ x, y }) => {
      const hit = document.elementFromPoint(x, y);
      if (!hit) return false;
      if (element.contains(hit)) return true;
      const resolvedTarget = hit.closest<HTMLElement>("[data-tree-drop-path]");
      return (
        resolvedTarget?.dataset.treeDropPath === expectedPath && resolvedTarget.dataset.treeDropScope === expectedScope
      );
    });
    if (!position) throw new Error("drop target has no visible hit point");
    (window as unknown as { __emitTauriEvent: (event: string, payload: unknown) => void }).__emitTauriEvent(
      "tauri://drag-drop",
      { paths: droppedPaths, position },
    );
  }, paths);
}

test("TREE-DND-001：单项在同一工作区移动并刷新源父目录和目标目录", async ({ page }) => {
  await open(page);
  await drag(row(page, "a.txt"), row(page, "dest"));
  const calls = await getTauriInvokeCalls(page);
  expect(calls?.some((call) => call.cmd === "move_path" && call.args.sourcePath === `${root}/a.txt`)).toBe(true);
  expect(calls?.some((call) => call.cmd === "list_directory" && call.args.path === root)).toBe(true);
  expect(calls?.some((call) => call.cmd === "list_directory" && call.args.path === `${root}/dest`)).toBe(true);
});

test("TREE-DND-002：拖动选区内节点移动整组选区，拖动未选节点只移动自身", async ({ page }) => {
  await open(page);
  await row(page, "a.txt").click();
  await row(page, "b.txt").click({ modifiers: ["Control"] });
  await drag(row(page, "a.txt"), row(page, "dest"));
  let calls = await getTauriInvokeCalls(page);
  expect(calls?.filter((call) => call.cmd === "move_path")).toHaveLength(2);

  await open(page);
  await row(page, "a.txt").click();
  await drag(row(page, "b.txt"), row(page, "dest"));
  calls = await getTauriInvokeCalls(page);
  expect(calls?.filter((call) => call.cmd === "move_path").map((call) => call.args.sourcePath)).toEqual([
    `${root}/b.txt`,
  ]);
});

test("TREE-DND-003：文件行解析为父目录，目录行和根行解析为自身且高亮当前行", async ({ page }) => {
  await open(page);
  await dispatchHtmlDrag(row(page, "a.txt"), row(page, "b.txt"));
  await expect(row(page, "b.txt")).toHaveClass(/tree-row-drop-target/);
  await page.keyboard.press("Escape");

  await drag(row(page, "a.txt"), rootRow(page));
  const calls = await getTauriInvokeCalls(page);
  expect(calls?.filter((call) => call.cmd === "move_path")).toHaveLength(0);
});

test("TREE-DND-004：拖到原父目录是 no-op 且不清空选择", async ({ page }) => {
  await open(page);
  await row(page, "a.txt").click();
  await drag(row(page, "a.txt"), row(page, "b.txt"));
  await expect(row(page, "a.txt")).toHaveAttribute("aria-selected", "true");
  const calls = await getTauriInvokeCalls(page);
  expect(calls?.filter((call) => call.cmd === "move_path")).toHaveLength(0);
});

test("TREE-DND-005：自身与后代拒绝拖入，Esc 和离开窗口清理高亮", async ({ page }) => {
  await open(page, {
    directories: {
      [root]: [dir("parent")],
      [`${root}/parent`]: [dir("child", `${root}/parent`)],
      [`${root}/parent/child`]: [],
    },
  });
  await row(page, "parent").dblclick();
  await dispatchHtmlDrag(row(page, "parent"), row(page, "child"));
  await page.keyboard.press("Escape");
  await expect(page.locator(".tree-row-drop-target")).toHaveCount(0);
  const calls = await getTauriInvokeCalls(page);
  expect(calls?.filter((call) => call.cmd === "move_path")).toHaveLength(0);
});

test("TREE-DND-006：主工作区与临时树之间拖拽执行复制而非移动", async ({ page }) => {
  await open(page);
  await drag(row(page, "a.txt"), row(page, "scratch-dest", "scratch"));
  await expect(row(page, "a.txt")).toBeVisible();
  const calls = await getTauriInvokeCalls(page);
  expect(calls?.some((call) => call.cmd === "copy_external_paths")).toBe(true);
  expect(calls?.some((call) => call.cmd === "move_path")).toBe(false);
});

test("TREE-DND-007：外部文件和目录复制到命中的文件树目录并刷新", async ({ page }) => {
  await open(page);
  await emitNativeDrop(page, row(page, "dest"), [`${external}/outside.txt`, `${external}/outside-dir`]);
  const calls = await getTauriInvokeCalls(page);
  expect(calls?.filter((call) => call.cmd === "copy_external_paths")).toHaveLength(2);
  expect(calls?.some((call) => call.cmd === "list_directory" && call.args.path === `${root}/dest`)).toBe(true);
});

test("TREE-DND-008：编辑器外部拖入只按顺序打开去重文件且不复制", async ({ page }) => {
  await open(page);
  await emitNativeDrop(page, page.locator(".editor-surface-panel").first(), [
    `${external}/outside.txt`,
    `${external}/outside-dir/nested 中文.txt`,
    `${external}/outside.txt`,
  ]);
  await expect(page.locator(".editor-file-tab", { hasText: "outside.txt" })).toHaveCount(1);
  await expect(page.locator(".editor-file-tab", { hasText: "nested 中文.txt" })).toHaveCount(1);
  const calls = await getTauriInvokeCalls(page);
  expect(calls?.some((call) => call.cmd === "copy_external_paths")).toBe(false);
});

test("TREE-DND-009：外部拖入部分失败逐项反馈且成功项不回滚", async ({ page }) => {
  await open(page);
  await setMockInvokeError(page, `copy_external_paths:${external}/outside-dir`, {
    kind: "permission",
    message: "destination denied",
  });
  await emitNativeDrop(page, row(page, "dest"), [`${external}/outside.txt`, `${external}/outside-dir`]);
  await expect(page.getByText(/1\/2/)).toBeVisible();
  await expect(row(page, "outside.txt")).toBeVisible();
  await expect(row(page, "outside-dir")).toHaveCount(0);
});

test("TREE-DND-010：同名、嵌套目录、中文空格和批量拖入保持明确冲突行为", async ({ page }) => {
  const many = Array.from({ length: 40 }, (_, index) => file(`批量 ${index}.txt`, external));
  await open(page, {
    directories: {
      [external]: [file("outside.txt", external), dir("outside-dir", external), ...many],
      [root]: [dir("dest"), file("a.txt"), file("b.txt"), file("outside.txt")],
    },
    fileContents: Object.fromEntries(many.map((entry) => [entry.path, entry.name])),
  });
  await emitNativeDrop(page, rootRow(page), [
    `${external}/outside.txt`,
    `${external}/outside-dir`,
    ...many.map((entry) => entry.path),
  ]);
  await expect
    .poll(async () => (await getTauriInvokeCalls(page))?.filter((call) => call.cmd === "copy_external_paths").length)
    .toBe(42);
  await expect(row(page, "outside.txt")).toHaveCount(1);
  const calls = await getTauriInvokeCalls(page);
  expect(calls?.filter((call) => call.cmd === "copy_external_paths")).toHaveLength(42);
  expect(
    calls?.some(
      (call) =>
        call.cmd === "copy_external_paths" &&
        call.args.sourcePaths[0] === `${external}/outside-dir` &&
        call.args.targetDirectory === root,
    ),
  ).toBe(true);
  expect(calls?.some((call) => call.cmd === "copy_external_paths" && call.args.sourcePaths[0].includes("批量 39"))).toBe(
    true,
  );
});

test("TREE-DND-011：虚拟列表边缘自动滚动后命中当前真实目录", async ({ page }) => {
  const folders = Array.from({ length: 220 }, (_, index) => dir(`target-${String(index).padStart(3, "0")}`));
  await open(page, {
    directories: {
      [root]: [file("source.txt"), ...folders],
      ...Object.fromEntries(folders.map((entry) => [entry.path, []])),
    },
    fileContents: { [`${root}/source.txt`]: "source" },
  });
  await row(page, "source.txt").evaluate((element) =>
    element.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: new DataTransfer() })),
  );
  const scroll = region(page).locator(".file-tree-scroll");
  const bounds = (await scroll.boundingBox())!;
  for (let index = 0; index < 20; index += 1) {
    await scroll.evaluate(
      (element, clientY) =>
        element.dispatchEvent(
          new DragEvent("dragover", { bubbles: true, cancelable: true, clientY, dataTransfer: new DataTransfer() }),
        ),
      bounds.y + bounds.height - 2,
    );
  }
  await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(200);
  await scroll.evaluate((element) => (element.scrollTop = element.scrollHeight));
  await expect(row(page, "target-219")).toBeVisible();
  await row(page, "target-219").evaluate((element) => {
    const transfer = new DataTransfer();
    element.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  const calls = await getTauriInvokeCalls(page);
  expect(calls?.some((call) => call.cmd === "move_path" && call.args.targetDirectory.endsWith("target-219"))).toBe(
    true,
  );
});
