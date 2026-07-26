import { execFileSync } from "node:child_process";
import { renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const fixtureRoot = process.env.NORN_NATIVE_E2E_FILES!;
const application = resolve("src-tauri/target/debug/norn.exe");

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
  execFileSync(application, [fixtureRoot, path], { timeout: 10_000, stdio: "ignore" });
  await waitForActiveTab(path.split(/[\\/]/).pop() ?? path);
  await browser.execute(() => document.querySelector<HTMLElement>(".driver-popover-close-btn")?.click());
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
