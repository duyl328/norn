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
import { formatText } from "../formatter";
import { translate } from "../i18n-dictionaries";
import { useWorkbenchStore } from "../store/workbench-store";
import type {
  NativeDirectoryEntry,
  NativeSavedTextFile,
  NativeTextFile,
  NativeTextFileInspection,
  NativeTextFileRange,
  PendingFileOpen,
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
  const openDiffDoc = (
    id: string,
    name: string,
    file: string,
    versions: { original: string; modified: string },
  ) => {
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
    openDiffDoc(`diff:${file}`, `${getPathName(file)}${hasConflictMarkers(versions.modified) ? " · 冲突" : " · diff"}`, file, versions);
  };

  // 历史提交里某文件的改动:父提交 ↔ 该提交。按 提交+文件 复用标签。
  const openCommitDiff = (hash: string, file: string, versions: { original: string; modified: string }) => {
    openDiffDoc(`diff:${hash}:${file}`, `${getPathName(file)} @ ${hash.slice(0, 7)}`, file, versions);
  };

  const closeDocument = (targetDocument: WorkbenchDocument) => {
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

  const requiresCloseConfirmation = (targetDocument: WorkbenchDocument) =>
    isDocumentDirty(targetDocument) || (targetDocument.isUntitled && targetDocument.content.length > 0);

  const requestCloseDocument = (targetDocument: WorkbenchDocument) => {
    if (requiresCloseConfirmation(targetDocument)) {
      activateDocument(targetDocument);
      setPendingCloseDocument(targetDocument);
      return;
    }

    closeDocument(targetDocument);
  };

  const saveAndClosePendingDocument = async () => {
    const targetDocument = pendingCloseDocument;

    if (!targetDocument) {
      return;
    }

    activateDocument(targetDocument);
    const savedDocument = await saveDocument();

    if (!savedDocument) {
      return;
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
    const handleVisibilityChange = () => {
      if (!globalThis.document.hidden) {
        void checkCurrentDocumentOnDisk();
        void checkOpenDocumentsOnDisk();
      }
    };
    const intervalId = window.setInterval(() => {
      void checkCurrentDocumentOnDisk();
      void checkOpenDocumentsOnDisk();
    }, 1500);

    window.addEventListener("focus", handleFocus);
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
  };
}
