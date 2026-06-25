import { describe, expect, it } from "vitest";

import { specToCmKey } from "@/features/workbench/actions/editor-actions";

describe("specToCmKey", () => {
  it("单字母主键转小写、分隔符用 -", () => {
    expect(specToCmKey("Mod+Shift+K")).toBe("Mod-Shift-k");
    expect(specToCmKey("Mod+D")).toBe("Mod-d");
  });

  it("非字母主键(方向键/符号)原样保留", () => {
    expect(specToCmKey("Alt+ArrowUp")).toBe("Alt-ArrowUp");
    expect(specToCmKey("Mod+/")).toBe("Mod-/");
  });
});
