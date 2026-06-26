import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";

import { applyTheme, loadSettings, saveSettings } from "../settings";
import { collectSettings, useWorkbenchStore } from "../store/workbench-store";
import { isTauriRuntime } from "../workbench-utils";

/**
 * 设置的生命周期接线:启动载入、改动落盘、主题与字号实时应用。
 * settings.json 是唯一持久源;store 扁平字段是活值。机器本地状态(最近文件夹等)不在此处。
 */
export function useSettingsRuntime() {
  const theme = useWorkbenchStore((state) => state.theme);
  const fontSize = useWorkbenchStore((state) => state.editorFontSize);
  const applySettings = useWorkbenchStore((state) => state.applySettings);
  const hydratedRef = useRef(false);

  // 1. 启动:载入 settings.json;首次无文件则用当前状态(已迁移旧 localStorage 偏好)落盘种子。
  useEffect(() => {
    let cancelled = false;
    void loadSettings().then((stored) => {
      if (cancelled) return;
      if (stored) {
        applySettings(stored);
      } else {
        void saveSettings(collectSettings(useWorkbenchStore.getState()));
      }
      hydratedRef.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, [applySettings]);

  // 2. 任意偏好改动 → 防抖落盘。hydrate 完成前只同步基线,绝不写盘(避免覆盖磁盘)。
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let baseline = JSON.stringify(collectSettings(useWorkbenchStore.getState()));
    const unsubscribe = useWorkbenchStore.subscribe((state) => {
      const serialized = JSON.stringify(collectSettings(state));
      if (!hydratedRef.current) {
        baseline = serialized;
        return;
      }
      if (serialized === baseline) return;
      baseline = serialized;
      clearTimeout(timer);
      timer = setTimeout(() => void saveSettings(JSON.parse(serialized)), 300);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  // 3. 主题应用:先解开原生窗口主题(system→跟随系统;light/dark→固定),
  //    这样 webview 的 prefers-color-scheme 才反映真实系统;再按需监听系统明暗切换。
  useEffect(() => {
    applyTheme(theme);
    if (isTauriRuntime()) {
      // 固定窗口主题必须放最后:它会异步触发 prefers-color-scheme 变化 → 下面的监听据此校正 CSS。
      void invoke("set_window_theme", { theme: theme === "system" ? null : theme });
    }
    if (theme !== "system" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);

  // 4. 编辑器字号 → CSS 变量(codeMirrorTheme 通过 var(--editor-font-size) 消费)。
  useEffect(() => {
    globalThis.document.documentElement.style.setProperty("--editor-font-size", `${fontSize}px`);
  }, [fontSize]);
}
