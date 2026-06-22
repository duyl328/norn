// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { applyPlatformClass, getPlatform, isMac, isWindows } from "@/features/workbench/platform";

const setUserAgent = (value: string) => {
  Object.defineProperty(navigator, "userAgent", { value, configurable: true });
};

const setTauri = (enabled: boolean) => {
  const win = window as Window & { __TAURI_INTERNALS__?: unknown };
  if (enabled) {
    win.__TAURI_INTERNALS__ = {};
  } else {
    delete win.__TAURI_INTERNALS__;
  }
};

afterEach(() => {
  setTauri(false);
  setUserAgent("node");
  document.documentElement.className = "";
});

describe("getPlatform", () => {
  it("非 Tauri 运行时返回 web", () => {
    setTauri(false);
    setUserAgent("Mozilla/5.0 (Macintosh)");
    expect(getPlatform()).toBe("web");
  });

  it("Tauri + 各系统 UA 正确识别", () => {
    setTauri(true);

    setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X)");
    expect(getPlatform()).toBe("mac");
    expect(isMac()).toBe(true);

    setUserAgent("Mozilla/5.0 (Windows NT 10.0)");
    expect(getPlatform()).toBe("windows");
    expect(isWindows()).toBe(true);

    setUserAgent("Mozilla/5.0 (X11; Linux x86_64)");
    expect(getPlatform()).toBe("linux");
    expect(isMac()).toBe(false);
    expect(isWindows()).toBe(false);
  });
});

describe("applyPlatformClass", () => {
  it("在根元素挂上单一 platform-* 类", () => {
    setTauri(true);
    setUserAgent("Mozilla/5.0 (Windows NT 10.0)");

    applyPlatformClass();
    expect(document.documentElement.classList.contains("platform-windows")).toBe(true);

    // 切换平台后只保留新的类
    setUserAgent("Mozilla/5.0 (Macintosh)");
    applyPlatformClass();
    expect(document.documentElement.classList.contains("platform-mac")).toBe(true);
    expect(document.documentElement.classList.contains("platform-windows")).toBe(false);
  });
});
