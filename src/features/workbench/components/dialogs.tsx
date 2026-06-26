import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type DiffLine = {
  index: number;
  left: string;
  right: string;
  type: "same" | "changed" | "added" | "removed";
};

const buildAlignedDiff = (leftContent: string, rightContent: string): DiffLine[] => {
  const leftLines = leftContent.split(/\r\n|\n|\r/);
  const rightLines = rightContent.split(/\r\n|\n|\r/);
  const maxCells = 80_000;

  if (leftLines.length * rightLines.length > maxCells) {
    const count = Math.max(leftLines.length, rightLines.length);

    return Array.from({ length: count }, (_, index) => {
      const hasLeft = index < leftLines.length;
      const hasRight = index < rightLines.length;
      const left = hasLeft ? leftLines[index] : "";
      const right = hasRight ? rightLines[index] : "";

      return {
        index,
        left,
        right,
        type: !hasLeft ? "added" : !hasRight ? "removed" : left === right ? "same" : "changed",
      };
    });
  }

  const lengths = Array.from({ length: leftLines.length + 1 }, () => new Array<number>(rightLines.length + 1).fill(0));

  for (let leftIndex = leftLines.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = rightLines.length - 1; rightIndex >= 0; rightIndex -= 1) {
      lengths[leftIndex][rightIndex] =
        leftLines[leftIndex] === rightLines[rightIndex]
          ? lengths[leftIndex + 1][rightIndex + 1] + 1
          : Math.max(lengths[leftIndex + 1][rightIndex], lengths[leftIndex][rightIndex + 1]);
    }
  }

  const rows: DiffLine[] = [];
  let leftIndex = 0;
  let rightIndex = 0;

  while (leftIndex < leftLines.length || rightIndex < rightLines.length) {
    if (leftIndex < leftLines.length && rightIndex < rightLines.length && leftLines[leftIndex] === rightLines[rightIndex]) {
      rows.push({ index: rows.length, left: leftLines[leftIndex], right: rightLines[rightIndex], type: "same" });
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }

    if (rightIndex < rightLines.length && (leftIndex >= leftLines.length || lengths[leftIndex][rightIndex + 1] >= lengths[leftIndex + 1][rightIndex])) {
      rows.push({ index: rows.length, left: "", right: rightLines[rightIndex], type: "added" });
      rightIndex += 1;
      continue;
    }

    rows.push({ index: rows.length, left: leftLines[leftIndex], right: "", type: "removed" });
    leftIndex += 1;
  }

  return rows;
};

export function UnsavedChangesDialog({
  onCancel,
  onDiscard,
  onSave,
  onSaveAs,
  open,
}: {
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  open: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? onCancel() : undefined)}>
      <DialogContent className="unsaved-close-dialog">
        <DialogHeader className="unsaved-close-dialog-header">
          <DialogTitle className="unsaved-close-dialog-title">Unsaved changes</DialogTitle>
          <DialogDescription className="unsaved-close-dialog-description">
            This tab has local edits that are not saved yet. Save them, keep a copy, or discard them before closing the
            tab.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="unsaved-close-dialog-actions">
          <Button className="unsaved-close-dialog-action" variant="ghost" onClick={onSave}>
            Save and Close
          </Button>
          <Button className="unsaved-close-dialog-action" variant="ghost" onClick={onSaveAs}>
            Save As...
          </Button>
          <Button
            className="unsaved-close-dialog-action unsaved-close-dialog-action-danger"
            variant="ghost"
            onClick={onDiscard}
          >
            Discard
          </Button>
          <Button className="unsaved-close-dialog-action" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SaveConflictDialog({
  diskContent,
  diskMissing = false,
  editorContent,
  message,
  onCancel,
  onOverwrite,
  onReload,
  onSaveAs,
  open,
}: {
  diskContent?: string;
  diskMissing?: boolean;
  editorContent: string;
  message?: string;
  onCancel: () => void;
  onOverwrite: () => void;
  onReload: () => void;
  onSaveAs: () => void;
  open: boolean;
}) {
  const [compareOpen, setCompareOpen] = useState(false);
  const canCompare = typeof diskContent === "string";
  const diffLines = useMemo(
    () => (canCompare ? buildAlignedDiff(diskContent, editorContent).slice(0, 400) : []),
    [canCompare, diskContent, editorContent],
  );

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? onCancel() : undefined)}>
      <DialogContent className={compareOpen && canCompare ? "save-conflict-dialog save-conflict-dialog-wide" : "save-conflict-dialog"}>
        <DialogHeader>
          <DialogTitle>{diskMissing ? "File deleted on disk" : "File changed on disk"}</DialogTitle>
          <DialogDescription>
            {message ?? "This file was changed outside Norn. Choose how to handle your unsaved edits."}
          </DialogDescription>
        </DialogHeader>

        {compareOpen && canCompare ? (
          <div className="save-conflict-diff" aria-label="File system and editor content comparison">
            <div className="save-conflict-diff-head">
              <span>Disk</span>
              <span>Editor</span>
            </div>
            <div className="save-conflict-diff-body">
              {diffLines.map((line) => (
                <div className={`save-conflict-diff-row save-conflict-diff-row-${line.type}`} key={line.index}>
                  <pre>{line.left || " "}</pre>
                  <pre>{line.right || " "}</pre>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          {canCompare ? (
            <Button variant="ghost" onClick={() => setCompareOpen((value) => !value)}>
              {compareOpen ? "Hide Compare" : "Compare"}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onSaveAs}>
            Save As
          </Button>
          {!diskMissing ? (
            <Button variant="ghost" onClick={onReload}>
              Use Disk
            </Button>
          ) : null}
          <Button variant="destructive" onClick={onOverwrite}>
            {diskMissing ? "Save Editor As" : "Use Editor"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
