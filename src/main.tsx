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

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element #root was not found.");
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
