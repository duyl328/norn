import { type EditorState, type Extension, RangeSet, StateEffect, StateField } from "@codemirror/state";
import {
  type BlockInfo,
  Decoration,
  EditorView,
  gutterLineClass,
  GutterMarker,
} from "@codemirror/view";

type PinnedLineEffect =
  | { kind: "toggle"; lineStart: number }
  | { anchor: number; head: number; kind: "setRange"; pinned: boolean };

const setPinnedLine = StateEffect.define<PinnedLineEffect>({
  map: (value, mapping) =>
    value.kind === "toggle"
      ? { kind: "toggle", lineStart: mapping.mapPos(value.lineStart) }
      : {
          anchor: mapping.mapPos(value.anchor),
          head: mapping.mapPos(value.head),
          kind: "setRange",
          pinned: value.pinned,
        },
});

class PinnedLineGutterMarker extends GutterMarker {
  elementClass = "cm-pinnedLineGutter";

  eq() {
    return true;
  }
}

const pinnedLineGutterMarker = new PinnedLineGutterMarker();
const pinnedLineDecoration = Decoration.line({ class: "cm-pinnedLine" });

const normalizeLineStarts = (lineStarts: Iterable<number>, state: EditorState) =>
  Array.from(new Set(lineStarts))
    .filter((lineStart) => lineStart >= 0 && lineStart <= state.doc.length)
    .sort((a, b) => a - b);

const lineStartsInRange = (state: EditorState, anchor: number, head: number) => {
  const fromLine = state.doc.lineAt(Math.min(anchor, head)).number;
  const toLine = state.doc.lineAt(Math.max(anchor, head)).number;
  const lineStarts: number[] = [];

  for (let lineNumber = fromLine; lineNumber <= toLine; lineNumber += 1) {
    lineStarts.push(state.doc.line(lineNumber).from);
  }

  return lineStarts;
};

const pinnedLineField = StateField.define<readonly number[]>({
  create: () => [],
  update: (value, transaction) => {
    let next = normalizeLineStarts(
      value.map((lineStart) => transaction.changes.mapPos(lineStart)),
      transaction.state,
    );

    for (const effect of transaction.effects) {
      if (effect.is(setPinnedLine)) {
        const pinnedLineEffect = effect.value;

        if (pinnedLineEffect.kind === "toggle") {
          next = next.includes(pinnedLineEffect.lineStart)
            ? next.filter((lineStart) => lineStart !== pinnedLineEffect.lineStart)
            : normalizeLineStarts([...next, pinnedLineEffect.lineStart], transaction.state);
        } else {
          const rangeLineStarts = lineStartsInRange(transaction.state, pinnedLineEffect.anchor, pinnedLineEffect.head);
          next = pinnedLineEffect.pinned
            ? normalizeLineStarts([...next, ...rangeLineStarts], transaction.state)
            : next.filter((lineStart) => !rangeLineStarts.includes(lineStart));
        }
      }
    }

    return next;
  },
  provide: (field) => [
    EditorView.decorations.from(field, (lineStarts) =>
      lineStarts.length === 0
        ? Decoration.none
        : Decoration.set(lineStarts.map((lineStart) => pinnedLineDecoration.range(lineStart))),
    ),
    gutterLineClass.from(field, (lineStarts) =>
      lineStarts.length === 0
        ? RangeSet.empty
        : RangeSet.of(lineStarts.map((lineStart) => pinnedLineGutterMarker.range(lineStart))),
    ),
  ],
});

const lineStartFromBlock = (view: EditorView, line: BlockInfo) => view.state.doc.lineAt(line.from).from;

const dragState = new WeakMap<EditorView, { anchor: number; moved: boolean; pinned: boolean }>();
const suppressNextClick = new WeakSet<EditorView>();

const setPinnedLineRange = (view: EditorView, anchor: number, head: number, pinned: boolean) => {
  view.dispatch({
    effects: setPinnedLine.of({ anchor, head, kind: "setRange", pinned }),
  });
};

const togglePinnedLine = (view: EditorView, line: BlockInfo, event: Event) => {
  event.preventDefault();
  event.stopPropagation();

  if (suppressNextClick.has(view)) {
    suppressNextClick.delete(view);
    return true;
  }

  const lineStart = lineStartFromBlock(view, line);

  view.dispatch({
    effects: setPinnedLine.of({ kind: "toggle", lineStart }),
  });

  return true;
};

const startPinnedLineDrag = (view: EditorView, line: BlockInfo, event: Event) => {
  if (event instanceof MouseEvent && event.button !== 0) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();

  const anchor = lineStartFromBlock(view, line);
  const pinnedLines = view.state.field(pinnedLineField, false) ?? [];
  dragState.set(view, { anchor, moved: false, pinned: !pinnedLines.includes(anchor) });
  return true;
};

const updatePinnedLineDrag = (view: EditorView, line: BlockInfo, event: Event) => {
  const current = dragState.get(view);

  if (!current) {
    return false;
  }

  if (event instanceof MouseEvent && (event.buttons & 1) === 0) {
    dragState.delete(view);
    return false;
  }

  event.preventDefault();
  event.stopPropagation();

  current.moved = true;
  setPinnedLineRange(view, current.anchor, lineStartFromBlock(view, line), current.pinned);
  return true;
};

const finishPinnedLineDrag = (view: EditorView, line: BlockInfo, event: Event) => {
  const current = dragState.get(view);

  if (!current) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  dragState.delete(view);

  if (current.moved) {
    suppressNextClick.add(view);
    setPinnedLineRange(view, current.anchor, lineStartFromBlock(view, line), current.pinned);
  }

  return true;
};

export const pinnedLineExtension: Extension = [
  pinnedLineField,
  EditorView.domEventHandlers({
    mousedown: (event) => {
      if ((event.target as HTMLElement | null)?.closest(".cm-lineNumbers")) {
        event.preventDefault();
      }
    },
  }),
];

export const pinnedLineNumberHandlers = {
  click: togglePinnedLine,
  mousedown: startPinnedLineDrag,
  mousemove: updatePinnedLineDrag,
  mouseup: finishPinnedLineDrag,
};
