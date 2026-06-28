// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  recordUpdateCheck,
  recordVersionPrompted,
  shouldAutoCheckUpdates,
  wasVersionPromptedToday,
} from "@/features/workbench/update-schedule";

const DAY = 24 * 60 * 60 * 1000;

describe("update-schedule", () => {
  beforeEach(() => localStorage.clear());

  it("无记录时允许自动检查", () => {
    expect(shouldAutoCheckUpdates(1_000_000)).toBe(true);
  });

  it("24h 内不再自动检查，满 24h 后放行", () => {
    const t0 = 1_700_000_000_000;
    recordUpdateCheck(t0);
    expect(shouldAutoCheckUpdates(t0 + DAY - 1)).toBe(false);
    expect(shouldAutoCheckUpdates(t0 + DAY)).toBe(true);
  });

  it("同版本当天已提示则去重；跨天或换版本则放行", () => {
    const day1Morning = Date.parse("2026-06-28T03:00:00Z");
    recordVersionPrompted("1.2.0", day1Morning);
    expect(wasVersionPromptedToday("1.2.0", Date.parse("2026-06-28T20:00:00Z"))).toBe(true); // 同一天
    expect(wasVersionPromptedToday("1.2.0", Date.parse("2026-06-29T01:00:00Z"))).toBe(false); // 跨天
    expect(wasVersionPromptedToday("1.3.0", day1Morning)).toBe(false); // 换了版本
  });
});
