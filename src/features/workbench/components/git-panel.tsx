import { GitCommitVertical, GitFork, History, RefreshCw } from "lucide-react";
import { type ComponentType, type CSSProperties, type ReactNode, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { gitActions } from "../hooks/use-git";
import { useWorkbenchStore } from "../store/workbench-store";
import type { FolderView, GitChangeStatus, GitError, GitPanelMode, GitWorkspaceState } from "../types";
import { GitBranchesPane } from "./git-branches-pane";
import { GitChangesTree } from "./git-changes-tree";
import { GitHistoryPane } from "./git-history";

const PANEL_MODES: { key: GitPanelMode; icon: ComponentType<{ className?: string }>; label: string }[] = [
  { key: "commit", icon: GitCommitVertical, label: "提交" },
  { key: "branch", icon: GitFork, label: "分支" },
  { key: "history", icon: History, label: "历史" },
];

const RefreshButton = ({ busy }: { busy: boolean }) => (
  <Button size="toolbar" variant="ghost" onClick={() => void gitActions.refresh()} disabled={busy}>
    <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} />
    刷新
  </Button>
);

export function GitPanel({
  folderView,
  gitWorkspace,
  onOpenDiff,
}: {
  folderView: FolderView | null;
  gitWorkspace: GitWorkspaceState;
  onOpenDiff: (file: string) => void;
}) {
  const mode = useWorkbenchStore((state) => state.gitPanelMode);
  const setMode = useWorkbenchStore((state) => state.setGitPanelMode);

  const count = PANEL_MODES.length;
  const index = Math.max(0, PANEL_MODES.findIndex((item) => item.key === mode));
  const paneHeight = `${100 / count}%`;

  return (
    <div className="git-panel-shell">
      <div className="git-panel-stack">
        {/* N 个模式纵向堆叠,切换时整条 track 上下滑动 = 模式切换的「上下滚动」手感。 */}
        <div
          className="git-panel-track"
          style={{ height: `${count * 100}%`, transform: `translateY(-${(index * 100) / count}%)` } as CSSProperties}
        >
          <div className="git-panel-pane" style={{ height: paneHeight }} aria-hidden={mode !== "commit"}>
            <GitCommitMode folderView={folderView} gitWorkspace={gitWorkspace} onOpenDiff={onOpenDiff} />
          </div>
          <div className="git-panel-pane" style={{ height: paneHeight }} aria-hidden={mode !== "branch"}>
            <GitBranchMode />
          </div>
          <div className="git-panel-pane" style={{ height: paneHeight }} aria-hidden={mode !== "history"}>
            <GitHistoryMode />
          </div>
        </div>
      </div>
      <div className="git-panel-rail" role="tablist" aria-orientation="vertical">
        {PANEL_MODES.map((item) => (
          <RailTab
            key={item.key}
            icon={item.icon}
            label={item.label}
            active={mode === item.key}
            onClick={() => setMode(item.key)}
          />
        ))}
      </div>
    </div>
  );
}

function RailTab({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={cn("git-rail-tab", active && "git-rail-tab-active")}
      onClick={onClick}
    >
      <Icon className="h-4 w-4" />
      <span className="git-rail-tab-label">{label}</span>
    </button>
  );
}

function GitCommitMode({
  folderView,
  gitWorkspace,
  onOpenDiff,
}: {
  folderView: FolderView | null;
  gitWorkspace: GitWorkspaceState;
  onOpenDiff: (file: string) => void;
}) {
  const gitStatus = useWorkbenchStore((state) => state.gitStatus);
  const gitBusy = useWorkbenchStore((state) => state.gitBusy);
  const gitError = useWorkbenchStore((state) => state.gitError);
  const changes = gitStatus?.changes ?? [];
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const hasWorkspace = Boolean(folderView);
  const isNonRepository = gitWorkspace.kind === "ready" && !gitWorkspace.inspection.isRepository;
  const changeCount = changes.length;
  const hasChanges = changeCount > 0;

  return (
    <RightTaskPanel
      eyebrow="Git"
      title="变更"
      badge={<Badge tone={hasChanges ? "info" : "muted"}>{changeCount}</Badge>}
      toolbar={<RefreshButton busy={gitBusy} />}
      footer={isNonRepository ? null : <GitCommitBox disabled={!hasChanges} busy={gitBusy} changeCount={changeCount} />}
    >
      <div className="git-panel-body">
        {gitError ? <GitErrorNotice error={gitError} /> : null}
        {isNonRepository ? (
          <GitWorkspaceNotice gitWorkspace={gitWorkspace} hasWorkspace={hasWorkspace} busy={gitBusy} />
        ) : hasChanges ? (
          <GitChangesTree
            changes={changes}
            selectedPath={selectedPath}
            onSelect={setSelectedPath}
            onOpen={onOpenDiff}
          />
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

function GitBranchMode() {
  const gitBusy = useWorkbenchStore((state) => state.gitBusy);
  const branches = useWorkbenchStore((state) => state.gitBranches);
  const total = (branches?.local.length ?? 0) + (branches?.remote.length ?? 0);
  return (
    <RightTaskPanel
      eyebrow="Git"
      title="分支"
      badge={<Badge tone={total ? "info" : "muted"}>{total}</Badge>}
      toolbar={<RefreshButton busy={gitBusy} />}
    >
      <div className="git-panel-body git-panel-body-flush">
        <GitBranchesPane />
      </div>
    </RightTaskPanel>
  );
}

function GitHistoryMode() {
  const gitBusy = useWorkbenchStore((state) => state.gitBusy);
  return (
    <RightTaskPanel eyebrow="Git" title="历史" toolbar={<RefreshButton busy={gitBusy} />} scroll={false}>
      <GitHistoryPane />
    </RightTaskPanel>
  );
}

export function GitCommitBox({
  busy,
  changeCount,
  disabled,
}: {
  busy: boolean;
  changeCount: number;
  disabled: boolean;
}) {
  const [summary, setSummary] = useState("");
  const [body, setBody] = useState("");
  const canCommit = !disabled && !busy && summary.trim().length > 0;

  const submit = async (push: boolean) => {
    const message = body.trim() ? `${summary.trim()}\n\n${body.trim()}` : summary.trim();
    const ok = await gitActions.commit(message, push);
    if (ok) {
      setSummary("");
      setBody("");
    }
  };

  return (
    <div className="git-commit-box">
      <Input
        className="git-commit-summary"
        placeholder="提交摘要"
        disabled={disabled || busy}
        value={summary}
        onChange={(event) => setSummary(event.target.value)}
      />
      <Textarea
        className="git-commit-body"
        placeholder="详细说明（可选）"
        disabled={disabled || busy}
        value={body}
        onChange={(event) => setBody(event.target.value)}
      />
      <div className="git-commit-actions">
        <span className="git-commit-hint">{disabled ? "暂无可提交的变更" : `将提交 ${changeCount} 个文件`}</span>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="default" disabled={!canCommit} onClick={() => void submit(true)}>
            提交并推送
          </Button>
          <Button size="sm" variant="primary" disabled={!canCommit} onClick={() => void submit(false)}>
            提交
          </Button>
        </div>
      </div>
    </div>
  );
}

export function GitWorkspaceNotice({
  busy,
  gitWorkspace,
  hasWorkspace,
}: {
  busy: boolean;
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
      <Button
        size="sm"
        variant="default"
        disabled={!hasWorkspace || busy || gitWorkspace.kind === "loading"}
        onClick={() => void gitActions.initRepo()}
      >
        创建 Git 仓库
      </Button>
    </div>
  );
}

function GitErrorNotice({ error }: { error: GitError }) {
  return (
    <div className="git-error-notice">
      <div className="git-error-notice-title">操作未完成</div>
      <div className="git-error-notice-message">{getGitErrorHint(error)}</div>
    </div>
  );
}

function getGitErrorHint(error: GitError): string {
  switch (error.kind) {
    case "identity-missing":
      return '请先配置 Git 身份：git config --global user.name "你的名字" 与 user.email "邮箱"。';
    case "auth-failed":
      return "鉴权失败，请检查 Git 凭证或 SSH key 后重试。";
    case "no-upstream":
      return "当前分支没有上游分支，推送时已尝试 origin。";
    case "nothing-to-commit":
      return "没有可提交的改动。";
    case "conflict":
      return error.message ?? "存在冲突或未保存的改动，请先处理后再试。";
    case "git-not-found":
      return "未检测到 Git 命令，请先安装 Git。";
    default:
      return error.message ?? "操作失败，请重试。";
  }
}

export function RightTaskPanel({
  badge,
  children,
  eyebrow,
  footer,
  scroll = true,
  title,
  toolbar,
}: {
  badge?: ReactNode;
  children: ReactNode;
  eyebrow: string;
  footer?: ReactNode;
  // 内容是否套外层滚动区。历史模式自管内部滚动(图谱滚动 + 详情固定),关掉外层。
  scroll?: boolean;
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
      {scroll ? (
        <ScrollArea className="right-task-panel-content">{children}</ScrollArea>
      ) : (
        <div className="right-task-panel-content flex min-h-0 flex-col">{children}</div>
      )}
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
