import { expect, type Locator, type Page, test } from "@playwright/test";

import { openMockFolder } from "./helpers";
import { installTauriMock } from "./tauri-mock";

const openReadme = async (page: Page, contents?: string) => {
  await installTauriMock(page, contents ? { fileContents: { "/mock/project/README.md": contents } } : {});
  await page.goto("/");
  await openMockFolder(page);
  // 从文件树打开(菜单的「打开文件」会清掉文件夹视图 = 脱离仓库,那种情况本来就没有改动条)。
  const readmeRow = page.locator(".tree-row", { hasText: "README.md" });
  await expect(readmeRow).toBeVisible();
  await readmeRow.dblclick();
  await expect(page.locator(".cm-line").first()).toHaveText(contents?.split("\n")[0] ?? "# Mock Project");
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

  const lineCount = await page.locator(".cm-line").count();
  await page.locator(".cm-git-change").first().click();
  // 只摆改动本身:HEAD 里那一行(词级高亮出被改掉的字符)。没有上下文行,没有脚注。
  const inline = page.locator(".cm-git-inline");
  await expect(inline).toBeVisible();
  await expect(inline.locator(".cm-git-row")).toHaveText(["L2"]);
  // 悬浮,不撑开编辑区:行数不能变(块级插入会把正文整段推下去)。
  expect(await page.locator(".cm-line").count()).toBe(lineCount);
  // 浮层必须活在 contenteditable 外面。活在里面的话 WKWebView 拖选时会把 caret 拽回可编辑区,
  // 浮层里根本形不成选区 —— 而 Chromium 不这样,所以这条断言是这个坑唯一的岗哨。
  expect(await inline.evaluate((el) => Boolean(el.closest(".cm-content")))).toBe(false);

  // 下面几条都在量几何。浮层的定位走 CM 的 requestMeasure,晚一帧才写回样式 —— 直接量会量到旧位置,
  // 所以先 poll 等它落位(卡片必须落在改动行「下面」,不能盖住它:那行正是要拿来跟原文对照的)。
  const changedLine = await page.locator(".cm-line").nth(1).boundingBox();
  const lineBottom = (changedLine?.y ?? 0) + (changedLine?.height ?? 0);
  await expect.poll(async () => (await inline.boundingBox())?.y ?? 0).toBeGreaterThanOrEqual(lineBottom - 1);

  // 旧行的字要跟正文的字对齐同一列 —— 新旧上下一比就出来,不用横向找。
  // 基准是正文文字的起始处 = 行盒左沿 + 它的左内边距(别直接拿 .cm-line 的 x,那还含 12px 内边距)。
  const textLeft = await page
    .locator(".cm-line")
    .nth(1)
    .evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return rect.left + parseFloat(getComputedStyle(el).paddingLeft);
    });
  const oldText = await inline.locator(".cm-git-row-code").first().boundingBox();
  expect(Math.abs((oldText?.x ?? 0) - textLeft)).toBeLessThan(2);

  // 工具条自成一行排在原文下面,不能压住原文。
  const toolbar = await inline.locator(".cm-git-inline-bar").boundingBox();
  expect(toolbar?.y ?? 0).toBeGreaterThanOrEqual((oldText?.y ?? 0) + (oldText?.height ?? 0) - 1);

  // 原文要能拖选。CM 的 widget DOM 是 contenteditable=false,而且 ignoreEvent 一旦返回 false,
  // 编辑器就会接管 mousedown 把它当自己的选区起点 —— 浮层里的文字当场选不动。
  // 必须用真实鼠标拖:JS 造的选区会被 CM 同步回编辑器状态,活不到下一帧。
  await expect(inline.locator(".cm-git-row-old")).not.toHaveCSS("user-select", "none");
  const mid = (oldText?.y ?? 0) + (oldText?.height ?? 0) / 2;
  await page.mouse.move((oldText?.x ?? 0) + 1, mid);
  await page.mouse.down();
  await page.mouse.move((oldText?.x ?? 0) + (oldText?.width ?? 0) - 1, mid, { steps: 8 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("L2");

  // 选中之后还得能复制出去。CM 自己接管了 copy 事件,会拿「编辑器的选区」写剪贴板 ——
  // 不把这个事件从它手里要回来,复制出来的是正文的那一行,不是你选中的原文。
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() => navigator.clipboard.writeText("__before__"));
  await page.keyboard.press("ControlOrMeta+c");
  await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText())).toBe("L2");

  await page.keyboard.press("Escape"); // Esc 收起
  await expect(page.locator(".cm-git-inline")).toHaveCount(0);
  await page.locator(".cm-git-change").first().click(); // 再点开,验证撤回

  await inline.locator('[data-action="revert"]').click();
  await expect(page.locator(".cm-git-inline")).toHaveCount(0); // 改动没了 → 展开块自动收起
  await expect(page.locator(".cm-git-change")).toHaveCount(0);
  expect(await page.locator(".cm-content").textContent()).toBe(before);
});

/** 纯新增块没有原文可对照 → 只悬浮一条工具条,不撑开新行(更不摆上下文行和「新增 N 行」)。 */
test("纯新增:只悬浮一条工具条,不撑开新行;Esc 收起", async ({ page }) => {
  await openReadme(page, "L1\nL2\n");
  await page.locator(".cm-line").nth(0).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("NEW");

  const lineCount = await page.locator(".cm-line").count();
  await page.locator(".cm-git-change").first().click();

  const floating = page.locator(".cm-git-popup");
  const bar = floating.locator(".cm-git-inline-bar");
  await expect(bar).toBeVisible();
  await expect(floating.locator('[data-action="revert"]')).toBeVisible(); // 撤回照样能用

  // 盒子不能塌:这条工具条曾经因为 left/right 同时有值而被算出负宽度,只剩图标浮在透明背景上。
  const box = await bar.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(80);
  expect(await bar.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");

  // 靠左:工具条左沿应贴着这一行的起始处,不是飘到行尾。
  const lineBox = await page.locator(".cm-line").nth(1).boundingBox();
  expect(Math.abs((box?.x ?? 0) - (lineBox?.x ?? 0))).toBeLessThan(24);
  await expect(page.locator(".cm-git-inline")).toHaveCount(0); // 没有卡片,也就没有上下文行 / 脚注
  expect(await page.locator(".cm-line").count()).toBe(lineCount); // 没多撑出一行

  await page.keyboard.press("Escape");
  await expect(bar).toHaveCount(0);
});

/** 工具条要落在「你点的那一行」。块跨多行时,拿块首行当锚点的话,点第 4 行会弹到第 2 行去。 */
test("纯新增:跨多行的块,工具条落在点击的那一行", async ({ page }) => {
  await openReadme(page, "L1\nL2\n");
  await page.locator(".cm-line").nth(0).click();
  await page.keyboard.press("End");
  await page.keyboard.type("\nA1\nA2\nA3"); // 一个跨 3 行的新增块(第 2~4 行)

  const bars = page.locator(".cm-git-gutter .cm-git-change");
  await expect(bars).toHaveCount(3);

  const clickedRow = 3; // 点这个块的最后一行(第 4 行 = .cm-line 的第 4 个)
  await bars.nth(clickedRow - 1).click();

  // 竖直方向要贴着被点的那一行(工具条比行高,允许上下各溢出一点)。
  // 用 poll:浮层的定位走 CM 的 requestMeasure,晚一帧才写回样式,直接量会量到旧位置。
  await expect
    .poll(async () => {
      const barBox = await page.locator(".cm-git-popup .cm-git-inline-bar").boundingBox();
      const lineBox = await page.locator(".cm-line").nth(clickedRow).boundingBox();
      return Math.abs((barBox?.y ?? 0) - (lineBox?.y ?? 0));
    })
    .toBeLessThan(12);
});

/** 删除浮层只摆被删掉的内容:那几行就是全部信息,上下文行和「N 行删除」都是噪音。 */
test("纯删除:只摆被删的行,不带上下文和脚注;卡片宽度不超编辑区 70%", async ({ page }) => {
  await openReadme(page, "L1\nGONE\nL3\n");
  await page.locator(".cm-line").nth(1).click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+ArrowDown"); // 整行删掉
  await page.keyboard.press("Delete");

  const lineCount = await page.locator(".cm-line").count();
  // 删除标记本身是 pointer-events:none(它探进了下一行的格子),点它所在的 gutter 格子。
  await page.locator(".cm-git-gutter .cm-gutterElement:has(.cm-git-change-del)").click();
  const card = page.locator(".cm-git-inline");
  await expect(card.locator(".cm-git-row")).toHaveText(["GONE"]); // 只有被删的那行,没有上下文
  expect(await page.locator(".cm-line").count()).toBe(lineCount); // 悬浮,不撑开编辑区

  const cardBox = await card.boundingBox();
  const viewport = page.viewportSize();
  expect(cardBox?.width ?? 0).toBeLessThanOrEqual((viewport?.width ?? 0) * 0.71);

  // 回正文里点一下就该收起来。注意这不会触发 blur(焦点一直在编辑器上),
  // 光靠 focusChangeEffect 是关不掉的 —— 曾经就漏在这儿。
  await page.locator(".cm-line").first().click();
  await expect(card).toHaveCount(0);

  // 竖线的每一个像素都得可点。它一旦探出自己那一格(骑到两行交界上),下半截就落在下一行的
  // gutter 格子里 —— 那儿没有块,点下半截会静默地什么都不发生。这里按像素点它的最下沿。
  const bar = await page.locator(".cm-git-change-del").boundingBox();
  await page.mouse.click((bar?.x ?? 0) + 1, (bar?.y ?? 0) + (bar?.height ?? 0) - 1);
  await expect(page.locator(".cm-git-inline")).toHaveCount(1);

  // 点到编辑器外面(文件树)同样收起。
  await page.locator(".tree-row").first().click();
  await expect(page.locator(".cm-git-inline")).toHaveCount(0);
});

/** 同一处替换在编辑区和浮层里配同一种颜色 —— 这是「谁对应谁」的全部依据,配色丢了这功能就废了。 */
test("词级配色:编辑区里改掉的字符与浮层里的原字符同色", async ({ page }) => {
  await openReadme(page, "L1\nkeep alpha end\nL3\n");
  await page.locator(".cm-line").nth(1).click();
  await page.keyboard.press("End");
  for (let i = 0; i < 4; i += 1) await page.keyboard.press("Backspace"); // "end" → 改成 "tail"
  await page.keyboard.type(" tail");

  await page.locator(".cm-git-change").first().click();
  const inEditor = page.locator(".cm-line .cm-git-op-a").first();
  const inPopover = page.locator(".cm-git-inline .cm-git-op-a").first();
  await expect(inEditor).toBeVisible();
  await expect(inPopover).toBeVisible();

  const color = (locator: Locator) => locator.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await color(inEditor)).toBe(await color(inPopover));
});

/** 删除在编辑区竖红线,新增在浮层里竖绿线 —— 两边对称,「只存在于一边」的改动都有着落。 */
test("行内增删:编辑区红线标删除,浮层绿线标新增", async ({ page }) => {
  // 两行分开做:一行只删、一行只加。删加挤在同一处的话 diff 会把它认成「整段替换」(pair),
  // 那是两边都有内容的改动,压根不需要锚点。
  await openReadme(page, "L1\nkeep DELME keep\nkeep\nL3\n");

  await page.locator(".cm-line").nth(1).click(); // 第 2 行:只删
  await page.keyboard.press("Home");
  for (let i = 0; i < 4; i += 1) await page.keyboard.press("ArrowRight"); // 跳过 "keep"
  for (let i = 0; i < 6; i += 1) await page.keyboard.press("Shift+ArrowRight"); // 选中 " DELME"
  await page.keyboard.press("Delete");

  await page.locator(".cm-line").nth(2).click(); // 第 3 行:只加
  await page.keyboard.press("End");
  await page.keyboard.type(" ADDED");

  await page.locator(".cm-git-change").first().click();
  // 编辑区:被删掉的那段在新行里不占宽度 → 红线标出它原来在哪儿。
  await expect(page.locator(".cm-line .cm-git-anchor-del")).not.toHaveCount(0);
  // 浮层:新加的那段在旧行里不存在 → 绿线标出它被插到哪儿。
  await expect(page.locator(".cm-git-inline .cm-git-anchor-add")).not.toHaveCount(0);
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
