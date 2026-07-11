import { diff } from "@codemirror/merge";

import type { DiffRow } from "./diff-parse";

/** 一段对照：左旧右新各自的行（双栏渲染用）。ctx 两侧等长；chg 任意一侧可为空=纯增/删。 */
export type DiffSegment = {
  kind: "ctx" | "chg";
  left: string[];
  right: string[];
  leftStart: number; // 左侧首行的 1-based 行号
  rightStart: number;
};

// 把每一行映射成唯一单字符，借 Myers diff() 得到行级增/删/改。纯文本，无语法解析。
function tokenize(a: string[], b: string[]): { sa: string; sb: string } {
  const tokens = new Map<string, string>();
  // ponytail: 唯一行数超过 0xFFFF 时 token 回绕，极端大文件才撞，需要时换 number[] diff。
  const tok = (line: string) => {
    let t = tokens.get(line);
    if (t === undefined) {
      t = String.fromCharCode(tokens.size);
      tokens.set(line, t);
    }
    return t;
  };
  return { sa: a.map(tok).join(""), sb: b.map(tok).join("") };
}

/**
 * 一处改动块（编辑器改动条用）。行号都是「当前文档」里的 1-based 行号：
 * add/mod 覆盖 fromLine..toLine；del 是纯删除，没有当前行，fromLine=toLine=删除位置之前的那一行（可能是 0=文首）。
 * original 是这块在 HEAD 里的原始行，撤回时写回去。
 */
export type GitChunk = {
  fromLine: number;
  kind: "add" | "del" | "mod";
  original: string[];
  toLine: number;
};

/**
 * 原始全文 vs 当前全文 → 行级改动块。
 *
 * 一段连续差异内部还会再切一刀:旧行和新行按顺序配对,配得上的算「修改」,新行多出来的尾巴
 * 单独切成「新增」——否则「新增一行 + 改两行」会整段判成修改,那行本该是绿的却涂成蓝的。
 * 旧行多出来的尾巴不再单切:纯删除块得挂在某一行上,那一行正好是修改块的末行,会撞在一起;
 * 多出的旧行直接留在修改块的 original 里,撤回时照样一起写回。
 */
export function lineChunks(original: string, current: string): GitChunk[] {
  const a = original.length ? original.split("\n") : [];
  const b = current.length ? current.split("\n") : [];
  const { sa, sb } = tokenize(a, b);

  const chunks: GitChunk[] = [];
  for (const change of diff(sa, sb)) {
    const del = a.slice(change.fromA, change.toA);
    const add = b.slice(change.fromB, change.toB);

    if (del.length === 0) {
      chunks.push({ kind: "add", fromLine: change.fromB + 1, toLine: change.toB, original: [] });
      continue;
    }
    if (add.length === 0) {
      chunks.push({ kind: "del", fromLine: change.fromB, toLine: change.fromB, original: del });
      continue;
    }
    const paired = Math.min(del.length, add.length);
    chunks.push({
      kind: "mod",
      fromLine: change.fromB + 1,
      toLine: change.fromB + paired,
      // 旧行比新行多时,多出来的旧行(= 这块里被删掉的)也挂在修改块上,撤回一并还原。
      original: del,
    });
    if (add.length > paired) {
      chunks.push({ kind: "add", fromLine: change.fromB + paired + 1, toLine: change.toB, original: [] });
    }
  }
  return chunks;
}

/** 把原始/修改后全文切成「未改动 / 改动」段，供 IDEA 式双栏渲染与滚动同步。 */
export function diffSegments(original: string, modified: string): DiffSegment[] {
  const a = original.length ? original.split("\n") : [];
  const b = modified.length ? modified.split("\n") : [];
  const { sa, sb } = tokenize(a, b);

  const segs: DiffSegment[] = [];
  let ai = 0;
  let bi = 0;
  for (const ch of diff(sa, sb)) {
    if (ch.fromA > ai) {
      segs.push({
        kind: "ctx",
        left: a.slice(ai, ch.fromA),
        right: b.slice(bi, ch.fromB),
        leftStart: ai + 1,
        rightStart: bi + 1,
      });
    }
    segs.push({
      kind: "chg",
      left: a.slice(ch.fromA, ch.toA),
      right: b.slice(ch.fromB, ch.toB),
      leftStart: ch.fromA + 1,
      rightStart: ch.fromB + 1,
    });
    ai = ch.toA;
    bi = ch.toB;
  }
  if (ai < a.length || bi < b.length) {
    segs.push({ kind: "ctx", left: a.slice(ai), right: b.slice(bi), leftStart: ai + 1, rightStart: bi + 1 });
  }
  return segs;
}

/**
 * 从「原始 / 修改后」全文生成并排对照行，供简易 DiffView 渲染。
 * 复用 @codemirror/merge 的 Myers diff：先把每一行映射成唯一单字符，
 * 这样 diff() 返回的偏移就是行号，直接得到行级增/删/改。
 * 不折叠未改动行：简易视图保持「全文 + 改动高亮」，确认对比用足够。
 */
export function diffRowsFromVersions(original: string, modified: string): DiffRow[] {
  const a = original.length ? original.split("\n") : [];
  const b = modified.length ? modified.split("\n") : [];
  const { sa, sb } = tokenize(a, b);

  const rows: DiffRow[] = [];
  let ai = 0;
  let bi = 0;
  const pushContext = (count: number) => {
    for (let i = 0; i < count; i += 1) {
      rows.push({ kind: "context", left: a[ai], right: b[bi], leftNo: ai + 1, rightNo: bi + 1 });
      ai += 1;
      bi += 1;
    }
  };

  for (const change of diff(sa, sb)) {
    pushContext(change.fromA - ai);
    const del = a.slice(change.fromA, change.toA);
    const add = b.slice(change.fromB, change.toB);
    const paired = Math.min(del.length, add.length);
    for (let i = 0; i < paired; i += 1) {
      rows.push({
        kind: "change",
        left: del[i],
        right: add[i],
        leftNo: change.fromA + i + 1,
        rightNo: change.fromB + i + 1,
      });
    }
    for (let i = paired; i < del.length; i += 1) {
      rows.push({ kind: "del", left: del[i], leftNo: change.fromA + i + 1 });
    }
    for (let i = paired; i < add.length; i += 1) {
      rows.push({ kind: "add", right: add[i], rightNo: change.fromB + i + 1 });
    }
    ai = change.toA;
    bi = change.toB;
  }
  pushContext(a.length - ai);
  return rows;
}

/**
 * 行内词级对比：靠公共前缀 + 公共后缀切出「真正变了的中段」。
 * 纯文本、零依赖，不做语法解析——pre/post 两侧相同，aMid 是旧、bMid 是新。
 */
export function inlineParts(a: string, b: string): { aMid: string; bMid: string; post: string; pre: string } {
  const max = Math.min(a.length, b.length);
  let p = 0;
  while (p < max && a[p] === b[p]) p += 1;
  let s = 0;
  while (s < max - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s += 1;
  return {
    pre: a.slice(0, p),
    aMid: a.slice(p, a.length - s),
    bMid: b.slice(p, b.length - s),
    post: a.slice(a.length - s),
  };
}
