import { expect, type Page, test } from "@playwright/test";

import { getTauriInvokeCalls, openMockFolder } from "./helpers";
import { installTauriMock, type TauriMockScenario } from "./tauri-mock";

const rootPath = "/mock/project";
const srcPath = `${rootPath}/src`;

const keyboardScenario: TauriMockScenario = {
  directories: {
    [rootPath]: [
      { name: "src", path: srcPath, relativePath: "src", kind: "directory" },
      ...Array.from({ length: 24 }, (_, index) => ({
        name: `file-${String(index).padStart(2, "0")}.txt`,
        path: `${rootPath}/file-${String(index).padStart(2, "0")}.txt`,
        relativePath: `file-${String(index).padStart(2, "0")}.txt`,
        kind: "file" as const,
        size: 1,
      })),
    ],
    [srcPath]: [{ name: "child.ts", path: `${srcPath}/child.ts`, relativePath: "src/child.ts", kind: "file", size: 1 }],
  },
  fileContents: Object.fromEntries([
    [`${srcPath}/child.ts`, "child"],
    ...Array.from({ length: 24 }, (_, index) => [
      `${rootPath}/file-${String(index).padStart(2, "0")}.txt`,
      `file ${index}`,
    ]),
  ]),
};

const row = (page: Page, name: string) => page.locator(".tree-row", { hasText: name }).first();
const tree = (page: Page) => page.getByRole("tree", { name: "project" });

async function openKeyboardTree(page: Page): Promise<void> {
  await installTauriMock(page, keyboardScenario);
  await page.goto("/");
  await openMockFolder(page);
  await expect(row(page, "file-00.txt")).toBeVisible();
}

test("TREE-KEY-001/002：方向键按可见顺序移动并用 Shift 扩缩选区", async ({ page }) => {
  await openKeyboardTree(page);
  await row(page, "file-01.txt").click();
  await tree(page).press("ArrowDown");
  await expect(row(page, "file-02.txt")).toHaveClass(/tree-row-lead/);
  await tree(page).press("Shift+ArrowDown");
  await expect(row(page, "file-02.txt")).toHaveAttribute("aria-selected", "true");
  await expect(row(page, "file-03.txt")).toHaveAttribute("aria-selected", "true");
  await tree(page).press("Shift+ArrowUp");
  await expect(row(page, "file-03.txt")).toHaveAttribute("aria-selected", "false");
});

test("TREE-KEY-003：左右键展开、进入子节点、返回父目录并折叠", async ({ page }) => {
  await openKeyboardTree(page);
  await row(page, "src").click();
  await tree(page).press("ArrowRight");
  await expect(row(page, "src")).toHaveAttribute("aria-expanded", "true");
  await tree(page).press("ArrowRight");
  await expect(row(page, "child.ts")).toHaveClass(/tree-row-lead/);
  await tree(page).press("ArrowLeft");
  await expect(row(page, "src")).toHaveClass(/tree-row-lead/);
  await tree(page).press("ArrowLeft");
  await expect(row(page, "src")).toHaveAttribute("aria-expanded", "false");
});

test("TREE-KEY-004/014：Home、End、Page 键越界安全并把虚拟行滚入视口", async ({ page }) => {
  await openKeyboardTree(page);
  await row(page, "file-00.txt").click();
  await tree(page).press("End");
  await expect(row(page, "file-23.txt")).toHaveClass(/tree-row-lead/);
  await expect
    .poll(() =>
      page
        .locator(".file-tree-scroll")
        .first()
        .evaluate((element) => element.scrollTop),
    )
    .toBeGreaterThan(0);
  await tree(page).press("Home");
  await expect(row(page, "src")).toHaveClass(/tree-row-lead/);
  await tree(page).press("PageDown");
  await expect(tree(page)).toHaveAttribute("aria-activedescendant", /file-09\.txt/);
  await tree(page).press("Shift+PageUp");
  await expect(row(page, "src")).toHaveAttribute("aria-selected", "true");
});

test("TREE-KEY-005：Enter 展开目录并只打开一个文件 Tab", async ({ page }) => {
  await openKeyboardTree(page);
  await row(page, "src").click();
  await tree(page).press("Enter");
  await expect(row(page, "child.ts")).toBeVisible();
  await row(page, "file-00.txt").click();
  await tree(page).press("Enter");
  await tree(page).press("Enter");
  await expect(page.getByRole("tab", { name: /file-00\.txt/ })).toHaveCount(1);
});

test("TREE-KEY-006/007：Delete 请求确认、Backspace 安全且全选仅包含可见行", async ({ page }) => {
  await openKeyboardTree(page);
  await row(page, "file-00.txt").click();
  await tree(page).press("Backspace");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await tree(page).press("Delete");
  await expect(page.getByRole("dialog")).toContainText("Move to Trash");
  await page.keyboard.press("Escape");
  await tree(page).press("Control+A");
  await expect(row(page, "src")).toHaveAttribute("aria-selected", "true");
  await tree(page).press("End");
  await expect(row(page, "file-23.txt")).toHaveAttribute("aria-selected", "true");
  await expect(row(page, "child.ts")).toHaveCount(0);
});

test("TREE-KEY-008/009：复制、剪切、粘贴和复制绝对路径使用当前选区", async ({ page }) => {
  await openKeyboardTree(page);
  await row(page, "file-00.txt").click();
  await row(page, "file-01.txt").click({ modifiers: ["Control"] });
  await tree(page).press("Control+C");
  await tree(page).press("Control+Shift+C");
  const calls = await getTauriInvokeCalls(page);
  expect(calls).toContainEqual(
    expect.objectContaining({
      cmd: "copy_files_to_clipboard",
      args: expect.objectContaining({ paths: [`${rootPath}/file-00.txt`, `${rootPath}/file-01.txt`] }),
    }),
  );

  await row(page, "file-02.txt").click();
  await tree(page).press("Control+X");
  await row(page, "src").click();
  await tree(page).press("Control+V");
  await expect
    .poll(async () => (await getTauriInvokeCalls(page)).filter((call) => call.cmd === "move_path"))
    .toContainEqual(
      expect.objectContaining({
        args: expect.objectContaining({ sourcePath: `${rootPath}/file-02.txt`, targetDirectory: srcPath }),
      }),
    );
});

test("TREE-KEY-010～013：即时搜索支持匹配循环、退格、零结果、可见范围和清除", async ({ page }) => {
  await openKeyboardTree(page);
  await row(page, "file-00.txt").click();
  await tree(page).pressSequentially("FILE-0");
  await expect(page.locator(".file-tree-search-query")).toHaveText("FILE-0");
  await expect(page.locator(".file-tree-search-count")).toContainText("10");
  await tree(page).press("ArrowDown");
  await expect(row(page, "file-01.txt")).toHaveClass(/tree-row-lead/);
  await tree(page).press("Backspace");
  await expect(page.locator(".file-tree-search-query")).toHaveText("FILE-");
  await tree(page).pressSequentially("zzz");
  await expect(page.locator(".file-tree-search-count")).toContainText(/no matches/i);
  await expect(row(page, "child.ts")).toHaveCount(0);
  await tree(page).press("Escape");
  await expect(page.locator(".file-tree-search-bar")).toHaveCount(0);
});

test("TREE-KEY-015：编辑器、输入框和菜单中的按键不会误触文件树", async ({ page }) => {
  await openKeyboardTree(page);
  await row(page, "file-00.txt").dblclick();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Delete");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await row(page, "file-01.txt").click({ button: "right" });
  await page.locator(".file-tree-context-item", { hasText: "Rename" }).click();
  const renameDialog = page.getByRole("dialog");
  const renameInput = renameDialog.getByRole("textbox");
  await renameInput.fill("temporary-name.txt");
  await renameInput.press("Delete");
  await expect(renameDialog).toContainText("Rename");
  await renameInput.press("Escape");
  await expect(renameDialog).toHaveCount(0);

  await row(page, "file-01.txt").click({ button: "right" });
  await expect(page.locator(".file-tree-context-menu")).toBeVisible();
  await page.keyboard.press("Delete");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await getTauriInvokeCalls(page)).some((call) => call.cmd === "trash_path")).toBe(false);
});
