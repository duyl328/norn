import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

import { buildFileTree, type FileTreeNode } from "../change-tree";
import { assignGraphColumns } from "../git-graph";
import { gitActions } from "../hooks/use-git";
import { useWorkbenchStore } from "../store/workbench-store";
import type { GitCommitFile, GitGraphCommit } from "../types";
import { getPathIcon } from "../workbench-utils";
import { getChangeStatusLabel } from "./git-panel";

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
    if (!ref || ref === "HEAD" || ref === "origin/HEAD") {
      continue;
    }
    if (ref.startsWith("HEAD -> ")) {
      out.push({ label: ref.slice(8), kind: "head" });
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
const ROW_H = 30;
const LANE_W = 14;
const PAD_X = 12;
const DOT_R = 4;

/**
 * 历史模式:上=分支拓扑图(地铁/IDEA 式正交圆角走线),下=选中提交的改动。
 * 直接集成在右侧面板,点一条提交,下方列出它的改动文件。
 */
export function GitHistoryPane({ onOpenCommitDiff }: { onOpenCommitDiff: (hash: string, file: string) => void }) {
  const [allCommits, setAllCommits] = useState<GitGraphCommit[]>([]);
  const [query, setQuery] = useState("");
  const [selectedHash, setSelectedHash] = useState("");
  const [files, setFiles] = useState<GitCommitFile[]>([]);
  // 三个模式同时挂载,本组件在仓库就绪前就会跑一次。依赖 rootPath/gitStatus,
  // 等仓库可用、或每次 git 刷新(提交/切换/拉取)后重新加载图谱。
  const rootPath = useWorkbenchStore((state) => state.folderView?.rootPath ?? null);
  const gitStatus = useWorkbenchStore((state) => state.gitStatus);

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

  return (
    <div className="git-graph-pane">
      <div className="git-branch-search">
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <input
          className="git-branch-search-input"
          placeholder="过滤提交…"
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
        />
        {filtered.length === 0 ? <div className="git-branch-empty">无提交记录</div> : null}
      </div>

      <CommitDetail commit={selected} files={files} onOpenCommitDiff={onOpenCommitDiff} />
    </div>
  );
}

function GitGraph({
  commits,
  drawEdges,
  onSelect,
  selectedHash,
}: {
  commits: GitGraphCommit[];
  drawEdges: boolean;
  onSelect: (hash: string) => void;
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
          <button
            type="button"
            key={commit.hash}
            className={cn("git-graph-row", commit.hash === selectedHash && "git-graph-row-selected")}
            style={{ height: ROW_H, paddingLeft: drawEdges ? graphWidth + 4 : PAD_X }}
            onClick={() => onSelect(commit.hash)}
            title={commit.subject}
          >
            {formatRefs(commit.refs).map((ref) => (
              <span key={`${ref.kind}:${ref.label}`} className={cn("git-ref-badge", `git-ref-badge-${ref.kind}`)}>
                {ref.label}
              </span>
            ))}
            <span className="git-graph-subject">{commit.subject}</span>
            <span className="git-graph-time">{commit.relativeTime}</span>
          </button>
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
  const tree = useMemo(() => buildFileTree(files), [files]);

  if (!commit) {
    return <div className="git-graph-detail git-graph-detail-empty">选择一条提交查看改动</div>;
  }

  return (
    <div className="git-graph-detail">
      <div className="git-graph-detail-subject">{commit.subject}</div>
      <div className="git-graph-detail-meta">
        {commit.author} · {commit.date} · {commit.hash}
      </div>
      {commit.body ? <div className="git-graph-detail-body">{commit.body}</div> : null}
      <div className="git-graph-detail-label">{commit.isMerge ? "合并提交" : `改动文件 (${files.length})`}</div>
      <div className="git-graph-detail-files">
        <CommitFileTree nodes={tree} depth={0} onOpen={(file) => onOpenCommitDiff(commit.hash, file)} />
        {files.length === 0 && !commit.isMerge ? <div className="git-branch-empty">无改动文件</div> : null}
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
  return (
    <>
      {nodes.map((node) => {
        if (node.kind === "folder") {
          return <CommitFileFolder key={`folder:${node.path}`} node={node} depth={depth} onOpen={onOpen} />;
        }
        const fileIcon = getPathIcon(node.item.path, "file");
        return (
          <button
            key={`file:${node.item.path}`}
            type="button"
            className="git-history-file git-history-file-clickable"
            style={{ paddingLeft: `${depth * 12 + 4}px` }}
            title={`${node.item.path}（点击查看该提交的改动）`}
            onClick={() => onOpen(node.item.path)}
          >
            <fileIcon.Icon className={cn("tree-row-icon", fileIcon.className)} />
            <span className="min-w-0 flex-1 truncate text-ui-md">{node.name}</span>
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
  const folderIcon = getPathIcon(node.name, "directory", open);
  return (
    <>
      <button
        type="button"
        className="git-branch-folder"
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        <folderIcon.Icon className={cn("tree-row-icon", folderIcon.className)} />
        <span className="truncate">{node.name}</span>
      </button>
      {open ? <CommitFileTree nodes={node.children} depth={depth + 1} onOpen={onOpen} /> : null}
    </>
  );
}
