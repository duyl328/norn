import { StreamLanguage } from "@codemirror/language";
import { type Extension } from "@codemirror/state";

import { genericConfigLanguage, genericLogLanguage, genericTextCueLanguage } from "./editor-stream-parsers";

// 智能高亮叠层实现已拆分到独立模块；此处再导出以保持对外 API 不变。
export { createSmartOverlayExtension, SMART_OVERLAY_SIZE_LIMIT_BYTES } from "./editor-smart-overlay";

export const HIGHLIGHT_LANGUAGE_SIZE_LIMIT_BYTES = 5 * 1024 * 1024;
export const FULL_LANGUAGE_PARSER_SIZE_LIMIT_BYTES = 5 * 1024 * 1024;

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

  const matches = lines.filter((line) => /^(?:[#;].+|\[[^\]]+\]|[a-z0-9_.-]+\s*[:=]\s*.+)$/i.test(line)).length;

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
