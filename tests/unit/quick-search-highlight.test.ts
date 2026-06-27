import { describe, expect, it } from "vitest";

import { buildPreviewRegex } from "@/features/workbench/components/quick-search-utils";

describe("buildPreviewRegex", () => {
  it("escapes literals and is case-insensitive by default", () => {
    const re = buildPreviewRegex("a.b", false, false, false);
    expect(re?.test("A.B")).toBe(true);
    expect(re?.test("aXb")).toBe(false); // dot is literal, not wildcard
  });

  it("respects case sensitivity", () => {
    expect(buildPreviewRegex("Cat", true, false, false)?.test("cat")).toBe(false);
    expect(buildPreviewRegex("Cat", true, false, false)?.test("Cat")).toBe(true);
  });

  it("matches whole words only when requested", () => {
    const re = buildPreviewRegex("cat", false, true, false);
    expect(re?.test("a cat sat")).toBe(true);
    expect(re?.test("category")).toBe(false);
  });

  it("treats the query as a pattern in regex mode", () => {
    const re = buildPreviewRegex("a.c", true, false, true);
    expect(re?.test("abc")).toBe(true);
  });

  it("returns null for an invalid regex or empty query", () => {
    expect(buildPreviewRegex("(", false, false, true)).toBeNull();
    expect(buildPreviewRegex("", false, false, false)).toBeNull();
  });
});
