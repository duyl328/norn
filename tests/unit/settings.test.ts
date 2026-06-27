import { describe, expect, it } from "vitest";

import {
  buildBundle,
  DEFAULT_SETTINGS,
  mergeSettings,
  normalizeKeybindings,
  parseBundle,
} from "@/features/workbench/settings";

describe("mergeSettings", () => {
  it("空对象回退全部默认", () => {
    expect(mergeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it("非法主题回退默认,合法主题保留", () => {
    expect(mergeSettings({ theme: "neon" }).theme).toBe(DEFAULT_SETTINGS.theme);
    expect(mergeSettings({ theme: "dark" }).theme).toBe("dark");
  });

  it("非法语言回退默认,合法语言保留", () => {
    expect(mergeSettings({ language: "jp" }).language).toBe(DEFAULT_SETTINGS.language);
    expect(mergeSettings({ language: "en" }).language).toBe("en");
  });

  it("数值越界被夹取、非数值回退默认", () => {
    expect(mergeSettings({ editor: { fontSize: 999 } }).editor.fontSize).toBe(28);
    expect(mergeSettings({ editor: { fontSize: 1 } }).editor.fontSize).toBe(9);
    expect(mergeSettings({ editor: { tabSize: "x" } as never }).editor.tabSize).toBe(DEFAULT_SETTINGS.editor.tabSize);
  });

  it("部分字段只覆盖给定项,其余取默认", () => {
    const merged = mergeSettings({ ui: { showStatusBar: false } });
    expect(merged.ui.showStatusBar).toBe(false);
    expect(merged.ui.resizeHandleHints).toBe(DEFAULT_SETTINGS.ui.resizeHandleHints);
  });
});

describe("normalizeKeybindings", () => {
  it("只保留 string[] 值,丢弃畸形项", () => {
    expect(normalizeKeybindings({ "a.b": ["Mod+S"], bad: 1, mixed: ["x", 2] })).toEqual({ "a.b": ["Mod+S"] });
  });
  it("非对象返回空表", () => {
    expect(normalizeKeybindings(null)).toEqual({});
  });
});

describe("bundle 往返", () => {
  it("build 后 parse 还原 settings 与 keybindings", () => {
    const settings = mergeSettings({ theme: "light", editor: { tabSize: 4 } });
    const keys = { "file.save": ["Mod+S"] };
    const round = parseBundle(buildBundle(settings, keys));
    expect(round.settings).toEqual(settings);
    expect(round.keybindings).toEqual(keys);
  });

  it("拒绝非 Norn 文件", () => {
    expect(() => parseBundle(JSON.stringify({ app: "other" }))).toThrow();
  });

  it("导入文件里的非法值也会被收敛", () => {
    const raw = JSON.stringify({ app: "norn", version: 1, settings: { theme: "x", editor: { tabSize: 99 } } });
    const round = parseBundle(raw);
    expect(round.settings.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(round.settings.editor.tabSize).toBe(8);
    expect(round.keybindings).toEqual({});
  });
});
