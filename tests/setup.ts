import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom 没有布局引擎:CodeMirror 的异步 measure 会调用 Range 的几何测量 API(textRange().getClientRects),
// jsdom 未实现 → 在测量回调里抛出未处理异常。测试只验证逻辑、不依赖真实几何,这里补成空矩形即可。
// 仅在带 DOM 的环境(jsdom)生效;纯 node 环境 Range 不存在,跳过。
if (typeof Range !== "undefined") {
  const emptyRect: DOMRect = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    toJSON: () => ({}),
  };
  Range.prototype.getClientRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => emptyRect;
}

if (typeof ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    disconnect() {}
    observe() {}
    unobserve() {}
  };
}

afterEach(() => {
  cleanup();
});
