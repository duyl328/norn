import { type Extension, RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

export const SMART_OVERLAY_SIZE_LIMIT_BYTES = 25 * 1024 * 1024;

const SMART_OVERLAY_SCAN_LIMIT = 2 * 1024;

type SmartTokenKind =
  | "attribute"
  | "boolean"
  | "bracket"
  | "comment"
  | "function"
  | "key"
  | "keyword"
  | "level"
  | "number"
  | "operator"
  | "path"
  | "section"
  | "string"
  | "tag"
  | "timestamp"
  | "url";

type SmartToken = {
  className: string;
  end: number;
  start: number;
};

type SmartTokenMatch = {
  end: number;
  kind: SmartTokenKind;
  start: number;
};

const smartOverlayTokenClasses: Record<SmartTokenKind, string> = {
  attribute: "cm-smart-attribute",
  boolean: "cm-smart-boolean",
  bracket: "cm-smart-bracket",
  comment: "cm-smart-comment",
  function: "cm-smart-function",
  key: "cm-smart-key",
  keyword: "cm-smart-keyword",
  level: "cm-smart-level",
  number: "cm-smart-number",
  operator: "cm-smart-operator",
  path: "cm-smart-path",
  section: "cm-smart-section",
  string: "cm-smart-string",
  tag: "cm-smart-tag",
  timestamp: "cm-smart-timestamp",
  url: "cm-smart-url",
};

// 颜色统一走 CSS 变量(见 styles.css 的 --cm-*),由应用的 .dark 类切换亮/暗,
// 不再依赖 CodeMirror 的 &dark(本应用从未把编辑器主题标记为 dark,&dark 不会生效)。
const smartOverlayTheme = EditorView.baseTheme({
  ".cm-smart-attribute": { color: "var(--cm-special)" },
  ".cm-smart-boolean": { color: "var(--cm-number)" },
  ".cm-smart-bracket": { color: "var(--cm-comment)" },
  ".cm-smart-comment": { color: "var(--cm-comment)" },
  ".cm-smart-function": { color: "var(--cm-function)" },
  ".cm-smart-key": { color: "var(--cm-property)" },
  ".cm-smart-keyword": { color: "var(--cm-keyword)", fontWeight: "600" },
  ".cm-smart-level": { color: "var(--cm-invalid)", fontWeight: "700" },
  ".cm-smart-number": { color: "var(--cm-number)" },
  ".cm-smart-operator": { color: "var(--cm-comment)" },
  ".cm-smart-path": { color: "var(--cm-special)" },
  ".cm-smart-section": { color: "var(--cm-heading)", fontWeight: "600" },
  ".cm-smart-string": { color: "var(--cm-string)" },
  ".cm-smart-tag": { color: "var(--cm-heading)" },
  ".cm-smart-timestamp": { color: "var(--cm-meta)" },
  ".cm-smart-url": { color: "var(--cm-meta)", textDecoration: "underline", textUnderlineOffset: "2px" },
});

class SmartOverlayPlugin {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildSmartOverlayDecorations(view);
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = buildSmartOverlayDecorations(update.view);
    }
  }
}

const smartOverlayPlugin = ViewPlugin.fromClass(SmartOverlayPlugin, {
  decorations: (plugin) => plugin.decorations,
});

export const createSmartOverlayExtension = (loadedContentSize?: number): Extension[] => {
  if (typeof loadedContentSize === "number" && loadedContentSize > SMART_OVERLAY_SIZE_LIMIT_BYTES) {
    return [];
  }

  return [smartOverlayTheme, smartOverlayPlugin];
};

const buildSmartOverlayDecorations = (view: EditorView) => {
  const builder = new RangeSetBuilder<Decoration>();

  for (const range of view.visibleRanges) {
    let position = range.from;

    while (position <= range.to) {
      const line = view.state.doc.lineAt(position);
      const tokens = classifySmartLine(line.text);

      for (const token of tokens) {
        builder.add(line.from + token.start, line.from + token.end, Decoration.mark({ class: token.className }));
      }

      if (line.to >= range.to) {
        break;
      }

      position = line.to + 1;
    }
  }

  return builder.finish();
};

const classifySmartLine = (line: string): SmartToken[] => {
  const source = line.slice(0, SMART_OVERLAY_SCAN_LIMIT);
  const trimmed = source.trim();

  if (!trimmed) {
    return [];
  }

  const matches: SmartTokenMatch[] = [];
  const add = (kind: SmartTokenKind, start: number, end: number) => {
    if (end > start) {
      matches.push({ end, kind, start });
    }
  };

  collectCommonTokens(source, add);

  if (isCommentLine(trimmed)) {
    add("comment", source.search(/\S/), source.length);
  }

  collectMarkupTokens(source, add);
  collectDataTokens(source, add);
  collectConfigTokens(source, add);
  collectLogTokens(source, add);
  collectCodeTokens(source, add);

  return resolveTokenOverlaps(matches)
    .filter((token) => token.start < SMART_OVERLAY_SCAN_LIMIT)
    .map((token) => ({
      className: smartOverlayTokenClasses[token.kind],
      end: Math.min(token.end, SMART_OVERLAY_SCAN_LIMIT),
      start: token.start,
    }));
};

const collectCommonTokens = (line: string, add: (kind: SmartTokenKind, start: number, end: number) => void) => {
  collectRegex(line, /(?:https?|file):\/\/[^\s"'<>]+/gi, "url", add);
  collectRegex(line, /[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, "url", add);
  collectRegex(line, /\b(?:todo|fixme|hack|note|xxx)\b/gi, "keyword", add);
  collectRegex(line, /\b(?:true|false|null|yes|no|on|off|enabled|disabled)\b/gi, "boolean", add);
  collectRegex(line, /\b[+-]?(?:0x[\da-f]+|\d+(?:\.\d+)?)\b/gi, "number", add);
  collectRegex(line, /\d{4}-\d{2}-\d{2}(?:[t\s]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)?/gi, "timestamp", add);
  collectRegex(line, /(?:(?:\.{1,2}|~)[\\/]|[a-z]:[\\/]|\/|\\\\)[^\s"'<>]+/gi, "path", add);
  collectRegex(line, /"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'|`[^`\\]*(?:\\.[^`\\]*)*`/g, "string", add);
  collectRegex(line, /[{}()[\]<>]/g, "bracket", add);
};

const collectMarkupTokens = (line: string, add: (kind: SmartTokenKind, start: number, end: number) => void) => {
  collectRegex(line, /<\/?\s*[a-z][\w:.-]*/gi, "tag", add);
  collectRegex(line, /\s+[a-z_:][\w:.-]*(?=\s*=)/gi, "attribute", (kind, start, end) => add(kind, start + 1, end));
};

const collectDataTokens = (line: string, add: (kind: SmartTokenKind, start: number, end: number) => void) => {
  collectRegex(line, /"[^"\\]*(?:\\.[^"\\]*)*"(?=\s*:)/g, "key", add);
  collectRegex(line, /[{}[\],]/g, "bracket", add);
};

const collectConfigTokens = (line: string, add: (kind: SmartTokenKind, start: number, end: number) => void) => {
  collectRegex(line, /^\s*\[[^\]\r\n]+\]/g, "section", add);
  collectRegex(line, /^[\t ]*[a-z_][\w.-]*(?=\s*[:=])/gi, "key", add);
  collectRegex(line, /[:=]/g, "operator", add);
};

const collectLogTokens = (line: string, add: (kind: SmartTokenKind, start: number, end: number) => void) => {
  collectRegex(line, /\b(?:fatal|error|warn(?:ing)?|info|debug|trace)\b/gi, "level", add);
  collectRegex(line, /\[[^\]\r\n]+\]|\([^)]+\)/g, "section", add);
};

const collectCodeTokens = (line: string, add: (kind: SmartTokenKind, start: number, end: number) => void) => {
  collectRegex(
    line,
    /\b(?:abstract|async|await|break|case|catch|class|const|def|do|else|enum|export|extends|final|finally|fn|for|from|func|function|if|import|implements|interface|let|new|private|protected|public|return|static|struct|switch|throw|try|type|var|void|while)\b/g,
    "keyword",
    add,
  );
  collectRegex(line, /\b[A-Za-z_$][\w$]*(?=\s*\()/g, "function", add);
  collectRegex(line, /=>|->|==={0,1}|!==|!=|<=|>=|&&|\|\||[+\-*%/]=?|[?:.=]/g, "operator", add);
};

const collectRegex = (
  line: string,
  expression: RegExp,
  kind: SmartTokenKind,
  add: (kind: SmartTokenKind, start: number, end: number) => void,
) => {
  for (const match of line.matchAll(expression)) {
    if (typeof match.index === "number") {
      add(kind, match.index, match.index + match[0].length);
    }
  }
};

const isCommentLine = (line: string) =>
  line.startsWith("//") ||
  line.startsWith("#") ||
  line.startsWith(";") ||
  line.startsWith("/*") ||
  line.startsWith("*");

const resolveTokenOverlaps = (tokens: SmartTokenMatch[]) => {
  const sorted = [...tokens].sort((left, right) => {
    if (left.start !== right.start) {
      return left.start - right.start;
    }

    return right.end - left.end;
  });
  const resolved: SmartTokenMatch[] = [];

  for (const token of sorted) {
    const overlaps = resolved.some((current) => token.start < current.end && token.end > current.start);

    if (!overlaps) {
      resolved.push(token);
    }
  }

  return resolved;
};
