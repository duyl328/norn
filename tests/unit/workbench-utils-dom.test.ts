// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { recentFoldersStorageKey, resizeHandleHintsStorageKey } from "@/features/workbench/constants";
import {
  createDocumentId,
  getTreeDropTargetFromPoint,
  isTauriRuntime,
  loadRecentFolders,
  loadResizeHandleHints,
  saveRecentFolders,
  saveResizeHandleHints,
} from "@/features/workbench/workbench-utils";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  delete (document as Partial<Document>).elementFromPoint;
});

// jsdom 不实现 elementFromPoint，这里手动桩入
const stubElementFromPoint = (element: Element | null) => {
  (document as Document).elementFromPoint = (() => element) as Document["elementFromPoint"];
};

describe("isTauriRuntime", () => {
  it("依据 __TAURI_INTERNALS__ 是否存在判断", () => {
    expect(isTauriRuntime()).toBe(false);
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    expect(isTauriRuntime()).toBe(true);
  });
});

describe("createDocumentId", () => {
  it("以 prefix 开头并带唯一后缀", () => {
    const id = createDocumentId("doc");
    expect(id.startsWith("doc-")).toBe(true);
    expect(id.length).toBeGreaterThan(4);
    expect(createDocumentId("doc")).not.toBe(id);
  });
});

describe("recentFolders 持久化", () => {
  it("save 后 load 能读回", () => {
    saveRecentFolders([{ path: "/p/a", name: "a" }]);
    expect(loadRecentFolders()).toEqual([{ path: "/p/a", name: "a" }]);
  });

  it("无数据返回空数组", () => {
    expect(loadRecentFolders()).toEqual([]);
  });

  it("非法 JSON 返回空数组", () => {
    window.localStorage.setItem(recentFoldersStorageKey, "{not json");
    expect(loadRecentFolders()).toEqual([]);
  });

  it("非数组返回空数组", () => {
    window.localStorage.setItem(recentFoldersStorageKey, JSON.stringify({ foo: 1 }));
    expect(loadRecentFolders()).toEqual([]);
  });

  it("过滤掉缺少 path/name 的项", () => {
    window.localStorage.setItem(
      recentFoldersStorageKey,
      JSON.stringify([{ path: "/p", name: "p" }, { path: "/q" }, null]),
    );
    expect(loadRecentFolders()).toEqual([{ path: "/p", name: "p" }]);
  });
});

describe("resizeHandleHints 持久化", () => {
  it("save true 后 load 为 true", () => {
    saveResizeHandleHints(true);
    expect(loadResizeHandleHints()).toBe(true);
    expect(window.localStorage.getItem(resizeHandleHintsStorageKey)).toBe("true");
  });

  it("未设置时默认 false", () => {
    expect(loadResizeHandleHints()).toBe(false);
  });
});

describe("getTreeDropTargetFromPoint", () => {
  it("无坐标返回 null", () => {
    expect(getTreeDropTargetFromPoint()).toBeNull();
  });

  it("命中带 data-tree-drop-* 的元素返回 path/scope", () => {
    const target = document.createElement("div");
    target.setAttribute("data-tree-drop-path", "/p/x");
    target.setAttribute("data-tree-drop-scope", "main");
    const inner = document.createElement("span");
    target.appendChild(inner);
    document.body.appendChild(target);

    stubElementFromPoint(inner);
    expect(getTreeDropTargetFromPoint({ x: 1, y: 1 })).toEqual({ path: "/p/x", scope: "main" });
  });

  it("命中元素无 drop 数据返回 null", () => {
    stubElementFromPoint(document.createElement("div"));
    expect(getTreeDropTargetFromPoint({ x: 1, y: 1 })).toBeNull();
  });

  it("scope 非法返回 null", () => {
    const target = document.createElement("div");
    target.setAttribute("data-tree-drop-path", "/p/x");
    target.setAttribute("data-tree-drop-scope", "bogus");
    document.body.appendChild(target);

    stubElementFromPoint(target);
    expect(getTreeDropTargetFromPoint({ x: 1, y: 1 })).toBeNull();
  });
});
