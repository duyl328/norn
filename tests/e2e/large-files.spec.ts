import { expect, test } from "@playwright/test";

import { emitMenu, getTauriInvokeCalls, openMockFolder } from "./helpers";
import { installTauriMock, largeFileScenario } from "./tauri-mock";

test("大文件：5MB 到 25MB 打开前确认，取消后不打开", async ({ page }) => {
  await installTauriMock(page, largeFileScenario);
  await page.goto("/");
  await openMockFolder(page);

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("6.0 MB");
    await dialog.dismiss();
  });
  await page.locator(".tree-row", { hasText: "large.txt" }).dblclick();

  await expect(page.getByRole("tab", { name: /large\.txt/ })).toHaveCount(0);
});

test("大文件：确认后普通大文件仍可编辑保存", async ({ page }) => {
  await installTauriMock(page, largeFileScenario);
  await page.goto("/");
  await openMockFolder(page);

  page.once("dialog", async (dialog) => {
    await dialog.accept();
  });
  await page.locator(".tree-row", { hasText: "large.txt" }).dblclick();

  await expect(page.getByRole("tab", { name: /large\.txt/ })).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText("large editable file");

  await page.locator(".cm-content").click();
  await page.keyboard.type("EDITED");
  await expect(page.getByRole("tab", { name: /large\.txt/ })).toContainText("•");

  await emitMenu(page, "menu-save-file");
  await expect(page.getByRole("tab", { name: /large\.txt/ })).not.toContainText("•");
});

test("大文件：超过 25MB 进入只读 range 模式并禁止保存", async ({ page }) => {
  await installTauriMock(page, largeFileScenario);
  await page.goto("/");
  await openMockFolder(page);

  await page.locator(".tree-row", { hasText: "huge.log" }).dblclick();

  await expect(page.getByRole("tab", { name: /huge\.log/ })).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText("huge range content");
  await expect(page.getByText(/Large file browsing mode/)).toBeVisible();
  await expect(page.locator(".status-bar")).toContainText("Read-only range");

  const calls = await getTauriInvokeCalls(page);
  expect(
    calls?.some((call) => call.cmd === "read_text_file_range" && call.args.path === "/mock/project/huge.log"),
  ).toBe(true);

  await page.locator(".cm-content").click();
  await page.keyboard.type("SHOULD_NOT_APPEAR");
  await expect(page.locator(".cm-content")).not.toContainText("SHOULD_NOT_APPEAR");

  await emitMenu(page, "menu-save-file");
  await expect(
    page.getByText("Large files are opened in read-only browsing mode and cannot be saved yet."),
  ).toBeVisible();
});

test("大文件：超过 100MB 默认读取尾部 range", async ({ page }) => {
  await installTauriMock(page, largeFileScenario);
  await page.goto("/");
  await openMockFolder(page);

  await page.locator(".tree-row", { hasText: "massive.log" }).dblclick();
  await expect(page.getByRole("tab", { name: /massive\.log/ })).toBeVisible();

  const calls = await getTauriInvokeCalls(page);
  const rangeCall = calls?.find(
    (call) => call.cmd === "read_text_file_range" && call.args.path === "/mock/project/massive.log",
  );
  expect(rangeCall?.args.offset).toBe(120 * 1024 * 1024 - 512 * 1024);
  expect(rangeCall?.args.length).toBe(512 * 1024);
});
