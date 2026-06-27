import { ChevronDown, ChevronRight, Copy, GitBranchPlus, RotateCcw, Search, Undo2 } from "lucide-react";
import { type MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { buildFileTree, type FileTreeNode } from "../change-tree";
import { assignGraphColumns } from "../git-graph";
import { gitActions } from "../hooks/use-git";
import { useI18n } from "../i18n";
import { useWorkbenchStore } from "../store/workbench-store";
import type { GitCommitFile, GitGraphCommit } from "../types";
import { getPathDisplayIcon } from "../workbench-utils";
import { ContextMenu, type ContextMenuItem } from "./context-menu";
import { getChangeStatusLabel } from "./git-panel";
import { useRailRowInset } from "./use-rail-row-inset";

const copyToClipboard = (text: string) => void globalThis.navigator?.clipboard?.writeText(text);

// 历史模式里会被右上角竖排标签盖住的元素:搜索框(常驻顶部)+ 提交行 + 空态。
const HISTORY_ROW_SELECTOR = ".git-branch-search, .git-graph-row, .git-branch-empty";

const LANE_COLORS = ["hsl(var(--primary))", "#10b981", "#f59e0b", "#a855f7", "#ec4899", "#06b6d4"];

type RefBadge = { label: string; kind: "head" | "local" | "remote" | "tag" };

/**
 * 把 git decorate(%D)的原始 ref 串整理成徽章:
 * "HEAD -> main"=当前分支, "tag: v1"=标签, "origin/x"=远程, 其余=本地分支。
 * 过滤掉 HEAD / origin/HEAD 这类噪音。
 */
function formatRefs(refs: string[]): RefBadge[] {
  const out: RefBadge[] = [];
  for (const raw of refs) {
    const ref = raw.trim();
    if (!ref || ref === "origin/HEAD") {
      continue;
    }
    if (ref === "HEAD") {
      // 分离 HEAD(签出某条提交后):明确标出「当前就在这条」。
      out.push({ label: "HEAD", kind: "head" });
    } else if (ref.startsWith("HEAD -> ")) {
      // 在某分支上:HEAD 徽章 + 分支名,一眼看出当前提交和所在分支。
      out.push({ label: "HEAD", kind: "head" });
      out.push({ label: ref.slice(8), kind: "local" });
    } else if (ref.startsWith("tag: ")) {
      out.push({ label: ref.slice(5), kind: "tag" });
    } else if (ref.startsWith("origin/")) {
      out.push({ label: ref.slice(7), kind: "remote" });
    } else {
      out.push({ label: ref, kind: "local" });
    }
  }
  return out;
}

const REF_MAX = 2; // ref 超过此数折叠成角标,点击展开(IDEA 式)

/** 提交上的分支/标签:多了就只显示前几个 + 「+N」角标,点击展开全部。 */
function RefBadges({ refs }: { refs: RefBadge[] }) {
  const [open, setOpen] = useState(false);
  if (refs.length === 0) {
    return null;
  }
  const shown = open ? refs : refs.slice(0, REF_MAX);
  return (
    <>
      {shown.map((ref) => (
        <span key={`${ref.kind}:${ref.label}`} className={cn("git-ref-badge", `git-ref-badge-${ref.kind}`)}>
          {ref.label}
        </span>
      ))}
      {refs.length > REF_MAX ? (
        <button
          type="button"
          className="git-ref-more"
          title={open ? "收起" : refs.map((r) => r.label).join(", ")}
          onClick={(event) => {
            event.stopPropagation();
            setOpen((value) => !value);
          }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {open ? "−" : `+${refs.length - REF_MAX}`}
        </button>
      ) : null}
    </>
  );
}

const ROW_H = 30;
const LANE_W = 14;
const PAD_X = 12;
const DOT_R = 4;

/**
 * 历史模式:上=分支拓扑图(地铁/IDEA 式正交圆角走线),下=选中提交的改动。
 * 直接集成在右侧面板,点一条提交,下方列出它的改动文件。
 */
export function GitHistoryPane({ onOpenCommitDiff }: { onOpenCommitDiff: (hash: string, file: string) => void }) {
  const { t } = useI18n();
  const [allCommits, setAllCommits] = useState<GitGraphCommit[]>([]);
  const [query, setQuery] = useState("");
  const [selectedHash, setSelectedHash] = useState("");
  const [files, setFiles] = useState<GitCommitFile[]>([]);
  // 三个模式同时挂载,本组件在仓库就绪前就会跑一次。依赖 rootPath/gitStatus,
  // 等仓库可用、或每次 git 刷新(提交/切换/拉取)后重新加载图谱。
  const rootPath = useWorkbenchStore((state) => state.folderView?.rootPath ?? null);
  const gitStatus = useWorkbenchStore((state) => state.gitStatus);
  const paneRef = useRef<HTMLDivElement>(null);
  useRailRowInset(paneRef, HISTORY_ROW_SELECTOR);

  useEffect(() => {
    if (!rootPath) {
      setAllCommits([]);
      setSelectedHash("");
      return;
    }
    let alive = true;
    void gitActions.loadLog().then((raw) => {
      if (!alive) {
        return;
      }
      const graph = assignGraphColumns(raw);
      setAllCommits(graph);
      setSelectedHash((prev) => (graph.some((commit) => commit.hash === prev) ? prev : (graph[0]?.hash ?? "")));
    });
    return () => {
      alive = false;
    };
  }, [rootPath, gitStatus]);

  useEffect(() => {
    if (!selectedHash) {
      setFiles([]);
      return;
    }
    let alive = true;
    void gitActions.loadCommitFiles(selectedHash).then((result) => {
      if (alive) {
        setFiles(result);
      }
    });
    return () => {
      alive = false;
    };
  }, [selectedHash]);

  // 过滤会打乱图谱拓扑(父提交可能被滤掉),所以只在「无关键字」时画连线;有关键字时退化为列表。
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return allCommits;
    }
    return allCommits.filter(
      (commit) =>
        commit.subject.toLowerCase().includes(keyword) ||
        commit.hash.toLowerCase().includes(keyword) ||
        commit.author.toLowerCase().includes(keyword),
    );
  }, [allCommits, query]);

  const filtering = query.trim().length > 0;
  const selected = filtered.find((commit) => commit.hash === selectedHash) ?? null;

  const [menu, setMenu] = useState<{ x: number; y: number; commit: GitGraphCommit } | null>(null);
  // 硬重置会丢弃改动,window.confirm 在 WKWebView 是 no-op,改用应用内确认框。
  const [confirmHardReset, setConfirmHardReset] = useState<GitGraphCommit | null>(null);
  // 从某提交新建分支(把「分离 HEAD」固化成分支)。
  const [branchFrom, setBranchFrom] = useState<GitGraphCommit | null>(null);
  const [branchName, setBranchName] = useState("");
  const confirmCreateBranch = () => {
    const name = branchName.trim();
    if (!name || !branchFrom) return;
    void gitActions.createBranchAt(name, branchFrom.hash, t("git.toastBranchCreated", { name }));
    setBranchFrom(null);
    setBranchName("");
  };

  const menuItems = (commit: GitGraphCommit): ContextMenuItem[] => [
    { label: t("git.copyHash"), icon: <Copy className="h-3.5 w-3.5" />, onClick: () => copyToClipboard(commit.hash) },
    {
      label: t("git.copyShortHash"),
      icon: <Copy className="h-3.5 w-3.5" />,
      onClick: () => copyToClipboard(commit.hash.slice(0, 8)),
    },
    {
      label: t("git.checkoutCommit"),
      icon: <GitBranchPlus className="h-3.5 w-3.5" />,
      onClick: () => void gitActions.checkoutCommit(commit.hash, t("git.toastCheckedOut", { hash: commit.hash.slice(0, 7) })),
    },
    {
      label: t("git.newBranchFromCommit"),
      icon: <GitBranchPlus className="h-3.5 w-3.5" />,
      onClick: () => {
        setBranchName("");
        setBranchFrom(commit);
      },
    },
    {
      label: t("git.revertCommit"),
      icon: <Undo2 className="h-3.5 w-3.5" />,
      onClick: () => void gitActions.revertCommit(commit.hash, t("git.toastReverted", { hash: commit.hash.slice(0, 7) })),
    },
    {
      label: t("git.resetMixed"),
      icon: <RotateCcw className="h-3.5 w-3.5" />,
      onClick: () => void gitActions.resetTo(commit.hash, "mixed", t("git.toastResetMixed", { hash: commit.hash.slice(0, 7) })),
    },
    {
      label: t("git.resetHard"),
      icon: <RotateCcw className="h-3.5 w-3.5" />,
      danger: true,
      onClick: () => setConfirmHardReset(commit),
    },
  ];

  const onRowContextMenu = (event: ReactMouseEvent, commit: GitGraphCommit) => {
    event.preventDefault();
    setSelectedHash(commit.hash);
    setMenu({ x: event.clientX, y: event.clientY, commit });
  };

  return (
    <div className="git-graph-pane" ref={paneRef}>
      <div className="git-branch-search">
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <input
          className="git-branch-search-input"
          placeholder={t("git.filterCommits")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="git-graph-scroll">
        <GitGraph
          commits={filtered}
          drawEdges={!filtering}
          selectedHash={selectedHash}
          onSelect={setSelectedHash}
          onContextMenu={onRowContextMenu}
        />
        {filtered.length === 0 ? <div className="git-branch-empty">{t("git.noCommits")}</div> : null}
      </div>

      <CommitDetail commit={selected} files={files} onOpenCommitDiff={onOpenCommitDiff} />

      {menu ? (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.commit)} onClose={() => setMenu(null)} />
      ) : null}

      <Dialog open={confirmHardReset !== null} onOpenChange={(open) => (!open ? setConfirmHardReset(null) : undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("git.resetHardConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {confirmHardReset ? t("git.resetHardConfirmBody", { subject: confirmHardReset.subject }) : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmHardReset(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (confirmHardReset) {
                  void gitActions.resetTo(
                    confirmHardReset.hash,
                    "hard",
                    t("git.toastResetHard", { hash: confirmHardReset.hash.slice(0, 7) }),
                  );
                }
                setConfirmHardReset(null);
              }}
            >
              {t("git.resetHard")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={branchFrom !== null} onOpenChange={(open) => (!open ? setBranchFrom(null) : undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("git.newBranchFromCommit")}</DialogTitle>
            <DialogDescription>
              {branchFrom ? t("git.createBranchAtPrompt", { hash: branchFrom.hash.slice(0, 7) }) : ""}
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={branchName}
            onChange={(event) => setBranchName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") confirmCreateBranch();
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBranchFrom(null)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={confirmCreateBranch} disabled={!branchName.trim()}>
              {t("common.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GitGraph({
  commits,
  drawEdges,
  onSelect,
  onContextMenu,
  selectedHash,
}: {
  commits: GitGraphCommit[];
  drawEdges: boolean;
  onSelect: (hash: string) => void;
  onContextMenu: (event: ReactMouseEvent, commit: GitGraphCommit) => void;
  selectedHash: string;
}) {
  const position = new Map(commits.map((commit, index) => [commit.hash, { column: commit.column, index }]));
  const maxColumn = commits.reduce((max, commit) => Math.max(max, commit.column), 0);
  const graphWidth = PAD_X * 2 + maxColumn * LANE_W;
  const height = commits.length * ROW_H;

  const laneX = (column: number) => PAD_X + column * LANE_W;
  const rowY = (index: number) => ROW_H / 2 + index * ROW_H;
  const laneColor = (column: number) => LANE_COLORS[column % LANE_COLORS.length];

  // 地铁/IDEA 式正交走线:同列直上下;跨列时竖到拐点 → 圆角 → 水平进入目标列。
  const edges = drawEdges
    ? commits.flatMap((commit, index) =>
        commit.parents.flatMap((parentHash) => {
          const parent = position.get(parentHash);
          if (!parent) {
            return [];
          }
          const x1 = laneX(commit.column);
          const y1 = rowY(index);
          const x2 = laneX(parent.column);
          const y2 = rowY(parent.index);
          const color = laneColor(x1 === x2 ? commit.column : Math.max(commit.column, parent.column));
          let path: string;
          if (x1 === x2) {
            path = `M${x1} ${y1} V${y2}`;
          } else {
            // 地铁/IDEA 式:竖到两行中点 → 圆角 → 水平 → 圆角 → 竖到目标列。
            // 拐点放在两行中点(而非贴着父行),左右方向对称,弧度不再别扭。
            const dir = x2 > x1 ? 1 : -1;
            const my = (y1 + y2) / 2;
            const r = Math.min(LANE_W / 2, (y2 - y1) / 2);
            path = `M${x1} ${y1} V${my - r} Q${x1} ${my} ${x1 + dir * r} ${my} H${x2 - dir * r} Q${x2} ${my} ${x2} ${my + r} V${y2}`;
          }
          return [{ key: `${commit.hash}-${parentHash}`, path, color }];
        }),
      )
    : [];

  return (
    <div className="git-graph-inner" style={{ height }}>
      {drawEdges ? (
        <svg className="git-graph-svg" width={graphWidth} height={height} aria-hidden="true">
          {edges.map((edge) => (
            <path key={edge.key} d={edge.path} fill="none" stroke={edge.color} strokeWidth={1.75} />
          ))}
          {commits.map((commit, index) => (
            <circle
              key={commit.hash}
              cx={laneX(commit.column)}
              cy={rowY(index)}
              r={DOT_R}
              fill={commit.isMerge ? "hsl(var(--background))" : laneColor(commit.column)}
              stroke={laneColor(commit.column)}
              strokeWidth={commit.isMerge ? 2 : 1.5}
            />
          ))}
        </svg>
      ) : null}

      <div className="git-graph-rows">
        {commits.map((commit) => (
          <div
            role="button"
            tabIndex={0}
            key={commit.hash}
            className={cn("git-graph-row", commit.hash === selectedHash && "git-graph-row-selected")}
            style={{ height: ROW_H, paddingLeft: drawEdges ? graphWidth + 4 : PAD_X }}
            onClick={() => onSelect(commit.hash)}
            onContextMenu={(event) => onContextMenu(event, commit)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(commit.hash);
              }
            }}
            title={commit.subject}
          >
            <RefBadges refs={formatRefs(commit.refs)} />
            <span className="git-graph-subject">{commit.subject}</span>
            <span className="git-graph-time">{commit.relativeTime}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CommitDetail({
  commit,
  files,
  onOpenCommitDiff,
}: {
  commit: GitGraphCommit | null;
  files: GitCommitFile[];
  onOpenCommitDiff: (hash: string, file: string) => void;
}) {
  const { t } = useI18n();
  const tree = useMemo(() => buildFileTree(files), [files]);

  if (!commit) {
    return <div className="git-graph-detail git-graph-detail-empty">{t("git.selectCommit")}</div>;
  }

  return (
    <div className="git-graph-detail">
      <div className="git-graph-detail-subject">{commit.subject}</div>
      <div className="git-graph-detail-meta">
        {commit.author} · {commit.date} · {commit.hash}
      </div>
      {commit.body ? <div className="git-graph-detail-body">{commit.body}</div> : null}
      <div className="git-graph-detail-label">
        {commit.isMerge ? t("git.mergeCommit") : t("git.changedFiles", { count: files.length })}
      </div>
      <div className="git-graph-detail-files">
        <CommitFileTree nodes={tree} depth={0} onOpen={(file) => onOpenCommitDiff(commit.hash, file)} />
        {files.length === 0 && !commit.isMerge ? <div className="git-branch-empty">{t("git.noChangedFiles")}</div> : null}
      </div>
    </div>
  );
}

function CommitFileTree({
  depth,
  nodes,
  onOpen,
}: {
  depth: number;
  nodes: FileTreeNode<GitCommitFile>[];
  onOpen: (file: string) => void;
}) {
  const { t } = useI18n();

  return (
    <>
      {nodes.map((node) => {
        if (node.kind === "folder") {
          return <CommitFileFolder key={`folder:${node.path}`} node={node} depth={depth} onOpen={onOpen} />;
        }
        return (
          <button
            key={`file:${node.item.path}`}
            type="button"
            className="git-history-file git-history-file-clickable"
            style={{ paddingLeft: `${depth * 12 + 4}px` }}
            title={t("git.viewCommitDiffTitle", { path: node.item.path })}
            onClick={() => onOpen(node.item.path)}
          >
            <TreeIcon name={node.name} kind="file" />
            <span className="min-w-0 flex-1 truncate text-ui-md">{node.name}</span>
            <span className="git-tree-file-stat" aria-label={`+${node.item.additions} -${node.item.deletions}`}>
              <span className="status-additions">+{node.item.additions}</span>
              <span className="status-deletions">-{node.item.deletions}</span>
            </span>
            <span className={cn("git-change-status", `git-change-status-${node.item.status}`)}>
              {getChangeStatusLabel(node.item.status)}
            </span>
          </button>
        );
      })}
    </>
  );
}

function CommitFileFolder({
  depth,
  node,
  onOpen,
}: {
  depth: number;
  node: Extract<FileTreeNode<GitCommitFile>, { kind: "folder" }>;
  onOpen: (file: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button
        type="button"
        className="git-branch-folder"
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        <TreeIcon name={node.name} kind="directory" expanded={open} />
        <span className="truncate">{node.name}</span>
      </button>
      {open ? <CommitFileTree nodes={node.children} depth={depth + 1} onOpen={onOpen} /> : null}
    </>
  );
}

function TreeIcon({ expanded, kind, name }: { expanded?: boolean; kind: "file" | "directory"; name: string }) {
  const { Icon, className } = getPathDisplayIcon(name, kind, expanded);
  return <Icon className={cn("tree-row-icon shrink-0", className)} />;
}
