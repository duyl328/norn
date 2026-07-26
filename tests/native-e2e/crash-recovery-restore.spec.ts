import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const hookRoot = process.env.NORN_NATIVE_E2E_HOOK_DIR!;
const draftText = "FORCED_PROCESS_TERMINATION_DRAFT";

describe("@native @p0 Windows forced process recovery", () => {
  it("NATIVE-APP-004 restores the disk-backed draft after the native process is force-terminated", async () => {
    await browser.waitUntil(
      () =>
        browser.execute(
          (expected) => (document.querySelector<HTMLElement>(".cm-content")?.innerText ?? "").includes(expected),
          draftText,
        ),
      { timeout: 20_000, interval: 100, timeoutMsg: "draft was not restored after forced process termination" },
    );
    const draftsDirectory = join(hookRoot, "drafts-config", "drafts");
    assert.equal(
      existsSync(draftsDirectory) &&
        readdirSync(draftsDirectory).some((name) =>
          readFileSync(join(draftsDirectory, name), "utf8").includes(draftText),
        ),
      true,
    );
  });
});
