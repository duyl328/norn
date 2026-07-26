import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const fixtureRoot = process.env.NORN_NATIVE_E2E_FILES!;
const hookRoot = process.env.NORN_NATIVE_E2E_HOOK_DIR!;
const application = resolve("src-tauri/target/debug/norn.exe");
const hookWaitBuffer = new Int32Array(new SharedArrayBuffer(4));

type NativeHookCommand = "inspect_text_file" | "read_text_file" | "save_text_file_after_version_check";

const getHookPaths = (command: NativeHookCommand, path: string) => {
  const fileName = path.split(/[\\/]/).pop() ?? "unknown";
  const key = `${command}--${fileName.replace(/[^A-Za-z0-9_.-]/g, "_")}`;
  return {
    pause: join(hookRoot, `${key}.pause`),
    reached: join(hookRoot, `${key}.reached`),
    release: join(hookRoot, `${key}.release`),
  };
};

const armNativeHook = (command: NativeHookCommand, path: string) => {
  const hook = getHookPaths(command, path);
  for (const marker of Object.values(hook)) rmSync(marker, { force: true });
  writeFileSync(hook.pause, "pause", "utf8");
  return hook;
};

const waitForHookReached = (reachedPath: string) => {
  const deadline = Date.now() + 20_000;
  while (!existsSync(reachedPath) && Date.now() < deadline) Atomics.wait(hookWaitBuffer, 0, 0, 20);
  assert.equal(existsSync(reachedPath), true, `native E2E hook was not reached: ${reachedPath}`);
};

const requestNativeFile = (path: string) => {
  execFileSync(application, [fixtureRoot, path], { timeout: 10_000, stdio: "ignore" });
};

const openAtNativeHook = async (command: NativeHookCommand, path: string, mutateFile: () => void) => {
  const hook = armNativeHook(command, path);
  requestNativeFile(path);
  try {
    waitForHookReached(hook.reached);
    mutateFile();
  } finally {
    writeFileSync(hook.release, "release", "utf8");
  }
  await browser.waitUntil(() => !existsSync(hook.pause) && !existsSync(hook.reached) && !existsSync(hook.release), {
    timeout: 20_000,
    interval: 50,
    timeoutMsg: `native E2E hook was not consumed: ${hook.pause}`,
  });
};

const saveAtNativeHook = async (path: string, mutateFile: () => Promise<void> | void) => {
  const hook = armNativeHook("save_text_file_after_version_check", path);
  await browser.keys(["Control", "s"]);
  try {
    waitForHookReached(hook.reached);
    await mutateFile();
  } finally {
    writeFileSync(hook.release, "release", "utf8");
  }
  await browser.waitUntil(() => !existsSync(hook.pause) && !existsSync(hook.reached) && !existsSync(hook.release), {
    timeout: 20_000,
    interval: 50,
    timeoutMsg: `native save hook was not consumed: ${hook.pause}`,
  });
};

const waitForSelector = async (selector: string) => {
  await browser.waitUntil(() => browser.execute((candidate) => Boolean(document.querySelector(candidate)), selector), {
    timeout: 20_000,
    interval: 200,
    timeoutMsg: `selector did not appear: ${selector}`,
  });
};

const waitForEditorText = async (text: string) => {
  await browser.waitUntil(
    () =>
      browser.execute(
        (expected) => (document.querySelector<HTMLElement>(".cm-content")?.innerText ?? "").includes(expected),
        text,
      ),
    { timeout: 20_000, interval: 200, timeoutMsg: `editor did not contain: ${text}` },
  );
};

const waitForActiveTab = async (name: string) => {
  try {
    await browser.waitUntil(
      () =>
        browser.execute(
          (expected) =>
            (document.querySelector<HTMLElement>('.editor-file-tab[aria-selected="true"]')?.innerText ?? "").includes(
              expected,
            ),
          name,
        ),
      { timeout: 20_000, interval: 200, timeoutMsg: `active tab did not become ${name}` },
    );
  } catch (error) {
    const state = await browser.execute(() => ({
      activeTab: document.querySelector<HTMLElement>('.editor-file-tab[aria-selected="true"]')?.innerText ?? "",
      body: document.body?.innerText.slice(0, 1_200) ?? "",
      editor: document.querySelector<HTMLElement>(".cm-content")?.innerText ?? "",
    }));
    throw new Error(`${String(error)}\nUI state: ${JSON.stringify(state)}`);
  }
};

const openNativeFile = async (path: string) => {
  requestNativeFile(path);
  await waitForActiveTab(path.split(/[\\/]/).pop() ?? path);
  await browser.execute(() => document.querySelector<HTMLElement>(".driver-popover-close-btn")?.click());
};

const waitForFileError = async (text: string) => {
  await browser.waitUntil(
    () =>
      browser.execute(
        (expected) =>
          (document.querySelector<HTMLElement>('[class*="bg-destructive"]')?.innerText ?? "").includes(expected),
        text,
      ),
    { timeout: 20_000, interval: 100, timeoutMsg: `file error did not contain: ${text}` },
  );
};

const expectTabAbsent = async (name: string) => {
  const tabNames = await browser.execute(() =>
    [...document.querySelectorAll<HTMLElement>(".editor-file-tab")].map((tab) => tab.innerText),
  );
  assert.equal(
    tabNames.some((tabName) => tabName.includes(name)),
    false,
    `unexpected tab remained for ${name}: ${tabNames.join(", ")}`,
  );
};

const waitForDirtyTab = async (name: string) => {
  await browser.waitUntil(
    () =>
      browser.execute((expected) => {
        const tab = [...document.querySelectorAll<HTMLElement>(".editor-file-tab")].find((candidate) =>
          candidate.innerText.includes(expected),
        );
        return (tab?.innerText ?? "").includes("•");
      }, name),
    { timeout: 20_000, interval: 100, timeoutMsg: `tab did not stay dirty: ${name}` },
  );
};

const waitForCleanTab = async (name: string) => {
  await browser.waitUntil(
    () =>
      browser.execute((expected) => {
        const tab = [...document.querySelectorAll<HTMLElement>(".editor-file-tab")].find((candidate) =>
          candidate.innerText.includes(expected),
        );
        return Boolean(tab) && !(tab?.innerText ?? "").includes("•");
      }, name),
    { timeout: 20_000, interval: 100, timeoutMsg: `tab did not become clean: ${name}` },
  );
};

const waitForDiskText = async (path: string, text: string) => {
  await browser.waitUntil(() => existsSync(path) && readFileSync(path, "utf8").includes(text), {
    timeout: 20_000,
    interval: 50,
    timeoutMsg: `disk file did not contain ${text}: ${path}`,
  });
};

const expectNoConflict = async () => {
  const conflictVisible = await browser.execute(() => Boolean(document.querySelector(".save-conflict-dialog")));
  assert.equal(conflictVisible, false, "unexpected save conflict dialog appeared");
};

const appendEditorText = async (text: string) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await browser.execute(() => {
      const editor = document.querySelector<HTMLElement>(".cm-content");
      editor?.click();
      editor?.focus();
    });
    await browser.keys(["Control", "End"]);
    await browser.keys(text);
    try {
      await browser.waitUntil(
        () =>
          browser.execute(
            (expected) => (document.querySelector<HTMLElement>(".cm-content")?.innerText ?? "").includes(expected),
            text,
          ),
        { timeout: 2_000, interval: 100 },
      );
      return;
    } catch {
      // CodeMirror can replace its content DOM while a file-open effect settles; retry against the current node.
    }
  }
  await waitForEditorText(text);
};

const waitForConflict = async () => {
  try {
    await browser.waitUntil(
      () =>
        browser.execute(() => {
          const dialog = document.querySelector<HTMLElement>(".save-conflict-dialog");
          if (!dialog) return false;
          const rect = dialog.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }),
      { timeout: 20_000, interval: 200, timeoutMsg: "file conflict dialog did not appear" },
    );
  } catch (error) {
    const state = await browser.execute(() => ({
      activeTab: document.querySelector<HTMLElement>('.editor-file-tab[aria-selected="true"]')?.innerText ?? "",
      body: document.body?.innerText.slice(0, 1_200) ?? "",
      editor: document.querySelector<HTMLElement>(".cm-content")?.innerText ?? "",
    }));
    throw new Error(`${String(error)}\nUI state: ${JSON.stringify(state)}`);
  }
};

const clickConflictButton = async (labels: string[]) => {
  const clicked = await browser.execute((expectedLabels) => {
    const dialog = document.querySelector<HTMLElement>(".save-conflict-dialog");
    const button = [...(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((candidate) =>
      expectedLabels.includes(candidate.innerText.trim()),
    );
    button?.click();
    return Boolean(button);
  }, labels);
  if (!clicked) throw new Error(`conflict button did not appear: ${labels.join(" / ")}`);
};

const triggerWindowFocusCheck = async () => {
  await browser.execute(() => window.dispatchEvent(new Event("focus")));
};

describe("Windows native file system workflows", () => {
  before(async () => {
    await waitForSelector(".cm-content");
    await browser.execute(() => document.querySelector<HTMLElement>(".driver-popover-close-btn")?.click());
  });

  it("NATIVE-FILE-OPEN-001/003 opens a real UTF-8 file with a Unicode path", async () => {
    const path = join(fixtureRoot, "真实 文件 🚀 #[1].txt");
    writeFileSync(path, "native unicode fixture\n", "utf8");

    await openNativeFile(path);

    await waitForEditorText("native unicode fixture");
    await waitForActiveTab("真实 文件 🚀 #[1].txt");
  });

  it("NATIVE-FILE-OPEN-002 opens UTF-8 BOM and UTF-16 LE/BE files without a visible BOM", async () => {
    const fixtures = [
      {
        name: "utf8-bom.txt",
        bytes: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("UTF-8 BOM 中文\n", "utf8")]),
        text: "UTF-8 BOM 中文",
      },
      {
        name: "utf16-le.txt",
        bytes: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("UTF-16 LE 中文\n", "utf16le")]),
        text: "UTF-16 LE 中文",
      },
      (() => {
        const bytes = Buffer.from("UTF-16 BE 中文\n", "utf16le");
        for (let index = 0; index < bytes.length; index += 2)
          [bytes[index], bytes[index + 1]] = [bytes[index + 1], bytes[index]];
        return {
          name: "utf16-be.txt",
          bytes: Buffer.concat([Buffer.from([0xfe, 0xff]), bytes]),
          text: "UTF-16 BE 中文",
        };
      })(),
    ];

    for (const fixture of fixtures) {
      const path = join(fixtureRoot, fixture.name);
      writeFileSync(path, fixture.bytes);
      await openNativeFile(path);
      await waitForEditorText(fixture.text);
      const editorText = await browser.execute(
        () => document.querySelector<HTMLElement>(".cm-content")?.innerText ?? "",
      );
      assert.equal(editorText.includes("\uFEFF"), false, `${fixture.name} rendered a BOM character`);
    }
  });

  it("NATIVE-FILE-OPEN-004 does not create a partial tab when the file is deleted during inspection", async () => {
    const path = join(fixtureRoot, "open-delete.txt");
    const sentinelPath = join(fixtureRoot, "open-delete-sentinel.txt");
    writeFileSync(path, "delete while opening\n", "utf8");
    writeFileSync(sentinelPath, "open request settled sentinel\n", "utf8");

    await openAtNativeHook("inspect_text_file", path, () => rmSync(path));

    await openNativeFile(sentinelPath);
    await waitForEditorText("open request settled sentinel");
    await expectTabAbsent("open-delete.txt");
  });

  it("NATIVE-FILE-OPEN-005 reads content and metadata from the version changed during open", async () => {
    const path = join(fixtureRoot, "open-modify.txt");
    writeFileSync(path, "open version one\n", "utf8");

    await openAtNativeHook("read_text_file", path, () =>
      writeFileSync(path, "open version two from external process\n", "utf8"),
    );

    await waitForActiveTab("open-modify.txt");
    await waitForEditorText("open version two from external process");
    const editorText = await browser.execute(() => document.querySelector<HTMLElement>(".cm-content")?.innerText ?? "");
    assert.equal(editorText.includes("open version one"), false);
  });

  it("NATIVE-FILE-OPEN-006 avoids duplicate tabs when the file is renamed during open", async () => {
    const path = join(fixtureRoot, "open-rename-before.txt");
    const renamedPath = join(fixtureRoot, "open-rename-after.txt");
    writeFileSync(path, "rename while opening\n", "utf8");

    await openAtNativeHook("read_text_file", path, () => renameSync(path, renamedPath));

    await waitForFileError("open-rename-before.txt");
    await expectTabAbsent("open-rename-before.txt");
    await openNativeFile(renamedPath);
    await waitForEditorText("rename while opening");
    const tabNames = await browser.execute(() =>
      [...document.querySelectorAll<HTMLElement>(".editor-file-tab")].map((tab) => tab.innerText),
    );
    assert.equal(tabNames.filter((tabName) => tabName.includes("open-rename-after.txt")).length, 1);
  });

  it("NATIVE-FILE-OPEN-007 rejects a file replaced with binary content before the read", async () => {
    const path = join(fixtureRoot, "open-binary.txt");
    writeFileSync(path, "text before binary replacement\n", "utf8");

    await openAtNativeHook("read_text_file", path, () => writeFileSync(path, Buffer.from([0x00, 0x01, 0x02, 0x03])));

    await waitForFileError("binary");
    await expectTabAbsent("open-binary.txt");
  });

  it("NATIVE-FILE-EDIT-001 reloads a clean document changed by another process", async () => {
    const path = join(fixtureRoot, "external-clean.txt");
    writeFileSync(path, "clean version one\n", "utf8");
    await openNativeFile(path);
    await waitForEditorText("clean version one");

    writeFileSync(path, "clean version two from external process\n", "utf8");

    await waitForEditorText("clean version two from external process");
  });

  it("NATIVE-FILE-EDIT-002 keeps local edits and reloads the latest disk version on request", async () => {
    const path = join(fixtureRoot, "external-dirty.txt");
    writeFileSync(path, "dirty base\n", "utf8");
    await openNativeFile(path);
    await waitForEditorText("dirty base");
    await appendEditorText("LOCAL_NATIVE_EDIT");

    writeFileSync(path, "disk conflict first\n", "utf8");
    await waitForConflict();
    await waitForEditorText("LOCAL_NATIVE_EDIT");
    writeFileSync(path, "disk conflict latest\n", "utf8");
    await clickConflictButton(["使用磁盘版本", "Use Disk"]);

    await waitForEditorText("disk conflict latest");
  });

  it("NATIVE-FILE-EDIT-003 reports a real external deletion", async () => {
    const path = join(fixtureRoot, "external-delete.txt");
    writeFileSync(path, "delete this uniquely sized native fixture externally\n", "utf8");
    await openNativeFile(path);
    await waitForEditorText("delete this uniquely sized native fixture externally");

    rmSync(path);
    await triggerWindowFocusCheck();

    await waitForConflict();
    await clickConflictButton(["丢弃", "Discard"]);
  });

  it("NATIVE-FILE-EDIT-004 preserves dirty content and recovery actions after external deletion", async () => {
    const path = join(fixtureRoot, "external-delete-dirty.txt");
    writeFileSync(path, "dirty deletion fixture with a deliberately unique byte length\n", "utf8");
    await openNativeFile(path);
    await waitForEditorText("dirty deletion fixture");
    await appendEditorText("LOCAL_DIRTY_DELETE");

    rmSync(path);
    await triggerWindowFocusCheck();

    await waitForConflict();
    await waitForEditorText("LOCAL_DIRTY_DELETE");
    await waitForDirtyTab("external-delete-dirty.txt");
    const buttonLabels = await browser.execute(() =>
      [...(document.querySelector(".save-conflict-dialog")?.querySelectorAll<HTMLButtonElement>("button") ?? [])].map(
        (button) => button.innerText.trim(),
      ),
    );
    assert.equal(
      buttonLabels.some((label) => ["另存为", "Save As"].includes(label)),
      true,
    );
    assert.equal(
      buttonLabels.some((label) => ["丢弃", "Discard"].includes(label)),
      true,
    );
    await clickConflictButton(["丢弃", "Discard"]);
  });

  it("NATIVE-FILE-EDIT-005 follows a real external rename", async () => {
    const path = join(fixtureRoot, "rename-before.txt");
    const renamedPath = join(fixtureRoot, "rename-after.txt");
    writeFileSync(path, "rename fixture\n", "utf8");
    await openNativeFile(path);
    await waitForEditorText("rename fixture");

    renameSync(path, renamedPath);
    await triggerWindowFocusCheck();

    await waitForActiveTab("rename-after.txt");
    await waitForEditorText("rename fixture");
  });

  it("NATIVE-FILE-EDIT-006 preserves dirty content and state after external rename", async () => {
    const path = join(fixtureRoot, "dirty-rename-before.txt");
    const renamedPath = join(fixtureRoot, "dirty-rename-after.txt");
    writeFileSync(path, "dirty rename fixture with unique content length\n", "utf8");
    await openNativeFile(path);
    await waitForEditorText("dirty rename fixture");
    await appendEditorText("LOCAL_DIRTY_RENAME");

    renameSync(path, renamedPath);
    await triggerWindowFocusCheck();

    await waitForActiveTab("dirty-rename-after.txt");
    await waitForEditorText("LOCAL_DIRTY_RENAME");
    await waitForDirtyTab("dirty-rename-after.txt");
    await expectTabAbsent("dirty-rename-before.txt");
    await expectNoConflict();
  });

  it("NATIVE-FILE-EDIT-007 recognizes an external atomic replace as a content change", async () => {
    const path = join(fixtureRoot, "atomic-save.txt");
    const temporaryPath = join(fixtureRoot, "atomic-save.txt.external.tmp");
    writeFileSync(path, "atomic save base\n", "utf8");
    await openNativeFile(path);
    await waitForEditorText("atomic save base");

    writeFileSync(temporaryPath, "atomic save latest from external editor\n", "utf8");
    renameSync(temporaryPath, path);

    await waitForEditorText("atomic save latest from external editor");
    await expectNoConflict();
  });

  it("NATIVE-FILE-EDIT-008 converges to the final content after a watcher event storm", async () => {
    const path = join(fixtureRoot, "watcher-storm.txt");
    writeFileSync(path, "watcher storm base\n", "utf8");
    await openNativeFile(path);
    await waitForEditorText("watcher storm base");

    for (let index = 0; index < 12; index += 1) {
      writeFileSync(path, `watcher storm version ${index} ${"x".repeat(index)}\n`, "utf8");
    }
    writeFileSync(path, "watcher storm final stable content\n", "utf8");

    await waitForEditorText("watcher storm final stable content");
    await triggerWindowFocusCheck();
    await waitForEditorText("watcher storm final stable content");
    await expectNoConflict();
  });

  it("NATIVE-FILE-SAVE-001 saves matching editor content, bytes, mtime, and clean state", async () => {
    const path = join(fixtureRoot, "save-normal.txt");
    writeFileSync(path, "normal save base\n", "utf8");
    const initialMtime = statSync(path).mtimeMs;
    await openNativeFile(path);
    await waitForEditorText("normal save base");
    await appendEditorText("NORMAL_NATIVE_SAVE");

    await browser.keys(["Control", "s"]);

    await waitForDiskText(path, "NORMAL_NATIVE_SAVE");
    await waitForCleanTab("save-normal.txt");
    const disk = readFileSync(path, "utf8");
    assert.equal(disk.includes("normal save base"), true);
    assert.equal(statSync(path).size, Buffer.byteLength(disk));
    assert.equal(statSync(path).mtimeMs >= initialMtime, true);
  });

  it("NATIVE-FILE-SAVE-002 prevents overwrite when the disk changes before save", async () => {
    const path = join(fixtureRoot, "save-prechanged.txt");
    writeFileSync(path, "save conflict base\n", "utf8");
    await openNativeFile(path);
    await waitForEditorText("save conflict base");
    await appendEditorText("LOCAL_BEFORE_SAVE_CONFLICT");
    writeFileSync(path, "external change before save\n", "utf8");
    utimesSync(path, new Date(), new Date(Date.now() + 5_000));

    await browser.keys(["Control", "s"]);

    await waitForConflict();
    assert.equal(readFileSync(path, "utf8"), "external change before save\n");
    await waitForEditorText("LOCAL_BEFORE_SAVE_CONFLICT");
    await clickConflictButton(["取消", "Cancel"]);
  });

  it("NATIVE-FILE-SAVE-003 prevents overwrite when the disk changes after version validation", async () => {
    const path = join(fixtureRoot, "save-after-check.txt");
    writeFileSync(path, "save after check base\n", "utf8");
    await openNativeFile(path);
    await waitForEditorText("save after check base");
    await appendEditorText("LOCAL_AFTER_VERSION_CHECK");

    await saveAtNativeHook(path, () => {
      writeFileSync(path, "external change after version check\n", "utf8");
      utimesSync(path, new Date(), new Date(Date.now() + 5_000));
    });

    await waitForConflict();
    assert.equal(readFileSync(path, "utf8"), "external change after version check\n");
    await waitForEditorText("LOCAL_AFTER_VERSION_CHECK");
    await clickConflictButton(["取消", "Cancel"]);
  });

  it("NATIVE-FILE-SAVE-004 keeps edits made while a save is in progress dirty", async () => {
    const path = join(fixtureRoot, "save-while-editing.txt");
    writeFileSync(path, "save while editing base\n", "utf8");
    await openNativeFile(path);
    await waitForEditorText("save while editing base");
    await appendEditorText("BEFORE_NATIVE_SAVE");

    await saveAtNativeHook(path, async () => appendEditorText("AFTER_NATIVE_SAVE_STARTED"));

    await waitForDiskText(path, "BEFORE_NATIVE_SAVE");
    assert.equal(readFileSync(path, "utf8").includes("AFTER_NATIVE_SAVE_STARTED"), false);
    await waitForEditorText("AFTER_NATIVE_SAVE_STARTED");
    await waitForDirtyTab("save-while-editing.txt");
  });

  it("NATIVE-FILE-SAVE-005 coalesces automatic and manual saves", async () => {
    const path = join(fixtureRoot, "save-auto-manual.txt");
    writeFileSync(path, "auto manual save base\n", "utf8");
    await openNativeFile(path);
    await waitForEditorText("auto manual save base");
    await appendEditorText("AUTO_AND_MANUAL_NATIVE_SAVE");
    const hook = armNativeHook("save_text_file_after_version_check", path);

    await browser.execute(() => window.dispatchEvent(new Event("blur")));
    waitForHookReached(hook.reached);
    await browser.keys(["Control", "s"]);
    writeFileSync(hook.release, "release", "utf8");

    await waitForDiskText(path, "AUTO_AND_MANUAL_NATIVE_SAVE");
    await waitForCleanTab("save-auto-manual.txt");
    await expectNoConflict();
  });
});
