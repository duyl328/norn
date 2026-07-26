import { expect, type Page, test } from "@playwright/test";

import { getTauriInvokeCalls, openMockFolder } from "./helpers";
import {
  clearMockInvokeError,
  deleteMockPath,
  emitMockFsChange,
  getMockFile,
  installTauriMock,
  releaseAllMockInvokes,
  releaseMockInvoke,
  renameMockPath,
  setMockFile,
  setMockInvokeError,
  type TauriMockScenario,
  waitForMockInvoke,
} from "./tauri-mock";

const projectPath = "/mock/project";
const readmePath = `${projectPath}/README.md`;

async function openWorkspace(page: Page, scenario: TauriMockScenario = {}): Promise<void> {
  await installTauriMock(page, scenario);
  await page.goto("/");
  await openMockFolder(page);
}

async function openReadme(page: Page): Promise<void> {
  await page.locator(".tree-row", { hasText: "README.md" }).dblclick();
  await expect(page.locator(".cm-content")).toContainText("Mock Project");
}

async function appendEditorText(page: Page, text: string): Promise<void> {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(text);
  await expect(page.locator(".cm-content")).toContainText(text);
}

async function save(page: Page): Promise<void> {
  await page.keyboard.press("Control+S");
}

async function createChangedConflict(page: Page, diskContent = "disk external\n") {
  await appendEditorText(page, "LOCAL_CONFLICT");
  await setMockFile(page, readmePath, diskContent, { lastModified: 1_700_000_000_500 });
  await save(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("File changed on disk");
  return dialog;
}

test("FILE-SAVE-001：正常保存后磁盘、Tab 和编辑器状态一致", async ({ page }) => {
  await openWorkspace(page);
  await openReadme(page);
  await appendEditorText(page, "NORMAL_SAVE");

  await save(page);

  await expect(page.getByRole("tab", { name: /README\.md/ })).not.toContainText("•");
  const disk = await getMockFile(page, readmePath);
  expect(disk.content).toContain("NORMAL_SAVE");
  await expect(page.locator(".cm-content")).toContainText("NORMAL_SAVE");
});

test("FILE-SAVE-002：保存前磁盘已变化时阻止覆盖并进入冲突", async ({ page }) => {
  await openWorkspace(page);
  await openReadme(page);

  const dialog = await createChangedConflict(page, "new disk before save\n");

  await expect(page.locator(".cm-content")).toContainText("LOCAL_CONFLICT");
  expect((await getMockFile(page, readmePath)).content).toBe("new disk before save\n");
  await expect(dialog.getByRole("button", { name: "Use Editor" })).toBeVisible();
});

test("FILE-SAVE-003：保存调用暂停期间磁盘再次变化时不能静默覆盖", async ({ page }) => {
  const gate = `save_text_file:${readmePath}`;
  await openWorkspace(page, { invokeGates: [gate] });
  await openReadme(page);
  await appendEditorText(page, "LOCAL_DURING_SAVE");

  await save(page);
  await waitForMockInvoke(page, gate);
  await setMockFile(page, readmePath, "external during save\n", { lastModified: 1_700_000_000_500 });
  await releaseMockInvoke(page, gate);

  await expect(page.getByRole("dialog")).toContainText("File changed on disk");
  expect((await getMockFile(page, readmePath)).content).toBe("external during save\n");
  await expect(page.locator(".cm-content")).toContainText("LOCAL_DURING_SAVE");
});

test("FILE-SAVE-004：保存前文件被删除时转入另存为且保留内容", async ({ page }) => {
  const savedAsPath = `${projectPath}/recovered.md`;
  await openWorkspace(page, { saveDialogPath: savedAsPath });
  await openReadme(page);
  await appendEditorText(page, "RECOVER_DELETED");
  await deleteMockPath(page, readmePath);

  await save(page);

  await expect(page.getByRole("tab", { name: /recovered\.md/ })).toBeVisible();
  expect((await getMockFile(page, savedAsPath)).content).toContain("RECOVER_DELETED");
  expect((await getMockFile(page, readmePath)).content).toBeUndefined();
});

test("FILE-SAVE-005：外部重命名已被识别时保存到新路径而不重建旧文件", async ({ page }) => {
  const renamedPath = `${projectPath}/RENAMED.md`;
  await openWorkspace(page);
  await openReadme(page);
  await appendEditorText(page, "SAVE_AFTER_RENAME");
  await renameMockPath(page, readmePath, renamedPath);
  await emitMockFsChange(page, [projectPath]);
  await expect(page.getByRole("tab", { name: /RENAMED\.md/ })).toBeVisible();

  await save(page);

  expect((await getMockFile(page, renamedPath)).content).toContain("SAVE_AFTER_RENAME");
  expect((await getMockFile(page, readmePath)).content).toBeUndefined();
});

test("FILE-SAVE-006：保存时目标目录消失会失败并保留脏内容", async ({ page }) => {
  await openWorkspace(page);
  await openReadme(page);
  await appendEditorText(page, "DIR_MISSING_LOCAL");
  await setMockInvokeError(page, `save_text_file:${readmePath}`, `${projectPath} no longer exists`);

  await save(page);

  await expect(page.getByText(/no longer exists/i)).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText("DIR_MISSING_LOCAL");
  await expect(page.getByRole("tab", { name: /README\.md/ })).toContainText("•");
});

test("FILE-SAVE-007：只读或锁定失败解除后可以重试成功", async ({ page }) => {
  const key = `save_text_file:${readmePath}`;
  await openWorkspace(page);
  await openReadme(page);
  await appendEditorText(page, "RETRY_AFTER_LOCK");
  await setMockInvokeError(page, key, `${readmePath} is read-only and locked`);

  await save(page);
  await expect(page.getByText(/read-only and locked/i)).toBeVisible();
  await clearMockInvokeError(page, key);
  await save(page);

  await expect(page.getByRole("tab", { name: /README\.md/ })).not.toContainText("•");
  expect((await getMockFile(page, readmePath)).content).toContain("RETRY_AFTER_LOCK");
});

test("FILE-SAVE-008：原子写失败时原磁盘内容不损坏", async ({ page }) => {
  const originalDisk = (
    await (async () => {
      await openWorkspace(page);
      await openReadme(page);
      return await getMockFile(page, readmePath);
    })()
  ).content;
  await appendEditorText(page, "DISK_FULL_LOCAL");
  await setMockInvokeError(page, `save_text_file:${readmePath}`, "No space left on device during atomic rename");

  await save(page);

  await expect(page.getByText(/no space left on device/i)).toBeVisible();
  expect((await getMockFile(page, readmePath)).content).toBe(originalDisk);
  await expect(page.locator(".cm-content")).toContainText("DISK_FULL_LOCAL");
});

test("FILE-SAVE-009：保存进行时继续输入，后续输入仍保持未保存", async ({ page }) => {
  const gate = `save_text_file:${readmePath}`;
  await openWorkspace(page, { invokeGates: [gate] });
  await openReadme(page);
  await appendEditorText(page, "BEFORE_SAVE");

  await save(page);
  await waitForMockInvoke(page, gate);
  await appendEditorText(page, "AFTER_SAVE_STARTED");
  await releaseMockInvoke(page, gate);

  expect((await getMockFile(page, readmePath)).content).toContain("BEFORE_SAVE");
  expect((await getMockFile(page, readmePath)).content).not.toContain("AFTER_SAVE_STARTED");
  await expect(page.locator(".cm-content")).toContainText("AFTER_SAVE_STARTED");
  await expect(page.getByRole("tab", { name: /README\.md/ })).toContainText("•");
});

test("FILE-SAVE-010：连续快速保存只执行一次写入", async ({ page }) => {
  const gate = `save_text_file:${readmePath}`;
  await openWorkspace(page, { invokeGates: [gate] });
  await openReadme(page);
  await appendEditorText(page, "DOUBLE_SAVE");

  await Promise.all([save(page), save(page)]);
  await waitForMockInvoke(page, gate);
  await releaseAllMockInvokes(page, gate);

  const calls = await getTauriInvokeCalls(page);
  expect(calls?.filter((call) => call.cmd === "save_text_file" && call.args.path === readmePath)).toHaveLength(1);
  expect((await getMockFile(page, readmePath)).content).toContain("DOUBLE_SAVE");
});

test("FILE-SAVE-011：自动保存与手动保存并发时只写入一次最新内容", async ({ page }) => {
  const gate = `save_text_file:${readmePath}`;
  await openWorkspace(page, { invokeGates: [gate] });
  await openReadme(page);
  await appendEditorText(page, "AUTO_AND_MANUAL");

  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await waitForMockInvoke(page, gate);
  await save(page);
  await releaseAllMockInvokes(page, gate);

  const calls = await getTauriInvokeCalls(page);
  expect(calls?.filter((call) => call.cmd === "save_text_file" && call.args.path === readmePath)).toHaveLength(1);
  expect((await getMockFile(page, readmePath)).content).toContain("AUTO_AND_MANUAL");
});

test("FILE-SAVE-012：保存失败后再次保存成功会清理错误和脏状态", async ({ page }) => {
  const key = `save_text_file:${readmePath}`;
  await openWorkspace(page);
  await openReadme(page);
  await appendEditorText(page, "RECOVER_SAVE_ERROR");
  await setMockInvokeError(page, key, "Transient write failure");

  await save(page);
  await expect(page.getByText("Transient write failure")).toBeVisible();
  await clearMockInvokeError(page, key);
  await save(page);

  await expect(page.getByText("Transient write failure")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: /README\.md/ })).not.toContainText("•");
});

test("FILE-SAVE-013：冲突选择使用编辑器会强制写入本地版本", async ({ page }) => {
  await openWorkspace(page);
  await openReadme(page);
  const dialog = await createChangedConflict(page, "disk before overwrite\n");

  await dialog.getByRole("button", { name: "Use Editor" }).click();

  expect((await getMockFile(page, readmePath)).content).toContain("LOCAL_CONFLICT");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: /README\.md/ })).not.toContainText("•");
});

test("FILE-SAVE-014：冲突选择使用磁盘会重新读取并丢弃本地版本", async ({ page }) => {
  await openWorkspace(page);
  await openReadme(page);
  const dialog = await createChangedConflict(page, "disk selected version\n");

  await dialog.getByRole("button", { name: "Use Disk" }).click();

  await expect(page.locator(".cm-content")).toContainText("disk selected version");
  await expect(page.locator(".cm-content")).not.toContainText("LOCAL_CONFLICT");
  await expect(page.getByRole("tab", { name: /README\.md/ })).not.toContainText("•");
});

test("FILE-SAVE-015：冲突选择另存为时原文件不变且 Tab 切到新路径", async ({ page }) => {
  const savedAsPath = `${projectPath}/local-copy.md`;
  await openWorkspace(page, { saveDialogPath: savedAsPath });
  await openReadme(page);
  const dialog = await createChangedConflict(page, "disk remains original\n");

  await dialog.getByRole("button", { name: "Save As" }).click();

  expect((await getMockFile(page, readmePath)).content).toBe("disk remains original\n");
  expect((await getMockFile(page, savedAsPath)).content).toContain("LOCAL_CONFLICT");
  await expect(page.getByRole("tab", { name: /local-copy\.md/ })).toBeVisible();
});

test("FILE-SAVE-016：删除冲突选择丢弃后不保留失效文件 Tab", async ({ page }) => {
  await openWorkspace(page);
  await openReadme(page);
  await appendEditorText(page, "DISCARD_DELETED");
  await deleteMockPath(page, readmePath);
  await emitMockFsChange(page, [projectPath]);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("File deleted on disk");

  await dialog.getByRole("button", { name: "Discard" }).click();

  await expect(page.locator(".editor-file-tab", { hasText: "README.md" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: /Untitled/ })).toBeVisible();
});

test("FILE-SAVE-017：取消冲突后本地内容和脏状态仍可继续处理", async ({ page }) => {
  await openWorkspace(page);
  await openReadme(page);
  const dialog = await createChangedConflict(page);

  await dialog.getByRole("button", { name: "Cancel" }).click();

  await expect(page.locator(".cm-content")).toContainText("LOCAL_CONFLICT");
  await expect(page.getByRole("tab", { name: /README\.md/ })).toContainText("•");
  await save(page);
  await expect(page.getByRole("dialog")).toContainText("File changed on disk");
});

test("FILE-SAVE-018：未命名文件另存为取消后仍保留内容和脏状态", async ({ page }) => {
  await installTauriMock(page, { saveDialogPath: null });
  await page.goto("/");
  await appendEditorText(page, "UNTITLED_CANCELLED_SAVE_AS");

  await save(page);

  await expect(page.getByRole("tab", { name: /Untitled/ })).toContainText("•");
  await expect(page.locator(".cm-content")).toContainText("UNTITLED_CANCELLED_SAVE_AS");
});

test("FILE-SAVE-019：保存受支持编码时把编码和 BOM 原样传给后端", async ({ page }) => {
  const path = `${projectPath}/utf16.txt`;
  await openWorkspace(page, {
    directories: {
      [projectPath]: [{ name: "utf16.txt", path, relativePath: "utf16.txt", kind: "file", size: 12 }],
    },
    fileContents: { [path]: "编码内容\n" },
    fileInspections: {
      [path]: { encoding: "utf-16le", encodingLabel: "UTF-16 LE", hasBom: true, isText: true, isUtf8: false },
    },
  });
  await page.locator(".tree-row", { hasText: "utf16.txt" }).dblclick();
  await appendEditorText(page, "编码保存");

  await save(page);

  const calls = await getTauriInvokeCalls(page);
  const saveCall = calls?.find((call) => call.cmd === "save_text_file" && call.args.path === path);
  expect(saveCall?.args.encoding).toBe("utf-16le");
  expect(saveCall?.args.hasBom).toBe(true);
});

test("FILE-SAVE-020：切换 CRLF 后保存的磁盘内容使用 CRLF", async ({ page }) => {
  await openWorkspace(page);
  await openReadme(page);

  await page.getByTitle("Change line ending").click();
  await page.getByRole("menuitemradio", { name: "CRLF" }).click();
  await save(page);

  const disk = (await getMockFile(page, readmePath)).content ?? "";
  expect(disk).toContain("\r\n");
  expect(disk.replaceAll("\r\n", "")).not.toContain("\n");
});

test("FILE-SAVE-021：format-on-save 后编辑器和磁盘内容一致", async ({ page }) => {
  await openWorkspace(page, {
    settings: {
      schemaVersion: 1,
      language: "en",
      theme: "system",
      editor: { fontSize: 13, tabSize: 2, lineWrapping: false, formatOnSave: true },
      ui: { showStatusBar: true, resizeHandleHints: false, restoreLastWorkspace: true },
    },
  });
  await page.locator(".tree-row", { hasText: "package.json" }).dblclick();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type('{"a":1,"nested":{"b":2}}');

  await save(page);

  const editor = await page.locator(".cm-content").innerText();
  const disk = (await getMockFile(page, `${projectPath}/package.json`)).content;
  expect(disk?.replaceAll("\r\n", "\n").trim()).toBe(editor.replaceAll("\r\n", "\n").trim());
  expect(disk).toContain('"nested"');
});
