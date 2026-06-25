import { foldable } from "@codemirror/language";
import { type Extension, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

/**
 * IDEA 式折叠预览:鼠标移到折叠槽的箭头上时,把整段可折叠区域(含首尾行)高亮,
 * 预示「点一下会折叠这些行」。
 *
 * 纯几何 + foldable() 查询 —— foldable 走的是当前已有的折叠来源(现为语法树,
 * 将来若换缩进 foldService 也透明兼容),本扩展自身不做任何额外解析。
 */

const setHoverRange = StateEffect.define<{ from: number; to: number } | null>();

const regionLine = Decoration.line({ class: "cm-foldHoverRegion" });

const foldHoverField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (!effect.is(setHoverRange)) {
        continue;
      }

      if (!effect.value) {
        return Decoration.none;
      }

      const builder = new RangeSetBuilder<Decoration>();
      const startLine = transaction.state.doc.lineAt(effect.value.from);
      const endLine = transaction.state.doc.lineAt(effect.value.to);

      for (let lineNumber = startLine.number; lineNumber <= endLine.number; lineNumber += 1) {
        const line = transaction.state.doc.line(lineNumber);
        builder.add(line.from, line.from, regionLine);
      }

      return builder.finish();
    }

    return value.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

// 记录每个视图上一次高亮的范围键,避免 mousemove 每个像素都 dispatch。
const lastRangeKey = new WeakMap<EditorView, string>();

const applyHover = (view: EditorView, range: { from: number; to: number } | null) => {
  const key = range ? `${range.from}:${range.to}` : "";

  if (lastRangeKey.get(view) === key) {
    return;
  }

  lastRangeKey.set(view, key);
  view.dispatch({ effects: setHoverRange.of(range) });
};

const foldHoverHandlers = EditorView.domEventHandlers({
  mousemove(event, view) {
    const target = event.target as HTMLElement | null;

    if (!target?.closest(".cm-foldGutter")) {
      applyHover(view, null);
      return;
    }

    const block = view.lineBlockAtHeight(event.clientY - view.documentTop);
    const line = view.state.doc.lineAt(block.from);
    const range = foldable(view.state, line.from, line.to);

    // 裁到可见视口:超大折叠块(如几万行的 JSON 数组)若整段逐行建装饰会在
    // 悬停那一下卡顿;视口外的行本就看不见,无需高亮。
    applyHover(
      view,
      range && { from: Math.max(range.from, view.viewport.from), to: Math.min(range.to, view.viewport.to) },
    );
  },
  mouseleave(_event, view) {
    applyHover(view, null);
  },
});

export const foldHoverHighlight: Extension = [foldHoverField, foldHoverHandlers];
