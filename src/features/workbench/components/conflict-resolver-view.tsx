import { Check } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { assembleResolved, type ConflictChoice, parseConflicts } from "../conflict-parse";
import { gitActions } from "../hooks/use-git";

/**
 * 冲突解决视图:把带 <<<<<<< ======= >>>>>>> 标记的文件拆成块,
 * 每个冲突块可选 采用当前 / 采用传入 / 两者都要;全部解决后写回并 git add。
 */
export function ConflictResolverView({ filePath, text }: { filePath: string; text: string }) {
  const blocks = useMemo(() => parseConflicts(text), [text]);
  // 每个块对应的冲突序号(非冲突块为 -1)。纯函数计算,避免渲染期可变累加。
  const conflictOrdinals = useMemo(
    () =>
      blocks.map((block, index) =>
        block.kind === "conflict"
          ? blocks.slice(0, index + 1).filter((other) => other.kind === "conflict").length - 1
          : -1,
      ),
    [blocks],
  );
  const conflictCount = blocks.filter((block) => block.kind === "conflict").length;
  const [choices, setChoices] = useState<ConflictChoice[]>(() => Array(conflictCount).fill("unresolved"));
  const [done, setDone] = useState(false);

  const resolvedCount = choices.filter((choice) => choice !== "unresolved").length;
  const allResolved = conflictCount > 0 && resolvedCount === conflictCount;

  const setChoice = (index: number, choice: ConflictChoice) =>
    setChoices((prev) => {
      const next = [...prev];
      next[index] = choice;
      return next;
    });

  const save = async () => {
    const ok = await gitActions.resolveConflict(filePath, assembleResolved(blocks, choices));
    if (ok) {
      setDone(true);
    }
  };

  return (
    <div className="conflict-view">
      <div className="conflict-view-head">
        <span className="conflict-view-title">
          解决冲突 · {resolvedCount}/{conflictCount}
        </span>
        <Button size="sm" variant="primary" disabled={!allResolved || done} onClick={() => void save()}>
          {done ? "已标记解决" : "标记为已解决"}
        </Button>
      </div>

      <div className="conflict-view-body">
        {blocks.map((block, blockIndex) => {
          if (block.kind === "context") {
            if (block.lines.every((line) => line.length === 0)) {
              return null;
            }
            return (
              <pre className="conflict-context" key={`ctx-${blockIndex}`}>
                {block.lines.join("\n")}
              </pre>
            );
          }

          const index = conflictOrdinals[blockIndex];
          const choice = choices[index];
          return (
            <div className="conflict-block" key={`conf-${blockIndex}`}>
              <div className="conflict-actions">
                <ChoiceButton active={choice === "ours"} onClick={() => setChoice(index, "ours")} label="采用当前" />
                <ChoiceButton active={choice === "theirs"} onClick={() => setChoice(index, "theirs")} label="采用传入" />
                <ChoiceButton active={choice === "both"} onClick={() => setChoice(index, "both")} label="两者都要" />
              </div>
              <div className="conflict-side conflict-side-ours">
                <div className="conflict-side-label">当前 (HEAD)</div>
                <pre className={cn("conflict-code", choice === "theirs" && "conflict-code-dim")}>
                  {block.ours.join("\n") || "（空）"}
                </pre>
              </div>
              <div className="conflict-side conflict-side-theirs">
                <div className="conflict-side-label">传入</div>
                <pre className={cn("conflict-code", choice === "ours" && "conflict-code-dim")}>
                  {block.theirs.join("\n") || "（空）"}
                </pre>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChoiceButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" className={cn("conflict-choice", active && "conflict-choice-active")} onClick={onClick}>
      {active ? <Check className="h-3 w-3" /> : null}
      {label}
    </button>
  );
}
