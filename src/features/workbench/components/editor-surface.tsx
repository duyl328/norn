import { Compartment, EditorState, StateEffect, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Plus, X } from "lucide-react";
import { type CSSProperties, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { setActiveEditorView } from "../actions/active-editor";
import { buildEditorKeymapExtension } from "../actions/editor-actions";
import { createCodeMirrorExtensions, tabSizeExtension } from "../codemirror-setup";
import { EDITOR_SCROLLBAR_SIZE, emptyEditorScrollMetrics } from "../constants";
import {
  FULL_LANGUAGE_PARSER_SIZE_LIMIT_BYTES,
  loadHighlightExtensions,
  resolveHighlightMode,
} from "../editor-highlighting";
import { useEditorTabs } from "../hooks/use-editor-tabs";
import { useI18n } from "../i18n";
import { useWorkbenchStore } from "../store/workbench-store";
import type { EditorScrollbarOrientation, EditorScrollMetrics, WorkbenchDocument } from "../types";
import {
  clamp,
  formatFileSize,
  getEditorScrollbarGeometry,
  getFileTreeIcon,
  getTabBorderAccent,
} from "../workbench-utils";
import { ConflictResolverView } from "./conflict-resolver-view";
import { DiffView } from "./diff-view";
import { TabFoldStack } from "./titlebar";

// 标签被相邻更高层标签遮挡超过该比例(%)才算「真正进入折叠」,显示堆叠边框;
// 低于此则按普通标签渲染。避免首/尾标签稍一滚动就常驻折叠边框。
const stackFrameMinCover = 14;

export function EditorSurface({
  document,
  error,
  openDocuments,
  onChange,
  onCloseDocument,
  onCreateFile,
  onSelectDocument,
}: {
  document: WorkbenchDocument;
  error: string | null;
  openDocuments: WorkbenchDocument[];
  onChange: (content: string) => void;
  onCloseDocument: (document: WorkbenchDocument) => void;
  onCreateFile: () => void;
  onSelectDocument: (document: WorkbenchDocument) => void;
}) {
  const { t } = useI18n();
  const editorFrameRef = useRef<HTMLDivElement>(null);
  const editorElementRef = useRef<HTMLDivElement>(null);
  const scrollDOMRef = useRef<HTMLElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const suppressChangeRef = useRef(false);
  const languageCompartmentRef = useRef(new Compartment());
  const keymapCompartmentRef = useRef(new Compartment());
  const lineWrapCompartmentRef = useRef(new Compartment());
  const tabSizeCompartmentRef = useRef(new Compartment());
  const keymapOverrides = useWorkbenchStore((state) => state.keymapOverrides);
  const keymapOverridesRef = useRef(keymapOverrides);
  const lineWrapping = useWorkbenchStore((state) => state.editorLineWrapping);
  const tabSize = useWorkbenchStore((state) => state.editorTabSize);
  const dragRef = useRef<{
    maxScroll: number;
    orientation: EditorScrollbarOrientation;
    pointerStart: number;
    scrollStart: number;
    thumbSize: number;
    trackSize: number;
  } | null>(null);

  const {
    tabScrollRef,
    tabButtonRefs,
    previewTabs,
    activePreviewTabId,
    tabBellows,
    tabFoldStacks,
    tabLayouts,
    hiddenCloseTabIds,
    tabOverflow,
    stackDepthMap,
    addPreviewTab,
  } = useEditorTabs({ openDocuments, document, onCreateFile, viewRef });

  const [scrollMetrics, setScrollMetrics] = useState<EditorScrollMetrics>(emptyEditorScrollMetrics);
  const [highlightWarning, setHighlightWarning] = useState<string | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // 改键即时生效:overrides 变化 → 重建编辑器 keymap(不重建整个视图)。
  useEffect(() => {
    keymapOverridesRef.current = keymapOverrides;
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: keymapCompartmentRef.current.reconfigure(buildEditorKeymapExtension(keymapOverrides)),
    });
  }, [keymapOverrides]);

  useEffect(() => {
    const parent = editorElementRef.current;
    const frame = editorFrameRef.current;

    if (!parent || !frame) {
      return;
    }

    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: document.content,
        extensions: createCodeMirrorExtensions(
          languageCompartmentRef.current,
          lineWrapCompartmentRef.current,
          tabSizeCompartmentRef.current,
          document,
          (content) => {
            if (!suppressChangeRef.current) {
              onChangeRef.current(content);
            }
          },
          keymapCompartmentRef.current.of(buildEditorKeymapExtension(keymapOverridesRef.current)),
          useWorkbenchStore.getState().editorLineWrapping,
          useWorkbenchStore.getState().editorTabSize,
        ),
      }),
    });

    viewRef.current = view;
    setActiveEditorView(view);
    scrollDOMRef.current = view.scrollDOM;
    setHighlightWarning(null);

    let isCurrentDocument = true;

    const mode =
      document.mode === "large-readonly" ||
      (typeof document.size === "number" && document.size > FULL_LANGUAGE_PARSER_SIZE_LIMIT_BYTES)
        ? ({ kind: "plain-text", label: "Plain Text", reason: "large-file" } as const)
        : resolveHighlightMode(document);

    loadHighlightExtensions(mode)
      .then((extensions) => {
        if (!isCurrentDocument || viewRef.current !== view) {
          return;
        }

        setHighlightWarning(null);
        view.dispatch({
          effects: languageCompartmentRef.current.reconfigure(extensions),
        });
      })
      .catch((highlightError) => {
        if (!isCurrentDocument || viewRef.current !== view) {
          return;
        }

        setHighlightWarning(t("editor.highlightFallback", { language: mode.label }));
        view.dispatch({
          effects: languageCompartmentRef.current.reconfigure([]),
        });
        console.error("Failed to load editor highlighting", highlightError);
      });

    let animationFrame: number | null = null;

    const readScrollMetrics = () => {
      const gutterElement = view.scrollDOM.querySelector(".cm-gutters") as HTMLElement | null;
      const frameRect = frame.getBoundingClientRect();

      return {
        clientHeight: view.scrollDOM.clientHeight,
        clientWidth: view.scrollDOM.clientWidth,
        gutterWidth: gutterElement?.getBoundingClientRect().width ?? emptyEditorScrollMetrics.gutterWidth,
        scrollHeight: view.scrollDOM.scrollHeight,
        scrollLeft: view.scrollDOM.scrollLeft,
        scrollTop: view.scrollDOM.scrollTop,
        scrollWidth: view.scrollDOM.scrollWidth,
        shellHeight: frameRect.height,
        shellWidth: frameRect.width,
      };
    };

    const updateScrollMetrics = () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }

      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        setScrollMetrics(readScrollMetrics());
      });
    };

    view.dispatch({
      effects: StateEffect.appendConfig.of(EditorView.updateListener.of(updateScrollMetrics)),
    });

    const resizeObserver = new ResizeObserver(updateScrollMetrics);
    resizeObserver.observe(frame);
    resizeObserver.observe(view.scrollDOM);
    resizeObserver.observe(view.contentDOM);

    const gutterElement = view.scrollDOM.querySelector(".cm-gutters");

    if (gutterElement) {
      resizeObserver.observe(gutterElement);
    }

    const mutationObserver = new MutationObserver(updateScrollMetrics);
    mutationObserver.observe(parent, { childList: true, characterData: true, subtree: true });

    view.scrollDOM.addEventListener("scroll", updateScrollMetrics, { passive: true });
    updateScrollMetrics();

    return () => {
      isCurrentDocument = false;

      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }

      resizeObserver.disconnect();
      mutationObserver.disconnect();
      view.scrollDOM.removeEventListener("scroll", updateScrollMetrics);
      view.destroy();
      if (viewRef.current === view) {
        setActiveEditorView(null);
      }
      viewRef.current = null;
      scrollDOMRef.current = null;
    };
  }, [document.id, document.name, t]);

  useEffect(() => {
    const view = viewRef.current;

    if (!view || view.state.doc.toString() === document.content) {
      return;
    }

    const anchor = Math.min(view.state.selection.main.anchor, document.content.length);
    const head = Math.min(view.state.selection.main.head, document.content.length);

    suppressChangeRef.current = true;
    try {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: document.content },
        selection: { anchor, head },
        annotations: Transaction.addToHistory.of(false),
      });
    } finally {
      suppressChangeRef.current = false;
    }
  }, [document.content]);

  // 设置里切换长行换行时,只重配置 compartment,不重建编辑器(保留光标/滚动/撤销栈)。
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: lineWrapCompartmentRef.current.reconfigure(lineWrapping ? EditorView.lineWrapping : []),
    });
  }, [lineWrapping]);

  // 搜索结果点击后定位:内容就绪且为目标文件时,把光标移到行/列并滚动居中,然后清空。
  const pendingReveal = useWorkbenchStore((state) => state.pendingReveal);
  const setPendingReveal = useWorkbenchStore((state) => state.setPendingReveal);
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !pendingReveal || pendingReveal.path !== document.path) {
      return;
    }
    // 等内容真正载入后再定位(新开文件是异步读取的)。
    if (view.state.doc.toString() !== document.content) {
      return;
    }

    const lineNumber = Math.min(Math.max(pendingReveal.line, 1), view.state.doc.lines);
    const lineInfo = view.state.doc.line(lineNumber);
    const pos = Math.min(lineInfo.from + Math.max(pendingReveal.column, 0), lineInfo.to);
    view.dispatch({
      selection: { anchor: pos, head: pos },
      effects: EditorView.scrollIntoView(pos, { x: "nearest", y: "center" }),
      scrollIntoView: true,
    });
    view.focus();
    setPendingReveal(null);
  }, [pendingReveal, document.path, document.content, setPendingReveal]);

  // 设置里改 Tab 宽度时同理:只重配置 compartment。
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: tabSizeCompartmentRef.current.reconfigure(tabSizeExtension(tabSize)),
    });
  }, [tabSize]);

  const setScrollPosition = (orientation: EditorScrollbarOrientation, value: number) => {
    const scrollDOM = scrollDOMRef.current;

    if (!scrollDOM) {
      return;
    }

    if (orientation === "horizontal") {
      scrollDOM.scrollLeft = value;
      return;
    }

    scrollDOM.scrollTop = value;
  };

  const handleScrollbarTrackPointerDown = (
    orientation: EditorScrollbarOrientation,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (event.target !== event.currentTarget) {
      return;
    }

    const geometry = getEditorScrollbarGeometry(orientation, scrollMetrics);

    if (!geometry) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const pointerPosition = orientation === "horizontal" ? event.clientX - rect.left : event.clientY - rect.top;
    const pageSize =
      orientation === "horizontal"
        ? Math.max(1, scrollMetrics.clientWidth - scrollMetrics.gutterWidth)
        : Math.max(1, scrollMetrics.clientHeight);
    const direction = pointerPosition < geometry.thumbOffset ? -1 : 1;

    event.preventDefault();
    setScrollPosition(orientation, clamp(geometry.scrollPosition + direction * pageSize, 0, geometry.maxScroll));
  };

  const handleScrollbarThumbPointerDown = (
    orientation: EditorScrollbarOrientation,
    event: ReactPointerEvent<HTMLSpanElement>,
  ) => {
    const geometry = getEditorScrollbarGeometry(orientation, scrollMetrics);

    if (!geometry) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    dragRef.current = {
      maxScroll: geometry.maxScroll,
      orientation,
      pointerStart: orientation === "horizontal" ? event.clientX : event.clientY,
      scrollStart: geometry.scrollPosition,
      thumbSize: geometry.thumbSize,
      trackSize: geometry.trackSize,
    };

    const handlePointerMove = (pointerEvent: globalThis.PointerEvent) => {
      const drag = dragRef.current;

      if (!drag) {
        return;
      }

      const pointerPosition = drag.orientation === "horizontal" ? pointerEvent.clientX : pointerEvent.clientY;
      const draggableSize = Math.max(1, drag.trackSize - drag.thumbSize);
      const scrollDelta = ((pointerPosition - drag.pointerStart) / draggableSize) * drag.maxScroll;

      setScrollPosition(drag.orientation, clamp(drag.scrollStart + scrollDelta, 0, drag.maxScroll));
    };

    const handlePointerUp = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  return (
    <section
      className="editor-surface-panel flex min-h-0 min-w-0 flex-col overflow-hidden bg-[hsl(var(--editor-background))]"
      data-editor-drop-zone="true"
    >
      <div
        className={cn(
          "editor-file-tabs",
          tabOverflow.left && "editor-file-tabs-has-left",
          tabOverflow.right && "editor-file-tabs-has-right",
        )}
        role="tablist"
        aria-label={t("editor.openFiles")}
      >
        <TabFoldStack open={tabBellows === "left"} side="left" tabs={tabFoldStacks.left} />
        <div className="editor-file-tabs-scroll" ref={tabScrollRef}>
          {previewTabs.map((tab) => {
            const active = tab.id === activePreviewTabId;
            const tabDocument = openDocuments.find((openDocument) => openDocument.id === tab.id);
            const layout = tabLayouts[tab.id];
            // 「堆叠边框」按真实遮挡程度判定,而非仅凭 side 是否被钉住。否则首/尾标签只要 scrollLeft
            // 偏离端点一点点就立刻 side:"left"/"right",哪怕几乎完整可见也强行套上折叠边框 → 最左标签
            // 「边框常驻、右侧被盖」。只有当相邻更高层标签真正盖住本标签一定比例时,才算进入折叠。
            // 取左右遮挡的较大值:左钉标签主要被右邻居盖、右钉标签主要被左邻居盖,用 max 两侧都覆盖,
            // 避免某一侧因取错遮挡边而丢失折叠动画。
            const coverAmount = Math.max(layout?.coveredLeft ?? 0, layout?.coveredRight ?? 0);
            const leftStacked = layout?.side === "left" && coverAmount > stackFrameMinCover;
            const rightStacked = layout?.side === "right" && coverAmount > stackFrameMinCover;
            const isStacked = leftStacked || rightStacked;
            const hideCloseButton = !active || isStacked || hiddenCloseTabIds.has(tab.id);
            const tabIcon = getFileTreeIcon({
              kind: "file",
              name: tab.name,
              path: tab.name,
              relativePath: tab.name,
            });
            const stackInfo = stackDepthMap[tab.id];
            const positionFromActive = stackInfo ? stackInfo.total - stackInfo.depth : 0;
            const stackScale = stackInfo ? Math.max(0.68, 1 - positionFromActive * 0.08) : 1;
            const tabStyle = {
              "--editor-tab-accent": tab.accent,
              "--editor-tab-border-accent": getTabBorderAccent(tab.name),
              "--hide-left": `${layout?.hideLeft ?? 0}%`,
              "--hide-right": `${layout?.hideRight ?? 0}%`,
              "--sticky-left": `${layout?.stickyLeft ?? 0}px`,
              "--sticky-right": `${layout?.stickyRight ?? 0}px`,
              "--tab-stack-scale": String(stackScale),
              zIndex: layout?.zIndex,
            } as CSSProperties;

            return (
              <Tooltip key={tab.id}>
                <TooltipTrigger asChild>
                  <div
                    className={cn(
                      "editor-file-tab",
                      active && "editor-file-tab-active",
                      layout?.side !== "right" && "editor-file-tab-left-sticky",
                      layout?.side === "right" && "editor-file-tab-right-sticky",
                      rightStacked && "editor-file-tab-right-stacked",
                      leftStacked && "editor-file-tab-left-stacked",
                    )}
                    ref={(element) => {
                      tabButtonRefs.current[tab.id] = element;
                    }}
                    style={tabStyle}
                    role="tab"
                    aria-selected={active}
                    tabIndex={active ? 0 : -1}
                    onClick={() => {
                      if (tabDocument) {
                        onSelectDocument(tabDocument);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        if (tabDocument) {
                          onSelectDocument(tabDocument);
                        }
                        return;
                      }

                      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                        event.preventDefault();
                        const currentIndex = previewTabs.findIndex((item) => item.id === tab.id);
                        const nextTab = previewTabs[currentIndex + (event.key === "ArrowRight" ? 1 : -1)];
                        const nextDocument = nextTab && openDocuments.find((item) => item.id === nextTab.id);
                        if (nextDocument) {
                          onSelectDocument(nextDocument);
                          requestAnimationFrame(() => tabButtonRefs.current[nextTab.id]?.focus());
                        }
                      }
                    }}
                  >
                    <img
                      alt=""
                      aria-hidden="true"
                      className="editor-file-tab-icon"
                      draggable={false}
                      src={tabIcon.src}
                    />
                    <span className="truncate">{tab.name}</span>
                    <span
                      className={cn("editor-file-tab-trailing", hideCloseButton && "editor-file-tab-trailing-hidden")}
                    >
                      <span className="editor-file-tab-dirty" aria-hidden={!tab.dirty}>
                        {tab.dirty ? "•" : ""}
                      </span>
                      {tab.closable && (
                        <button
                          className="editor-file-tab-close"
                          aria-label={t("editor.closeTab", { name: tab.name })}
                          title={t("editor.closeTab", { name: tab.name })}
                          type="button"
                          tabIndex={hideCloseButton ? -1 : 0}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();

                            if (!hideCloseButton && tabDocument) {
                              onCloseDocument(tabDocument);
                            }
                          }}
                          onDoubleClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent className="editor-file-tab-tooltip" side="bottom" align="start" sideOffset={8}>
                  <div className="editor-file-tab-tooltip-path">{tabDocument?.path ?? tab.name}</div>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
        <TabFoldStack open={tabBellows === "right"} side="right" tabs={tabFoldStacks.right} />
        <button
          className="editor-file-tab-add"
          type="button"
          aria-label={t("editor.addTestTab")}
          title={t("editor.addTestTab")}
          onClick={addPreviewTab}
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
      {error ? (
        <div className="border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-ui text-destructive">
          {error}
        </div>
      ) : null}
      {highlightWarning ? (
        <div className="border-b border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-ui text-amber-700 dark:text-amber-300">
          {highlightWarning}
        </div>
      ) : null}
      {document.mode === "diff" ? (
        <div className="diff-view-frame min-h-0 flex-1">
          {document.conflict && document.diff ? (
            <ConflictResolverView filePath={document.path.replace(/^diff:\/\//, "")} text={document.diff.modified} />
          ) : document.diff ? (
            <DiffView name={document.name} original={document.diff.original} modified={document.diff.modified} />
          ) : null}
        </div>
      ) : (
        <>
          {document.mode === "large-readonly" ? (
            <div className="border-b border-border bg-muted/40 px-3 py-1.5 text-ui text-muted-foreground">
              {t("editor.largeFileModeBanner", {
                size: document.size ? formatFileSize(document.size) : "",
              })}
            </div>
          ) : null}
          <div className="codemirror-shell-frame min-h-0 flex-1" ref={editorFrameRef}>
            <div className="codemirror-shell min-h-0 flex-1" ref={editorElementRef} />
            <EditorScrollbar
              metrics={scrollMetrics}
              orientation="vertical"
              onThumbPointerDown={handleScrollbarThumbPointerDown}
              onTrackPointerDown={handleScrollbarTrackPointerDown}
            />
            <EditorScrollbar
              metrics={scrollMetrics}
              orientation="horizontal"
              onThumbPointerDown={handleScrollbarThumbPointerDown}
              onTrackPointerDown={handleScrollbarTrackPointerDown}
            />
          </div>
        </>
      )}
    </section>
  );
}

export function EditorScrollbar({
  metrics,
  orientation,
  onThumbPointerDown,
  onTrackPointerDown,
}: {
  metrics: EditorScrollMetrics;
  orientation: EditorScrollbarOrientation;
  onThumbPointerDown: (orientation: EditorScrollbarOrientation, event: ReactPointerEvent<HTMLSpanElement>) => void;
  onTrackPointerDown: (orientation: EditorScrollbarOrientation, event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const geometry = getEditorScrollbarGeometry(orientation, metrics);
  const hasVerticalScrollbar = metrics.scrollHeight - metrics.clientHeight > 1;

  if (!geometry) {
    return null;
  }

  return (
    <div
      aria-orientation={orientation}
      aria-valuemax={Math.round(geometry.maxScroll)}
      aria-valuemin={0}
      aria-valuenow={Math.round(geometry.scrollPosition)}
      className={cn("editor-scrollbar", `editor-scrollbar-${orientation}`)}
      role="scrollbar"
      style={
        orientation === "horizontal"
          ? {
              bottom: 0,
              height: EDITOR_SCROLLBAR_SIZE,
              left: metrics.gutterWidth,
              right: hasVerticalScrollbar ? EDITOR_SCROLLBAR_SIZE : 0,
            }
          : {
              bottom: 0,
              right: 0,
              top: 0,
              width: EDITOR_SCROLLBAR_SIZE,
            }
      }
      tabIndex={-1}
      onPointerDown={(event) => onTrackPointerDown(orientation, event)}
    >
      <span
        className="editor-scrollbar-thumb"
        style={
          orientation === "horizontal"
            ? { left: geometry.thumbOffset, width: geometry.thumbSize }
            : { height: geometry.thumbSize, top: geometry.thumbOffset }
        }
        onPointerDown={(event) => onThumbPointerDown(orientation, event)}
      />
    </div>
  );
}
