// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";

import { loadSettings } from "@/features/workbench/settings";

const KEY = "norn.settings";

beforeEach(() => {
  window.localStorage.clear();
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__; // 走 localStorage 分支
});

describe("loadSettings 会话恢复迁移", () => {
  it("老配置(无 schemaVersion,restore 关)一次性打开并打上版本戳", async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ ui: { restoreLastWorkspace: false } }));
    const loaded = await loadSettings();
    expect(loaded?.ui.restoreLastWorkspace).toBe(true);
    // 已写回,带上 schemaVersion → 下次不再迁移
    const persisted = JSON.parse(window.localStorage.getItem(KEY) ?? "{}");
    expect(typeof persisted.schemaVersion).toBe("number");
    expect(persisted.ui.restoreLastWorkspace).toBe(true);
  });

  it("已迁移过的配置(带 schemaVersion)尊重用户关掉的开关", async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ schemaVersion: 1, ui: { restoreLastWorkspace: false } }));
    const loaded = await loadSettings();
    expect(loaded?.ui.restoreLastWorkspace).toBe(false);
  });
});
