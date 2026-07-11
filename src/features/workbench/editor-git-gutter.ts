import { type Extension, RangeSetBuilder, StateEffect, StateField, type Text } from "@codemirror/state";
import { type Command, Decoration, EditorView, gutter, GutterMarker, WidgetType } from "@codemirror/view";

import { type GitChunk, inlineParts, lineChunks } from "./line-diff";

/** 设置该文档在 HEAD 里的原始内容(基线);null = 不显示改动条(非仓库文件 / 新文件 / 大文件)。 */
export const setGitBaseline = StateEffect.define<string | null>();

type GitDiffState = { baseline: string | null; chunks: GitChunk[] };

// ponytail: 每次按键全量重算行 diff(Myers)。几千行以内无感;更大的文件在 editor-surface 里直接不取基线。
const diffAgainst = (baseline: string | null, doc: Text): GitDiffState => ({
  baseline,
  chunks: baseline === null ? [] : lineChunks(baseline, doc.toString()),
});

const gitDiffField = StateField.define<GitDiffState>({
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
    return !reset && !tr.docChanged ? value : diffAgainst(baseline, tr.state.doc);
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

// 类名必须写成字面量:Tailwind 按源码里出现过的字符串裁剪 @layer components,
// 拼出来的 `cm-git-change-${kind}` 扫不到,三条配色规则会被整体裁掉(标记就成了透明条)。
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

/** 展开中的改动块(点改动条时把 HEAD 原文行内插进正文);null = 没有展开的。 */
const setExpandedChunk = StateEffect.define<GitChunk | null>();

// 文档一改行号就偏了,展开的块直接收起(重新点开即可)——比维护映射便宜得多。
const expandedField = StateField.define<GitChunk | null>({
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

export type GitChunkLabels = () => { added: (count: number) => string; copy: string; revert: string };

/** 行内展开的「改动前(HEAD)」块:红底,词级高亮出被改掉的字符,右上角 撤回 / 复制 / 关闭。 */
class OriginalWidget extends WidgetType {
  constructor(
    readonly chunk: GitChunk,
    readonly labels: GitChunkLabels,
  ) {
    super();
  }

  eq(other: OriginalWidget) {
    return sameChunk(other.chunk, this.chunk) && other.chunk.original.join("\n") === this.chunk.original.join("\n");
  }

  toDOM(view: EditorView) {
    const { chunk } = this;
    const labels = this.labels();
    const box = document.createElement("div");
    box.className = "cm-git-inline";

    const bar = document.createElement("div");
    bar.className = "cm-git-inline-bar";
    const button = (label: string, onClick: () => void) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "cm-git-inline-action";
      el.textContent = label;
      el.onmousedown = (event) => event.preventDefault(); // 别把焦点从编辑器上抢走
      el.onclick = onClick;
      bar.append(el);
    };
    button(labels.revert, () => view.dispatch({ changes: revertChunk(view.state.doc, chunk) }));
    if (chunk.original.length > 0) {
      button(labels.copy, () => void navigator.clipboard?.writeText(chunk.original.join("\n")));
    }
    button("✕", () => view.dispatch({ effects: setExpandedChunk.of(null) }));
    box.append(bar);

    // 纯新增块在 HEAD 里没有原文可展示 —— 说明「这几行是新增的」即可,撤回按钮照样可用。
    if (chunk.original.length === 0) {
      const note = document.createElement("div");
      note.className = "cm-git-inline-note";
      note.textContent = labels.added(chunk.toLine - chunk.fromLine + 1);
      box.append(note);
      return box;
    }

    // 与当前行逐行配对做词级 diff:标出的是「HEAD 里这段被改掉了」。纯删除块没有当前行,整行标红。
    const current: string[] = [];
    for (let line = chunk.fromLine; chunk.kind !== "del" && line <= chunk.toLine; line += 1) {
      current.push(view.state.doc.line(line).text);
    }
    chunk.original.forEach((text, index) => {
      const row = document.createElement("div");
      row.className = "cm-git-inline-row";
      const peer = current[index];
      if (peer === undefined) {
        row.textContent = text;
      } else {
        const { pre, aMid, post } = inlineParts(text, peer);
        const mark = document.createElement("mark");
        mark.className = "cm-git-inline-word";
        mark.textContent = aMid;
        row.append(pre, mark, post);
      }
      box.append(row);
    });
    return box;
  }

  ignoreEvent() {
    return false; // 工具条上的点击要能落到按钮上
  }
}

/**
 * VSCode/IDEA 式改动条:紧贴正文左侧一列,显示当前文档相对 HEAD 的增/改/删。
 * 点一下改动条 → 该块的 HEAD 原文就地展开在改动行正上方(再点一次收起),浮条上可撤回 / 复制。
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
    gitDiffField.init((state) => diffAgainst(baseline, state.doc)),
    expandedField,
    EditorView.decorations.compute([gitDiffField, expandedField], (state) => {
      const builder = new RangeSetBuilder<Decoration>();
      const expanded = state.field(expandedField);
      for (const chunk of state.field(gitDiffField).chunks) {
        // 展开的 HEAD 原文:挂在改动行正上方(纯删除块挂在锚点行的下一行前 = 被删内容原来的位置)。
        if (sameChunk(chunk, expanded)) {
          const line = Math.max(1, chunk.kind === "del" ? chunk.fromLine + 1 : chunk.fromLine);
          const at = state.doc.line(Math.min(line, state.doc.lines)).from;
          builder.add(at, at, Decoration.widget({ widget: new OriginalWidget(chunk, labels), block: true, side: -1 }));
        }
        // 改动行整行淡染:光看 gutter 那条细线太容易漏。删除块没有当前行,只在 gutter 上出三角。
        if (chunk.kind === "del") continue;
        for (let line = chunk.fromLine; line <= Math.min(chunk.toLine, state.doc.lines); line += 1) {
          const at = state.doc.line(line).from;
          builder.add(at, at, LINE_DECO[chunk.kind]);
          // 展开时点亮它对应的改动行:红块贴在行的上方,不点亮容易被读成上一处改动的。
          if (sameChunk(chunk, expanded)) {
            builder.add(at, at, ACTIVE_DECO);
          }
        }
      }
      return builder.finish();
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
        // 点改动条 = 就地展开这一块的 HEAD 原文;再点一次收起。
        mousedown: (view, line) => {
          const chunk = chunkAt(view, line.from);
          if (!chunk) {
            return false;
          }
          const open = sameChunk(chunk, view.state.field(expandedField)) ? null : chunk;
          view.dispatch({ effects: setExpandedChunk.of(open) });
          return true;
        },
      },
    }),
  ];
}
