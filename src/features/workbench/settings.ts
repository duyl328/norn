import { invoke } from "@tauri-apps/api/core";

import { isTauriRuntime } from "./workbench-utils";

/**
 * 应用设置(可同步的「习惯」)的唯一 schema。
 * 存到 appConfigDir/settings.json(浏览器开发回退 localStorage)。
 * 机器本地状态(最近文件夹、搜索历史)不在此处,留在 localStorage,不参与导出。
 */
// 配置 schema 版本。老配置(会话恢复功能之前)没有此字段 → loadSettings 据此做一次性迁移。
export const CURRENT_SETTINGS_VERSION = 1;

export interface AppSettings {
  schemaVersion: number;
  language: AppLanguage;
  theme: "system" | "light" | "dark";
  editor: {
    fontSize: number;
    tabSize: number;
    lineWrapping: boolean;
    formatOnSave: boolean;
  };
  ui: {
    showStatusBar: boolean;
    resizeHandleHints: boolean;
    restoreLastWorkspace: boolean;
  };
}

export type AppLanguage = "zh" | "en";

export const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: CURRENT_SETTINGS_VERSION,
  language: "zh",
  theme: "system",
  editor: { fontSize: 13, tabSize: 2, lineWrapping: false, formatOnSave: false },
  ui: { showStatusBar: true, resizeHandleHints: false, restoreLastWorkspace: true },
};

export const FONT_SIZE_MIN = 9;
export const FONT_SIZE_MAX = 28;
export const TAB_SIZE_MIN = 1;
export const TAB_SIZE_MAX = 8;

const SETTINGS_FILE = "settings.json";
const SETTINGS_LS_KEY = "norn.settings";
const KEYBINDINGS_FILE = "keybindings.json";

const bool = (value: unknown, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback);

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
};

const language = (value: unknown): AppLanguage =>
  value === "zh" || value === "en" ? value : DEFAULT_SETTINGS.language;

/** 把任意外来对象收敛成合法 AppSettings:校验枚举、夹取数值、布尔回退默认。 */
export function mergeSettings(raw: unknown): AppSettings {
  const r = (raw ?? {}) as Partial<AppSettings> & {
    editor?: Partial<AppSettings["editor"]>;
    ui?: Partial<AppSettings["ui"]>;
  };
  const theme: AppSettings["theme"] =
    r.theme === "light" || r.theme === "dark" || r.theme === "system" ? r.theme : DEFAULT_SETTINGS.theme;
  return {
    schemaVersion: typeof r.schemaVersion === "number" ? r.schemaVersion : CURRENT_SETTINGS_VERSION,
    language: language(r.language),
    theme,
    editor: {
      fontSize: clampInt(r.editor?.fontSize, FONT_SIZE_MIN, FONT_SIZE_MAX, DEFAULT_SETTINGS.editor.fontSize),
      tabSize: clampInt(r.editor?.tabSize, TAB_SIZE_MIN, TAB_SIZE_MAX, DEFAULT_SETTINGS.editor.tabSize),
      lineWrapping: bool(r.editor?.lineWrapping, DEFAULT_SETTINGS.editor.lineWrapping),
      formatOnSave: bool(r.editor?.formatOnSave, DEFAULT_SETTINGS.editor.formatOnSave),
    },
    ui: {
      showStatusBar: bool(r.ui?.showStatusBar, DEFAULT_SETTINGS.ui.showStatusBar),
      resizeHandleHints: bool(r.ui?.resizeHandleHints, DEFAULT_SETTINGS.ui.resizeHandleHints),
      restoreLastWorkspace: bool(r.ui?.restoreLastWorkspace, DEFAULT_SETTINGS.ui.restoreLastWorkspace),
    },
  };
}

/** 键位覆盖表(actionId → 键位串数组)的宽松校验。 */
export function normalizeKeybindings(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string[]> = {};
  for (const [id, keys] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(keys) && keys.every((k) => typeof k === "string")) {
      out[id] = keys as string[];
    }
  }
  return out;
}

/** 读取已存储的设置。返回 null 表示从未存过(首次启动)→ 调用方据此从旧 localStorage 迁移。 */
export async function loadSettings(): Promise<AppSettings | null> {
  let raw: string | null = null;
  if (isTauriRuntime()) {
    try {
      raw = await invoke<string | null>("read_config_file", { name: SETTINGS_FILE });
    } catch {
      raw = null;
    }
  } else {
    raw = window.localStorage.getItem(SETTINGS_LS_KEY);
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { schemaVersion?: unknown };
    const merged = mergeSettings(parsed);
    // 一次性迁移:会话恢复功能之前的配置没有 schemaVersion,其 restoreLastWorkspace 是旧默认(关)。
    // 按新默认打开(用户要「上次的文件夹/文件自动恢复」),并写回打上版本戳;之后尊重用户的显式开关。
    if (typeof parsed?.schemaVersion !== "number") {
      merged.ui.restoreLastWorkspace = true;
      void saveSettings(merged);
    }
    return merged;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const contents = `${JSON.stringify(settings, null, 2)}\n`;
  if (isTauriRuntime()) {
    try {
      await invoke("write_config_file", { name: SETTINGS_FILE, contents });
    } catch {
      // 写盘失败忽略:下次改动会重试。
    }
    return;
  }
  try {
    window.localStorage.setItem(SETTINGS_LS_KEY, contents);
  } catch {
    // localStorage 不可用时忽略。
  }
}

// ---------------------------------------------------------------------------
// 主题应用:settings.theme 与系统偏好共同决定明暗。
// ---------------------------------------------------------------------------
export function prefersDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyTheme(theme: AppSettings["theme"]): void {
  const dark = theme === "dark" || (theme === "system" && prefersDark());
  const el = globalThis.document.documentElement;
  el.classList.toggle("dark", dark);
  el.dataset.theme = dark ? "dark" : "light";
  el.style.colorScheme = dark ? "dark" : "light";
}

// ---------------------------------------------------------------------------
// 导入 / 导出:打包 settings + keybindings,跨设备搬同一套习惯。
// ---------------------------------------------------------------------------
export interface SettingsBundle {
  app: "norn";
  version: 1;
  settings: AppSettings;
  keybindings: Record<string, string[]>;
}

export function buildBundle(settings: AppSettings, keybindings: Record<string, string[]>): string {
  const bundle: SettingsBundle = { app: "norn", version: 1, settings, keybindings };
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

/** 解析导入文件;非 Norn 配置或损坏会抛出。数值/枚举照样被 mergeSettings 收敛。 */
export function parseBundle(raw: string): { settings: AppSettings; keybindings: Record<string, string[]> } {
  const data = JSON.parse(raw) as Partial<SettingsBundle>;
  if (!data || data.app !== "norn") {
    throw new Error("这不是 Norn 的配置文件");
  }
  return {
    settings: mergeSettings(data.settings),
    keybindings: normalizeKeybindings(data.keybindings),
  };
}

/** 导出当前设置到用户选择的文件;返回写入路径,取消则 null。 */
export async function exportSettings(
  settings: AppSettings,
  keybindings: Record<string, string[]>,
): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  const target = await invoke<string | null>("open_save_dialog", { defaultName: "norn-settings.json" });
  if (!target) return null;
  await invoke("save_text_file_as", { path: target, content: buildBundle(settings, keybindings) });
  return target;
}

/** 从用户选择的文件导入;返回解析后的设置+键位,取消则 null。落盘与应用由调用方负责。 */
export async function importSettings(): Promise<{
  settings: AppSettings;
  keybindings: Record<string, string[]>;
} | null> {
  if (!isTauriRuntime()) return null;
  const source = await invoke<string | null>("open_file_dialog", {});
  if (!source) return null;
  const file = await invoke<{ content: string }>("read_text_file", { path: source });
  return parseBundle(file.content);
}

export async function resolveConfigDir(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invoke<string>("app_config_dir");
  } catch {
    return null;
  }
}

export { KEYBINDINGS_FILE, SETTINGS_FILE };
