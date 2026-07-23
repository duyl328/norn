import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import { buildFileTree, type FileTreeNode } from "../change-tree";
import type { NativeDirectoryEntry } from "../types";
import { getPathIcon } from "../workbench-utils";

const joinPath = (root: string, rel: string) =>
  `${root.replace(/[\\/]+$/, "")}/${rel.replace(/^[\\/]+/, "").replace(/[\\/]+$/, "")}`;

/** git 给的忽略项:整目录被忽略时带尾斜杠(node_modules/),零散文件是完整相对路径。 */
type IgnoredItem = { path: string; isDir: boolean };

type IgnoredNode = FileTreeNode<IgnoredItem>;

type SharedProps = {
  onOpenFile: (path: string, size?: number) => void;
  rootPath: string;
};

/** 已忽略条目树:目录可懒加载展开(读真实磁盘内容),文件可点击打开。整体灰显。 */
export function GitIgnoredTree({ entries, ...shared }: { entries: string[] } & SharedProps) {
  const tree = buildFileTree<IgnoredItem>(
    entries.map((entry) => ({ path: entry.replace(/\/+$/, ""), isDir: entry.endsWith("/") })),
  );
  return (
    <div className="git-ignored-tree">
      <IgnoredNodes nodes={tree} depth={0} {...shared} />
    </div>
  );
}

function IgnoredNodes({ depth, nodes, ...shared }: { depth: number; nodes: IgnoredNode[] } & SharedProps) {
  return (
    <>
      {nodes.map((node) =>
        node.kind === "folder" ? (
          <IgnoredGroup key={`group:${node.path}`} node={node} depth={depth} {...shared} />
        ) : node.item.isDir ? (
          <IgnoredFolder
            key={node.item.path}
            absPath={joinPath(shared.rootPath, node.item.path)}
            name={node.name}
            depth={depth}
            onOpenFile={shared.onOpenFile}
          />
        ) : (
          <IgnoredFile
            key={node.item.path}
            absPath={joinPath(shared.rootPath, node.item.path)}
            name={node.name}
            depth={depth}
            onOpenFile={shared.onOpenFile}
          />
        ),
      )}
    </>
  );
}

/** 中间层目录:它自己没被忽略,只是里面有零散忽略项(src/features/…),子节点已知无需懒加载。 */
function IgnoredGroup({
  depth,
  node,
  ...shared
}: { depth: number; node: Extract<IgnoredNode, { kind: "folder" }> } & SharedProps) {
  const [open, setOpen] = useState(true);
  const icon = getPathIcon(node.name, "directory", open);

  return (
    <>
      <button
        type="button"
        className="git-ignored-row git-ignored-row-folder"
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
        onClick={() => setOpen((value) => !value)}
        title={node.path}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        <PathIconImage icon={icon} />
        <span className="truncate">{node.name}</span>
      </button>
      {open ? <IgnoredNodes nodes={node.children} depth={depth + 1} {...shared} /> : null}
    </>
  );
}

function IgnoredFolder({
  absPath,
  depth,
  name,
  onOpenFile,
}: {
  absPath: string;
  depth: number;
  name: string;
  onOpenFile: (path: string, size?: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<NativeDirectoryEntry[] | null>(null);
  const icon = getPathIcon(name, "directory", open);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && children === null) {
      void invoke<NativeDirectoryEntry[]>("list_directory", { path: absPath })
        .then(setChildren)
        .catch(() => setChildren([]));
    }
  };

  return (
    <>
      <button
        type="button"
        className="git-ignored-row git-ignored-row-folder"
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
        onClick={toggle}
        title={absPath}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        <PathIconImage icon={icon} />
        <span className="truncate">{name}</span>
      </button>
      {open && children
        ? children.map((child) =>
            child.kind === "directory" ? (
              <IgnoredFolder
                key={child.path}
                absPath={child.path}
                name={child.name}
                depth={depth + 1}
                onOpenFile={onOpenFile}
              />
            ) : (
              <IgnoredFile
                key={child.path}
                absPath={child.path}
                name={child.name}
                size={child.size ?? undefined}
                depth={depth + 1}
                onOpenFile={onOpenFile}
              />
            ),
          )
        : null}
      {open && children === null ? (
        <div className="git-ignored-row-hint" style={{ paddingLeft: `${(depth + 1) * 12 + 6}px` }}>
          加载中…
        </div>
      ) : null}
    </>
  );
}

function IgnoredFile({
  absPath,
  depth,
  name,
  onOpenFile,
  size,
}: {
  absPath: string;
  depth: number;
  name: string;
  onOpenFile: (path: string, size?: number) => void;
  size?: number;
}) {
  const icon = getPathIcon(name, "file");
  return (
    <button
      type="button"
      className="git-ignored-row"
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      title={absPath}
      onClick={() => onOpenFile(absPath, size)}
    >
      <PathIconImage icon={icon} />
      <span className="min-w-0 flex-1 truncate">{name}</span>
    </button>
  );
}

function PathIconImage({ icon }: { icon: ReturnType<typeof getPathIcon> }) {
  return <img alt="" aria-hidden="true" className="tree-row-icon" draggable={false} src={icon.src} />;
}
