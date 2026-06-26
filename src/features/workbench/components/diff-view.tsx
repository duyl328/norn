import { useMemo } from "react";

import { cn } from "@/lib/utils";

import { type DiffRow, parseDiffToRows } from "../diff-parse";

/** 并排（左旧右新）对照视图：解析统一 diff 文本，逐行左右两栏渲染。 */
export function DiffView({ text }: { text: string }) {
  const rows = useMemo(() => parseDiffToRows(text), [text]);

  if (rows.length === 0) {
    return <div className="diff-view-empty">无差异</div>;
  }

  return (
    <div className="diff-view">
      {rows.map((row, index) => {
        if (row.kind === "hunk") {
          return (
            <div className="diff-hunk" key={index}>
              {row.text}
            </div>
          );
        }

        const left = leftCell(row);
        const right = rightCell(row);
        return (
          <div className="diff-row" key={index}>
            <div className={cn("diff-cell", left.className)}>
              <span className="diff-no">{left.no}</span>
              <span className="diff-code">{left.code}</span>
            </div>
            <div className={cn("diff-cell", right.className)}>
              <span className="diff-no">{right.no}</span>
              <span className="diff-code">{right.code}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function leftCell(row: Exclude<DiffRow, { kind: "hunk" }>): { className: string; code: string; no: string } {
  switch (row.kind) {
    case "context":
      return { className: "", code: row.left, no: String(row.leftNo) };
    case "del":
      return { className: "diff-cell-del", code: row.left, no: String(row.leftNo) };
    case "change":
      return { className: "diff-cell-del", code: row.left, no: String(row.leftNo) };
    case "add":
      return { className: "diff-cell-empty", code: "", no: "" };
  }
}

function rightCell(row: Exclude<DiffRow, { kind: "hunk" }>): { className: string; code: string; no: string } {
  switch (row.kind) {
    case "context":
      return { className: "", code: row.right, no: String(row.rightNo) };
    case "add":
      return { className: "diff-cell-add", code: row.right, no: String(row.rightNo) };
    case "change":
      return { className: "diff-cell-add", code: row.right, no: String(row.rightNo) };
    case "del":
      return { className: "diff-cell-empty", code: "", no: "" };
  }
}
