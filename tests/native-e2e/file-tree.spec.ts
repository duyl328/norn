import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const fixtureRoot = process.env.NORN_NATIVE_E2E_FILES!;
const hookRoot = process.env.NORN_NATIVE_E2E_HOOK_DIR!;
const application = resolve("src-tauri/target/debug/norn.exe");
const exclusiveLockScript = resolve("tests/native-e2e/helpers/exclusive-file-lock.ps1");
const treeRoot = join(fixtureRoot, "sorted-tree");

const startExclusiveFileLock = async (path: string) => {
  const marker = `tree-lock-${Date.now()}`;
  const readyPath = join(hookRoot, `${marker}.ready`);
  const releasePath = join(hookRoot, `${marker}.release`);
  const process = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      exclusiveLockScript,
      "-TargetPath",
      path,
      "-ReadyPath",
      readyPath,
      "-ReleasePath",
      releasePath,
    ],
    { stdio: "ignore", windowsHide: true },
  );
  await browser.waitUntil(() => existsSync(readyPath) || process.exitCode !== null, { timeout: 20_000, interval: 50 });
  assert.equal(process.exitCode, null, "exclusive tree lock exited early");
  return async () => {
    writeFileSync(releasePath, "release", "utf8");
    await browser.waitUntil(() => process.exitCode !== null, { timeout: 20_000, interval: 50 });
    rmSync(readyPath, { force: true });
    rmSync(releasePath, { force: true });
  };
};

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

const openTree = async (path: string) => {
  execFileSync(application, [path], { timeout: 10_000, stdio: "ignore" });
  await browser.waitUntil(
    () =>
      browser.execute(
        (expected) =>
          document
            .querySelector('.project-panel-main-region button.tree-row-root[data-tree-drop-scope="main"]')
            ?.getAttribute("title") === expected,
        path,
      ),
    { timeout: 20_000, interval: 100, timeoutMsg: `native tree did not open ${path}` },
  );
};

const nativeInvoke = <T>(cmd: string, args: unknown): Promise<T> =>
  browser.executeAsync(
    (command, commandArgs, done) => {
      const invoke = (
        window as typeof window & { __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<unknown> } }
      ).__TAURI_INTERNALS__.invoke;
      invoke(command, commandArgs).then((value) => done({ ok: true, value }), (error) => done({ ok: false, error }));
    },
    cmd,
    args,
  ).then((result) => {
    const response = result as { ok: boolean; value?: T; error?: unknown };
    if (!response.ok) throw response.error;
    return response.value as T;
  });

const waitForTreeName = async (name: string, visible = true) => {
  await browser.waitUntil(
    () =>
      browser.execute(
        (expected, shouldExist) =>
          [...document.querySelectorAll<HTMLElement>(".project-panel-main-region .tree-row-name")].some(
            (element) => element.innerText === expected,
          ) === shouldExist,
        name,
        visible,
      ),
    { timeout: 20_000, interval: 100, timeoutMsg: `${name} visibility did not become ${visible}` },
  );
};

const clickTreeRow = async (name: string, options: { context?: boolean; double?: boolean } = {}) => {
  const clicked = await browser.execute(
    (expected, context, double) => {
      const row = [...document.querySelectorAll<HTMLElement>(".project-panel-main-region .tree-row")].find(
        (candidate) => candidate.querySelector<HTMLElement>(".tree-row-name")?.innerText === expected,
      );
      if (!row) return false;
      if (context) row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, button: 2, clientX: 80, clientY: 80 }));
      else row.dispatchEvent(new MouseEvent(double ? "dblclick" : "click", { bubbles: true, detail: double ? 2 : 1 }));
      return true;
    },
    name,
    Boolean(options.context),
    Boolean(options.double),
  );
  assert.equal(clicked, true, `tree row ${name} did not exist`);
};

const clickContextItem = async (pattern: string) => {
  await browser.waitUntil(() => browser.execute(() => Boolean(document.querySelector(".file-tree-context-menu"))), {
    timeout: 10_000,
    interval: 50,
  });
  const clicked = await browser.execute((source) => {
    const matcher = new RegExp(source, "i");
    const button = [...document.querySelectorAll<HTMLButtonElement>(".file-tree-context-item")].find((candidate) =>
      matcher.test(candidate.innerText),
    );
    button?.click();
    return Boolean(button);
  }, pattern);
  assert.equal(clicked, true, `context item ${pattern} did not exist`);
};

const submitNameDialog = async (name: string) => {
  await browser.waitUntil(() => browser.execute(() => Boolean(document.querySelector('[role="dialog"] input'))), {
    timeout: 10_000,
    interval: 50,
  });
  await browser.execute((value) => {
    const input = document.querySelector<HTMLInputElement>('[role="dialog"] input')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.closest("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  }, name);
};

const pressTreeShortcut = async (key: string, ctrlKey = true) => {
  await browser.execute(
    (shortcut, ctrl) => {
      const tree = document.querySelector<HTMLElement>('.project-panel-main-region [role="tree"]');
      tree?.focus();
      tree?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ctrlKey: ctrl, key: shortcut }));
    },
    key,
    ctrlKey,
  );
};

describe("@native @p0 Windows native file tree workflows", () => {
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

  it("NATIVE-TREE-001 synchronizes external create, rename, and delete through the real watcher", async () => {
    const path = join(fixtureRoot, "native-tree-watcher");
    mkdirSync(path, { recursive: true });
    await openTree(path);
    const created = join(path, "watch-created.txt");
    const renamed = join(path, "watch-renamed.txt");
    writeFileSync(created, "watcher", "utf8");
    await waitForTreeName("watch-created.txt");
    renameSync(created, renamed);
    await waitForTreeName("watch-renamed.txt");
    await waitForTreeName("watch-created.txt", false);
    rmSync(renamed);
    await waitForTreeName("watch-renamed.txt", false);
  });

  it("NATIVE-TREE-002 creates real files and folders from the tree UI", async () => {
    const path = join(fixtureRoot, "native-tree-create");
    mkdirSync(path, { recursive: true });
    await openTree(path);
    for (const [menuPattern, name] of [
      ["New File|新建文件", "created-file.txt"],
      ["New Folder|新建文件夹", "created-folder"],
    ]) {
      await browser.execute(() => {
        document
          .querySelector<HTMLElement>('.project-panel-main-region button.tree-row-root[data-tree-drop-scope="main"]')
          ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, button: 2, clientX: 80, clientY: 80 }));
      });
      await clickContextItem(menuPattern);
      await submitNameDialog(name);
      await browser.waitUntil(() => existsSync(join(path, name)), { timeout: 10_000, interval: 50 });
    }
    assert.equal(existsSync(join(path, "created-file.txt")), true);
    assert.equal(existsSync(join(path, "created-folder")), true);
  });

  it("NATIVE-TREE-003 renames a real selected file and synchronizes its open tab", async () => {
    const path = join(fixtureRoot, "native-tree-rename");
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "before.txt"), "rename me", "utf8");
    await openTree(path);
    await clickTreeRow("before.txt", { double: true });
    await clickTreeRow("before.txt", { context: true });
    await clickContextItem("^Rename$|重命名");
    await submitNameDialog("after.txt");
    await browser.waitUntil(() => existsSync(join(path, "after.txt")) && !existsSync(join(path, "before.txt")), {
      timeout: 10_000,
      interval: 50,
    });
    await browser.waitUntil(
      () =>
        browser.execute(() =>
          [...document.querySelectorAll<HTMLElement>('.editor-file-tab[aria-selected="true"]')].some((tab) =>
            tab.innerText.includes("after.txt"),
          ),
        ),
      { timeout: 10_000, interval: 50 },
    );
  });

  it("NATIVE-TREE-004 moves a real file to the Windows recycle bin and restores it", async () => {
    const path = join(fixtureRoot, "native-tree-trash");
    mkdirSync(path, { recursive: true });
    const name = `norn-recycle-${Date.now()}.txt`;
    const target = join(path, name);
    writeFileSync(target, "recoverable", "utf8");
    await openTree(path);
    await clickTreeRow(name, { context: true });
    await clickContextItem("Move to Trash|移到废纸篓");
    await browser.waitUntil(() => browser.execute(() => Boolean(document.querySelector('[role="dialog"]'))), {
      timeout: 10_000,
      interval: 50,
    });
    await browser.execute(() => {
      const buttons = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')];
      buttons.find((button) => /trash|废纸篓/i.test(button.innerText))?.click();
    });
    await browser.waitUntil(() => !existsSync(target), { timeout: 10_000, interval: 50 });

    const escaped = name.replaceAll("'", "''");
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `$bin=(New-Object -ComObject Shell.Application).Namespace(10);$item=@($bin.Items())|Where-Object{$_.Name -eq '${escaped}'}|Select-Object -First 1;if(-not $item){exit 2};$verb=@($item.Verbs())|Where-Object{$_.Name -match 'Restore|还原'}|Select-Object -First 1;if(-not $verb){exit 3};$verb.DoIt()`,
      ],
      { timeout: 20_000, stdio: "ignore" },
    );
    await browser.waitUntil(() => existsSync(target), { timeout: 10_000, interval: 100 });
  });

  it("NATIVE-TREE-005 copies, cuts, pastes, and moves real files", async () => {
    const path = join(fixtureRoot, "native-tree-clipboard");
    const destination = join(path, "destination");
    mkdirSync(destination, { recursive: true });
    writeFileSync(join(path, "copy.txt"), "copy", "utf8");
    writeFileSync(join(path, "cut.txt"), "cut", "utf8");
    await openTree(path);
    for (const [name, key] of [
      ["copy.txt", "c"],
      ["cut.txt", "x"],
    ]) {
      await clickTreeRow(name);
      await pressTreeShortcut(key);
      await clickTreeRow("destination");
      await pressTreeShortcut("v");
    }
    await browser.waitUntil(
      () => existsSync(join(destination, "copy.txt")) && existsSync(join(destination, "cut.txt")),
      { timeout: 10_000, interval: 50 },
    );
    assert.equal(existsSync(join(path, "copy.txt")), true);
    assert.equal(existsSync(join(path, "cut.txt")), false);
  });

  it("NATIVE-TREE-006 copies real external files and directories through native IPC", async () => {
    const path = join(fixtureRoot, "native-tree-external-target");
    const source = join(fixtureRoot, "native-tree-external-source");
    mkdirSync(path, { recursive: true });
    mkdirSync(join(source, "nested"), { recursive: true });
    writeFileSync(join(source, "outside.txt"), "outside", "utf8");
    writeFileSync(join(source, "nested", "inside.txt"), "inside", "utf8");
    await openTree(path);
    await nativeInvoke("copy_external_paths", {
      workspaceRoot: path,
      sourcePaths: [join(source, "outside.txt"), join(source, "nested")],
      targetDirectory: path,
    });
    assert.equal(existsSync(join(path, "outside.txt")), true);
    assert.equal(existsSync(join(path, "nested", "inside.txt")), true);
  });

  it("NATIVE-TREE-007 reports file-lock and permission failures and remains retryable", async () => {
    const path = join(fixtureRoot, "native-tree-errors");
    const destination = join(path, "destination");
    const locked = join(path, "locked.txt");
    mkdirSync(destination, { recursive: true });
    writeFileSync(locked, "locked", "utf8");
    await openTree(path);
    const releaseLock = await startExclusiveFileLock(locked);
    try {
      await assert.rejects(
        nativeInvoke("move_path", { workspaceRoot: path, sourcePath: locked, targetDirectory: destination }),
      );
    } finally {
      await releaseLock();
    }
    await nativeInvoke("move_path", { workspaceRoot: path, sourcePath: locked, targetDirectory: destination });
    assert.equal(existsSync(join(destination, "locked.txt")), true);

    const denied = join(path, "denied");
    mkdirSync(denied);
    const username = process.env.USERNAME!;
    execFileSync("icacls.exe", [denied, "/inheritance:r", "/deny", `${username}:(OI)(CI)W`], { stdio: "ignore" });
    try {
      await assert.rejects(
        nativeInvoke("create_file", { workspaceRoot: path, parentPath: denied, name: "blocked.txt" }),
      );
    } finally {
      execFileSync("icacls.exe", [denied, "/remove:d", username, "/inheritance:e"], { stdio: "ignore" });
    }
    await nativeInvoke("create_file", { workspaceRoot: path, parentPath: denied, name: "retry.txt" });
    assert.equal(existsSync(join(denied, "retry.txt")), true);
  });

  it("NATIVE-TREE-008 handles Unicode, long, and case-distinct paths safely", async () => {
    const path = join(fixtureRoot, "native-tree-unicode-long");
    let deep = path;
    while (deep.length < 285) deep = join(deep, "很长的目录 name");
    mkdirSync(deep, { recursive: true });
    const unicode = join(deep, "中文 Space #%.txt");
    writeFileSync(unicode, "unicode long path", "utf8");
    const entries = await nativeInvoke<Array<{ name: string }>>("list_directory", { path: deep });
    assert.equal(entries.some((entry) => entry.name === "中文 Space #%.txt"), true);
    writeFileSync(join(path, "Case.txt"), "case", "utf8");
    await assert.rejects(
      nativeInvoke("rename_path", { workspaceRoot: path, path: join(path, "Case.txt"), newName: "case.txt" }),
    );
    assert.equal(existsSync(join(path, "Case.txt")), true);
  });

  it("NATIVE-TREE-009 marks a real junction loop and does not recursively expand it", async () => {
    const path = join(fixtureRoot, "native-tree-loop");
    const parent = join(path, "parent");
    const junction = join(parent, "back-to-parent");
    mkdirSync(parent, { recursive: true });
    execFileSync("cmd.exe", ["/c", "mklink", "/J", junction, parent], { timeout: 10_000, stdio: "ignore" });
    await openTree(path);
    await clickTreeRow("parent", { double: true });
    await waitForTreeName("back-to-parent");
    const loopText = await browser.execute(() =>
      [...document.querySelectorAll<HTMLElement>(".project-panel-main-region .tree-row")].find((row) =>
        row.innerText.includes("back-to-parent"),
      )?.innerText,
    );
    assert.match(loopText ?? "", /loop|循环/i);
  });

  it("NATIVE-TREE-010 virtualizes thousands of real files while keeping selection stable", async () => {
    const path = join(fixtureRoot, "native-tree-thousands");
    mkdirSync(path, { recursive: true });
    for (let index = 0; index < 3_000; index += 1) {
      writeFileSync(join(path, `item-${String(index).padStart(4, "0")}.txt`), String(index), "utf8");
    }
    await openTree(path);
    await browser.waitUntil(
      () => browser.execute(() => document.querySelectorAll(".project-panel-main-region .tree-row:not(.tree-row-root)").length > 0),
      { timeout: 30_000, interval: 100 },
    );
    const rendered = await browser.execute(
      () => document.querySelectorAll(".project-panel-main-region .tree-row:not(.tree-row-root)").length,
    );
    assert.equal(rendered < 120, true, `expected virtualization, rendered ${rendered} rows`);
    await browser.execute(() => {
      const scroll = document.querySelector<HTMLElement>(".project-panel-main-region .file-tree-scroll")!;
      scroll.scrollTop = scroll.scrollHeight;
    });
    await browser.waitUntil(
      () => browser.execute(() => Boolean(document.querySelector(".project-panel-main-region .tree-row:not(.tree-row-root)"))),
      { timeout: 10_000, interval: 50 },
    );
    const selectedName = await browser.execute(() => {
      const rows = [...document.querySelectorAll<HTMLElement>(".project-panel-main-region .tree-row:not(.tree-row-root)")];
      const row = rows.at(-2)!;
      row.click();
      return row.querySelector<HTMLElement>(".tree-row-name")?.innerText ?? "";
    });
    assert.notEqual(selectedName, "");
    const watcherProbe = join(path, "zzzz-watcher-probe.txt");
    writeFileSync(watcherProbe, "probe", "utf8");
    await waitForTreeName("zzzz-watcher-probe.txt");
    assert.equal(readdirSync(path).length, 3_001);
    assert.equal(
      await browser.execute(
        (name) =>
          document
            .querySelector<HTMLElement>('.project-panel-main-region [role="tree"]')
            ?.getAttribute("aria-activedescendant")
            ?.endsWith(name) ?? false,
        selectedName,
      ),
      true,
    );
    rmSync(watcherProbe);
  });
});
