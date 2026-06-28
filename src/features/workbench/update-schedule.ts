/**
 * 自动更新检查的频率/去重状态（机器本地，存 localStorage）。
 * 刻意不依赖任何 updater 插件——这样「是否该自动检查」的判断很便宜，节流命中时无需加载 check-updates
 * 那个（含 plugin-updater/plugin-process 的）懒 chunk。手动「检查更新」不走这里的节流。
 */
const LAST_CHECK_KEY = "norn:update:lastCheck";
const PROMPTED_KEY = "norn:update:prompted"; // JSON: { version, date(YYYY-MM-DD) }
const DAY_MS = 24 * 60 * 60 * 1000;

const readNumber = (key: string): number => {
  try {
    return Number(localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
};

const dayStr = (now: number): string => new Date(now).toISOString().slice(0, 10);

/** 距上次检查是否已满 24h（自动检查的唯一门槛：启动 / 回到前台都先过它）。从未检查过则允许。 */
export function shouldAutoCheckUpdates(now = Date.now()): boolean {
  const last = readNumber(LAST_CHECK_KEY);
  return last === 0 || now - last >= DAY_MS;
}

/** 记录「本次已检查」时刻（无论成功失败），据此对自动检查做 24h 节流。 */
export function recordUpdateCheck(now = Date.now()): void {
  try {
    localStorage.setItem(LAST_CHECK_KEY, String(now));
  } catch {
    // 隐私模式/配额满：忽略，最坏是节流失效退化为每次都查。
  }
}

/** 某版本今天是否已经弹过提示（避免用户当天拒绝后被反复打扰）。 */
export function wasVersionPromptedToday(version: string, now = Date.now()): boolean {
  try {
    const raw = localStorage.getItem(PROMPTED_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { version?: string; date?: string };
    return parsed.version === version && parsed.date === dayStr(now);
  } catch {
    return false;
  }
}

/** 记录「某版本今天已提示过」。 */
export function recordVersionPrompted(version: string, now = Date.now()): void {
  try {
    localStorage.setItem(PROMPTED_KEY, JSON.stringify({ version, date: dayStr(now) }));
  } catch {
    // 忽略写入失败。
  }
}
