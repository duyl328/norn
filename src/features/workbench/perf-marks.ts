/**
 * 轻量启动计时埋点。基于浏览器 Performance API（performance.mark），开销可忽略，因此默认常开。
 *
 * 结果落盘到 appConfigDir/startup-perf.log（每次启动覆盖为最近一次），因为生产版 Tauri 默认禁用
 * DevTools、控制台看不到。这个文件可直接用 norn 自己打开；路径见设置页「配置位置」，macOS 默认是
 * ~/Library/Application Support/com.norn.workbench/startup-perf.log。开发模式下同时打印到控制台。
 *
 * 时间基准统一为 performance.timeOrigin（≈ WebView 文档开始加载的时刻），各 mark 的 startTime
 * 即「距文档开始的毫秒数」；报告还附上：
 *   - 原生冷启动（进程拉起 → 前端可调用 app_startup_ms，JS 看不到的那段，由 Rust 提供，记为负值）
 *   - first-contentful-paint（首次内容绘制，来自 Performance 'paint' 条目）
 */
const PREFIX = "norn:perf:";

/** 打一个启动阶段标记。name 形如 "js-eval" / "window-shown" / "editor-created"。 */
export function markPerf(name: string): void {
  try {
    performance.mark(PREFIX + name);
  } catch {
    // performance 不可用时静默跳过。
  }
}

let reported = false;

/** 汇总所有标记 + 原生冷启动 + FCP，写入 startup-perf.log（并在 DEV 打印控制台）。仅执行一次。 */
export function reportPerf(): void {
  if (reported) return;
  reported = true;

  void (async () => {
    const core = await import("@tauri-apps/api/core").catch(() => null);

    let nativeBootMs: number | undefined;
    if (core) {
      try {
        // app_startup_ms = 进程拉起至今的毫秒；减去 performance.now()（文档开始至今）≈ 原生冷启动段。
        const uptime = await core.invoke<number>("app_startup_ms");
        nativeBootMs = Math.max(0, Math.round(uptime - performance.now()));
      } catch {
        // 非 Tauri 环境，跳过原生段。
      }
    }

    const marks = performance
      .getEntriesByType("mark")
      .filter((entry) => entry.name.startsWith(PREFIX))
      .sort((a, b) => a.startTime - b.startTime);
    const fcp = performance.getEntriesByType("paint").find((entry) => entry.name === "first-contentful-paint");

    type Row = { stage: string; at: number; delta: number | null };
    const rows: Row[] = [];
    if (nativeBootMs !== undefined) rows.push({ stage: "native-boot (进程→文档)", at: -nativeBootMs, delta: null });
    let prev = 0;
    for (const mark of marks) {
      rows.push({ stage: mark.name.slice(PREFIX.length), at: Math.round(mark.startTime), delta: Math.round(mark.startTime - prev) });
      prev = mark.startTime;
    }
    if (fcp) rows.push({ stage: "first-contentful-paint", at: Math.round(fcp.startTime), delta: null });

    // 文本表（落盘 + 人读）。新窗口接口不在此，故用 new Date 取时间戳。
    const stamp = new Date().toISOString();
    const lines = [
      `norn 启动计时  ${stamp}`,
      "stage".padEnd(28) + "距文档(ms)".padStart(12) + "距上一步(ms)".padStart(14),
      "-".repeat(54),
      ...rows.map(
        (r) => r.stage.padEnd(28) + String(r.at).padStart(12) + (r.delta == null ? "" : `+${r.delta}`).padStart(14),
      ),
      "",
    ];
    const report = lines.join("\n");

    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log(report);
    }
    // 覆盖写入：startup-perf.log 始终是最近一次启动的计时，体积自限。
    core?.invoke("write_config_file", { name: "startup-perf.log", contents: report }).catch(() => undefined);
  })();
}
