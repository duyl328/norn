/**
 * 首次启动引导的「是否看过」标记。
 * 属于本机状态:存 localStorage,不进 settings.json,不参与导出/同步
 * (换台机器应当重新引导)。见 [[norn-settings-architecture]]。
 * 存的是引导版本号:以后引导内容更新,bump WELCOME_VERSION 即可让老用户再看一次。
 */
const WELCOME_VERSION = "1";
const STORAGE_KEY = "norn.welcomeSeen";

export function hasSeenWelcome(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === WELCOME_VERSION;
  } catch {
    return true; // localStorage 不可用时别反复弹
  }
}

export function markWelcomeSeen(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, WELCOME_VERSION);
  } catch {
    // 忽略:写不进就下次再说,不影响使用
  }
}
