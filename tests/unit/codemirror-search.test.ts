// @vitest-environment jsdom

import { getSearchQuery, openSearchPanel } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildEditorKeymapExtension } from "@/features/workbench/actions/editor-actions";
import { createCodeMirrorExtensions } from "@/features/workbench/codemirror-setup";
import type { WorkbenchDocument } from "@/features/workbench/types";

const doc = (overrides: Partial<WorkbenchDocument> = {}): WorkbenchDocument => ({
  id: "d1",
  name: "a.ts",
  path: "a.ts",
  content: "const x = 1\nconst y = 2\n",
  savedContent: "const x = 1\nconst y = 2\n",
  mode: "editable",
  ...overrides,
});

let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
  window.localStorage.clear();
});

const mount = (document: WorkbenchDocument) => {
  const parent = globalThis.document.createElement("div");
  globalThis.document.body.append(parent);
  view = new EditorView({
    parent,
    state: EditorState.create({
      doc: document.content,
      extensions: createCodeMirrorExtensions(
        new Compartment(),
        new Compartment(),
        document,
        () => {},
        buildEditorKeymapExtension({}),
        false,
      ),
    }),
  });
  return view;
};

describe("编辑器查找/替换接线", () => {
  it("装配了 @codemirror/search:openSearchPanel 打开自绘面板", () => {
    const editor = mount(doc());

    expect(editor.dom.querySelector(".cm-norn-search")).toBeNull();

    const opened = openSearchPanel(editor);

    expect(opened).toBe(true);
    expect(editor.dom.querySelector(".cm-norn-search")).not.toBeNull();
  });

  it("面板提供查找输入与大小写/全词/通配符/正则四个图标开关", () => {
    const editor = mount(doc());
    openSearchPanel(editor);

    const panel = editor.dom.querySelector(".cm-norn-search");
    expect(panel?.querySelector(".cm-norn-search-input")).not.toBeNull();
    expect(panel?.querySelectorAll(".cm-norn-search-toggle")).toHaveLength(4);
  });

  it("在查找框输入会写入搜索查询", () => {
    const editor = mount(doc());
    openSearchPanel(editor);

    const input = editor.dom.querySelector<HTMLInputElement>(".cm-norn-search-input");
    expect(input).not.toBeNull();

    input!.value = "const";
    input!.dispatchEvent(new Event("input", { bubbles: true }));

    expect(getSearchQuery(editor.state).search).toBe("const");
  });

  it("records Ctrl+F search history when submitting a search", () => {
    const editor = mount(doc());
    openSearchPanel(editor);

    const input = editor.dom.querySelector<HTMLInputElement>(".cm-norn-search-input");
    input!.value = "const";
    input!.dispatchEvent(new Event("input", { bubbles: true }));
    input!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(JSON.parse(window.localStorage.getItem("norn.editorSearchHistory") ?? "[]")).toEqual(["const"]);
  });

  it("records Ctrl+F search history after typing without showing it by default", async () => {
    const editor = mount(doc());
    openSearchPanel(editor);

    const input = editor.dom.querySelector<HTMLInputElement>(".cm-norn-search-input");
    input!.value = "const";
    input!.dispatchEvent(new Event("input", { bubbles: true }));

    await vi.waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem("norn.editorSearchHistory") ?? "[]")).toEqual(["const"]);
    });
    expect(editor.dom.querySelector<HTMLElement>(".cm-norn-search-history")?.hidden).toBe(true);

    const historyButton = editor.dom.querySelector<HTMLButtonElement>('[aria-label="搜索历史"]')!;
    historyButton.click();
    expect(editor.dom.querySelector<HTMLElement>(".cm-norn-search-history")?.hidden).toBe(false);
    expect(historyButton.classList.contains("cm-norn-search-btn-active")).toBe(true);
    expect(historyButton.getAttribute("aria-pressed")).toBe("true");
    expect(editor.dom.querySelector(".cm-norn-search-history-item")?.textContent).toBe("const");
  });

  it("uses a selected Ctrl+F search history entry immediately", () => {
    window.localStorage.setItem("norn.editorSearchHistory", JSON.stringify(["const", "y"]));
    const editor = mount(doc());
    openSearchPanel(editor);

    const historyButton = editor.dom.querySelector<HTMLButtonElement>('[aria-label="搜索历史"]')!;
    historyButton.click();
    const historyItem = Array.from(editor.dom.querySelectorAll<HTMLButtonElement>(".cm-norn-search-history-item")).find(
      (button) => button.textContent === "y",
    );
    historyItem!.click();

    const input = editor.dom.querySelector<HTMLInputElement>(".cm-norn-search-input");
    expect(input!.value).toBe("y");
    expect(getSearchQuery(editor.state).search).toBe("y");
    expect(editor.state.selection.main.from).toBe(18);
    expect(editor.state.selection.main.to).toBe(19);
    expect(historyButton.classList.contains("cm-norn-search-btn-active")).toBe(false);
    expect(historyButton.getAttribute("aria-pressed")).toBe("false");
  });

  it("removes a single Ctrl+F search history entry from the panel", () => {
    window.localStorage.setItem("norn.editorSearchHistory", JSON.stringify(["const", "y"]));
    const editor = mount(doc());
    openSearchPanel(editor);

    editor.dom.querySelector<HTMLButtonElement>('[aria-label="搜索历史"]')!.click();
    editor.dom.querySelector<HTMLButtonElement>('[aria-label="删除搜索历史 const"]')!.click();

    expect(JSON.parse(window.localStorage.getItem("norn.editorSearchHistory") ?? "[]")).toEqual(["y"]);
    expect(Array.from(editor.dom.querySelectorAll(".cm-norn-search-history-item")).map((item) => item.textContent)).toEqual([
      "y",
    ]);
  });

  it("点击正则开关会切换查询的 regexp 标志", () => {
    const editor = mount(doc());
    openSearchPanel(editor);

    const input = editor.dom.querySelector<HTMLInputElement>(".cm-norn-search-input");
    input!.value = "c.nst";
    input!.dispatchEvent(new Event("input", { bubbles: true }));
    expect(getSearchQuery(editor.state).regexp).toBe(false);

    // 开关顺序:大小写/全词/通配符/正则 → 正则在索引 3。
    const regexToggle = editor.dom.querySelectorAll<HTMLButtonElement>(".cm-norn-search-toggle")[3];
    regexToggle.click();

    expect(getSearchQuery(editor.state).regexp).toBe(true);
    expect(regexToggle.classList.contains("cm-norn-search-toggle-active")).toBe(true);
  });

  it("通配符模式把 * 翻译成正则进行匹配", () => {
    const editor = mount(doc());
    openSearchPanel(editor);

    const input = editor.dom.querySelector<HTMLInputElement>(".cm-norn-search-input");
    // 通配符在索引 2。
    const wildcardToggle = editor.dom.querySelectorAll<HTMLButtonElement>(".cm-norn-search-toggle")[2];
    wildcardToggle.click();

    input!.value = "c*t";
    input!.dispatchEvent(new Event("input", { bubbles: true }));

    const query = getSearchQuery(editor.state);
    // 输入框仍显示通配写法,但底层是 regexp 查询。
    expect(input!.value).toBe("c*t");
    expect(query.regexp).toBe(true);
    expect(query.search).toBe("c.*t");
    // "const" 命中,被选中定位到 0..5。
    expect(editor.state.selection.main.from).toBe(0);
    expect(editor.state.selection.main.to).toBe(5);
  });

  it("通配符与正则互斥:开启正则会关掉通配符", () => {
    const editor = mount(doc());
    openSearchPanel(editor);

    const toggles = editor.dom.querySelectorAll<HTMLButtonElement>(".cm-norn-search-toggle");
    const wildcardToggle = toggles[2];
    const regexToggle = toggles[3];

    wildcardToggle.click();
    expect(wildcardToggle.classList.contains("cm-norn-search-toggle-active")).toBe(true);

    regexToggle.click();
    expect(regexToggle.classList.contains("cm-norn-search-toggle-active")).toBe(true);
    expect(wildcardToggle.classList.contains("cm-norn-search-toggle-active")).toBe(false);
  });

  it("输入查找词会选中并定位到第一个匹配", () => {
    const editor = mount(doc());
    openSearchPanel(editor);

    const input = editor.dom.querySelector<HTMLInputElement>(".cm-norn-search-input");
    input!.value = "const";
    input!.dispatchEvent(new Event("input", { bubbles: true }));

    // 文档为 "const x = 1\nconst y = 2\n",第一个 const 落在 0..5。
    expect(editor.state.selection.main.from).toBe(0);
    expect(editor.state.selection.main.to).toBe(5);
  });

  it("清空(×)按钮会清掉查找词与查询", () => {
    const editor = mount(doc());
    openSearchPanel(editor);

    const input = editor.dom.querySelector<HTMLInputElement>(".cm-norn-search-input");
    input!.value = "const";
    input!.dispatchEvent(new Event("input", { bubbles: true }));
    expect(getSearchQuery(editor.state).search).toBe("const");

    const clear = editor.dom.querySelector<HTMLButtonElement>(".cm-norn-search-adornments .cm-norn-search-clear");
    clear!.click();

    expect(input!.value).toBe("");
    expect(getSearchQuery(editor.state).search).toBe("");
  });

  // 匹配计数是全文档扫描,故走 120ms 尾随防抖(见 editor-search-panel.ts scheduleCount):
  // 输入后计数不会同步出现,用 vi.waitFor 等防抖落定再断言。
  it("显示匹配计数 当前/总数", async () => {
    const editor = mount(doc());
    openSearchPanel(editor);

    const input = editor.dom.querySelector<HTMLInputElement>(".cm-norn-search-input");
    input!.value = "const";
    input!.dispatchEvent(new Event("input", { bubbles: true }));

    const count = editor.dom.querySelector<HTMLElement>(".cm-norn-search-count");
    // 文档含两个 const,输入后自动选中第一个 → 1/2。
    await vi.waitFor(() => {
      expect(count?.hidden).toBe(false);
      expect(count?.textContent).toBe("1/2");
    });
  });

  it("无匹配时计数显示无结果", async () => {
    const editor = mount(doc());
    openSearchPanel(editor);

    const input = editor.dom.querySelector<HTMLInputElement>(".cm-norn-search-input");
    input!.value = "zzz";
    input!.dispatchEvent(new Event("input", { bubbles: true }));

    const count = editor.dom.querySelector<HTMLElement>(".cm-norn-search-count");
    await vi.waitFor(() => {
      expect(count?.textContent).toBe("无结果");
      expect(count?.classList.contains("cm-norn-search-count-empty")).toBe(true);
    });
  });

  it("大文件(超过计数上限)仍可查找,但暂停匹配计数", async () => {
    const big = `${"x".repeat(600_000)}\nNEEDLE\n`;
    const editor = mount(doc({ content: big, savedContent: big }));
    openSearchPanel(editor);

    const input = editor.dom.querySelector<HTMLInputElement>(".cm-norn-search-input");
    input!.value = "NEEDLE";
    input!.dispatchEvent(new Event("input", { bubbles: true }));

    // 查找仍命中并定位(同步)。
    expect(editor.state.selection.main.from).toBe(600_001);
    // 文档超过 50 万字符 → 计数暂停,显示省略号而非全量扫描(防抖后落定)。
    const count = editor.dom.querySelector<HTMLElement>(".cm-norn-search-count");
    await vi.waitFor(() => {
      expect(count?.textContent).toBe("…");
    });
  });

  it("large-readonly 文档:仅查找、禁用替换(避免改动分块加载的文件)", () => {
    const editor = mount(doc({ mode: "large-readonly" }));

    expect(openSearchPanel(editor)).toBe(true);
    expect(editor.dom.querySelector(".cm-norn-search")).not.toBeNull();
    // 不提供替换:无展开按钮、无替换行。
    expect(editor.dom.querySelector(".cm-norn-search-expand")).toBeNull();
    expect(editor.dom.querySelector(".cm-norn-search-row-replace")).toBeNull();

    // 查找仍可用。
    const input = editor.dom.querySelector<HTMLInputElement>(".cm-norn-search-input");
    input!.value = "const";
    input!.dispatchEvent(new Event("input", { bubbles: true }));
    expect(getSearchQuery(editor.state).search).toBe("const");
  });
});
