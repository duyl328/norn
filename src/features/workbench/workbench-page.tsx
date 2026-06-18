import { useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Code2,
  Columns3,
  Command,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  History,
  PanelLeftClose,
  PanelRightClose,
  Search,
  Settings,
  SplitSquareHorizontal,
  Terminal,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
} from "@/components/ui/menubar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { changes, editorLines, treeNodes } from "./mock-data";

export function WorkbenchPage() {
  const [dark, setDark] = useState(false);
  const [gitOpen, setGitOpen] = useState(true);

  return (
    <TooltipProvider delayDuration={250}>
      <div className={cn("h-full bg-background text-[12px] text-foreground", dark && "dark")}>
        <div className="flex h-full min-w-0 flex-col">
          <TitleBar dark={dark} onToggleTheme={() => setDark((value) => !value)} />
          <MainMenu />
          <Toolbar onToggleGit={() => setGitOpen((value) => !value)} gitOpen={gitOpen} />
          <main
            className={cn(
              "grid min-h-0 flex-1 grid-cols-[260px_1px_minmax(0,1fr)_24px_360px] bg-background transition-[grid-template-columns]",
              !gitOpen && "grid-cols-[260px_1px_minmax(0,1fr)_24px_0px]",
            )}
          >
            <ProjectPanel />
            <div className="bg-border" />
            <EditorMock />
            <GitRail open={gitOpen} onToggle={() => setGitOpen((value) => !value)} />
            <GitPanel open={gitOpen} />
          </main>
          <StatusBar />
        </div>
      </div>
    </TooltipProvider>
  );
}

function TitleBar({ dark, onToggleTheme }: { dark: boolean; onToggleTheme: () => void }) {
  return (
    <header className="flex h-8 shrink-0 items-center justify-between border-b border-border bg-muted/70 px-2">
      <div className="flex min-w-0 items-center gap-2">
        <Code2 className="h-4 w-4 text-primary" />
        <strong className="text-[12px]">Norn</strong>
        <span className="truncate text-[12px] text-muted-foreground">norn · main · 工作区有 4 个变更</span>
      </div>
      <div className="flex items-center gap-2">
        <Badge tone="success">Git CLI 已连接</Badge>
        <Button variant="ghost" size="sm" onClick={onToggleTheme}>
          {dark ? "浅色" : "深色"}
        </Button>
      </div>
    </header>
  );
}

function MainMenu() {
  return (
    <Menubar>
      <MenubarMenu>
        <MenubarTrigger>文件</MenubarTrigger>
        <MenubarContent>
          <MenubarItem>
            打开文件夹
            <MenubarShortcut>Ctrl+Shift+O</MenubarShortcut>
          </MenubarItem>
          <MenubarItem>
            保存
            <MenubarShortcut>Ctrl+S</MenubarShortcut>
          </MenubarItem>
          <MenubarItem>
            保存全部
            <MenubarShortcut>Ctrl+Alt+S</MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem>最近项目</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>编辑</MenubarTrigger>
        <MenubarContent>
          <MenubarItem>
            查找
            <MenubarShortcut>Ctrl+F</MenubarShortcut>
          </MenubarItem>
          <MenubarItem>
            替换
            <MenubarShortcut>Ctrl+R</MenubarShortcut>
          </MenubarItem>
          <MenubarItem>
            搜索所有位置
            <MenubarShortcut>Double Shift</MenubarShortcut>
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>Git</MenubarTrigger>
        <MenubarContent>
          <MenubarItem>
            Commit
            <MenubarShortcut>Ctrl+K</MenubarShortcut>
          </MenubarItem>
          <MenubarItem>Pull</MenubarItem>
          <MenubarItem>Push</MenubarItem>
          <MenubarSeparator />
          <MenubarItem>Show Diff</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>视图</MenubarTrigger>
        <MenubarContent>
          <MenubarItem>文件树</MenubarItem>
          <MenubarItem>Git 工作区</MenubarItem>
          <MenubarItem>终端</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  );
}

function Toolbar({ gitOpen, onToggleGit }: { gitOpen: boolean; onToggleGit: () => void }) {
  return (
    <div className="tool-row justify-between gap-2">
      <div className="flex min-w-0 items-center gap-1.5">
        <Button size="toolbar" variant="default">
          <GitBranch className="h-3.5 w-3.5" />
          main
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
        <Separator orientation="vertical" className="mx-1 h-5" />
        <div className="relative w-[min(42vw,420px)]">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-7 pl-7 font-mono" placeholder="输入文件名，例如 status.ts" />
        </div>
        <Badge tone="muted">Double Shift</Badge>
      </div>
      <div className="flex items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon" variant="ghost">
              <SplitSquareHorizontal className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>拆分编辑器</TooltipContent>
        </Tooltip>
        <Button size="toolbar" variant="default">
          <Columns3 className="h-3.5 w-3.5" />
          查看 Diff
        </Button>
        <Button size="toolbar" variant="primary">
          <GitCommitHorizontal className="h-3.5 w-3.5" />
          提交
        </Button>
        <Button size="icon" variant={gitOpen ? "subtle" : "ghost"} onClick={onToggleGit}>
          <PanelRightClose className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function ProjectPanel() {
  const nodes = useMemo(() => treeNodes, []);

  return (
    <aside className="flex min-w-0 flex-col border-r border-border bg-card/70">
      <div className="panel-heading">
        <div className="flex items-center gap-1.5 font-semibold">
          <PanelLeftClose className="h-3.5 w-3.5 text-muted-foreground" />
          项目
        </div>
        <Badge tone="muted">norn</Badge>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-0.5 p-1.5">
          {nodes.map((node) => {
            const Icon = node.icon;
            return (
              <button
                className={cn(
                  "tree-row w-full text-left",
                  node.active && "tree-row-active",
                  node.muted && "tree-row-muted",
                )}
                key={`${node.name}-${node.depth ?? 0}`}
                type="button"
              >
                <span style={{ paddingLeft: `${(node.depth ?? 0) * 12}px` }} className="flex items-center">
                  {(node.depth ?? 0) < 2 ? <ChevronDown className="h-3 w-3" /> : null}
                </span>
                <span className="flex min-w-0 items-center gap-1.5">
                  <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{node.name}</span>
                </span>
                <span className="justify-self-end font-mono text-[11px] text-muted-foreground">{node.status}</span>
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </aside>
  );
}

function EditorMock() {
  return (
    <section className="flex min-w-0 flex-col bg-[hsl(var(--editor-background))]">
      <Tabs value="workbench" className="min-w-0">
        <TabsList className="flex w-full justify-start border-b border-border bg-muted/70">
          <TabsTrigger value="workbench">workbench-page.tsx</TabsTrigger>
          <TabsTrigger value="requirements">需求文档.md</TabsTrigger>
          <TabsTrigger value="tauri">lib.rs</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="flex h-8 items-center justify-between border-b border-border bg-background/70 px-2">
        <div className="flex min-w-0 items-center gap-2">
          <Badge tone="info">CodeMirror 6 mock</Badge>
          <span className="truncate text-muted-foreground">src/features/workbench/workbench-page.tsx</span>
        </div>
        <div className="flex items-center gap-1">
          <Button size="toolbar" variant="ghost">
            <History className="h-3.5 w-3.5" />
            最近文件
          </Button>
          <Button size="toolbar" variant="ghost">
            <Command className="h-3.5 w-3.5" />
            Action
          </Button>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="min-h-full py-3">
          {editorLines.map((line, index) => (
            <div className={cn("editor-line", index === 5 && "bg-accent/45")} key={`${line}-${index}`}>
              <span className="select-none border-r border-border bg-[hsl(var(--editor-gutter))] pr-3 text-right text-muted-foreground">
                {index + 1}
              </span>
              <code className="whitespace-pre px-3 text-foreground">
                <CodeLine line={line} />
              </code>
            </div>
          ))}
        </div>
      </ScrollArea>
    </section>
  );
}

function CodeLine({ line }: { line: string }) {
  if (!line) return <span>&nbsp;</span>;

  const highlighted = line
    .replaceAll("import", "<kw>import</kw>")
    .replaceAll("export", "<kw>export</kw>")
    .replaceAll("function", "<kw>function</kw>")
    .replaceAll("return", "<kw>return</kw>")
    .replaceAll("from", "<kw>from</kw>")
    .replaceAll("WorkbenchShell", "<type>WorkbenchShell</type>")
    .replaceAll("EditorSurface", "<type>EditorSurface</type>")
    .replaceAll("GitPanel", "<type>GitPanel</type>");

  const parts = highlighted.split(/(<kw>|<\/kw>|<type>|<\/type>)/g);
  let mode: "normal" | "kw" | "type" = "normal";

  return (
    <>
      {parts.map((part, index) => {
        if (part === "<kw>") {
          mode = "kw";
          return null;
        }
        if (part === "</kw>") {
          mode = "normal";
          return null;
        }
        if (part === "<type>") {
          mode = "type";
          return null;
        }
        if (part === "</type>") {
          mode = "normal";
          return null;
        }
        return (
          <span
            className={cn(
              mode === "kw" && "text-sky-700 dark:text-sky-300",
              mode === "type" && "text-violet-700 dark:text-violet-300",
              part.includes('"') && "text-emerald-700 dark:text-emerald-300",
            )}
            key={`${part}-${index}`}
          >
            {part}
          </span>
        );
      })}
    </>
  );
}

function GitRail({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div className="flex min-w-0 flex-col items-center border-l border-r border-border bg-muted/50 py-2">
      <div className="grid gap-1">
        <span className="h-5 w-1 rounded-full bg-sky-500/70" />
        <span className="h-5 w-1 rounded-full bg-emerald-500/70" />
        <span className="h-5 w-1 rounded-full bg-amber-500/80" />
      </div>
      <Button className="mt-3 h-8 w-[18px] p-0" size="icon" variant="ghost" onClick={onToggle}>
        <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", !open && "-rotate-180")} />
      </Button>
      <Badge className="mt-2 px-1" tone="info">
        4
      </Badge>
    </div>
  );
}

function GitPanel({ open }: { open: boolean }) {
  return (
    <aside className={cn("min-w-0 overflow-hidden border-l border-border bg-card transition-opacity", !open && "opacity-0")}>
      <div className="flex h-full w-[360px] flex-col">
        <div className="panel-heading">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Git 工作区</div>
            <div className="font-semibold">变更队列</div>
          </div>
          <Badge tone="warning">ahead 1</Badge>
        </div>
        <div className="grid grid-cols-3 gap-1 border-b border-border p-2">
          <Summary label="工作区" value="4" />
          <Summary label="已暂存" value="1" />
          <Summary label="远端" value="+1" />
        </div>
        <div className="border-b border-border p-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <GitBranch className="h-4 w-4 text-primary" />
              <div className="min-w-0">
                <div className="truncate font-medium">main</div>
                <div className="truncate text-[11px] text-muted-foreground">origin/main · 可推送 1 个提交</div>
              </div>
            </div>
            <Button size="sm" variant="ghost">
              切换
            </Button>
          </div>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-1 p-2">
            {changes.map((change) => (
              <div
                className="grid grid-cols-[20px_minmax(0,1fr)_52px] items-center gap-2 rounded-sm border border-border bg-background/65 p-2"
                key={change.path}
              >
                {change.staged ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                ) : (
                  <CircleDot className="h-4 w-4 text-muted-foreground" />
                )}
                <div className="min-w-0">
                  <div className="truncate font-mono text-[11px]">{change.path}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {change.status} · {change.description}
                  </div>
                </div>
                <Button size="sm" variant={change.staged ? "ghost" : "default"}>
                  {change.staged ? "取消" : "暂存"}
                </Button>
              </div>
            ))}
          </div>
        </ScrollArea>
        <div className="border-t border-border p-2">
          <Textarea placeholder="输入提交信息，例如：搭建 Tauri 工作台骨架" />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">提交前会复核 staged files 与 hook 输出。</span>
            <Button size="sm" variant="primary">
              提交已暂存
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-border bg-background px-2 py-1.5">
      <div className="font-mono text-[11px] text-muted-foreground">{label}</div>
      <div className="font-mono text-[13px] font-semibold">{value}</div>
    </div>
  );
}

function StatusBar() {
  return (
    <footer className="flex h-6 shrink-0 items-center justify-between border-t border-border bg-muted/70 px-2">
      <div className="flex min-w-0 items-center gap-3">
        <span className="status-token truncate">src/features/workbench/workbench-page.tsx</span>
        <span className="status-token">Ln 6, Col 12</span>
        <span className="status-token">UTF-8</span>
        <span className="status-token">LF</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="status-token">
          <GitPullRequest className="h-3 w-3" />
          main
        </span>
        <span className="status-token">4 modified</span>
        <span className="status-token">
          <Terminal className="h-3 w-3" />
          Tauri 2
        </span>
        <SettingsDialog />
      </div>
    </footer>
  );
}

function SettingsDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" className="h-5 w-5">
          <Settings className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>设置 mock</DialogTitle>
          <DialogDescription>
            这里先固定技术栈与 UI 约束，后续再接入真实配置读写。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 text-[12px]">
          <label className="grid gap-1">
            <span className="text-muted-foreground">Keymap</span>
            <Input value="JetBrains compatible" readOnly />
          </label>
          <label className="grid gap-1">
            <span className="text-muted-foreground">Editor</span>
            <Input value="CodeMirror 6" readOnly />
          </label>
          <label className="grid gap-1">
            <span className="text-muted-foreground">Git Provider</span>
            <Input value="System Git CLI" readOnly />
          </label>
        </div>
        <DialogFooter>
          <Button variant="primary">完成</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
