import { isMac } from "../platform";

interface ParsedKey {
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  main: string; // 小写主键,如 "s" / "escape" / "1" / "arrowup"
}

/** 把 "Mod+Shift+A" 解析为修饰键 + 主键。"Mod" 按平台展开为 Cmd(mac) / Ctrl(其它)。 */
const parseKey = (spec: string): ParsedKey => {
  const parsed: ParsedKey = { meta: false, ctrl: false, alt: false, shift: false, main: "" };

  for (const raw of spec.split("+")) {
    const part = raw.trim();
    const lower = part.toLowerCase();

    if (lower === "mod") {
      if (isMac()) parsed.meta = true;
      else parsed.ctrl = true;
    } else if (lower === "meta" || lower === "cmd" || lower === "command") {
      parsed.meta = true;
    } else if (lower === "ctrl" || lower === "control") {
      parsed.ctrl = true;
    } else if (lower === "alt" || lower === "option") {
      parsed.alt = true;
    } else if (lower === "shift") {
      parsed.shift = true;
    } else {
      parsed.main = lower;
    }
  }

  return parsed;
};

/** 事件是否命中键位。修饰键严格匹配(避免 Mod+S 误吞 Mod+Shift+S)。 */
export const matchKey = (event: KeyboardEvent, spec: string): boolean => {
  const k = parseKey(spec);

  if (event.metaKey !== k.meta) return false;
  if (event.ctrlKey !== k.ctrl) return false;
  if (event.altKey !== k.alt) return false;
  if (event.shiftKey !== k.shift) return false;

  // 数字键用 code 比较:mac 上 Alt+1 的 event.key 是 "¡" 而非 "1"。
  if (/^[0-9]$/.test(k.main)) {
    return event.code === `Digit${k.main}`;
  }

  return event.key.toLowerCase() === k.main;
};

const MODIFIER_KEYS = new Set(["control", "shift", "alt", "meta", "os"]);

/**
 * 把一次 keydown 序列化为可移植的键位串(用于「录制快捷键」)。
 * 主修饰键(mac 的 Cmd / 其它的 Ctrl)归一为 "Mod",使绑定跨平台通用。
 * 仅按下修饰键(无主键)时返回 null。
 */
export const eventToSpec = (event: KeyboardEvent): string | null => {
  const main = event.key.toLowerCase();
  if (!main || MODIFIER_KEYS.has(main)) return null;

  const parts: string[] = [];
  // 主修饰键归一为 Mod;另一个(mac 上的 Ctrl)保留为 Ctrl。
  if (isMac()) {
    if (event.metaKey) parts.push("Mod");
    if (event.ctrlKey) parts.push("Ctrl");
  } else {
    if (event.ctrlKey) parts.push("Mod");
    if (event.metaKey) parts.push("Meta");
  }
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");

  // 主键:数字用 code(规避 mac Alt+数字变符号),其余用 key。
  if (/^Digit[0-9]$/.test(event.code)) {
    parts.push(event.code.replace("Digit", ""));
  } else if (main.length === 1) {
    parts.push(main);
  } else {
    parts.push(event.key);
  }

  return parts.join("+");
};

/** 平台化的显示文案:mac 用符号(⌃⌥⇧⌘),其它用 "Ctrl+Shift+A"。 */
export const formatKey = (spec: string): string => {
  const k = parseKey(spec);
  const main = k.main.length === 1 ? k.main.toUpperCase() : capitalize(k.main);

  if (isMac()) {
    return (k.ctrl ? "⌃" : "") + (k.alt ? "⌥" : "") + (k.shift ? "⇧" : "") + (k.meta ? "⌘" : "") + macMain(main);
  }

  const parts: string[] = [];
  if (k.meta) parts.push("Win");
  if (k.ctrl) parts.push("Ctrl");
  if (k.alt) parts.push("Alt");
  if (k.shift) parts.push("Shift");
  parts.push(main);
  return parts.join("+");
};

const capitalize = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

/** 少数主键在 mac 上用符号更地道。 */
const macMain = (main: string): string => {
  const symbols: Record<string, string> = {
    Escape: "⎋",
    Enter: "↵",
    Arrowup: "↑",
    Arrowdown: "↓",
    Arrowleft: "←",
    Arrowright: "→",
  };
  return symbols[main] ?? main;
};
