# Norn

Norn 是一个基于 Tauri 2、React、TypeScript 和 Vite 的轻量代码编辑器，附带简单 Git 集成。项目目标是提供一个启动更快、占用更轻的日常开发辅助工具，用于查看和编辑代码、检查 Git 变更并完成基础提交流程。

当前仓库处于原型向真实功能过渡阶段：前端工作台界面已搭建完整，后端 Tauri 侧已实现真实的本地文件系统能力；编辑器已接入 CodeMirror 6 并支持语法高亮；Git 侧已通过系统 `git` CLI 接入轻量工作流，包括仓库探测、变更列表、diff / 并排版本对比、勾选文件提交、commit / push / pull、基础分支切换和简单冲突处理。

## 核心功能

当前代码中已实现：

- Tauri 2 桌面应用壳，窗口标题为 `Norn`，支持 macOS 透明侧栏（vibrancy）。
- React 工作台主界面，包含标题栏、菜单栏、工具栏、项目文件树区域、编辑器区域、Git 面板和状态栏。
- 浅色 / 深色主题切换。
- **真实本地文件系统能力**（Rust / Tauri command）：打开文件 / 文件夹、读取目录树、读写文本文件、另存为、大文件分块读取与降级、新建 / 重命名 / 移动 / 复制 / 删除到回收站、scratch 文件夹。
- **CodeMirror 6 编辑器**：多标签页、按文件类型语法高亮（按需加载语言包）、大文件自动降级为只读 / 纯文本。
- **简单 Git 集成**（Rust / Tauri command，调用系统 `git` CLI）：识别仓库根目录与当前分支、显示变更文件、查看 diff / 文件版本对比、勾选文件提交、提交并推送、pull / push、初始化仓库、基础分支切换 / 新建、最近提交和轻量历史图。
- **基础冲突处理**：识别冲突文件，提供按冲突块选择“采用当前 / 采用传入 / 两者都要”，写回后通过 `git add` 标记为已解决。
- **项目快速搜索**：支持项目文件名搜索和文件内容搜索。
- shadcn/ui 风格的基础 UI 组件封装，包括按钮、徽标、对话框、菜单、输入框、滚动区域、分隔线、标签页、文本框和提示。
- Tauri command `app_version`，返回 Rust crate 版本号。

当前刻意不作为目标的能力：

- 完整 IDE 能力：LSP、语义级跳转、查找引用、重构、调试器、插件系统。
- 专业 Git 客户端能力：完整暂存区管理、hunk 级 stage、stash 管理、blame、rebase、cherry-pick、tag / remote 管理、force push。
- 当前 Git 工作流定位为轻量编辑器里的简单集成：查看变更、查看 diff、勾选要提交的文件、提交 / 推送 / 拉取、基础分支操作和清晰错误提示。

## 技术栈

| 层级       | 技术                         |
| ---------- | ---------------------------- |
| 桌面框架   | Tauri 2                      |
| 后端语言   | Rust                         |
| 前端框架   | React 18 + TypeScript        |
| 构建工具   | Vite 6                       |
| 样式       | Tailwind CSS 3               |
| UI 基础    | Radix UI、shadcn/ui 风格组件 |
| 图标       | lucide-react                 |
| 编辑器     | CodeMirror 6                 |
| Git 集成   | 系统 `git` CLI               |
| 包管理     | pnpm                         |

## 目录结构

```text
norn/
├── design/
│   └── Web-Prototype/          # 设计原型交付文件
├── doc/
│   └── 轻量代码编辑器与 Git 管理工具需求文档.md
├── src/
│   ├── app.tsx                 # React 应用入口组件
│   ├── main.tsx                # React DOM 挂载入口
│   ├── styles.css              # Tailwind 与全局样式变量
│   ├── components/ui/          # 基础 UI 组件
│   ├── features/workbench/     # 工作台界面、文件能力、编辑器与 Git 面板
│   └── lib/utils.ts            # 通用工具函数
├── src-tauri/
│   ├── capabilities/           # Tauri 权限配置
│   ├── icons/                  # 应用图标资源
│   ├── src/                    # Rust 应用入口与 Tauri commands
│   ├── Cargo.toml              # Rust crate 配置
│   └── tauri.conf.json         # Tauri 应用配置
├── AGENTS.md                   # 仓库协作与提交规范
├── CONTRIBUTING.md             # 贡献说明
├── TECH_STACK.md               # 技术栈约束文档
├── components.json             # shadcn/ui 风格配置
├── package.json                # 前端依赖与脚本
├── tailwind.config.ts          # Tailwind 配置
├── tsconfig.json               # TypeScript 配置
└── vite.config.ts              # Vite 配置
```

生成目录：

- `node_modules/`：前端依赖目录。
- `dist/`：Vite 构建产物。
- `src-tauri/target/`：Rust / Tauri 构建产物。

以上目录已在 `.gitignore` 中忽略。

## 环境依赖

开发本项目需要：

- Node.js：`package.json` 要求 `>=20`。
- pnpm：仓库通过 `packageManager` 锁定版本。
- Rust 工具链：`src-tauri/Cargo.toml` 要求 `rust-version = "1.77"`。
- Cargo：随 Rust 工具链安装。
- Tauri 2 所需系统依赖：请按目标平台安装 Tauri 官方前置依赖。
- WebView 运行环境：Windows 下通常需要 Microsoft Edge WebView2 Runtime。
- Git CLI：简单 Git 集成依赖系统 `git`，复用用户已有 Git 配置、认证、hook 和 GPG 设置。

## 安装步骤

克隆仓库后进入项目根目录：

```bash
git clone https://github.com/duyl328/norn.git
cd norn
```

安装前端依赖：

```bash
pnpm install
```

## 配置说明

前端开发服务器配置位于 `vite.config.ts`：

- 默认端口：`1420`，可通过 `NORN_DEV_PORT` 或 `PORT` 覆盖。
- `strictPort: false`，端口被占用时 Vite 可自动选择后续可用端口。
- 路径别名：`@` 指向 `src/`。

Tauri 应用配置位于 `src-tauri/tauri.conf.json`：

- 产品名：`Norn`
- 版本：`0.1.0`
- 应用标识：`com.norn.workbench`
- 开发地址：`http://localhost:1420`
- 开发前命令：`pnpm dev`
- 构建前命令：`pnpm build`
- 前端构建目录：`../dist`
- 默认窗口大小：`1440x900`
- 最小窗口大小：`1024x700`

Tauri 权限配置位于 `src-tauri/capabilities/default.json`，当前启用：

- `core:default`
- `shell:default`

环境变量配置：待补充。当前仓库未发现 `.env.example` 或明确的环境变量读取逻辑。

## 启动与运行

启动 Web 开发服务器：

```bash
pnpm dev
```

默认访问地址：

```text
http://localhost:1420
```

启动 Tauri 桌面开发模式：

```bash
pnpm tauri:dev
```

查看生产构建预览：

```bash
pnpm preview
```

## 常用命令

| 命令               | 说明                                   |
| ------------------ | -------------------------------------- |
| `pnpm install`     | 安装前端依赖                           |
| `pnpm dev`         | 启动 Vite 开发服务器                   |
| `pnpm build`       | 执行 TypeScript 检查并构建前端产物     |
| `pnpm preview`     | 预览 Vite 构建产物                     |
| `pnpm tauri:dev`   | 启动 Tauri 桌面开发模式                |
| `pnpm tauri build` | 构建 Tauri 桌面应用安装包 / 可执行产物 |
| `pnpm ci:quick`    | 本地快速 CI                            |
| `pnpm ci:full`     | 本地完整 CI                            |

## 使用示例

### Web 原型预览

```bash
pnpm install
pnpm dev
```

浏览器打开 `http://localhost:1420` 后，可以看到 Norn 工作台原型界面，包括项目面板、编辑器、Git 变更面板和状态栏。浏览器版不包含真实 Tauri native 能力，文件系统与 Git 流程通过测试桩验证。

### 桌面应用预览

```bash
pnpm install
pnpm tauri:dev
```

该命令会通过 Tauri 打开桌面窗口，并加载本地 Vite 开发服务器。

### 获取应用版本

Rust 侧已注册 `app_version` Tauri command，返回 `Cargo.toml` 中的 crate 版本号。当前前端尚未调用该命令。

## 测试方法

### 静态校验

```bash
pnpm typecheck   # tsc --noEmit
pnpm lint        # ESLint 9 flat config
pnpm format:check
pnpm test        # Vitest 单测 / 组件测试
pnpm test:coverage
pnpm build       # tsc + vite build
```

### 本地 CI

当前 CI 先以 macOS 本地执行为主：

```bash
pnpm ci:quick
pnpm ci:full
```

`ci:quick` 会依次执行类型检查、lint、Vitest、覆盖率门禁和前端构建。`ci:full` 在此基础上继续执行 Rust 测试和 Playwright E2E。Windows 仍属于支持目标，但当前手头只有 Mac，Windows 路径、权限、窗口和 UI 差异后续在 Windows 机器上单独验证。

### 前端冒烟测试（Playwright）

```bash
pnpm test:e2e
```

针对 Vite 浏览器版运行无头测试（默认使用系统 Google Chrome，见 `playwright.config.ts`）。当前覆盖工作台渲染、打开文件夹、文件树 CRUD、编辑 / 保存、Tab 切换、未保存关闭确认、设置页、状态栏、大文件、文件错误，以及 macOS / Windows Tauri runtime 的标题栏 mock。

测试用 Tauri 运行时桩见 `tests/e2e/tauri-mock.ts`，通过模拟原生菜单事件驱动应用，无需真实 Tauri 窗口。

Git 前端 E2E 目前主要验证 UI 数据流和 mock Tauri 调用，不等同于真实仓库端到端验证。真实 Git CLI 行为由 Rust 单元测试覆盖部分解析和错误路径，后续应补充基于临时仓库的集成测试，覆盖 status / diff / 勾选文件提交 / push / pull / 冲突等核心路径。

### 关于真实 Tauri 窗口的 E2E

驱动真实 Tauri 窗口的官方方案是 `tauri-driver` + WebdriverIO，但**仅支持 Linux / Windows，不支持 macOS**（WKWebView 无 WebDriver 实现）。因此 macOS 上 native 能力（真实文件 / Git）目前只能通过 `pnpm tauri:dev` 手动验证，或在 Linux / Windows CI 上做自动化。

### Rust / Tauri 侧

```bash
pnpm test:rust
```

该脚本会执行 `src-tauri` 下的 `cargo test`，覆盖文本读取、range 读取、二进制 / 非 UTF-8 拒绝、文件操作保护等基础后端行为，并覆盖部分 Git status / rename / numstat / 分支领先落后解析。

## 构建与部署

### 构建前端产物

```bash
pnpm build
```

构建产物输出到：

```text
dist/
```

### 构建桌面应用

```bash
pnpm tauri build
```

Tauri 会先执行前端构建，再根据 `src-tauri/tauri.conf.json` 进行桌面应用打包。具体平台产物路径由 Tauri / Cargo 输出决定，通常位于 `src-tauri/target/` 下。

部署方式：待补充。当前已提供本地 CI 脚本；安装包分发说明仍待补充。

## 常见问题

### 端口 1420 被占用怎么办？

`vite.config.ts` 中配置了 `strictPort: false`，浏览器开发服务器可自动选择后续可用端口。Tauri 开发模式建议使用 `pnpm tauri:dev`，该脚本会为当前 worktree 分配可用端口并注入临时 Tauri devUrl。

### 为什么浏览器版的 Git 变更不是我的真实项目？

浏览器版没有 Tauri native 能力，文件系统和 Git 调用会走测试桩或空状态。请使用 `pnpm tauri:dev` 启动桌面应用，桌面模式会调用真实 Tauri command 和系统 `git` CLI。

### 为什么没有完整的 stage / unstage 面板？

Norn 的定位是轻量代码编辑器，不是专业 Git 客户端。当前 Git 工作流采用“勾选文件 → 提交选中文件”的简单模型，提交前会按选中文件执行 `git add -A -- <files>`。完整暂存区管理、hunk 级 stage、stash、blame、rebase、cherry-pick 等能力暂不作为目标。

### 为什么 Windows 还没有完整验证？

当前本地 CI 以 macOS 为执行环境，因为手头只有 Mac。Windows 仍是支持目标，后续需要在 Windows 机器上单独验证路径、权限、窗口行为和 UI 差异。

### 为什么项目统一使用 pnpm？

仓库统一使用 pnpm，锁文件以 `pnpm-lock.yaml` 为准。运行脚本请使用 `pnpm <script>`。

## 贡献指南

请先阅读 `CONTRIBUTING.md` 和 `AGENTS.md`。

提交信息必须遵循 Angular Commit Message 规范：

```text
<type>(<scope>): <subject>
```

当 `scope` 无法明确时可以省略：

```text
<type>: <subject>
```

允许的 `type`：

- `feat`
- `fix`
- `docs`
- `style`
- `refactor`
- `perf`
- `test`
- `build`
- `ci`
- `chore`
- `revert`

`subject` 使用简洁中文描述本次变更，采用祈使句或动宾结构，不超过 50 个中文字符，不以句号结尾。

提交前请检查当前工作区变更，只提交与本次任务相关的文件，避免混入无关改动、依赖目录或构建产物。

## 许可证

待补充。当前仓库未发现 `LICENSE` / `LICENCE` 文件，也未在 `package.json` 或 `Cargo.toml` 中声明许可证。
