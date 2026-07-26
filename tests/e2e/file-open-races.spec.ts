import { expect, type Page, test } from "@playwright/test";

import { emitMenu, getTauriInvokeCalls, openMockFolder } from "./helpers";
import {
  deleteMockPath,
  installTauriMock,
  releaseAllMockInvokes,
  releaseMockInvoke,
  renameMockPath,
  setMockFile,
  setMockInvokeError,
  type TauriMockScenario,
  waitForMockInvoke,
} from "./tauri-mock";

const readmePath = "/mock/project/README.md";

async function openWorkspace(page: Page, scenario: TauriMockScenario = {}): Promise<void> {
  await installTauriMock(page, scenario);
  await page.goto("/");
  await openMockFolder(page);
}

async function openTreeFile(page: Page, name: string): Promise<void> {
  await page.locator(".tree-row", { hasText: name }).dblclick();
}

async function expectOpenError(page: Page, pattern: RegExp): Promise<void> {
  await expect(page.getByText(pattern).first()).toBeVisible();
}

test("FILE-OPEN-001：正常打开文件时内容、元数据和 Tab 一致", async ({ page }) => {
  await openWorkspace(page);
  await openTreeFile(page, "README.md");

  await expect(page.locator(".cm-content")).toContainText("Mock Project");
  await expect(page.getByRole("tab", { name: /README\.md/ })).toBeVisible();
  await expect(page.locator(".status-bar")).toContainText(readmePath);
  await expect(page.locator(".status-bar")).toContainText("UTF-8");

  const calls = await getTauriInvokeCalls(page);
  expect(calls?.some((call) => call.cmd === "inspect_text_file" && call.args.path === readmePath)).toBe(true);
  expect(calls?.some((call) => call.cmd === "read_text_file" && call.args.path === readmePath)).toBe(true);
});

test("FILE-OPEN-002：检查文件前被外部删除时不创建 Tab", async ({ page }) => {
  const gate = `inspect_text_file:${readmePath}`;
  await openWorkspace(page, { invokeGates: [gate] });

  await openTreeFile(page, "README.md");
  await waitForMockInvoke(page, gate);
  await deleteMockPath(page, readmePath);
  await releaseMockInvoke(page, gate);

  await expectOpenError(page, /not found/i);
  await expect(page.getByRole("tab", { name: /README\.md/ })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: /Untitled/ })).toBeVisible();
});

test("FILE-OPEN-003：检查成功后、读取前被外部删除时不留下半初始化 Tab", async ({ page }) => {
  const gate = `read_text_file:${readmePath}`;
  await openWorkspace(page, { invokeGates: [gate] });

  await openTreeFile(page, "README.md");
  await waitForMockInvoke(page, gate);
  await deleteMockPath(page, readmePath);
  await releaseMockInvoke(page, gate);

  await expectOpenError(page, /not found/i);
  await expect(page.getByRole("tab", { name: /README\.md/ })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: /Untitled/ })).toBeVisible();
});

test("FILE-OPEN-004：检查后、读取前被其他软件修改时打开同一最新版本", async ({ page }) => {
  const gate = `read_text_file:${readmePath}`;
  await openWorkspace(page, { invokeGates: [gate] });

  await openTreeFile(page, "README.md");
  await waitForMockInvoke(page, gate);
  await setMockFile(page, readmePath, "externally changed\n", { lastModified: 1_700_000_000_500 });
  await releaseMockInvoke(page, gate);

  await expect(page.locator(".cm-content")).toHaveText(/externally changed/);
  await expect(page.locator(".cm-content")).not.toContainText("Mock Project");
  await expect(page.getByRole("tab", { name: /README\.md/ })).not.toContainText("●");
});

test("FILE-OPEN-005：读取暂停期间连续外部修改时只打开最终完整版本", async ({ page }) => {
  const gate = `read_text_file:${readmePath}`;
  await openWorkspace(page, { invokeGates: [gate] });

  await openTreeFile(page, "README.md");
  await waitForMockInvoke(page, gate);
  await setMockFile(page, readmePath, "intermediate", { lastModified: 1_700_000_000_500 });
  await setMockFile(page, readmePath, "final complete content\n", { lastModified: 1_700_000_001_000 });
  await releaseMockInvoke(page, gate);

  await expect(page.locator(".cm-content")).toHaveText(/final complete content/);
  await expect(page.locator(".cm-content")).not.toContainText("intermediate");
  await expect(page.getByRole("tab", { name: /README\.md/ })).not.toContainText("●");
});

test("FILE-OPEN-006：读取过程中原文件被重命名时不产生旧、新重复 Tab", async ({ page }) => {
  const gate = `read_text_file:${readmePath}`;
  const renamedPath = "/mock/project/RENAMED.md";
  await openWorkspace(page, { invokeGates: [gate] });

  await openTreeFile(page, "README.md");
  await waitForMockInvoke(page, gate);
  await renameMockPath(page, readmePath, renamedPath);
  await releaseMockInvoke(page, gate);

  await expectOpenError(page, /not found/i);
  await expect(page.getByRole("tab", { name: /README\.md|RENAMED\.md/ })).toHaveCount(0);
});

test("FILE-OPEN-007：读取过程中原路径删除后同名重建时按新文件打开", async ({ page }) => {
  const gate = `read_text_file:${readmePath}`;
  await openWorkspace(page, { invokeGates: [gate] });

  await openTreeFile(page, "README.md");
  await waitForMockInvoke(page, gate);
  await deleteMockPath(page, readmePath);
  await setMockFile(page, readmePath, "replacement identity\n", { lastModified: 1_700_000_002_000 });
  await releaseMockInvoke(page, gate);

  await expect(page.locator(".cm-content")).toHaveText(/replacement identity/);
  await expect(page.locator(".cm-content")).not.toContainText("Mock Project");
  await expect(page.getByRole("tab", { name: /README\.md/ })).not.toContainText("●");
});

test("FILE-OPEN-008：检查后被替换成二进制时拒绝作为文本打开", async ({ page }) => {
  const gate = `read_text_file:${readmePath}`;
  await openWorkspace(page, { invokeGates: [gate] });

  await openTreeFile(page, "README.md");
  await waitForMockInvoke(page, gate);
  await setMockFile(page, readmePath, "", { isBinary: true, isText: false, isUtf8: false });
  await setMockInvokeError(page, gate, `${readmePath} appears to be a binary file`);
  await releaseMockInvoke(page, gate);

  await expectOpenError(page, /binary file/i);
  await expect(page.getByRole("tab", { name: /README\.md/ })).toHaveCount(0);
});

test("FILE-OPEN-009：读取前权限被移除时显示错误并保持当前文档", async ({ page }) => {
  const gate = `read_text_file:${readmePath}`;
  await openWorkspace(page, { invokeGates: [gate] });

  await openTreeFile(page, "README.md");
  await waitForMockInvoke(page, gate);
  await setMockInvokeError(page, gate, `Permission denied while reading ${readmePath}`);
  await releaseMockInvoke(page, gate);

  await expectOpenError(page, /permission denied/i);
  await expect(page.getByRole("tab", { name: /README\.md/ })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: /Untitled/ })).toBeVisible();
});

test("FILE-OPEN-010：快速重复打开同一路径只发起一次加载并只产生一个 Tab", async ({ page }) => {
  const gate = `inspect_text_file:${readmePath}`;
  await openWorkspace(page, { invokeGates: [gate] });

  await openTreeFile(page, "README.md");
  await openTreeFile(page, "README.md");
  await waitForMockInvoke(page, gate);
  await releaseAllMockInvokes(page, gate);

  await expect(page.getByRole("tab", { name: /README\.md/ })).toHaveCount(1);
  const calls = await getTauriInvokeCalls(page);
  expect(calls?.filter((call) => call.cmd === "inspect_text_file" && call.args.path === readmePath)).toHaveLength(1);
  expect(calls?.filter((call) => call.cmd === "read_text_file" && call.args.path === readmePath)).toHaveLength(1);
});

test("FILE-OPEN-011：A 的旧读取晚于 B 返回时不能覆盖当前活动文件 B", async ({ page }) => {
  const mainPath = "/mock/project/src/main.tsx";
  const readmeGate = `read_text_file:${readmePath}`;
  const mainGate = `read_text_file:${mainPath}`;
  await openWorkspace(page, { invokeGates: [readmeGate, mainGate] });

  await openTreeFile(page, "README.md");
  await waitForMockInvoke(page, readmeGate);
  await page.locator(".tree-row", { hasText: "src" }).dblclick();
  await openTreeFile(page, "main.tsx");
  await waitForMockInvoke(page, mainGate);

  await releaseMockInvoke(page, mainGate);
  await expect(page.locator(".cm-content")).toContainText("hello from mock");
  await releaseMockInvoke(page, readmeGate);

  await expect(page.locator(".cm-content")).toContainText("hello from mock");
  await expect(page.getByRole("tab", { name: /main\.tsx/ })).toHaveAttribute("aria-selected", "true");
});

test("FILE-OPEN-012：选择目录或其他非普通文件时明确拒绝且不改变当前文档", async ({ page }) => {
  await openWorkspace(page, { fileDialogPath: "/mock/project/src" });
  await setMockInvokeError(page, "inspect_text_file:/mock/project/src", "/mock/project/src is not a file");

  await emitMenu(page, "menu-open-file");

  await expectOpenError(page, /is not a file/i);
  await expect(page.getByRole("tab", { name: /Untitled/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /src/ })).toHaveCount(0);
});

test("FILE-OPEN-013：中文、空格、emoji 和特殊字符路径可以打开", async ({ page }) => {
  const name = "测试 [# 100%] 😀.txt";
  const path = `/mock/project/${name}`;
  await openWorkspace(page, {
    directories: {
      "/mock/project": [{ name, path, relativePath: name, kind: "file", size: 18 }],
    },
    fileContents: { [path]: "特殊路径内容\n" },
    fileLastModified: { [path]: 1_700_000_000_000 },
  });

  await openTreeFile(page, name);

  await expect(page.locator(".cm-content")).toContainText("特殊路径内容");
  await expect(page.getByRole("tab", { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })).toBeVisible();
  await expect(page.locator(".status-bar")).toContainText(path);
});

test("FILE-OPEN-014：带 BOM 的受支持编码打开后不显示 BOM 字符", async ({ page }) => {
  const path = "/mock/project/utf16.txt";
  await openWorkspace(page, {
    directories: {
      "/mock/project": [{ name: "utf16.txt", path, relativePath: "utf16.txt", kind: "file", size: 12 }],
    },
    fileContents: { [path]: "hello 编码\n" },
    fileInspections: {
      [path]: { encoding: "utf-16le", encodingLabel: "UTF-16 LE", hasBom: true, isText: true, isUtf8: false },
    },
  });

  await openTreeFile(page, "utf16.txt");

  await expect(page.locator(".cm-content")).toContainText("hello 编码");
  const editorText = await page.locator(".cm-content").textContent();
  expect(editorText?.charCodeAt(0)).not.toBe(0xfeff);
  await expect(page.locator(".status-bar")).toContainText("UTF-16 LE");
});

test("FILE-OPEN-015：文件选择器取消或报错都不改变当前文档", async ({ page }) => {
  await openWorkspace(page, { fileDialogPath: null });
  const initialText = await page.locator(".cm-content").innerText();

  await emitMenu(page, "menu-open-file");
  await expect(page.getByRole("tab", { name: /Untitled/ })).toBeVisible();
  await expect(page.locator(".cm-content")).toHaveText(initialText);

  await setMockInvokeError(page, "open_file_dialog", "Native file dialog failed");
  await emitMenu(page, "menu-open-file");
  await expectOpenError(page, /native file dialog failed/i);
  await expect(page.getByRole("tab", { name: /Untitled/ })).toBeVisible();
  await expect(page.locator(".cm-content")).toHaveText(initialText);
});
