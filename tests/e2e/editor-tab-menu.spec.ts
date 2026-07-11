import { expect, test } from "@playwright/test";

import { emitMenu } from "./helpers";
import { installTauriMock } from "./tauri-mock";

/**
 * 编辑区 tab 右键菜单。两条护栏:
 * 1. 右键非活动 tab → 先切到该 tab,再弹菜单(菜单动作作用于眼睛看到的那个文件);
 * 2. 打开菜单的那次右键会尾随一个 pointerdown(WKWebView 的事件序是 contextmenu → pointerdown),
 *    菜单不能被自己这一下关掉 —— 这里显式按 WebKit 的顺序派发事件复现该场景。
 */
test("编辑区 tab 右键:先选中再弹菜单,且不被右键自身的 pointerdown 关掉", async ({ page }) => {
  await installTauriMock(page, { fileDialogPath: "/mock/project/README.md" });
  await page.goto("/");
  await emitMenu(page, "menu-open-folder");
  await emitMenu(page, "menu-open-file"); // → README.md(真实路径)
  await expect(page.locator(".editor-file-tab", { hasText: "README.md" })).toBeVisible();
  await emitMenu(page, "menu-new-file"); // → 新 tab 抢走活动态,README 变成非活动
  await expect(page.locator(".editor-file-tab")).toHaveCount(2);

  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll<HTMLElement>(".editor-file-tab"));
    const inactive = tabs.find((tab) => !tab.classList.contains("editor-file-tab-active"));
    if (!inactive) throw new Error("没有非活动 tab");
    const rect = inactive.getBoundingClientRect();
    const init = { bubbles: true, cancelable: true, clientX: rect.left + 20, clientY: rect.top + 18, button: 2 };
    inactive.dispatchEvent(new MouseEvent("contextmenu", init));
    setTimeout(() => inactive.dispatchEvent(new PointerEvent("pointerdown", init)), 30);
  });

  await expect(page.locator(".git-ctx-menu")).toBeVisible();
  await expect(page.locator(".git-ctx-item")).toHaveCount(3);
  await expect(page.locator(".editor-file-tab.editor-file-tab-active")).toHaveText(/README\.md/);
});
