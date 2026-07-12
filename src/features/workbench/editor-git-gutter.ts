import { type Extension, StateEffect, StateField, type Text } from "@codemirror/state";
import {
  type Command,
  Decoration,
  EditorView,
  gutter,
  GutterMarker,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";

import { translate } from "./i18n-dictionaries";
import { chunkWordOps, type GitChunk, lineChunks, type WordOp } from "./line-diff";
import { useWorkbenchStore } from "./store/workbench-store";

/** 请求为当前文件打开并排 diff(浮层上的「显示完整差异」)。workbench-page 接住它。 */
export const openGitDiffRequestEvent = "norn:open-git-diff";

/** 设置该文档在 HEAD 里的原始内容(基线);null = 不显示改动条(非仓库文件 / 新文件 / 大文件)。 */
export const setGitBaseline = StateEffect.define<string | null>();

// ponytail: 每次按键全量重算行 diff(Myers)。几千行以内无感;更大的文件在 editor-surface 里直接不取基线。
const diffAgainst = (baseline: string | null, doc: Text): GitChunk[] =>
  baseline === null ? [] : lineChunks(baseline, doc.toString());

const gitDiffField = StateField.define<{ baseline: string | null; chunks: GitChunk[] }>({
  create: () => ({ baseline: null, chunks: [] }),
  update(value, tr) {
    let baseline = value.baseline;
    let reset = false;
    for (const effect of tr.effects) {
      if (effect.is(setGitBaseline)) {
        baseline = effect.value;
        reset = true;
      }
    }
    return !reset && !tr.docChanged ? value : { baseline, chunks: diffAgainst(baseline, tr.state.doc) };
  },
});

/** 命中某行的改动块:add/mod 覆盖自身行区间;del 挂在删除位置前一行(文首删除挂第 1 行)。 */
function chunkAtLine(chunks: GitChunk[], line: number): GitChunk | null {
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

/**
 * 零宽锚点:一处「只存在于一边」的改动,在另一边没有位置可占,就在那个位置竖一根线。
 * 编辑区里的红线 = 这儿被删了东西(原文有、现在没了);浮层里的绿线 = 这儿被加了东西(反过来)。
 */
const buildAnchor = (kind: "add" | "del", text: string): HTMLElement => {
  const el = document.createElement("span");
  el.className = kind === "add" ? "cm-git-anchor cm-git-anchor-add" : "cm-git-anchor cm-git-anchor-del";
  el.title = text;
  return el;
};

class DeletionAnchor extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: DeletionAnchor) {
    return other.text === this.text;
  }
  toDOM() {
    return buildAnchor("del", this.text);
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
  next: string;
  openDiff: string;
  previous: string;
  revert: string;
};

/**
 * 工具条文案。调用时才取语言(而不是建扩展时定死)—— 切语言后下次展开即生效,不必重建编辑器。
 */
export const gitChunkLabels: GitChunkLabels = () => {
  const language = useWorkbenchStore.getState().language;
  return {
    close: translate(language, "common.close"),
    copy: translate(language, "common.copy"),
    next: translate(language, "git.nextChunk"),
    openDiff: translate(language, "git.openFullDiff"),
    previous: translate(language, "git.previousChunk"),
    revert: translate(language, "git.revertChunk"),
  };
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

/** 浮层里那一行 HEAD 原文(词级配色 + 绿色新增锚点)。 */
const buildOriginalRow = (ops: WordOp[]): HTMLElement => {
  const el = document.createElement("div");
  el.className = "cm-git-row cm-git-row-old";
  const code = document.createElement("span");
  code.className = "cm-git-row-code";
  for (const op of ops) {
    if (op.kind === "same") {
      code.append(op.text);
      continue;
    }
    if (op.kind === "add") {
      // 新增的字在旧行里根本不存在 —— 不能当文字塞进来,只在它「将被插入的位置」竖一根绿线。
      code.append(buildAnchor("add", op.text));
      continue;
    }
    const mark = document.createElement("span");
    mark.className = opClass(op);
    mark.textContent = op.text;
    code.append(mark);
  }
  el.append(code);
  return el;
};

/**
 * 点开改动条后浮出来的东西:HEAD 原文(词级配色)+ 图标工具条。纯新增块在 HEAD 里没有原文,
 * 只剩一条工具条。
 *
 * **它是挂在 .cm-scroller 上的普通 DOM,不是 CodeMirror 的 widget** —— 这一点是被逼出来的:
 * widget 活在 .cm-content 里,那是 contenteditable=true 的地盘。WKWebView(Tauri 在 macOS 上的
 * 引擎)在「可编辑区里的 contenteditable=false 子树」上拖选时,会把 caret 拽回可编辑区去选正文 ——
 * 浮层里根本形不成选区(看不到高亮),Mod+C 复制的是编辑器那一行。Chromium 不这样,所以本地
 * e2e 全绿也照样掉坑。
 *
 * 搬到 contenteditable 外面之后,选中 / 复制就是浏览器的原生行为,不用再跟 CM 抢 copy 事件、
 * 不用提前偷存选区、也不用管 widget 的 ignoreEvent —— 那一整套 hack 全删了。
 * 代价是位置得自己算(coordsAtPos),换来的是这块地方不用再跟浏览器较劲。
 */
const popupLayer = (labels: GitChunkLabels) =>
  ViewPlugin.fromClass(
    class {
      readonly dom: HTMLElement;
      private shown: Expanded | null = null;

      constructor(readonly view: EditorView) {
        this.dom = document.createElement("div");
        this.dom.className = "cm-git-popup";
        this.dom.style.display = "none";
        // 挂进滚动层(CM 给它设了 position:relative)。绝对定位的子元素会跟着内容一起滚,
        // 不用监听 scroll 自己纠位置。
        view.scrollDOM.append(this.dom);

        // 点到浮层和改动条以外的任何地方就收起(编辑区正文、文件树、git 面板…)。
        // 挂在 document 上而不是 CM 上:浮层已经不在 CM 的事件管辖内了。
        document.addEventListener("mousedown", this.onDocumentMouseDown, true);
        document.addEventListener("keydown", this.onDocumentKeyDown, true);
        // 这里不能 render():视图还没测量过,coordsAtPos 读不到东西(插件在构造里抛错 = 被 CM 禁用)。
        // 反正刚建出来时也没有展开的块。
      }

      private onDocumentMouseDown = (event: MouseEvent) => {
        if (!this.view.state.field(expandedField)) return;
        const target = event.target as HTMLElement | null;
        // 改动条那一列由 gutter 自己的 handler 负责开合,别抢在它前面关掉。
        if (target?.closest(".cm-git-popup, .cm-git-gutter")) return;
        this.view.dispatch({ effects: setExpandedChunk.of(null) });
      };

      // Esc 收起。在浮层里点过之后焦点就不在编辑器上了(浮层不是编辑器的一部分,也不可聚焦,
      // 焦点会落到 body),CM 的 keymap 根本收不到这一下 —— 所以只能在 document 上接,
      // 而且不能要求事件落在浮层内。只在浮层开着时动手,不 preventDefault,不影响别的 Esc 处理者。
      private onDocumentKeyDown = (event: KeyboardEvent) => {
        if (event.key !== "Escape" || !this.view.state.field(expandedField)) return;
        this.view.dispatch({ effects: setExpandedChunk.of(null) });
      };

      update(update: ViewUpdate) {
        if (
          update.state.field(expandedField) !== update.startState.field(expandedField) ||
          update.docChanged ||
          update.geometryChanged ||
          update.viewportChanged
        ) {
          this.render();
        }
      }

      private render() {
        const { view } = this;
        const expanded = view.state.field(expandedField);
        if (!expanded) {
          this.dom.style.display = "none";
          this.dom.replaceChildren();
          this.shown = null;
          return;
        }

        const { chunk } = expanded;
        if (!sameChunk(this.shown?.chunk ?? null, chunk) || this.shown?.line !== expanded.line) {
          this.shown = expanded;
          const bar = buildBar(view, chunk, labels());
          if (chunk.original.length === 0) {
            this.dom.replaceChildren(bar); // 纯新增:HEAD 里没有原文可对照,不用卡片装
          } else {
            const card = document.createElement("div");
            card.className = "cm-git-inline";
            for (const ops of chunkWordOps(chunk.original, currentLines(view.state.doc, chunk))) {
              if (ops.oldOps.length === 0) continue; // 新增出来的行在原文里没有对应,浮层不展示
              card.append(buildOriginalRow(ops.oldOps));
            }
            card.append(bar); // 工具条另起一行排在原文下面:压在原文上会盖掉正要看的字
            this.dom.replaceChildren(card);
          }
        }
        this.place();
      }

      /** 定位。读几何量必须走 requestMeasure —— 在 update 里直接量会撞上 CM 的测量周期。 */
      private place() {
        this.view.requestMeasure({
          read: (view): { left: number; top: number } | null => {
            const expanded = view.state.field(expandedField);
            if (!expanded) return null;
            const { chunk } = expanded;
            // 纯新增只有工具条 → 落在你点的那一行上;有原文的块 → 卡片落在整块下面,别盖住改动本身。
            const line = Math.min(
              Math.max(1, chunk.kind === "add" ? expanded.line : chunk.toLine),
              view.state.doc.lines,
            );
            const coords = view.coordsAtPos(view.state.doc.line(line).from);
            if (!coords) return null; // 锚点行滚出了渲染范围
            // 视口坐标 → 滚动层内的绝对坐标(加回 scrollTop/Left,元素才会跟着内容一起滚)。
            const box = view.scrollDOM.getBoundingClientRect();
            return {
              left: coords.left - box.left + view.scrollDOM.scrollLeft,
              top:
                coords.top -
                box.top +
                view.scrollDOM.scrollTop +
                (chunk.kind === "add" ? -2 : view.defaultLineHeight),
            };
          },
          write: (at) => {
            if (!at) {
              this.dom.style.display = "none";
              return;
            }
            this.dom.style.display = "";
            this.dom.style.left = `${at.left}px`;
            this.dom.style.top = `${at.top}px`;
          },
        });
      }

      destroy() {
        document.removeEventListener("mousedown", this.onDocumentMouseDown, true);
        document.removeEventListener("keydown", this.onDocumentKeyDown, true);
        this.dom.remove();
      }
    },
  );

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
    gitDiffField.init((state) => ({ baseline, chunks: diffAgainst(baseline, state.doc) })),
    expandedField,
    // Esc 收起浮层由 popupLayer 的 document 级监听负责 —— 在浮层里点过之后焦点已经不在编辑器上,
    // 注册在 CM keymap 上的 Escape 根本收不到。
    popupLayer(labels),
    EditorView.decorations.compute([gitDiffField, expandedField], (state) => {
      // 用 Decoration.set(_, true) 而不是 RangeSetBuilder:块级浮层 / 整行底色 / 行内词级标记 / 删除锚点
      // 混在同一位置上,手工保证「按 from + startSide 升序」太脆,交给它排。
      const ranges = [];
      const expanded = state.field(expandedField);
      const { chunks } = state.field(gitDiffField);

      for (const chunk of chunks) {
        // 浮层本身不在这儿:它是挂在滚动层上的普通 DOM(见 popupLayer),不是装饰。
        // 改动行整行淡染:光看 gutter 那条细线太容易漏。删除块没有当前行,只在 gutter 上出竖线。
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
