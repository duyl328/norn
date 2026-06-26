import { MergeView } from "@codemirror/merge";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { useEffect, useRef } from "react";

import { loadHighlightExtensions, resolveHighlightMode } from "../editor-highlighting";

const SVG_NS = "http://www.w3.org/2000/svg";
const COLOR = { inserted: "16 185 129", deleted: "239 68 68", changed: "245 158 11" };

/**
 * IDEA / Kaleidoscope 式并排 diff:左=原始(HEAD),右=修改后(工作区)。
 * 基于 @codemirror/merge:行级 + 词级高亮、折叠未改动、两侧只读、语法高亮。
 * 额外在两栏之间画 SVG「连接色带」,把左右对应的改动块连起来(IDEA 招牌)。
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
    let raf = 0;
    let measure = () => {};
    const schedule = () => {
      if (raf) {
        cancelAnimationFrame(raf);
      }
      raf = requestAnimationFrame(() => measure());
    };

    const base: Extension[] = [
      EditorView.editable.of(false),
      EditorState.readOnly.of(true),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.geometryChanged || update.docChanged || update.viewportChanged) {
          schedule();
        }
      }),
    ];
    const mode = resolveHighlightMode({ content: modified, name, path: filePath });

    const build = (highlight: Extension[]) => {
      view = new MergeView({
        parent,
        a: { doc: original, extensions: [...base, ...highlight] },
        b: { doc: modified, extensions: [lineNumbers(), ...base, ...highlight] },
        highlightChanges: true,
        gutter: false,
        collapseUnchanged: { margin: 3, minSize: 4 },
      });
      setupRibbons(view);
    };

    const setupRibbons = (mv: MergeView) => {
      const svg = document.createElementNS(SVG_NS, "svg");
      svg.classList.add("merge-ribbons");
      parent.appendChild(svg);

      const yOf = (editor: EditorView, pos: number, baseTop: number) => {
        const clamped = Math.max(0, Math.min(pos, editor.state.doc.length));
        const block = editor.lineBlockAt(clamped);
        const rect = editor.scrollDOM.getBoundingClientRect();
        return rect.top - baseTop + (block.top - editor.scrollDOM.scrollTop);
      };

      measure = () => {
        if (disposed) {
          return;
        }
        const baseRect = parent.getBoundingClientRect();
        const aRect = mv.a.scrollDOM.getBoundingClientRect();
        const bRect = mv.b.scrollDOM.getBoundingClientRect();
        const gapLeft = aRect.right - baseRect.left;
        const gapRight = bRect.left - baseRect.left;
        const midX = (gapLeft + gapRight) / 2;

        svg.setAttribute("width", String(parent.clientWidth));
        svg.setAttribute("height", String(parent.scrollHeight));

        if (gapRight - gapLeft < 4) {
          svg.replaceChildren();
          return;
        }

        const paths: SVGPathElement[] = [];
        for (const chunk of mv.chunks) {
          const aTop = yOf(mv.a, chunk.fromA, baseRect.top);
          const aBot = yOf(mv.a, chunk.toA, baseRect.top);
          const bTop = yOf(mv.b, chunk.fromB, baseRect.top);
          const bBot = yOf(mv.b, chunk.toB, baseRect.top);
          const color =
            chunk.fromA === chunk.toA ? COLOR.inserted : chunk.fromB === chunk.toB ? COLOR.deleted : COLOR.changed;

          const path = document.createElementNS(SVG_NS, "path");
          path.setAttribute(
            "d",
            `M ${gapLeft} ${aTop} C ${midX} ${aTop} ${midX} ${bTop} ${gapRight} ${bTop} ` +
              `L ${gapRight} ${bBot} C ${midX} ${bBot} ${midX} ${aBot} ${gapLeft} ${aBot} Z`,
          );
          path.setAttribute("fill", `rgb(${color} / 0.22)`);
          path.setAttribute("stroke", `rgb(${color} / 0.55)`);
          path.setAttribute("stroke-width", "1");
          paths.push(path);
        }
        svg.replaceChildren(...paths);
      };

      const observer = new ResizeObserver(() => schedule());
      observer.observe(parent);
      observer.observe(mv.a.scrollDOM);
      observer.observe(mv.b.scrollDOM);
      cleanups.push(() => observer.disconnect());
      cleanups.push(() => svg.remove());
      schedule();
    };

    const cleanups: Array<() => void> = [];

    void loadHighlightExtensions(mode)
      .then((highlight) => {
        if (!disposed) {
          build(highlight);
        }
      })
      .catch(() => {
        if (!disposed) {
          build([]);
        }
      });

    return () => {
      disposed = true;
      if (raf) {
        cancelAnimationFrame(raf);
      }
      for (const fn of cleanups) {
        fn();
      }
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
