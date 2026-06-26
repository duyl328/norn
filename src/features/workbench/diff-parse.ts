/** 把 `git diff` 的统一 diff 文本解析成并排（左旧右新）对照的行。 */

export type DiffRow =
  | { kind: "hunk"; text: string }
  | { kind: "context"; left: string; right: string; leftNo: number; rightNo: number }
  | { kind: "del"; left: string; leftNo: number }
  | { kind: "add"; right: string; rightNo: number }
  | { kind: "change"; left: string; right: string; leftNo: number; rightNo: number };

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

export function parseDiffToRows(diff: string): DiffRow[] {
  const rows: DiffRow[] = [];
  if (!diff) {
    return rows;
  }

  let leftNo = 0;
  let rightNo = 0;
  let inHunk = false;
  let delBuf: string[] = [];
  let addBuf: string[] = [];

  // 把累积的删除/新增配对：能配上的算「修改」，多出来的各自单边。
  const flush = () => {
    const paired = Math.min(delBuf.length, addBuf.length);
    for (let i = 0; i < paired; i += 1) {
      rows.push({ kind: "change", left: delBuf[i], right: addBuf[i], leftNo, rightNo });
      leftNo += 1;
      rightNo += 1;
    }
    for (let i = paired; i < delBuf.length; i += 1) {
      rows.push({ kind: "del", left: delBuf[i], leftNo });
      leftNo += 1;
    }
    for (let i = paired; i < addBuf.length; i += 1) {
      rows.push({ kind: "add", right: addBuf[i], rightNo });
      rightNo += 1;
    }
    delBuf = [];
    addBuf = [];
  };

  for (const line of diff.split("\n")) {
    const hunk = HUNK_RE.exec(line);
    if (hunk) {
      flush();
      leftNo = Number(hunk[1]);
      rightNo = Number(hunk[2]);
      inHunk = true;
      rows.push({ kind: "hunk", text: line });
      continue;
    }

    if (!inHunk) {
      continue; // 跳过 diff --git / index / --- / +++ 等文件头
    }

    if (line.startsWith("\\")) {
      continue; // "\ No newline at end of file"
    }

    const marker = line[0] ?? " ";
    const text = line.slice(1);
    if (marker === "-") {
      delBuf.push(text);
    } else if (marker === "+") {
      addBuf.push(text);
    } else {
      flush();
      rows.push({ kind: "context", left: text, right: text, leftNo, rightNo });
      leftNo += 1;
      rightNo += 1;
    }
  }

  flush();
  return rows;
}
