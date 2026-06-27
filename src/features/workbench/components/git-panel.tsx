import {
  ChevronDown,
  ChevronRight,
  EyeOff,
  FilePlus2,
  GitCommitVertical,
  GitFork,
  History,
  RefreshCw,
} from "lucide-react";
import { type ComponentType, type CSSProperties, type ReactNode, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { gitActions } from "../hooks/use-git";
import { useWorkbenchStore } from "../store/workbench-store";
import type { FolderView, GitChange, GitChangeStatus, GitError, GitPanelMode, GitWorkspaceState } from "../types";
import { GitBranchesPane } from "./git-branches-pane";
import { GitChangesTree } from "./git-changes-tree";
import { GitHistoryPane } from "./git-history";
import { GitIgnoredTree } from "./git-ignored-tree";

const PANEL_MODES: { key: GitPanelMode; icon: ComponentType<{ className?: string }>; label: string }[] = [
  { key: "commit", icon: GitCommitVertical, label: "提交" },
  { key: "branch", icon: GitFork, label: "分支" },
  { key: "history", icon: History, label: "历史" },
];

const RefreshButton = ({ busy }: { busy: boolean }) => (
  <Button
    size="toolbar"
    variant="ghost"
    className="git-toolbar-button"
    onClick={() => void gitActions.refresh()}
    disabled={busy}
  >
    <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} />
    刷新
  </Button>
);

export function GitPanel({
  folderView,
  gitWorkspace,
  onOpenCommitDiff,
  onOpenDiff,
  onOpenFile,
}: {
  folderView: FolderView | null;
  gitWorkspace: GitWorkspaceState;
  onOpenCommitDiff: (hash: string, file: string) => void;
  onOpenDiff: (file: string) => void;
  onOpenFile: (path: string, size?: number) => void;
}) {
  const mode = useWorkbenchStore((state) => state.gitPanelMode);
  const setMode = useWorkbenchStore((state) => state.setGitPanelMode);

  const count = PANEL_MODES.length;
  const index = Math.max(
    0,
    PANEL_MODES.findIndex((item) => item.key === mode),
  );
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
            <GitCommitMode
              folderView={folderView}
              gitWorkspace={gitWorkspace}
              onOpenDiff={onOpenDiff}
              onOpenFile={onOpenFile}
            />
          </div>
          <div className="git-panel-pane" style={{ height: paneHeight }} aria-hidden={mode !== "branch"}>
            <GitBranchMode />
          </div>
          <div className="git-panel-pane" style={{ height: paneHeight }} aria-hidden={mode !== "history"}>
            <GitHistoryMode onOpenCommitDiff={onOpenCommitDiff} />
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
  onOpenFile,
}: {
  folderView: FolderView | null;
  gitWorkspace: GitWorkspaceState;
  onOpenDiff: (file: string) => void;
  onOpenFile: (path: string, size?: number) => void;
}) {
  const gitStatus = useWorkbenchStore((state) => state.gitStatus);
  const gitBusy = useWorkbenchStore((state) => state.gitBusy);
  const gitError = useWorkbenchStore((state) => state.gitError);
  const changes = gitStatus?.changes ?? [];
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  // 记录被取消勾选的文件;新文件默认勾选(选中=不在该集合中),刷新无需重新同步。
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());

  const hasWorkspace = Boolean(folderView);
  const isNonRepository = gitWorkspace.kind === "ready" && !gitWorkspace.inspection.isRepository;
  const changeCount = changes.length;
  const hasChanges = changeCount > 0;
  // 已跟踪改动进主区;未跟踪(新文件)挪到底部单独分组(类似 IDEA)。提交集合仍含勾选的未跟踪文件。
  const tracked = changes.filter((change) => change.status !== "untracked");
  const untracked = changes.filter((change) => change.status === "untracked");
  const selectedFiles = changes.filter((change) => !unchecked.has(change.path)).map((change) => change.path);

  const togglePaths = (paths: string[], value: boolean) =>
    setUnchecked((prev) => {
      const next = new Set(prev);
      for (const path of paths) {
        if (value) {
          next.delete(path);
        } else {
          next.add(path);
        }
      }
      return next;
    });

  const treeProps = {
    isChecked: (path: string) => !unchecked.has(path),
    onAddIgnore: (entry: string) => void gitActions.addToGitignore(entry),
    onOpen: onOpenDiff,
    onSelect: setSelectedPath,
    onTogglePaths: togglePaths,
    selectedPath,
  };

  return (
    <RightTaskPanel
      toolbar={<RefreshButton busy={gitBusy} />}
      footer={isNonRepository ? null : <GitCommitBox disabled={!hasChanges} busy={gitBusy} files={selectedFiles} />}
    >
      <div className="git-panel-body">
        {gitError ? <GitErrorNotice error={gitError} /> : null}
        {isNonRepository ? (
          <GitWorkspaceNotice gitWorkspace={gitWorkspace} hasWorkspace={hasWorkspace} busy={gitBusy} />
        ) : hasChanges ? (
          <>
            {tracked.length > 0 ? <GitChangesTree changes={tracked} {...treeProps} /> : null}
            {untracked.length > 0 ? <GitUntrackedSection changes={untracked} {...treeProps} /> : null}
          </>
        ) : (
          <div className="git-panel-clean">
            <div className="git-panel-clean-title">工作区已干净</div>
            <div className="git-panel-clean-description">当前没有本地变更，可以放心切换分支。</div>
          </div>
        )}
        {!isNonRepository ? <GitIgnoredSection onOpenFile={onOpenFile} /> : null}
      </div>
    </RightTaskPanel>
  );
}

/** 底部「已忽略」区:被 .gitignore 忽略的条目;目录可展开看真实内容、文件可点击打开。默认收起。 */
function GitIgnoredSection({ onOpenFile }: { onOpenFile: (path: string, size?: number) => void }) {
  const rootPath = useWorkbenchStore((state) => state.folderView?.rootPath ?? null);
  const gitStatus = useWorkbenchStore((state) => state.gitStatus);
  const [items, setItems] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!rootPath) {
      setItems([]);
      return;
    }
    let alive = true;
    void gitActions.loadIgnored().then((result) => {
      if (alive) {
        setItems(result);
      }
    });
    return () => {
      alive = false;
    };
  }, [rootPath, gitStatus]);

  if (items.length === 0 || !rootPath) {
    return null;
  }

  return (
    <div className="git-ignored-section">
      <button type="button" className="git-ignored-head" onClick={() => setOpen((value) => !value)}>
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        <EyeOff className="h-3.5 w-3.5 shrink-0" />
        <span>已忽略</span>
        <span className="git-ignored-count">{items.length}</span>
      </button>
      {open ? <GitIgnoredTree entries={items} rootPath={rootPath} onOpenFile={onOpenFile} /> : null}
    </div>
  );
}

/** 未跟踪(新文件)分组:挪到底部,带勾选 / 双击 diff / 右键忽略;勾选的仍计入提交。 */
function GitUntrackedSection({
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
  const [open, setOpen] = useState(false);
  return (
    <div className="git-ignored-section">
      <button type="button" className="git-ignored-head" onClick={() => setOpen((value) => !value)}>
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        <FilePlus2 className="h-3.5 w-3.5 shrink-0" />
        <span>未跟踪</span>
        <span className="git-ignored-count">{changes.length}</span>
      </button>
      {open ? (
        <GitChangesTree
          changes={changes}
          isChecked={isChecked}
          onAddIgnore={onAddIgnore}
          onOpen={onOpen}
          onSelect={onSelect}
          onTogglePaths={onTogglePaths}
          selectedPath={selectedPath}
        />
      ) : null}
    </div>
  );
}

function GitBranchMode() {
  const gitBusy = useWorkbenchStore((state) => state.gitBusy);
  return (
    <RightTaskPanel toolbar={<RefreshButton busy={gitBusy} />}>
      <div className="git-panel-body git-panel-body-flush">
        <GitBranchesPane />
      </div>
    </RightTaskPanel>
  );
}

function GitHistoryMode({ onOpenCommitDiff }: { onOpenCommitDiff: (hash: string, file: string) => void }) {
  const gitBusy = useWorkbenchStore((state) => state.gitBusy);
  return (
    <RightTaskPanel toolbar={<RefreshButton busy={gitBusy} />} scroll={false}>
      <GitHistoryPane onOpenCommitDiff={onOpenCommitDiff} />
    </RightTaskPanel>
  );
}

export function GitCommitBox({ busy, disabled, files }: { busy: boolean; disabled: boolean; files: string[] }) {
  const [summary, setSummary] = useState("");
  const fileCount = files.length;
  const canCommit = !disabled && !busy && summary.trim().length > 0 && fileCount > 0;
  // amend 可不填摘要(保留上一条说明)。
  const canAmend = !disabled && !busy && fileCount > 0;

  const submit = async (push: boolean, amend: boolean) => {
    const ok = await gitActions.commit(summary.trim(), push, files, amend);
    if (ok) {
      setSummary("");
    }
  };

  return (
    <div className="git-commit-box">
      <Textarea
        className="git-commit-summary"
        placeholder="提交摘要"
        disabled={disabled || busy}
        value={summary}
        onChange={(event) => setSummary(event.target.value)}
      />
      <div className="git-commit-actions">
        <span className="git-commit-hint">
          {disabled ? "暂无可提交的变更" : fileCount > 0 ? `将提交 ${fileCount} 个文件` : "未勾选任何文件"}
        </span>
        <div className="git-commit-split">
          <Button
            className="git-action-button git-commit-split-main"
            size="sm"
            variant="ghost"
            disabled={!canCommit}
            onClick={() => void submit(false, false)}
          >
            提交
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className="git-action-button git-commit-split-caret"
                size="sm"
                variant="ghost"
                disabled={disabled || busy}
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={6}>
              <DropdownMenuItem disabled={!canCommit} onClick={() => void submit(true, false)}>
                提交并推送
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!canAmend} onClick={() => void submit(false, true)}>
                修订上一条提交（amend）
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
        className="git-action-button"
        size="sm"
        variant="ghost"
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
  eyebrow?: string;
  footer?: ReactNode;
  // 内容是否套外层滚动区。历史模式自管内部滚动(图谱滚动 + 详情固定),关掉外层。
  scroll?: boolean;
  title?: string;
  toolbar?: ReactNode;
}) {
  const showHeader = Boolean(eyebrow || title);
  return (
    <aside className="right-task-panel">
      {showHeader ? (
        <div className="right-task-panel-header">
          <div className="min-w-0">
            {eyebrow ? <div className="right-task-panel-eyebrow">{eyebrow}</div> : null}
            {title ? <div className="right-task-panel-title">{title}</div> : null}
          </div>
          {badge ? <div className="right-task-panel-badge">{badge}</div> : null}
        </div>
      ) : null}
      {toolbar || (!showHeader && badge) ? (
        <div className="right-task-panel-toolbar">
          {!showHeader && badge ? <div className="mr-auto">{badge}</div> : null}
          {toolbar}
        </div>
      ) : null}
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
