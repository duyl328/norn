import type { FocusZone } from "./types";

/**
 * 把键盘焦点送进某个区域。区域容器靠 `data-focus-zone` 标记(见 workbench-page);
 * 编辑器是 CodeMirror 的 contentDOM(`.cm-content`,本身 contenteditable 可聚焦)。
 *
 * 面板可能刚被打开、DOM 尚未就绪,故放到下一帧再聚焦。
 */
export const focusZone = (zone: FocusZone) => {
  requestAnimationFrame(() => {
    if (zone === "editor") {
      document.querySelector<HTMLElement>(".cm-content")?.focus();
      return;
    }

    const container = document.querySelector<HTMLElement>(`[data-focus-zone="${zone}"]`);
    if (!container) return;

    const focusable = container.querySelector<HTMLElement>(
      "[tabindex='0'], a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled])",
    );
    (focusable ?? container).focus();
  });
};

/** 当前键盘焦点是否已在某区域内。用于 Alt+1/Alt+9 的「再按一下关闭」判定。 */
export const isZoneFocused = (zone: FocusZone): boolean => {
  const active = document.activeElement;
  if (!active) return false;
  if (zone === "editor") return Boolean(active.closest(".cm-editor"));
  return Boolean(active.closest(`[data-focus-zone="${zone}"]`));
};
