import { diff, presentableDiff } from "@codemirror/merge";

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
 * 一处改动块（编辑器改动条用）。fromLine/toLine 是「当前文档」里的 1-based 行号：
 * add/mod 覆盖 fromLine..toLine；del 是纯删除，没有当前行，fromLine=toLine=删除位置之前的那一行（可能是 0=文首）。
 * original 是这块在 HEAD 里的原始行，撤回时写回去；origFrom/origTo 是它在 HEAD 里的 1-based 行号区间
 * （闭区间，纯新增时 origTo = origFrom - 1 = 空区间），浮层据此从基线里取上下文行。
 */
export type GitChunk = {
  fromLine: number;
  kind: "add" | "del" | "mod";
  origFrom: number;
  origTo: number;
  original: string[];
  toLine: number;
};

/**
 * 一行里的词级切片。same = 两边一样；pair = 两边都有内容的一处替换（同 pair 号 = 同一处改动，
 * 编辑区与浮层配同一种颜色，一眼看出谁对应谁）；add 只存在于新行；del 只存在于旧行
 * （在新行侧它宽度为 0，编辑区拿它的位置画删除锚点）。
 */
export type WordOp = { kind: "add" | "del" | "pair" | "same"; pair: number; text: string };

/** 旧行 vs 新行 → 两侧各自的词级切片。pairStart：本行首个配对改动的色号（块内连续递增，跨行不重置）。 */
export function wordOps(
  oldLine: string,
  newLine: string,
  pairStart = 0,
): { newOps: WordOp[]; next: number; oldOps: WordOp[] } {
  const oldOps: WordOp[] = [];
  const newOps: WordOp[] = [];
  let ai = 0;
  let bi = 0;
  let pair = pairStart;

  // presentableDiff 而非 diff：它把字符级结果按词边界归拢，"system"→"dark" 不会碎成一地单字符。
  for (const change of presentableDiff(oldLine, newLine)) {
    if (change.fromA > ai) oldOps.push({ kind: "same", pair: -1, text: oldLine.slice(ai, change.fromA) });
    if (change.fromB > bi) newOps.push({ kind: "same", pair: -1, text: newLine.slice(bi, change.fromB) });

    const a = oldLine.slice(change.fromA, change.toA);
    const b = newLine.slice(change.fromB, change.toB);
    if (a && b) {
      oldOps.push({ kind: "pair", pair, text: a });
      newOps.push({ kind: "pair", pair, text: b });
      pair += 1;
    } else if (a) {
      // 纯删除：旧行侧划掉，新行侧留一个零宽的锚点（编辑区在这个位置画小三角）。
      oldOps.push({ kind: "del", pair: -1, text: a });
      newOps.push({ kind: "del", pair: -1, text: a });
    } else if (b) {
      newOps.push({ kind: "add", pair: -1, text: b });
    }
    ai = change.toA;
    bi = change.toB;
  }
  if (ai < oldLine.length) oldOps.push({ kind: "same", pair: -1, text: oldLine.slice(ai) });
  if (bi < newLine.length) newOps.push({ kind: "same", pair: -1, text: newLine.slice(bi) });
  return { newOps, next: pair, oldOps };
}

/**
 * 整块的词级切片：旧行与新行按顺序配对（多出来的旧行整行算删除，多出来的新行整行算新增）。
 * 编辑区画高亮和浮层渲染原文都走这里，pair 号才对得上。
 */
export function chunkWordOps(original: string[], current: string[]): Array<{ newOps: WordOp[]; oldOps: WordOp[] }> {
  const rows: Array<{ newOps: WordOp[]; oldOps: WordOp[] }> = [];
  let pair = 0;
  for (let i = 0; i < Math.max(original.length, current.length); i += 1) {
    const oldLine = original[i];
    const newLine = current[i];
    if (oldLine === undefined) {
      rows.push({ newOps: [{ kind: "add", pair: -1, text: newLine }], oldOps: [] });
    } else if (newLine === undefined) {
      rows.push({ newOps: [], oldOps: [{ kind: "del", pair: -1, text: oldLine }] });
    } else {
      const ops = wordOps(oldLine, newLine, pair);
      rows.push({ newOps: ops.newOps, oldOps: ops.oldOps });
      pair = ops.next;
    }
  }
  return rows;
}

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

    // HEAD 侧的 1-based 闭区间(纯新增时是空区间:origTo = origFrom - 1)。
    const origFrom = change.fromA + 1;
    const origTo = change.toA;

    if (del.length === 0) {
      chunks.push({ kind: "add", fromLine: change.fromB + 1, toLine: change.toB, origFrom, origTo, original: [] });
      continue;
    }
    if (add.length === 0) {
      chunks.push({ kind: "del", fromLine: change.fromB, toLine: change.fromB, origFrom, origTo, original: del });
      continue;
    }
    const paired = Math.min(del.length, add.length);
    chunks.push({
      kind: "mod",
      fromLine: change.fromB + 1,
      toLine: change.fromB + paired,
      origFrom,
      origTo,
      // 旧行比新行多时,多出来的旧行(= 这块里被删掉的)也挂在修改块上,撤回一并还原。
      original: del,
    });
    if (add.length > paired) {
      chunks.push({
        kind: "add",
        fromLine: change.fromB + paired + 1,
        toLine: change.toB,
        origFrom: origTo + 1, // 尾巴新增在 HEAD 里没有对应行,区间置空
        origTo,
        original: [],
      });
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
