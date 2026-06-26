/** 冲突文件解析:把带 <<<<<<< ======= >>>>>>> 标记的文本拆成 普通段 / 冲突段。 */
export type ConflictBlock =
  | { kind: "context"; lines: string[] }
  | { kind: "conflict"; ours: string[]; theirs: string[] };

const START = "<<<<<<<";
const BASE = "|||||||";
const SEP = "=======";
const END = ">>>>>>>";

/** 文本是否含冲突标记。 */
export function hasConflictMarkers(text: string): boolean {
  return text.split("\n").some((line) => line.startsWith(START)) && text.split("\n").some((line) => line.startsWith(END));
}

/**
 * 解析冲突文本。支持普通(<<< === >>>)与 diff3(<<< ||| === >>>,base 段忽略)两种。
 * 解析失败/不完整的块退化为 context,不丢内容。
 */
export function parseConflicts(text: string): ConflictBlock[] {
  const lines = text.split("\n");
  const blocks: ConflictBlock[] = [];
  let context: string[] = [];

  const flushContext = () => {
    if (context.length > 0) {
      blocks.push({ kind: "context", lines: context });
      context = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.startsWith(START)) {
      context.push(line);
      i += 1;
      continue;
    }

    // 进入冲突块:收集 ours 直到 ||||||| 或 =======;若有 base 段则跳过到 =======;再收集 theirs 到 >>>>>>>。
    const ours: string[] = [];
    const theirs: string[] = [];
    let j = i + 1;
    while (j < lines.length && !lines[j].startsWith(SEP) && !lines[j].startsWith(BASE)) {
      ours.push(lines[j]);
      j += 1;
    }
    while (j < lines.length && lines[j].startsWith(BASE)) {
      j += 1;
      while (j < lines.length && !lines[j].startsWith(SEP)) {
        j += 1;
      }
    }
    if (j >= lines.length || !lines[j].startsWith(SEP)) {
      // 不完整,整段当普通文本。
      context.push(line);
      i += 1;
      continue;
    }
    j += 1; // 跳过 =======
    while (j < lines.length && !lines[j].startsWith(END)) {
      theirs.push(lines[j]);
      j += 1;
    }
    if (j >= lines.length) {
      context.push(line);
      i += 1;
      continue;
    }

    flushContext();
    blocks.push({ kind: "conflict", ours, theirs });
    i = j + 1; // 跳过 >>>>>>>
  }

  flushContext();
  return blocks;
}

export type ConflictChoice = "ours" | "theirs" | "both" | "unresolved";

/** 按每个冲突块的选择拼回最终文本。choices[k] 对应第 k 个冲突块。 */
export function assembleResolved(blocks: ConflictBlock[], choices: ConflictChoice[]): string {
  const out: string[] = [];
  let conflictIndex = 0;
  for (const block of blocks) {
    if (block.kind === "context") {
      out.push(...block.lines);
      continue;
    }
    const choice = choices[conflictIndex] ?? "unresolved";
    conflictIndex += 1;
    if (choice === "ours") {
      out.push(...block.ours);
    } else if (choice === "theirs") {
      out.push(...block.theirs);
    } else if (choice === "both") {
      out.push(...block.ours, ...block.theirs);
    } else {
      // 未解决:保留标记,确保不会静默丢冲突。
      out.push(START, ...block.ours, SEP, ...block.theirs, END);
    }
  }
  return out.join("\n");
}
