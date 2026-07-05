import "@/styles.css";
import "@/styles.windows.css";

import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "@/app";
import { buildRestoredDocuments, listDrafts } from "@/features/workbench/drafts";
import { markPerf } from "@/features/workbench/perf-marks";
import { applyPlatformClass } from "@/features/workbench/platform";
import { useWorkbenchStore } from "@/features/workbench/store/workbench-store";

markPerf("js-eval"); // 入口 JS 开始执行（首屏关键包已下载并进入解析/执行）

document.documentElement.classList.remove("dark");
document.documentElement.dataset.theme = "light";
document.documentElement.style.colorScheme = "light";
applyPlatformClass();

// 屏蔽 WebView 自带的右键菜单(dev 下是「重新加载 / 检查元素」调试菜单),全局生效。
// 用「冒泡」阶段:让 React(挂在 #root 的冒泡监听)先收到事件,再 preventDefault。
// WKWebView 下在 capture 阶段 preventDefault 会掐断后续冒泡,导致 React 收不到右键。
// 开发期不屏蔽:保留「检查元素」入口,方便调 DevTools。
if (!import.meta.env.DEV) {
  document.addEventListener("contextmenu", (event) => event.preventDefault());
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element #root was not found.");
}

// 首帧渲染前先把上次未保存的草稿种进 store,让编辑器一出生就带着草稿内容(不再异步载入 → 不闪)。
// list_drafts 抢在其它启动 IPC 之前发,通常很快;超时兜底,别为它把启动卡住。
const seedRestoredDrafts = async () => {
  try {
    const drafts = await Promise.race([
      listDrafts(),
      new Promise<never[]>((resolve) => window.setTimeout(() => resolve([]), 2000)),
    ]);
    if (drafts.length > 0) {
      const restored = buildRestoredDocuments(drafts);
      useWorkbenchStore.setState({ openDocuments: restored, document: restored[0] });
    }
  } catch {
    // 恢复失败不阻塞启动。
  }
};

void seedRestoredDrafts().finally(() => {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
  markPerf("react-render-called"); // 已发起首次渲染（同步部分结束，后续是 React 提交 + 各组件挂载）
});
