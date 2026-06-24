import { GitBranch, GitCommitVertical, History, LayoutGrid, Search, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import {
  gitBranches,
  type GitBranchItem,
  gitChanges,
  gitChangeSummary,
  type GitCommitRef,
  type GitGraphCommit,
  gitGraphCommits,
} from "../mock-data";
import { getChangeStatusLabel } from "./git-panel";

type PreviewTab = "commit" | "branch" | "history";

/**
 * 临时预览入口:右下角浮动按钮 → 带 tab 的预览窗,
 * 用整页尺寸展示「提交页面 / 分支查看页面」的最终效果(假数据)。
 * 仅用于设计走查,后续可整体删除。
 */
export function GitPreview() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<PreviewTab>("commit");

  return (
    <>
      <button type="button" className="git-preview-trigger" onClick={() => setOpen(true)}>
        <LayoutGrid className="h-3.5 w-3.5" />
        Git 预览
      </button>

      {open ? (
        <div className="git-preview-overlay" onClick={() => setOpen(false)}>
          <div className="git-preview-window" onClick={(event) => event.stopPropagation()}>
            <div className="git-preview-header">
              <span className="git-preview-eyebrow">临时预览</span>
              <div className="git-preview-tabs">
                <button
                  type="button"
                  className={cn("git-preview-tab", tab === "commit" && "git-preview-tab-active")}
                  onClick={() => setTab("commit")}
                >
                  <GitCommitVertical className="h-3.5 w-3.5" />
                  提交页面
                </button>
                <button
                  type="button"
                  className={cn("git-preview-tab", tab === "branch" && "git-preview-tab-active")}
                  onClick={() => setTab("branch")}
                >
                  <GitBranch className="h-3.5 w-3.5" />
                  分支查看
                </button>
                <button
                  type="button"
                  className={cn("git-preview-tab", tab === "history" && "git-preview-tab-active")}
                  onClick={() => setTab("history")}
                >
                  <History className="h-3.5 w-3.5" />
                  提交历史
                </button>
              </div>
              <button type="button" className="git-preview-close" onClick={() => setOpen(false)} aria-label="关闭">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="git-preview-body">
              {tab === "commit" ? (
                <CommitPage />
              ) : tab === "branch" ? (
                <BranchPage onOpenHistory={() => setTab("history")} />
              ) : (
                <GitLogView />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

const diffSample: { text: string; type: "add" | "context" | "del" | "meta" }[] = [
  { type: "meta", text: "@@ -20,8 +20,7 @@ export function GitPanel({ gitWorkspace }) {" },
  { type: "context", text: "  const [selectedChangeId, setSelectedChangeId] = useState(null);" },
  { type: "del", text: "  const isRepository = Boolean(inspection?.isRepository);" },
  { type: "del", text: "  const hasChanges = isRepository && changeCount > 0;" },
  { type: "add", text: "  const isNonRepository = gitWorkspace.kind === 'ready' && !isRepo;" },
  { type: "add", text: "  const hasChanges = changeCount > 0;" },
  { type: "context", text: "" },
  { type: "context", text: "  return (" },
  { type: "context", text: "    <RightTaskPanel eyebrow=\"Git\" title=\"变更\">" },
];

function CommitPage() {
  const [selectedId, setSelectedId] = useState(gitChanges[0]?.id ?? null);
  const selected = gitChanges.find((change) => change.id === selectedId) ?? gitChanges[0];

  return (
    <div className="git-preview-commit">
      <section className="git-preview-pane git-preview-changes">
        <div className="git-preview-pane-title">
          变更
          <span className="git-preview-count">{gitChanges.length}</span>
        </div>
        <div className="git-preview-change-list">
          {gitChanges.map((change) => {
            const fileName = change.path.split("/").pop() ?? change.path;
            const dir = change.path.slice(0, change.path.length - fileName.length).replace(/\/$/, "");
            return (
              <button
                key={change.id}
                type="button"
                className={cn("git-preview-change-row", change.id === selectedId && "git-preview-change-row-selected")}
                onClick={() => setSelectedId(change.id)}
                title={change.path}
              >
                <span className={cn("git-change-status", `git-change-status-${change.status}`)}>
                  {getChangeStatusLabel(change.status)}
                </span>
                <span className="git-preview-change-name">
                  {fileName}
                  {dir ? <span className="git-file-dir">{dir}</span> : null}
                </span>
                <span className="git-preview-change-stat">
                  {change.additions ? <span className="status-additions">+{change.additions}</span> : null}
                  {change.deletions ? <span className="status-deletions">−{change.deletions}</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="git-preview-pane git-preview-diff-pane">
        <div className="git-preview-pane-title git-preview-diff-head">
          <span className="truncate font-mono">{selected?.path}</span>
          <span className="git-preview-diff-toggle">统一 · 并排</span>
        </div>
        <div className="git-preview-diff">
          {diffSample.map((line, index) => (
            <div key={index} className={cn("git-preview-diff-line", `git-preview-diff-${line.type}`)}>
              <span className="git-preview-diff-sign">
                {line.type === "add" ? "+" : line.type === "del" ? "−" : line.type === "meta" ? "" : " "}
              </span>
              <span className="git-preview-diff-text">{line.text || " "}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="git-preview-commit-bar">
        <div className="git-preview-commit-inputs">
          <Input className="h-8 text-ui" placeholder="提交摘要" defaultValue="feat(git): 重做变更与分支预览面板" />
          <Textarea className="min-h-[40px] resize-none text-ui" placeholder="详细说明（可选）" />
        </div>
        <div className="git-preview-commit-actions">
          <span className="git-commit-hint">
            将提交 {gitChangeSummary.files} 个文件 · <span className="status-additions">+{gitChangeSummary.additions}</span>{" "}
            <span className="status-deletions">−{gitChangeSummary.deletions}</span>
          </span>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="default">
              提交并推送
            </Button>
            <Button size="sm" variant="primary">
              提交
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

function BranchPage({ onOpenHistory }: { onOpenHistory: () => void }) {
  const localBranches = gitBranches.filter((branch) => branch.kind === "local");
  const remoteBranches = gitBranches.filter((branch) => branch.kind === "remote");
  const [selectedName, setSelectedName] = useState("feat/git-panel");
  const selected = gitBranches.find((branch) => branch.name === selectedName) ?? localBranches[0];

  return (
    <div className="git-preview-branch">
      <section className="git-preview-pane git-preview-branch-list">
        <div className="git-preview-pane-title">分支</div>
        <div className="git-preview-branch-group-label">本地分支</div>
        {localBranches.map((branch) => (
          <PreviewBranchRow
            key={branch.name}
            branch={branch}
            selected={branch.name === selectedName}
            onSelect={() => setSelectedName(branch.name)}
          />
        ))}

        <div className="git-preview-branch-group-label">远程分支</div>
        {remoteBranches.map((branch) => (
          <PreviewBranchRow
            key={branch.name}
            branch={branch}
            remote
            selected={branch.name === selectedName}
            onSelect={() => setSelectedName(branch.name)}
          />
        ))}
      </section>

      <section className="git-preview-pane git-preview-lineage-pane">
        <BranchDivergence branch={selected} onShowGraph={onOpenHistory} />
      </section>
    </div>
  );
}

function BranchDivergence({ branch, onShowGraph }: { branch: GitBranchItem; onShowGraph: () => void }) {
  return (
    <div className="git-diverge">
      <div className="git-diverge-head">
        <span className="git-diverge-branch">
          <GitBranch className="h-4 w-4 text-muted-foreground" />
          {branch.name}
          {branch.current ? <span className="git-preview-branch-current-tag">当前</span> : null}
        </span>
        {branch.upstream ? (
          <span className="git-diverge-chip">
            上游 {branch.upstream}
            <span className="git-branch-ahead">↑{branch.ahead ?? 0}</span>
            <span className="git-branch-behind">↓{branch.behind ?? 0}</span>
          </span>
        ) : (
          <span className="git-diverge-chip">无上游 · 仅本地</span>
        )}
        {branch.base ? (
          <span className="git-diverge-chip">
            ⑂ vs {branch.base}
            <span className="git-branch-ahead">领先 {branch.aheadOfBase ?? 0}</span>
            <span className="git-branch-behind">落后 {branch.behindBase ?? 0}</span>
          </span>
        ) : null}
      </div>

      <div className="git-diverge-body">
        <div className="git-diverge-section-label">{branch.base ? `领先 ${branch.base} 的提交` : "本分支最近提交"}</div>
        {(branch.ownCommits ?? []).map((commit) => (
          <CommitLine key={commit.hash} color={LANE_COLORS[1]} commit={commit} />
        ))}

        {branch.forkPoint ? (
          <div className="git-diverge-fork">
            从 {branch.base}@{branch.forkPoint.hash} · {branch.forkPoint.subject} 分出
          </div>
        ) : null}

        {branch.baseNewCommits && branch.baseNewCommits.length > 0 ? (
          <>
            <div className="git-diverge-section-label">
              {branch.base} 新增 · 你落后 {branch.behindBase ?? branch.baseNewCommits.length}
            </div>
            {branch.baseNewCommits.map((commit) => (
              <CommitLine key={commit.hash} color={LANE_COLORS[0]} commit={commit} muted />
            ))}
          </>
        ) : null}
      </div>

      <button type="button" className="git-diverge-graph-link" onClick={onShowGraph}>
        查看完整提交图 →
      </button>
    </div>
  );
}

function CommitLine({ color, commit, muted }: { color: string; commit: GitCommitRef; muted?: boolean }) {
  return (
    <div className={cn("git-diverge-row", muted && "opacity-70")}>
      <span className="git-diverge-rail" aria-hidden="true">
        <span className="git-diverge-dot" style={{ background: color }} />
        <span className="git-diverge-line" style={{ background: color }} />
      </span>
      <span className="git-diverge-main">
        <span className="git-diverge-subject">{commit.subject}</span>
        <span className="git-diverge-meta">
          {commit.hash} · {commit.relativeTime}
        </span>
      </span>
    </div>
  );
}

const LANE_COLORS = ["hsl(var(--primary))", "#10b981", "#f59e0b", "#a855f7"];
const ROW_H = 38;
const LANE_W = 18;
const PAD_X = 14;
const DOT_R = 5;

function GitLogView() {
  const commits = gitGraphCommits;
  const [selectedHash, setSelectedHash] = useState(commits[0]?.hash ?? "");
  const selected = commits.find((commit) => commit.hash === selectedHash) ?? commits[0];

  const position = new Map(commits.map((commit, index) => [commit.hash, { column: commit.column, index }]));
  const maxColumn = commits.reduce((max, commit) => Math.max(max, commit.column), 0);
  const graphWidth = PAD_X * 2 + maxColumn * LANE_W;
  const height = commits.length * ROW_H;
  const laneX = (column: number) => PAD_X + column * LANE_W;
  const rowY = (index: number) => ROW_H / 2 + index * ROW_H;
  const laneColor = (column: number) => LANE_COLORS[column % LANE_COLORS.length];

  const edges = commits.flatMap((commit, index) =>
    commit.parents.flatMap((parentHash) => {
      const parent = position.get(parentHash);
      if (!parent) {
        return [];
      }
      const x1 = laneX(commit.column);
      const y1 = rowY(index);
      const x2 = laneX(parent.column);
      const y2 = rowY(parent.index);
      const midY = (y1 + y2) / 2;
      const path =
        x1 === x2 ? `M${x1} ${y1} L${x2} ${y2}` : `M${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
      return [{ key: `${commit.hash}-${parentHash}`, path, color: laneColor(Math.max(commit.column, parent.column)) }];
    }),
  );

  return (
    <div className="git-log">
      <div className="git-log-toolbar">
        <span className="git-log-filter">分支：全部 ▾</span>
        <span className="git-log-filter">作者：全部 ▾</span>
        <span className="git-log-search">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input className="git-log-search-input" placeholder="过滤提交…" />
        </span>
      </div>

      <div className="git-log-main">
        <div className="git-log-table">
          <div className="git-log-head">
            <span style={{ width: graphWidth }} />
            <span className="flex-1">提交</span>
            <span className="git-log-col-author">作者</span>
            <span className="git-log-col-date">日期</span>
          </div>

          <div className="git-log-graph-inner" style={{ height }}>
            <svg className="git-log-svg" width={graphWidth} height={height} aria-hidden="true">
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
                  stroke={commit.isMerge ? laneColor(commit.column) : "hsl(var(--background))"}
                  strokeWidth={commit.isMerge ? 2.5 : 2}
                />
              ))}
            </svg>

            <div className="git-log-rows">
              {commits.map((commit) => (
                <button
                  type="button"
                  key={commit.hash}
                  className={cn("git-log-row", commit.hash === selectedHash && "git-log-row-selected")}
                  style={{ height: ROW_H }}
                  onClick={() => setSelectedHash(commit.hash)}
                >
                  <span className="git-log-subject">
                    {commit.refs?.map((ref) => (
                      <span
                        key={ref}
                        className={cn("git-ref-badge", ref.startsWith("origin/") && "git-ref-badge-remote")}
                      >
                        {ref}
                      </span>
                    ))}
                    <span className="git-log-subject-text">{commit.subject}</span>
                  </span>
                  <span className="git-log-col-author">{commit.author}</span>
                  <span className="git-log-col-date">{commit.date}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <aside className="git-log-details">{selected ? <CommitDetails commit={selected} /> : null}</aside>
      </div>
    </div>
  );
}

function CommitDetails({ commit }: { commit: GitGraphCommit }) {
  return (
    <>
      <div className="git-log-details-hash">{commit.hash}</div>
      <div className="git-log-details-subject">{commit.subject}</div>
      {commit.body ? <div className="git-log-details-body">{commit.body}</div> : null}
      <div className="git-log-details-meta">
        {commit.author} · {commit.date} · {commit.relativeTime}
      </div>
      {commit.refs && commit.refs.length > 0 ? (
        <div className="git-log-details-refs">
          {commit.refs.map((ref) => (
            <span key={ref} className={cn("git-ref-badge", ref.startsWith("origin/") && "git-ref-badge-remote")}>
              {ref}
            </span>
          ))}
        </div>
      ) : null}
      <div className="git-log-details-meta">
        父提交：{commit.parents.length ? commit.parents.join(", ") : "无（根提交）"}
      </div>

      <div className="git-log-details-label">
        {commit.isMerge ? "合并提交" : `改动文件 (${commit.files?.length ?? 0})`}
      </div>
      {commit.files && commit.files.length > 0 ? (
        commit.files.map((file) => {
          const fileName = file.path.split("/").pop() ?? file.path;
          const dir = file.path.slice(0, file.path.length - fileName.length).replace(/\/$/, "");
          return (
            <div className="git-log-details-file" key={file.path} title={file.path}>
              <span className={cn("git-change-status", `git-change-status-${file.status}`)}>
                {getChangeStatusLabel(file.status)}
              </span>
              <span className="git-file-name">
                {fileName}
                {dir ? <span className="git-file-dir">{dir}</span> : null}
              </span>
            </div>
          );
        })
      ) : commit.isMerge ? (
        <div className="git-log-details-meta">合并提交，合并两条分支历史。</div>
      ) : null}
    </>
  );
}

function PreviewBranchRow({
  branch,
  onSelect,
  remote,
  selected,
}: {
  branch: GitBranchItem;
  onSelect: () => void;
  remote?: boolean;
  selected?: boolean;
}) {
  const displayName = remote ? branch.name.replace(/^origin\//, "") : branch.name;

  return (
    <button
      type="button"
      className={cn(
        "git-preview-branch-row",
        selected && "git-preview-branch-row-selected",
        branch.current && "git-preview-branch-row-current",
      )}
      onClick={onSelect}
    >
      <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="git-preview-branch-name">
        {remote ? <span className="git-branch-remote-prefix">origin/</span> : null}
        {displayName}
        {branch.current ? <span className="git-preview-branch-current-tag">当前</span> : null}
      </span>
      {branch.lastCommit ? <span className="git-preview-branch-commit">{branch.lastCommit}</span> : null}
      {branch.ahead || branch.behind ? (
        <span className="git-branch-track">
          {branch.ahead ? <span className="git-branch-ahead">↑{branch.ahead}</span> : null}
          {branch.behind ? <span className="git-branch-behind">↓{branch.behind}</span> : null}
        </span>
      ) : null}
    </button>
  );
}
