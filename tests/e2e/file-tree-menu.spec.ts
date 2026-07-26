import { expect, type Locator, type Page, test } from "@playwright/test";

import { emitMenu, getTauriInvokeCalls, openMockFolder } from "./helpers";
import { deleteMockPath, installTauriMock, setMockInvokeError } from "./tauri-mock";

const root = "/mock/project";
const scratch = "/mock/scratch";
const dir = (name: string, parent = root) => ({ name, path: `${parent}/${name}`, relativePath: name, kind: "directory" });
const file = (name: string, parent = root) => ({
  name,
  path: `${parent}/${name}`,
  relativePath: name,
  kind: "file",
  size: 1,
});
const region = (page: Page) => page.locator(".project-panel-main-region");
const row = (page: Page, name: string) => region(page).locator(".tree-row:not(.tree-row-root)", { hasText: name }).first();
const rootRow = (page: Page) => region(page).locator('button.tree-row-root[data-tree-drop-scope="main"]');
const menu = (page: Page) => page.locator(".file-tree-context-menu");
const item = (page: Page, label: RegExp) => menu(page).locator(".file-tree-context-item", { hasText: label }).first();

async function open(page: Page, extra: Parameters<typeof installTauriMock>[1] = {}) {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await installTauriMock(page, {
    ...extra,
    directories: {
      [root]: [dir("folder"), file("a.txt"), file("b 中文.txt")],
      [`${root}/folder`]: [],
      [scratch]: [],
      ...extra.directories,
    },
    fileContents: { [`${root}/a.txt`]: "a", [`${root}/b 中文.txt`]: "b", ...extra.fileContents },
  });
  await page.goto("/");
  await openMockFolder(page);
}

async function openMenu(target: Locator) {
  await target.click({ button: "right" });
}

test("TREE-MENU-001：文件、目录、根和空白菜单按目标启用且新建粘贴目录正确", async ({ page }) => {
  await open(page);
  await openMenu(row(page, "a.txt"));
  await expect(item(page, /^Rename$/)).toBeEnabled();
  await expect(item(page, /^Paste$/)).toBeDisabled();
  await item(page, /New File/).click();
  await page.getByRole("dialog").locator("input").fill("sibling.txt");
  await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();

  await openMenu(rootRow(page));
  await expect(item(page, /^Rename$/)).toBeDisabled();
  await expect(item(page, /Move to Trash/)).toBeDisabled();
  await page.keyboard.press("Escape");

  await region(page).locator(".file-tree-scroll").click({ button: "right", position: { x: 4, y: 4 } });
  await expect(item(page, /Reveal in File Manager/)).toBeDisabled();
  const calls = await getTauriInvokeCalls(page);
  expect(calls?.some((call) => call.cmd === "create_file" && call.args.parentPath === root)).toBe(true);
});

test("TREE-MENU-002：窗口边缘菜单自动夹紧且滚动后仍操作打开时目标", async ({ page }) => {
  const many = Array.from({ length: 180 }, (_, index) => file(`item-${String(index).padStart(3, "0")}.txt`));
  await open(page, { directories: { [root]: many } });
  const target = row(page, "item-000.txt");
  await target.evaluate((element) =>
    element.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, button: 2, clientX: 100_000, clientY: 100_000 }),
    ),
  );
  await expect(menu(page)).toBeVisible();
  const viewport = page.viewportSize()!;
  await expect
    .poll(async () => {
      const bounds = await menu(page).boundingBox();
      return bounds ? bounds.y + bounds.height : Number.POSITIVE_INFINITY;
    })
    .toBeLessThanOrEqual(viewport.height);
  const box = (await menu(page).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);

  await region(page).locator(".file-tree-scroll").evaluate((element) => (element.scrollTop = element.scrollHeight));
  await item(page, /Copy Relative Path/).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("item-000.txt");
});

test("TREE-MENU-003：外点、Esc、工作区切换和动作完成均关闭并清理菜单目标", async ({ page }) => {
  await open(page, { directories: { "/mock/next": [] }, folderDialogPaths: [root, "/mock/next"] });
  await openMenu(row(page, "a.txt"));
  await page.locator(".editor-surface-panel").click();
  await expect(menu(page)).toHaveCount(0);

  await openMenu(row(page, "a.txt"));
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);

  await openMenu(row(page, "a.txt"));
  await emitMenu(page, "menu-open-folder");
  await expect(menu(page)).toHaveCount(0);
});

test("TREE-MENU-004：资源管理器对文件和目录传入真实路径且原生失败可见", async ({ page }) => {
  await open(page);
  await openMenu(row(page, "a.txt"));
  await item(page, /Reveal in File Manager/).click();
  await openMenu(row(page, "folder"));
  await item(page, /Reveal in File Manager/).click();
  let calls = await getTauriInvokeCalls(page);
  expect(calls?.filter((call) => call.cmd === "reveal_in_file_manager").map((call) => call.args.path)).toEqual([
    `${root}/a.txt`,
    `${root}/folder`,
  ]);

  await setMockInvokeError(page, "reveal_in_file_manager", "Explorer unavailable");
  await openMenu(row(page, "a.txt"));
  await item(page, /Reveal in File Manager/).click();
  await expect(page.getByText(/Explorer unavailable/)).toBeVisible();
  calls = await getTauriInvokeCalls(page);
  expect(calls?.some((call) => call.cmd === "list_directory" && call.args.path === root)).toBe(true);
});

test("TREE-MENU-005：终端对文件用父目录、对目录用自身且失败不改变树", async ({ page }) => {
  await open(page);
  for (const name of ["a.txt", "folder"]) {
    await openMenu(row(page, name));
    await item(page, /Open Terminal/).click();
  }
  let calls = await getTauriInvokeCalls(page);
  expect(calls?.filter((call) => call.cmd === "open_terminal_at").map((call) => call.args.path)).toEqual([
    root,
    `${root}/folder`,
  ]);

  await setMockInvokeError(page, "open_terminal_at", "terminal missing");
  await openMenu(row(page, "a.txt"));
  await item(page, /Open Terminal/).click();
  await expect(page.getByText(/terminal missing/)).toBeVisible();
  await expect(row(page, "a.txt")).toBeVisible();
  calls = await getTauriInvokeCalls(page);
  expect(calls?.filter((call) => call.cmd === "open_terminal_at")).toHaveLength(3);
});

test("TREE-MENU-006：菜单 Copy/Cut/Paste 与键盘共享同一多选语义", async ({ page }) => {
  await open(page);
  await row(page, "a.txt").click();
  await row(page, "b 中文.txt").click({ modifiers: ["Control"] });
  await openMenu(row(page, "a.txt"));
  await item(page, /^Copy$/).click();
  await openMenu(row(page, "folder"));
  await item(page, /^Paste$/).click();

  const calls = await getTauriInvokeCalls(page);
  expect(calls?.filter((call) => call.cmd === "copy_path").map((call) => call.args.sourcePath)).toEqual([
    `${root}/a.txt`,
    `${root}/b 中文.txt`,
  ]);
});

test("TREE-MENU-007：菜单目标外部失效后操作安全失败并刷新父目录", async ({ page }) => {
  await open(page);
  await openMenu(row(page, "a.txt"));
  await deleteMockPath(page, `${root}/a.txt`);
  await item(page, /Reveal in File Manager/).click();
  await expect(page.getByText(/does not exist/)).toBeVisible();
  const calls = await getTauriInvokeCalls(page);
  expect(calls?.filter((call) => call.cmd === "reveal_in_file_manager")).toHaveLength(0);
  expect(calls?.some((call) => call.cmd === "list_directory" && call.args.path === root)).toBe(true);
});
