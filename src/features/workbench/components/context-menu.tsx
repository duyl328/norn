import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type ContextMenuItem = { label: string; icon?: ReactNode; onClick: () => void; danger?: boolean };

/** 轻量右键菜单:定位到光标(自动收拢到视口内),点外部/Esc/滚动/失焦即关闭。 */
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
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // 边界收拢:渲染后量一次实际尺寸,若超出右/下边缘就往回挪,避免菜单跑出屏幕。
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    const nx = Math.max(pad, Math.min(x, window.innerWidth - rect.width - pad));
    const ny = Math.max(pad, Math.min(y, window.innerHeight - rect.height - pad));
    setPos((prev) => (prev.x === nx && prev.y === ny ? prev : { x: nx, y: ny }));
  }, [x, y]);

  useEffect(() => {
    // 命中菜单之外才关 —— 左键/右键都先发 pointerdown,比单监听 click 更可靠,
    // 且点菜单项时(命中菜单内)不关,交给按钮自己的 onClick 处理。
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const close = () => onClose();
    // 延迟一个事件循环再挂:否则「打开菜单的那次右键」尾随事件会立刻把它关掉。
    const timer = window.setTimeout(() => {
      document.addEventListener("pointerdown", onPointerDown, true);
      document.addEventListener("keydown", onKey);
      window.addEventListener("blur", close);
      window.addEventListener("resize", close);
      window.addEventListener("scroll", close, true);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="git-ctx-menu"
      style={{ left: pos.x, top: pos.y }}
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
