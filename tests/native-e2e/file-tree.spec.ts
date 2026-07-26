import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const fixtureRoot = process.env.NORN_NATIVE_E2E_FILES!;
const application = resolve("src-tauri/target/debug/norn.exe");
const treeRoot = join(fixtureRoot, "sorted-tree");

type TreeRow = { directory: boolean; name: string };

const readTreeRows = async (): Promise<TreeRow[]> =>
  browser.execute(() =>
    [...document.querySelectorAll<HTMLElement>(".project-panel-main-region .tree-row:not(.tree-row-root)")].map(
      (element) => ({
        directory: element.hasAttribute("aria-expanded"),
        name: element.querySelector<HTMLElement>(".tree-row-name")?.innerText ?? "",
      }),
    ),
  );

const refreshRoot = async () => {
  const opened = await browser.execute(() => {
    const root = document.querySelector<HTMLElement>(
      '.project-panel-main-region button.tree-row-root[data-tree-drop-scope="main"]',
    );
    root?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, button: 2, clientX: 80, clientY: 80 }));
    return Boolean(root);
  });
  assert.equal(opened, true, "main tree root did not exist");
  await browser.waitUntil(() => browser.execute(() => Boolean(document.querySelector(".file-tree-context-menu"))), {
    timeout: 10_000,
    interval: 50,
    timeoutMsg: "file tree context menu did not open",
  });
  const clicked = await browser.execute(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>(".file-tree-context-item")].find((candidate) =>
      /刷新|refresh/i.test(candidate.innerText),
    );
    button?.click();
    return Boolean(button);
  });
  assert.equal(clicked, true, "refresh menu item did not exist");
  await browser.waitUntil(
    () =>
      browser.execute(
        () =>
          !document
            .querySelector('.project-panel-main-region button.tree-row-root[data-tree-drop-scope="main"]')
            ?.innerText.includes("..."),
      ),
    { timeout: 10_000, interval: 50, timeoutMsg: "file tree refresh did not finish" },
  );
};

describe("Windows native file tree workflows", () => {
  before(async () => {
    mkdirSync(treeRoot, { recursive: true });
    for (const name of ["2-dir", "10-dir", "中文目录"]) mkdirSync(join(treeRoot, name), { recursive: true });
    for (const name of ["Alpha.txt", "file-2.txt", "file-10.txt", "中文.txt"]) {
      writeFileSync(join(treeRoot, name), name, "utf8");
    }
    execFileSync(application, [treeRoot], { timeout: 10_000, stdio: "ignore" });
    await browser.waitUntil(
      () =>
        browser.execute(
          (expected) =>
            document
              .querySelector('.project-panel-main-region button.tree-row-root[data-tree-drop-scope="main"]')
              ?.getAttribute("title") === expected,
          treeRoot,
        ),
      { timeout: 20_000, interval: 100, timeoutMsg: `native tree did not open: ${treeRoot}` },
    );
    await browser.execute(() => document.querySelector<HTMLElement>(".driver-popover-close-btn")?.click());
    await browser.execute(() => {
      const panelToggle = document.querySelector<HTMLElement>(".windows-titlebar-right-tools .titlebar-panel-button");
      if (/显示|show/i.test(panelToggle?.getAttribute("aria-label") ?? "")) panelToggle?.click();
    });
    await browser.waitUntil(async () => (await readTreeRows()).length === 7, {
      timeout: 20_000,
      interval: 100,
      timeoutMsg: "native tree entries did not render",
    });
  });

  it("TREE-LOAD-014 keeps real directory sorting stable across refreshes", async () => {
    const initial = await readTreeRows();
    assert.deepEqual(
      initial.map((row) => row.directory),
      [true, true, true, false, false, false, false],
      "directories must sort before files",
    );
    for (const group of [initial.slice(0, 3), initial.slice(3)]) {
      const foldedNames = group.map((row) => row.name.toLocaleLowerCase());
      assert.deepEqual(foldedNames, [...foldedNames].sort(), "names must be ordered case-insensitively");
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await refreshRoot();
      assert.deepEqual(await readTreeRows(), initial, `tree order changed after refresh ${attempt + 1}`);
    }
  });
});
