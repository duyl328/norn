import { describe, expect, it } from "vitest";

import { cn, toArray } from "@/lib/utils";

describe("cn", () => {
  it("合并 class 并去重 tailwind 冲突", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("a", null, undefined, 0 as unknown as string, "c")).toBe("a c");
  });
});

describe("toArray", () => {
  it("null / undefined 归一为空数组", () => {
    expect(toArray(null)).toEqual([]);
    expect(toArray(undefined)).toEqual([]);
  });

  it("单值包裹成数组,数组原样返回", () => {
    expect(toArray("x")).toEqual(["x"]);
    expect(toArray([1, 2])).toEqual([1, 2]);
  });
});
