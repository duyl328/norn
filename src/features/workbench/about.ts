import { invoke } from "@tauri-apps/api/core";

import { translate } from "./i18n-dictionaries";
import { useWorkbenchStore } from "./store/workbench-store";

type AboutInfo = { version: string; build_time: number; os: string; arch: string };

// 「关于 Norn」:拉取后端版本/构建时间/平台,复用应用内 message 弹窗展示(body 支持换行)。
export async function showAbout(): Promise<void> {
  const store = useWorkbenchStore.getState();
  const lang = store.language;

  let info: AboutInfo | null = null;
  try {
    info = await invoke<AboutInfo>("about_info");
  } catch {
    info = null;
  }

  const version = info?.version ?? "—";
  const buildTime =
    info && info.build_time > 0
      ? new Date(info.build_time * 1000).toLocaleString()
      : translate(lang, "about.unknown");
  const platform = info ? `${info.os} · ${info.arch}` : "—";

  const body = [
    `${translate(lang, "about.version")}  ${version}`,
    `${translate(lang, "about.buildTime")}  ${buildTime}`,
    `${translate(lang, "about.platform")}  ${platform}`,
  ].join("\n");

  store.setAppNotice({ kind: "message", title: translate(lang, "action.help.about"), body });
}
