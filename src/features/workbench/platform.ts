import { isTauriRuntime } from "./workbench-utils";

export type Platform = "mac" | "windows" | "linux" | "web";

/**
 * 平台单一真相源。`web` 表示不在 Tauri 桌面运行时内(浏览器开发预览),
 * 此时不应套用任何依赖原生窗口能力(如 macOS vibrancy)的样式。
 */
export const getPlatform = (): Platform => {
  if (!isTauriRuntime()) {
    return "web";
  }

  const ua = navigator.userAgent;

  if (ua.includes("Mac")) {
    return "mac";
  }

  if (ua.includes("Windows")) {
    return "windows";
  }

  return "linux";
};

export const isMac = () => getPlatform() === "mac";
export const isWindows = () => getPlatform() === "windows";

const PLATFORM_CLASSES = ["platform-mac", "platform-windows", "platform-linux", "platform-web"];

/** 在根元素挂上 `platform-*` 类,供 CSS 按平台收敛(如仅 macOS 启用透明 vibrancy)。 */
export const applyPlatformClass = () => {
  const root = globalThis.document.documentElement;
  root.classList.remove(...PLATFORM_CLASSES);
  root.classList.add(`platform-${getPlatform()}`);
};
