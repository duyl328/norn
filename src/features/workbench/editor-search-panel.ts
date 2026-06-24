import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import { EditorView, type Panel } from "@codemirror/view";

/**
 * 自绘的查找/替换面板。
 *
 * 替换掉 CodeMirror 自带面板(文字 checkbox + 一排按钮,偏重、与工作区风格不搭),
 * 做成夹在 tab 栏与编辑内容之间、靠左的紧凑条(参考 IDEA):
 * - 大小写 / 全词 / 正则 三个开关为 lucide 图标按钮(与全局图标体系一致);
 * - 输入框随内容自适应加宽,到上限后固定;带清空(×)按钮;
 * - 输入即滚动并选中最近的匹配;
 * - 颜色全部走现有 HSL 主题变量,深浅色自动适配。
 *
 * 仅负责 UI 与交互;实际匹配/替换仍由 @codemirror/search 的命令驱动。
 */

type IconNode = [tag: "path" | "circle" | "rect", attrs: Record<string, string>];

// 输入框自适应宽度的边界(px),与 styles.css 的 min/max-w 对应。
const INPUT_MIN_WIDTH = 256;
const INPUT_MAX_WIDTH = 512;
const INPUT_LEFT_PADDING = 10;
// 右侧装饰区(清空× + 两个独立开关 + 通配/正则模式组)预留宽度,需与 styles.css 的 padding-right 一致。
const SEARCH_RIGHT_RESERVE = 144;
// 匹配计数的文档大小上限:超过则暂停计数,避免每次输入都全量扫描拖慢输入。
const MATCH_COUNT_DOC_LIMIT = 500_000;

/**
 * 把 Everything 式通配符翻译为正则:`*` → 任意多个字符,`?` → 单个字符,
 * 其余正则元字符一律转义。这样用户用 `*.mp4`、`c?t` 这种简单写法即可匹配,
 * 无需了解正则语法。
 */
const wildcardToRegExp = (pattern: string): string => {
  let out = "";
  for (const char of pattern) {
    if (char === "*") {
      out += ".*";
    } else if (char === "?") {
      out += ".";
    } else if (/[.+^${}()|[\]\\]/.test(char)) {
      out += `\\${char}`;
    } else {
      out += char;
    }
  }
  return out;
};

// 图标路径取自已安装的 lucide-react(版本对齐),保证与界面其余图标一致。
const ICONS = {
  caseSensitive: [
    ["path", { d: "m3 15 4-8 4 8" }],
    ["path", { d: "M4 13h6" }],
    ["circle", { cx: "18", cy: "12", r: "3" }],
    ["path", { d: "M21 9v6" }],
  ],
  wholeWord: [
    ["circle", { cx: "7", cy: "12", r: "3" }],
    ["path", { d: "M10 9v6" }],
    ["circle", { cx: "17", cy: "12", r: "3" }],
    ["path", { d: "M14 7v8" }],
    ["path", { d: "M22 17v1c0 .5-.5 1-1 1H3c-.5 0-1-.5-1-1v-1" }],
  ],
  regex: [
    ["path", { d: "M17 3v10" }],
    ["path", { d: "m12.67 5.5 8.66 5" }],
    ["path", { d: "m12.67 10.5 8.66-5" }],
  ],
  wildcard: [
    ["path", { d: "M12 6v12" }],
    ["path", { d: "M17.196 9 6.804 15" }],
    ["path", { d: "m6.804 9 10.392 6" }],
  ],
  arrowUp: [
    ["path", { d: "m5 12 7-7 7 7" }],
    ["path", { d: "M12 19V5" }],
  ],
  arrowDown: [
    ["path", { d: "M12 5v14" }],
    ["path", { d: "m19 12-7 7-7-7" }],
  ],
  replace: [
    ["path", { d: "M14 4a2 2 0 0 1 2-2" }],
    ["path", { d: "M16 10a2 2 0 0 1-2-2" }],
    ["path", { d: "M20 2a2 2 0 0 1 2 2" }],
    ["path", { d: "M22 8a2 2 0 0 1-2 2" }],
    ["path", { d: "m3 7 3 3 3-3" }],
    ["path", { d: "M6 10V5a3 3 0 0 1 3-3h1" }],
    ["rect", { x: "2", y: "14", width: "8", height: "8", rx: "2" }],
  ],
  replaceAll: [
    ["path", { d: "M14 14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2" }],
    ["path", { d: "M14 4a2 2 0 0 1 2-2" }],
    ["path", { d: "M16 10a2 2 0 0 1-2-2" }],
    ["path", { d: "M20 14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2" }],
    ["path", { d: "M20 2a2 2 0 0 1 2 2" }],
    ["path", { d: "M22 8a2 2 0 0 1-2 2" }],
    ["path", { d: "m3 7 3 3 3-3" }],
    ["path", { d: "M6 10V5a3 3 0 0 1 3-3h1" }],
    ["rect", { x: "2", y: "14", width: "8", height: "8", rx: "2" }],
  ],
  close: [
    ["path", { d: "M18 6 6 18" }],
    ["path", { d: "m6 6 12 12" }],
  ],
  chevronRight: [["path", { d: "m9 18 6-6-6-6" }]],
} satisfies Record<string, IconNode[]>;

const SVG_NS = "http://www.w3.org/2000/svg";

const createIcon = (nodes: IconNode[]): SVGElement => {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("cm-norn-search-icon");

  for (const [tag, attrs] of nodes) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) {
      node.setAttribute(key, value);
    }
    svg.append(node);
  }

  return svg;
};

const createButton = (className: string, icon: IconNode[], label: string, onClick: () => void): HTMLButtonElement => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  // 不用原生 title(悬停延迟约 1.5s 且不可控);用 aria-label 保留可达性,
  // 视觉提示由下方的自定义快速 tooltip 提供。
  button.setAttribute("aria-label", label);
  button.append(createIcon(icon));
  button.addEventListener("click", (event) => {
    event.preventDefault();
    onClick();
  });
  return button;
};

export const createEditorSearchPanel = (view: EditorView): Panel => {
  const initial = getSearchQuery(view.state);

  const flags = {
    caseSensitive: initial.caseSensitive,
    wholeWord: initial.wholeWord,
    wildcard: false,
    regexp: initial.regexp,
  };

  // 标记"由本面板自己提交查询"的期间:此时同步触发的 update() 不应回采查询标志,
  // 否则通配模式(底层 regexp:true)会被误判为正则模式。
  let selfDispatch = false;

  // 只读文档(如 >25MB 的 large-readonly:仅分块加载部分内容)不提供替换 ——
  // 否则程序化替换会改动只加载了片段的文件,造成数据损坏。查找仍可用。
  const readOnly = view.state.readOnly || !view.state.facet(EditorView.editable);

  const dom = document.createElement("div");
  dom.className = "cm-norn-search";
  dom.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSearchPanel(view);
      view.focus();
    }
  });

  // 离屏测量元素:用于按输入内容计算输入框宽度。
  const sizer = document.createElement("span");
  sizer.className = "cm-norn-search-sizer";
  sizer.setAttribute("aria-hidden", "true");

  const createInput = (placeholder: string): HTMLInputElement => {
    const input = document.createElement("input");
    input.className = "cm-norn-search-input";
    input.type = "text";
    input.placeholder = placeholder;
    input.setAttribute("aria-label", placeholder);
    return input;
  };

  const searchInput = createInput("查找");
  searchInput.value = initial.search;

  const replaceInput = createInput("替换为");
  replaceInput.value = initial.replace;

  // 按查找内容自适应宽度:留白由常量给出,clamp 到 [min, max];替换框跟随查找框等宽以对齐。
  const autoSize = () => {
    sizer.textContent = searchInput.value || searchInput.placeholder;
    const measured = sizer.getBoundingClientRect().width;
    const width = Math.max(
      INPUT_MIN_WIDTH,
      Math.min(INPUT_MAX_WIDTH, Math.ceil(measured) + INPUT_LEFT_PADDING + SEARCH_RIGHT_RESERVE),
    );
    searchInput.style.width = `${width}px`;
    replaceInput.style.width = `${width}px`;
  };

  // 输入时滚动并选中离当前位置最近的匹配(找不到则回绕到开头)。
  const revealMatch = () => {
    const query = getSearchQuery(view.state);
    if (!query.valid) {
      return;
    }
    const cursor = query.getCursor(view.state, view.state.selection.main.from);
    let match = cursor.next();
    if (match.done) {
      match = query.getCursor(view.state, 0).next();
    }
    if (match.done || match.value.from === match.value.to) {
      return;
    }
    view.dispatch({
      selection: { anchor: match.value.from, head: match.value.to },
      effects: EditorView.scrollIntoView(match.value.from, { y: "center" }),
      userEvent: "select.search",
    });
  };

  // —— 匹配计数(当前/总数) ——
  const countEl = document.createElement("div");
  countEl.className = "cm-norn-search-count";
  countEl.hidden = true;

  const refreshCount = () => {
    const query = getSearchQuery(view.state);
    if (!query.valid) {
      countEl.hidden = true;
      countEl.textContent = "";
      countEl.classList.remove("cm-norn-search-count-empty");
      return;
    }

    countEl.hidden = false;

    if (view.state.doc.length > MATCH_COUNT_DOC_LIMIT) {
      countEl.textContent = "…";
      countEl.title = "文件较大,已暂停匹配计数";
      countEl.classList.remove("cm-norn-search-count-empty");
      return;
    }

    countEl.removeAttribute("title");
    const selection = view.state.selection.main;
    let total = 0;
    let current = 0;
    const cursor = query.getCursor(view.state);
    for (let next = cursor.next(); !next.done; next = cursor.next()) {
      total += 1;
      if (next.value.from === selection.from && next.value.to === selection.to) {
        current = total;
      }
    }

    countEl.classList.toggle("cm-norn-search-count-empty", total === 0);
    countEl.textContent = total === 0 ? "无结果" : `${current}/${total}`;
  };

  const commit = () => {
    // 通配符模式:把输入翻译成正则,以 regexp 查询执行(界面仍显示用户输入的通配写法)。
    const query = new SearchQuery({
      search: flags.wildcard ? wildcardToRegExp(searchInput.value) : searchInput.value,
      replace: replaceInput.value,
      caseSensitive: flags.caseSensitive,
      regexp: flags.wildcard || flags.regexp,
      wholeWord: flags.wholeWord,
    });

    searchInput.classList.toggle("cm-norn-search-invalid", searchInput.value.length > 0 && !query.valid);

    if (!query.eq(getSearchQuery(view.state))) {
      selfDispatch = true;
      view.dispatch({ effects: setSearchQuery.of(query) });
      selfDispatch = false;
    }
  };

  // —— 清空(×)按钮:随输入内容显隐 ——
  const createClear = (input: HTMLInputElement, onCleared: () => void): HTMLButtonElement => {
    const clear = createButton("cm-norn-search-clear", ICONS.close, "清空", () => {
      input.value = "";
      onCleared();
      input.focus();
    });
    const sync = () => {
      clear.hidden = input.value.length === 0;
    };
    input.addEventListener("input", sync);
    sync();
    return clear;
  };

  type FlagKey = keyof typeof flags;
  const toggleButtons = {} as Record<FlagKey, HTMLButtonElement>;

  const syncToggleVisual = (key: FlagKey) => {
    const button = toggleButtons[key];
    button.classList.toggle("cm-norn-search-toggle-active", flags[key]);
    button.setAttribute("aria-pressed", String(flags[key]));
  };

  const createToggle = (key: FlagKey, icon: IconNode[], label: string): HTMLButtonElement => {
    const button = createButton("cm-norn-search-toggle", icon, label, () => {
      flags[key] = !flags[key];
      // 通配符与正则互斥:开启其一则关闭另一。
      if (flags[key] && (key === "wildcard" || key === "regexp")) {
        const other: FlagKey = key === "wildcard" ? "regexp" : "wildcard";
        if (flags[other]) {
          flags[other] = false;
          syncToggleVisual(other);
        }
      }
      syncToggleVisual(key);
      commit();
      revealMatch();
      searchInput.focus();
    });
    toggleButtons[key] = button;
    syncToggleVisual(key);
    return button;
  };

  searchInput.addEventListener("input", () => {
    autoSize();
    commit();
    revealMatch();
  });
  searchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    commit();
    if (event.shiftKey) {
      findPrevious(view);
    } else {
      findNext(view);
    }
  });

  replaceInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    commit();
    replaceNext(view);
  });

  // 替换行用 max-height + margin-top 做展开缓动:收起时高度与间距都归零,
  // 保证只有查找框时卡片上下对称居中。
  let replaceOpen = false;
  const replaceRow = document.createElement("div");
  replaceRow.className = "cm-norn-search-row-replace";
  const replaceLine = document.createElement("div");
  replaceLine.className = "cm-norn-search-replace-line";
  replaceRow.append(replaceLine);

  // —— 展开/折叠替换(只读文档不提供) ——
  // 打开时把焦点交给替换框、关闭时交回查找框,既更顺手也避免无谓的重绘抖动。
  const expandButton = readOnly
    ? null
    : createButton("cm-norn-search-expand", ICONS.chevronRight, "切换替换", () => {
        setReplaceOpen(!replaceOpen);
        (replaceOpen ? replaceInput : searchInput).focus();
      });

  const setReplaceOpen = (open: boolean) => {
    if (!expandButton) {
      return;
    }
    replaceOpen = open;
    expandButton.classList.toggle("cm-norn-search-expand-open", open);
    expandButton.setAttribute("aria-expanded", String(open));
    replaceRow.classList.toggle("cm-norn-search-row-replace-open", open);
  };

  // —— 查找行 ——
  const findField = document.createElement("div");
  findField.className = "cm-norn-search-field";
  const searchAdorn = document.createElement("div");
  searchAdorn.className = "cm-norn-search-adornments";
  // 通配符与正则是互斥的"匹配模式",单独成组(带底色)以示二选一。
  const modeGroup = document.createElement("div");
  modeGroup.className = "cm-norn-search-mode";
  modeGroup.append(
    createToggle("wildcard", ICONS.wildcard, "通配符匹配 (* 任意多个字符,? 单个字符)"),
    createToggle("regexp", ICONS.regex, "正则表达式"),
  );
  searchAdorn.append(
    createClear(searchInput, () => {
      autoSize();
      commit();
    }),
    createToggle("caseSensitive", ICONS.caseSensitive, "区分大小写"),
    createToggle("wholeWord", ICONS.wholeWord, "全词匹配"),
    modeGroup,
  );
  findField.append(searchInput, searchAdorn);

  const findActions = document.createElement("div");
  findActions.className = "cm-norn-search-actions";
  findActions.append(
    createButton("cm-norn-search-btn", ICONS.arrowUp, "上一个 (Shift+Enter)", () => {
      commit();
      findPrevious(view);
    }),
    createButton("cm-norn-search-btn", ICONS.arrowDown, "下一个 (Enter)", () => {
      commit();
      findNext(view);
    }),
    createButton("cm-norn-search-btn cm-norn-search-close", ICONS.close, "关闭 (Esc)", () => {
      closeSearchPanel(view);
      view.focus();
    }),
  );

  const findRow = document.createElement("div");
  findRow.className = "cm-norn-search-row";
  findRow.append(...(expandButton ? [expandButton] : []), findField, countEl, findActions);

  // —— 替换行(只读文档不构建) ——
  if (!readOnly) {
    const replaceField = document.createElement("div");
    replaceField.className = "cm-norn-search-field";
    const replaceAdorn = document.createElement("div");
    replaceAdorn.className = "cm-norn-search-adornments cm-norn-search-adornments-replace";
    replaceAdorn.append(createClear(replaceInput, commit));
    replaceField.append(replaceInput, replaceAdorn);

    const replaceActions = document.createElement("div");
    replaceActions.className = "cm-norn-search-actions";
    replaceActions.append(
      createButton("cm-norn-search-btn", ICONS.replace, "替换 (Enter)", () => {
        commit();
        replaceNext(view);
      }),
      createButton("cm-norn-search-btn", ICONS.replaceAll, "全部替换", () => {
        commit();
        replaceAll(view);
      }),
    );
    replaceLine.append(replaceField, replaceActions);
  }

  // —— 快速自定义 tooltip(替代慢吞吞的原生 title) ——
  const tooltip = document.createElement("div");
  tooltip.className = "cm-norn-search-tooltip";
  tooltip.setAttribute("role", "tooltip");

  let tooltipTimer = 0;
  const hideTooltip = () => {
    window.clearTimeout(tooltipTimer);
    delete tooltip.dataset.show;
  };
  const showTooltip = (button: HTMLElement, label: string) => {
    const rect = button.getBoundingClientRect();
    const host = dom.getBoundingClientRect();
    tooltip.textContent = label;
    tooltip.style.left = `${rect.left - host.left + rect.width / 2}px`;
    tooltip.style.top = `${rect.bottom - host.top + 6}px`;
    tooltip.dataset.show = "true";
  };
  const attachTooltip = (button: HTMLElement, label: string) => {
    button.addEventListener("mouseenter", () => {
      window.clearTimeout(tooltipTimer);
      tooltipTimer = window.setTimeout(() => showTooltip(button, label), 200);
    });
    button.addEventListener("mouseleave", hideTooltip);
    button.addEventListener("mousedown", hideTooltip);
  };

  dom.append(sizer, findRow, ...(readOnly ? [] : [replaceRow]), tooltip);
  setReplaceOpen(false);

  for (const button of dom.querySelectorAll<HTMLButtonElement>("button[aria-label]")) {
    attachTooltip(button, button.getAttribute("aria-label") ?? "");
  }

  return {
    dom,
    top: true,
    mount() {
      autoSize();
      refreshCount();
      searchInput.focus();
      searchInput.select();
    },
    update(update) {
      const queryChanged = update.transactions.some((transaction) =>
        transaction.effects.some((effect) => effect.is(setSearchQuery)),
      );

      // 仅在"非自身提交"且面板未在驱动输入时采纳外部查询,避免覆盖自己的提交;
      // 通配符模式下界面显示的是用户写法、与底层正则不同,故此时不回填输入框。
      if (queryChanged && !selfDispatch && document.activeElement !== searchInput) {
        const query = getSearchQuery(update.state);
        if (!flags.wildcard && searchInput.value !== query.search) {
          searchInput.value = query.search;
          autoSize();
        }
        flags.caseSensitive = query.caseSensitive;
        flags.wholeWord = query.wholeWord;
        flags.regexp = query.regexp;
        if (flags.regexp) {
          flags.wildcard = false;
        }
        for (const key of Object.keys(toggleButtons) as Array<keyof typeof flags>) {
          syncToggleVisual(key);
        }
      }

      // 查询变化、导航(选区变化)或替换/编辑(文档变化)后都刷新计数。
      if (queryChanged || update.selectionSet || update.docChanged) {
        refreshCount();
      }
    },
  };
};
