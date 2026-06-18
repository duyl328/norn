# Norn

Norn 是一个基于 Tauri 2、React、TypeScript 和 Vite 的轻量代码与 Git 工作台桌面应用。项目目标是提供一个启动更快、占用更轻的日常开发辅助工具，用于查看代码、进行少量文本编辑、检查 Git 变更并完成基础提交流程。

当前仓库处于早期原型阶段：前端已经实现工作台界面 mock，后端 Tauri 侧已搭建应用壳和示例命令；真实文件读写、真实 Git 操作和完整编辑器能力仍需继续接入。

## 核心功能

当前代码中已实现：

- Tauri 2 桌面应用壳，窗口标题为 `Norn`。
- React 工作台主界面，包含标题栏、菜单栏、工具栏、项目文件树区域、编辑器区域、Git 面板和状态栏。
- 浅色 / 深色主题切换。
- 基于 mock 数据的文件树、编辑器内容、Git 变更列表和提交面板展示。
- shadcn/ui 风格的基础 UI 组件封装，包括按钮、徽标、对话框、菜单、输入框、滚动区域、分隔线、标签页、文本框和提示。
- Tauri command `app_version`，返回 Rust crate 版本号。

需求文档中规划但当前尚未完成的能力：

- 打开本地项目目录与真实文件树。
- CodeMirror 6 真实编辑器接入、文件打开、编辑、保存、多标签页。
- 当前文件搜索、项目文件名搜索、语法高亮和代码折叠。
- 调用系统 `git` CLI 获取状态、查看 diff、stage / unstage、commit、push、pull。
- 最近项目、用户设置、快捷键配置和本地持久化。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 桌面框架 | Tauri 2 |
| 后端语言 | Rust |
| 前端框架 | React 18 + TypeScript |
| 构建工具 | Vite 6 |
| 样式 | Tailwind CSS 3 |
| UI 基础 | Radix UI、shadcn/ui 风格组件 |
| 图标 | lucide-react |
| 编辑器规划 | CodeMirror 6 |
| Git 规划 | 系统 `git` CLI |
| 包管理 | 当前仓库同时包含 `package-lock.json` 和 `pnpm-lock.yaml`，Tauri 配置中使用 `npm run dev` / `npm run build` |

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
│   ├── features/workbench/     # 工作台界面与 mock 数据
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
- `.npm-cache/`：npm 本地缓存目录。
- `dist/`：Vite 构建产物。
- `src-tauri/target/`：Rust / Tauri 构建产物。

以上目录已在 `.gitignore` 中忽略。

## 环境依赖

开发本项目需要：

- Node.js 与 npm：具体最低版本待补充。
- Rust 工具链：`src-tauri/Cargo.toml` 要求 `rust-version = "1.77"`。
- Cargo：随 Rust 工具链安装。
- Tauri 2 所需系统依赖：请按目标平台安装 Tauri 官方前置依赖。
- WebView 运行环境：Windows 下通常需要 Microsoft Edge WebView2 Runtime。
- Git CLI：真实 Git 功能规划依赖系统 `git`，当前代码尚未接入真实 Git 操作。

## 安装步骤

克隆仓库后进入项目根目录：

```bash
git clone https://gitea.duyl328.org/jimmy/norn.git
cd norn
```

安装前端依赖：

```bash
npm install
```

说明：仓库中同时存在 `package-lock.json` 和 `pnpm-lock.yaml`。当前 `tauri.conf.json` 使用的是 `npm run dev` 和 `npm run build`，因此 README 默认使用 npm。团队最终使用的包管理器待补充统一。

## 配置说明

前端开发服务器配置位于 `vite.config.ts`：

- 默认端口：`1420`
- `strictPort: true`，端口被占用时不会自动切换端口。
- 路径别名：`@` 指向 `src/`。

Tauri 应用配置位于 `src-tauri/tauri.conf.json`：

- 产品名：`Norn`
- 版本：`0.1.0`
- 应用标识：`com.norn.workbench`
- 开发地址：`http://localhost:1420`
- 开发前命令：`npm run dev`
- 构建前命令：`npm run build`
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
npm run dev
```

默认访问地址：

```text
http://localhost:1420
```

启动 Tauri 桌面开发模式：

```bash
npm run tauri dev
```

查看生产构建预览：

```bash
npm run preview
```

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm install` | 安装前端依赖 |
| `npm run dev` | 启动 Vite 开发服务器 |
| `npm run build` | 执行 TypeScript 检查并构建前端产物 |
| `npm run preview` | 预览 Vite 构建产物 |
| `npm run tauri dev` | 启动 Tauri 桌面开发模式 |
| `npm run tauri build` | 构建 Tauri 桌面应用安装包 / 可执行产物 |

当前 `package.json` 未配置 `test`、`lint`、`format` 等脚本。

## 使用示例

### Web 原型预览

```bash
npm install
npm run dev
```

浏览器打开 `http://localhost:1420` 后，可以看到 Norn 工作台原型界面，包括项目面板、编辑器 mock、Git 变更面板和状态栏。

### 桌面应用预览

```bash
npm install
npm run tauri dev
```

该命令会通过 Tauri 打开桌面窗口，并加载本地 Vite 开发服务器。

### 获取应用版本

Rust 侧已注册 `app_version` Tauri command，返回 `Cargo.toml` 中的 crate 版本号。当前前端尚未调用该命令。

## 测试方法

自动化测试：待补充。当前仓库未发现测试文件或测试框架配置，`package.json` 也未提供 `test` 脚本。

当前可执行的基础校验：

```bash
npm run build
```

该命令会先执行 `tsc`，再执行 `vite build`。

Rust / Tauri 侧可执行的基础校验：

```bash
cd src-tauri
cargo check
```

说明：`cargo check` 未封装到根目录 `package.json` 脚本中。

## 构建与部署

### 构建前端产物

```bash
npm run build
```

构建产物输出到：

```text
dist/
```

### 构建桌面应用

```bash
npm run tauri build
```

Tauri 会先执行 `npm run build`，再根据 `src-tauri/tauri.conf.json` 进行桌面应用打包。具体平台产物路径由 Tauri / Cargo 输出决定，通常位于 `src-tauri/target/` 下。

部署方式：待补充。当前仓库未发现 CI/CD、发布脚本或安装包分发说明。

## 常见问题

### 端口 1420 被占用怎么办？

`vite.config.ts` 中配置了 `strictPort: true`，端口被占用时开发服务器会启动失败。可以释放端口，或修改 `vite.config.ts` 和 `src-tauri/tauri.conf.json` 中对应的开发地址配置。

### 为什么界面中的文件树和 Git 变更不是我的真实项目？

当前工作台数据来自 `src/features/workbench/mock-data.ts`，真实文件系统和真实 Git CLI 尚未接入。

### 为什么 Git 按钮看起来可用但没有执行真实操作？

当前 Git 面板是 UI 原型，真实的 `git status`、`git diff`、`git add`、`git commit`、`git push`、`git pull` 等命令调用仍待实现。

### 为什么没有测试命令？

当前 `package.json` 未配置 `test` 脚本，仓库中也未发现测试配置。测试体系待补充。

### 为什么文档中同时出现 npm 和 pnpm 锁文件？

仓库同时包含 `package-lock.json` 和 `pnpm-lock.yaml`。由于 Tauri 配置当前调用 npm 脚本，本文档默认使用 npm。包管理器规范待补充统一。

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
