import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repository = process.env.NORN_NATIVE_E2E_REPO!;
const remote = process.env.NORN_NATIVE_E2E_REMOTE!;
const peer = process.env.NORN_NATIVE_E2E_PEER!;
const application = resolve("src-tauri/target/debug/norn.exe");

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", LC_ALL: "C" },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const waitForGit = async (predicate: () => boolean, message: string) => {
  await browser.waitUntil(predicate, { timeout: 20_000, interval: 250, timeoutMsg: message });
};

const waitForSelector = async (selector: string) => {
  try {
    await browser.waitUntil(
      () => browser.execute((candidate) => Boolean(document.querySelector(candidate)), selector),
      {
        timeout: 20_000,
        interval: 250,
        timeoutMsg: `selector did not appear: ${selector}`,
      },
    );
  } catch (error) {
    const page = await browser.execute(() => ({
      body: document.body?.innerText.slice(0, 800) ?? "",
      html: document.documentElement?.outerHTML.slice(0, 800) ?? "",
      readyState: document.readyState,
      title: document.title,
      url: location.href,
    }));
    throw new Error(`${String(error)}\npage diagnostic: ${JSON.stringify(page)}`);
  }
};

const waitForVisibleSelector = async (selector: string) => {
  await browser.waitUntil(
    () =>
      browser.execute((candidate) => {
        const element = document.querySelector<HTMLElement>(candidate);
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      }, selector),
    { timeout: 20_000, interval: 250, timeoutMsg: `selector did not become visible: ${selector}` },
  );
};

const click = async (selector: string, index = 0) => {
  const clicked = await browser.execute(
    (candidate, itemIndex) => {
      const element = document.querySelectorAll<HTMLElement>(candidate)[itemIndex];
      element?.click();
      return Boolean(element);
    },
    selector,
    index,
  );
  if (!clicked) throw new Error(`cannot click missing selector: ${selector}[${index}]`);
};

const waitForEnabled = async (selector: string, index = 0) => {
  await browser.waitUntil(
    () =>
      browser.execute(
        (candidate, itemIndex) => {
          const button = document.querySelectorAll<HTMLButtonElement>(candidate)[itemIndex];
          return Boolean(button && !button.disabled);
        },
        selector,
        index,
      ),
    { timeout: 20_000, interval: 100, timeoutMsg: `button stayed disabled: ${selector}[${index}]` },
  );
};

const setValue = async (selector: string, value: string) => {
  const changed = await browser.execute(
    (candidate, nextValue) => {
      const element = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(candidate);
      if (!element) return false;
      const prototype =
        element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      element.focus();
      Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, nextValue);
      element.dispatchEvent(new InputEvent("input", { bubbles: true, data: nextValue, inputType: "insertText" }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    selector,
    value,
  );
  if (!changed) throw new Error(`cannot edit missing selector: ${selector}`);
};

const confirmDialog = async (dialogText: string, buttonText: string) => {
  const clicked = await browser.execute(
    (expectedDialogText, expectedButtonText) => {
      const dialog = [...document.querySelectorAll<HTMLElement>("[role=dialog]")].find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && element.innerText.includes(expectedDialogText);
      });
      const button = [...(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
        (candidate) => candidate.innerText.trim() === expectedButtonText,
      );
      button?.click();
      return Boolean(button);
    },
    dialogText,
    buttonText,
  );
  if (!clicked) throw new Error(`cannot confirm dialog containing ${dialogText} with button ${buttonText}`);
};

describe("Windows native Git workflows", () => {
  before(async () => {
    // tauri-driver 启动首实例后，再走一次应用现有的 single-instance 参数转发流程打开仓库。
    execFileSync(application, [repository], { timeout: 10_000, stdio: "ignore" });
    await waitForSelector(".git-rail-tab");
    await browser.execute(() => {
      document.querySelector<HTMLElement>(".driver-popover-close-btn")?.click();
    });
    await browser.execute(() => {
      const panelToggle = document.querySelector<HTMLElement>(".windows-titlebar-right-tools .titlebar-panel-button");
      if (/显示|show/i.test(panelToggle?.getAttribute("aria-label") ?? "")) panelToggle?.click();
    });
    await waitForVisibleSelector(".git-panel-shell");
    const pageText = await browser.execute(() => document.body?.innerText ?? "");
    expect(pageText).not.toContain("norn.exe 无法以支持的文本编码打开");
    await click(".git-rail-tab", 0);
    await waitForVisibleSelector(".git-commit-summary");
  });

  it("commits through the real Tauri window", async () => {
    await setValue(".git-commit-summary", "native e2e commit");
    await browser.waitUntil(
      () => browser.execute(() => !document.querySelector<HTMLButtonElement>(".git-commit-split-main")?.disabled),
      { timeout: 5_000, interval: 100, timeoutMsg: "commit button stayed disabled after entering a summary" },
    );
    await click(".git-commit-split-main");
    await waitForGit(
      () => git(repository, "log", "-1", "--pretty=%s") === "native e2e commit",
      "the UI commit did not reach the repository",
    );
    await waitForSelector(".git-panel-clean");
  });

  it("pushes to a local bare remote", async () => {
    await click(".git-rail-tab", 1);
    await waitForSelector(".git-branches");

    await waitForEnabled(".git-branches-toolbar button", 2);
    await click(".git-branches-toolbar button", 2);
    await waitForGit(
      () => git(remote, "log", "-1", "--pretty=%s", "main") === "native e2e commit",
      "the UI push did not update the local bare remote",
    );
  });

  it("pulls a peer commit into the workspace", async () => {
    git(peer, "pull", "--ff-only");
    writeFileSync(join(peer, "remote-change.txt"), "advanced by peer\n", "utf8");
    git(peer, "add", "remote-change.txt");
    git(peer, "commit", "-m", "peer advance");
    git(peer, "push");

    await waitForEnabled(".git-branches-toolbar button", 1);
    await click(".git-branches-toolbar button", 1);
    await waitForGit(
      () => existsSync(join(repository, "remote-change.txt")),
      "the UI pull did not bring the peer commit into the workspace",
    );
    await waitForEnabled(".git-branches-toolbar button", 1);
  });

  it("merges another local branch", async () => {
    await waitForEnabled(".git-branch-leaf-merge", 0);
    const mergeClicked = await browser.execute(() => {
      const row = [...document.querySelectorAll<HTMLElement>(".git-branch-leaf")].find((element) =>
        element.innerText.includes("native-feature"),
      );
      row?.querySelector<HTMLElement>(".git-branch-leaf-merge")?.click();
      return Boolean(row);
    });
    if (!mergeClicked) throw new Error("native-feature branch row did not appear");
    await waitForVisibleSelector("[role=dialog]");
    await confirmDialog("native-feature", "合并");
    try {
      await waitForGit(
        () => git(repository, "log", "--pretty=%s", "-8").split(/\r?\n/).includes("feature fixture"),
        "the UI merge did not include the feature branch",
      );
    } catch (error) {
      const body = await browser.execute(() => document.body?.innerText.slice(0, 1_500) ?? "");
      const diagnostics = {
        branch: git(repository, "branch", "--show-current"),
        log: git(repository, "log", "--oneline", "--decorate", "-8"),
        pending: existsSync(join(repository, ".git", "MERGE_HEAD")),
        status: git(repository, "status", "--short", "--branch"),
      };
      throw new Error(`${String(error)}\nGit: ${JSON.stringify(diagnostics)}\nUI: ${body}`);
    }
    expect(existsSync(join(repository, "feature.txt"))).toBe(true);
  });

  it("creates and checks out a new branch", async () => {
    await waitForEnabled(".git-branches-toolbar button", 0);
    await click(".git-branches-toolbar button", 0);
    await waitForVisibleSelector("[role=dialog] input");
    await setValue("[role=dialog] input", "native-created");
    await confirmDialog("新建分支", "创建");
    await waitForGit(
      () => git(repository, "branch", "--show-current") === "native-created",
      "the UI branch creation did not check out the new branch",
    );
  });
});
