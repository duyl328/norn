import { type Extension } from "@codemirror/state";

import { genericConfigLanguage, genericLogLanguage, genericTextCueLanguage } from "./editor-stream-parsers";

// 智能高亮叠层实现已拆分到独立模块；此处再导出以保持对外 API 不变。
export { createSmartOverlayExtension, SMART_OVERLAY_SIZE_LIMIT_BYTES } from "./editor-smart-overlay";

// 完全文本解析:不再加载任何 Lezer 语言解析器(@codemirror/lang-*)。
// 所有文件统一走「智能叠层(逐行正则,见 editor-smart-overlay.ts)+ 泛化流解析器
// (逐行 tokenizer,见 editor-stream-parsers.ts)」。代码、配置、日志都按规则着色,
// 与具体语言/解析器不挂钩,对大文件也更友好(只扫可见视口、无全文件语法树)。
//
// 这两个常量保留原名以兼容 editor-surface 的引用;现在含义是「超过此大小连泛化流
// 解析器都不挂,仅留叠层」。
export const HIGHLIGHT_LANGUAGE_SIZE_LIMIT_BYTES = 5 * 1024 * 1024;
export const FULL_LANGUAGE_PARSER_SIZE_LIMIT_BYTES = 5 * 1024 * 1024;

type HighlightDocument = {
  content: string;
  name: string;
  path?: string;
  size?: number;
};

export type HighlightMode =
  | { kind: "generic-config"; label: string }
  | { kind: "generic-log"; label: string }
  | { kind: "generic-text-cues"; label: string }
  | { kind: "plain-text"; label: string; reason?: "large-file" };

const SAMPLE_SIZE = 16 * 1024;
const MIN_STRUCTURED_LINES = 2;

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

  const matches = lines.filter((line) => /^(?:[#;].+|\[[^\]]+\]|[a-z0-9_.-]+\s*[:=]\s*.+)$/i.test(line)).length;

  return matches >= MIN_STRUCTURED_LINES && matches / lines.length >= 0.35;
};

export const resolveHighlightMode = (document: HighlightDocument): HighlightMode => {
  if (typeof document.size === "number" && document.size > HIGHLIGHT_LANGUAGE_SIZE_LIMIT_BYTES) {
    return { kind: "plain-text", label: "Plain Text", reason: "large-file" };
  }

  const baseName = getBaseName(document);
  const normalizedBaseName = baseName.toLowerCase();
  const extension = getExtension(normalizedBaseName);

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

  if (genericConfigExtensions.has(extension)) {
    return genericConfigMode;
  }

  if (looksLikeLog(document.content)) {
    return genericLogMode;
  }

  if (looksLikeConfig(document.content)) {
    return genericConfigMode;
  }

  if (document.content.length === 0) {
    return plainTextMode;
  }

  // 代码及其余一切文本:智能叠层负责关键字/函数/字符串/数字等着色,
  // 这里再叠一层轻量的泛化 tokenizer 兜底结构性 token。
  return genericTextCueMode;
};

export const loadHighlightExtensions = async (mode: HighlightMode): Promise<Extension[]> => {
  if (mode.kind === "generic-config") {
    return [genericConfigLanguage];
  }

  if (mode.kind === "generic-log") {
    return [genericLogLanguage];
  }

  if (mode.kind === "generic-text-cues") {
    return [genericTextCueLanguage];
  }

  return [];
};
