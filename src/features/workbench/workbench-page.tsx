import { type ChangeEvent, type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Columns3,
  Menu,
  Minus,
  Square,
  X,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  PanelLeftClose,
  PanelRightClose,
  Settings,
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
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { changes, editorLines, treeNodes } from "./mock-data";

type ProjectAccentStyle = {
  "--project-color": string;
  "--project-color-foreground": string;
};

const windowsTitlebarMenus = [
  { id: "file", label: "File", children: ["New File", "Open File"] },
  { id: "edit", label: "Edit", children: ["Undo", "Redo", "Find"] },
  { id: "view", label: "View", children: ["Explorer", "Git Panel", "Terminal"] },
  { id: "window", label: "Window", children: ["Minimize", "Maximize / Restore", "Close"] },
  {
    id: "help",
    label: "Help",
    children: [
      "Welcome",
      "Documentation",
      "Keyboard Shortcuts",
      "Release Notes",
      "Report Issue",
      "View Logs",
      "Check for Updates",
      "Community",
      "Privacy Statement",
      "About Norn",
    ],
  },
] as const;

type WindowsTitlebarMenuId = (typeof windowsTitlebarMenus)[number]["id"];

type WorkbenchDocument = {
  id: string;
  name: string;
  path: string;
  content: string;
  size?: number;
  lastModified?: number;
  isUntitled?: boolean;
};

const initialDocument: WorkbenchDocument = {
  id: "mock-workbench-page",
  name: "workbench-page.tsx",
  path: "src/features/workbench/workbench-page.tsx",
  content: editorLines.join("\n"),
};

const getDocumentLines = (document: WorkbenchDocument) => {
  const lines = document.content.split(/\r\n|\n|\r/);
  return lines.length > 0 ? lines : [""];
};

const codeMirrorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "hsl(var(--editor-background))",
    color: "hsl(var(--foreground))",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    overflow: "auto",
  },
  ".cm-content": {
    minHeight: "100%",
    padding: "12px 0 28px",
  },
  ".cm-line": {
    padding: "0 12px",
  },
  ".cm-gutters": {
    backgroundColor: "hsl(var(--editor-gutter))",
    borderRight: "1px solid hsl(var(--border))",
    color: "hsl(var(--muted-foreground))",
    paddingBottom: "18px",
  },
  ".cm-activeLine": {
    backgroundColor: "hsl(var(--accent) / 0.32)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "hsl(var(--accent) / 0.48)",
    color: "hsl(var(--foreground))",
  },
  ".cm-cursor": {
    borderLeftColor: "hsl(var(--primary))",
  },
});

const getCodeMirrorLanguageExtensions = (fileName: string): Extension[] => {
  const normalizedFileName = fileName.toLowerCase();
  const isJavaScriptLike = /\.(cjs|mjs|js|jsx|ts|tsx)$/.test(normalizedFileName);

  if (!isJavaScriptLike) {
    return [];
  }

  return [javascript({ jsx: true, typescript: normalizedFileName.endsWith(".ts") || normalizedFileName.endsWith(".tsx") })];
};

const createCodeMirrorExtensions = (fileName: string, onChange: (content: string) => void): Extension[] => [
  lineNumbers(),
  highlightActiveLineGutter(),
  history(),
  drawSelection(),
  indentOnInput(),
  bracketMatching(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  highlightActiveLine(),
  keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
  ...getCodeMirrorLanguageExtensions(fileName),
  EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      onChange(update.state.doc.toString());
    }
  }),
  codeMirrorTheme,
];

const recentProjects = [
  { name: "norn", path: "D:/yuanll/code/norn" },
  { name: "NornWorkbench", path: "D:/yuanll/code/NornWorkbench" },
  { name: "robotSDK", path: "D:/yuanll/code/robotSDK" },
  { name: "QAIStudio", path: "D:/yuanll/code/QAIStudio" },
] as const;

const getProjectInitials = (name: string) => {
  const explicitWords = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s._-]+/)
    .filter(Boolean);

  const initials = explicitWords
    .slice(0, 2)
    .map((word) => word[0])
    .join("");

  return (initials || name.slice(0, 2)).toUpperCase();
};

const projectColorPairs = [
  { background: "#2563eb", foreground: "#eff6ff" },
  { background: "#0f766e", foreground: "#f0fdfa" },
  { background: "#7c3aed", foreground: "#f5f3ff" },
  { background: "#be123c", foreground: "#fff1f2" },
  { background: "#047857", foreground: "#ecfdf5" },
  { background: "#a16207", foreground: "#fefce8" },
  { background: "#4338ca", foreground: "#eef2ff" },
  { background: "#c2410c", foreground: "#fff7ed" },
];

const getProjectAccentStyle = (name: string): ProjectAccentStyle => {
  const hash = Array.from(name).reduce((value, character) => value + character.charCodeAt(0), 0);
  const pair = projectColorPairs[hash % projectColorPairs.length];

  return {
    "--project-color": pair.background,
    "--project-color-foreground": pair.foreground,
  };
};

export function WorkbenchPage() {
  const [dark, setDark] = useState(false);
  const [gitOpen, setGitOpen] = useState(true);
  const [document, setDocument] = useState<WorkbenchDocument>(initialDocument);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isWindows = useMemo(() => navigator.userAgent.includes("Windows"), []);

  const createFile = () => {
    setFileError(null);
    setDocument({
      id: `untitled-${Date.now()}`,
      name: "Untitled.txt",
      path: "Untitled.txt",
      content: "",
      isUntitled: true,
    });
  };

  const openFilePicker = () => {
    setFileError(null);
    fileInputRef.current?.click();
  };

  const updateDocumentContent = (content: string) => {
    setDocument((currentDocument) =>
      currentDocument.content === content ? currentDocument : { ...currentDocument, content },
    );
  };

  const handleFileSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];

    event.currentTarget.value = "";

    if (!file) {
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      setDocument({
        id: `${file.name}-${file.lastModified}-${Date.now()}`,
        name: file.name,
        path: file.webkitRelativePath || file.name,
        content: typeof reader.result === "string" ? reader.result : "",
        size: file.size,
        lastModified: file.lastModified,
      });
      setFileError(null);
    };

    reader.onerror = () => {
      setFileError(`Unable to open ${file.name}`);
    };

    reader.readAsText(file);
  };

  return (
    <TooltipProvider delayDuration={250}>
      <div className={cn("h-full bg-background text-[12px] text-foreground", dark && "dark")}>
        <div className="flex h-full min-w-0 flex-col">
          <input className="hidden" ref={fileInputRef} type="file" onChange={handleFileSelected} />
          {isWindows ? <WindowsTitleBar onCreateFile={createFile} onOpenFile={openFilePicker} /> : null}
          <WorkbenchToolbar
            dark={dark}
            onToggleGit={() => setGitOpen((value) => !value)}
            gitOpen={gitOpen}
            onToggleTheme={() => setDark((value) => !value)}
          />
          <main
            className={cn(
              "grid min-h-0 flex-1 grid-cols-[260px_1px_minmax(0,1fr)_32px_360px] bg-background transition-[grid-template-columns]",
              !gitOpen && "grid-cols-[260px_1px_minmax(0,1fr)_32px_0px]",
            )}
          >
            <ProjectPanel />
            <div className="bg-border" />
            <EditorSurface document={document} error={fileError} onChange={updateDocumentContent} />
            <GitRail open={gitOpen} onToggle={() => setGitOpen((value) => !value)} />
            <GitPanel open={gitOpen} />
          </main>
          <StatusBar document={document} />
        </div>
      </div>
    </TooltipProvider>
  );
}

function WindowsTitleBar({
  onCreateFile,
  onOpenFile,
}: {
  onCreateFile: () => void;
  onOpenFile: () => void;
}) {
  const appWindow = getCurrentWindow();
  const [projectName, setProjectName] = useState<string>(recentProjects[0].name);
  const projectInitials = getProjectInitials(projectName);
  const projectAccentStyle = getProjectAccentStyle(projectName);
  const menuRef = useRef<HTMLDivElement>(null);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [menuExpanded, setMenuExpanded] = useState(false);
  const [activeMenu, setActiveMenu] = useState<WindowsTitlebarMenuId | null>(null);
  const [submenuLeft, setSubmenuLeft] = useState(0);

  const selectProject = (name: string) => {
    setProjectName(name);
    setProjectMenuOpen(false);
  };

  const openMenu = () => {
    setProjectMenuOpen(false);
    setMenuExpanded(true);
  };

  const collapseMenu = () => {
    setMenuExpanded(false);
    setActiveMenu(null);
  };

  const activateMenu = (menuId: WindowsTitlebarMenuId, menuElement: HTMLElement) => {
    setSubmenuLeft(menuElement.offsetLeft);
    setActiveMenu(menuId);
  };

  useEffect(() => {
    if (!projectMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (projectMenuRef.current?.contains(event.target as Node)) {
        return;
      }

      setProjectMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setProjectMenuOpen(false);
      }
    };

    const handleWindowBlur = () => {
      setProjectMenuOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [projectMenuOpen]);

  useEffect(() => {
    if (!menuExpanded) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if ((event.target as HTMLElement).closest("[data-titlebar-submenu-action='true']")) {
        return;
      }

      collapseMenu();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        collapseMenu();
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        collapseMenu();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", collapseMenu);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", collapseMenu);
    };
  }, [menuExpanded]);

  const handleTitlebarDoubleClick = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;

    if (target.closest("button, input, textarea, select, a, [role='dialog'], [contenteditable='true']")) {
      return;
    }

    if (!target.closest("[data-tauri-drag-region]")) {
      return;
    }

    appWindow.toggleMaximize();
  };

  const activeMenuConfig = activeMenu ? windowsTitlebarMenus.find((item) => item.id === activeMenu) : null;

  const handleMenuItemClick = (child: string) => {
    if (child === "New File") {
      onCreateFile();
    }

    if (child === "Open File") {
      onOpenFile();
    }

    if (child === "Minimize") appWindow.minimize();
    if (child === "Maximize / Restore") appWindow.toggleMaximize();
    if (child === "Close") appWindow.close();
    collapseMenu();
  };

  return (
    <header className="windows-titlebar" onDoubleClick={handleTitlebarDoubleClick}>
      <div className="windows-titlebar-left" ref={menuRef}>
        {!menuExpanded ? (
          <button
            className="windows-titlebar-menu-button"
            type="button"
            aria-label="Toggle application menu"
            aria-expanded={menuExpanded}
            onClick={openMenu}
          >
            <Menu className="h-4 w-4" />
          </button>
        ) : (
          <nav className="windows-titlebar-inline-menu" aria-label="Application menu">
            {windowsTitlebarMenus.map((item) => (
              <div className="windows-titlebar-parent-menu" key={item.id} onPointerEnter={(event) => activateMenu(item.id, event.currentTarget)}>
                <button
                  className={cn("windows-titlebar-parent-menu-button", activeMenu === item.id && "windows-titlebar-parent-menu-button-active")}
                  type="button"
                  aria-expanded={activeMenu === item.id}
                  onClick={(event) => {
                    const menuElement = event.currentTarget.parentElement;
                    if (menuElement) {
                      activateMenu(item.id, menuElement);
                    }
                  }}
                  onFocus={(event) => {
                    const menuElement = event.currentTarget.parentElement;
                    if (menuElement) {
                      activateMenu(item.id, menuElement);
                    }
                  }}
                >
                  {item.label}
                </button>
              </div>
            ))}
            {activeMenuConfig ? (
              <div className="windows-titlebar-submenu" style={{ transform: `translateX(${submenuLeft}px)` }}>
                {activeMenuConfig.children.map((child) => (
                  <button
                    className={cn("windows-titlebar-submenu-item", child === "Close" && "windows-titlebar-submenu-item-danger")}
                    key={child}
                    type="button"
                    data-titlebar-submenu-action="true"
                    onClick={() => handleMenuItemClick(child)}
                  >
                    {child}
                  </button>
                ))}
              </div>
            ) : null}
          </nav>
        )}
        {!menuExpanded ? (
          <div className="windows-titlebar-project">
            <div className="windows-titlebar-project-picker" ref={projectMenuRef}>
              <button
                className={cn("windows-titlebar-folder", projectMenuOpen && "windows-titlebar-folder-active")}
                type="button"
                aria-expanded={projectMenuOpen}
                onClick={() => setProjectMenuOpen((value) => !value)}
              >
                <span className="windows-titlebar-folder-icon" style={projectAccentStyle}>
                  {projectInitials}
                </span>
                <span className="windows-titlebar-folder-name">{projectName}</span>
              </button>
              {projectMenuOpen ? (
                <div className="windows-titlebar-folder-menu">
                  <button className="windows-titlebar-folder-menu-item" type="button" onClick={() => setProjectMenuOpen(false)}>
                    Open New Folder
                  </button>
                  <button className="windows-titlebar-folder-menu-item" type="button" onClick={() => setProjectMenuOpen(false)}>
                    Add Folder to Workspace
                  </button>
                  <div className="windows-titlebar-folder-menu-section">
                    {recentProjects.map((project) => (
                      <button className="windows-titlebar-recent-project" key={project.path} type="button" onClick={() => selectProject(project.name)}>
                        <span className="windows-titlebar-recent-project-icon" style={getProjectAccentStyle(project.name)}>
                          {getProjectInitials(project.name)}
                        </span>
                        <span className="windows-titlebar-recent-project-text">
                          <span className="windows-titlebar-recent-project-name">{project.name}</span>
                          <span className="windows-titlebar-recent-project-path">{project.path}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <button className="windows-titlebar-git" type="button">
              main - 4 modified
            </button>
          </div>
        ) : null}
      </div>
      <div className="windows-titlebar-drag-fill" data-tauri-drag-region />
      <div className="windows-titlebar-search-entry">
        <button className="windows-titlebar-search-button" type="button" onClick={() => setSearchOpen(true)}>
          Search files, commands, symbols
        </button>
        {searchOpen ? (
          <div className="windows-quick-search" role="dialog" aria-label="Quick search" onClick={() => setSearchOpen(false)}>
            <div className="windows-quick-search-panel" onClick={(event) => event.stopPropagation()}>
              <input
                className="windows-quick-search-input"
                autoFocus
                placeholder="Search files, commands, symbols"
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setSearchOpen(false);
                  }
                }}
              />
              <div className="windows-quick-search-results">
                <button className="windows-quick-search-result" type="button">
                  src/features/workbench/workbench-page.tsx
                </button>
                <button className="windows-quick-search-result" type="button">
                  src-tauri/src/lib.rs
                </button>
                <button className="windows-quick-search-result" type="button">
                  src/styles.css
                </button>
              </div>
              <button className="windows-quick-search-close" type="button" onClick={() => setSearchOpen(false)}>
                Close
              </button>
            </div>
          </div>
        ) : null}
      </div>
      <div className="windows-titlebar-drag-fill windows-titlebar-drag-fill-right" data-tauri-drag-region />
      <div className="windows-titlebar-controls" onDoubleClick={(event) => event.stopPropagation()}>
        <button className="windows-window-button" type="button" aria-label="Minimize" onClick={() => appWindow.minimize()}>
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          className="windows-window-button"
          type="button"
          aria-label="Maximize or restore"
          onClick={() => appWindow.toggleMaximize()}
        >
          <Square className="h-3 w-3" />
        </button>
        <button className="windows-window-button windows-window-button-close" type="button" aria-label="Close" onClick={() => appWindow.close()}>
          <X className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}

function WorkbenchToolbar({
  dark,
  gitOpen,
  onToggleGit,
  onToggleTheme,
}: {
  dark: boolean;
  gitOpen: boolean;
  onToggleGit: () => void;
  onToggleTheme: () => void;
}) {
  return (
    <div className="tool-row justify-between gap-2">
      <div className="flex min-w-0 items-center gap-1.5">
        <Button size="toolbar" variant="default">
          <GitBranch className="h-3.5 w-3.5" />
          main
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="flex items-center gap-1.5">
        <Badge tone="success">Git CLI</Badge>
        <Button variant="ghost" size="sm" onClick={onToggleTheme}>
          {dark ? "Light" : "Dark"}
        </Button>
        <Button size="toolbar" variant="default">
          <Columns3 className="h-3.5 w-3.5" />
          Diff
        </Button>
        <Button size="toolbar" variant="primary">
          <GitCommitHorizontal className="h-3.5 w-3.5" />
          Commit
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
    <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-border bg-card/70">
      <div className="panel-heading">
        <div className="flex items-center gap-1.5 font-semibold">
          <PanelLeftClose className="h-3.5 w-3.5 text-muted-foreground" />
            Project
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

function EditorSurface({
  document,
  error,
  onChange,
}: {
  document: WorkbenchDocument;
  error: string | null;
  onChange: (content: string) => void;
}) {
  const editorElementRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const parent = editorElementRef.current;

    if (!parent) {
      return;
    }

    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: document.content,
        extensions: createCodeMirrorExtensions(document.name, (content) => onChangeRef.current(content)),
      }),
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [document.id, document.name]);

  return (
    <section className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-border bg-[hsl(var(--editor-background))]">
      <Tabs value={document.id} className="min-w-0">
        <TabsList className="flex w-full justify-start border-b border-border bg-muted/70">
          <TabsTrigger className="max-w-[240px] justify-start gap-2 px-2.5" value={document.id}>
            <span className={cn("h-2 w-2 shrink-0 rounded-full", document.isUntitled ? "bg-amber-500" : "bg-emerald-500")} />
            <span className="truncate">{document.name}</span>
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {error ? (
        <div className="border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-[12px] text-destructive">
          {error}
        </div>
      ) : null}
      <div className="codemirror-shell min-h-0 flex-1" ref={editorElementRef} />
    </section>
  );
}

function GitRail({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-col items-center border-x border-border bg-muted/75 py-2 shadow-[inset_1px_0_0_hsl(var(--background)),inset_-1px_0_0_hsl(var(--background))]">
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
    <aside className={cn("min-h-0 min-w-0 overflow-hidden bg-card shadow-[-10px_0_18px_-18px_rgba(15,23,42,0.75)] transition-opacity", !open && "opacity-0")}>
      <div className="flex h-full w-[360px] min-h-0 flex-col">
        <div className="panel-heading">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Git workspace</div>
            <div className="font-semibold">Changes</div>
          </div>
          <Badge tone="warning">ahead 1</Badge>
        </div>
        <div className="grid grid-cols-3 gap-1 border-b border-border p-2">
          <Summary label="Working" value="4" />
          <Summary label="Staged" value="1" />
          <Summary label="Remote" value="+1" />
        </div>
        <div className="border-b border-border p-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <GitBranch className="h-4 w-4 text-primary" />
              <div className="min-w-0">
                <div className="truncate font-medium">main</div>
                <div className="truncate text-[11px] text-muted-foreground">origin/main - 1 commit ready to push</div>
              </div>
            </div>
            <Button size="sm" variant="ghost">
              Switch
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
                    {change.status} - {change.description}
                  </div>
                </div>
                <Button size="sm" variant={change.staged ? "ghost" : "default"}>
                  {change.staged ? "Unstage" : "Stage"}
                </Button>
              </div>
            ))}
          </div>
        </ScrollArea>
        <div className="border-t border-border p-2">
          <Textarea placeholder="Commit message, for example: wire up file open" />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">Review staged files before committing.</span>
            <Button size="sm" variant="primary">
              Commit staged
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

function StatusBar({ document }: { document: WorkbenchDocument }) {
  const lineCount = getDocumentLines(document).length;

  return (
    <footer className="flex h-6 shrink-0 items-center justify-between border-t border-border bg-muted/70 px-2">
      <div className="flex min-w-0 items-center gap-3">
        <span className="status-token truncate">{document.path}</span>
        <span className="status-token">{lineCount} lines</span>
        <span className="status-token">UTF-8</span>
        <span className="status-token">LF</span>
        {document.isUntitled ? <span className="status-token">Unsaved</span> : null}
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
