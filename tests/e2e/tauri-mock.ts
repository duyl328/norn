import type { Page } from "@playwright/test";

export type TauriMockScenario = {
  directories?: Record<string, Array<Record<string, unknown>>>;
  fileContents?: Record<string, string>;
  fileLastModified?: Record<string, number>;
  fileInspections?: Record<string, Partial<MockTextFileInspection>>;
  folderDialogPath?: string | null;
  folderDialogPaths?: Array<string | null>;
  fileDialogPath?: string | null;
  saveDialogPath?: string | null;
  gitInspection?: Record<string, unknown>;
  invokeGates?: string[];
  invokeErrors?: Record<string, unknown>;
  settings?: Record<string, unknown>;
};

export type TauriMockFileOptions = {
  encoding?: string;
  encodingLabel?: string;
  hasBom?: boolean;
  isBinary?: boolean;
  isText?: boolean;
  isUtf8?: boolean;
  lastModified?: number;
  size?: number;
};

type TauriMockRuntimeControl = {
  clearInvokeError: (key: string) => void;
  deletePath: (path: string) => void;
  getFile: (path: string) => { content?: string; lastModified?: number };
  hasPendingInvoke: (key: string) => boolean;
  releaseAllInvokes: (key: string) => number;
  releaseInvoke: (key: string) => boolean;
  renamePath: (path: string, nextPath: string) => void;
  setFile: (path: string, content: string, options?: TauriMockFileOptions) => void;
  setInvokeError: (key: string, error: unknown) => void;
};

type MockTextFileInspection = {
  isText: boolean;
  encoding: string;
  encodingLabel: string;
  encodingConfidence: number;
  encodingCandidates: unknown[];
  hasBom: boolean;
  isBinary: boolean;
  isUtf8: boolean;
  lastModified: number;
  name: string;
  path: string;
  sample: string;
  size: number;
};

export const largeFileScenario = {
  directories: {
    "/mock/project": [
      {
        name: "large.txt",
        path: "/mock/project/large.txt",
        relativePath: "large.txt",
        kind: "file",
        size: 6 * 1024 * 1024,
      },
      {
        name: "huge.log",
        path: "/mock/project/huge.log",
        relativePath: "huge.log",
        kind: "file",
        size: 30 * 1024 * 1024,
      },
      {
        name: "massive.log",
        path: "/mock/project/massive.log",
        relativePath: "massive.log",
        kind: "file",
        size: 120 * 1024 * 1024,
      },
    ],
    "/mock/scratch": [],
  },
  fileContents: {
    "/mock/project/large.txt": "large editable file\n".repeat(128),
    "/mock/project/huge.log": "huge range content\n".repeat(128),
    "/mock/project/massive.log": "massive tail content\n".repeat(128),
  },
  fileInspections: {
    "/mock/project/large.txt": { size: 6 * 1024 * 1024 },
    "/mock/project/huge.log": { size: 30 * 1024 * 1024 },
    "/mock/project/massive.log": { size: 120 * 1024 * 1024 },
  },
} satisfies TauriMockScenario;

export const fileErrorScenario = {
  directories: {
    "/mock/project": [
      { name: "binary.bin", path: "/mock/project/binary.bin", relativePath: "binary.bin", kind: "file", size: 32 },
      { name: "latin1.txt", path: "/mock/project/latin1.txt", relativePath: "latin1.txt", kind: "file", size: 32 },
      {
        name: "readonly.txt",
        path: "/mock/project/readonly.txt",
        relativePath: "readonly.txt",
        kind: "file",
        size: 32,
      },
    ],
    "/mock/scratch": [],
  },
  fileContents: {
    "/mock/project/binary.bin": "",
    "/mock/project/latin1.txt": "",
    "/mock/project/readonly.txt": "readonly content\n",
  },
  fileInspections: {
    "/mock/project/binary.bin": { isBinary: true, isText: false, isUtf8: false },
    "/mock/project/latin1.txt": { isBinary: false, isText: false, isUtf8: false },
  },
  invokeErrors: {
    "save_text_file:/mock/project/readonly.txt": {
      kind: "permission",
      message: "/mock/project/readonly.txt is read-only and cannot be saved.",
    },
  },
} satisfies TauriMockScenario;

export const saveConflictScenario = {
  directories: {
    "/mock/project": [
      {
        name: "conflict.txt",
        path: "/mock/project/conflict.txt",
        relativePath: "conflict.txt",
        kind: "file",
        size: 17,
      },
    ],
    "/mock/scratch": [],
  },
  fileContents: {
    "/mock/project/conflict.txt": "local baseline\n",
  },
  fileLastModified: {
    "/mock/project/conflict.txt": 1_700_000_000_000,
  },
  invokeErrors: {
    "save_text_file:/mock/project/conflict.txt": {
      kind: "modified",
      message: "/mock/project/conflict.txt was changed outside Norn.",
    },
  },
} satisfies TauriMockScenario;

export async function installTauriMock(page: Page, scenario: TauriMockScenario = {}): Promise<void> {
  await page.addInitScript((mockScenario) => {
    window.localStorage.setItem("norn.welcomeSeen", "1");
    const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
    const listeners = new Map<number, { event: string; handlerId: number }>();
    let nextEventId = 1;
    const invokeCalls: Array<{ args: Record<string, unknown>; cmd: string }> = [];

    const directories = {
      ...clone({
        "/mock/project": [
          { name: "src", path: "/mock/project/src", relativePath: "src", kind: "directory" },
          { name: "README.md", path: "/mock/project/README.md", relativePath: "README.md", kind: "file", size: 1280 },
          {
            name: "package.json",
            path: "/mock/project/package.json",
            relativePath: "package.json",
            kind: "file",
            size: 640,
          },
        ],
        "/mock/project/src": [
          {
            name: "main.tsx",
            path: "/mock/project/src/main.tsx",
            relativePath: "src/main.tsx",
            kind: "file",
            size: 512,
          },
        ],
        "/mock/scratch": [],
      }),
      ...clone(mockScenario.directories ?? {}),
    } as Record<string, Array<Record<string, unknown>>>;

    const fileContents = {
      ...clone({
        "/mock/project/README.md": "# Mock Project\n\n这是注入到测试中的 mock 文件内容。\n",
        "/mock/project/package.json": '{ "name": "mock-project" }\n',
        "/mock/project/src/main.tsx": 'export const greeting = "hello from mock";\n',
      }),
      ...clone(mockScenario.fileContents ?? {}),
    } as Record<string, string>;

    const fileLastModified = {
      ...clone({
        "/mock/project/README.md": 1_700_000_000_000,
        "/mock/project/package.json": 1_700_000_000_000,
        "/mock/project/src/main.tsx": 1_700_000_000_000,
      }),
      ...clone(mockScenario.fileLastModified ?? {}),
    } as Record<string, number>;

    const fileInspections = clone(mockScenario.fileInspections ?? {}) as Record<
      string,
      Partial<MockTextFileInspection>
    >;
    const invokeErrors = clone(mockScenario.invokeErrors ?? {}) as Record<string, unknown>;
    const folderDialogPaths = clone(mockScenario.folderDialogPaths ?? []);
    const invokeGates = new Set(clone(mockScenario.invokeGates ?? []));
    const pendingInvokes = new Map<string, number>();
    const invokeWaiters = new Map<string, Array<() => void>>();
    const draftStorageKey = "__nornMockDrafts";
    const readDrafts = () => {
      try {
        return JSON.parse(window.localStorage.getItem(draftStorageKey) ?? "{}") as Record<string, string>;
      } catch {
        return {} as Record<string, string>;
      }
    };
    const writeDrafts = (drafts: Record<string, string>) =>
      window.localStorage.setItem(draftStorageKey, JSON.stringify(drafts));

    const baseName = (path: string) => path.split("/").filter(Boolean).pop() ?? path;
    const parentOf = (path: string) => {
      const segments = path.split("/").filter(Boolean);
      segments.pop();
      return `/${segments.join("/")}`;
    };
    const lastModifiedFor = (path: string) => fileLastModified[path] ?? 1_700_000_000_000;
    const contentLengthFor = (path: string) => fileContents[path]?.length ?? 0;
    const configuredError = (cmd: string, args: Record<string, unknown>) =>
      invokeErrors[`${cmd}:${String(args.path ?? args.sourcePath ?? "")}`] ?? invokeErrors[cmd];
    const configuredGate = (cmd: string, args: Record<string, unknown>) => {
      const specific = `${cmd}:${String(args.path ?? args.sourcePath ?? "")}`;
      if (invokeGates.has(specific)) return specific;
      return invokeGates.has(cmd) ? cmd : null;
    };

    const findEntry = (path: string): Record<string, unknown> | null => {
      const entries = directories[parentOf(path)];
      return entries?.find((entry) => entry.path === path) ?? null;
    };

    const removeEntry = (path: string): Record<string, unknown> | null => {
      const entries = directories[parentOf(path)];
      if (!entries) return null;
      const index = entries.findIndex((entry) => entry.path === path);
      if (index < 0) return null;
      return entries.splice(index, 1)[0] ?? null;
    };

    const setMockFile = (path: string, content: string, options: TauriMockFileOptions = {}) => {
      const parentPath = parentOf(path);
      const name = baseName(path);
      const lastModified = options.lastModified ?? fileLastModified[path] ?? 1_700_000_000_000;
      const size = options.size ?? content.length;
      fileContents[path] = content;
      fileLastModified[path] = lastModified;
      fileInspections[path] = {
        ...(fileInspections[path] ?? {}),
        ...options,
        lastModified,
        size,
      };
      delete invokeErrors[`inspect_text_file:${path}`];
      delete invokeErrors[`read_text_file:${path}`];
      const entries = (directories[parentPath] ??= []);
      const existing = entries.find((entry) => entry.path === path);
      const entry = {
        name,
        path,
        relativePath: name,
        kind: "file",
        size,
        lastModified,
      };
      if (existing) Object.assign(existing, entry);
      else entries.push(entry);
    };

    const deleteMockPath = (path: string) => {
      removeEntry(path);
      delete fileContents[path];
      delete fileLastModified[path];
      delete fileInspections[path];
      delete directories[path];
      const missing = new Error(`Unable to access ${path}: not found`);
      invokeErrors[`inspect_text_file:${path}`] = missing;
      invokeErrors[`list_directory:${path}`] = missing;
      invokeErrors[`read_text_file:${path}`] = missing;
      invokeErrors[`read_text_file_range:${path}`] = missing;
    };

    const renameMockPath = (path: string, nextPath: string) => {
      const content = fileContents[path];
      const lastModified = fileLastModified[path];
      const inspection = fileInspections[path];
      deleteMockPath(path);
      if (content !== undefined) {
        setMockFile(nextPath, content, {
          ...inspection,
          lastModified,
          size: typeof inspection?.size === "number" ? inspection.size : content.length,
        });
      }
    };

    const relativeTo = (workspaceRoot: string, path: string) => {
      const root = workspaceRoot.replace(/\/+$/, "");
      return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : baseName(path);
    };

    const inspectFile = (path: string): MockTextFileInspection => {
      const content = fileContents[path] ?? "";
      const override = fileInspections[path] ?? {};
      const size = override.size ?? content.length;

      return {
        name: baseName(path),
        path,
        size,
        lastModified: lastModifiedFor(path),
        isBinary: false,
        isUtf8: true,
        // 应用现在按 isText 判定可否打开(isUtf8 已不再是那个开关),漏掉它所有文件都会报「无法以支持的文本编码打开」。
        isText: true,
        encoding: "utf-8",
        encodingLabel: "UTF-8",
        encodingConfidence: 1,
        encodingCandidates: [],
        hasBom: false,
        sample: content.slice(0, 256),
        ...override,
      };
    };

    const route = (cmd: string, args: Record<string, unknown> = {}): unknown => {
      invokeCalls.push({ cmd, args });
      const error = configuredError(cmd, args);
      if (error) throw error;

      switch (cmd) {
        case "plugin:event|listen": {
          const event = String(args.event);
          const handlerId = Number(args.handler);
          const eventId = nextEventId++;
          listeners.set(eventId, { event, handlerId });
          return eventId;
        }
        case "plugin:event|unlisten":
          listeners.delete(Number(args.eventId));
          return null;
        case "app_version":
          return "0.1.0";
        case "read_config_file":
          return args.name === "settings.json"
            ? JSON.stringify(
                mockScenario.settings ?? {
                  schemaVersion: 1,
                  language: "en",
                  theme: "system",
                  editor: { fontSize: 13, tabSize: 2, lineWrapping: false, formatOnSave: false },
                  ui: { showStatusBar: true, resizeHandleHints: false, restoreLastWorkspace: true },
                },
              )
            : null;
        case "write_config_file":
          return null;
        case "open_folder_dialog":
          return folderDialogPaths.length > 0
            ? folderDialogPaths.shift()
            : mockScenario.folderDialogPath === undefined
              ? "/mock/project"
              : mockScenario.folderDialogPath;
        case "open_file_dialog":
          return mockScenario.fileDialogPath === undefined ? "/mock/project/README.md" : mockScenario.fileDialogPath;
        case "list_directory":
          return directories[String(args.path)] ?? [];
        case "inspect_git_workspace":
          return (
            mockScenario.gitInspection ?? {
              workspacePath: String(args.path),
              gitAvailable: true,
              gitVersion: "2.40.0",
              isRepository: true,
              gitRoot: "/mock/project",
              hasDotGit: true,
              branch: "main",
              message: "Repository detected",
            }
          );
        case "git_fetch":
          return null;
        // 打开文件夹后 use-git 会一次性拉这几条;返回 null 会让 project-panel 迭代 ignoredFiles 时整页崩掉。
        case "git_status":
          return { branch: "main", detached: false, upstream: null, ahead: 0, behind: 0, changes: [] };
        case "git_branches":
          return { current: "main", local: [], remote: [] };
        case "git_ignored_files":
        case "git_recent_commits":
        case "git_log":
        case "git_worktrees":
          return [];
        case "list_drafts":
          return Object.values(readDrafts());
        case "write_draft": {
          const drafts = readDrafts();
          drafts[String(args.id)] = String(args.contents);
          writeDrafts(drafts);
          return null;
        }
        case "delete_draft": {
          const drafts = readDrafts();
          delete drafts[String(args.id)];
          writeDrafts(drafts);
          return null;
        }
        case "git_pending_op":
          return "";
        // 编辑器改动条的基线:HEAD 版本 = 当前 mock 内容(所以刚打开时没有改动条,一编辑就出现)。
        case "git_file_versions": {
          const file = String(args.file);
          const full = Object.keys(fileContents).find((key) => key.endsWith(`/${file}`));
          const original = full ? (fileContents[full] ?? "") : "";
          return { original, modified: original };
        }
        case "read_text_file": {
          const path = String(args.path);
          const inspection = inspectFile(path);
          return {
            name: baseName(path),
            path,
            content: fileContents[path] ?? "",
            size: inspection.size,
            lastModified: inspection.lastModified,
            encoding: inspection.encoding,
            encodingLabel: inspection.encodingLabel,
            encodingCandidates: inspection.encodingCandidates,
            hasBom: inspection.hasBom,
          };
        }
        case "read_text_file_range": {
          const path = String(args.path);
          const inspection = inspectFile(path);
          const content = fileContents[path] ?? "";
          const offset = Number(args.offset ?? 0);
          const length = Number(args.length ?? content.length);
          const virtualSize = inspection.size;
          const startOffset = Math.max(0, Math.min(offset, virtualSize));
          const contentOffset = Math.max(0, Math.min(offset, content.length));
          const rangeContent = content.slice(contentOffset, Math.min(content.length, contentOffset + length));
          const endOffset = Math.min(
            virtualSize,
            startOffset + Math.max(rangeContent.length, Math.min(length, virtualSize)),
          );
          return {
            path,
            content: rangeContent,
            size: virtualSize,
            requestedOffset: offset,
            startOffset,
            endOffset,
            hasMoreBefore: startOffset > 0,
            hasMoreAfter: endOffset < virtualSize,
          };
        }
        case "inspect_text_file":
          return inspectFile(String(args.path));
        case "open_save_dialog":
          return mockScenario.saveDialogPath === undefined ? "/mock/project/untitled.txt" : mockScenario.saveDialogPath;
        case "save_text_file": {
          const path = String(args.path);
          const content = String(args.content ?? "");
          if (fileContents[path] === undefined) {
            throw { kind: "deleted", message: `${path} no longer exists. Choose a new location to save this file.` };
          }
          const expectedLastModified =
            typeof args.expectedLastModified === "number" ? Number(args.expectedLastModified) : null;
          if (!args.force && expectedLastModified !== null && lastModifiedFor(path) !== expectedLastModified) {
            throw { kind: "modified", message: `${path} was changed outside Norn. Review the conflict before saving.` };
          }
          fileContents[path] = content;
          fileLastModified[path] = lastModifiedFor(path) + 1;
          return { name: baseName(path), path, size: content.length, lastModified: fileLastModified[path] };
        }
        case "save_text_file_as": {
          const path = String(args.path);
          const content = String(args.content ?? "");
          fileContents[path] = content;
          fileLastModified[path] = lastModifiedFor(path) + 1;
          const parentPath = parentOf(path);
          const entry = {
            name: baseName(path),
            path,
            relativePath: baseName(path),
            kind: "file",
            size: content.length,
            lastModified: fileLastModified[path],
          };
          const entries = (directories[parentPath] ??= []);
          const existing = entries.find((candidate) => candidate.path === path);
          if (existing) Object.assign(existing, entry);
          else entries.push(entry);
          return { name: baseName(path), path, size: content.length, lastModified: fileLastModified[path] };
        }
        case "scratch_folder":
          return { name: "scratch", path: "/mock/scratch" };
        case "create_file": {
          const workspaceRoot = String(args.workspaceRoot ?? "/mock/project");
          const parentPath = String(args.parentPath ?? "/mock/project");
          const name = String(args.name ?? "untitled.txt");
          const path = `${parentPath}/${name}`;
          fileContents[path] = "";
          fileLastModified[path] = lastModifiedFor(path);
          const entry = {
            name,
            path,
            relativePath: relativeTo(workspaceRoot, path),
            kind: "file",
            size: 0,
            lastModified: fileLastModified[path],
          };
          (directories[parentPath] ??= []).push({ ...entry });
          return entry;
        }
        case "create_directory": {
          const workspaceRoot = String(args.workspaceRoot ?? "/mock/project");
          const parentPath = String(args.parentPath ?? "/mock/project");
          const name = String(args.name ?? "untitled");
          const path = `${parentPath}/${name}`;
          const entry = {
            name,
            path,
            relativePath: relativeTo(workspaceRoot, path),
            kind: "directory",
            size: null,
            lastModified: lastModifiedFor(path),
          };
          (directories[parentPath] ??= []).push({ ...entry });
          directories[path] ??= [];
          return entry;
        }
        case "rename_path": {
          const workspaceRoot = String(args.workspaceRoot ?? "/mock/project");
          const path = String(args.path);
          const newName = String(args.newName);
          const parentPath = parentOf(path);
          const newPath = `${parentPath}/${newName}`;
          const removed = removeEntry(path);
          const kind = removed?.kind === "directory" ? "directory" : "file";
          if (fileContents[path] !== undefined) {
            fileContents[newPath] = fileContents[path];
            delete fileContents[path];
          }
          if (fileLastModified[path] !== undefined) {
            fileLastModified[newPath] = fileLastModified[path];
            delete fileLastModified[path];
          }
          const entry = {
            name: newName,
            path: newPath,
            relativePath: relativeTo(workspaceRoot, newPath),
            kind,
            size: removed?.size ?? (kind === "file" ? contentLengthFor(newPath) : null),
            lastModified: lastModifiedFor(newPath),
          };
          (directories[parentPath] ??= []).push({ ...entry });
          return entry;
        }
        case "trash_path": {
          const path = String(args.path);
          removeEntry(path);
          delete fileContents[path];
          delete fileLastModified[path];
          delete directories[path];
          return null;
        }
        case "move_path": {
          const workspaceRoot = String(args.workspaceRoot ?? "/mock/project");
          const sourcePath = String(args.sourcePath);
          const targetDirectory = String(args.targetDirectory);
          const name = baseName(sourcePath);
          const newPath = `${targetDirectory}/${name}`;
          const removed = removeEntry(sourcePath);
          const kind = removed?.kind === "directory" ? "directory" : "file";
          if (fileContents[sourcePath] !== undefined) {
            fileContents[newPath] = fileContents[sourcePath];
            delete fileContents[sourcePath];
          }
          const entry = {
            name,
            path: newPath,
            relativePath: relativeTo(workspaceRoot, newPath),
            kind,
            size: removed?.size ?? (kind === "file" ? contentLengthFor(newPath) : null),
            lastModified: lastModifiedFor(newPath),
          };
          (directories[targetDirectory] ??= []).push({ ...entry });
          return entry;
        }
        case "copy_path": {
          const workspaceRoot = String(args.workspaceRoot ?? "/mock/project");
          const sourcePath = String(args.sourcePath);
          const targetDirectory = String(args.targetDirectory);
          const name = baseName(sourcePath);
          const newPath = `${targetDirectory}/${name}`;
          const source = findEntry(sourcePath);
          const kind = source?.kind === "directory" ? "directory" : "file";
          if (fileContents[sourcePath] !== undefined) fileContents[newPath] = fileContents[sourcePath];
          const entry = {
            name,
            path: newPath,
            relativePath: relativeTo(workspaceRoot, newPath),
            kind,
            size: source?.size ?? (kind === "file" ? contentLengthFor(newPath) : null),
            lastModified: lastModifiedFor(newPath),
          };
          (directories[targetDirectory] ??= []).push({ ...entry });
          return entry;
        }
        default:
          return null;
      }
    };

    const internals = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main", windowLabel: "main" },
      },
      transformCallback(callback: (payload: unknown) => void, once = false) {
        const id = Math.floor(Math.random() * 1_000_000_000);
        const prop = `_${id}`;
        Object.defineProperty(window, prop, {
          configurable: true,
          writable: false,
          value: (payload: unknown) => {
            if (once) Reflect.deleteProperty(window, prop);
            return callback(payload);
          },
        });
        return id;
      },
      invoke(cmd: string, args: Record<string, unknown> = {}) {
        const gate = configuredGate(cmd, args);
        const execute = (resolve: (value: unknown) => void, reject: (reason?: unknown) => void) => {
          try {
            resolve(route(cmd, args));
          } catch (error) {
            reject(error);
          }
        };

        if (!gate) {
          return new Promise(execute);
        }

        pendingInvokes.set(gate, (pendingInvokes.get(gate) ?? 0) + 1);
        return new Promise((resolve, reject) => {
          const waiters = invokeWaiters.get(gate) ?? [];
          waiters.push(() => {
            const remaining = Math.max(0, (pendingInvokes.get(gate) ?? 1) - 1);
            if (remaining === 0) pendingInvokes.delete(gate);
            else pendingInvokes.set(gate, remaining);
            execute(resolve, reject);
          });
          invokeWaiters.set(gate, waiters);
        });
      },
      convertFileSrc(path: string) {
        return path;
      },
    };

    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = internals;
    // @tauri-apps/api v2 的 listen() 卸载时会走这里;缺了它每个 listener 都抛 unregisterListener of undefined。
    (window as unknown as { __TAURI_EVENT_PLUGIN_INTERNALS__: unknown }).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: () => {},
    };
    (window as unknown as { __tauriInvokeCalls: typeof invokeCalls }).__tauriInvokeCalls = invokeCalls;
    (window as unknown as { __tauriMockRuntime: TauriMockRuntimeControl }).__tauriMockRuntime = {
      clearInvokeError: (key) => delete invokeErrors[key],
      deletePath: deleteMockPath,
      getFile: (path) => ({ content: fileContents[path], lastModified: fileLastModified[path] }),
      hasPendingInvoke: (key) => (pendingInvokes.get(key) ?? 0) > 0,
      releaseAllInvokes: (key) => {
        const waiters = invokeWaiters.get(key) ?? [];
        invokeWaiters.delete(key);
        for (const waiter of waiters) waiter();
        return waiters.length;
      },
      releaseInvoke: (key) => {
        const waiters = invokeWaiters.get(key);
        const waiter = waiters?.shift();
        if (!waiter) return false;
        if (waiters?.length === 0) invokeWaiters.delete(key);
        waiter();
        return true;
      },
      renamePath: renameMockPath,
      setFile: setMockFile,
      setInvokeError: (key, error) => {
        invokeErrors[key] = error;
      },
    };
    (window as unknown as { __tauriMockHasListener: (event: string) => boolean }).__tauriMockHasListener = (event) =>
      [...listeners.values()].some((listener) => listener.event === event);
    (window as unknown as { __emitTauriEvent: (event: string, payload: unknown) => void }).__emitTauriEvent = (
      event,
      payload,
    ) => {
      let latestEventId = -1;
      let latestHandlerId = -1;
      for (const [eventId, info] of listeners) {
        if (info.event === event && eventId > latestEventId) {
          latestEventId = eventId;
          latestHandlerId = info.handlerId;
        }
      }
      if (latestHandlerId >= 0) {
        const fn = (window as unknown as Record<string, (value: unknown) => void>)[`_${latestHandlerId}`];
        fn?.({ event, id: 0, payload });
      }
    };
  }, scenario);
}

export async function waitForMockInvoke(page: Page, key: string): Promise<void> {
  await page.waitForFunction(
    (invokeKey) =>
      (window as unknown as { __tauriMockRuntime: TauriMockRuntimeControl }).__tauriMockRuntime.hasPendingInvoke(
        invokeKey,
      ),
    key,
  );
}

export async function releaseMockInvoke(page: Page, key: string): Promise<void> {
  const released = await page.evaluate(
    (invokeKey) =>
      (window as unknown as { __tauriMockRuntime: TauriMockRuntimeControl }).__tauriMockRuntime.releaseInvoke(
        invokeKey,
      ),
    key,
  );
  if (!released) throw new Error(`No pending mock invoke for ${key}`);
}

export async function releaseAllMockInvokes(page: Page, key: string): Promise<number> {
  return await page.evaluate(
    (invokeKey) =>
      (window as unknown as { __tauriMockRuntime: TauriMockRuntimeControl }).__tauriMockRuntime.releaseAllInvokes(
        invokeKey,
      ),
    key,
  );
}

export async function setMockFile(
  page: Page,
  path: string,
  content: string,
  options: TauriMockFileOptions = {},
): Promise<void> {
  await page.evaluate(
    ({ fileContent, fileOptions, filePath }) =>
      (window as unknown as { __tauriMockRuntime: TauriMockRuntimeControl }).__tauriMockRuntime.setFile(
        filePath,
        fileContent,
        fileOptions,
      ),
    { fileContent: content, fileOptions: options, filePath: path },
  );
}

export async function deleteMockPath(page: Page, path: string): Promise<void> {
  await page.evaluate(
    (filePath) =>
      (window as unknown as { __tauriMockRuntime: TauriMockRuntimeControl }).__tauriMockRuntime.deletePath(filePath),
    path,
  );
}

export async function renameMockPath(page: Page, path: string, nextPath: string): Promise<void> {
  await page.evaluate(
    ({ from, to }) =>
      (window as unknown as { __tauriMockRuntime: TauriMockRuntimeControl }).__tauriMockRuntime.renamePath(from, to),
    { from: path, to: nextPath },
  );
}

export async function setMockInvokeError(page: Page, key: string, message: string): Promise<void> {
  await page.evaluate(
    ({ errorKey, errorMessage }) =>
      (window as unknown as { __tauriMockRuntime: TauriMockRuntimeControl }).__tauriMockRuntime.setInvokeError(
        errorKey,
        new Error(errorMessage),
      ),
    { errorKey: key, errorMessage: message },
  );
}

export async function clearMockInvokeError(page: Page, key: string): Promise<void> {
  await page.evaluate(
    (errorKey) =>
      (window as unknown as { __tauriMockRuntime: TauriMockRuntimeControl }).__tauriMockRuntime.clearInvokeError(
        errorKey,
      ),
    key,
  );
}

export async function emitMockFsChange(page: Page, changedDirectories: string[]): Promise<void> {
  await page.waitForFunction(() =>
    (window as unknown as { __tauriMockHasListener?: (event: string) => boolean }).__tauriMockHasListener?.(
      "workspace-fs-change",
    ),
  );
  await page.evaluate((directories) => {
    (
      window as unknown as {
        __emitTauriEvent: (event: string, payload: unknown) => void;
      }
    ).__emitTauriEvent("workspace-fs-change", directories);
  }, changedDirectories);
}

export async function getMockFile(page: Page, path: string): Promise<{ content?: string; lastModified?: number }> {
  return await page.evaluate(
    (filePath) =>
      (window as unknown as { __tauriMockRuntime: TauriMockRuntimeControl }).__tauriMockRuntime.getFile(filePath),
    path,
  );
}
