import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

import type { NativeDirectoryEntry } from "../types";
import { getPathIcon } from "../workbench-utils";

const joinPath = (root: string, rel: string) =>
  `${root.replace(/[\\/]+$/, "")}/${rel.replace(/^[\\/]+/, "").replace(/[\\/]+$/, "")}`;

/** 已忽略条目树:目录可懒加载展开(读真实磁盘内容),文件可点击打开。整体灰显。 */
export function GitIgnoredTree({
  entries,
  onOpenFile,
  rootPath,
}: {
  entries: string[];
  onOpenFile: (path: string, size?: number) => void;
  rootPath: string;
}) {
  return (
    <div className="git-ignored-tree">
      {entries.map((entry) =>
        entry.endsWith("/") ? (
          <IgnoredFolder
            key={entry}
            absPath={joinPath(rootPath, entry)}
            name={entry.replace(/\/+$/, "").split("/").pop() ?? entry}
            depth={0}
            onOpenFile={onOpenFile}
          />
        ) : (
          <IgnoredFile
            key={entry}
            absPath={joinPath(rootPath, entry)}
            name={entry}
            depth={0}
            onOpenFile={onOpenFile}
          />
        ),
      )}
    </div>
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
        <icon.Icon className={cn("tree-row-icon", icon.className)} />
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
      <icon.Icon className={cn("tree-row-icon", icon.className)} />
      <span className="min-w-0 flex-1 truncate">{name}</span>
    </button>
  );
}
