import { GitBranch } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import {
  type GitChangeItem,
  type GitChangeSection,
  gitChangeSections,
  type GitChangeStatus,
  gitRepositoryMock,
} from "../mock-data";
import type { FolderView, GitWorkspaceState } from "../types";

export function GitPanel({
  folderView,
  gitWorkspace,
}: {
  folderView: FolderView | null;
  gitWorkspace: GitWorkspaceState;
}) {
  const firstChangeId = gitChangeSections.flatMap((section) => section.items)[0]?.id ?? null;
  const [selectedChangeId, setSelectedChangeId] = useState<string | null>(firstChangeId);
  const inspection = gitWorkspace.kind === "ready" ? gitWorkspace.inspection : null;
  const hasWorkspace = Boolean(folderView);
  const isRepository = Boolean(inspection?.isRepository);
  const hasStagedChanges = isRepository && gitRepositoryMock.stagedCount > 0;
  const branchLabel = inspection?.branch ?? gitRepositoryMock.branch;
  const workspaceName = folderView?.rootName ?? "未打开工作区";
  const workspacePath = folderView?.rootPath ?? "";
  const badgeLabel =
    gitWorkspace.kind === "loading"
      ? "检测中"
      : isRepository
        ? gitRepositoryMock.remoteState
        : hasWorkspace
          ? "未初始化"
          : "未打开";

  return (
    <RightTaskPanel
      eyebrow="Git"
      title="变更"
      badge={<Badge tone={isRepository ? "warning" : "muted"}>{badgeLabel}</Badge>}
      toolbar={
        <>
          <Button size="sm" variant="ghost">
            刷新
          </Button>
          <Button size="sm" variant="ghost">
            更多
          </Button>
        </>
      }
      footer={<GitCommitBox disabled={!hasStagedChanges} />}
    >
      <div className="git-panel-body">
        <div className="git-repository-card">
          <div className="git-repository-main">
            <span className="git-repository-icon">
              <GitBranch className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="git-repository-name">{workspaceName}</div>
              <div className="git-repository-meta">{getGitWorkspaceDescription(gitWorkspace, workspacePath)}</div>
            </div>
          </div>
          <Button size="sm" variant="ghost" disabled={!hasWorkspace || isRepository}>
            创建仓库
          </Button>
        </div>

        {isRepository ? (
          <>
            <div className="git-summary-grid">
              <Summary label="工作区" value={String(gitRepositoryMock.workingCount)} />
              <Summary label="已暂存" value={String(gitRepositoryMock.stagedCount)} />
              <Summary label="未跟踪" value={String(gitRepositoryMock.untrackedCount)} />
            </div>

            <div className="git-state-preview-grid" aria-label="Git 面板状态预览">
              <div className="git-state-preview">
                <div className="git-state-preview-title">当前分支</div>
                <div className="git-state-preview-description">
                  {branchLabel} - {gitRepositoryMock.remoteHint}
                </div>
              </div>
            </div>

            {gitChangeSections.map((section) => (
              <GitChangeSectionView
                key={section.id}
                section={section}
                selectedChangeId={selectedChangeId}
                onSelectChange={setSelectedChangeId}
              />
            ))}
          </>
        ) : (
          <GitWorkspaceNotice gitWorkspace={gitWorkspace} hasWorkspace={hasWorkspace} />
        )}
      </div>
    </RightTaskPanel>
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

export function getGitWorkspaceDescription(gitWorkspace: GitWorkspaceState, workspacePath: string) {
  if (gitWorkspace.kind === "loading") {
    return "正在检测 Git 命令与仓库状态";
  }

  if (gitWorkspace.kind === "ready") {
    if (gitWorkspace.inspection.isRepository) {
      return `${gitWorkspace.inspection.branch ?? "未命名分支"} - ${gitWorkspace.inspection.gitRoot ?? workspacePath}`;
    }

    return gitWorkspace.inspection.message;
  }

  if (gitWorkspace.kind === "error") {
    return gitWorkspace.message;
  }

  return "请先从左侧打开文件夹";
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

export function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="git-summary-tile">
      <div className="git-summary-label">{label}</div>
      <div className="git-summary-value">{value}</div>
    </div>
  );
}

export function GitChangeSectionView({
  onSelectChange,
  section,
  selectedChangeId,
}: {
  onSelectChange: (id: string) => void;
  section: GitChangeSection;
  selectedChangeId: string | null;
}) {
  return (
    <section className={cn("git-panel-section", section.tone && `git-panel-section-${section.tone}`)}>
      <div className="git-panel-section-heading">
        <div className="git-panel-section-title">
          <span>{section.title}</span>
          <Badge tone={getSectionBadgeTone(section)}>{section.count}</Badge>
        </div>
        {section.actionLabel ? (
          <Button size="sm" variant="ghost" disabled={section.items.length === 0}>
            {section.actionLabel}
          </Button>
        ) : null}
      </div>
      <div className="git-change-list">
        {section.items.length > 0 ? (
          section.items.map((change) => (
            <GitChangeRow
              key={change.id}
              change={change}
              selected={change.id === selectedChangeId}
              staged={section.id === "staged"}
              onSelect={() => onSelectChange(change.id)}
            />
          ))
        ) : (
          <div className="git-panel-section-empty">{section.emptyLabel}</div>
        )}
      </div>
    </section>
  );
}

export function GitChangeRow({
  change,
  onSelect,
  selected,
  staged,
}: {
  change: GitChangeItem;
  onSelect: () => void;
  selected: boolean;
  staged: boolean;
}) {
  return (
    <button className={cn("git-change-row", selected && "git-change-row-selected")} type="button" onClick={onSelect}>
      <span className={cn("git-change-status", `git-change-status-${change.status}`)}>
        {getChangeStatusLabel(change.status)}
      </span>
      <span className="git-change-main">
        <span className="git-change-path" title={change.path}>
          {change.path}
        </span>
        <span className="git-change-description">
          {change.description}
          {change.previousPath ? `，来自 ${change.previousPath}` : ""}
        </span>
      </span>
      <span className="git-change-diff" aria-label={`新增 ${change.additions} 行，删除 ${change.deletions} 行`}>
        <span className="git-change-additions">+{change.additions}</span>
        <span className="git-change-deletions">-{change.deletions}</span>
      </span>
      <span className="git-change-action" aria-hidden="true">
        {staged ? "取消" : "暂存"}
      </span>
    </button>
  );
}

export function GitCommitBox({ disabled }: { disabled: boolean }) {
  return (
    <div className="git-commit-box">
      <Input className="git-commit-summary" placeholder="提交摘要" disabled={disabled} />
      <Textarea className="git-commit-body" placeholder="提交说明" disabled={disabled} />
      <div className="git-commit-actions">
        <span className="git-commit-hint">{disabled ? "请先暂存文件再提交。" : "将提交 2 个已暂存文件。"}</span>
        <Button size="sm" variant="primary" disabled={disabled}>
          提交已暂存
        </Button>
      </div>
    </div>
  );
}

export function getSectionBadgeTone(section: GitChangeSection): "default" | "success" | "warning" | "info" | "muted" {
  if (section.tone === "success") {
    return "success";
  }

  if (section.tone === "warning") {
    return "warning";
  }

  if (section.tone === "danger") {
    return "warning";
  }

  return section.count > 0 ? "info" : "muted";
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
