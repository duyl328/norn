import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";

import {
  LARGE_FILE_CHUNK_BYTES,
  LARGE_FILE_CONFIRM_BYTES,
  LARGE_FILE_READONLY_BYTES,
  SUPER_LARGE_FILE_BYTES,
} from "../constants";
import { useWorkbenchStore } from "../store/workbench-store";
import type {
  NativeSavedTextFile,
  NativeTextFile,
  NativeTextFileInspection,
  NativeTextFileRange,
  PendingFileOpen,
  WorkbenchDocument,
} from "../types";
import {
  createUntitledDocument,
  formatFileSize,
  getFileOpenId,
  getNativeSaveError,
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

  const activateDocument = (nextDocument: WorkbenchDocument) => {
    setDocument(nextDocument);
    setOpenDocuments((currentDocuments) => upsertOpenDocument(currentDocuments, nextDocument));
    setSaveConflict(null);
    setSaveState("saved");
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

  const requestCloseDocument = (targetDocument: WorkbenchDocument) => {
    if (isDocumentDirty(targetDocument) || targetDocument.isUntitled) {
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
    const nextDocument = {
      ...document,
      id: getFileOpenId(savedFile.path, savedFile.lastModified),
      name: savedFile.name,
      path: savedFile.path,
      content,
      savedContent: content,
      size: savedFile.size,
      lastModified: savedFile.lastModified ?? undefined,
      isUntitled: false,
      mode: "editable",
      range: undefined,
    } satisfies WorkbenchDocument;

    setDocument(nextDocument);
    setOpenDocuments((currentDocuments) => {
      const withoutPreviousDocument = currentDocuments.filter((openDocument) => openDocument.id !== document.id);

      return upsertOpenDocument(withoutPreviousDocument, nextDocument);
    });
    setSaveConflict(null);
    setSaveState("saved");
    setFileError(null);

    return nextDocument;
  };

  const saveDocumentAs = async (contentOverride?: string): Promise<WorkbenchDocument | null> => {
    if (document.mode === "large-readonly") {
      setSaveState("error");
      setFileError("Large files are opened in read-only browsing mode and cannot be saved yet.");
      return null;
    }

    if (!isTauriRuntime()) {
      setSaveState("error");
      setFileError("Native saving is only available in the Tauri desktop app.");
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
      });

      return applySavedDocument(savedFile, content);
    } catch (error) {
      const saveError = getNativeSaveError(error);
      setSaveState("error");
      setFileError(saveError.message ?? "Unable to save this file.");
      return null;
    }
  };

  const saveDocument = async (options: { force?: boolean } = {}): Promise<WorkbenchDocument | null> => {
    if (saveState === "saving") {
      return null;
    }

    if (document.mode === "large-readonly") {
      setSaveState("error");
      setFileError("Large files are opened in read-only browsing mode and cannot be saved yet.");
      return null;
    }

    if (document.isUntitled || !isAbsolutePath(document.path)) {
      return await saveDocumentAs();
    }

    if (!isTauriRuntime()) {
      setSaveState("error");
      setFileError("Native saving is only available in the Tauri desktop app.");
      return null;
    }

    const content = document.content;
    setSaveState("saving");
    setFileError(null);

    try {
      const savedFile = await invoke<NativeSavedTextFile>("save_text_file", {
        path: document.path,
        content,
        expectedLastModified: options.force ? null : (document.lastModified ?? null),
        force: options.force ?? false,
      });

      return applySavedDocument(savedFile, content);
    } catch (error) {
      const saveError = getNativeSaveError(error);

      if (saveError.kind === "deleted") {
        setSaveState("idle");
        setFileError(saveError.message ?? "The original file was deleted. Choose a new location to save it.");
        return await saveDocumentAs(content);
      }

      if (saveError.kind === "modified") {
        setSaveState("idle");
        setSaveConflict({
          content,
          lastModified: document.lastModified,
          message: saveError.message ?? "This file was changed outside Norn.",
          path: document.path,
        });
        return null;
      }

      setSaveState("error");
      setFileError(saveError.message ?? "Unable to save this file.");
      return null;
    }
  };

  const reloadConflictedDocument = async () => {
    const conflict = saveConflict;

    if (!conflict) {
      return;
    }

    setSaveConflict(null);
    await openNativeFile(conflict.path);
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
      setSaveState("idle");
      setSaveConflict({
        content: document.content,
        lastModified: document.lastModified,
        message: isDirty
          ? "This file changed on disk while you also have local edits. Choose which version to keep."
          : "This file changed on disk. Reload to use the latest disk version, or keep the current editor version.",
        path: document.path,
      });
    } catch {
      // The next explicit save/open action will surface deleted or unreadable files with a targeted error.
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

      if (inspection.isBinary || !inspection.isUtf8) {
        setFileError(`${inspection.name} cannot be opened as UTF-8 text.`);
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
        const contentPrefix = range.hasMoreBefore ? "[Earlier content omitted in large file browsing mode]\n\n" : "";
        const contentSuffix = range.hasMoreAfter ? "\n\n[More content omitted in large file browsing mode]" : "";
        const rangeContent = `${contentPrefix}${range.content}${contentSuffix}`;

        activateDocument({
          id: getFileOpenId(inspection.path, inspection.lastModified),
          name: inspection.name,
          path: inspection.path,
          content: rangeContent,
          savedContent: rangeContent,
          size: inspection.size,
          lastModified: inspection.lastModified ?? undefined,
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
        const shouldOpen = window.confirm(`This file is ${formatFileSize(inspection.size)}. Open it as text?`);

        if (!shouldOpen) {
          return;
        }
      }

      const file = await invoke<NativeTextFile>("read_text_file", { path });

      activateDocument({
        id: getFileOpenId(file.path, file.lastModified),
        name: file.name,
        path: file.path,
        content: file.content,
        savedContent: file.content,
        size: file.size,
        lastModified: file.lastModified ?? undefined,
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

  const continueFileOpen = async (pendingOpen: PendingFileOpen) => {
    if (pendingOpen.kind === "path") {
      await openNativeFile(pendingOpen.path, {
        clearFolderView: pendingOpen.clearFolderView,
        size: pendingOpen.size,
      });
      return;
    }

    if (!isTauriRuntime()) {
      setFileError("Native file opening is only available in the Tauri desktop app.");
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

    const handleFocus = () => {
      void checkCurrentDocumentOnDisk();
    };
    const handleVisibilityChange = () => {
      if (!globalThis.document.hidden) {
        void checkCurrentDocumentOnDisk();
      }
    };

    window.addEventListener("focus", handleFocus);
    globalThis.document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleFocus);
      globalThis.document.removeEventListener("visibilitychange", handleVisibilityChange);
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isSaveShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s";

      if (!isSaveShortcut) {
        return;
      }

      event.preventDefault();

      if (event.shiftKey) {
        void saveDocumentAs();
        return;
      }

      void saveDocument();
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    document.content,
    document.savedContent,
    document.path,
    document.lastModified,
    document.mode,
    document.isUntitled,
    saveState,
  ]);

  return {
    activateDocument,
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
  };
}
