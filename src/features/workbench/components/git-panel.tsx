import { RefreshCw } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { type GitChangeItem, gitChanges, type GitChangeStatus, gitChangeSummary } from "../mock-data";
import type { FolderView, GitWorkspaceState } from "../types";

export function GitPanel({
  folderView,
  gitWorkspace,
}: {
  folderView: FolderView | null;
  gitWorkspace: GitWorkspaceState;
}) {
  const [selectedChangeId, setSelectedChangeId] = useState<string | null>(gitChanges[0]?.id ?? null);
  const hasWorkspace = Boolean(folderView);
  // Mock 阶段:仅当明确检测到「已打开、但不是 Git 仓库」时才显示提示;
  // 其余情况(包括浏览器预览的 idle 状态)直接渲染最终效果的假数据。
  const isNonRepository = gitWorkspace.kind === "ready" && !gitWorkspace.inspection.isRepository;
  const changeCount = gitChanges.length;
  const hasChanges = changeCount > 0;

  return (
    <RightTaskPanel
      eyebrow="Git"
      title="变更"
      badge={<Badge tone={hasChanges ? "info" : "muted"}>{changeCount}</Badge>}
      toolbar={
        <Button size="toolbar" variant="ghost">
          <RefreshCw className="h-3.5 w-3.5" />
          刷新
        </Button>
      }
      footer={isNonRepository ? null : <GitCommitBox disabled={!hasChanges} />}
    >
      <div className="git-panel-body">
        {isNonRepository ? (
          <GitWorkspaceNotice gitWorkspace={gitWorkspace} hasWorkspace={hasWorkspace} />
        ) : hasChanges ? (
          <div className="git-file-list">
            {gitChanges.map((change) => (
              <GitFileRow
                key={change.id}
                change={change}
                selected={change.id === selectedChangeId}
                onSelect={() => setSelectedChangeId(change.id)}
              />
            ))}
          </div>
        ) : (
          <div className="git-panel-clean">
            <div className="git-panel-clean-title">工作区已干净</div>
            <div className="git-panel-clean-description">当前没有本地变更，可以放心切换分支。</div>
          </div>
        )}
      </div>
    </RightTaskPanel>
  );
}

export function GitFileRow({
  change,
  onSelect,
  selected,
}: {
  change: GitChangeItem;
  onSelect: () => void;
  selected: boolean;
}) {
  const fileName = change.path.split("/").pop() ?? change.path;
  const directory = change.path.slice(0, change.path.length - fileName.length);

  return (
    <button
      className={cn("git-file-row", selected && "git-file-row-selected")}
      type="button"
      onClick={onSelect}
      title={change.path}
    >
      <span className={cn("git-change-status", `git-change-status-${change.status}`)}>
        {getChangeStatusLabel(change.status)}
      </span>
      <span className="git-file-name">
        {fileName}
        {directory ? <span className="git-file-dir">{directory.replace(/\/$/, "")}</span> : null}
      </span>
    </button>
  );
}

export function GitCommitBox({ disabled }: { disabled: boolean }) {
  return (
    <div className="git-commit-box">
      <Input className="git-commit-summary" placeholder="提交摘要" disabled={disabled} />
      <Textarea className="git-commit-body" placeholder="详细说明（可选）" disabled={disabled} />
      <div className="git-commit-actions">
        <span className="git-commit-hint">
          {disabled ? "暂无可提交的变更" : `将提交 ${gitChangeSummary.files} 个文件`}
        </span>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="default" disabled={disabled}>
            提交并推送
          </Button>
          <Button size="sm" variant="primary" disabled={disabled}>
            提交
          </Button>
        </div>
      </div>
    </div>
  );
}

export function GitWorkspaceNotice({
  gitWorkspace,
  hasWorkspace,
}: {
  gitWorkspace: GitWorkspaceState;
  hasWorkspace: boolean;
}) {
  const title =
    gitWorkspace.kind === "loading"
      ? "正在检测 Git 状态"
      : !hasWorkspace
        ? "尚未打开工作区"
        : gitWorkspace.kind === "error"
          ? "无法检测 Git 状态"
          : "当前文件夹不是 Git 仓库";
  const description =
    gitWorkspace.kind === "loading"
      ? "正在读取 Git 命令和当前文件夹状态。"
      : !hasWorkspace
        ? "请先从左侧打开一个文件夹，然后再查看 Git 变更。"
        : gitWorkspace.kind === "ready"
          ? gitWorkspace.inspection.message
          : gitWorkspace.kind === "error"
            ? gitWorkspace.message
            : "打开文件夹后即可检测 Git 仓库。";

  return (
    <div className="git-workspace-notice">
      <div className="git-workspace-notice-title">{title}</div>
      <div className="git-workspace-notice-description">{description}</div>
      <Button size="sm" variant="default" disabled={!hasWorkspace || gitWorkspace.kind === "loading"}>
        创建 Git 仓库
      </Button>
    </div>
  );
}

export function RightTaskPanel({
  badge,
  children,
  eyebrow,
  footer,
  title,
  toolbar,
}: {
  badge?: ReactNode;
  children: ReactNode;
  eyebrow: string;
  footer?: ReactNode;
  title: string;
  toolbar?: ReactNode;
}) {
  return (
    <aside className="right-task-panel">
      <div className="right-task-panel-header">
        <div className="min-w-0">
          <div className="right-task-panel-eyebrow">{eyebrow}</div>
          <div className="right-task-panel-title">{title}</div>
        </div>
        {badge ? <div className="right-task-panel-badge">{badge}</div> : null}
      </div>
      {toolbar ? <div className="right-task-panel-toolbar">{toolbar}</div> : null}
      <ScrollArea className="right-task-panel-content">{children}</ScrollArea>
      {footer ? <div className="right-task-panel-footer">{footer}</div> : null}
    </aside>
  );
}

export function getChangeStatusLabel(status: GitChangeStatus) {
  const labels: Record<GitChangeStatus, string> = {
    added: "A",
    conflict: "!",
    deleted: "D",
    modified: "M",
    renamed: "R",
    untracked: "?",
  };

  return labels[status];
}
