import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

import { useWorkbenchStore } from "./store/workbench-store";
import { recordUpdateCheck, recordVersionPrompted, wasVersionPromptedToday } from "./update-schedule";

export type UpdateCheckReason = "startup" | "foreground" | "manual";

// 待安装的更新对象。check() 命中后暂存于此，由 AppNoticeDialog 的「更新并重启」回调取用。
// 动态 import 的模块单例会被缓存，故同一会话内此变量在「检查」与「安装」之间持续有效。
let pendingUpdate: Update | null = null;

// 检查更新。WKWebView 里 window.alert/confirm 是 no-op，反馈一律走应用内对话框（store.appNotice）。
// - manual（菜单）：不节流；立即显示「检查中」，结果无论最新/失败/有新版都给对话框反馈。
// - startup / foreground（自动）：由调用方先过 24h 节流；最新/失败安静处理；同版本当天弹过不再弹。
export async function checkForUpdates(reason: UpdateCheckReason = "manual"): Promise<void> {
  const manual = reason === "manual";
  const setAppNotice = useWorkbenchStore.getState().setAppNotice;

  if (manual) setAppNotice({ kind: "checking" });
  recordUpdateCheck(); // 记录本次检查时刻（含失败），自动检查据此 24h 节流

  try {
    const update = await check();

    if (!update) {
      setAppNotice(manual ? { kind: "message", title: "已是最新版本", body: "你使用的已经是最新版本。" } : null);
      return;
    }

    // 自动检查：同一版本当天已提醒过就不再弹；手动检查始终弹。
    if (!manual && wasVersionPromptedToday(update.version)) {
      return;
    }
    recordVersionPrompted(update.version); // 记录已提醒（含手动），后续自动检查当天不再重复弹

    pendingUpdate = update;
    setAppNotice({ kind: "update", version: update.version, body: update.body ?? "" });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    // 连接层失败（reqwest "error sending request"）说明没连上更新服务器——给个可操作的人话提示。
    const unreachable = /error sending request|sending request|connect|timed out|dns|tls/i.test(detail);
    const body = unreachable
      ? `无法连接到更新服务器，请检查网络连接后重试。\n\n详细信息：${detail}`
      : detail;
    setAppNotice(manual ? { kind: "message", title: "检查更新失败", body } : null);
  }
}

/** 下载并安装暂存的更新，完成后重启应用。由更新对话框「更新并重启」触发。 */
export async function installPendingUpdate(): Promise<void> {
  if (!pendingUpdate) return;
  await pendingUpdate.downloadAndInstall();
  await relaunch();
}
