import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

import { buildChangeTree, type ChangeTreeNode } from "../change-tree";
import type { GitChange } from "../types";
import { getChangeStatusLabel } from "./git-panel";

/** 变更文件树:按目录折叠,叶子是变更文件(单击选中,双击并排对照)。 */
export function GitChangesTree({
  changes,
  onOpen,
  onSelect,
  selectedPath,
}: {
  changes: GitChange[];
  onOpen: (path: string) => void;
  onSelect: (path: string) => void;
  selectedPath: string | null;
}) {
  const tree = buildChangeTree(changes);
  return (
    <div className="git-changes-tree">
      <ChangeNodes nodes={tree} depth={0} onOpen={onOpen} onSelect={onSelect} selectedPath={selectedPath} />
    </div>
  );
}

function ChangeNodes({
  depth,
  nodes,
  onOpen,
  onSelect,
  selectedPath,
}: {
  depth: number;
  nodes: ChangeTreeNode[];
  onOpen: (path: string) => void;
  onSelect: (path: string) => void;
  selectedPath: string | null;
}) {
  return (
    <>
      {nodes.map((node) =>
        node.kind === "folder" ? (
          <ChangeFolder
            key={`folder:${node.path}`}
            node={node}
            depth={depth}
            onOpen={onOpen}
            onSelect={onSelect}
            selectedPath={selectedPath}
          />
        ) : (
          <ChangeFile
            key={`file:${node.change.path}`}
            node={node}
            depth={depth}
            onOpen={onOpen}
            onSelect={onSelect}
            selectedPath={selectedPath}
          />
        ),
      )}
    </>
  );
}

function ChangeFolder({
  depth,
  node,
  onOpen,
  onSelect,
  selectedPath,
}: {
  depth: number;
  node: Extract<ChangeTreeNode, { kind: "folder" }>;
  onOpen: (path: string) => void;
  onSelect: (path: string) => void;
  selectedPath: string | null;
}) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button
        type="button"
        className="git-branch-folder"
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        <span className="truncate">{node.name}</span>
      </button>
      {open ? (
        <ChangeNodes nodes={node.children} depth={depth + 1} onOpen={onOpen} onSelect={onSelect} selectedPath={selectedPath} />
      ) : null}
    </>
  );
}

function ChangeFile({
  depth,
  node,
  onOpen,
  onSelect,
  selectedPath,
}: {
  depth: number;
  node: Extract<ChangeTreeNode, { kind: "file" }>;
  onOpen: (path: string) => void;
  onSelect: (path: string) => void;
  selectedPath: string | null;
}) {
  const { change } = node;
  return (
    <button
      type="button"
      className={cn("git-tree-file", change.path === selectedPath && "git-tree-file-selected")}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      onClick={() => onSelect(change.path)}
      onDoubleClick={() => onOpen(change.path)}
      title={`${change.path}（双击并排对照）`}
    >
      <span className={cn("git-change-status", `git-change-status-${change.status}`)}>
        {getChangeStatusLabel(change.status)}
      </span>
      <span className="min-w-0 flex-1 truncate text-ui-md">{node.name}</span>
      {change.additions || change.deletions ? (
        <span className="git-tree-file-stat">
          {change.additions ? <span className="status-additions">+{change.additions}</span> : null}
          {change.deletions ? <span className="status-deletions">−{change.deletions}</span> : null}
        </span>
      ) : null}
    </button>
  );
}
