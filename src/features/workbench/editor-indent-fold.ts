import { foldService } from "@codemirror/language";

/**
 * 缩进折叠:完全文本解析下没有语法树,折叠点改由缩进推断 —— 某行若后续连续若干行
 * 缩进更深,则该行可折叠,折叠范围到这段更深块的最后一行。语言无关、不挂任何解析器。
 *
 * foldService 会被 foldGutter / foldHoverHighlight / foldKeymap 共用作为折叠来源。
 */

// 超大块封顶:每个折叠起点最多向下扫这么多行,避免「块一直延伸到文件尾」时每行查询都全扫。
// ponytail: 固定上限,真有人要折几万行以上的块再说。
const MAX_FOLD_SCAN_LINES = 10000;

// 前导空白宽度(tab 按 1 个字符计,够折叠启发式用)。
const leadingWidth = (text: string) => text.length - text.trimStart().length;

export const indentFoldService = foldService.of((state, lineStart, lineEnd) => {
  const startLine = state.doc.lineAt(lineStart);

  if (!startLine.text.trim()) {
    return null; // 空行不作折叠起点
  }

  const baseIndent = leadingWidth(startLine.text);
  const scanLimit = Math.min(state.doc.lines, startLine.number + MAX_FOLD_SCAN_LINES);
  let endLineNumber = startLine.number;

  for (let lineNumber = startLine.number + 1; lineNumber <= scanLimit; lineNumber += 1) {
    const line = state.doc.line(lineNumber);

    if (!line.text.trim()) {
      continue; // 块内空行跳过:既不中断也不算块尾
    }

    if (leadingWidth(line.text) > baseIndent) {
      endLineNumber = lineNumber;
    } else {
      break;
    }
  }

  if (endLineNumber === startLine.number) {
    return null; // 后面没有更深的行 -> 不可折叠
  }

  return { from: lineEnd, to: state.doc.line(endLineNumber).to };
});
