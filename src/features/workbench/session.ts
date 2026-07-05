import type { WorkbenchDocument } from "./types";

// 会话恢复:记录上次退出时打开的文件夹、所有 tab(顺序)、当前活动 tab,以及每个 tab 的编辑器视图状态
// (光标/选区、滚动位置、查找框是否展开)。下次启动照原样恢复。
//
// 存储分工(见「两层存储」约定):
// - 未保存草稿的「内容」仍走 drafts.ts(appConfigDir/drafts/*.json),本模块只记草稿 tab 的 id 与顺序。
// - 已存盘文件的「内容」不进快照,恢复时按 path 重新读盘(磁盘为准:被删则跳过,被改用最新)。
// - 会话快照本身是机器本地状态 → localStorage `norn.session`(不参与设置导出/同步)。

const SESSION_LS_KEY = "norn.session";

export interface TabViewState {
  anchor: number;
  head: number;
  scrollTop: number;
  scrollLeft: number;
  searchOpen: boolean;
}

export interface SessionTab {
  id: string;
  // 有 path = 已存盘文件(重新读盘);无 path = 未命名草稿(内容从 drafts 按 id 取)。
  path?: string;
  name?: string;
  view?: TabViewState;
}

export interface SessionSnapshot {
  tabs: SessionTab[];
  activeId: string | null;
  folderPath: string | null;
}

// ── 每个 tab 的视图状态:内存表(切 tab 时保存/恢复),退出时序列化进快照 ──────────────
const viewStates = new Map<string, TabViewState>();

export const getTabViewState = (id: string): TabViewState | undefined => viewStates.get(id);
export const setTabViewState = (id: string, state: TabViewState): void => {
  viewStates.set(id, state);
};

// 活动 tab 的视图状态只在切走时才写进上表;持久化前需主动把「当前活动 tab」也刷进去。
// 由 editor-surface 注册一个抓取函数,use-document-session 在写快照前调用。
let flushActive: (() => void) | null = null;
export const registerActiveViewCapture = (fn: (() => void) | null): void => {
  flushActive = fn;
};
export const flushActiveViewState = (): void => {
  flushActive?.();
};

// ── 快照判定:哪些 tab 值得恢复 ──────────────────────────────────────────────────
// 可恢复 = 可编辑模式(diff / 大文件只读视图不恢复)且不是「新建的空文件」。
// 草稿(未命名但有内容)会被保留;初始空白 tab 被排除。
export const isRestorableDoc = (doc: WorkbenchDocument): boolean => {
  if ((doc.mode ?? "editable") !== "editable") return false;
  const isBlankUntitled = Boolean(doc.isUntitled) && doc.content === "" && doc.savedContent === "";
  return !isBlankUntitled;
};

export const buildSessionSnapshot = (input: {
  openDocuments: WorkbenchDocument[];
  activeId: string | null;
  folderPath: string | null;
}): SessionSnapshot => {
  const tabs: SessionTab[] = input.openDocuments.filter(isRestorableDoc).map((doc) => ({
    id: doc.id,
    path: !doc.isUntitled && doc.path ? doc.path : undefined,
    name: doc.name,
    view: viewStates.get(doc.id),
  }));
  return { tabs, activeId: input.activeId, folderPath: input.folderPath };
};

export const saveSession = (snapshot: SessionSnapshot): void => {
  try {
    window.localStorage.setItem(SESSION_LS_KEY, JSON.stringify(snapshot));
  } catch {
    // localStorage 不可用时忽略,会话恢复是尽力而为。
  }
};

// 读取上次会话快照。宽松校验:结构不对/损坏一律当作「无会话」。纯函数便于测试(传入 raw)。
export const parseSession = (raw: string | null): SessionSnapshot | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SessionSnapshot>;
    if (!parsed || !Array.isArray(parsed.tabs)) return null;
    const tabs = parsed.tabs.filter(
      (tab): tab is SessionTab => Boolean(tab) && typeof (tab as SessionTab).id === "string",
    );
    return {
      tabs,
      activeId: typeof parsed.activeId === "string" ? parsed.activeId : null,
      folderPath: typeof parsed.folderPath === "string" ? parsed.folderPath : null,
    };
  } catch {
    return null;
  }
};

export const loadSession = (): SessionSnapshot | null => {
  try {
    return parseSession(window.localStorage.getItem(SESSION_LS_KEY));
  } catch {
    return null;
  }
};
