import { expect, type Locator, type Page, test } from "@playwright/test";

import { emitMenu, getTauriInvokeCalls, openMockFolder } from "./helpers";
import {
  clearMockInvokeError,
  deleteMockPath,
  gateNextMockInvokeSnapshot,
  installTauriMock,
  releaseMockInvoke,
  setMockInvokeError,
  waitForMockInvoke,
} from "./tauri-mock";

const root = "/mock/project";
const scratch = "/mock/scratch";
const folder = (name: string, parent = root) => ({
  name,
  path: `${parent}/${name}`,
  relativePath: `${parent === root ? "" : `${parent.slice(root.length + 1)}/`}${name}`,
  kind: "directory",
});
const file = (name: string, parent = root) => ({
  name,
  path: `${parent}/${name}`,
  relativePath: `${parent === root ? "" : `${parent.slice(root.length + 1)}/`}${name}`,
  kind: "file",
  size: 1,
});

const region = (page: Page, scope: "main" | "scratch" = "main") =>
  page.locator(scope === "main" ? ".project-panel-main-region" : ".project-panel-scratch");
const row = (page: Page, name: string, scope: "main" | "scratch" = "main") =>
  region(page, scope).locator(".tree-row", { hasText: name }).first();
const tree = (page: Page, scope: "main" | "scratch" = "main") =>
  region(page, scope).getByRole("tree").first();
const rootRow = (page: Page, scope: "main" | "scratch" = "main") =>
  region(page, scope).locator(`button.tree-row-root[data-tree-drop-scope="${scope}"]`);

async function open(page: Page, extra: Parameters<typeof installTauriMock>[1] = {}) {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await installTauriMock(page, {
    ...extra,
    directories: {
      [root]: [folder("dest"), file("a.txt"), file("b 中文.txt")],
      [`${root}/dest`]: [],
      [scratch]: [folder("scratch-dest", scratch), file("scratch.txt", scratch)],
      [`${scratch}/scratch-dest`]: [],
      ...extra.directories,
    },
    fileContents: {
      [`${root}/a.txt`]: "a",
      [`${root}/b 中文.txt`]: "b",
      [`${scratch}/scratch.txt`]: "scratch",
      ...extra.fileContents,
    },
  });
  await page.goto("/");
  await openMockFolder(page);
}

async function selectMany(page: Page, names: string[], scope: "main" | "scratch" = "main") {
  await row(page, names[0], scope).click();
  for (const name of names.slice(1)) await row(page, name, scope).click({ modifiers: ["Control"] });
}

async function contextItem(page: Page, target: Locator, label: RegExp) {
  await target.click({ button: "right" });
  return page.locator(".file-tree-context-item", { hasText: label }).first();
}

test("TREE-CLIP-001：多项复制和剪切保留作用域、可见顺序与完整路径", async ({ page }) => {
  await open(page);
  await selectMany(page, ["a.txt", "b 中文.txt"]);
  await tree(page).press("Control+C");
  await tree(page).press("Control+X");

  const calls = await getTauriInvokeCalls(page);
  const clipboardCalls = calls?.filter((call) => call.cmd === "copy_files_to_clipboard") ?? [];
  expect(clipboardCalls).toHaveLength(2);
  expect(clipboardCalls[0].args.paths).toEqual([`${root}/a.txt`, `${root}/b 中文.txt`]);
  expect(clipboardCalls[1].args.paths).toEqual([`${root}/a.txt`, `${root}/b 中文.txt`]);
});

test("TREE-CLIP-002：原生文件剪贴板失败时回退文件名且不破坏树内粘贴", async ({ page }) => {
  await open(page, { invokeErrors: { copy_files_to_clipboard: "native clipboard unavailable" } });
  await row(page, "a.txt").click();
  await tree(page).press("Control+C");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("a.txt");

  await row(page, "dest").click();
  await tree(page).press("Control+V");
  await row(page, "dest").dblclick();
  await expect(row(page, "a.txt")).toHaveCount(1);
});

test("TREE-CLIP-003：绝对和相对路径支持多选、根目录、中文及空格", async ({ page }) => {
  await open(page);
  await selectMany(page, ["a.txt", "b 中文.txt"]);
  await (await contextItem(page, row(page, "b 中文.txt"), /Copy Relative Path/)).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText().then((text) => text.replace(/\r\n/g, "\n")))).toBe(
    "a.txt\nb 中文.txt",
  );

  await (await contextItem(page, rootRow(page), /^Copy Path$/)).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(root);
});

test("TREE-CLIP-004：复制可重复粘贴且剪切仅在全部移动成功后清空", async ({ page }) => {
  await open(page, {
    directories: { [`${root}/dest-2`]: [], [root]: [folder("dest"), folder("dest-2"), file("a.txt")] },
  });
  await row(page, "a.txt").click();
  await tree(page).press("Control+C");
  for (const name of ["dest", "dest-2"]) {
    await row(page, name).click();
    await tree(page).press("Control+V");
  }
  let calls = await getTauriInvokeCalls(page);
  expect(calls?.filter((call) => call.cmd === "copy_path")).toHaveLength(2);

  await row(page, "a.txt").click();
  await tree(page).press("Control+X");
  await row(page, "dest").click();
  await tree(page).press("Control+V");
  await tree(page).press("Control+V");
  calls = await getTauriInvokeCalls(page);
  expect(calls?.filter((call) => call.cmd === "move_path")).toHaveLength(1);
});

test("TREE-CLIP-005：目录行、文件行和空选区解析到正确粘贴目录", async ({ page }) => {
  await open(page, {
    directories: {
      [root]: [folder("dest"), file("a.txt"), file("b.txt")],
      [`${root}/dest`]: [],
    },
    fileContents: { [`${root}/b.txt`]: "b" },
  });
  await row(page, "a.txt").click();
  await tree(page).press("Control+C");

  await row(page, "dest").click();
  await tree(page).press("Control+V");
  await row(page, "b.txt").click();
  await tree(page).press("Control+V");
  await tree(page).press("Escape");
  await tree(page).press("Control+V");

  const calls = await getTauriInvokeCalls(page);
  expect(calls?.filter((call) => call.cmd === "copy_path").map((call) => call.args.targetDirectory)).toEqual([
    `${root}/dest`,
    root,
    root,
  ]);
});

test("TREE-CLIP-006：原目录、同名目标和只读目标冲突均不覆盖源", async ({ page }) => {
  await open(page, { invokeErrors: { [`copy_path:${root}/a.txt`]: { kind: "permission", message: "read only" } } });
  await row(page, "a.txt").click();
  await tree(page).press("Control+C");
  await row(page, "dest").click();
  await tree(page).press("Control+V");
  await expect(page.getByText(/read only/)).toBeVisible();
  await expect(row(page, "a.txt")).toBeVisible();
});

test("TREE-CLIP-007：目录不能复制或移动到自身及后代", async ({ page }) => {
  await open(page, {
    directories: {
      [root]: [folder("parent")],
      [`${root}/parent`]: [folder("child", `${root}/parent`)],
      [`${root}/parent/child`]: [],
    },
  });
  await row(page, "parent").dblclick();
  await row(page, "parent").click();
  await tree(page).press("Control+C");
  await row(page, "child").click();
  await tree(page).press("Control+V");
  await expect(page.getByText(/cannot be copied|descendant/i)).toBeVisible();
  await expect(row(page, "parent")).toBeVisible();
});

test("TREE-CLIP-008：批量剪切部分失败后仅保留失败项并可重试", async ({ page }) => {
  await open(page);
  await setMockInvokeError(page, `move_path:${root}/b 中文.txt`, { kind: "permission", message: "denied" });
  await selectMany(page, ["a.txt", "b 中文.txt"]);
  await tree(page).press("Control+X");
  await row(page, "dest").click();
  await tree(page).press("Control+V");
  await expect(page.getByText(/1\/2/)).toBeVisible();

  await clearMockInvokeError(page, `move_path:${root}/b 中文.txt`);
  await tree(page).press("Control+V");
  const calls = await getTauriInvokeCalls(page);
  expect(calls?.filter((call) => call.cmd === "move_path" && call.args.sourcePath === `${root}/a.txt`)).toHaveLength(1);
  expect(calls?.filter((call) => call.cmd === "move_path" && call.args.sourcePath === `${root}/b 中文.txt`)).toHaveLength(2);
});

test("TREE-CLIP-009：剪切源或目标外部消失时安全失败并刷新", async ({ page }) => {
  await open(page);
  await row(page, "a.txt").click();
  await tree(page).press("Control+X");
  await deleteMockPath(page, `${root}/a.txt`);
  await row(page, "dest").click();
  await tree(page).press("Control+V");
  await expect(page.getByText(/does not exist/)).toBeVisible();
  const calls = await getTauriInvokeCalls(page);
  expect(calls?.some((call) => call.cmd === "list_directory" && call.args.path === `${root}/dest`)).toBe(true);
});

test("TREE-CLIP-010：主树与临时树之间的剪切按复制处理且保留源", async ({ page }) => {
  await open(page);
  await row(page, "a.txt").click();
  await tree(page).press("Control+X");
  await row(page, "scratch-dest", "scratch").click();
  await tree(page, "scratch").press("Control+V");
  await expect(row(page, "a.txt")).toBeVisible();
  const calls = await getTauriInvokeCalls(page);
  expect(calls?.some((call) => call.cmd === "copy_external_paths" && call.args.sourcePaths[0] === `${root}/a.txt`)).toBe(
    true,
  );
  expect(calls?.some((call) => call.cmd === "move_path")).toBe(false);
});

test("TREE-CLIP-011：切换工作区后拒绝同作用域陈旧绝对路径", async ({ page }) => {
  const nextRoot = "/mock/next";
  await open(page, {
    directories: { [nextRoot]: [folder("next-dest", nextRoot)] },
    folderDialogPaths: [root, nextRoot],
  });
  await row(page, "a.txt").click();
  await tree(page).press("Control+C");
  await emitMenu(page, "menu-open-folder");
  await rootRow(page).click({ button: "right" });
  await page.locator(".file-tree-context-item", { hasText: "Paste" }).click();
  await expect(page.getByText(/no longer open/)).toBeVisible();
  const calls = await getTauriInvokeCalls(page);
  expect(calls?.filter((call) => call.cmd === "copy_path")).toHaveLength(0);
});

test("TREE-CLIP-012：慢速目录复制显示 busy 并阻止重复粘贴", async ({ page }) => {
  await open(page);
  await row(page, "a.txt").click();
  await tree(page).press("Control+C");
  await row(page, "dest").click();
  await gateNextMockInvokeSnapshot(page, `copy_path:${root}/a.txt`);
  await tree(page).press("Control+V");
  await waitForMockInvoke(page, `copy_path:${root}/a.txt`);

  const paste = await contextItem(page, row(page, "dest"), /^Paste$/);
  await expect(paste).toBeDisabled();
  await tree(page).press("Control+V");
  let calls = await getTauriInvokeCalls(page);
  expect(calls?.filter((call) => call.cmd === "copy_path")).toHaveLength(1);

  await releaseMockInvoke(page, `copy_path:${root}/a.txt`);
  await expect(paste).toBeEnabled();
  calls = await getTauriInvokeCalls(page);
  expect(calls?.filter((call) => call.cmd === "copy_path")).toHaveLength(1);
});
