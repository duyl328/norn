import { MergeView } from "@codemirror/merge";
import { EditorState, type Extension } from "@codemirror/state";
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

    // 只读基础。行号只给右侧(b),让行号落在两栏中间;左侧(a)不显示行号。
    const base = [EditorView.editable.of(false), EditorState.readOnly.of(true), EditorView.lineWrapping];
    const mode = resolveHighlightMode({ content: modified, name, path: filePath });

    const build = (highlight: Extension[]) =>
      new MergeView({
        parent,
        a: { doc: original, extensions: [...base, ...highlight] },
        b: { doc: modified, extensions: [lineNumbers(), ...base, ...highlight] },
        highlightChanges: true,
        // 中间不放改动 gutter,只留行号;改动靠行 / 词级背景表达。
        gutter: false,
        collapseUnchanged: { margin: 3, minSize: 4 },
      });

    void loadHighlightExtensions(mode)
      .then((highlight) => {
        if (!disposed) {
          view = build(highlight);
        }
      })
      .catch(() => {
        if (!disposed) {
          view = build([]);
        }
      });

    return () => {
      disposed = true;
      view?.destroy();
    };
  }, [filePath, original, modified, name]);

  return (
    <div className="merge-diff-wrap">
      <div className="merge-diff-head">
        <span className="merge-diff-head-cell merge-diff-head-old">原始 (HEAD)</span>
        <span className="merge-diff-head-cell merge-diff-head-new">修改后（工作区）</span>
      </div>
      <div className="merge-diff" ref={ref} />
    </div>
  );
}
