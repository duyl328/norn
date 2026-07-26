import { expect, type Page, test } from "@playwright/test";

import { getTauriInvokeCalls, openMockFolder } from "./helpers";
import {
  getMockFile,
  installTauriMock,
  releaseMockInvoke,
  setMockFile,
  setMockInvokeError,
  type TauriMockScenario,
  waitForMockInvoke,
} from "./tauri-mock";

const projectPath = "/mock/project";
const readmePath = `${projectPath}/README.md`;
const mainPath = `${projectPath}/src/main.tsx`;

async function openWorkspace(page: Page, scenario: TauriMockScenario = {}): Promise<void> {
  await installTauriMock(page, scenario);
  await page.goto("/");
  await openMockFolder(page);
}

async function openReadme(page: Page): Promise<void> {
  await page.locator(".tree-row", { hasText: "README.md" }).dblclick();
  await expect(page.locator(".cm-content")).toContainText("Mock Project");
}

async function openMain(page: Page): Promise<void> {
  await page.locator(".tree-row", { hasText: "src" }).dblclick();
  await page.locator(".tree-row", { hasText: "main.tsx" }).dblclick();
  await expect(page.locator(".cm-content")).toContainText("hello from mock");
}

async function append(page: Page, value: string): Promise<void> {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(value);
  await expect(page.locator(".cm-content")).toContainText(value);
}

async function requestWindowClose(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    (window as unknown as { __tauriMockHasListener?: (event: string) => boolean }).__tauriMockHasListener?.(
      "tauri://close-requested",
    ),
  );
  await page.evaluate(() =>
    (window as unknown as { __emitTauriEvent: (event: string, payload: unknown) => void }).__emitTauriEvent(
      "tauri://close-requested",
      null,
    ),
  );
}

test("FILE-LIFE-001：关闭脏的已落盘 Tab 会保存成功后再关闭", async ({ page }) => {
  await openWorkspace(page);
  await openReadme(page);
  await openMain(page);
  await append(page, "LIFE_SAVE_CLOSE");

  await page.getByRole("button", { name: /Close main\.tsx/ }).click();

  await expect(page.getByRole("tab", { name: /main\.tsx/ })).toHaveCount(0);
  expect((await getMockFile(page, mainPath)).content).toContain("LIFE_SAVE_CLOSE");
});

test("FILE-LIFE-002：关闭脏 Tab 时磁盘已变化会阻止关闭并进入冲突", async ({ page }) => {
  await openWorkspace(page);
  await openReadme(page);
  await openMain(page);
  await append(page, "LOCAL_BEFORE_CLOSE");
  await setMockFile(page, mainPath, "external before close\n", { lastModified: 1_700_000_000_500 });

  await page.getByRole("button", { name: /Close main\.tsx/ }).click();

  await expect(page.locator(".editor-file-tab", { hasText: "main.tsx" })).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("File changed on disk");
  await expect(page.locator(".cm-content")).toContainText("LOCAL_BEFORE_CLOSE");
});

test("FILE-LIFE-003：关闭窗口会依次保存多个已落盘文档后才销毁窗口", async ({ page }) => {
  await openWorkspace(page);
  await openReadme(page);
  await append(page, "README_QUIT");
  await openMain(page);
  await append(page, "MAIN_QUIT");

  await requestWindowClose(page);

  await expect
    .poll(async () => (await getTauriInvokeCalls(page)).filter((call) => call.cmd === "destroy_current_window").length)
    .toBe(1);
  expect((await getMockFile(page, readmePath)).content).toContain("README_QUIT");
  expect((await getMockFile(page, mainPath)).content).toContain("MAIN_QUIT");
});

test("FILE-LIFE-004：未命名非空文档关闭时可取消并完整保留内容", async ({ page }) => {
  await openWorkspace(page);
  await openReadme(page);
  await page.keyboard.press("Control+N");
  await append(page, "KEEP_UNTITLED");

  await page.getByRole("button", { name: /Close Untitled/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Unsaved changes");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await expect(page.locator(".cm-content")).toContainText("KEEP_UNTITLED");
  await expect(page.getByRole("tab", { name: /Untitled/ })).toBeVisible();
});

test("FILE-LIFE-005：未命名文档缓存为草稿并在重载后恢复内容与 Tab", async ({ page }) => {
  await openWorkspace(page);
  await openReadme(page);
  await page.keyboard.press("Control+N");
  await append(page, "RESTORE_DRAFT_CONTENT");
  await page.locator(".windows-titlebar").click({ position: { x: 400, y: 10 } });

  await expect
    .poll(async () =>
      page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("__nornMockDrafts") ?? "{}")).length),
    )
    .toBe(1);
  await page.reload();

  await expect(page.locator(".cm-content")).toContainText("RESTORE_DRAFT_CONTENT");
  await expect(page.getByRole("tab", { name: /Untitled/ })).toBeVisible();
});

test("FILE-LIFE-006：空白未命名文档不会留下旧草稿", async ({ page }) => {
  await openWorkspace(page);
  await openReadme(page);
  await page.keyboard.press("Control+N");
  await append(page, "TEMP_DRAFT");
  await page.locator(".windows-titlebar").click({ position: { x: 400, y: 10 } });
  await expect
    .poll(async () =>
      page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("__nornMockDrafts") ?? "{}")).length),
    )
    .toBe(1);

  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await page.locator(".windows-titlebar").click({ position: { x: 400, y: 10 } });

  await expect
    .poll(async () =>
      page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("__nornMockDrafts") ?? "{}")).length),
    )
    .toBe(0);
});

test("FILE-LIFE-007：后台脏 Tab 保存失败时阻止窗口销毁并聚焦失败文档", async ({ page }) => {
  const gate = `save_text_file:${readmePath}`;
  await openWorkspace(page, { invokeGates: [gate] });
  await openReadme(page);
  await append(page, "BACKGROUND_DIRTY");
  await page.locator(".tree-row", { hasText: "src" }).dblclick();
  await page.locator(".tree-row", { hasText: "main.tsx" }).dblclick();
  await waitForMockInvoke(page, gate);
  await setMockInvokeError(page, `save_text_file:${readmePath}`, "background save failed");
  await releaseMockInvoke(page, gate);

  await requestWindowClose(page);

  await expect(page.locator(".editor-file-tab", { hasText: "README.md" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("dialog")).toContainText("background save failed");
  await expect(page.locator(".cm-content")).toContainText("BACKGROUND_DIRTY");
  expect((await getTauriInvokeCalls(page)).filter((call) => call.cmd === "destroy_current_window")).toHaveLength(0);
});

test("FILE-LIFE-008：恢复会话时跳过已删除文件且不阻塞正常 Tab", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "norn.session",
      JSON.stringify({
        tabs: [
          { id: "missing", name: "missing.txt", path: "/mock/project/missing.txt" },
          { id: "readme", name: "README.md", path: "/mock/project/README.md" },
        ],
        activeId: "readme",
        folderPath: "/mock/project",
      }),
    );
  });
  await installTauriMock(page, {
    invokeErrors: {
      "inspect_text_file:/mock/project/missing.txt": "not found",
    },
  });
  await page.goto("/");

  await expect(page.getByRole("tab", { name: /missing\.txt/ })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: /README\.md/ })).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText("Mock Project");
});
