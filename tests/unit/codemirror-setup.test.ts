import { Compartment } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { codeMirrorTheme, createCodeMirrorExtensions } from "@/features/workbench/codemirror-setup";
import type { WorkbenchDocument } from "@/features/workbench/types";

const doc = (overrides: Partial<WorkbenchDocument> = {}): WorkbenchDocument => ({
  id: "d1",
  name: "a.ts",
  path: "a.ts",
  content: "const x = 1\n",
  savedContent: "const x = 1\n",
  mode: "editable",
  ...overrides,
});

describe("createCodeMirrorExtensions", () => {
  it("可编辑文档构建出一组扩展", () => {
    const extensions = createCodeMirrorExtensions(new Compartment(), new Compartment(), doc(), () => {}, false);
    expect(Array.isArray(extensions)).toBe(true);
    expect(extensions.length).toBeGreaterThan(0);
  });

  it("large-readonly 文档同样能构建扩展(只读分支)", () => {
    const extensions = createCodeMirrorExtensions(
      new Compartment(),
      new Compartment(),
      doc({ mode: "large-readonly" }),
      () => {},
      false,
    );
    expect(extensions.length).toBeGreaterThan(0);
  });

  it("导出的主题是一个扩展", () => {
    expect(codeMirrorTheme).toBeDefined();
  });
});
