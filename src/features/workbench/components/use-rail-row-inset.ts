import { type RefObject, useEffect } from "react";

/** L 形绕排:右上角竖排标签是固定浮层,而列表会滚动 —— 纯 CSS 没法把两者对齐。
 *  这里在滚动 / 行增删 / 切模式时,给「此刻上沿还在标签底沿之上 = 正好被标签盖住」的行
 *  打上 .git-row-under-tab,由 CSS 把它们向左缩、避开标签;其余行保持满宽。滚动也准。
 *
 *  - ref:某模式内容的根(用它就近找滚动区、标签、所在的 track);
 *  - rowSelector:该模式里会被标签盖住的行/卡片选择器。 */
export function useRailRowInset(ref: RefObject<HTMLDivElement | null>, rowSelector: string) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    // 历史模式有自己的内部滚动区(.git-graph-scroll);提交/分支用外层 radix 滚动视口。
    const scroll =
      root.querySelector<HTMLElement>(".git-graph-scroll") ??
      root.closest<HTMLElement>("[data-radix-scroll-area-viewport]");
    const rail = root.closest<HTMLElement>(".git-panel-shell")?.querySelector<HTMLElement>(".git-panel-rail");
    const track = root.closest<HTMLElement>(".git-panel-track");
    if (!scroll || !rail) return;

    let raf = 0;
    const apply = () => {
      raf = 0;
      const railBottom = rail.getBoundingClientRect().bottom;
      for (const row of root.querySelectorAll<HTMLElement>(rowSelector)) {
        // 只看纵向:缩进会改右沿,用右沿判断会来回抖动。
        row.classList.toggle("git-row-under-tab", row.getBoundingClientRect().top < railBottom);
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };

    schedule();
    scroll.addEventListener("scroll", schedule, { passive: true });
    track?.addEventListener("transitionend", schedule); // 切模式滑动结束后重算
    const ro = new ResizeObserver(schedule);
    ro.observe(scroll);
    const mo = new MutationObserver(schedule); // 展开/勾选/刷新导致行增删时重算
    mo.observe(root, { childList: true, subtree: true });

    return () => {
      scroll.removeEventListener("scroll", schedule);
      track?.removeEventListener("transitionend", schedule);
      ro.disconnect();
      mo.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [ref, rowSelector]);
}
