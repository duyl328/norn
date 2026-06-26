import { MergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { useEffect, useRef } from "react";

import { loadHighlightExtensions, resolveHighlightMode } from "../editor-highlighting";

/**
 * IDEA 式并排 diff:左=原始(HEAD),右=修改后(工作区)。
 * 基于 @codemirror/merge 的 MergeView:行级 + 词级高亮、改动 gutter、折叠大段未改动。
 * 两侧只读(看 diff,不在此编辑)。带语法高亮(复用编辑器的高亮加载)。
 */
export function MergeDiffView({
  filePath,
  modified,
  name,
  original,
}: {
  filePath: string;
  modified: string;
  name: string;
  original: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const parent = ref.current;
    if (!parent) {
      return;
    }

    let view: MergeView | null = null;
    let disposed = false;

    const readonly = [
      lineNumbers(),
      EditorView.editable.of(false),
      EditorState.readOnly.of(true),
      EditorView.lineWrapping,
    ];
    const mode = resolveHighlightMode({ content: modified, name, path: filePath });

    void loadHighlightExtensions(mode)
      .then((highlight) => {
        if (disposed) {
          return;
        }
        view = new MergeView({
          parent,
          a: { doc: original, extensions: [...readonly, ...highlight] },
          b: { doc: modified, extensions: [...readonly, ...highlight] },
          highlightChanges: true,
          gutter: true,
          collapseUnchanged: { margin: 3, minSize: 4 },
        });
      })
      .catch(() => {
        if (disposed) {
          return;
        }
        view = new MergeView({
          parent,
          a: { doc: original, extensions: readonly },
          b: { doc: modified, extensions: readonly },
          highlightChanges: true,
          gutter: true,
          collapseUnchanged: { margin: 3, minSize: 4 },
        });
      });

    return () => {
      disposed = true;
      view?.destroy();
    };
  }, [filePath, original, modified, name]);

  return <div className="merge-diff" ref={ref} />;
}
