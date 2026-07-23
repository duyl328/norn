import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type ContextMenuItem = { label: string; icon?: ReactNode; onClick: () => void; danger?: boolean };

/**
 * 轻量右键菜单:定位到光标(自动收拢到视口内),点外部/Esc/滚动/失焦即关闭。
 * closeOnScroll=false:调用方自己会引起滚动(如编辑区 tab 右键先切 tab,tab 栏随即滚动动画),
 * 否则菜单刚弹出就被这次滚动关掉。
 */
export function ContextMenu({
  closeOnScroll = true,
  items,
  onClose,
  x,
  y,
}: {
  closeOnScroll?: boolean;
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
    // WKWebView 下右键的事件序是 contextmenu → pointerdown(Chromium 相反),所以打开菜单的那次右键
    // 会尾随一个 pointerdown:按右键关菜单的话,菜单刚挂载就被自己这一下关掉。右键点别处要关菜单,由下面
    // 的 contextmenu 监听负责(那时新的一次右键会先关旧菜单)。
    const onPointerDown = (event: PointerEvent) => {
      if (event.button === 2) return;
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onContextMenuOutside = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const close = () => onClose();
    // 静默期:打开菜单的那次右键会尾随一串事件(pointerdown/mouseup/focus 变动,各 WebView 顺序还不一样,
    // WKWebView 甚至先 contextmenu 后 pointerdown)。挂监听前先躲开这一串,否则菜单刚挂载就被自己关掉。
    // 250ms 远短于人从右键到下一次点击的间隔,不影响正常关闭。
    const timer = window.setTimeout(() => {
      document.addEventListener("pointerdown", onPointerDown, true);
      document.addEventListener("contextmenu", onContextMenuOutside, true);
      document.addEventListener("keydown", onKey);
      window.addEventListener("blur", close);
      window.addEventListener("resize", close);
      if (closeOnScroll) {
        window.addEventListener("scroll", close, true);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("contextmenu", onContextMenuOutside, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [closeOnScroll, onClose]);

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
