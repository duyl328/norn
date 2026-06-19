import { StreamLanguage, type StreamParser } from "@codemirror/language";
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";

export const HIGHLIGHT_LANGUAGE_SIZE_LIMIT_BYTES = 5 * 1024 * 1024;
export const FULL_LANGUAGE_PARSER_SIZE_LIMIT_BYTES = 5 * 1024 * 1024;
export const SMART_OVERLAY_SIZE_LIMIT_BYTES = 25 * 1024 * 1024;

const SMART_OVERLAY_SCAN_LIMIT = 2 * 1024;

type HighlightDocument = {
  content: string;
  name: string;
  path?: string;
  size?: number;
};

type PreciseLanguageId =
  | "css"
  | "dockerfile"
  | "html"
  | "javascript"
  | "json"
  | "jsx"
  | "markdown"
  | "properties"
  | "python"
  | "rust"
  | "shell"
  | "sql"
  | "toml"
  | "tsx"
  | "typescript"
  | "xml"
  | "yaml";

export type HighlightMode =
  | { kind: "language"; id: PreciseLanguageId; label: string }
  | { kind: "generic-config"; label: string }
  | { kind: "generic-log"; label: string }
  | { kind: "generic-text-cues"; label: string }
  | { kind: "plain-text"; label: string; reason?: "large-file" };

type EmptyParserState = Record<string, never>;

const SAMPLE_SIZE = 16 * 1024;
const MIN_STRUCTURED_LINES = 2;

const preciseExtensionLanguages: Record<string, HighlightMode> = {
  bash: { kind: "language", id: "shell", label: "Shell" },
  cjs: { kind: "language", id: "javascript", label: "JavaScript" },
  command: { kind: "language", id: "shell", label: "Shell" },
  css: { kind: "language", id: "css", label: "CSS" },
  htm: { kind: "language", id: "html", label: "HTML" },
  html: { kind: "language", id: "html", label: "HTML" },
  js: { kind: "language", id: "javascript", label: "JavaScript" },
  json: { kind: "language", id: "json", label: "JSON" },
  jsonc: { kind: "language", id: "json", label: "JSONC" },
  jsx: { kind: "language", id: "jsx", label: "JSX" },
  ksh: { kind: "language", id: "shell", label: "Shell" },
  markdown: { kind: "language", id: "markdown", label: "Markdown" },
  md: { kind: "language", id: "markdown", label: "Markdown" },
  mjs: { kind: "language", id: "javascript", label: "JavaScript" },
  properties: { kind: "language", id: "properties", label: "Properties" },
  py: { kind: "language", id: "python", label: "Python" },
  pyw: { kind: "language", id: "python", label: "Python" },
  rs: { kind: "language", id: "rust", label: "Rust" },
  sh: { kind: "language", id: "shell", label: "Shell" },
  sql: { kind: "language", id: "sql", label: "SQL" },
  svg: { kind: "language", id: "xml", label: "SVG" },
  toml: { kind: "language", id: "toml", label: "TOML" },
  ts: { kind: "language", id: "typescript", label: "TypeScript" },
  tsx: { kind: "language", id: "tsx", label: "TSX" },
  xml: { kind: "language", id: "xml", label: "XML" },
  yaml: { kind: "language", id: "yaml", label: "YAML" },
  yml: { kind: "language", id: "yaml", label: "YAML" },
  zsh: { kind: "language", id: "shell", label: "Shell" },
};

const genericConfigExtensions = new Set([
  "cfg",
  "cnf",
  "conf",
  "config",
  "desktop",
  "editorconfig",
  "env",
  "gitignore",
  "ignore",
  "ini",
  "npmrc",
  "rc",
  "service",
]);

const exactLanguageFilenames: Record<string, HighlightMode> = {
  containerfile: { kind: "language", id: "dockerfile", label: "Dockerfile" },
  dockerfile: { kind: "language", id: "dockerfile", label: "Dockerfile" },
};

const exactConfigFilenames = new Set([
  ".babelrc",
  ".dockerignore",
  ".editorconfig",
  ".env",
  ".env.local",
  ".eslintignore",
  ".eslintrc",
  ".gitconfig",
  ".gitignore",
  ".npmrc",
  ".prettierignore",
  ".prettierrc",
  ".stylelintrc",
  ".yarnrc",
  "gnumakefile",
  "makefile",
  "procfile",
]);

const genericConfigMode: HighlightMode = { kind: "generic-config", label: "Config" };
const genericLogMode: HighlightMode = { kind: "generic-log", label: "Log" };
const genericTextCueMode: HighlightMode = { kind: "generic-text-cues", label: "Text" };
const plainTextMode: HighlightMode = { kind: "plain-text", label: "Plain Text" };

const getBaseName = (document: HighlightDocument) => {
  const source = document.path || document.name;
  return source.replace(/\\/g, "/").split("/").filter(Boolean).pop() || document.name;
};

const getExtension = (baseName: string) => {
  const index = baseName.lastIndexOf(".");

  if (index <= 0 || index === baseName.length - 1) {
    return "";
  }

  return baseName.slice(index + 1).toLowerCase();
};

const getContentSample = (content: string) => content.slice(0, SAMPLE_SIZE);

const getMeaningfulLines = (content: string) =>
  getContentSample(content)
    .split(/\r\n|\n|\r/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 120);

const looksLikeLog = (content: string) => {
  const lines = getMeaningfulLines(content);

  if (lines.length === 0) {
    return false;
  }

  const matches = lines.filter((line) =>
    /^(?:\d{4}-\d{2}-\d{2}[t\s]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:z|[+-]\d{2}:?\d{2})?\s*)?(?:\[[^\]]+\]\s*)?(?:fatal|error|warn(?:ing)?|info|debug|trace)\b/i.test(
      line,
    ),
  ).length;

  return matches >= MIN_STRUCTURED_LINES && matches / lines.length >= 0.25;
};

const looksLikeConfig = (content: string) => {
  const lines = getMeaningfulLines(content);

  if (lines.length === 0) {
    return false;
  }

  const matches = lines.filter((line) =>
    /^(?:[#;].+|\[[^\]]+\]|[a-z0-9_.-]+\s*[:=]\s*.+)$/i.test(line),
  ).length;

  return matches >= MIN_STRUCTURED_LINES && matches / lines.length >= 0.35;
};

const looksLikeMarkdown = (content: string) => {
  const lines = getMeaningfulLines(content);

  if (lines.length === 0) {
    return false;
  }

  const matches = lines.filter((line) =>
    /^(?:#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s+|```|---$|\[[^\]]+\]\([^)]+\))/.test(line),
  ).length;

  return matches >= MIN_STRUCTURED_LINES && matches / lines.length >= 0.25;
};

export const resolveHighlightMode = (document: HighlightDocument): HighlightMode => {
  if (typeof document.size === "number" && document.size > HIGHLIGHT_LANGUAGE_SIZE_LIMIT_BYTES) {
    return { kind: "plain-text", label: "Plain Text", reason: "large-file" };
  }

  const baseName = getBaseName(document);
  const normalizedBaseName = baseName.toLowerCase();
  const extension = getExtension(normalizedBaseName);

  const exactLanguage = exactLanguageFilenames[normalizedBaseName];

  if (exactLanguage) {
    return exactLanguage;
  }

  if (
    exactConfigFilenames.has(normalizedBaseName) ||
    normalizedBaseName.endsWith("rc") ||
    normalizedBaseName.startsWith(".env.")
  ) {
    return genericConfigMode;
  }

  if (extension === "log") {
    return genericLogMode;
  }

  const preciseLanguage = preciseExtensionLanguages[extension];

  if (preciseLanguage) {
    return preciseLanguage;
  }

  if (genericConfigExtensions.has(extension)) {
    return genericConfigMode;
  }

  if (looksLikeLog(document.content)) {
    return genericLogMode;
  }

  if (looksLikeConfig(document.content)) {
    return genericConfigMode;
  }

  if (looksLikeMarkdown(document.content)) {
    return { kind: "language", id: "markdown", label: "Markdown" };
  }

  if (document.content.length === 0) {
    return plainTextMode;
  }

  return genericTextCueMode;
};

export const getHighlightLabel = (mode: HighlightMode) => mode.label;

export const loadHighlightExtensions = async (mode: HighlightMode): Promise<Extension[]> => {
  if (mode.kind === "plain-text") {
    return [];
  }

  if (mode.kind === "generic-config") {
    return [genericConfigLanguage];
  }

  if (mode.kind === "generic-log") {
    return [genericLogLanguage];
  }

  if (mode.kind === "generic-text-cues") {
    return [genericTextCueLanguage];
  }

  return loadPreciseLanguage(mode.id);
};

const loadPreciseLanguage = async (language: PreciseLanguageId): Promise<Extension[]> => {
  switch (language) {
    case "css": {
      const { css } = await import("@codemirror/lang-css");
      return [css()];
    }
    case "dockerfile": {
      const { dockerFile } = await import("@codemirror/legacy-modes/mode/dockerfile");
      return [StreamLanguage.define(dockerFile)];
    }
    case "html": {
      const { html } = await import("@codemirror/lang-html");
      return [html()];
    }
    case "javascript": {
      const { javascript } = await import("@codemirror/lang-javascript");
      return [javascript()];
    }
    case "json": {
      const { json } = await import("@codemirror/lang-json");
      return [json()];
    }
    case "jsx": {
      const { javascript } = await import("@codemirror/lang-javascript");
      return [javascript({ jsx: true })];
    }
    case "markdown": {
      const { markdown } = await import("@codemirror/lang-markdown");
      return [markdown()];
    }
    case "properties": {
      const { properties } = await import("@codemirror/legacy-modes/mode/properties");
      return [StreamLanguage.define(properties)];
    }
    case "python": {
      const { python } = await import("@codemirror/lang-python");
      return [python()];
    }
    case "rust": {
      const { rust } = await import("@codemirror/lang-rust");
      return [rust()];
    }
    case "shell": {
      const { shell } = await import("@codemirror/legacy-modes/mode/shell");
      return [StreamLanguage.define(shell)];
    }
    case "sql": {
      const { sql } = await import("@codemirror/lang-sql");
      return [sql()];
    }
    case "toml": {
      const { toml } = await import("@codemirror/legacy-modes/mode/toml");
      return [StreamLanguage.define(toml)];
    }
    case "tsx": {
      const { javascript } = await import("@codemirror/lang-javascript");
      return [javascript({ jsx: true, typescript: true })];
    }
    case "typescript": {
      const { javascript } = await import("@codemirror/lang-javascript");
      return [javascript({ typescript: true })];
    }
    case "xml": {
      const { xml } = await import("@codemirror/lang-xml");
      return [xml()];
    }
    case "yaml": {
      const { yaml } = await import("@codemirror/lang-yaml");
      return [yaml()];
    }
  }
};

const consumeQuotedString = (stream: Parameters<StreamParser<EmptyParserState>["token"]>[0]) => {
  const quote = stream.next();
  let escaped = false;

  while (!stream.eol()) {
    const character = stream.next();

    if (character === quote && !escaped) {
      break;
    }

    escaped = character === "\\" && !escaped;

    if (character !== "\\") {
      escaped = false;
    }
  }

  return "string";
};

const matchSeverity = (stream: Parameters<StreamParser<EmptyParserState>["token"]>[0]) => {
  const match = stream.match(/^(?:fatal|error|warn(?:ing)?|info|debug|trace)\b/i);

  if (!match || typeof match === "boolean") {
    return null;
  }

  const level = match[0].toLowerCase();

  if (level === "fatal" || level === "error") {
    return "invalid";
  }

  if (level.startsWith("warn")) {
    return "keyword";
  }

  return "atom";
};

const matchCommonCue = (stream: Parameters<StreamParser<EmptyParserState>["token"]>[0]) => {
  if (stream.match(/^(?:todo|fixme|hack|note|xxx)\b/i)) {
    return "keyword";
  }

  const severity = matchSeverity(stream);

  if (severity) {
    return severity;
  }

  if (stream.match(/^(?:https?|file):\/\/[^\s"'<>]+/i)) {
    return "url";
  }

  if (stream.match(/^[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i)) {
    return "url";
  }

  if (stream.match(/^\d{4}-\d{2}-\d{2}(?:[t\s]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)?/i)) {
    return "number";
  }

  if (stream.match(/^(?:(?:\.{1,2}|~)[\\/]|[a-z]:[\\/]|\/|\\\\)[^\s"'<>]+/i)) {
    return "string.special";
  }

  return null;
};

const genericConfigParser: StreamParser<EmptyParserState> = {
  name: "generic-config",
  startState: () => ({}),
  token(stream) {
    if (stream.eatSpace()) {
      return null;
    }

    if (stream.match(/^(?:#|;|\/\/).*$/)) {
      return "comment";
    }

    if (stream.match(/^\[[^\]\r\n]+\]/)) {
      return "heading";
    }

    const cue = matchCommonCue(stream);

    if (cue) {
      return cue;
    }

    const next = stream.peek();

    if (next === '"' || next === "'") {
      return consumeQuotedString(stream);
    }

    if (stream.match(/^(?:true|false|null|yes|no|on|off|enabled|disabled)\b/i)) {
      return "atom";
    }

    if (stream.match(/^[+-]?(?:0x[\da-f]+|\d+(?:\.\d+)?)\b/i)) {
      return "number";
    }

    if (stream.match(/^[a-z_][\w.-]*(?=\s*[:=])/i)) {
      return "propertyName";
    }

    if (stream.match(/^[:=]/)) {
      return "operator";
    }

    if (stream.match(/^[{}[\](),.]/)) {
      return "punctuation";
    }

    if (stream.match(/^[^\s#;:=\[\]"']+/)) {
      return null;
    }

    stream.next();
    return null;
  },
};

const genericLogParser: StreamParser<EmptyParserState> = {
  name: "generic-log",
  startState: () => ({}),
  token(stream) {
    if (stream.eatSpace()) {
      return null;
    }

    const cue = matchCommonCue(stream);

    if (cue) {
      return cue;
    }

    const next = stream.peek();

    if (next === '"' || next === "'") {
      return consumeQuotedString(stream);
    }

    if (stream.match(/^\[[^\]\r\n]+\]/)) {
      return "labelName";
    }

    if (stream.match(/^\([^)]+\)/)) {
      return "labelName";
    }

    if (stream.match(/^[+-]?(?:0x[\da-f]+|\d+(?:\.\d+)?)\b/i)) {
      return "number";
    }

    if (stream.match(/^[^\s"'()[\]]+/)) {
      return null;
    }

    stream.next();
    return null;
  },
};

const genericTextCueParser: StreamParser<EmptyParserState> = {
  name: "generic-text-cues",
  startState: () => ({}),
  token(stream) {
    if (stream.eatSpace()) {
      return null;
    }

    const cue = matchCommonCue(stream);

    if (cue) {
      return cue;
    }

    const next = stream.peek();

    if (next === '"' || next === "'") {
      return consumeQuotedString(stream);
    }

    if (stream.match(/^[a-z_][\w.-]*(?=\s*[:=])/i)) {
      return "propertyName";
    }

    if (stream.match(/^[:=]/)) {
      return "operator";
    }

    if (stream.match(/^[^\s"'=:]+/)) {
      return null;
    }

    stream.next();
    return null;
  },
};

const genericConfigLanguage = StreamLanguage.define(genericConfigParser);
const genericLogLanguage = StreamLanguage.define(genericLogParser);
const genericTextCueLanguage = StreamLanguage.define(genericTextCueParser);

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

const smartOverlayTheme = EditorView.baseTheme({
  ".cm-smart-attribute": { color: "#0f766e" },
  ".cm-smart-boolean": { color: "#7c3aed" },
  ".cm-smart-bracket": { color: "#64748b" },
  ".cm-smart-comment": { color: "#64748b", fontStyle: "italic" },
  ".cm-smart-function": { color: "#2563eb" },
  ".cm-smart-key": { color: "#1d4ed8" },
  ".cm-smart-keyword": { color: "#9333ea", fontWeight: "600" },
  ".cm-smart-level": { color: "#dc2626", fontWeight: "700" },
  ".cm-smart-number": { color: "#7c3aed" },
  ".cm-smart-operator": { color: "#64748b" },
  ".cm-smart-path": { color: "#0f766e" },
  ".cm-smart-section": { color: "#be123c", fontWeight: "600" },
  ".cm-smart-string": { color: "#047857" },
  ".cm-smart-tag": { color: "#be123c" },
  ".cm-smart-timestamp": { color: "#0369a1" },
  ".cm-smart-url": { color: "#0369a1", textDecoration: "underline", textUnderlineOffset: "2px" },
  "&dark .cm-smart-attribute": { color: "#5eead4" },
  "&dark .cm-smart-boolean": { color: "#c4b5fd" },
  "&dark .cm-smart-bracket": { color: "#94a3b8" },
  "&dark .cm-smart-comment": { color: "#94a3b8" },
  "&dark .cm-smart-function": { color: "#93c5fd" },
  "&dark .cm-smart-key": { color: "#93c5fd" },
  "&dark .cm-smart-keyword": { color: "#d8b4fe" },
  "&dark .cm-smart-level": { color: "#fca5a5" },
  "&dark .cm-smart-number": { color: "#c4b5fd" },
  "&dark .cm-smart-operator": { color: "#94a3b8" },
  "&dark .cm-smart-path": { color: "#5eead4" },
  "&dark .cm-smart-section": { color: "#fda4af" },
  "&dark .cm-smart-string": { color: "#86efac" },
  "&dark .cm-smart-tag": { color: "#fda4af" },
  "&dark .cm-smart-timestamp": { color: "#7dd3fc" },
  "&dark .cm-smart-url": { color: "#7dd3fc" },
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
        builder.add(
          line.from + token.start,
          line.from + token.end,
          Decoration.mark({ class: token.className }),
        );
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
  line.startsWith("//") || line.startsWith("#") || line.startsWith(";") || line.startsWith("/*") || line.startsWith("*");

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
