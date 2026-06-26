import { describe, expect, it } from "vitest";

import { formatText, reindentBraces, reindentTags, tidy } from "@/features/workbench/formatter";

describe("tidy", () => {
  it("统一换行、去行尾空白、收敛空行、末尾一个换行", () => {
    expect(tidy("a   \r\nb\t\n\n\n\nc")).toBe("a\nb\n\nc\n");
  });
});

describe("formatText: JSON", () => {
  it("严格 JSON 两空格美化", () => {
    expect(formatText('{"a":1,"b":[2,3]}', "json")).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}\n');
  });
  it("解析失败(带注释)退回 tidy,不破坏结构", () => {
    const src = '{\n  // x\n  "a": 1   \n}';
    expect(formatText(src, "jsonc")).toBe('{\n  // x\n  "a": 1\n}\n');
  });
});

describe("formatText: 花括号族重排", () => {
  it("把乱缩进按括号深度对齐", () => {
    const src = "function f() {\nif (x) {\nreturn 1;\n}\n}";
    expect(formatText(src, "ts")).toBe("function f() {\n  if (x) {\n    return 1;\n  }\n}\n");
  });

  it("字符串里的括号不计深度,后续行缩进仍正确", () => {
    const src = 'function f() {\nconst s = "}}}";\nreturn s;\n}';
    expect(formatText(src, "js")).toBe('function f() {\n  const s = "}}}";\n  return s;\n}\n');
  });

  it("多行模板串内部原样保留,不被重排", () => {
    const src = "const q = `\n    keep   me\n`;";
    // 反引号内两行原样(含行尾空白与缩进),不动语义。
    expect(reindentBraces(src)).toBe("const q = `\n    keep   me\n`;");
  });

  it("行注释里的括号被忽略", () => {
    const src = "function f() {\nreturn 1; // }\n}";
    expect(formatText(src, "go")).toBe("function f() {\n  return 1; // }\n}\n");
  });
});

describe("formatText: 标签族重排", () => {
  it("按标签嵌套对齐缩进", () => {
    const src = "<ul>\n<li>a</li>\n<li>b</li>\n</ul>";
    expect(formatText(src, "html")).toBe("<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>\n");
  });
  it("空元素 <br>/<img> 不增加深度", () => {
    const src = "<div>\n<br>\n<img src=x>\n<span>y</span>\n</div>";
    expect(formatText(src, "html")).toBe("<div>\n  <br>\n  <img src=x>\n  <span>y</span>\n</div>\n");
  });
  it("自闭合标签不增加深度", () => {
    const src = "<root>\n<node/>\n<node />\n</root>";
    expect(formatText(src, "xml")).toBe("<root>\n  <node/>\n  <node />\n</root>\n");
  });
  it("注释整段保留,内部 < > 不计深度", () => {
    const src = "<div>\n<!-- <p>x</p>\nmore -->\n<p>real</p>\n</div>";
    expect(formatText(src, "html")).toBe("<div>\n  <!-- <p>x</p>\nmore -->\n  <p>real</p>\n</div>\n");
  });
  it("<pre> 内部空白原样不动", () => {
    const src = "<div>\n<pre>\n    keep   spaces\n</pre>\n</div>";
    expect(reindentTags(src)).toBe("<div>\n  <pre>\n    keep   spaces\n</pre>\n</div>");
  });
});

describe("formatText: 缩进敏感语言只整理空白", () => {
  it("Python 不重排缩进", () => {
    const src = "def f():\n        return 1   \n";
    expect(formatText(src, "py")).toBe("def f():\n        return 1\n");
  });
  it("Markdown 保留行尾两空格(硬换行)", () => {
    const src = "line one  \nline two\n";
    expect(formatText(src, "md")).toBe("line one  \nline two\n");
  });
});
