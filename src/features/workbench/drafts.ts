import { invoke } from "@tauri-apps/api/core";

import type { WorkbenchDocument } from "./types";
import { createUntitledDocument, isTauriRuntime, textEncodingOptions } from "./workbench-utils";

// 未命名草稿的本地持久化:内容只在内存里的「未保存文件」,在失焦/切后台时写到
// appConfigDir/drafts/<id>.json,退出/崩溃后可在下次启动恢复。已存盘的文件不走这里。
export interface DraftPayload {
  id: string;
  name: string;
  content: string;
  encoding?: string;
  hasBom?: boolean;
}

export const writeDraft = async (draft: DraftPayload): Promise<void> => {
  if (!isTauriRuntime()) return;
  try {
    await invoke("write_draft", { id: draft.id, contents: JSON.stringify(draft) });
  } catch {
    // 草稿缓存是尽力而为,失败不打扰用户。
  }
};

export const deleteDraft = async (id: string): Promise<void> => {
  if (!isTauriRuntime()) return;
  try {
    await invoke("delete_draft", { id });
  } catch {
    // 同上。
  }
};

// 把 list_drafts 返回的原始 JSON 字符串数组解析成草稿;损坏/字段缺失的条目跳过。纯函数,便于测试。
export const parseDrafts = (raw: string[]): DraftPayload[] => {
  const drafts: DraftPayload[] = [];
  for (const item of raw) {
    try {
      const parsed = JSON.parse(item) as DraftPayload;
      if (
        parsed &&
        typeof parsed.id === "string" &&
        typeof parsed.content === "string" &&
        typeof parsed.name === "string"
      ) {
        drafts.push(parsed);
      }
    } catch {
      // 跳过损坏的草稿文件。
    }
  }
  return drafts;
};

export const listDrafts = async (): Promise<DraftPayload[]> => {
  if (!isTauriRuntime()) return [];
  try {
    return parseDrafts(await invoke<string[]>("list_drafts"));
  } catch {
    return [];
  }
};

// 把草稿变成未命名文档:savedContent 置空 → 视为未保存(关闭仍提示、失焦会重新缓存)。
// 在首帧渲染前就种进 store,编辑器一出生就带着草稿内容,避免异步载入导致「文字重新加载」的闪烁。
export const buildRestoredDocuments = (drafts: DraftPayload[]): WorkbenchDocument[] =>
  drafts.map((draft) => {
    const baseDocument = createUntitledDocument();
    const encodingOption = draft.encoding
      ? textEncodingOptions.find((option) => option.value === draft.encoding)
      : undefined;

    return {
      ...baseDocument,
      id: draft.id,
      name: draft.name || "Untitled",
      content: draft.content,
      savedContent: "",
      encoding: draft.encoding ?? baseDocument.encoding,
      encodingLabel: encodingOption?.label ?? baseDocument.encodingLabel,
      hasBom: draft.hasBom ?? baseDocument.hasBom,
    };
  });
