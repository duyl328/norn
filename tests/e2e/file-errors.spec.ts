import { expect, test } from "@playwright/test";

import { emitMenu, openMockFolder } from "./helpers";
import { fileErrorScenario, installTauriMock, saveConflictScenario } from "./tauri-mock";

test("文件错误：二进制文件不会作为文本打开", async ({ page }) => {
  await installTauriMock(page, fileErrorScenario);
  await page.goto("/");
  await openMockFolder(page);

  await page.locator(".tree-row", { hasText: "binary.bin" }).dblclick();

  await expect(page.getByText("binary.bin cannot be opened as a supported text encoding.")).toBeVisible();
  await expect(page.getByRole("tab", { name: /binary\.bin/ })).toHaveCount(0);
});

test("文件错误：非 UTF-8 文件不会作为文本打开", async ({ page }) => {
  await installTauriMock(page, fileErrorScenario);
  await page.goto("/");
  await openMockFolder(page);

  await page.locator(".tree-row", { hasText: "latin1.txt" }).dblclick();

  await expect(page.getByText("latin1.txt cannot be opened as a supported text encoding.")).toBeVisible();
  await expect(page.getByRole("tab", { name: /latin1\.txt/ })).toHaveCount(0);
});

test("文件错误：保存权限失败显示错误状态", async ({ page }) => {
  await installTauriMock(page, fileErrorScenario);
  await page.goto("/");
  await openMockFolder(page);

  await page.locator(".tree-row", { hasText: "readonly.txt" }).dblclick();
  await expect(page.locator(".cm-content")).toContainText("readonly content");
  await page.locator(".cm-content").click();
  await page.keyboard.type("EDITED");
  await emitMenu(page, "menu-save-file");

  await expect(page.getByText("/mock/project/readonly.txt is read-only and cannot be saved.")).toBeVisible();
  await expect(page.getByRole("tab", { name: /readonly\.txt/ })).toContainText("•");
});

test("文件错误：保存冲突显示冲突弹窗", async ({ page }) => {
  await installTauriMock(page, saveConflictScenario);
  await page.goto("/");
  await openMockFolder(page);

  await page.locator(".tree-row", { hasText: "conflict.txt" }).dblclick();
  await expect(page.locator(".cm-content")).toContainText("local baseline");
  await page.locator(".cm-content").click();
  await page.keyboard.type("LOCAL_EDIT");
  await emitMenu(page, "menu-save-file");

  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("File changed on disk");
  await expect(dialog).toContainText("/mock/project/conflict.txt was changed outside Norn.");
  await expect(dialog.getByRole("button", { name: "Use Editor" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Use Disk" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save As" })).toBeVisible();
});
