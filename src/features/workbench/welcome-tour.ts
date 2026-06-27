import "driver.js/dist/driver.css";

import { type Config, driver, type DriveStep } from "driver.js";

import { formatKey } from "./actions/registry";
import { translate } from "./i18n-dictionaries";
import type { AppLanguage } from "./settings";
import { markWelcomeSeen } from "./welcome";

/**
 * 漫游式首启引导:用 driver.js 在真实 UI 元素上打高亮 + 气泡,逐步带过最常用入口。
 * 目标元素靠 [data-tour] 选择器锚定(见 titlebar.tsx)。元素不存在的步骤会被跳过,
 * 兼容 mac/Windows 标题栏差异与「面板收起」等状态。
 */
export function startWelcomeTour(language: AppLanguage): void {
  const t = (key: Parameters<typeof translate>[1], params?: Record<string, string>) =>
    translate(language, key, params);
  const k = (spec: string) => formatKey(spec);

  const steps: DriveStep[] = [
    { popover: { title: t("welcome.intro.title"), description: t("welcome.intro.desc") } },
    {
      element: '[data-tour="search"]',
      popover: {
        title: t("welcome.search.title"),
        description: t("welcome.search.desc", { palette: k("Mod+Shift+A"), goToFile: k("Mod+P") }),
      },
    },
    {
      element: '[data-tour="panel-left"]',
      popover: {
        title: t("welcome.fileTree.title"),
        description: t("welcome.fileTree.desc", {
          key: k("Alt+1"),
          prev: k("Alt+ArrowLeft"),
          next: k("Alt+ArrowRight"),
        }),
      },
    },
    {
      element: '[data-tour="panel-right"]',
      popover: {
        title: t("welcome.git.title"),
        description: t("welcome.git.desc", { key: k("Alt+9") }),
      },
    },
    { popover: { title: t("welcome.done.title"), description: t("welcome.done.desc") } },
  ];

  // 元素步骤若目标不在 DOM(平台差异/面板收起)就丢弃,避免空高亮。
  const present = steps.filter(
    (step) => !step.element || document.querySelector(step.element as string),
  );

  const config: Config = {
    steps: present,
    popoverClass: "norn-tour", // 见 styles.css:套用应用主题 token,明暗自适应
    showProgress: present.length > 1,
    progressText: "{{current}} / {{total}}",
    nextBtnText: t("welcome.next"),
    prevBtnText: t("welcome.back"),
    doneBtnText: t("welcome.done"),
    overlayOpacity: 0.55,
    stagePadding: 6,
    stageRadius: 6,
    // 完成或关闭都算看过,下次启动不再自动弹。
    onDestroyed: () => markWelcomeSeen(),
  };

  driver(config).drive();
}
