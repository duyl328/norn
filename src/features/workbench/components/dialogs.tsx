import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  message,
  onCancel,
  onOverwrite,
  onReload,
  onSaveAs,
  open,
}: {
  message?: string;
  onCancel: () => void;
  onOverwrite: () => void;
  onReload: () => void;
  onSaveAs: () => void;
  open: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? onCancel() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>File changed on disk</DialogTitle>
          <DialogDescription>
            {message ?? "This file was changed outside Norn. Choose how to handle your unsaved edits."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="ghost" onClick={onSaveAs}>
            Save As
          </Button>
          <Button variant="ghost" onClick={onReload}>
            Reload
          </Button>
          <Button variant="destructive" onClick={onOverwrite}>
            Overwrite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
