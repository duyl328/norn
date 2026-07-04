import { describe, expect, it } from "vitest";

import { cjkWordRangeAt } from "@/features/workbench/editor-cjk-word-select";

// 词典边界由 Intl.Segmenter(ICU)决定,随引擎版本变化,故不硬编码具体切分,
// 只验证本模块自己的逻辑:命中包含、末尾回看、非 CJK 交回默认。
describe("cjkWordRangeAt", () => {
  it("returns a range containing the clicked CJK column", () => {
    const range = cjkWordRangeAt("我喜欢机器学习", 4);
    expect(range).not.toBeNull();
    const [from, to] = range!;
    expect(from).toBeLessThanOrEqual(4);
    expect(to).toBeGreaterThan(4);
  });

  it("looks back one char when the click lands just past the run's end", () => {
    const text = "机器学习";
    expect(cjkWordRangeAt(text, text.length)).toEqual(cjkWordRangeAt(text, text.length - 1));
  });

  it("declines non-CJK so CodeMirror keeps its default word selection", () => {
    expect(cjkWordRangeAt("foo_bar baz", 2)).toBeNull();
  });
});
