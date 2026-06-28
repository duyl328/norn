import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

// 检查更新:有新版则询问→下载安装→重启。
// silent=true(启动自动检查):无新版/出错时不打扰用户,仅在发现新版时提示。
// ponytail: 用 webview 原生 confirm/alert,免额外 dialog 依赖。
export async function checkForUpdates(silent = false): Promise<void> {
  try {
    const update = await check();
    if (!update) {
      if (!silent) window.alert("当前已是最新版本。");
      return;
    }
    const ok = window.confirm(
      `发现新版本 ${update.version}\n\n${update.body ?? ""}\n\n是否现在更新?`,
    );
    if (!ok) return;
    await update.downloadAndInstall();
    await relaunch();
  } catch (error) {
    if (!silent) {
      window.alert(`检查更新失败:${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
