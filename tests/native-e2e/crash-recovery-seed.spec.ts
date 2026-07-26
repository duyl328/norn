import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const hookRoot = process.env.NORN_NATIVE_E2E_HOOK_DIR!;
const readyMarker = process.env.NORN_NATIVE_E2E_CRASH_READY!;
const killedMarker = process.env.NORN_NATIVE_E2E_CRASH_KILLED!;
const draftText = "FORCED_PROCESS_TERMINATION_DRAFT";

describe("@native @p0 forced process termination setup", () => {
  it("persists a draft before the controller force-terminates the native process", async () => {
    await browser.waitUntil(() => browser.execute(() => Boolean(document.querySelector(".cm-content"))), {
      timeout: 20_000,
      interval: 100,
    });
    await browser.execute(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          code: "KeyN",
          ctrlKey: true,
          key: "n",
        }),
      );
    });
    await browser.waitUntil(
      () =>
        browser.execute((text) => {
          type EditorViewHandle = {
            dispatch: (transaction: { changes: { from: number; insert: string } }) => void;
            state: { doc: { length: number; toString: () => string } };
          };
          type CodeMirrorContent = HTMLElement & { cmTile?: { root?: { view?: EditorViewHandle } } };
          const view = document.querySelector<CodeMirrorContent>(".cm-content")?.cmTile?.root?.view;
          if (!view) return false;
          if (!view.state.doc.toString().includes(text)) {
            view.dispatch({ changes: { from: view.state.doc.length, insert: text } });
          }
          window.dispatchEvent(new Event("blur"));
          return view.state.doc.toString().includes(text);
        }, draftText),
      { timeout: 20_000, interval: 100 },
    );

    const draftsDirectory = join(hookRoot, "drafts-config", "drafts");
    await browser.waitUntil(
      () =>
        existsSync(draftsDirectory) &&
        readdirSync(draftsDirectory).some((name) =>
          readFileSync(join(draftsDirectory, name), "utf8").includes(draftText),
        ),
      { timeout: 20_000, interval: 100 },
    );
    writeFileSync(readyMarker, "ready\n", "utf8");

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const poll = () => {
        if (existsSync(killedMarker)) {
          resolve();
          return;
        }
        if (Date.now() - startedAt > 30_000) {
          reject(new Error("controller did not confirm forced process termination"));
          return;
        }
        setTimeout(poll, 50);
      };
      poll();
    });
    assert.equal(existsSync(killedMarker), true);
  });
});
