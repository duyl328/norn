import type { ReactNode } from "react";

export type SearchTextHit = { line: number; path: string; text: string };

export type MatchTreeNode = {
  children: MatchTreeNode[];
  count?: number; // 文件节点:命中行数
  key: string;
  name: string; // 目录 / 文件名
  path?: string; // 文件叶子:绝对路径
};

// 预览渲染上限:超大文件只渲染前 N 行,避免一次塞几万个 DOM 节点。
// ponytail: 4000 行够看;若需要看更靠后的命中,在编辑器里打开即可。
export const PREVIEW_LINE_CAP = 4000;

/** 子序列模糊匹配:query(已小写)字符按序出现即命中(IDE Ctrl+P 风格)。 */
export const fuzzyMatch = (text: string, query: string): boolean => {
  if (!query) return true;
  let i = 0;
  for (const char of text.toLowerCase()) {
    if (char === query[i]) i += 1;
    if (i === query.length) return true;
  }
  return false;
};

/** 把绝对路径转成相对工作区根的展示路径。 */
export const toRelativePath = (path: string, root: string | undefined): string =>
  root && path.startsWith(root) ? path.slice(root.length).replace(/^[/\\]+/, "") : path;

export const baseName = (path: string): string => path.split(/[/\\]/).pop() || path;

/** 用与后端一致的语义在前端重建正则,仅用于预览高亮。
 *  ponytail: JS 的 \b 是 ASCII 词边界,与 Rust 的 Unicode 词边界对非 ASCII 整词可能略有出入(只影响高亮,不影响命中)。 */
export const buildPreviewRegex = (
  query: string,
  caseSensitive: boolean,
  wholeWord: boolean,
  isRegex: boolean,
): RegExp | null => {
  if (!query) return null;
  try {
    let pattern = isRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (wholeWord) pattern = `\\b(?:${pattern})\\b`;
    return new RegExp(pattern, caseSensitive ? "g" : "gi");
  } catch {
    return null;
  }
};

/** 某行第一处命中的列号(0 基);不修改传入的正则。 */
export const firstMatchColumn = (lineText: string, regex: RegExp | null): number => {
  if (!regex) return 0;
  const local = new RegExp(regex.source, regex.flags);
  const match = local.exec(lineText);
  return match ? match.index : 0;
};

/** 把一行按正则切片,命中部分包进 <mark> 高亮。不修改传入的正则。 */
export const renderHighlighted = (line: string, regex: RegExp | null): ReactNode => {
  if (!regex) return line;
  const local = new RegExp(regex.source, regex.flags);
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  while ((match = local.exec(line)) !== null) {
    if (match.index > last) nodes.push(line.slice(last, match.index));
    nodes.push(
      <mark key={key++} className="windows-quick-search-mark">
        {match[0]}
      </mark>,
    );
    last = match.index + match[0].length;
    if (match[0].length === 0) local.lastIndex += 1; // 防空匹配死循环
  }
  if (last < line.length) nodes.push(line.slice(last));
  return nodes;
};

/** 文件名模糊高亮:贪心地把子序列命中的字符包进 <mark>(VSCode Ctrl+P 风格)。 */
export const fuzzyHighlight = (text: string, query: string): ReactNode => {
  if (!query) return text;
  const lower = text.toLowerCase();
  const nodes: ReactNode[] = [];
  let qi = 0;
  let buffer = "";
  let key = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (qi < query.length && lower[i] === query[qi]) {
      if (buffer) {
        nodes.push(buffer);
        buffer = "";
      }
      nodes.push(
        <mark key={key++} className="windows-quick-search-mark">
          {text[i]}
        </mark>,
      );
      qi += 1;
    } else {
      buffer += text[i];
    }
  }
  if (buffer) nodes.push(buffer);
  return nodes;
};

/** 把命中的文件路径(相对工作区)折成一棵文件夹树。 */
export const buildMatchTree = (
  groups: [string, SearchTextHit[]][],
  root: string | undefined,
): MatchTreeNode[] => {
  const rootNodes: MatchTreeNode[] = [];
  const dirByKey = new Map<string, MatchTreeNode>();

  for (const [path, hits] of groups) {
    const parts = toRelativePath(path, root).split(/[/\\]/).filter(Boolean);
    let siblings = rootNodes;
    let prefix = "";
    parts.forEach((part, index) => {
      prefix = prefix ? `${prefix}/${part}` : part;
      if (index === parts.length - 1) {
        // 文件叶子:命中明细在右侧预览看,左树只显示文件 + 命中数。
        siblings.push({ children: [], count: hits.length, key: prefix, name: part, path });
        return;
      }
      let dir = dirByKey.get(prefix);
      if (!dir) {
        dir = { children: [], key: prefix, name: part };
        dirByKey.set(prefix, dir);
        siblings.push(dir);
      }
      siblings = dir.children;
    });
  }

  // 目录在前、再文件,字母序。
  const sort = (nodes: MatchTreeNode[]) => {
    nodes.sort((a, b) => (a.path ? 1 : 0) - (b.path ? 1 : 0) || a.name.localeCompare(b.name));
    nodes.forEach((node) => node.children.length && sort(node.children));
  };
  sort(rootNodes);
  return rootNodes;
};
