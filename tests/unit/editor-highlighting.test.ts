import { describe, expect, it } from "vitest";

import {
  createSmartOverlayExtension,
  HIGHLIGHT_LANGUAGE_SIZE_LIMIT_BYTES,
  type HighlightMode,
  loadHighlightExtensions,
  resolveHighlightMode,
  SMART_OVERLAY_SIZE_LIMIT_BYTES,
} from "@/features/workbench/editor-highlighting";

const docOf = (name: string, content = "x", extra: { path?: string; size?: number } = {}) => ({
  name,
  content,
  ...extra,
});

describe("resolveHighlightMode", () => {
  it("超过大小限制返回 plain-text(large-file)", () => {
    const mode = resolveHighlightMode(docOf("big.ts", "x", { size: HIGHLIGHT_LANGUAGE_SIZE_LIMIT_BYTES + 1 }));
    expect(mode).toEqual({ kind: "plain-text", label: "Plain Text", reason: "large-file" });
  });

  it("精确配置文件名 / 以 rc 结尾 / .env. 前缀都识别为 generic-config", () => {
    expect(resolveHighlightMode(docOf(".prettierrc"))).toMatchObject({ kind: "generic-config" });
    expect(resolveHighlightMode(docOf("foorc"))).toMatchObject({ kind: "generic-config" });
    expect(resolveHighlightMode(docOf(".env.production"))).toMatchObject({ kind: "generic-config" });
  });

  it(".log 扩展名识别为 generic-log", () => {
    expect(resolveHighlightMode(docOf("server.log"))).toMatchObject({ kind: "generic-log" });
  });

  it("通用配置扩展名识别为 generic-config", () => {
    expect(resolveHighlightMode(docOf("settings.ini"))).toMatchObject({ kind: "generic-config" });
    expect(resolveHighlightMode(docOf("nginx.conf"))).toMatchObject({ kind: "generic-config" });
  });

  it("代码文件(无配置/日志特征)回退到 generic-text-cues:完全文本解析,不挂语言", () => {
    expect(resolveHighlightMode(docOf("a.ts", "const x = 1"))).toMatchObject({ kind: "generic-text-cues" });
    expect(resolveHighlightMode(docOf("a.py", "def foo(): pass"))).toMatchObject({ kind: "generic-text-cues" });
    expect(resolveHighlightMode(docOf("a.rs", "fn main() {}"))).toMatchObject({ kind: "generic-text-cues" });
  });

  it("内容启发式:日志结构识别为 generic-log", () => {
    const content = ["2024-01-01 12:00:00 ERROR boom", "2024-01-01 12:00:01 WARN careful", "INFO done"].join("\n");
    expect(resolveHighlightMode(docOf("output.dat", content))).toMatchObject({ kind: "generic-log" });
  });

  it("内容启发式:键值/分节结构识别为 generic-config", () => {
    const content = ["key = value", "[section]", "foo = bar"].join("\n");
    expect(resolveHighlightMode(docOf("data.dat", content))).toMatchObject({ kind: "generic-config" });
  });

  it("空内容回退到 plain-text", () => {
    expect(resolveHighlightMode(docOf("empty.dat", ""))).toMatchObject({ kind: "plain-text" });
  });

  it("无结构文本回退到 generic-text-cues", () => {
    expect(resolveHighlightMode(docOf("mystery.dat", "hello world just some prose"))).toMatchObject({
      kind: "generic-text-cues",
    });
  });
});

describe("loadHighlightExtensions", () => {
  it("plain-text 返回空扩展数组", async () => {
    await expect(loadHighlightExtensions({ kind: "plain-text", label: "Plain Text" })).resolves.toEqual([]);
  });

  it("通用模式各自返回单个语言扩展", async () => {
    const modes: HighlightMode[] = [
      { kind: "generic-config", label: "Config" },
      { kind: "generic-log", label: "Log" },
      { kind: "generic-text-cues", label: "Text" },
    ];
    for (const mode of modes) {
      const extensions = await loadHighlightExtensions(mode);
      expect(extensions).toHaveLength(1);
    }
  });
});

describe("createSmartOverlayExtension", () => {
  it("正常大小返回主题 + 插件两个扩展", () => {
    expect(createSmartOverlayExtension(1024)).toHaveLength(2);
    expect(createSmartOverlayExtension(undefined)).toHaveLength(2);
  });

  it("超过 overlay 大小上限返回空数组", () => {
    expect(createSmartOverlayExtension(SMART_OVERLAY_SIZE_LIMIT_BYTES + 1)).toEqual([]);
  });
});
