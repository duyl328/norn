import { type ReactNode, useLayoutEffect, useMemo, useRef, useState, type WheelEvent } from "react";

import { cn } from "@/lib/utils";

import { useI18n } from "../i18n";
import { type DiffSegment, diffSegments, inlineParts } from "../line-diff";

const CTX_MARGIN = 3; // 折叠未改动段时上下各保留的行数
const CTX_FOLD_MIN = CTX_MARGIN * 2 + 2; // 未改动段超过此长度才折叠
const BLOCK_MAX = 48; // 改动段超过此高度先折叠

/**
 * 单容器对齐式双栏对照（左旧右新，纯文本对比，无语法解析）：
 * - 左右两栏同属一个纵向滚动容器 → 纵向滚动天然同步、零延迟，无需 JS。
 * - 不换行时横向由底部一条滚动条驱动 --hx，两栏代码一起 translateX；行号固定。
 * - 多行纯增/删用对侧等高占位（淡底+虚线+左缘竖条）；等行数修改做词级高亮。
 */
export function DiffView({ modified, name, original }: { modified: string; name?: string; original: string }) {
  const { t } = useI18n();
  const segs = useMemo(() => diffSegments(original, modified), [original, modified]);
  const stats = useMemo(() => {
    let add = 0;
    let del = 0;
    for (const s of segs) {
      if (s.kind === "chg") {
        add += s.right.length;
        del += s.left.length;
      }
    }
    return { add, del };
  }, [segs]);
  // 最长行（左右取大）字符数 → 底部滚动条范围（等宽字体下 1ch = 一列）。
  const maxLen = useMemo(() => {
    let m = 0;
    for (const s of segs) {
      for (const l of s.left) m = Math.max(m, l.length);
      for (const l of s.right) m = Math.max(m, l.length);
    }
    return m;
  }, [segs]);

  const [wrap, setWrap] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  // 切换文件（segs 变化）时清空折叠状态。渲染期重置，无副作用。
  const [prevSegs, setPrevSegs] = useState(segs);
  if (prevSegs !== segs) {
    setPrevSegs(segs);
    setExpanded(new Set());
  }

  const gridRef = useRef<HTMLDivElement>(null);
  const hbarRef = useRef<HTMLDivElement>(null);

  // 按「最长行宽 - 代码列可视宽」设置底部滚动条的可滚动量，使 --hx 与 scrollLeft 1:1。
  // 代码列只有半栏宽，所以溢出量必须按列宽算，否则超过半栏却没到全宽的行会被裁却滚不动。
  useLayoutEffect(() => {
    const grid = gridRef.current;
    const hbar = hbarRef.current;
    const spacer = hbar?.firstElementChild as HTMLElement | null;
    if (!grid || !hbar || !spacer) {
      return;
    }
    const measure = () => {
      spacer.style.width = `${maxLen}ch`; // 先量最长行的像素宽（等宽字体）
      const contentWidth = spacer.getBoundingClientRect().width;
      const cell = grid.querySelector<HTMLElement>(".diff-code");
      let box = grid.clientWidth / 2;
      if (cell) {
        const cs = getComputedStyle(cell);
        box = cell.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      }
      const overflow = Math.max(0, contentWidth - box);
      spacer.style.width = `${hbar.clientWidth + overflow}px`; // 可滚动量 = overflow
      grid.style.setProperty("--hx", `${-hbar.scrollLeft}px`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(grid);
    return () => ro.disconnect();
  }, [maxLen, wrap, segs]);

  // 底部滚动条 scrollLeft → 两栏代码一起平移（同一个 CSS 变量，两栏永远一致）。
  const onHScroll = () => {
    const grid = gridRef.current;
    const hbar = hbarRef.current;
    if (grid && hbar) {
      grid.style.setProperty("--hx", `${-hbar.scrollLeft}px`);
    }
  };
  // 触控板横向滑动落到内容区时，转交给底部滚动条（纵向仍走原生）。
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (wrap || !e.deltaX || !hbarRef.current) {
      return;
    }
    hbarRef.current.scrollLeft += e.deltaX;
  };

  if (segs.length === 0) {
    return (
      <div className="diff-view-root">
        <div className="diff-view-empty">{t("diff.noDiff")}</div>
      </div>
    );
  }

  const isNew = original.length === 0 && modified.length > 0;
  const isDeleted = modified.length === 0 && original.length > 0;
  const heading = isNew
    ? t("diff.newFile", { name: name ?? "" })
    : isDeleted
      ? t("diff.deletedFile", { name: name ?? "" })
      : (name ?? "");
  const expand = (i: number) => setExpanded((prev) => new Set(prev).add(i));

  return (
    <div className="diff-view-root">
      <div className="diff-toolbar">
        <span className="diff-banner">{heading}</span>
        <div className="flex shrink-0 items-center gap-3">
          <span className="diff-stat">
            <span className="text-emerald-600 dark:text-emerald-400">+{stats.add}</span>{" "}
            <span className="text-rose-600 dark:text-rose-400">−{stats.del}</span>
          </span>
          <button
            type="button"
            className="diff-tool-btn"
            data-active={wrap}
            onClick={() => setWrap((v) => !v)}
            title={t("diff.toggleWrap")}
          >
            {t("diff.wrap")}
          </button>
        </div>
      </div>
      <div className={cn("diff-vscroll", !wrap && "diff-nowrap")} onWheel={onWheel}>
        <div className="diff-grid" ref={gridRef}>
          <div className="diff-divider" />
          {segs.map((seg, i) => (
            <SegRows
              key={i}
              seg={seg}
              open={expanded.has(i)}
              isFirst={i === 0}
              isLast={i === segs.length - 1}
              onExpand={() => expand(i)}
              t={t}
            />
          ))}
        </div>
      </div>
      {!wrap ? (
        <div className="diff-hbar" ref={hbarRef} onScroll={onHScroll}>
          <div className="diff-hbar-spacer" />
        </div>
      ) : null}
    </div>
  );
}

function SegRows({
  isFirst,
  isLast,
  onExpand,
  open,
  seg,
  t,
}: {
  isFirst: boolean;
  isLast: boolean;
  onExpand: () => void;
  open: boolean;
  seg: DiffSegment;
  t: ReturnType<typeof useI18n>["t"];
}) {
  if (seg.kind === "ctx") {
    const n = seg.left.length;
    const ctx = (j: number) => (
      <CtxRow key={j} ln={seg.leftStart + j} rn={seg.rightStart + j} left={seg.left[j]} right={seg.right[j]} />
    );
    if (open || n <= CTX_FOLD_MIN) {
      return <>{seg.left.map((_, j) => ctx(j))}</>;
    }
    const head = isFirst ? 0 : CTX_MARGIN;
    const tail = isLast ? 0 : CTX_MARGIN;
    const rows: ReactNode[] = [];
    for (let j = 0; j < head; j += 1) rows.push(ctx(j));
    rows.push(
      <FoldRow key="fold" onClick={onExpand}>
        {t("diff.expandUnchanged", { count: n - head - tail })}
      </FoldRow>,
    );
    for (let j = n - tail; j < n; j += 1) rows.push(ctx(j));
    return <>{rows}</>;
  }

  const height = Math.max(seg.left.length, seg.right.length);
  if (!open && height > BLOCK_MAX) {
    return <FoldRow onClick={onExpand}>{t("diff.expandChanged", { count: height })}</FoldRow>;
  }
  const paired = seg.left.length === seg.right.length; // 行数相等才逐行做词级
  const rows: ReactNode[] = [];
  for (let j = 0; j < height; j += 1) {
    rows.push(<ChgRow key={j} seg={seg} j={j} paired={paired} />);
  }
  return <>{rows}</>;
}

function CtxRow({ left, ln, right, rn }: { left: string; ln: number; right: string; rn: number }) {
  return (
    <div className="diff-row">
      <span className="diff-no">{ln}</span>
      <div className="diff-code">
        <span className="diff-code-inner">{left}</span>
      </div>
      <span className="diff-no">{rn}</span>
      <div className="diff-code">
        <span className="diff-code-inner">{right}</span>
      </div>
    </div>
  );
}

function ChgRow({ j, paired, seg }: { j: number; paired: boolean; seg: DiffSegment }) {
  const hasL = j < seg.left.length;
  const hasR = j < seg.right.length;
  let leftContent: ReactNode = hasL ? seg.left[j] : null;
  let rightContent: ReactNode = hasR ? seg.right[j] : null;
  if (paired) {
    const { aMid, bMid, post, pre } = inlineParts(seg.left[j], seg.right[j]);
    leftContent = (
      <>
        {pre}
        {aMid ? <span className="diff-word-del">{aMid}</span> : null}
        {post}
      </>
    );
    rightContent = (
      <>
        {pre}
        {bMid ? <span className="diff-word-add">{bMid}</span> : null}
        {post}
      </>
    );
  }
  return (
    <div className="diff-row">
      {hasL ? <span className="diff-no diff-no-del">{seg.leftStart + j}</span> : <span className="diff-no" />}
      {hasL ? (
        <div className="diff-code diff-side-del">
          <span className="diff-code-inner">{leftContent}</span>
        </div>
      ) : (
        <div className="diff-code diff-ph-add" />
      )}
      {hasR ? <span className="diff-no diff-no-add">{seg.rightStart + j}</span> : <span className="diff-no" />}
      {hasR ? (
        <div className="diff-code diff-side-add">
          <span className="diff-code-inner">{rightContent}</span>
        </div>
      ) : (
        <div className="diff-code diff-ph-del" />
      )}
    </div>
  );
}

function FoldRow({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="diff-fold" onClick={onClick}>
      <span className="diff-fold-pill">{children}</span>
    </button>
  );
}
