import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";

import { getActiveEditorView } from "../actions/active-editor";
import { hasConflictMarkers } from "../conflict-parse";
import {
  LARGE_FILE_CHUNK_BYTES,
  LARGE_FILE_CONFIRM_BYTES,
  LARGE_FILE_READONLY_BYTES,
  SUPER_LARGE_FILE_BYTES,
  workspaceFsChangeEvent,
} from "../constants";
import { deleteDraft, writeDraft } from "../drafts";
import { formatText } from "../formatter";
import { translate } from "../i18n-dictionaries";
import {
  buildSessionSnapshot,
  flushActiveViewState,
  saveSession,
  type SessionSnapshot,
  setTabViewState,
} from "../session";
import { useWorkbenchStore } from "../store/workbench-store";
import type {
  NativeDirectoryEntry,
  NativeSavedTextFile,
  NativeTextFile,
  NativeTextFileInspection,
  NativeTextFileRange,
  PendingFileOpen,
  SaveConflict,
  TextEncodingOption,
  WorkbenchDocument,
} from "../types";
import {
  arePathsEqual,
  createUntitledDocument,
  formatFileSize,
  getFileExtension,
  getFileOpenId,
  getNativeSaveError,
  getParentPath,
  getPathName,
  isAbsolutePath,
  isDocumentDirty,
  isTauriRuntime,
  upsertOpenDocument,
} from "../workbench-utils";

export function useDocumentSession() {
  const document = useWorkbenchStore((state) => state.document);
  const setDocument = useWorkbenchStore((state) => state.setDocument);
  const openDocuments = useWorkbenchStore((state) => state.openDocuments);
  const setOpenDocuments = useWorkbenchStore((state) => state.setOpenDocuments);
  const pendingCloseDocument = useWorkbenchStore((state) => state.pendingCloseDocument);
  const setPendingCloseDocument = useWorkbenchStore((state) => state.setPendingCloseDocument);
  const saveConflict = useWorkbenchStore((state) => state.saveConflict);
  const setSaveConflict = useWorkbenchStore((state) => state.setSaveConflict);
  const saveState = useWorkbenchStore((state) => state.saveState);
  const setSaveState = useWorkbenchStore((state) => state.setSaveState);
  const setFileError = useWorkbenchStore((state) => state.setFileError);
  const setFolderView = useWorkbenchStore((state) => state.setFolderView);
  const setGitWorkspace = useWorkbenchStore((state) => state.setGitWorkspace);
  const setLeftPanelOpen = useWorkbenchStore((state) => state.setLeftPanelOpen);

  const diskChangePromptRef = useRef<string | null>(null);
  const isDirty = isDocumentDirty(document);
  const t = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) =>
    translate(useWorkbenchStore.getState().language, key, params);

  const updateOpenDocumentById = (
    documentId: string,
    update: (openDocument: WorkbenchDocument) => WorkbenchDocument,
  ) => {
    setOpenDocuments((currentDocuments) =>
      currentDocuments.map((openDocument) => (openDocument.id === documentId ? update(openDocument) : openDocument)),
    );
  };

  const clearDocumentDiskConflict = (documentId: string) => {
    updateOpenDocumentById(documentId, (openDocument) => ({ ...openDocument, diskConflict: undefined }));
  };

  const activateDocument = (nextDocument: WorkbenchDocument) => {
    setDocument(nextDocument);
    setOpenDocuments((currentDocuments) => upsertOpenDocument(currentDocuments, nextDocument));
    setSaveConflict(nextDocument.diskConflict ?? null);
    setSaveState("saved");
  };

  const focusFailedAutoSaveDocument = (failedDocument: WorkbenchDocument) => {
    const state = useWorkbenchStore.getState();
    if (state.document.id === failedDocument.id) {
      return;
    }

    const fresh = state.openDocuments.find((openDocument) => openDocument.id === failedDocument.id) ?? failedDocument;
    activateDocument(fresh);
  };

  const activateOpenedDocument = (nextDocument: WorkbenchDocument) => {
    setDocument(nextDocument);
    setOpenDocuments((currentDocuments) => {
      const hasOnlyCleanUntitled =
        currentDocuments.length === 1 &&
        currentDocuments[0].isUntitled &&
        currentDocuments[0].content === "" &&
        currentDocuments[0].savedContent === "";

      return hasOnlyCleanUntitled ? [nextDocument] : upsertOpenDocument(currentDocuments, nextDocument);
    });
    setSaveConflict(nextDocument.diskConflict ?? null);
    setSaveState("saved");
  };

  // 在中间编辑区以只读标签打开并排 diff。conflict 时由编辑区切到冲突解决视图。
  const openDiffDoc = (id: string, name: string, file: string, versions: { original: string; modified: string }) => {
    const conflict = hasConflictMarkers(versions.modified);
    activateDocument({
      id,
      name,
      path: `diff://${file}`,
      content: versions.modified,
      savedContent: versions.modified,
      mode: "diff",
      diff: versions,
      conflict,
    });
  };

  // 工作区改动:HEAD ↔ 工作区。同一文件复用同一标签。
  const openDiff = (file: string, versions: { original: string; modified: string }) => {
    openDiffDoc(
      `diff:${file}`,
      `${getPathName(file)}${hasConflictMarkers(versions.modified) ? " · 冲突" : " · diff"}`,
      file,
      versions,
    );
  };

  // 历史提交里某文件的改动:父提交 ↔ 该提交。按 提交+文件 复用标签。
  const openCommitDiff = (hash: string, file: string, versions: { original: string; modified: string }) => {
    openDiffDoc(`diff:${hash}:${file}`, `${getPathName(file)} @ ${hash.slice(0, 7)}`, file, versions);
  };

  const closeDocument = (targetDocument: WorkbenchDocument) => {
    // 走到 closeDocument 关闭未命名文件 = 用户已明确决定丢弃它(空文件 / 弹框里选了「不保存」),删掉草稿。
    // 「退出软件后下次恢复」的草稿由退出流程 / 编辑期缓存写入,不经这里。
    if (targetDocument.isUntitled) {
      void deleteDraft(targetDocument.id);
    }
    const nextDocuments = openDocuments.filter((openDocument) => openDocument.id !== targetDocument.id);

    if (nextDocuments.length === 0) {
      const nextDocument = createUntitledDocument();
      setOpenDocuments([nextDocument]);
      setDocument(nextDocument);
      setSaveConflict(null);
      setSaveState("idle");
      return;
    }

    setOpenDocuments(nextDocuments);

    if (targetDocument.id === document.id) {
      const closedIndex = openDocuments.findIndex((openDocument) => openDocument.id === targetDocument.id);
      const nextDocument = nextDocuments[Math.max(0, Math.min(closedIndex, nextDocuments.length - 1))];
      setDocument(nextDocument);
      setSaveConflict(null);
      setSaveState("saved");
    }
  };

  const requestCloseDocument = (targetDocument: WorkbenchDocument) => {
    // 取最新内容(刚编辑完就关时,传入的对象可能略旧)。
    const latest =
      useWorkbenchStore.getState().openDocuments.find((openDocument) => openDocument.id === targetDocument.id) ??
      targetDocument;

    // 有磁盘冲突:切到该文档让冲突框浮现,交用户解决;解决后再关会正常关闭。不静默覆盖或丢弃。
    if (latest.diskConflict || (saveConflict && latest.id === document.id)) {
      activateDocument(latest);
      return;
    }

    // 已有本地归宿的脏文件:静默存盘后关闭(有自动保存了,不再弹框)。
    if (!latest.isUntitled && isAbsolutePath(latest.path) && latest.mode === "editable" && isDocumentDirty(latest)) {
      void autoSaveDiskDocument(latest).then((saved) => {
        if (saved) {
          closeDocument(latest);
          return;
        }

        focusFailedAutoSaveDocument(latest);
      });
      return;
    }

    // 未命名且有内容(还没有本地文件):关这个 tab = 要丢掉它,得让用户先决定(保存 / 放弃),不能直接关。
    // 注意:整个软件退出走的是另一条路(persistAllForQuit + 下次启动恢复),不在此拦截。
    if (latest.isUntitled && latest.content.trim() !== "") {
      activateDocument(latest);
      setPendingCloseDocument(latest);
      return;
    }

    // 干净文件 / 空的未命名:直接关闭。
    closeDocument(latest);
  };

  const saveAndClosePendingDocument = async () => {
    const targetDocument = pendingCloseDocument;
    if (!targetDocument) {
      return;
    }

    activateDocument(targetDocument);
    const savedDocument = await saveDocument();
    if (!savedDocument) {
      return; // 保存被取消 / 失败:保持打开
    }

    setPendingCloseDocument(null);
    closeDocument(savedDocument);
  };

  const saveAsAndClosePendingDocument = async () => {
    const targetDocument = pendingCloseDocument;
    if (!targetDocument) {
      return;
    }

    activateDocument(targetDocument);
    const savedDocument = await saveDocumentAs(targetDocument.content);
    if (!savedDocument) {
      return;
    }

    setPendingCloseDocument(null);
    closeDocument(savedDocument);
  };

  const createFile = () => {
    setFileError(null);
    setLeftPanelOpen(false);
    setFolderView(null);
    setGitWorkspace({ kind: "idle" });
    setSaveConflict(null);
    setSaveState("idle");
    activateDocument(createUntitledDocument());
  };

  const applySavedDocument = (savedFile: NativeSavedTextFile, content: string): WorkbenchDocument => {
    // 未命名文件落盘成真实文件后,清掉它的草稿缓存(已有归宿,不再需要恢复)。
    if (document.isUntitled) {
      void deleteDraft(document.id);
    }
    const shouldPreserveDocumentId = !document.isUntitled && arePathsEqual(document.path, savedFile.path);
    const nextDocument = {
      ...document,
      id: shouldPreserveDocumentId ? document.id : getFileOpenId(savedFile.path, savedFile.lastModified),
      name: savedFile.name,
      path: savedFile.path,
      content,
      savedContent: content,
      diskConflict: undefined,
      size: savedFile.size,
      lastModified: savedFile.lastModified ?? undefined,
      encoding: savedFile.encoding,
      encodingLabel: savedFile.encodingLabel,
      hasBom: savedFile.hasBom,
      isUntitled: false,
      mode: "editable",
      range: undefined,
    } satisfies WorkbenchDocument;

    setDocument(nextDocument);
    setOpenDocuments((currentDocuments) => {
      if (shouldPreserveDocumentId) {
        return upsertOpenDocument(currentDocuments, nextDocument);
      }

      const withoutPreviousDocument = currentDocuments.filter((openDocument) => openDocument.id !== document.id);

      return upsertOpenDocument(withoutPreviousDocument, nextDocument);
    });
    setSaveConflict(null);
    setSaveState("saved");
    setFileError(null);

    return nextDocument;
  };

  const applyReloadedDocument = (file: NativeTextFile): WorkbenchDocument => {
    const nextDocument = {
      ...document,
      name: file.name,
      path: file.path,
      content: file.content,
      savedContent: file.content,
      diskConflict: undefined,
      size: file.size,
      lastModified: file.lastModified ?? undefined,
      encoding: file.encoding,
      encodingLabel: file.encodingLabel,
      encodingCandidates: file.encodingCandidates,
      hasBom: file.hasBom,
      isUntitled: false,
      mode: "editable",
      range: undefined,
    } satisfies WorkbenchDocument;

    setDocument(nextDocument);
    setOpenDocuments((currentDocuments) => upsertOpenDocument(currentDocuments, nextDocument));
    setSaveConflict(null);
    setSaveState("saved");
    setFileError(null);

    return nextDocument;
  };

  const replaceCurrentDocument = (nextDocument: WorkbenchDocument) => {
    setDocument(nextDocument);
    setOpenDocuments((currentDocuments) => upsertOpenDocument(currentDocuments, nextDocument));
  };

  const saveDocumentAs = async (contentOverride?: string): Promise<WorkbenchDocument | null> => {
    if (document.mode === "large-readonly") {
      setSaveState("error");
      setFileError(t("editor.largeFileReadOnlySaveError"));
      return null;
    }

    if (!isTauriRuntime()) {
      setSaveState("error");
      setFileError(t("editor.nativeSavingDesktopOnly"));
      return null;
    }

    try {
      const path = await invoke<string | null>("open_save_dialog", { defaultName: document.name });

      if (!path) {
        setSaveState(document.content !== document.savedContent ? "idle" : "saved");
        return null;
      }

      const content = contentOverride ?? document.content;
      setSaveState("saving");
      setFileError(null);

      const savedFile = await invoke<NativeSavedTextFile>("save_text_file_as", {
        path,
        content,
        encoding: document.encoding ?? "utf-8",
        hasBom: document.hasBom ?? false,
      });

      return applySavedDocument(savedFile, content);
    } catch (error) {
      const saveError = getNativeSaveError(error);
      setSaveState("error");
      setFileError(saveError.message ?? t("editor.unableSave"));
      return null;
    }
  };

  const saveDocument = async (options: { force?: boolean } = {}): Promise<WorkbenchDocument | null> => {
    if (saveState === "saving") {
      return null;
    }

    if (saveConflict && !options.force) {
      setSaveState("idle");
      return null;
    }

    if (document.mode === "large-readonly") {
      setSaveState("error");
      setFileError(t("editor.largeFileReadOnlySaveError"));
      return null;
    }

    if (document.isUntitled || !isAbsolutePath(document.path)) {
      return await saveDocumentAs();
    }

    if (!isTauriRuntime()) {
      setSaveState("error");
      setFileError(t("editor.nativeSavingDesktopOnly"));
      return null;
    }

    // 保存时整理(formatOnSave):按文件类型就地整理,并同步进编辑器,使显示与落盘一致。
    let content = document.content;
    if (useWorkbenchStore.getState().editorFormatOnSave) {
      const formatted = formatText(content, getFileExtension(document.path));
      if (formatted !== content) {
        content = formatted;
        const view = getActiveEditorView();
        view?.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: formatted } });
      }
    }
    setSaveState("saving");
    setFileError(null);

    try {
      const savedFile = await invoke<NativeSavedTextFile>("save_text_file", {
        path: document.path,
        content,
        expectedLastModified: options.force ? null : (document.lastModified ?? null),
        force: options.force ?? false,
        encoding: document.encoding ?? "utf-8",
        hasBom: document.hasBom ?? false,
      });

      return applySavedDocument(savedFile, content);
    } catch (error) {
      const saveError = getNativeSaveError(error);

      if (saveError.kind === "deleted") {
        setSaveState("idle");
        setFileError(saveError.message ?? t("editor.originalDeletedSaveAs"));
        return await saveDocumentAs(content);
      }

      if (saveError.kind === "modified") {
        setSaveState("idle");
        setSaveConflict({
          content,
          lastModified: document.lastModified,
          message: saveError.message ?? t("editor.changedOutside"),
          path: document.path,
        });
        return null;
      }

      setSaveState("error");
      setFileError(saveError.message ?? t("editor.unableSave"));
      return null;
    }
  };

  const reloadConflictedDocument = async () => {
    const conflict = saveConflict;

    if (!conflict) {
      return;
    }

    if (conflict.diskMissing) {
      return;
    }

    setSaveConflict(null);
    clearDocumentDiskConflict(document.id);
    await openNativeFile(conflict.path);
  };

  const showDeletedDocumentConflict = (message?: string) => {
    const latestDocument = useWorkbenchStore.getState().document;

    setSaveState("idle");
    setSaveConflict({
      content: latestDocument.content,
      diskMissing: true,
      lastModified: latestDocument.lastModified,
      message: message ?? t("editor.deletedOnDisk"),
      path: latestDocument.path,
    });
  };

  const resolveRenamedDocument = async (): Promise<boolean> => {
    const parentPath = getParentPath(document.path);

    if (!parentPath || typeof document.size !== "number") {
      return false;
    }

    const entries = await invoke<NativeDirectoryEntry[]>("list_directory", { path: parentPath });
    const candidates = entries.filter((entry) => {
      if (entry.kind !== "file" || arePathsEqual(entry.path, document.path)) {
        return false;
      }

      const sameSize = entry.size === document.size;
      const knownDocumentMtime = typeof document.lastModified === "number";
      const knownEntryMtime = typeof entry.lastModified === "number";
      const closeMtime =
        knownDocumentMtime && knownEntryMtime ? Math.abs(entry.lastModified! - document.lastModified!) <= 2000 : true;

      return sameSize && closeMtime;
    });

    if (candidates.length !== 1) {
      return false;
    }

    const renamedEntry = candidates[0];
    setDocument((currentDocument) => {
      if (!arePathsEqual(currentDocument.path, document.path)) {
        return currentDocument;
      }

      return {
        ...currentDocument,
        id: currentDocument.id,
        name: renamedEntry.name,
        path: renamedEntry.path,
        lastModified: renamedEntry.lastModified ?? currentDocument.lastModified,
      };
    });
    setOpenDocuments((currentDocuments) =>
      currentDocuments.map((openDocument) =>
        openDocument.id === document.id
          ? {
              ...openDocument,
              name: renamedEntry.name,
              path: renamedEntry.path,
              lastModified: renamedEntry.lastModified ?? openDocument.lastModified,
            }
          : openDocument,
      ),
    );
    setSaveConflict(null);

    return true;
  };

  const checkOpenDocumentsOnDisk = async (changedDirectories?: string[]) => {
    if (!isTauriRuntime()) {
      return;
    }

    const state = useWorkbenchStore.getState();
    const activeDocumentId = state.document.id;

    for (const openDocument of state.openDocuments) {
      if (
        openDocument.id === activeDocumentId ||
        openDocument.isUntitled ||
        openDocument.mode !== "editable" ||
        !isAbsolutePath(openDocument.path)
      ) {
        continue;
      }

      const parentPath = getParentPath(openDocument.path);

      if (
        changedDirectories &&
        (!parentPath || !changedDirectories.some((changedDir) => arePathsEqual(changedDir, parentPath)))
      ) {
        continue;
      }

      try {
        const inspection = await invoke<NativeTextFileInspection>("inspect_text_file", { path: openDocument.path });
        const diskLastModified = inspection.lastModified ?? undefined;

        if (!diskLastModified || !openDocument.lastModified || diskLastModified === openDocument.lastModified) {
          if (openDocument.diskConflict) {
            updateOpenDocumentById(openDocument.id, (currentDocument) => ({
              ...currentDocument,
              diskConflict: undefined,
            }));
          }
          continue;
        }

        const openDocumentIsDirty = isDocumentDirty(openDocument);

        if (!openDocumentIsDirty && inspection.isText && !inspection.isBinary) {
          const file = await invoke<NativeTextFile>("read_text_file", { path: openDocument.path });
          updateOpenDocumentById(openDocument.id, (currentDocument) => ({
            ...currentDocument,
            name: file.name,
            path: file.path,
            content: file.content,
            savedContent: file.content,
            diskConflict: undefined,
            size: file.size,
            lastModified: file.lastModified ?? undefined,
            encoding: file.encoding,
            encodingLabel: file.encodingLabel,
            encodingCandidates: file.encodingCandidates,
            hasBom: file.hasBom,
            mode: "editable",
            range: undefined,
          }));
          continue;
        }

        let diskContent: string | undefined;

        if (inspection.isText && !inspection.isBinary) {
          try {
            const file = await invoke<NativeTextFile>("read_text_file", { path: openDocument.path });
            diskContent = file.content;
          } catch {
            diskContent = undefined;
          }
        }

        updateOpenDocumentById(openDocument.id, (currentDocument) => ({
          ...currentDocument,
          diskConflict: {
            content: currentDocument.content,
            diskContent,
            diskLastModified,
            lastModified: currentDocument.lastModified,
            message: t("editor.changedOutsideWithLocalEdits"),
            path: currentDocument.path,
          },
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (/not found|no such file|cannot find|does not exist/i.test(message)) {
          updateOpenDocumentById(openDocument.id, (currentDocument) => ({
            ...currentDocument,
            diskConflict: {
              content: currentDocument.content,
              diskMissing: true,
              lastModified: currentDocument.lastModified,
              message: message ?? t("editor.deletedOnDisk"),
              path: currentDocument.path,
            },
          }));
        }
      }
    }
  };

  const checkCurrentDocumentOnDisk = async () => {
    if (
      !isTauriRuntime() ||
      saveConflict ||
      saveState === "saving" ||
      document.isUntitled ||
      document.mode !== "editable" ||
      !isAbsolutePath(document.path)
    ) {
      return;
    }

    try {
      const inspection = await invoke<NativeTextFileInspection>("inspect_text_file", { path: document.path });
      const diskLastModified = inspection.lastModified ?? undefined;

      if (!diskLastModified || !document.lastModified || diskLastModified === document.lastModified) {
        diskChangePromptRef.current = null;
        return;
      }

      const promptKey = `${document.path}-${diskLastModified}-${document.lastModified}`;

      if (diskChangePromptRef.current === promptKey) {
        return;
      }

      diskChangePromptRef.current = promptKey;
      const latestDocument = useWorkbenchStore.getState().document;
      const latestIsDirty = isDocumentDirty(latestDocument);

      if (!latestIsDirty && arePathsEqual(latestDocument.path, document.path)) {
        if (inspection.isBinary || !inspection.isText) {
          setSaveState("error");
          setFileError(t("editor.changedUnsupported", { name: inspection.name }));
          return;
        }

        const file = await invoke<NativeTextFile>("read_text_file", { path: document.path });
        const documentBeforeReload = useWorkbenchStore.getState().document;

        if (isDocumentDirty(documentBeforeReload) || !arePathsEqual(documentBeforeReload.path, document.path)) {
          setSaveState("idle");
          setSaveConflict({
            content: documentBeforeReload.content,
            diskContent: file.content,
            diskLastModified: file.lastModified ?? undefined,
            lastModified: documentBeforeReload.lastModified,
            message: t("editor.changedOutsideWithLocalEdits"),
            path: document.path,
          });
          return;
        }

        applyReloadedDocument(file);
        return;
      }

      setSaveState("idle");
      let diskContent: string | undefined;

      if (inspection.isText && !inspection.isBinary) {
        try {
          const file = await invoke<NativeTextFile>("read_text_file", { path: document.path });
          diskContent = file.content;
        } catch {
          diskContent = undefined;
        }
      }

      setSaveConflict({
        content: latestDocument.content,
        diskContent,
        diskLastModified: diskLastModified,
        lastModified: latestDocument.lastModified,
        message: t("editor.changedOutsideWithLocalEdits"),
        path: document.path,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (/not found|no such file|cannot find|does not exist/i.test(message)) {
        try {
          const renamed = await resolveRenamedDocument();

          if (renamed) {
            return;
          }
        } catch {
          // Fall through to deleted-file conflict when the parent directory cannot be inspected.
        }

        showDeletedDocumentConflict(message);
      }
    }
  };

  const openNativeFile = async (path: string, options: { clearFolderView?: boolean; size?: number } = {}) => {
    const { clearFolderView = false, size } = options;

    setFileError(null);
    setSaveConflict(null);

    try {
      const openDocument = openDocuments.find((currentDocument) => currentDocument.path === path);

      if (openDocument) {
        activateDocument(openDocument);

        if (clearFolderView) {
          setFolderView(null);
          setLeftPanelOpen(false);
        }

        return;
      }

      const inspection = await invoke<NativeTextFileInspection>("inspect_text_file", { path });

      if (inspection.isBinary || !inspection.isText) {
        setFileError(t("editor.unsupportedEncoding", { name: inspection.name }));
        return;
      }

      if (inspection.size > LARGE_FILE_READONLY_BYTES) {
        const rangeOffset =
          inspection.size > SUPER_LARGE_FILE_BYTES ? Math.max(0, inspection.size - LARGE_FILE_CHUNK_BYTES) : 0;
        const range = await invoke<NativeTextFileRange>("read_text_file_range", {
          path,
          offset: rangeOffset,
          length: LARGE_FILE_CHUNK_BYTES,
        });
        const contentPrefix = range.hasMoreBefore ? `${t("editor.largeFileOmittedBefore")}\n\n` : "";
        const contentSuffix = range.hasMoreAfter ? `\n\n${t("editor.largeFileOmittedAfter")}` : "";
        const rangeContent = `${contentPrefix}${range.content}${contentSuffix}`;

        activateOpenedDocument({
          id: getFileOpenId(inspection.path, inspection.lastModified),
          name: inspection.name,
          path: inspection.path,
          content: rangeContent,
          savedContent: rangeContent,
          size: inspection.size,
          lastModified: inspection.lastModified ?? undefined,
          encoding: range.encoding,
          encodingLabel: range.encodingLabel,
          encodingCandidates: range.encodingCandidates,
          hasBom: range.hasBom,
          mode: "large-readonly",
          range: {
            endOffset: range.endOffset,
            hasMoreAfter: range.hasMoreAfter,
            hasMoreBefore: range.hasMoreBefore,
            startOffset: range.startOffset,
          },
        });
        setSaveState("saved");

        if (clearFolderView) {
          setFolderView(null);
          setLeftPanelOpen(false);
        }

        return;
      }

      if ((typeof size === "number" ? size : inspection.size) > LARGE_FILE_CONFIRM_BYTES) {
        const shouldOpen = window.confirm(t("editor.largeFileConfirm", { size: formatFileSize(inspection.size) }));

        if (!shouldOpen) {
          return;
        }
      }

      const file = await invoke<NativeTextFile>("read_text_file", { path });

      activateOpenedDocument({
        id: getFileOpenId(file.path, file.lastModified),
        name: file.name,
        path: file.path,
        content: file.content,
        savedContent: file.content,
        size: file.size,
        lastModified: file.lastModified ?? undefined,
        encoding: file.encoding,
        encodingLabel: file.encodingLabel,
        encodingCandidates: file.encodingCandidates,
        hasBom: file.hasBom,
        mode: "editable",
      });
      setSaveState("saved");

      if (clearFolderView) {
        setFolderView(null);
        setLeftPanelOpen(false);
      }
    } catch (error) {
      setFileError(error instanceof Error ? error.message : String(error));
    }
  };

  const changeDocumentEncoding = async (option: TextEncodingOption) => {
    const currentDocument = useWorkbenchStore.getState().document;

    if (currentDocument.mode === "large-readonly") {
      setFileError(t("editor.largeFileReadOnlyEncodingError"));
      return;
    }

    if (currentDocument.isUntitled || !isAbsolutePath(currentDocument.path) || isDocumentDirty(currentDocument)) {
      const nextDocument = {
        ...currentDocument,
        encoding: option.value,
        encodingLabel: option.label,
        encodingCandidates: currentDocument.encodingCandidates,
        hasBom: option.hasBom ?? false,
      } satisfies WorkbenchDocument;

      replaceCurrentDocument(nextDocument);
      setSaveState("idle");
      setFileError(null);
      return;
    }

    if (!isTauriRuntime()) {
      setFileError(t("editor.nativeEncodingDesktopOnly"));
      return;
    }

    setSaveState("saving");
    setFileError(null);
    setSaveConflict(null);

    try {
      const file = await invoke<NativeTextFile>("read_text_file", {
        path: currentDocument.path,
        encoding: option.value,
      });
      const nextDocument = {
        ...currentDocument,
        name: file.name,
        path: file.path,
        content: file.content,
        savedContent: file.content,
        diskConflict: undefined,
        size: file.size,
        lastModified: file.lastModified ?? undefined,
        encoding: option.value,
        encodingLabel: option.label,
        encodingCandidates: file.encodingCandidates,
        hasBom: option.hasBom ?? file.hasBom,
        mode: "editable",
        range: undefined,
      } satisfies WorkbenchDocument;

      replaceCurrentDocument(nextDocument);
      setSaveState("saved");
    } catch (error) {
      setSaveState("error");
      setFileError(error instanceof Error ? error.message : String(error));
    }
  };

  const continueFileOpen = async (pendingOpen: PendingFileOpen) => {
    if (pendingOpen.kind === "path") {
      await openNativeFile(pendingOpen.path, {
        clearFolderView: pendingOpen.clearFolderView,
        size: pendingOpen.size,
      });
      return;
    }

    if (!isTauriRuntime()) {
      setFileError(t("editor.nativeOpeningDesktopOnly"));
      return;
    }

    try {
      const path = await invoke<string | null>("open_file_dialog");

      if (path) {
        await openNativeFile(path, { clearFolderView: true });
      }
    } catch (error) {
      setFileError(error instanceof Error ? error.message : String(error));
    }
  };

  const requestFileOpen = (pendingOpen: PendingFileOpen) => {
    void continueFileOpen(pendingOpen);
  };

  const openFilePicker = () => {
    requestFileOpen({ kind: "file-dialog" });
  };

  const updateDocumentContent = (content: string) => {
    const currentDocument = useWorkbenchStore.getState().document;

    if (currentDocument.content !== content) {
      const nextDocument = { ...currentDocument, content };
      setDocument(nextDocument);
      setOpenDocuments((currentDocuments) => upsertOpenDocument(currentDocuments, nextDocument));
    }

    setSaveState((currentState) => (currentState === "saving" ? currentState : "idle"));
  };

  // 静默自动保存某个「已存盘」文档:直接写盘,再按 id 就地更新 savedContent/mtime。
  // 不走 saveDocument —— 后者会跑格式化、重建整份文档对象、清冲突/错误态,触发编辑器重渲染(闪一下);
  // 这里只改元数据、不动 id/name/content,编辑器完全不受影响。任何文档(含非活动)都能存。
  const autoSaveDiskDocument = async (doc: WorkbenchDocument): Promise<boolean> => {
    if (
      doc.isUntitled ||
      !isAbsolutePath(doc.path) ||
      doc.mode !== "editable" ||
      doc.diskConflict ||
      !isDocumentDirty(doc)
    ) {
      return !doc.diskConflict;
    }
    // 活动文档若正处于冲突态,交给冲突流程,别静默覆盖。
    const store = useWorkbenchStore.getState();
    if (store.saveConflict && store.document.id === doc.id) {
      return false;
    }

    const content = doc.content;
    try {
      const saved = await invoke<NativeSavedTextFile>("save_text_file", {
        path: doc.path,
        content,
        expectedLastModified: doc.lastModified ?? null,
        force: false,
        encoding: doc.encoding ?? "utf-8",
        hasBom: doc.hasBom ?? false,
      });
      // 始终同步 mtime(让磁盘监听认得这是我们自己的写,不误判为外部改动);
      // savedContent 仅在期间未再编辑时才标记为已保存,否则保持脏、下次再存。
      const patch = (target: WorkbenchDocument): WorkbenchDocument =>
        target.id !== doc.id
          ? target
          : {
              ...target,
              lastModified: saved.lastModified ?? target.lastModified,
              size: saved.size,
              savedContent: target.content === content ? content : target.savedContent,
            };
      updateOpenDocumentById(doc.id, patch);
      setDocument((current) => patch(current));
      return true;
    } catch (error) {
      const saveError = getNativeSaveError(error);
      const conflict: SaveConflict = {
        content,
        diskMissing: saveError.kind === "deleted" ? true : undefined,
        lastModified: doc.lastModified,
        message: saveError.message ?? t("editor.unableSave"),
        path: doc.path,
      };

      setSaveState("idle");
      if (useWorkbenchStore.getState().document.id === doc.id) {
        setSaveConflict(conflict);
      } else {
        updateOpenDocumentById(doc.id, (currentDocument) => ({ ...currentDocument, diskConflict: conflict }));
      }
      return false;
    }
  };

  // 未命名文件(只在内存里)缓存成草稿;空文件不缓存并清掉旧草稿。
  const cacheUntitledDraft = (doc: WorkbenchDocument) => {
    if (!doc.isUntitled || doc.mode !== "editable") {
      return;
    }
    if (doc.content.trim() === "") {
      void deleteDraft(doc.id);
      return;
    }
    void writeDraft({ id: doc.id, name: doc.name, content: doc.content, encoding: doc.encoding, hasBom: doc.hasBom });
  };

  // 编辑告一段落(失焦 / 切后台 / 切文件 / 停编辑 2s)时:存盘 or 缓存草稿。每个文档独立处理。
  const persistDocument = (doc: WorkbenchDocument) => {
    void autoSaveDiskDocument(doc);
    cacheUntitledDraft(doc);
  };
  const persistActiveDocument = () => persistDocument(useWorkbenchStore.getState().document);

  // 退出前尽力保存所有文档:已存盘的写盘,未命名的存草稿(下次启动恢复)。返回 Promise 供退出流程 await。
  const persistAllForQuit = async (): Promise<boolean> => {
    const docs = useWorkbenchStore.getState().openDocuments;
    for (const doc of docs) {
      if (doc.isUntitled) {
        if (doc.mode !== "editable") continue;
        if (doc.content.trim() === "") {
          await deleteDraft(doc.id);
        } else {
          await writeDraft({
            id: doc.id,
            name: doc.name,
            content: doc.content,
            encoding: doc.encoding,
            hasBom: doc.hasBom,
          });
        }
        continue;
      }

      const saved = await autoSaveDiskDocument(doc);
      if (!saved) {
        focusFailedAutoSaveDocument(doc);
        return false;
      }
    }
    persistSession();
    return true;
  };

  // 会话快照:记录打开的文件夹、所有可恢复 tab(顺序)、活动 tab 及每个 tab 的视图状态。失焦/切后台/退出时写。
  const persistSession = () => {
    flushActiveViewState(); // 先把当前活动 tab 的光标/滚动/查找框刷进视图状态表
    const state = useWorkbenchStore.getState();
    saveSession(
      buildSessionSnapshot({
        openDocuments: state.openDocuments,
        activeId: state.document.id,
        folderPath: state.folderView?.rootPath ?? null,
      }),
    );
  };

  // 启动恢复:占位 tab 读盘失败(文件被删)时移除;若删到一个不剩,补一个空白未命名,避免编辑区为空。
  const dropRestoredTab = (id: string) => {
    const remaining = useWorkbenchStore.getState().openDocuments.filter((doc) => doc.id !== id);
    const nextDocuments = remaining.length > 0 ? remaining : [createUntitledDocument()];
    setOpenDocuments(nextDocuments);
    setDocument((current) => (current.id === id ? nextDocuments[0] : current));
  };

  // 把「已存盘占位」tab 的内容读盘就地填入(保持 tab 位置与 id 不变)。二进制/超大/被删则移除该 tab。
  const fillRestoredTab = async (id: string, path: string) => {
    try {
      const inspection = await invoke<NativeTextFileInspection>("inspect_text_file", { path });
      if (inspection.isBinary || !inspection.isText || inspection.size > LARGE_FILE_READONLY_BYTES) {
        dropRestoredTab(id);
        return;
      }
      const file = await invoke<NativeTextFile>("read_text_file", { path });
      const patch = (doc: WorkbenchDocument): WorkbenchDocument => ({
        ...doc,
        name: file.name,
        content: file.content,
        savedContent: file.content,
        size: file.size,
        lastModified: file.lastModified ?? undefined,
        encoding: file.encoding,
        encodingLabel: file.encodingLabel,
        encodingCandidates: file.encodingCandidates,
        hasBom: file.hasBom,
        mode: "editable",
        pendingRestore: undefined,
      });
      updateOpenDocumentById(id, patch);
      setDocument((current) => (current.id === id ? patch(current) : current));
    } catch {
      dropRestoredTab(id); // 文件已被外部删除等 → 悄悄丢弃该 tab
    }
  };

  // 按上次会话重建 tab 列表(保持顺序):草稿 tab 复用首帧已种入的草稿文档,已存盘 tab 先放占位再逐个读盘。
  const restoreSessionTabs = async (session: SessionSnapshot) => {
    if (session.tabs.length === 0) {
      return;
    }
    for (const tab of session.tabs) {
      if (tab.view) setTabViewState(tab.id, tab.view); // 视图状态回填内存表,供还原光标/滚动/查找框
    }
    const existing = useWorkbenchStore.getState().openDocuments;
    const restored: WorkbenchDocument[] = [];
    for (const tab of session.tabs) {
      if (tab.path) {
        restored.push({
          id: tab.id,
          name: tab.name ?? getPathName(tab.path),
          path: tab.path,
          content: "",
          savedContent: "",
          isUntitled: false,
          mode: "editable",
          pendingRestore: true,
        });
      } else {
        const draftDocument = existing.find((doc) => doc.id === tab.id);
        if (draftDocument) restored.push(draftDocument); // 草稿内容已由 main.tsx 首帧种入
      }
    }
    if (restored.length === 0) {
      return;
    }
    const active = restored.find((doc) => doc.id === session.activeId) ?? restored[0];
    setOpenDocuments(restored);
    setDocument(active);
    for (const placeholder of restored) {
      if (placeholder.pendingRestore && placeholder.path) {
        await fillRestoredTab(placeholder.id, placeholder.path);
      }
    }
  };

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let disposed = false;
    let unlisten: UnlistenFn | undefined;

    const handleFocus = () => {
      void checkCurrentDocumentOnDisk();
      void checkOpenDocumentsOnDisk();
    };
    const handleBlur = () => {
      persistActiveDocument();
      persistSession();
    };
    const handleVisibilityChange = () => {
      if (globalThis.document.hidden) {
        persistActiveDocument();
        persistSession();
        return;
      }
      void checkCurrentDocumentOnDisk();
      void checkOpenDocumentsOnDisk();
    };
    const intervalId = window.setInterval(() => {
      void checkCurrentDocumentOnDisk();
      void checkOpenDocumentsOnDisk();
    }, 1500);

    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);
    globalThis.document.addEventListener("visibilitychange", handleVisibilityChange);
    listen<string[]>(workspaceFsChangeEvent, (event) => {
      const parentPath = getParentPath(document.path);

      if (!parentPath) {
        return;
      }

      if (event.payload.some((changedDir) => arePathsEqual(changedDir, parentPath))) {
        void checkCurrentDocumentOnDisk();
      }

      void checkOpenDocumentsOnDisk(event.payload);
    })
      .then((cleanup) => {
        if (disposed) {
          cleanup();
          return;
        }

        unlisten = cleanup;
      })
      .catch(() => {
        unlisten = undefined;
      });

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
      globalThis.document.removeEventListener("visibilitychange", handleVisibilityChange);
      unlisten?.();
    };
  }, [
    document.path,
    document.lastModified,
    document.content,
    document.mode,
    document.isUntitled,
    isDirty,
    saveConflict,
    saveState,
  ]);

  // 停止编辑约 2s 后自动保存当前文件 / 缓存草稿。document.id 进 deps → 切文件即重置计时,每个文件独立。
  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }
    const timer = window.setTimeout(() => persistActiveDocument(), 2000);
    return () => window.clearTimeout(timer);
  }, [document.content, document.id]);

  // 切换文件(失去焦点的那个文件)时立即保存它:从 openDocuments 取它的最新内容,避免丢改动。
  const previousDocumentIdRef = useRef(document.id);
  useEffect(() => {
    const previousId = previousDocumentIdRef.current;
    previousDocumentIdRef.current = document.id;
    if (previousId === document.id || !isTauriRuntime()) {
      return;
    }
    const leaving = useWorkbenchStore.getState().openDocuments.find((openDocument) => openDocument.id === previousId);
    if (leaving) {
      persistDocument(leaving);
    }
  }, [document.id]);

  // 草稿恢复已移到首帧渲染前(见 main.tsx 的 seedRestoredDrafts),这里不再异步载入,避免「文字重新加载」闪烁。

  // Ctrl/Cmd+S 已迁移到全局快捷键分发器(actions/use-keybindings),此处不再单独监听。

  return {
    activateDocument,
    openDiff,
    openCommitDiff,
    closeDocument,
    requestCloseDocument,
    saveAndClosePendingDocument,
    saveAsAndClosePendingDocument,
    createFile,
    saveDocumentAs,
    saveDocument,
    reloadConflictedDocument,
    openFilePicker,
    requestFileOpen,
    updateDocumentContent,
    changeDocumentEncoding,
    persistAllForQuit,
    restoreSessionTabs,
  };
}
