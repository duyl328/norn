import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";

import { I18nProvider } from "@/features/workbench/i18n-provider";
import { markPerf, reportPerf } from "@/features/workbench/perf-marks";
import { WorkbenchPage } from "@/features/workbench/workbench-page";

export function App() {
  useEffect(() => {
    // 窗口初始 visible:false(避免启动时的透明框),挂载后再显示。
    // 必须用 effect 而非 requestAnimationFrame —— 窗口隐藏时 document 不可见,rAF 不会触发,
    // 会永远卡在隐藏状态(空白窗口)。effect 走 React 调度器,隐藏时照常执行。
    try {
      void getCurrentWindow()
        .show()
        .catch(() => {});
    } catch {
      // 非 Tauri(浏览器开发)环境,没有原生窗口可显示。
    }
    markPerf("window-shown"); // 调用 show()：用户此刻应已看到窗口
    // 稍后汇总：给初次文件打开（文件关联冷启动是异步 IPC）留出时间，再打印计时表。
    const timer = window.setTimeout(reportPerf, 1500);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <I18nProvider>
      <WorkbenchPage />
    </I18nProvider>
  );
}
