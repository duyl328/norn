import { expect, test } from "@playwright/test";

import { emitMenu } from "./helpers";
import { installTauriMock } from "./tauri-mock";

const openReadme = async (page: import("@playwright/test").Page, contents?: string) => {
  await installTauriMock(page, contents ? { fileContents: { "/mock/project/README.md": contents } } : {});
  // 首启引导的气泡会盖住编辑区,挡掉点击 —— 标记为「已看过」。
  await page.addInitScript(() => window.localStorage.setItem("norn.welcomeSeen", "1"));
  await page.goto("/");
  await emitMenu(page, "menu-open-folder");
  // 从文件树打开(菜单的「打开文件」会清掉文件夹视图 = 脱离仓库,那种情况本来就没有改动条)。
  await page.locator(".tree-row", { hasText: "README.md" }).dblclick({ force: true });
  await expect(page.locator(".cm-content")).not.toBeEmpty();
};

/** 改动条:相对 HEAD 有改动才出现;点改动条 → HEAD 原文就地展开,浮条上可撤回。 */
test("编辑器改动条:编辑后出现,点开展开 HEAD 原文并可撤回", async ({ page }) => {
  await openReadme(page, "L1\nL2\nL3\n");
  await expect(page.locator(".cm-git-change")).toHaveCount(0); // 与 HEAD 一致 → 无改动条

  const before = await page.locator(".cm-content").textContent();
  await page.locator(".cm-line").nth(1).click();
  await page.keyboard.press("End");
  await page.keyboard.type("x");
  await expect(page.locator(".cm-git-change")).not.toHaveCount(0);

  await page.locator(".cm-git-change").first().click();
  // HEAD 原文就地展开在改动行上方(不是浮层),词级高亮出被改掉的字符。
  const inline = page.locator(".cm-git-inline");
  await expect(inline).toBeVisible();
  await expect(inline.locator(".cm-git-inline-row")).toHaveText("L2");

  await inline.locator(".cm-git-inline-action").first().click(); // 撤回
  await expect(page.locator(".cm-git-inline")).toHaveCount(0); // 改动没了 → 展开块自动收起
  await expect(page.locator(".cm-git-change")).toHaveCount(0);
  expect(await page.locator(".cm-content").textContent()).toBe(before);
});

test("改动条真的有像素,且不 hover 也有颜色", async ({ page }) => {
  await openReadme(page);
  await page.locator(".cm-content").click();
  await page.keyboard.type("XYZ");
  const bar = page.locator(".cm-git-change").first();
  await expect(bar).toBeVisible();
  const box = await bar.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(0);
  expect(box?.height ?? 0).toBeGreaterThan(0);

  // 配色类名是拼出来的话,Tailwind 会把 @layer components 里的 .cm-git-change-* 规则整条裁掉,
  // 竖条就成了透明的(只有 hover 时才像有颜色)。这里盯住「不 hover 也必须有背景色」。
  await page.mouse.move(0, 0);
  const background = await bar.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(background).not.toBe("rgba(0, 0, 0, 0)");
});
