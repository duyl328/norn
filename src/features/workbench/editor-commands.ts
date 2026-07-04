import {
  Annotation,
  EditorSelection,
  type EditorState,
  type Extension,
  type SelectionRange,
  type StateCommand,
  StateEffect,
  StateField,
} from "@codemirror/state";
import { type Command, EditorView, keymap } from "@codemirror/view";

// 区域扫描上限:括号配对最多向两侧各扫这么多字符,避免超大文件里全文扫描。
const REGION_SCAN_LIMIT = 10000;

const BRACKET_PAIRS: Array<[open: string, close: string]> = [
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
];

const QUOTES = ['"', "'", "`"];

/**
 * 找到包住 [from,to) 的最近一对括号(支持嵌套):向前找未闭合的开括号,再找其配对的闭括号。
 * 有界扫描,纯文本计数,不依赖语法树。
 */
const findEnclosingBrackets = (state: EditorState, from: number, to: number, open: string, close: string) => {
  const backStart = Math.max(0, from - REGION_SCAN_LIMIT);
  const before = state.doc.sliceString(backStart, from);
  let depth = 0;
  let openPos = -1;

  for (let index = before.length - 1; index >= 0; index -= 1) {
    const char = before[index];
    if (char === close) {
      depth += 1;
    } else if (char === open) {
      if (depth === 0) {
        openPos = backStart + index;
        break;
      }
      depth -= 1;
    }
  }

  if (openPos === -1) {
    return null;
  }

  // 统计 (openPos, to) 之间的净开括号数,作为向后找配对闭括号的起始深度。
  const mid = state.doc.sliceString(openPos + 1, to);
  let forwardDepth = 0;
  for (const char of mid) {
    if (char === open) forwardDepth += 1;
    else if (char === close) forwardDepth -= 1;
  }

  const forwardEnd = Math.min(state.doc.length, to + REGION_SCAN_LIMIT);
  const after = state.doc.sliceString(to, forwardEnd);
  for (let index = 0; index < after.length; index += 1) {
    const char = after[index];
    if (char === open) {
      forwardDepth += 1;
    } else if (char === close) {
      if (forwardDepth === 0) {
        return { open: openPos, close: to + index };
      }
      forwardDepth -= 1;
    }
  }

  return null;
};

/** 找到当前行内包住 [from,to) 的最近一对引号(引号不跨行,够编辑器用)。 */
const findEnclosingQuote = (state: EditorState, from: number, to: number, quote: string) => {
  const line = state.doc.lineAt(from);
  const relativeFrom = from - line.from;
  const relativeTo = to - line.from;
  const open = line.text.lastIndexOf(quote, relativeFrom - 1);

  if (open === -1) {
    return null;
  }

  const close = line.text.indexOf(quote, Math.max(relativeTo, open + 1));
  if (close === -1) {
    return null;
  }

  return { open: line.from + open, close: line.from + close };
};

const collectCandidates = (state: EditorState, range: SelectionRange): SelectionRange[] => {
  const candidates: SelectionRange[] = [];
  const push = (from: number, to: number) => candidates.push(EditorSelection.range(from, to));

  // 词
  const word = state.wordAt(range.head) ?? (range.empty ? null : state.wordAt(range.from));
  if (word) {
    push(word.from, word.to);
  }

  // 引号:先「引号内」,再「含引号」
  for (const quote of QUOTES) {
    const found = findEnclosingQuote(state, range.from, range.to, quote);
    if (found) {
      push(found.open + 1, found.close);
      push(found.open, found.close + 1);
    }
  }

  // 括号:先「括号内」,再「含括号」
  for (const [open, close] of BRACKET_PAIRS) {
    const found = findEnclosingBrackets(state, range.from, range.to, open, close);
    if (found) {
      push(found.open + 1, found.close);
      push(found.open, found.close + 1);
    }
  }

  // 行 → 全文
  const line = state.doc.lineAt(range.head);
  push(line.from, line.to);
  push(0, state.doc.length);

  return candidates;
};

// 扩/缩选区互为逆操作:扩选把「扩选前的选区」压栈,缩选弹栈还原。两个 annotation 用来
// 区分这两类自有改动,其余任何选区改动(点击、方向键、编辑)都会清空栈 —— 与 IDEA 一致。
const expandSelectionEvent = Annotation.define<boolean>();
const shrinkSelectionEvent = Annotation.define<boolean>();

/**
 * 选区扩展历史栈:仅 Ctrl+W / Ctrl+Shift+W 用。装配进编辑器(见 codemirror-setup),
 * 缩选才有可还原的层级;不装配时缩选直接无操作。
 */
export const selectionHistoryField = StateField.define<EditorSelection[]>({
  create: () => [],
  update(stack, transaction) {
    if (transaction.annotation(expandSelectionEvent)) {
      return [...stack, transaction.startState.selection];
    }
    if (transaction.annotation(shrinkSelectionEvent)) {
      return stack.slice(0, -1);
    }
    // 其它来源的选区变化(含编辑)使历史失效。
    return transaction.selection ? [] : stack;
  },
});

/**
 * Ctrl+W 区域扩选(IDEA「Extend Selection」的文本近似):每次扩到「严格包住当前选区的
 * 最小区域」,于是逐级放大 —— 词 → 引号内 → 含引号 → 括号内 → 含括号 → 整行 → 全文。
 * 纯文本扫描,不依赖语法树,所以没有「按语法表达式」那一层。
 */
export const expandSelection: StateCommand = ({ state, dispatch }) => {
  let changed = false;

  const ranges = state.selection.ranges.map((range) => {
    const enclosing = collectCandidates(state, range).filter(
      (candidate) =>
        candidate.from <= range.from &&
        candidate.to >= range.to &&
        (candidate.from < range.from || candidate.to > range.to),
    );

    if (enclosing.length === 0) {
      return range;
    }

    const next = enclosing.reduce((smallest, candidate) =>
      candidate.to - candidate.from < smallest.to - smallest.from ? candidate : smallest,
    );
    changed = true;
    return next;
  });

  if (!changed) {
    return false;
  }

  dispatch(state.update({ selection: EditorSelection.create(ranges), annotations: expandSelectionEvent.of(true) }));
  return true;
};

/**
 * Ctrl+Shift+W 缩选(IDEA「Shrink Selection」):弹出扩选历史栈顶,逐级还原到扩选前的选区。
 * 无历史(从未扩选,或中途手动改过选区)则无操作。
 */
export const shrinkSelection: StateCommand = ({ state, dispatch }) => {
  const stack = state.field(selectionHistoryField, false);
  if (!stack || stack.length === 0) {
    return false;
  }

  dispatch(state.update({ selection: stack[stack.length - 1], annotations: shrinkSelectionEvent.of(true) }));
  return true;
};

export const selectionHistory: Extension = selectionHistoryField;

// Alt+J(@codemirror/search 的 selectNextOccurrence)加选时把新选区 addRange(..., main:false),
// 主选区始终停在「第一个」——所以不能靠 mainIndex 判断「最后加入的」。改用历史栈按 LIFO 还原:
// 凡是选区数量增加的改动(Alt+J 加选、Alt+点击多光标)都把改动前的选区压栈,取消时弹栈。
const removeOccurrenceEvent = Annotation.define<boolean>();

export const occurrenceHistoryField = StateField.define<EditorSelection[]>({
  create: () => [],
  update(stack, transaction) {
    if (transaction.annotation(removeOccurrenceEvent)) {
      return stack.slice(0, -1);
    }
    if (!transaction.selection) {
      // 选区未显式变化:纯编辑使历史失效,其余(如仅文档 effect)保持。
      return transaction.docChanged ? [] : stack;
    }
    if (transaction.selection.ranges.length > transaction.startState.selection.ranges.length) {
      return [...stack, transaction.startState.selection]; // 新增了选区:压栈
    }
    return []; // 其它选区变化(移动/减少)使历史失效
  },
});

export const occurrenceHistory: Extension = occurrenceHistoryField;

/**
 * Alt+Shift+J 取消选中(Alt+J「加选下一个相同词」的逆操作):按加入顺序从最后一个开始弹栈还原。
 * 无历史(选区非 Alt+J 累积而来)时兜底:多选区去掉数组末位那个,单选区收回成光标,已是光标则无操作。
 */
export const unselectLastOccurrence: StateCommand = ({ state, dispatch }) => {
  const stack = state.field(occurrenceHistoryField, false);
  if (stack && stack.length > 0) {
    dispatch(
      state.update({
        selection: stack[stack.length - 1],
        scrollIntoView: true,
        annotations: removeOccurrenceEvent.of(true),
      }),
    );
    return true;
  }

  const selection = state.selection;
  if (selection.ranges.length >= 2) {
    const remaining = selection.ranges.slice(0, -1);
    dispatch(state.update({ selection: EditorSelection.create(remaining), scrollIntoView: true }));
    return true;
  }

  if (!selection.main.empty) {
    dispatch(state.update({ selection: EditorSelection.cursor(selection.main.head), scrollIntoView: true }));
    return true;
  }

  return false;
};

/**
 * Alt+点击落在「已有光标」上时移除它(toggle off),保证至少留一个光标。
 * 空处新增 / Alt+拖拽矩形选区不在此处理 —— 返回 false 放行给
 * clickAddsSelectionRange + rectangularSelection。
 */
export const altClickToggleCaret = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (!event.altKey || event.button !== 0) {
      return false;
    }

    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos == null) {
      return false;
    }

    const selection = view.state.selection;
    if (selection.ranges.length < 2) {
      return false; // 只剩一个光标不移除
    }

    const hit = selection.ranges.find((range) =>
      range.empty ? range.head === pos : pos >= range.from && pos <= range.to,
    );
    if (!hit) {
      return false; // 点在空处:让默认逻辑新增光标
    }

    view.dispatch({ selection: EditorSelection.create(selection.ranges.filter((range) => range !== hit)) });
    event.preventDefault();
    return true;
  },
});

/**
 * 无选中时把光标所在整行(含行尾换行)作为选区返回;有任一选区非空则返回 null(不介入)。
 * 纯函数,便于测试;每行只取一次(多光标落同一行时去重)。
 */
export const lineWiseSelection = (state: EditorState): EditorSelection | null => {
  if (state.selection.ranges.some((range) => !range.empty)) {
    return null;
  }

  const seenLines = new Set<number>();
  const ranges: SelectionRange[] = [];
  for (const range of state.selection.ranges) {
    const line = state.doc.lineAt(range.head);
    if (seenLines.has(line.number)) continue;
    seenLines.add(line.number);
    ranges.push(EditorSelection.range(line.from, Math.min(state.doc.length, line.to + 1)));
  }
  return EditorSelection.create(ranges);
};

/**
 * 复制/剪切时若无选中,先选中光标所在整行,再让浏览器原生 copy/cut 带着整行选区继续。
 * 返回 false 且不 preventDefault:不吞按键,keydown 之后浏览器照常触发 copy/cut。
 */
const selectLineBeforeClipboard: Command = (view) => {
  const selection = lineWiseSelection(view.state);
  if (!selection) return false; // 有选中:原样复制/剪切选区
  view.dispatch({ selection });
  return false;
};

// 注意:不能走带 preventDefault:true 的 action keymap,否则原生 copy/cut 事件不再触发。
export const copyCutWholeLineWhenEmpty = keymap.of([
  { key: "Mod-c", run: selectLineBeforeClipboard },
  { key: "Mod-x", run: selectLineBeforeClipboard },
]);

// ── 光标跳转历史(IDE 的「后退 / 前进」)────────────────────────────────
// 只记录鼠标点击造成的跨行跳转,按点击先后串成一条历史;后退/前进沿它移动光标。
const JUMP_HISTORY_MAX = 60; // 上限,防无限增长;超出丢弃最早的
const JUMP_MIN_LINE_GAP = 1; // 跨行才算一次跳转,同行微调不入历史

type JumpHistory = { positions: number[]; index: number };

// 标记「这是后退/前进导航本身」的事务:只挪 index,不产生新历史点。
const setJumpIndex = StateEffect.define<number>();

export const jumpHistoryField = StateField.define<JumpHistory>({
  create: () => ({ positions: [], index: -1 }),
  update(value, tr) {
    let positions = value.positions;
    // 文档变更 → 把已记录位置随改动映射,避免编辑后跳到错位。
    if (tr.docChanged) positions = positions.map((pos) => tr.changes.mapPos(pos, 1));

    for (const effect of tr.effects) {
      if (effect.is(setJumpIndex)) return { positions, index: effect.value };
    }

    // 仅记录鼠标点击(select.pointer)造成的选区变化。
    if (!tr.isUserEvent("select.pointer") || !tr.selection) {
      return positions === value.positions ? value : { positions, index: value.index };
    }

    const newPos = tr.state.selection.main.head;
    const newLine = tr.state.doc.lineAt(newPos).number;
    // 基准:历史当前项,否则跳转前的位置。
    const baseRaw = positions[value.index] ?? tr.startState.selection.main.head;
    const baseLine = tr.state.doc.lineAt(Math.min(Math.max(baseRaw, 0), tr.state.doc.length)).number;
    if (Math.abs(newLine - baseLine) < JUMP_MIN_LINE_GAP) {
      return positions === value.positions ? value : { positions, index: value.index };
    }

    // 从历史中部再跳 → 丢弃「前进」分支;首跳 → 先把跳转前的位置作为起点入栈。
    let next = positions.slice(0, value.index + 1);
    if (next.length === 0) next = [tr.startState.selection.main.head];
    next.push(newPos);
    if (next.length > JUMP_HISTORY_MAX) next = next.slice(next.length - JUMP_HISTORY_MAX);
    return { positions: next, index: next.length - 1 };
  },
});

const jumpTo = (view: EditorView, targetIndex: number): boolean => {
  const history = view.state.field(jumpHistoryField, false);
  if (!history || targetIndex < 0 || targetIndex >= history.positions.length || targetIndex === history.index) {
    return false;
  }
  const pos = Math.min(history.positions[targetIndex], view.state.doc.length);
  view.dispatch({
    selection: EditorSelection.cursor(pos),
    effects: setJumpIndex.of(targetIndex),
    scrollIntoView: true,
  });
  view.focus();
  return true;
};

/** 后退到上一个点击位置。 */
export const jumpBack: Command = (view) => jumpTo(view, (view.state.field(jumpHistoryField, false)?.index ?? 0) - 1);

/** 前进到下一个点击位置(需先后退过)。 */
export const jumpForward: Command = (view) => jumpTo(view, (view.state.field(jumpHistoryField, false)?.index ?? -1) + 1);

// 鼠标侧键:button 3 = 后退键,button 4 = 前进键,映射到跳转历史的后退/前进。
export const mouseNavButtons = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button === 3) {
      jumpBack(view);
      event.preventDefault();
      return true;
    }
    if (event.button === 4) {
      jumpForward(view);
      event.preventDefault();
      return true;
    }
    return false;
  },
});
