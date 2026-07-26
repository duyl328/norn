import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const fixtureRoot = process.env.NORN_NATIVE_E2E_FILES!;
const hookRoot = process.env.NORN_NATIVE_E2E_HOOK_DIR!;
const application = resolve("src-tauri/target/debug/norn.exe");

const requestNativeFile = (path: string) => {
  execFileSync(application, [fixtureRoot, path], { timeout: 10_000, stdio: "ignore" });
};

const waitForEditorText = async (text: string) => {
  await browser.waitUntil(
    () =>
      browser.execute(
        (expected) => (document.querySelector<HTMLElement>(".cm-content")?.innerText ?? "").includes(expected),
        text,
      ),
    { timeout: 20_000, interval: 100, timeoutMsg: `editor did not contain ${text}` },
  );
};

const waitForEditorDocumentText = async (text: string) => {
  await browser.waitUntil(
    () =>
      browser.execute((expected) => {
        type CodeMirrorContent = HTMLElement & {
          cmTile?: { root?: { view?: { state: { doc: { toString: () => string } } } } };
        };
        const view = document.querySelector<CodeMirrorContent>(".cm-content")?.cmTile?.root?.view;
        return Boolean(view?.state.doc.toString().includes(expected));
      }, text),
    { timeout: 20_000, interval: 100, timeoutMsg: `editor document did not contain ${text}` },
  );
};

const waitForActiveTab = async (name: string) => {
  await browser.waitUntil(
    () =>
      browser.execute(
        (expected) =>
          (document.querySelector<HTMLElement>('.editor-file-tab[aria-selected="true"]')?.innerText ?? "").includes(
            expected,
          ),
        name,
      ),
    { timeout: 20_000, interval: 100, timeoutMsg: `active tab did not become ${name}` },
  );
};

const openNativeFile = async (path: string) => {
  requestNativeFile(path);
  await waitForActiveTab(path.split(/[\\/]/).pop() ?? path);
};

const appendEditorText = async (text: string) => {
  const appended = await browser.execute((insert) => {
    type EditorViewHandle = {
      dispatch: (transaction: { changes: { from: number; insert: string } }) => void;
      state: { doc: { length: number; toString: () => string } };
    };
    type CodeMirrorContent = HTMLElement & { cmTile?: { root?: { view?: EditorViewHandle } } };
    const view = document.querySelector<CodeMirrorContent>(".cm-content")?.cmTile?.root?.view;
    if (!view) return false;
    view.dispatch({ changes: { from: view.state.doc.length, insert } });
    return view.state.doc.toString().includes(insert);
  }, text);
  assert.equal(appended, true, "CodeMirror editor view was unavailable");
  await waitForEditorText(text);
};

const dispatchShortcut = async (code: string, key: string) => {
  await browser.execute(
    (shortcutCode, shortcutKey) => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          code: shortcutCode,
          ctrlKey: true,
          key: shortcutKey,
        }),
      );
    },
    code,
    key,
  );
};

const requestWindowClose = async () => {
  await browser.execute(async () => {
    const invoke = (
      window as typeof window & { __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<unknown> } }
    ).__TAURI_INTERNALS__.invoke;
    await invoke("plugin:window|close", { label: "main" });
  });
};

const isWindowVisible = async (): Promise<boolean> =>
  browser.execute(async () => {
    const invoke = (
      window as typeof window & { __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<unknown> } }
    ).__TAURI_INTERNALS__.invoke;
    return Boolean(await invoke("plugin:window|is_visible", { label: "main" }));
  });

const showWindow = async () => {
  execFileSync(application, [fixtureRoot], { timeout: 10_000, stdio: "ignore" });
  await browser.waitUntil(isWindowVisible, {
    timeout: 20_000,
    interval: 100,
    timeoutMsg: "window did not become visible",
  });
};

const refreshWithSession = async (session: unknown) => {
  await browser.execute((snapshot) => {
    const sessionKey = "norn.session";
    document.documentElement.dataset.nativeE2eReload = "pending";
    document.addEventListener("visibilitychange", (event) => event.stopImmediatePropagation(), true);
    window.addEventListener("blur", (event) => event.stopImmediatePropagation(), true);
    localStorage.setItem(sessionKey, JSON.stringify(snapshot));
    window.setTimeout(() => window.location.reload(), 0);
  }, session);
  await browser.waitUntil(
    () =>
      browser.execute(
        () =>
          document.documentElement.dataset.nativeE2eReload !== "pending" &&
          document.readyState === "complete" &&
          Boolean(document.querySelector(".cm-content")),
      ),
    { timeout: 20_000, interval: 100, timeoutMsg: "application did not reload" },
  );
};

describe("Windows native document lifecycle workflows", () => {
  before(async () => {
    rmSync(join(hookRoot, "drafts-config"), { force: true, recursive: true });
    requestNativeFile(fixtureRoot);
    await browser.waitUntil(() => browser.execute(() => Boolean(document.querySelector(".cm-content"))), {
      timeout: 20_000,
      interval: 100,
      timeoutMsg: "editor did not mount",
    });
  });

  after(async () => {
    if (!(await isWindowVisible())) await showWindow();
    rmSync(join(hookRoot, "drafts-config"), { force: true, recursive: true });
    await browser.execute(() => localStorage.removeItem("norn.session"));
  });

  it("NATIVE-FILE-LIFE-001 saves multiple dirty documents before hiding the window", async () => {
    const firstPath = join(fixtureRoot, "quit-first.txt");
    const secondPath = join(fixtureRoot, "quit-second.txt");
    writeFileSync(firstPath, "first quit base\n", "utf8");
    writeFileSync(secondPath, "second quit base\n", "utf8");

    await openNativeFile(firstPath);
    await appendEditorText("FIRST_QUIT_SAVE");
    await openNativeFile(secondPath);
    await appendEditorText("SECOND_QUIT_SAVE");
    await requestWindowClose();

    await browser.waitUntil(
      () =>
        readFileSync(firstPath, "utf8").includes("FIRST_QUIT_SAVE") &&
        readFileSync(secondPath, "utf8").includes("SECOND_QUIT_SAVE"),
      { timeout: 20_000, interval: 50, timeoutMsg: "documents were not persisted before window hide" },
    );
    await browser.waitUntil(async () => !(await isWindowVisible()), {
      timeout: 20_000,
      interval: 100,
      timeoutMsg: "window was not hidden after saving all documents",
    });
    await showWindow();
  });

  it("NATIVE-FILE-LIFE-002 blocks exit and focuses a background document whose save fails", async () => {
    const failingPath = join(fixtureRoot, "quit-background-readonly.txt");
    const foregroundPath = join(fixtureRoot, "quit-foreground.txt");
    writeFileSync(failingPath, "background failure base\n", "utf8");
    writeFileSync(foregroundPath, "foreground base\n", "utf8");
    await openNativeFile(failingPath);
    chmodSync(failingPath, 0o444);

    try {
      await appendEditorText("BACKGROUND_QUIT_FAILURE");
      await openNativeFile(foregroundPath);
      await requestWindowClose();

      await waitForActiveTab("quit-background-readonly.txt");
      assert.equal(await isWindowVisible(), true);
      assert.equal(readFileSync(failingPath, "utf8"), "background failure base\n");
      await waitForEditorText("BACKGROUND_QUIT_FAILURE");
    } finally {
      chmodSync(failingPath, 0o666);
    }
  });

  it("NATIVE-FILE-LIFE-003 restores an untitled draft with its content and encoding after reload", async () => {
    await dispatchShortcut("KeyN", "n");
    await waitForActiveTab("Untitled");
    await appendEditorText("NATIVE_RESTORED_DRAFT");
    await browser.execute(() => window.dispatchEvent(new Event("blur")));

    const draftsDirectory = join(hookRoot, "drafts-config", "drafts");
    await browser.waitUntil(() => existsSync(draftsDirectory) && readdirSync(draftsDirectory).length > 0, {
      timeout: 20_000,
      interval: 100,
      timeoutMsg: "native draft was not written",
    });
    const draft = JSON.parse(readFileSync(join(draftsDirectory, readdirSync(draftsDirectory)[0]), "utf8")) as {
      content: string;
      encoding: string;
    };
    assert.equal(draft.content.includes("NATIVE_RESTORED_DRAFT"), true);
    assert.equal(draft.encoding, "utf-8");

    await browser.refresh();
    await waitForEditorText("NATIVE_RESTORED_DRAFT");
    await waitForActiveTab("Untitled");
  });

  it("NATIVE-FILE-LIFE-004 skips deleted and binary tabs while restoring the latest valid files", async () => {
    const missingPath = join(fixtureRoot, "restore-missing.txt");
    const binaryPath = join(fixtureRoot, "restore-binary.txt");
    const changedPath = join(fixtureRoot, "restore-changed.txt");
    rmSync(missingPath, { force: true });
    writeFileSync(binaryPath, Buffer.from([0, 1, 2, 3]));
    writeFileSync(changedPath, "latest restored disk content\n", "utf8");
    utimesSync(changedPath, new Date(), new Date(Date.now() + 5_000));

    await refreshWithSession({
      tabs: [
        { id: "restore-missing", name: "restore-missing.txt", path: missingPath },
        { id: "restore-binary", name: "restore-binary.txt", path: binaryPath },
        { id: "restore-changed", name: "restore-changed.txt", path: changedPath },
      ],
      activeId: "restore-changed",
      folderPath: fixtureRoot,
    });

    await waitForEditorText("latest restored disk content");
    await waitForActiveTab("restore-changed.txt");
    const tabNames = await browser.execute(() =>
      [...document.querySelectorAll<HTMLElement>(".editor-file-tab")].map((tab) => tab.innerText.trim()),
    );
    assert.equal(
      tabNames.some((name) => name.includes("restore-missing.txt")),
      false,
    );
    assert.equal(
      tabNames.some((name) => name.includes("restore-binary.txt")),
      false,
    );
  });

  it("NATIVE-FILE-LIFE-005 restores tab order, active tab, cursor, scroll, and search state", async () => {
    const firstPath = join(fixtureRoot, "restore-view-first.txt");
    const secondPath = join(fixtureRoot, "restore-view-second.txt");
    const longContent = Array.from({ length: 240 }, (_, index) => `restore view line ${index}`).join("\n");
    writeFileSync(firstPath, "first view tab\n", "utf8");
    writeFileSync(secondPath, longContent, "utf8");

    await refreshWithSession({
      tabs: [
        { id: "view-first", name: "restore-view-first.txt", path: firstPath },
        {
          id: "view-second",
          name: "restore-view-second.txt",
          path: secondPath,
          view: { anchor: 420, head: 420, scrollTop: 360, scrollLeft: 0, searchOpen: true },
        },
      ],
      activeId: "view-second",
      folderPath: fixtureRoot,
    });

    await waitForEditorDocumentText("restore view line 239");
    await waitForActiveTab("restore-view-second.txt");
    await browser.waitUntil(() => browser.execute(() => Boolean(document.querySelector(".cm-norn-search"))), {
      timeout: 20_000,
      interval: 100,
      timeoutMsg: "search panel was not restored",
    });
    const restored = await browser.execute(() => {
      type EditorViewHandle = {
        scrollDOM: HTMLElement;
        state: { selection: { main: { anchor: number; head: number } } };
      };
      type CodeMirrorContent = HTMLElement & { cmTile?: { root?: { view?: EditorViewHandle } } };
      const view = document.querySelector<CodeMirrorContent>(".cm-content")?.cmTile?.root?.view;
      if (!view) return null;
      return {
        anchor: view.state.selection.main.anchor,
        head: view.state.selection.main.head,
        scrollTop: view.scrollDOM.scrollTop,
      };
    });
    assert.equal(restored?.anchor, 420);
    assert.equal(restored?.head, 420);
    assert.equal((restored?.scrollTop ?? 0) > 0, true);
    const tabNames = await browser.execute(() =>
      [...document.querySelectorAll<HTMLElement>(".editor-file-tab")].map((tab) => tab.innerText.trim()),
    );
    assert.deepEqual(
      tabNames.filter((name) => name.includes("restore-view-")),
      ["restore-view-first.txt", "restore-view-second.txt"],
    );
  });
});
