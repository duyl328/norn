import { type ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";

export type ContextMenuItem = { label: string; icon?: ReactNode; onClick: () => void; danger?: boolean };

/** 轻量右键菜单:定位到光标,点外部/滚动/失焦即关闭。 */
export function ContextMenu({
  items,
  onClose,
  x,
  y,
}: {
  items: ContextMenuItem[];
  onClose: () => void;
  x: number;
  y: number;
}) {
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      className="git-ctx-menu"
      style={{ left: x, top: y }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          className={cnDanger(item.danger)}
          onClick={() => {
            item.onClick();
            onClose();
          }}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

const cnDanger = (danger?: boolean) => (danger ? "git-ctx-item git-ctx-item-danger" : "git-ctx-item");
