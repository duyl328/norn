import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const fixtureRoot = process.env.NORN_NATIVE_E2E_FILES!;
const hookRoot = process.env.NORN_NATIVE_E2E_HOOK_DIR!;
const application = resolve("src-tauri/target/debug/norn.exe");
const hookWaitBuffer = new Int32Array(new SharedArrayBuffer(4));

const getHookPaths = (command: "inspect_text_file" | "read_text_file", path: string) => {
  const fileName = path.split(/[\\/]/).pop() ?? "unknown";
  const key = `${command}--${fileName.replace(/[^A-Za-z0-9_.-]/g, "_")}`;
  return {
    pause: join(hookRoot, `${key}.pause`),
    reached: join(hookRoot, `${key}.reached`),
    release: join(hookRoot, `${key}.release`),
  };
};

const armNativeHook = (command: "inspect_text_file" | "read_text_file", path: string) => {
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

const openAtNativeHook = async (
  command: "inspect_text_file" | "read_text_file",
  path: string,
  mutateFile: () => void,
) => {
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

const appendEditorText = async (text: string) => {
  await browser.execute(() => {
    const editor = document.querySelector<HTMLElement>(".cm-content");
    if (!editor) return;
    editor.focus();
    const selection = window.getSelection();
    selection?.selectAllChildren(editor);
    selection?.collapseToEnd();
  });
  await browser.keys(["Control", "End"]);
  await browser.keys(text);
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
    writeFileSync(path, "delete while opening\n", "utf8");

    await openAtNativeHook("inspect_text_file", path, () => rmSync(path));

    await waitForFileError("open-delete.txt");
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
});
