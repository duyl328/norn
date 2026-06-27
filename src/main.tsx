import "@/styles.css";
import "@/styles.windows.css";

import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "@/app";
import { applyPlatformClass } from "@/features/workbench/platform";

document.documentElement.classList.remove("dark");
document.documentElement.dataset.theme = "light";
document.documentElement.style.colorScheme = "light";
applyPlatformClass();

// 屏蔽 WebView 自带的右键菜单(dev 下是「重新加载 / 检查元素」调试菜单),全局生效。
// 用「冒泡」阶段:让 React(挂在 #root 的冒泡监听)先收到事件,再 preventDefault。
// WKWebView 下在 capture 阶段 preventDefault 会掐断后续冒泡,导致 React 收不到右键。
document.addEventListener("contextmenu", (event) => event.preventDefault());

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element #root was not found.");
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
