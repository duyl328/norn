import { invoke } from "@tauri-apps/api/core";
import {
  Braces,
  Database,
  FileArchive,
  FileCode,
  FileCog,
  FileJson,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FileType,
  Folder,
  FolderOpen,
  Image,
} from "lucide-react";

import {
  EDITOR_MIN_THUMB_SIZE,
  EDITOR_SCROLLBAR_SIZE,
  editorLineWrappingStorageKey,
  editorSearchHistoryStorageKey,
  keymapOverridesStorageKey,
  maxEditorSearchHistory,
  maxQuickSearchHistory,
  maxRecentFolders,
  projectColorPairs,
  quickSearchHistoryStorageKey,
  recentFoldersStorageKey,
  resizeHandleHintsStorageKey,
} from "./constants";
import type {
  EditorScrollbarGeometry,
  EditorScrollbarOrientation,
  EditorScrollMetrics,
  FileTreeNode,
  GitError,
  NativeDirectoryEntry,
  NativeFileOperationError,
  NativeSaveError,
  ProjectAccentStyle,
  RecentFolder,
  TextEncodingOption,
  TreeDropTarget,
  TreeSelection,
  TreeSelectionModifiers,
  VisibleTreeRow,
  WorkbenchDocument,
} from "./types";

export const isTauriRuntime = () => Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

export const createDocumentId = (prefix: string) =>
  `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;

export const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export const getPathName = (path: string) => {
  const normalizedPath = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const name = normalizedPath.split("/").filter(Boolean).pop();

  return name || path;
};

export const getCompactPath = (path: string, visibleSegments = 4) => {
  const normalizedPath = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const segments = normalizedPath.split("/").filter(Boolean);

  if (segments.length <= visibleSegments) {
    return normalizedPath || path;
  }

  return `.../${segments.slice(-visibleSegments).join("/")}`;
};

export const getTailPath = (path: string, maxLength: number) => {
  const normalizedPath = path.replace(/\\/g, "/").replace(/\/+$/, "");

  if (normalizedPath.length <= maxLength) {
    return normalizedPath || path;
  }

  const prefix = ".../";
  const tailLength = Math.max(8, maxLength - prefix.length);

  return `${prefix}${normalizedPath.slice(-tailLength).replace(/^[/\\]+/, "")}`;
};

export const getFileExtension = (name: string) => {
  const normalizedName = name.toLowerCase();
  const extensionIndex = normalizedName.lastIndexOf(".");

  if (extensionIndex <= 0 || extensionIndex === normalizedName.length - 1) {
    return "";
  }

  return normalizedName.slice(extensionIndex + 1);
};

const catppuccinIconBasePath = "/file-icons/catppuccin";

const fileNameIconMap: Record<string, string> = {
  ".dockerignore": "docker-ignore",
  ".editorconfig": "editorconfig",
  ".env": "env",
  ".env.development": "env",
  ".env.local": "env",
  ".env.production": "env",
  ".env.test": "env",
  ".eslintignore": "eslint",
  ".eslintrc": "eslint",
  ".eslintrc.cjs": "eslint",
  ".eslintrc.js": "eslint",
  ".eslintrc.json": "eslint",
  ".eslintrc.mjs": "eslint",
  ".gitattributes": "git",
  ".gitignore": "git",
  ".gitkeep": "git",
  ".gitmodules": "git",
  ".prettierignore": "prettier",
  ".prettierrc": "prettier",
  ".prettierrc.json": "prettier",
  ".vscodeignore": "vscode",
  "angular.json": "angular",
  "babel.config.cjs": "babel",
  "babel.config.js": "babel",
  "babel.config.json": "babel",
  "babel.config.mjs": "babel",
  "cargo.lock": "cargo",
  "cargo.toml": "cargo",
  changelog: "changelog",
  "changelog.md": "changelog",
  "cmakelists.txt": "cmake",
  "compose.yaml": "docker-compose",
  "compose.yml": "docker-compose",
  contributing: "text",
  "contributing.md": "text",
  "docker-compose.yaml": "docker-compose",
  "docker-compose.yml": "docker-compose",
  dockerfile: "docker",
  "eslint.config.cjs": "eslint",
  "eslint.config.js": "eslint",
  "eslint.config.mjs": "eslint",
  "eslint.config.ts": "eslint",
  "go.mod": "go-mod",
  "go.sum": "go-mod",
  "go.work": "go-mod",
  gnumakefile: "makefile",
  license: "license",
  "license.md": "license",
  "license.txt": "license",
  makefile: "makefile",
  "nginx.conf": "nginx",
  "package-lock.json": "npm-lock",
  "package.json": "package-json",
  "pnpm-lock.yaml": "pnpm-lock",
  "pom.xml": "apache",
  "postcss.config.cjs": "postcss",
  "postcss.config.js": "postcss",
  "postcss.config.mjs": "postcss",
  "pyproject.toml": "python",
  readme: "readme",
  "readme.md": "readme",
  "robots.txt": "text",
  "schema.json": "json-schema",
  "tailwind.config.cjs": "tailwind",
  "tailwind.config.js": "tailwind",
  "tailwind.config.mjs": "tailwind",
  "tailwind.config.ts": "tailwind",
  "tauri.conf.json": "tauri",
  todo: "todo",
  "todo.md": "todo",
  "tsconfig.json": "typescript",
  "vite.config.js": "vite",
  "vite.config.mjs": "vite",
  "vite.config.ts": "vite",
  "vitest.config.js": "vitest",
  "vitest.config.ts": "vitest",
  "yarn.lock": "yarn-lock",
};

const extensionIconMap: Record<string, string> = {
  "7z": "zip",
  adoc: "asciidoc",
  asc: "asciidoc",
  asciidoc: "asciidoc",
  astro: "astro",
  awk: "bash",
  bash: "bash",
  bat: "batch",
  bib: "latex",
  c: "c",
  cer: "certificate",
  cfg: "config",
  cjs: "javascript",
  clj: "clojure",
  cljs: "clojure",
  cmake: "cmake",
  cmd: "batch",
  cnf: "config",
  conf: "config",
  config: "config",
  cpp: "cpp",
  crt: "certificate",
  cs: "csharp",
  csh: "bash",
  css: "css",
  csv: "csv",
  cts: "typescript",
  cxx: "cpp",
  dart: "dart",
  diff: "diff",
  env: "env",
  erl: "erlang",
  ex: "elixir",
  exs: "elixir",
  fish: "bash",
  fs: "fsharp",
  fsi: "fsharp",
  fsx: "fsharp",
  gif: "image",
  go: "go",
  graphql: "graphql",
  gql: "graphql",
  gz: "zip",
  h: "c-header",
  handlebars: "javascript",
  hbs: "javascript",
  hh: "cpp-header",
  hs: "haskell",
  htm: "html",
  html: "html",
  hxx: "cpp-header",
  ico: "image",
  ini: "config",
  java: "java",
  jav: "java",
  jinja: "jinja",
  jinja2: "jinja",
  jl: "julia",
  jpeg: "image",
  jpg: "image",
  js: "javascript",
  json: "json",
  json5: "json",
  jsonc: "json",
  jsx: "javascript-react",
  key: "key",
  kt: "kotlin",
  kts: "kotlin",
  latex: "latex",
  less: "less",
  liquid: "liquid",
  lock: "lock",
  log: "log",
  lua: "lua",
  m: "text",
  markdown: "markdown",
  md: "markdown",
  mdown: "markdown",
  mdx: "markdown-mdx",
  mermaid: "mermaid",
  mjs: "javascript",
  mkd: "markdown",
  mmd: "mermaid",
  mts: "typescript",
  mustache: "javascript",
  nim: "nim",
  nims: "nim",
  nix: "nix",
  out: "log",
  patch: "diff",
  pdf: "pdf",
  pem: "key",
  php: "php",
  phtml: "php",
  pl: "perl",
  plist: "xml",
  pm: "perl",
  png: "image",
  proto: "proto",
  ps1: "powershell",
  psd1: "powershell",
  psm1: "powershell",
  pub: "key",
  pug: "pug",
  py: "python",
  pyi: "python",
  pyw: "python",
  r: "r",
  rake: "ruby",
  rar: "zip",
  rb: "ruby",
  rs: "rust",
  sass: "sass",
  sc: "scala",
  scala: "scala",
  scss: "sass",
  sh: "bash",
  sql: "database",
  svg: "svg",
  swift: "swift",
  tar: "zip",
  tex: "latex",
  text: "text",
  tf: "terraform",
  tfvars: "terraform",
  toml: "toml",
  ts: "typescript",
  tsv: "csv",
  tsx: "typescript-react",
  twig: "twig",
  txt: "text",
  typ: "typst",
  uri: "url",
  url: "url",
  vue: "vue",
  webmanifest: "json",
  webp: "image",
  xhtml: "html",
  xml: "xml",
  xsd: "xml",
  xsl: "xml",
  xslt: "xml",
  yaml: "yaml",
  yml: "yaml",
  zig: "zig",
  zip: "zip",
  zsh: "bash",
};

const suffixIconMap: Array<[suffix: string, icon: string]> = [
  [".d.ts", "typescript-def"],
  [".test.tsx", "typescript-test"],
  [".spec.tsx", "typescript-test"],
  [".test.ts", "typescript-test"],
  [".spec.ts", "typescript-test"],
  [".test.jsx", "javascript-test"],
  [".spec.jsx", "javascript-test"],
  [".test.js", "javascript-test"],
  [".spec.js", "javascript-test"],
  [".config.ts", "typescript"],
  [".config.mts", "typescript"],
  [".config.cts", "typescript"],
  [".config.js", "javascript-config"],
  [".config.mjs", "javascript-config"],
  [".config.cjs", "javascript-config"],
  [".schema.json", "json-schema"],
  [".tar.gz", "zip"],
  [".tar.bz2", "zip"],
];

export const getCatppuccinFileIconName = (name: string, kind: FileTreeNode["kind"], expanded = false) => {
  if (kind === "directory") {
    return expanded ? "_folder_open" : "_folder";
  }

  const normalizedName = name.toLowerCase();
  const fileNameIcon = fileNameIconMap[normalizedName];

  if (fileNameIcon) {
    return fileNameIcon;
  }

  const suffixIcon = suffixIconMap.find(([suffix]) => normalizedName.endsWith(suffix))?.[1];

  if (suffixIcon) {
    return suffixIcon;
  }

  const extension = getFileExtension(name);

  return extensionIconMap[extension] ?? "_file";
};

export const getFileTreeIcon = (node: FileTreeNode) => {
  const iconName = getCatppuccinFileIconName(node.name, node.kind, Boolean(node.expanded));

  return {
    alt: node.kind === "directory" ? "Folder" : "File",
    iconName,
    src: `${catppuccinIconBasePath}/${iconName}.svg`,
  };
};

export const getFileTreeDisplayIcon = (node: FileTreeNode) => {
  if (node.kind === "directory") {
    return {
      className: "tree-row-icon-directory",
      Icon: node.expanded ? FolderOpen : Folder,
    };
  }

  const extension = getFileExtension(node.name);

  if (["ts", "tsx", "js", "jsx", "rs", "py", "go", "java", "c", "cpp", "cs", "swift"].includes(extension)) {
    return { className: "tree-row-icon-code", Icon: FileCode };
  }

  if (["json", "jsonc"].includes(extension)) {
    return { className: "tree-row-icon-json", Icon: FileJson };
  }

  if (["css", "scss", "less", "html", "xml", "md", "mdx"].includes(extension)) {
    return { className: "tree-row-icon-markup", Icon: FileType };
  }

  if (["toml", "yaml", "yml", "env", "ini", "conf", "config", "lock"].includes(extension)) {
    return { className: "tree-row-icon-config", Icon: FileCog };
  }

  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"].includes(extension)) {
    return { className: "tree-row-icon-image", Icon: Image };
  }

  if (["zip", "tar", "gz", "rar", "7z"].includes(extension)) {
    return { className: "tree-row-icon-archive", Icon: FileArchive };
  }

  if (["csv", "xls", "xlsx"].includes(extension)) {
    return { className: "tree-row-icon-sheet", Icon: FileSpreadsheet };
  }

  if (["sql", "sqlite", "db"].includes(extension)) {
    return { className: "tree-row-icon-data", Icon: Database };
  }

  if (["sh", "bash", "zsh", "ps1", "bat"].includes(extension)) {
    return { className: "tree-row-icon-terminal", Icon: FileTerminal };
  }

  if (["vue", "svelte"].includes(extension)) {
    return { className: "tree-row-icon-component", Icon: Braces };
  }

  return { className: "tree-row-icon-file", Icon: FileText };
};

/** 按名称 / 类型取与主文件树一致的图标(供 Git 各文件树复用),不需要完整 FileTreeNode。 */
export const getPathIcon = (name: string, kind: "file" | "directory", expanded = false) =>
  getFileTreeIcon({ name, path: name, relativePath: name, kind, expanded });

/** 与左侧文件树相同的彩色 lucide 图标(供 Git 文件树复用),不需要完整 FileTreeNode。 */
export const getPathDisplayIcon = (name: string, kind: "file" | "directory", expanded = false) =>
  getFileTreeDisplayIcon({ name, path: name, relativePath: name, kind, expanded });

export const getParentPath = (path: string) => {
  const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));

  if (separatorIndex < 0) {
    return null;
  }

  if (separatorIndex === 0) {
    return "/";
  }

  if (/^[a-zA-Z]:[\\/]/.test(path) && separatorIndex === 2) {
    return path.slice(0, 3);
  }

  return path.slice(0, separatorIndex);
};

export const isAbsolutePath = (path: string) =>
  path.startsWith("/") || path.startsWith("\\\\") || /^[a-zA-Z]:[\\/]/.test(path);

export const getFileOpenId = (path: string, lastModified?: number | null) => `${path}-${lastModified ?? Date.now()}`;

export const formatFileSize = (size?: number) => {
  if (typeof size !== "number") {
    return "";
  }

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

export const getNativeSaveError = (error: unknown): NativeSaveError => {
  if (error && typeof error === "object") {
    return error as NativeSaveError;
  }

  return { kind: "io", message: error instanceof Error ? error.message : String(error) };
};

export const toFileTreeNode = (entry: NativeDirectoryEntry): FileTreeNode => ({
  name: entry.name,
  path: entry.path,
  relativePath: entry.relativePath,
  kind: entry.kind,
  size: entry.size ?? undefined,
  lastModified: entry.lastModified ?? undefined,
  isHidden: Boolean(entry.isHidden),
  isSymlink: Boolean(entry.isSymlink),
  targetKind: entry.targetKind ?? null,
  canonicalPath: entry.canonicalPath ?? null,
  isReadonly: Boolean(entry.isReadonly),
  children: entry.kind === "directory" ? [] : undefined,
  childrenLoaded: false,
  expanded: false,
  error: entry.error ?? undefined,
});

export const collapseTreeNodeDeep = (node: FileTreeNode): FileTreeNode => ({
  ...node,
  expanded: false,
  children: node.children?.map(collapseTreeNodeDeep),
});

export const collapseTreeNodesDeep = (nodes: FileTreeNode[]) => nodes.map(collapseTreeNodeDeep);

// 「全部展开」:递归把所有「已加载子节点」的目录设为展开。
// 树是懒加载的(childrenLoaded),从未访问过的目录没有 children,展开它也无内容可显示,
// 因此这里只展开已加载的目录,不发起递归网络/IO 拉取(避免一次性加载整个仓库)。
export const expandLoadedTreeNodeDeep = (node: FileTreeNode): FileTreeNode => {
  if (node.kind !== "directory") {
    return node;
  }

  return {
    ...node,
    expanded: node.childrenLoaded ? true : node.expanded,
    children: node.children?.map(expandLoadedTreeNodeDeep),
  };
};

export const expandLoadedTreeNodesDeep = (nodes: FileTreeNode[]) => nodes.map(expandLoadedTreeNodeDeep);

export const mergeTreeNodeState = (node: FileTreeNode, previousNode?: FileTreeNode): FileTreeNode => {
  if (!previousNode || node.kind !== "directory") {
    return node;
  }

  return {
    ...node,
    children: previousNode.childrenLoaded ? previousNode.children : node.children,
    childrenLoaded: previousNode.childrenLoaded,
    expanded: previousNode.expanded,
    error: node.error,
  };
};

export const mergeTreeNodesState = (nodes: FileTreeNode[], previousNodes: FileTreeNode[]) =>
  nodes.map((node) =>
    mergeTreeNodeState(
      node,
      previousNodes.find((previousNode) => previousNode.path === node.path),
    ),
  );

export const updateTreeNode = (
  nodes: FileTreeNode[],
  path: string,
  update: (node: FileTreeNode) => FileTreeNode,
): FileTreeNode[] =>
  nodes.map((node) => {
    if (node.path === path) {
      return update(node);
    }

    if (node.children) {
      return { ...node, children: updateTreeNode(node.children, path, update) };
    }

    return node;
  });

export const flattenVisibleTreeRows = (
  nodes: FileTreeNode[],
  depth = 0,
  ancestorCanonicalPaths: string[] = [],
): VisibleTreeRow[] =>
  nodes.flatMap((node) => {
    const row: VisibleTreeRow = { depth, ancestorCanonicalPaths, node };
    const nodeCanonicalPath = node.canonicalPath ?? node.path;
    const nextAncestors =
      node.kind === "directory" ? [...ancestorCanonicalPaths, nodeCanonicalPath] : ancestorCanonicalPaths;

    if (node.kind !== "directory" || !node.expanded || !node.children) {
      return [row];
    }

    return [row, ...flattenVisibleTreeRows(node.children, depth + 1, nextAncestors)];
  });

// Shift 区间选择:在可见行顺序里取 anchor..lead(含两端)。任一端不在顺序中(已折叠/不可见)
// 时退回只选 lead,避免选出空集或越界。
export const orderedRange = (order: string[], anchorPath: string, leadPath: string): string[] => {
  const anchorIndex = order.indexOf(anchorPath);
  const leadIndex = order.indexOf(leadPath);

  if (anchorIndex < 0 || leadIndex < 0) {
    return leadIndex >= 0 ? [leadPath] : [];
  }

  const [low, high] = anchorIndex <= leadIndex ? [anchorIndex, leadIndex] : [leadIndex, anchorIndex];

  return order.slice(low, high + 1);
};

const singleSelection = (scope: TreeSelection["scope"], path: string): TreeSelection => ({
  scope,
  anchorPath: path,
  leadPath: path,
  paths: [path],
});

// 鼠标点击产生的新选区。Shift=区间(锚点不变),Ctrl/Cmd=切换单项(锚点移到该项),无修饰=单选。
// 跨作用域点击(scope 与当前选区不同)按单选处理。`order` 是该作用域当前可见行顺序。
export const applyTreeClick = (
  current: TreeSelection | null,
  scope: TreeSelection["scope"],
  path: string,
  modifiers: TreeSelectionModifiers,
  order: string[],
): TreeSelection => {
  const sameScope = current?.scope === scope;

  if (modifiers.range && sameScope && current) {
    return {
      scope,
      anchorPath: current.anchorPath,
      leadPath: path,
      paths: orderedRange(order, current.anchorPath, path),
    };
  }

  if (modifiers.toggle && sameScope && current) {
    const paths = current.paths.includes(path)
      ? current.paths.filter((existing) => existing !== path)
      : [...current.paths, path];
    return { scope, anchorPath: path, leadPath: path, paths };
  }

  return singleSelection(scope, path);
};

// 方向键移动光标(lead)。extend(Shift)=以锚点为起点扩展区间;否则单选并把锚点移到新行。
// 无 lead 时:向下进首行、向上进末行。order 为空则不动。
export const moveTreeLead = (
  current: TreeSelection | null,
  scope: TreeSelection["scope"],
  order: string[],
  delta: number,
  extend: boolean,
): TreeSelection | null => {
  if (order.length === 0) {
    return current;
  }

  const leadIndex = current?.scope === scope ? order.indexOf(current.leadPath) : -1;
  const nextIndex =
    leadIndex < 0 ? (delta > 0 ? 0 : order.length - 1) : Math.min(order.length - 1, Math.max(0, leadIndex + delta));
  const leadPath = order[nextIndex];

  if (extend && current?.scope === scope) {
    return {
      scope,
      anchorPath: current.anchorPath,
      leadPath,
      paths: orderedRange(order, current.anchorPath, leadPath),
    };
  }

  return singleSelection(scope, leadPath);
};

export const isPathInsideOrEqual = (path: string, possibleParent: string) => {
  const normalizedPath = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedParent = possibleParent.replace(/\\/g, "/").replace(/\/+$/, "");

  return normalizedPath === normalizedParent || normalizedPath.startsWith(`${normalizedParent}/`);
};

export const arePathsEqual = (a: string, b: string) =>
  a.replace(/\\/g, "/").replace(/\/+$/, "") === b.replace(/\\/g, "/").replace(/\/+$/, "");

export const findTreeNode = (nodes: FileTreeNode[], path: string): FileTreeNode | undefined => {
  for (const node of nodes) {
    if (node.path === path) {
      return node;
    }

    if (node.children) {
      const found = findTreeNode(node.children, path);

      if (found) {
        return found;
      }
    }
  }

  return undefined;
};

// 「在文件树中定位」用:从根(不含)到目标文件父目录(含)的祖先目录路径,自浅到深排序。
// 调用方沿这条链逐级「按需加载 + 展开」,直到目标文件所在目录可见。文件直接位于根下时返回空数组。
export const getTreeAncestorDirectoryPaths = (filePath: string, rootPath: string): string[] => {
  const ancestors: string[] = [];
  let current = getParentPath(filePath);

  while (current && isPathInsideOrEqual(current, rootPath) && !arePathsEqual(current, rootPath)) {
    ancestors.unshift(current);
    const parent = getParentPath(current);

    if (!parent || arePathsEqual(parent, current)) {
      break;
    }

    current = parent;
  }

  return ancestors;
};

export const getNativeFileOperationError = (error: unknown): NativeFileOperationError => {
  if (error && typeof error === "object") {
    return error as NativeFileOperationError;
  }

  return { message: error instanceof Error ? error.message : String(error) };
};

export const getGitError = (error: unknown): GitError => {
  if (error && typeof error === "object") {
    return error as GitError;
  }

  return { message: error instanceof Error ? error.message : String(error) };
};

export const getTreeDropTargetFromPoint = (position?: { x: number; y: number }): TreeDropTarget | null => {
  if (!position) {
    return null;
  }

  const element = globalThis.document.elementFromPoint(position.x, position.y);
  const dropTarget = element?.closest<HTMLElement>("[data-tree-drop-path]");
  const path = dropTarget?.dataset.treeDropPath;
  const scope = dropTarget?.dataset.treeDropScope;

  if (!path || (scope !== "main" && scope !== "scratch")) {
    return null;
  }

  return { path, scope };
};

export const isEditorDropTargetFromPoint = (position?: { x: number; y: number }): boolean => {
  if (!position) {
    return false;
  }

  const element = globalThis.document.elementFromPoint(position.x, position.y);

  return Boolean(element?.closest("[data-editor-drop-zone]"));
};

export const getEditorScrollbarGeometry = (
  orientation: EditorScrollbarOrientation,
  metrics: EditorScrollMetrics,
): EditorScrollbarGeometry | null => {
  const maxHorizontalScroll = Math.max(0, metrics.scrollWidth - metrics.clientWidth);
  const maxVerticalScroll = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
  const hasHorizontalScrollbar = maxHorizontalScroll > 1;
  const hasVerticalScrollbar = maxVerticalScroll > 1;

  if (orientation === "horizontal" && !hasHorizontalScrollbar) {
    return null;
  }

  if (orientation === "vertical" && !hasVerticalScrollbar) {
    return null;
  }

  const trackSize =
    orientation === "horizontal"
      ? Math.max(0, metrics.shellWidth - metrics.gutterWidth - (hasVerticalScrollbar ? EDITOR_SCROLLBAR_SIZE : 0))
      : Math.max(0, metrics.shellHeight);
  const maxScroll = orientation === "horizontal" ? maxHorizontalScroll : maxVerticalScroll;

  if (trackSize <= 0 || maxScroll <= 0) {
    return null;
  }

  const totalSize = trackSize + maxScroll;
  const thumbSize = Math.min(trackSize, Math.max(EDITOR_MIN_THUMB_SIZE, (trackSize / totalSize) * trackSize));
  const scrollPosition = orientation === "horizontal" ? metrics.scrollLeft : metrics.scrollTop;
  const thumbOffset = (clamp(scrollPosition, 0, maxScroll) / maxScroll) * Math.max(0, trackSize - thumbSize);

  return {
    maxScroll,
    scrollPosition,
    thumbOffset,
    thumbSize,
    trackSize,
  };
};

export const getDocumentLines = (document: WorkbenchDocument) => {
  const lines = document.content.split(/\r\n|\n|\r/);
  return lines.length > 0 ? lines : [""];
};

export const getProjectInitials = (name: string) => {
  const explicitWords = name.split(/[\s._-]+/).filter(Boolean);
  const camelParts = name
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s._-]+/)
    .filter(Boolean);
  const words = explicitWords.length > 1 ? explicitWords : camelParts;

  const initials = words
    .slice(0, 2)
    .map((word) => word[0])
    .join("");

  return (initials || name.slice(0, 2)).toUpperCase();
};

export const getProjectAccentStyle = (name: string): ProjectAccentStyle => {
  const hash = Array.from(name).reduce((value, character) => value + character.charCodeAt(0), 0);
  const pair = projectColorPairs[hash % projectColorPairs.length];

  return {
    "--project-color": pair.background,
    "--project-color-foreground": pair.foreground,
  };
};

export const getTabAccent = (id: string) => {
  const hash = Array.from(id).reduce((value, character) => value + character.charCodeAt(0), 0);

  return projectColorPairs[hash % projectColorPairs.length].background;
};

export const getTabBorderAccent = (name: string) => {
  const extension = getFileExtension(name);

  if (["ts", "tsx", "js", "jsx", "mjs", "cjs"].includes(extension)) return "#2563eb";
  if (["rs"].includes(extension)) return "#b45309";
  if (["py"].includes(extension)) return "#0369a1";
  if (["go"].includes(extension)) return "#0891b2";
  if (["java", "kt", "kts"].includes(extension)) return "#dc2626";
  if (["c", "cpp", "cc", "h", "hpp"].includes(extension)) return "#7c3aed";
  if (["cs"].includes(extension)) return "#6d28d9";
  if (["swift"].includes(extension)) return "#ea580c";
  if (["rb"].includes(extension)) return "#be123c";
  if (["php"].includes(extension)) return "#4f46e5";
  if (["json", "jsonc"].includes(extension)) return "#8b5cf6";
  if (["sql", "sqlite", "db"].includes(extension)) return "#0e7490";
  if (["html", "htm"].includes(extension)) return "#c2410c";
  if (["css", "scss", "sass", "less"].includes(extension)) return "#0d9488";
  if (["xml", "xsl", "xslt"].includes(extension)) return "#b45309";
  if (["md", "mdx", "markdown"].includes(extension)) return "#4338ca";
  if (["vue"].includes(extension)) return "#059669";
  if (["svelte"].includes(extension)) return "#d97706";
  if (["toml", "yaml", "yml"].includes(extension)) return "#64748b";
  if (["env", "ini", "conf", "config"].includes(extension)) return "#6b7280";
  if (["lock"].includes(extension)) return "#9ca3af";
  if (["png", "jpg", "jpeg", "gif", "webp", "ico"].includes(extension)) return "#db2777";
  if (["svg"].includes(extension)) return "#f59e0b";
  if (["csv"].includes(extension)) return "#047857";
  if (["xls", "xlsx"].includes(extension)) return "#166534";
  if (["zip", "tar", "gz", "rar", "7z"].includes(extension)) return "#a16207";
  if (["sh", "bash", "zsh", "ps1", "bat", "cmd"].includes(extension)) return "#475569";
  if (["txt", "text"].includes(extension)) return "#94a3b8";
  if (["log"].includes(extension)) return "#6b7280";
  if (["pdf"].includes(extension)) return "#b91c1c";
  if (["dockerfile", "dockerignore"].includes(extension)) return "#0369a1";

  return "#94a3b8";
};

export const isDocumentDirty = (document: WorkbenchDocument) => document.content !== document.savedContent;

export const upsertOpenDocument = (documents: WorkbenchDocument[], nextDocument: WorkbenchDocument) => {
  const existingIndex = documents.findIndex((document) => document.id === nextDocument.id);

  if (existingIndex === -1) {
    return [...documents, nextDocument];
  }

  return documents.map((document, index) => (index === existingIndex ? nextDocument : document));
};

export const loadRecentFolders = (): RecentFolder[] => {
  try {
    const value = window.localStorage.getItem(recentFoldersStorageKey);

    if (!value) {
      return [];
    }

    const folders = JSON.parse(value);

    if (!Array.isArray(folders)) {
      return [];
    }

    return folders
      .filter((folder): folder is RecentFolder => Boolean(folder?.path && folder?.name))
      .slice(0, maxRecentFolders);
  } catch {
    return [];
  }
};

export const saveRecentFolders = (folders: RecentFolder[]) => {
  window.localStorage.setItem(recentFoldersStorageKey, JSON.stringify(folders.slice(0, maxRecentFolders)));
};

const normalizeSearchHistory = (history: string[], maxItems: number) => {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const item of history) {
    const value = item.trim();
    const key = value.toLocaleLowerCase();

    if (!value || seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(value);

    if (normalized.length >= maxItems) {
      break;
    }
  }

  return normalized;
};

export const normalizeQuickSearchHistory = (history: string[]) =>
  normalizeSearchHistory(history, maxQuickSearchHistory);

export const upsertQuickSearchHistory = (history: string[], query: string) =>
  normalizeQuickSearchHistory([query, ...history]);

export const loadQuickSearchHistory = (): string[] => {
  try {
    const value = window.localStorage.getItem(quickSearchHistoryStorageKey);

    if (!value) {
      return [];
    }

    const history = JSON.parse(value);

    if (!Array.isArray(history)) {
      return [];
    }

    return normalizeQuickSearchHistory(history.filter((item): item is string => typeof item === "string"));
  } catch {
    return [];
  }
};

export const saveQuickSearchHistory = (history: string[]) => {
  window.localStorage.setItem(quickSearchHistoryStorageKey, JSON.stringify(normalizeQuickSearchHistory(history)));
};

export const normalizeEditorSearchHistory = (history: string[]) =>
  normalizeSearchHistory(history, maxEditorSearchHistory);

export const upsertEditorSearchHistory = (history: string[], query: string) =>
  normalizeEditorSearchHistory([query, ...history]);

export const loadEditorSearchHistory = (): string[] => {
  try {
    const value = window.localStorage.getItem(editorSearchHistoryStorageKey);

    if (!value) {
      return [];
    }

    const history = JSON.parse(value);

    if (!Array.isArray(history)) {
      return [];
    }

    return normalizeEditorSearchHistory(history.filter((item): item is string => typeof item === "string"));
  } catch {
    return [];
  }
};

export const saveEditorSearchHistory = (history: string[]) => {
  window.localStorage.setItem(editorSearchHistoryStorageKey, JSON.stringify(normalizeEditorSearchHistory(history)));
};

export const loadResizeHandleHints = () => {
  try {
    return window.localStorage.getItem(resizeHandleHintsStorageKey) === "true";
  } catch {
    return false;
  }
};

export const saveResizeHandleHints = (visible: boolean) => {
  window.localStorage.setItem(resizeHandleHintsStorageKey, String(visible));
};

/**
 * 用户自定义快捷键:actionId → 键位串数组(稀疏,缺失即用默认)。
 * Tauri 桌面下落到 `appConfigDir/keybindings.json`(用户可编辑、Rust 菜单也读它);
 * 纯 Web 预览回退 localStorage。
 */
export const loadKeymapOverrides = async (): Promise<Record<string, string[]>> => {
  if (isTauriRuntime()) {
    try {
      const raw = await invoke<string>("read_keybindings");
      const parsed = JSON.parse(raw || "{}");
      return parsed && typeof parsed === "object" ? (parsed as Record<string, string[]>) : {};
    } catch {
      return {};
    }
  }

  try {
    const value = window.localStorage.getItem(keymapOverridesStorageKey);
    const parsed = value ? JSON.parse(value) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string[]>) : {};
  } catch {
    return {};
  }
};

export const saveKeymapOverrides = async (overrides: Record<string, string[]>) => {
  const contents = JSON.stringify(overrides, null, 2);

  if (isTauriRuntime()) {
    try {
      await invoke("write_keybindings", { contents });
    } catch {
      // 写失败时静默:内存态仍生效,下次再写。
    }
    return;
  }

  try {
    window.localStorage.setItem(keymapOverridesStorageKey, contents);
  } catch {
    // localStorage 不可用时忽略。
  }
};

export const loadEditorLineWrapping = () => {
  try {
    return window.localStorage.getItem(editorLineWrappingStorageKey) === "true";
  } catch {
    return false;
  }
};

export const saveEditorLineWrapping = (enabled: boolean) => {
  window.localStorage.setItem(editorLineWrappingStorageKey, String(enabled));
};

export const createUntitledDocument = (): WorkbenchDocument => ({
  id: createDocumentId("untitled"),
  name: "Untitled.txt",
  path: "Untitled.txt",
  content: "",
  savedContent: "",
  encoding: "utf-8",
  encodingLabel: "UTF-8",
  encodingCandidates: [],
  hasBom: false,
  isUntitled: true,
  mode: "editable",
});

export const initialDocument: WorkbenchDocument = createUntitledDocument();

export const textEncodingOptions: TextEncodingOption[] = [
  { label: "UTF-8", value: "utf-8" },
  { label: "UTF-8 with BOM", value: "utf-8-bom", hasBom: true },
  { label: "UTF-16 LE", value: "utf-16le", hasBom: true },
  { label: "UTF-16 BE", value: "utf-16be", hasBom: true },
  { label: "GB18030 / GBK", value: "gb18030" },
  { label: "Big5", value: "big5" },
  { label: "Shift_JIS", value: "shift_jis" },
  { label: "EUC-JP", value: "euc-jp" },
  { label: "EUC-KR", value: "euc-kr" },
  { label: "Windows-1252", value: "windows-1252" },
];
