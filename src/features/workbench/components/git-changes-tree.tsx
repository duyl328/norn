import { Check, ChevronDown, ChevronRight, EyeOff, Minus } from "lucide-react";
import { type MouseEvent as ReactMouseEvent, useState } from "react";

import { cn } from "@/lib/utils";

import { buildFileTree, type FileTreeNode } from "../change-tree";
import type { GitChange } from "../types";
import { getPathIcon } from "../workbench-utils";
import { ContextMenu } from "./context-menu";
import { getChangeStatusLabel } from "./git-panel";

type ChangeNode = FileTreeNode<GitChange>;

type CheckState = "on" | "off" | "mix";

/** 变更文件树:勾选选择要提交的文件,单击选中,双击并排对照,右键加入 .gitignore。 */
export function GitChangesTree({
  changes,
  isChecked,
  onAddIgnore,
  onOpen,
  onSelect,
  onTogglePaths,
  selectedPath,
}: {
  changes: GitChange[];
  isChecked: (path: string) => boolean;
  onAddIgnore: (entry: string) => void;
  onOpen: (path: string) => void;
  onSelect: (path: string) => void;
  onTogglePaths: (paths: string[], value: boolean) => void;
  selectedPath: string | null;
}) {
  const tree = buildFileTree(changes);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: string } | null>(null);

  const onContextMenu = (event: ReactMouseEvent, entry: string) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY, entry });
  };

  const shared = { isChecked, onContextMenu, onOpen, onSelect, onTogglePaths, selectedPath };
  return (
    <div className="git-changes-tree">
      <ChangeNodes nodes={tree} depth={0} {...shared} />
      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              label: `加入 .gitignore`,
              icon: <EyeOff className="h-3.5 w-3.5" />,
              onClick: () => onAddIgnore(menu.entry),
            },
          ]}
        />
      ) : null}
    </div>
  );
}

function collectFiles(nodes: ChangeNode[]): string[] {
  return nodes.flatMap((node) =>
    node.kind === "file" ? [node.item.path] : collectFiles(node.children),
  );
}

type SharedProps = {
  isChecked: (path: string) => boolean;
  onContextMenu: (event: ReactMouseEvent, entry: string) => void;
  onOpen: (path: string) => void;
  onSelect: (path: string) => void;
  onTogglePaths: (paths: string[], value: boolean) => void;
  selectedPath: string | null;
};

function ChangeNodes({ depth, nodes, ...shared }: { depth: number; nodes: ChangeNode[] } & SharedProps) {
  return (
    <>
      {nodes.map((node) =>
        node.kind === "folder" ? (
          <ChangeFolder key={`folder:${node.path}`} node={node} depth={depth} {...shared} />
        ) : (
          <ChangeFile key={`file:${node.item.path}`} node={node} depth={depth} {...shared} />
        ),
      )}
    </>
  );
}

function ChangeFolder({
  depth,
  node,
  ...shared
}: { depth: number; node: Extract<ChangeNode, { kind: "folder" }> } & SharedProps) {
  const [open, setOpen] = useState(true);
  const files = collectFiles(node.children);
  const checkedCount = files.filter((path) => shared.isChecked(path)).length;
  const state: CheckState = checkedCount === 0 ? "off" : checkedCount === files.length ? "on" : "mix";
  const folderIcon = getPathIcon(node.name, "directory", open);

  return (
    <>
      <div
        className="git-branch-folder git-tree-folder"
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
        onContextMenu={(event) => shared.onContextMenu(event, `${node.path}/`)}
      >
        <GitCheckbox state={state} onToggle={() => shared.onTogglePaths(files, state !== "on")} />
        <button type="button" className="git-tree-folder-label" onClick={() => setOpen((value) => !value)}>
          {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
          <PathIconImage icon={folderIcon} />
          <span className="truncate">{node.name}</span>
        </button>
      </div>
      {open ? <ChangeNodes nodes={node.children} depth={depth + 1} {...shared} /> : null}
    </>
  );
}

function ChangeFile({
  depth,
  node,
  ...shared
}: { depth: number; node: Extract<ChangeNode, { kind: "file" }> } & SharedProps) {
  const change = node.item;
  const checked = shared.isChecked(change.path);
  const fileIcon = getPathIcon(change.path, "file");

  return (
    <div
      className={cn("git-tree-file", change.path === shared.selectedPath && "git-tree-file-selected")}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      onContextMenu={(event) => shared.onContextMenu(event, change.path)}
    >
      <GitCheckbox state={checked ? "on" : "off"} onToggle={() => shared.onTogglePaths([change.path], !checked)} />
      <button
        type="button"
        className="git-tree-file-main"
        onClick={() => shared.onSelect(change.path)}
        onDoubleClick={() => shared.onOpen(change.path)}
        title={`${change.path}（双击并排对照）`}
      >
        <PathIconImage icon={fileIcon} />
        <span className="min-w-0 flex-1 truncate text-ui-md">{node.name}</span>
        <span className="git-tree-file-trailing">
          {change.additions ? <span className="status-additions">+{change.additions}</span> : null}
          {change.deletions ? <span className="status-deletions">−{change.deletions}</span> : null}
          <span className={cn("git-change-status", `git-change-status-${change.status}`)}>
            {getChangeStatusLabel(change.status)}
          </span>
        </span>
      </button>
    </div>
  );
}

function PathIconImage({ icon }: { icon: ReturnType<typeof getPathIcon> }) {
  return <img alt="" aria-hidden="true" className="tree-row-icon" draggable={false} src={icon.src} />;
}

function GitCheckbox({ onToggle, state }: { onToggle: () => void; state: CheckState }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === "mix" ? "mixed" : state === "on"}
      className={cn("git-checkbox", state !== "off" && "git-checkbox-on")}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      {state === "on" ? <Check className="h-3 w-3" /> : state === "mix" ? <Minus className="h-3 w-3" /> : null}
    </button>
  );
}
