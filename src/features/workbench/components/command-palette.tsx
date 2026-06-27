import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { formatKey } from "../actions/registry";
import type { Action } from "../actions/types";
import { useActions } from "../actions/use-actions";
import { useI18n } from "../i18n";
import { useWorkbenchStore } from "../store/workbench-store";

/** 子序列匹配:query 的字符按序出现在 text 中即命中(轻量模糊,非打分排序)。 */
const subseqMatch = (text: string, query: string): boolean => {
  let i = 0;
  for (const char of text) {
    if (char === query[i]) i += 1;
    if (i === query.length) return true;
  }
  return query.length === 0;
};

/** Find Action 命令面板:模糊搜索并执行任意 action(IDEA 的 Mod+Shift+A)。 */
export function CommandPalette() {
  const { t } = useI18n();
  const open = useWorkbenchStore((state) => state.commandPaletteOpen);
  const setOpen = useWorkbenchStore((state) => state.setCommandPaletteOpen);
  const { actions, dispatch } = useActions();

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [open]);

  const results = useMemo<Action[]>(() => {
    const ctx = { store: useWorkbenchStore.getState() };
    const q = query.trim().toLowerCase();
    return actions
      .filter((action) => action.id !== "navigate.commandPalette")
      .filter((action) => !action.when || action.when(ctx))
      .filter((action) => subseqMatch(`${action.title} ${action.category}`.toLowerCase(), q));
  }, [actions, query, open]);

  if (!open) return null;

  const close = () => setOpen(false);
  const runAt = (index: number) => {
    const action = results[index];
    if (!action) return;
    close();
    dispatch(action.id);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      runAt(activeIndex);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[12vh]"
      role="dialog"
      aria-label={t("commandPalette.label")}
      onClick={close}
    >
      <div
        className="flex w-[min(560px,90vw)] flex-col overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          className="border-b border-border bg-transparent px-3 py-2.5 text-ui outline-none placeholder:text-muted-foreground"
          autoFocus
          placeholder={t("commandPalette.placeholder")}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
        />
        <div className="max-h-[50vh] overflow-y-auto py-1" ref={listRef}>
          {results.length === 0 ? (
            <div className="px-3 py-6 text-center text-ui text-muted-foreground">{t("commandPalette.noMatches")}</div>
          ) : (
            results.map((action, index) => (
              <button
                key={action.id}
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-ui",
                  index === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
                )}
                onMouseMove={() => setActiveIndex(index)}
                onClick={() => runAt(index)}
              >
                <span className="w-12 shrink-0 text-xs text-muted-foreground">{action.category}</span>
                <span className="flex-1 truncate">{action.title}</span>
                {action.keys?.[0] ? (
                  <kbd className="shrink-0 rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
                    {formatKey(action.keys[0])}
                  </kbd>
                ) : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
