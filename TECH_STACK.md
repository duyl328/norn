# Norn 技术栈约束

## 暂定技术栈

| 层级 | 选择 |
| --- | --- |
| 桌面框架 | Tauri 2 |
| 前端框架 | React + TypeScript + Vite |
| UI 框架 | shadcn/ui 风格组件 + Tailwind CSS |
| 底层交互 | Radix UI |
| 图标 | lucide-react |
| 编辑器内核 | CodeMirror 6 |
| 后端能力 | Rust / Tauri commands |
| Git | 系统 `git` CLI |
| 本地存储 | 先 JSON，后续按需加 SQLite |

## UI 约束

- 产品 UI 优先做成紧凑工具，不做营销页或后台卡片页。
- shadcn/ui 用作组件体系，不直接照搬大留白页面风格。
- 主界面固定为：菜单栏、工具栏、左侧文件树、中间编辑器、右侧 Git 面板、底部状态栏。
- 圆角默认 2px 到 4px。
- 主字号默认 12px 到 13px。
- 工具栏和 Tab 高度约 32px，状态栏高度约 24px，文件树行高约 24px。
- 阴影尽量少，边框和灰阶层级优先。
- 禁止大面积渐变、装饰背景、大卡片堆叠、hero 式欢迎页。
