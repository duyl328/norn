import { type Extension, StateEffect, StateField, type Text } from "@codemirror/state";
import { type Command, Decoration, EditorView, gutter, GutterMarker, keymap, WidgetType } from "@codemirror/view";

import { chunkWordOps, type GitChunk, lineChunks, type WordOp } from "./line-diff";

/** 请求为当前文件打开并排 diff(浮层上的「显示完整差异」)。workbench-page 接住它。 */
export const openGitDiffRequestEvent = "norn:open-git-diff";

/** 设置该文档在 HEAD 里的原始内容(基线);null = 不显示改动条(非仓库文件 / 新文件 / 大文件)。 */
export const setGitBaseline = StateEffect.define<string | null>();

type GitDiffState = { chunks: GitChunk[]; lines: string[] };

// ponytail: 每次按键全量重算行 diff(Myers)。几千行以内无感;更大的文件在 editor-surface 里直接不取基线。
const diffAgainst = (baseline: string | null, doc: Text): GitDiffState =>
  baseline === null
    ? { chunks: [], lines: [] }
    : { chunks: lineChunks(baseline, doc.toString()), lines: baseline.split("\n") };

const gitDiffField = StateField.define<{ baseline: string | null } & GitDiffState>({
  create: () => ({ baseline: null, chunks: [], lines: [] }),
  update(value, tr) {
    let baseline = value.baseline;
    let reset = false;
    for (const effect of tr.effects) {
      if (effect.is(setGitBaseline)) {
        baseline = effect.value;
        reset = true;
      }
    }
    return !reset && !tr.docChanged ? value : { baseline, ...diffAgainst(baseline, tr.state.doc) };
  },
});

/** 命中某行的改动块:add/mod 覆盖自身行区间;del 挂在删除位置前一行(文首删除挂第 1 行)。 */
export function chunkAtLine(chunks: GitChunk[], line: number): GitChunk | null {
  return (
    chunks.find((chunk) =>
      chunk.kind === "del" ? Math.max(1, chunk.fromLine) === line : line >= chunk.fromLine && line <= chunk.toLine,
    ) ?? null
  );
}

/** 撤回一块改动:把 HEAD 里的原始行写回当前文档。 */
export function revertChunk(doc: Text, chunk: GitChunk): { from: number; insert: string; to: number } {
  const insert = chunk.original.join("\n");
  if (chunk.kind === "del") {
    // 纯删除:原始行插回锚点行之后(锚点为 0 时插到文首)。
    const at = chunk.fromLine === 0 ? 0 : doc.line(chunk.fromLine).to;
    return { from: at, to: at, insert: chunk.fromLine === 0 ? `${insert}\n` : `\n${insert}` };
  }
  const from = doc.line(chunk.fromLine).from;
  const to = doc.line(chunk.toLine).to;
  if (chunk.kind === "add") {
    // 纯新增:连带一个换行一起删掉,否则原地留下空行。
    return chunk.toLine < doc.lines
      ? { from, to: doc.line(chunk.toLine + 1).from, insert: "" }
      : { from: Math.max(0, from - 1), to, insert: "" };
  }
  return { from, to, insert };
}

/** 块在当前文档里对应的行文本(纯删除块没有当前行)。 */
const currentLines = (doc: Text, chunk: GitChunk): string[] => {
  if (chunk.kind === "del") return [];
  const lines: string[] = [];
  for (let line = chunk.fromLine; line <= Math.min(chunk.toLine, doc.lines); line += 1) {
    lines.push(doc.line(line).text);
  }
  return lines;
};

// 类名必须写成字面量:Tailwind 按源码里出现过的字符串裁剪 @layer components,
// 拼出来的 `cm-git-change-${kind}` 扫不到,配色规则会被整体裁掉(标记就成了透明条)。
// head/tail = 改动块的首行 / 末行:上沿、下沿各画圆角(单行块两头都占,即四角全圆),
// 块中间的行保持方角,连起来才是一整条。
const MARKER_CLASS: Record<string, string> = {
  add: "cm-git-change cm-git-change-add",
  "add-head": "cm-git-change cm-git-change-add cm-git-change-head",
  "add-tail": "cm-git-change cm-git-change-add cm-git-change-tail",
  "add-head-tail": "cm-git-change cm-git-change-add cm-git-change-head cm-git-change-tail",
  del: "cm-git-change cm-git-change-del",
  "del-head": "cm-git-change cm-git-change-del",
  "del-tail": "cm-git-change cm-git-change-del",
  "del-head-tail": "cm-git-change cm-git-change-del",
  mod: "cm-git-change cm-git-change-mod",
  "mod-head": "cm-git-change cm-git-change-mod cm-git-change-head",
  "mod-tail": "cm-git-change cm-git-change-mod cm-git-change-tail",
  "mod-head-tail": "cm-git-change cm-git-change-mod cm-git-change-head cm-git-change-tail",
};

// 同上:词级切片的类名也必须字面量。pair 双色交替 —— 同一处改动在编辑区和浮层里同色,靠颜色配对。
const OP_CLASS: Record<string, string> = {
  add: "cm-git-op cm-git-op-add",
  del: "cm-git-op cm-git-op-del",
  "pair-0": "cm-git-op cm-git-op-a",
  "pair-1": "cm-git-op cm-git-op-b",
};

const opClass = (op: WordOp): string => (op.kind === "pair" ? OP_CLASS[`pair-${op.pair % 2}`] : OP_CLASS[op.kind]);

class ChangeMarker extends GutterMarker {
  constructor(readonly key: string) {
    super();
  }
  eq(other: ChangeMarker) {
    return other.key === this.key;
  }
  toDOM() {
    const el = document.createElement("div");
    el.className = MARKER_CLASS[this.key];
    return el;
  }
}

const MARKERS: Record<string, ChangeMarker> = Object.fromEntries(
  Object.keys(MARKER_CLASS).map((key) => [key, new ChangeMarker(key)]),
);

/** 行内删除锚点:被删掉的文字在新行里没有位置可占,就在删除处画一个小三角(hover 显示删了什么)。 */
class DeletionAnchor extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: DeletionAnchor) {
    return other.text === this.text;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-git-anchor";
    el.title = this.text;
    return el;
  }
}

/**
 * 展开中的改动块。line = 展开时点的是哪一行(1-based)—— 一个块可能跨很多行,
 * 悬浮工具条要落在你点的那一行上,而不是块的首行。null = 没有展开的。
 */
type Expanded = { chunk: GitChunk; line: number };
const setExpandedChunk = StateEffect.define<Expanded | null>();

// 文档一改行号就偏了,展开的块直接收起(重新点开即可)——比维护映射便宜得多。
const expandedField = StateField.define<Expanded | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setExpandedChunk)) {
        return effect.value;
      }
    }
    return tr.docChanged ? null : value;
  },
});

const sameChunk = (a: GitChunk | null, b: GitChunk | null) =>
  a === b || (!!a && !!b && a.kind === b.kind && a.fromLine === b.fromLine && a.toLine === b.toLine);

/** 块的锚点行(纯删除挂在删除位置前一行,文首删除挂第 1 行)。 */
const anchorOf = (chunk: GitChunk) => Math.max(1, chunk.fromLine);

/** 把光标放到某块的首行并展开它。dir 决定从光标位置往哪边找。 */
const gotoChunk = (view: EditorView, dir: -1 | 1): boolean => {
  const { chunks } = view.state.field(gitDiffField);
  if (chunks.length === 0) {
    return false;
  }
  const here = view.state.doc.lineAt(view.state.selection.main.head).number;
  const ordered = dir === 1 ? chunks : [...chunks].reverse();
  // 找不到下一处就回卷到头/尾 —— 一路按下去能绕着文件转,和 IDEA / VSCode 一致。
  const target = ordered.find((chunk) => (dir === 1 ? anchorOf(chunk) > here : anchorOf(chunk) < here)) ?? ordered[0];

  const line = Math.min(anchorOf(target), view.state.doc.lines);
  const at = view.state.doc.line(line).from;
  view.dispatch({
    selection: { anchor: at },
    effects: setExpandedChunk.of({ chunk: target, line }),
    scrollIntoView: true,
  });
  return true;
};

export const nextGitChunk: Command = (view) => gotoChunk(view, 1);
export const previousGitChunk: Command = (view) => gotoChunk(view, -1);

/** 回退光标所在的改动块(还原成 HEAD 的样子)。命令面板 / 快捷键用,不必先展开。 */
export const revertChunkAtCursor: Command = (view) => {
  const line = view.state.doc.lineAt(view.state.selection.main.head).number;
  const chunk = chunkAtLine(view.state.field(gitDiffField).chunks, line);
  if (!chunk) {
    return false;
  }
  view.dispatch({ changes: revertChunk(view.state.doc, chunk) });
  return true;
};

export type GitChunkLabels = () => {
  close: string;
  copy: string;
  meta: (chunk: GitChunk) => string;
  next: string;
  openDiff: string;
  previous: string;
  revert: string;
};

const ICONS: Record<string, string> = {
  close: '<path d="m7 7 10 10M17 7 7 17"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/>',
  diff: '<path d="M8 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3"/><path d="M16 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M12 3v18M9 8h6M9 16h6"/>',
  next: '<path d="m7 10 5 5 5-5"/>',
  previous: '<path d="m7 14 5-5 5 5"/>',
  revert: '<path d="M9 7 5 11l4 4"/><path d="M6 11h7a5 5 0 1 1 0 10"/>',
};

/** 工具条:上一处 / 下一处 | 撤回 / 完整差异 / 复制 | 关闭。卡片和悬浮条共用。 */
const buildBar = (view: EditorView, chunk: GitChunk, labels: ReturnType<GitChunkLabels>): HTMLElement => {
  const bar = document.createElement("div");
  bar.className = "cm-git-inline-bar";
  const button = (action: string, tip: string, onClick: () => void) => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "cm-git-inline-action";
    el.dataset.action = action;
    el.title = tip;
    el.setAttribute("aria-label", tip);
    el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[action]}</svg>`;
    el.onmousedown = (event) => event.preventDefault(); // 别把焦点从编辑器上抢走
    el.onclick = onClick;
    bar.append(el);
  };
  const separator = () => {
    const el = document.createElement("span");
    el.className = "cm-git-inline-sep";
    bar.append(el);
  };

  button("previous", labels.previous, () => previousGitChunk(view));
  button("next", labels.next, () => nextGitChunk(view));
  separator();
  button("revert", labels.revert, () => view.dispatch({ changes: revertChunk(view.state.doc, chunk) }));
  button("diff", labels.openDiff, () => window.dispatchEvent(new CustomEvent(openGitDiffRequestEvent)));
  if (chunk.original.length > 0) {
    button("copy", labels.copy, () => void navigator.clipboard?.writeText(chunk.original.join("\n")));
  }
  separator();
  button("close", labels.close, () => view.dispatch({ effects: setExpandedChunk.of(null) }));
  return bar;
};

/**
 * 纯新增块的浮层:HEAD 里没有原文可对照,只有一条工具条 —— 那就别撑开一整行去摆它。
 * 外层 span 零尺寸、留在行内当定位原点,工具条绝对定位悬浮在该行之上,不挤动任何排版。
 */
class FloatingBarWidget extends WidgetType {
  constructor(
    readonly chunk: GitChunk,
    readonly line: number,
    readonly labels: GitChunkLabels,
  ) {
    super();
  }

  eq(other: FloatingBarWidget) {
    return sameChunk(other.chunk, this.chunk) && other.line === this.line;
  }

  toDOM(view: EditorView) {
    const anchor = document.createElement("span");
    anchor.className = "cm-git-float";
    anchor.append(buildBar(view, this.chunk, this.labels()));
    return anchor;
  }
}

/** 点开改动条后浮出的卡片:HEAD 原文(带上下文行 + 词级配色)+ 右上角图标工具条。 */
class OriginalWidget extends WidgetType {
  constructor(
    readonly chunk: GitChunk,
    readonly baseline: string[],
    readonly labels: GitChunkLabels,
  ) {
    super();
  }

  eq(other: OriginalWidget) {
    return sameChunk(other.chunk, this.chunk) && other.chunk.original.join("\n") === this.chunk.original.join("\n");
  }

  toDOM(view: EditorView) {
    const { baseline, chunk } = this;
    const labels = this.labels();
    const box = document.createElement("div");
    box.className = "cm-git-inline";
    box.append(buildBar(view, chunk, labels));

    const row = (className: string, render: (code: HTMLElement) => void) => {
      const el = document.createElement("div");
      el.className = className;
      const code = document.createElement("span");
      code.className = "cm-git-row-code";
      render(code);
      el.append(code);
      box.append(el);
    };
    // HEAD 侧的行号区间就是干这个用的:据它从基线里取相邻行。
    const context = (index: number) => {
      const text = baseline[index];
      if (text !== undefined) {
        row("cm-git-row cm-git-row-ctx", (code) => (code.textContent = text || " "));
      }
    };

    // 纯删除只摆被删掉的内容 —— 那几行本身就是全部信息,上下文行和「N 行删除」都是噪音。
    // 修改块不一样:旧行要跟正文里的新行对照着看,不给上下文就不知道它落在哪儿。
    const detailed = chunk.kind === "mod";

    if (detailed) {
      context(chunk.origFrom - 2);
    }
    for (const ops of chunkWordOps(chunk.original, currentLines(view.state.doc, chunk))) {
      if (ops.oldOps.length === 0) continue; // 新增出来的行在原文里没有对应,浮层不展示
      row("cm-git-row cm-git-row-old", (code) => {
        for (const op of ops.oldOps) {
          if (op.kind === "same") {
            code.append(op.text);
            continue;
          }
          const mark = document.createElement("span");
          mark.className = opClass(op);
          mark.textContent = op.text;
          code.append(mark);
        }
      });
    }
    if (detailed) {
      context(chunk.origTo);
      const foot = document.createElement("div");
      foot.className = "cm-git-inline-foot";
      foot.textContent = labels.meta(chunk);
      box.append(foot);
    }
    return box;
  }

  // ignoreEvent 用默认的 true:编辑器不接管浮层里的事件,DOM 自己处理 —— 按钮的 click 照常触发,
  // 拖选原文也能选中(返回 false 的话 mousedown 会被当成编辑器的选区起点,浮层里的文字就选不动了)。
}

/**
 * VSCode/IDEA 式改动条:紧贴正文左侧一列,显示当前文档相对 HEAD 的增/改/删。
 * 点一下改动条 → 该块的 HEAD 原文展开在改动行正上方(带上下文行、词级配色、图标工具条)。
 * 改动行上的词级高亮常驻:同一处改动在编辑区和浮层里配同一种颜色,不用猜谁对应谁。
 *
 * baseline 必须在建 state 时就灌进来:视图重建(切文档 view.setState、dev 期 HMR)会把 StateField
 * 复位成初始值,只靠异步 setGitBaseline 的话重建后基线就丢了 —— 标记会整片消失。
 */
export function gitChangeGutter(baseline: string | null, labels: GitChunkLabels): Extension {
  const chunkAt = (view: EditorView, pos: number) =>
    chunkAtLine(view.state.field(gitDiffField).chunks, view.state.doc.lineAt(pos).number);

  const LINE_DECO = {
    add: Decoration.line({ class: "cm-git-line-add" }),
    mod: Decoration.line({ class: "cm-git-line-mod" }),
  };
  const ACTIVE_DECO = Decoration.line({ class: "cm-git-line-open" });

  return [
    gitDiffField.init((state) => ({ baseline, ...diffAgainst(baseline, state.doc) })),
    expandedField,
    // Esc 收起浮层。没展开就返回 false,把 Esc 让给别的处理者(查找框、「回到编辑器」)。
    keymap.of([
      {
        key: "Escape",
        run: (view) => {
          if (!view.state.field(expandedField)) {
            return false;
          }
          view.dispatch({ effects: setExpandedChunk.of(null) });
          return true;
        },
      },
    ]),
    // 编辑器整体失焦就收起浮层(点到文件树 / git 面板 / 别的 tab 去了 —— 它没道理还挂在那儿)。
    // 工具条上的按钮在 mousedown 里 preventDefault,不会抢走焦点,所以点按钮不会误触发这里。
    EditorView.focusChangeEffect.of((state, focusing) =>
      !focusing && state.field(expandedField) ? setExpandedChunk.of(null) : null,
    ),
    // 在编辑器「内部」点别处也算失焦(回正文里去了),但那不会触发 blur —— 得自己接 mousedown。
    // 浮层自己、改动条那一列除外:前者是在用它,后者由 gutter 的 handler 负责开合。
    EditorView.domEventHandlers({
      mousedown: (event, view) => {
        if (!view.state.field(expandedField)) {
          return false;
        }
        const target = event.target as HTMLElement | null;
        if (target?.closest(".cm-git-inline, .cm-git-float, .cm-git-gutter")) {
          return false;
        }
        view.dispatch({ effects: setExpandedChunk.of(null) });
        return false; // 不吞事件:光标该落哪儿落哪儿
      },
    }),
    EditorView.decorations.compute([gitDiffField, expandedField], (state) => {
      // 用 Decoration.set(_, true) 而不是 RangeSetBuilder:块级浮层 / 整行底色 / 行内词级标记 / 删除锚点
      // 混在同一位置上,手工保证「按 from + startSide 升序」太脆,交给它排。
      const ranges = [];
      const expanded = state.field(expandedField);
      const { chunks, lines } = state.field(gitDiffField);

      for (const chunk of chunks) {
        if (sameChunk(chunk, expanded?.chunk ?? null)) {
          if (chunk.kind === "add") {
            // 纯新增只有一条工具条,没必要撑开一整行 —— 挂到「你点的那一行」行首(靠左),悬浮在行上。
            // 块可能跨很多行,挂 fromLine 的话点第 18 行会弹到第 10 行去。
            const at = Math.min(expanded?.line ?? chunk.fromLine, state.doc.lines);
            const line = state.doc.line(at);
            ranges.push(
              Decoration.widget({ widget: new FloatingBarWidget(chunk, at, labels), side: -1 }).range(line.from),
            );
          } else {
            // 有原文可对照 → 卡片挂在改动行正上方(纯删除块挂在锚点行的下一行前 = 被删内容原来的位置)。
            const line = Math.max(1, chunk.kind === "del" ? chunk.fromLine + 1 : chunk.fromLine);
            const at = state.doc.line(Math.min(line, state.doc.lines)).from;
            ranges.push(
              Decoration.widget({ widget: new OriginalWidget(chunk, lines, labels), block: true, side: -1 }).range(at),
            );
          }
        }
        // 改动行整行淡染:光看 gutter 那条细线太容易漏。删除块没有当前行,只在 gutter 上出三角。
        if (chunk.kind === "del") continue;

        const rows = chunk.kind === "mod" ? chunkWordOps(chunk.original, currentLines(state.doc, chunk)) : [];
        for (let line = chunk.fromLine; line <= Math.min(chunk.toLine, state.doc.lines); line += 1) {
          const info = state.doc.line(line);
          ranges.push(LINE_DECO[chunk.kind].range(info.from));
          // 展开时点亮它对应的改动行:红块贴在行的上方,不点亮容易被读成上一处改动的。
          if (sameChunk(chunk, expanded?.chunk ?? null)) {
            ranges.push(ACTIVE_DECO.range(info.from));
          }

          // 词级高亮:只有 mod 块有「改前 / 改后」可比。同 pair 号 = 浮层里同色的那一处。
          let offset = 0;
          for (const op of rows[line - chunk.fromLine]?.newOps ?? []) {
            if (op.kind === "del") {
              // 被删掉的文字在新行里不占宽度,画个锚点标出它原来在哪儿。
              ranges.push(
                Decoration.widget({ widget: new DeletionAnchor(op.text), side: 1 }).range(info.from + offset),
              );
              continue;
            }
            if (op.kind !== "same") {
              ranges.push(
                Decoration.mark({ class: opClass(op) }).range(info.from + offset, info.from + offset + op.text.length),
              );
            }
            offset += op.text.length;
          }
        }
      }
      return Decoration.set(ranges, true);
    }),
    gutter({
      class: "cm-git-gutter",
      lineMarker: (view, line) => {
        const chunk = chunkAt(view, line.from);
        if (!chunk) {
          return null;
        }
        const no = view.state.doc.lineAt(line.from).number;
        const edge = `${no === Math.max(1, chunk.fromLine) ? "-head" : ""}${no === chunk.toLine ? "-tail" : ""}`;
        return MARKERS[`${chunk.kind}${edge}`];
      },
      lineMarkerChange: (update) => update.startState.field(gitDiffField) !== update.state.field(gitDiffField),
      // 不用 initialSpacer:宽度由 CSS 固定,占位元素只会在 DOM 里多出一个假标记。
      domEventHandlers: {
        // 点改动条 = 就地展开这一块的 HEAD 原文;再点一次收起。记下点的是哪一行 ——
        // 悬浮工具条要落在这一行上(块跨多行时,点第 18 行不能弹到块首的第 10 行去)。
        mousedown: (view, line) => {
          const no = view.state.doc.lineAt(line.from).number;
          const chunk = chunkAt(view, line.from);
          if (!chunk) {
            return false;
          }
          const expanded = view.state.field(expandedField);
          const open = sameChunk(chunk, expanded?.chunk ?? null) && expanded?.line === no;
          view.dispatch({ effects: setExpandedChunk.of(open ? null : { chunk, line: no }) });
          return true;
        },
      },
    }),
  ];
}
