/**
 * 轻量「整理」而非「格式化」:我们是编辑器不是编译器,目标是让乱的变整齐,不求完美。
 *
 * 三种策略按扩展名分桶:
 *  - JSON      → stdlib parse/stringify,严格 JSON 完美;解析失败(JSONC/带注释)退回 tidy。
 *  - 花括号族  → 通用括号深度重排,只改「行首缩进」,绝不动行内内容 →
 *                最坏只是缩进难看,永不改变语义;字符串/注释内的括号会被跳过。
 *  - 缩进敏感(py/yaml/md) → 缩进即语法,只做空白整理,绝不重排缩进。
 *
 * ponytail: 正则/扫描器级别,刻意不接 AST/LSP。要真 formatter 各语言自己跑 prettier/rustfmt。
 */

/** 花括号分块的语言:可用通用括号深度重排。 */
const BRACE_FAMILY = new Set([
  "js",
  "jsx",
  "ts",
  "tsx",
  "mjs",
  "cjs",
  "java",
  "c",
  "h",
  "cpp",
  "cc",
  "cxx",
  "hpp",
  "cs",
  "go",
  "rs",
  "php",
  "css",
  "scss",
  "less",
  "kt",
  "kts",
  "swift",
  "scala",
  "dart",
  "groovy",
  "proto",
]);

/** 缩进即语法的语言:只能整理空白,重排缩进会破坏文件。 */
const INDENT_SENSITIVE = new Set([
  "py",
  "python",
  "yaml",
  "yml",
  "md",
  "markdown",
  "mdx",
  "hs",
  "coffee",
  "sass",
  "styl",
  "pug",
  "jade",
]);

/** 标签分块的语言:用通用标签深度重排(数 <tag></tag>,而非花括号)。 */
const TAG_FAMILY = new Set(["html", "htm", "xml", "xhtml", "svg", "xaml", "rss", "atom"]);

/** HTML 空元素:无闭合标签,不增加深度。 */
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/** 内容原样(含空白敏感/含裸 < >)的元素:整段不重排,直到对应闭合。 */
const RAW_TAGS = new Set(["script", "style", "pre", "textarea"]);

interface TidyOptions {
  /** 去行尾空白。Markdown 行尾两空格=硬换行,故 md 关掉。 */
  trailing?: boolean;
  /** 连续空行收敛为一个。 */
  collapseBlank?: boolean;
}

/** 语言无关的空白整理:统一换行、去行尾空白、收敛空行、末尾恰好一个换行。不碰代码结构。 */
export function tidy(text: string, opts: TidyOptions = {}): string {
  const { trailing = true, collapseBlank = true } = opts;
  let out = text.replace(/\r\n?/g, "\n");
  if (trailing) out = out.replace(/[ \t]+$/gm, "");
  if (collapseBlank) out = out.replace(/\n{3,}/g, "\n\n");
  return out.replace(/\n*$/, "\n");
}

function formatJson(text: string): string | null {
  try {
    return `${JSON.stringify(JSON.parse(text), null, 2)}\n`;
  } catch {
    return null;
  }
}

/**
 * 跨行持续的扫描状态:块注释与反引号模板串会跨行,单/双引号字符串不跨行(行尾自动复位)。
 * null = 在代码里。
 */
type ScanMode = null | "block" | "`";

/** 扫描一行,返回净括号增量(已跳过字符串/注释内的括号)与出口状态。 */
function scanLine(line: string, mode: ScanMode | "'" | '"'): { delta: number; mode: ScanMode } {
  let delta = 0;
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    const next = line[i + 1];
    if (mode === "block") {
      if (c === "*" && next === "/") {
        mode = null;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (mode === "'" || mode === '"' || mode === "`") {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === mode) {
        mode = null;
        i += 1;
        continue;
      }
      i += 1;
      continue;
    }
    // 在代码里
    if (c === "/" && next === "/") break; // 行注释:本行剩余忽略
    if (c === "#") break; // shell/py 风格行注释(对花括号族多余但无害)
    if (c === "/" && next === "*") {
      mode = "block";
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      mode = c;
      i += 1;
      continue;
    }
    if (c === "{" || c === "(" || c === "[") {
      delta += 1;
      i += 1;
      continue;
    }
    if (c === "}" || c === ")" || c === "]") {
      delta -= 1;
      i += 1;
      continue;
    }
    i += 1;
  }
  // 单/双引号不跨行:未闭合就当本行内的噪声,复位避免吞掉后续行。
  if (mode === "'" || mode === '"') mode = null;
  return { delta, mode };
}

/**
 * 通用括号深度重排:只重写每行行首缩进,行内内容一字不动。
 * 多行字符串/块注释内部整段原样保留(否则会改字符串内容)。
 */
export function reindentBraces(text: string, unit = "  "): string {
  const out: string[] = [];
  let depth = 0;
  let mode: ScanMode = null;
  for (const raw of text.split("\n")) {
    if (mode === "block" || mode === "`") {
      // 在多行字符串/块注释里:原样输出,只更新扫描状态与深度。
      out.push(raw);
      const res = scanLine(raw, mode);
      depth = Math.max(0, depth + res.delta);
      mode = res.mode;
      continue;
    }
    const trimmed = raw.replace(/^[ \t]+/, "");
    if (trimmed === "") {
      out.push("");
      continue;
    }
    const startsCloser = /^[)}\]]/.test(trimmed);
    const level = Math.max(0, depth - (startsCloser ? 1 : 0));
    out.push(unit.repeat(level) + trimmed);
    const res = scanLine(trimmed, null);
    depth = Math.max(0, depth + res.delta);
    mode = res.mode;
  }
  return out.join("\n");
}

/**
 * 跨行持续的标签状态:null=在标签/文本里;"comment"=在 <!-- --> 注释里;
 * 其它字符串=在某个原样元素(script/style/pre/textarea)里,等它闭合。
 */
type TagMode = null | "comment" | string;

/** 扫描一行的标签,返回深度变化与出口状态。已跳过注释/原样元素内部。 */
function scanTags(line: string, depth: number): { depth: number; mode: TagMode } {
  let i = 0;
  while (i < line.length) {
    if (line.startsWith("<!--", i)) {
      const end = line.indexOf("-->", i + 4);
      if (end === -1) return { depth, mode: "comment" };
      i = end + 3;
      continue;
    }
    if (line[i] !== "<") {
      i += 1;
      continue;
    }
    const rest = line.slice(i);
    const close = /^<\/([a-zA-Z][\w-]*)/.exec(rest);
    if (close) {
      depth = Math.max(0, depth - 1);
      i += close[0].length;
      continue;
    }
    if (line[i + 1] === "!" || line[i + 1] === "?") {
      // <!DOCTYPE …> / <?xml …?>:声明,不影响深度。
      const gt = line.indexOf(">", i);
      i = gt === -1 ? line.length : gt + 1;
      continue;
    }
    const open = /^<([a-zA-Z][\w-]*)([^>]*)>/.exec(rest);
    if (!open) {
      i += 1;
      continue;
    } // 跨行的开标签:罕见,当文本跳过。
    const name = open[1].toLowerCase();
    const selfClosing = /\/\s*$/.test(open[2]);
    i += open[0].length;
    if (selfClosing || VOID_TAGS.has(name)) continue; // 深度不变
    if (RAW_TAGS.has(name)) {
      if (new RegExp(`</${name}\\b`, "i").test(line.slice(i))) continue; // 本行内即闭合
      return { depth, mode: name };
    }
    depth += 1;
  }
  return { depth, mode: null };
}

/**
 * 通用标签深度重排:只重写每行行首缩进,行内内容一字不动。
 * 注释与原样元素(script/style/pre/textarea)整段保留,保护空白敏感内容。
 */
export function reindentTags(text: string, unit = "  "): string {
  const out: string[] = [];
  let depth = 0;
  let mode: TagMode = null;
  for (const raw of text.split("\n")) {
    if (mode === "comment") {
      out.push(raw);
      if (raw.includes("-->")) mode = null;
      continue;
    }
    if (mode) {
      // 原样元素内部:保留,直到见到对应闭合标签。
      out.push(raw);
      if (new RegExp(`</${mode}\\b`, "i").test(raw)) mode = null;
      continue;
    }
    const trimmed = raw.replace(/^[ \t]+/, "");
    if (trimmed === "") {
      out.push("");
      continue;
    }
    const startsCloser = /^<\//.test(trimmed);
    const level = Math.max(0, depth - (startsCloser ? 1 : 0));
    out.push(unit.repeat(level) + trimmed);
    const res = scanTags(trimmed, depth);
    depth = res.depth;
    mode = res.mode;
  }
  return out.join("\n");
}

/** 按扩展名选策略整理文本。ext 不含点(如 "ts"、"json")。无可整理改动时原样返回。 */
export function formatText(text: string, ext: string): string {
  if (!text.trim()) return text;
  const e = ext.toLowerCase();

  if (e === "json" || e === "jsonc") {
    const json = formatJson(text);
    if (json !== null) return json;
    // 解析失败(注释/尾逗号)→ 退回 tidy,别动结构。
  }
  if (BRACE_FAMILY.has(e)) return reindentBraces(tidy(text));
  // 标签族:不去行尾空白也不收敛空行(pre/textarea 里都是有意义内容),只统一换行+末尾换行。
  if (TAG_FAMILY.has(e)) return reindentTags(tidy(text, { trailing: false, collapseBlank: false }));
  if (INDENT_SENSITIVE.has(e)) {
    const keepTrailing = e === "md" || e === "markdown" || e === "mdx";
    return tidy(text, { trailing: !keepTrailing, collapseBlank: !keepTrailing });
  }
  return tidy(text);
}
