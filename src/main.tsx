import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "@/app";
import "@/styles.css";

document.documentElement.classList.remove("dark");
document.documentElement.dataset.theme = "light";
document.documentElement.style.colorScheme = "light";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
