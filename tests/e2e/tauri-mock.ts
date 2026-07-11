import type { Page } from "@playwright/test";

export type TauriMockScenario = {
  directories?: Record<string, Array<Record<string, unknown>>>;
  fileContents?: Record<string, string>;
  fileLastModified?: Record<string, number>;
  fileInspections?: Record<string, Partial<MockTextFileInspection>>;
  folderDialogPath?: string | null;
  fileDialogPath?: string | null;
  saveDialogPath?: string | null;
  gitInspection?: Record<string, unknown>;
  invokeErrors?: Record<string, unknown>;
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
      { name: "large.txt", path: "/mock/project/large.txt", relativePath: "large.txt", kind: "file", size: 6 * 1024 * 1024 },
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
      { name: "readonly.txt", path: "/mock/project/readonly.txt", relativePath: "readonly.txt", kind: "file", size: 32 },
    ],
    "/mock/scratch": [],
  },
  fileContents: {
    "/mock/project/binary.bin": "",
    "/mock/project/latin1.txt": "",
    "/mock/project/readonly.txt": "readonly content\n",
  },
  fileInspections: {
    "/mock/project/binary.bin": { isBinary: true, isUtf8: false },
    "/mock/project/latin1.txt": { isBinary: false, isUtf8: false },
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
      { name: "conflict.txt", path: "/mock/project/conflict.txt", relativePath: "conflict.txt", kind: "file", size: 17 },
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

    const fileInspections = clone(mockScenario.fileInspections ?? {}) as Record<string, Partial<MockTextFileInspection>>;
    const invokeErrors = clone(mockScenario.invokeErrors ?? {}) as Record<string, unknown>;

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
        case "open_folder_dialog":
          return mockScenario.folderDialogPath === undefined ? "/mock/project" : mockScenario.folderDialogPath;
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
        case "list_drafts":
          return [];
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
          const endOffset = Math.min(virtualSize, startOffset + Math.max(rangeContent.length, Math.min(length, virtualSize)));
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
          fileContents[path] = content;
          return { name: baseName(path), path, size: content.length, lastModified: lastModifiedFor(path) };
        }
        case "save_text_file_as": {
          const path = String(args.path);
          const content = String(args.content ?? "");
          fileContents[path] = content;
          fileLastModified[path] = lastModifiedFor(path);
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
          const entry = { name, path, relativePath: relativeTo(workspaceRoot, path), kind: "file", size: 0, lastModified: fileLastModified[path] };
          (directories[parentPath] ??= []).push({ ...entry });
          return entry;
        }
        case "create_directory": {
          const workspaceRoot = String(args.workspaceRoot ?? "/mock/project");
          const parentPath = String(args.parentPath ?? "/mock/project");
          const name = String(args.name ?? "untitled");
          const path = `${parentPath}/${name}`;
          const entry = { name, path, relativePath: relativeTo(workspaceRoot, path), kind: "directory", size: null, lastModified: lastModifiedFor(path) };
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
          const entry = { name: newName, path: newPath, relativePath: relativeTo(workspaceRoot, newPath), kind, size: removed?.size ?? (kind === "file" ? contentLengthFor(newPath) : null), lastModified: lastModifiedFor(newPath) };
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
          const entry = { name, path: newPath, relativePath: relativeTo(workspaceRoot, newPath), kind, size: removed?.size ?? (kind === "file" ? contentLengthFor(newPath) : null), lastModified: lastModifiedFor(newPath) };
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
          const entry = { name, path: newPath, relativePath: relativeTo(workspaceRoot, newPath), kind, size: source?.size ?? (kind === "file" ? contentLengthFor(newPath) : null), lastModified: lastModifiedFor(newPath) };
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
        try {
          return Promise.resolve(route(cmd, args));
        } catch (error) {
          return Promise.reject(error);
        }
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
