// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { eventToSpec, formatKey, matchKey } from "@/features/workbench/actions/registry";

const setPlatform = (ua: string) => {
  (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true });
};
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X)";
const WIN = "Mozilla/5.0 (Windows NT 10.0)";

afterEach(() => {
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  Object.defineProperty(navigator, "userAgent", { value: "node", configurable: true });
});

describe("matchKey", () => {
  it("Mod 在 mac 走 metaKey、在 windows 走 ctrlKey,互不误触", () => {
    setPlatform(MAC);
    expect(matchKey(new KeyboardEvent("keydown", { key: "s", metaKey: true }), "Mod+S")).toBe(true);
    expect(matchKey(new KeyboardEvent("keydown", { key: "s", ctrlKey: true }), "Mod+S")).toBe(false);

    setPlatform(WIN);
    expect(matchKey(new KeyboardEvent("keydown", { key: "s", ctrlKey: true }), "Mod+S")).toBe(true);
    expect(matchKey(new KeyboardEvent("keydown", { key: "s", metaKey: true }), "Mod+S")).toBe(false);
  });

  it("修饰键严格匹配:Mod+S 不被 Mod+Shift+S 误触", () => {
    setPlatform(WIN);
    expect(matchKey(new KeyboardEvent("keydown", { key: "S", ctrlKey: true, shiftKey: true }), "Mod+S")).toBe(false);
    expect(matchKey(new KeyboardEvent("keydown", { key: "S", ctrlKey: true, shiftKey: true }), "Mod+Shift+S")).toBe(
      true,
    );
  });

  it("数字键用 code 比较:mac Alt+1 的 key 是 ¡ 仍命中", () => {
    setPlatform(MAC);
    expect(matchKey(new KeyboardEvent("keydown", { key: "¡", code: "Digit1", altKey: true }), "Alt+1")).toBe(true);
  });

  it("Escape 无修饰", () => {
    setPlatform(WIN);
    expect(matchKey(new KeyboardEvent("keydown", { key: "Escape" }), "Escape")).toBe(true);
    expect(matchKey(new KeyboardEvent("keydown", { key: "Escape", ctrlKey: true }), "Escape")).toBe(false);
  });
});

describe("eventToSpec", () => {
  it("主修饰键归一为 Mod,可被 matchKey 回读", () => {
    setPlatform(WIN);
    const spec = eventToSpec(new KeyboardEvent("keydown", { key: "k", code: "KeyK", ctrlKey: true, shiftKey: true }));
    expect(spec).toBe("Mod+Shift+k");
    expect(matchKey(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, shiftKey: true }), spec!)).toBe(true);
  });

  it("数字键用 code,可移植到 mac(Alt+1)", () => {
    setPlatform(MAC);
    const spec = eventToSpec(new KeyboardEvent("keydown", { key: "¡", code: "Digit1", altKey: true }));
    expect(spec).toBe("Alt+1");
    expect(matchKey(new KeyboardEvent("keydown", { key: "¡", code: "Digit1", altKey: true }), spec!)).toBe(true);
  });

  it("仅按修饰键返回 null", () => {
    setPlatform(WIN);
    expect(eventToSpec(new KeyboardEvent("keydown", { key: "Control", ctrlKey: true }))).toBeNull();
  });
});

describe("formatKey", () => {
  it("mac 用符号、windows 用文字", () => {
    setPlatform(MAC);
    expect(formatKey("Mod+Shift+A")).toBe("⇧⌘A");
    expect(formatKey("Escape")).toBe("⎋");

    setPlatform(WIN);
    expect(formatKey("Mod+Shift+A")).toBe("Ctrl+Shift+A");
    expect(formatKey("Alt+1")).toBe("Alt+1");
  });
});
