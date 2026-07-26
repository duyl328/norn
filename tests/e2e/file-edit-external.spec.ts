import { expect, type Page, test } from "@playwright/test";

import { openMockFolder } from "./helpers";
import {
  deleteMockPath,
  emitMockFsChange,
  installTauriMock,
  releaseMockInvoke,
  renameMockPath,
  setMockFile,
  type TauriMockScenario,
  waitForMockInvoke,
} from "./tauri-mock";

const projectPath = "/mock/project";
const readmePath = `${projectPath}/README.md`;
const mainPath = `${projectPath}/src/main.tsx`;
const originalReadme = "Mock Project";

async function openWorkspace(page: Page, scenario: TauriMockScenario = {}): Promise<void> {
  await installTauriMock(page, scenario);
  await page.goto("/");
  await openMockFolder(page);
}

async function openReadme(page: Page): Promise<void> {
  await page.locator(".tree-row", { hasText: "README.md" }).dblclick();
  await expect(page.locator(".cm-content")).toContainText(originalReadme);
}

async function openMain(page: Page): Promise<void> {
  const src = page.locator(".tree-row", { hasText: "src" });
  if ((await page.locator(".tree-row", { hasText: "main.tsx" }).count()) === 0) await src.dblclick();
  await page.locator(".tree-row", { hasText: "main.tsx" }).dblclick();
  await expect(page.locator(".cm-content")).toContainText("hello from mock");
}

async function appendEditorText(page: Page, text: string): Promise<void> {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(text);
  await expect(page.locator(".cm-content")).toContainText(text);
}

async function expectChangedConflict(page: Page) {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("File changed on disk");
  return dialog;
}

async function expectDeletedConflict(page: Page) {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("File deleted on disk");
  return dialog;
}

test("FILE-EDIT-001：干净活动文档被外部修改后自动重载", async ({ page }) => {
  await openWorkspace(page);
  await openReadme(page);

  await setMockFile(page, readmePath, "external clean reload\n", { lastModified: 1_700_000_000_500 });
  await emitMockFsChange(page, [projectPath]);

  await expect(page.locator(".cm-content")).toHaveText(/external clean reload/);
  await expect(page.getByRole("tab", { name: /README\.md/ })).not.toContainText("●");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("FILE-EDIT-002：脏活动文档被外部修改时保留本地内容并显示冲突", async ({ page }) => {
  await openWorkspace(page);
  await openReadme(page);
  await appendEditorText(page, "LOCAL_UNSAVED");

  await setMockFile(page, readmePath, "external disk version\n", { lastModified: 1_700_000_000_500 });
  await emitMockFsChange(page, [projectPath]);

  const dialog = await expectChangedConflict(page);
  await expect(page.locator(".cm-content")).toContainText("LOCAL_UNSAVED");
  await dialog.getByRole("button", { name: "Compare" }).click();
  await expect(dialog).toContainText("external disk version");
  await expect(dialog).toContainText("LOCAL_UNSAVED");
});

test("FILE-EDIT-003：连续输入期间发生外部修改不会吞掉最后输入", async ({ page }) => {
  const gate = `inspect_text_file:${readmePath}`;
  await openWorkspace(page, { invokeGates: [gate] });
  await page.locator(".tree-row", { hasText: "README.md" }).dblclick();
  await waitForMockInvoke(page, gate);
  await releaseMockInvoke(page, gate);
  await expect(page.locator(".cm-content")).toContainText(originalReadme);
  await appendEditorText(page, "LOCAL_BEFORE");

  await setMockFile(page, readmePath, "external while typing\n", { lastModified: 1_700_000_000_500 });
  await emitMockFsChange(page, [projectPath]);
  await waitForMockInvoke(page, gate);
  await appendEditorText(page, "LOCAL_AFTER");
  await releaseMockInvoke(page, gate);

  await expectChangedConflict(page);
  await expect(page.locator(".cm-content")).toContainText("LOCAL_BEFORE");
  await expect(page.locator(".cm-content")).toContainText("LOCAL_AFTER");
});

test("FILE-EDIT-004：读取冲突磁盘版本前再次变化时比较最新版本", async ({ page }) => {
  const gate = `read_text_file:${readmePath}`;
  await openWorkspace(page, { invokeGates: [gate] });
  await page.locator(".tree-row", { hasText: "README.md" }).dblclick();
  await waitForMockInvoke(page, gate);
  await releaseMockInvoke(page, gate);
  await expect(page.locator(".cm-content")).toContainText(originalReadme);
  await appendEditorText(page, "LOCAL");

  await setMockFile(page, readmePath, "disk version one\n", { lastModified: 1_700_000_000_500 });
  await emitMockFsChange(page, [projectPath]);
  await waitForMockInvoke(page, gate);
  await setMockFile(page, readmePath, "disk version two latest\n", { lastModified: 1_700_000_001_000 });
  await releaseMockInvoke(page, gate);

  const dialog = await expectChangedConflict(page);
  await dialog.getByRole("button", { name: "Compare" }).click();
  await expect(dialog).toContainText("disk version two latest");
  await expect(dialog).not.toContainText("disk version one");
});

test("FILE-EDIT-005：冲突框打开后磁盘再次变化，使用磁盘时必须加载最新版本", async ({ page }) => {
  await openWorkspace(page);
  await openReadme(page);
  await appendEditorText(page, "LOCAL");
  await setMockFile(page, readmePath, "disk conflict first\n", { lastModified: 1_700_000_000_500 });
  await emitMockFsChange(page, [projectPath]);
  const dialog = await expectChangedConflict(page);

  await setMockFile(page, readmePath, "disk conflict latest\n", { lastModified: 1_700_000_001_000 });
  await dialog.getByRole("button", { name: "Use Disk" }).click();

  await expect(page.locator(".cm-content")).toHaveText(/disk conflict latest/);
  await expect(page.locator(".cm-content")).not.toContainText("LOCAL");
});

test("FILE-EDIT-006：干净活动文档被外部删除时显示删除冲突", async ({ page }) => {
  await openWorkspace(page);
  await openReadme(page);

  await deleteMockPath(page, readmePath);
  await emitMockFsChange(page, [projectPath]);

  const dialog = await expectDeletedConflict(page);
  await expect(dialog.getByRole("button", { name: "Save As" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Discard" })).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText(originalReadme);
});

test("FILE-EDIT-007：脏活动文档被外部删除时本地内容完整保留", async ({ page }) => {
  await openWorkspace(page);
  await openReadme(page);
  await appendEditorText(page, "LOCAL_AFTER_DELETE");

  await deleteMockPath(page, readmePath);
  await emitMockFsChange(page, [projectPath]);

  await expectDeletedConflict(page);
  await expect(page.locator(".cm-content")).toContainText("LOCAL_AFTER_DELETE");
  await expect(page.locator(".editor-file-tab", { hasText: "README.md" })).toContainText("•");
});

test("FILE-EDIT-008：删除后同路径重建时脏文档进入修改冲突而非被覆盖", async ({ page }) => {
  await openWorkspace(page);
  await openReadme(page);
  await appendEditorText(page, "LOCAL_IDENTITY");

  await deleteMockPath(page, readmePath);
  await setMockFile(page, readmePath, "new identity on disk\n", { lastModified: 1_700_000_002_000 });
  await emitMockFsChange(page, [projectPath]);

  const dialog = await expectChangedConflict(page);
  await expect(page.locator(".cm-content")).toContainText("LOCAL_IDENTITY");
  await dialog.getByRole("button", { name: "Compare" }).click();
  await expect(dialog).toContainText("new identity on disk");
});

test("FILE-EDIT-009：干净文件被外部重命名时 Tab 和路径跟随更新", async ({ page }) => {
  const renamedPath = `${projectPath}/RENAMED.md`;
  await openWorkspace(page);
  await openReadme(page);

  await renameMockPath(page, readmePath, renamedPath);
  await emitMockFsChange(page, [projectPath]);

  await expect(page.getByRole("tab", { name: /RENAMED\.md/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /README\.md/ })).toHaveCount(0);
  await expect(page.locator(".status-bar")).toContainText(renamedPath);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("FILE-EDIT-010：脏文件被外部重命名时新路径保留本地编辑和脏标记", async ({ page }) => {
  const renamedPath = `${projectPath}/RENAMED.md`;
  await openWorkspace(page);
  await openReadme(page);
  await appendEditorText(page, "LOCAL_RENAME");

  await renameMockPath(page, readmePath, renamedPath);
  await emitMockFsChange(page, [projectPath]);

  await expect(page.getByRole("tab", { name: /RENAMED\.md/ })).toContainText("•");
  await expect(page.locator(".cm-content")).toContainText("LOCAL_RENAME");
  await expect(page.locator(".status-bar")).toContainText(renamedPath);
});

test("FILE-EDIT-011：无法唯一判断重命名目标时按删除冲突处理", async ({ page }) => {
  await openWorkspace(page);
  await openReadme(page);
  const content = await page.locator(".cm-content").innerText();

  await deleteMockPath(page, readmePath);
  await setMockFile(page, `${projectPath}/candidate-a.md`, content, { lastModified: 1_700_000_000_000 });
  await setMockFile(page, `${projectPath}/candidate-b.md`, content, { lastModified: 1_700_000_000_000 });
  await emitMockFsChange(page, [projectPath]);

  await expectDeletedConflict(page);
  await expect(page.locator(".editor-file-tab", { hasText: "README.md" })).toBeVisible();
});

test("FILE-EDIT-012：文件被移动到其他目录时不猜测路径并保留本地内容", async ({ page }) => {
  await openWorkspace(page);
  await openReadme(page);
  await appendEditorText(page, "LOCAL_MOVED");

  await renameMockPath(page, readmePath, "/mock/elsewhere/README.md");
  await emitMockFsChange(page, [projectPath]);

  await expectDeletedConflict(page);
  await expect(page.locator(".cm-content")).toContainText("LOCAL_MOVED");
  await expect(page.locator(".status-bar")).toContainText(readmePath);
});

test("FILE-EDIT-013：干净后台 Tab 被外部修改后静默重载", async ({ page }) => {
  await openWorkspace(page);
  await openReadme(page);
  await openMain(page);

  await setMockFile(page, readmePath, "background clean latest\n", { lastModified: 1_700_000_000_500 });
  await emitMockFsChange(page, [projectPath]);
  await page.getByRole("tab", { name: /README\.md/ }).click();

  await expect(page.locator(".cm-content")).toContainText("background clean latest");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("FILE-EDIT-014：脏后台 Tab 只记录冲突，激活时才展示", async ({ page }) => {
  const saveGate = `save_text_file:${readmePath}`;
  await openWorkspace(page, { invokeGates: [saveGate] });
  await openReadme(page);
  await appendEditorText(page, "BACKGROUND_LOCAL");
  await openMain(page);
  await waitForMockInvoke(page, saveGate);

  await setMockFile(page, readmePath, "background disk latest\n", { lastModified: 1_700_000_000_500 });
  await emitMockFsChange(page, [projectPath]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("tab", { name: /README\.md/ }).click();

  const dialog = await expectChangedConflict(page);
  await expect(page.locator(".cm-content")).toContainText("BACKGROUND_LOCAL");
  await dialog.getByRole("button", { name: "Compare" }).click();
  await expect(dialog).toContainText("background disk latest");
});

test("FILE-EDIT-015：后台 Tab 被外部删除时冲突只关联该 Tab", async ({ page }) => {
  await openWorkspace(page);
  await openReadme(page);
  await openMain(page);

  await deleteMockPath(page, readmePath);
  await emitMockFsChange(page, [projectPath]);
  await expect(page.locator(".cm-content")).toContainText("hello from mock");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("tab", { name: /README\.md/ }).click();

  await expectDeletedConflict(page);
  await expect(page.locator(".cm-content")).toContainText(originalReadme);
});

test("FILE-EDIT-016：多个打开文件同时外部修改时各自刷新且不串内容", async ({ page }) => {
  await openWorkspace(page);
  await openReadme(page);
  await openMain(page);

  await setMockFile(page, readmePath, "readme simultaneous latest\n", { lastModified: 1_700_000_000_500 });
  await setMockFile(page, mainPath, "main simultaneous latest\n", { lastModified: 1_700_000_000_500 });
  await emitMockFsChange(page, [projectPath, `${projectPath}/src`]);

  await expect(page.locator(".cm-content")).toContainText("main simultaneous latest");
  await page.getByRole("tab", { name: /README\.md/ }).click();
  await expect(page.locator(".cm-content")).toContainText("readme simultaneous latest");
  await expect(page.locator(".cm-content")).not.toContainText("main simultaneous latest");
});

test("FILE-EDIT-017：Norn 自己保存产生的 watcher 事件不触发外部冲突", async ({ page }) => {
  await openWorkspace(page);
  await openReadme(page);
  await appendEditorText(page, "SAVED_BY_NORN");
  await page.keyboard.press("Control+S");
  await expect(page.getByRole("tab", { name: /README\.md/ })).not.toContainText("●");

  await emitMockFsChange(page, [projectPath]);

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText("SAVED_BY_NORN");
});

test("FILE-EDIT-018：外部原子替换被识别为内容变化而非永久删除", async ({ page }) => {
  await openWorkspace(page);
  await openReadme(page);

  await deleteMockPath(page, readmePath);
  await setMockFile(page, readmePath, "atomic replacement latest\n", { lastModified: 1_700_000_002_000 });
  await emitMockFsChange(page, [projectPath]);

  await expect(page.locator(".cm-content")).toContainText("atomic replacement latest");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("FILE-EDIT-019：外部替换为二进制时保留现有文本并显示错误", async ({ page }) => {
  await openWorkspace(page);
  await openReadme(page);

  await setMockFile(page, readmePath, "", {
    isBinary: true,
    isText: false,
    isUtf8: false,
    lastModified: 1_700_000_000_500,
  });
  await emitMockFsChange(page, [projectPath]);

  await expect(page.getByText(/can no longer be opened as supported text/i)).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText(originalReadme);
});

test("FILE-EDIT-020：仅 mtime 变化且内容相同时不产生冲突", async ({ page }) => {
  await openWorkspace(page);
  await openReadme(page);
  const original = await page.locator(".cm-content").innerText();

  await setMockFile(page, readmePath, original, { lastModified: 1_700_000_000_500 });
  await emitMockFsChange(page, [projectPath]);

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText(originalReadme);
  await expect(page.getByRole("tab", { name: /README\.md/ })).not.toContainText("•");
});

test("FILE-EDIT-021：内容变化但 mtime 相同时仍能发现外部修改", async ({ page }) => {
  await openWorkspace(page);
  await openReadme(page);

  await setMockFile(page, readmePath, "changed with same mtime\n", { lastModified: 1_700_000_000_000 });
  await emitMockFsChange(page, [projectPath]);

  await expect(page.locator(".cm-content")).toContainText("changed with same mtime");
});

test("FILE-EDIT-022：watcher 事件风暴合并刷新且最终内容一致", async ({ page }) => {
  await openWorkspace(page);
  await openReadme(page);
  await setMockFile(page, readmePath, "event storm final\n", { lastModified: 1_700_000_000_500 });

  for (let index = 0; index < 10; index += 1) await emitMockFsChange(page, [projectPath]);

  await expect(page.locator(".cm-content")).toContainText("event storm final");
  const inspectCount = await page.evaluate(
    (path) =>
      (
        (window as unknown as { __tauriInvokeCalls?: Array<{ args: Record<string, unknown>; cmd: string }> })
          .__tauriInvokeCalls ?? []
      ).filter((call) => call.cmd === "inspect_text_file" && call.args.path === path).length,
    readmePath,
  );
  expect(inspectCount).toBeLessThanOrEqual(3);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("FILE-EDIT-023：错过 watcher 事件后窗口重新聚焦仍发现外部修改", async ({ page }) => {
  await openWorkspace(page);
  await openReadme(page);
  await setMockFile(page, readmePath, "focus fallback latest\n", { lastModified: 1_700_000_000_500 });

  await page.evaluate(() => window.dispatchEvent(new Event("focus")));

  await expect(page.locator(".cm-content")).toContainText("focus fallback latest");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
