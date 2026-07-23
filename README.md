<div align="center">
  <img src="src-tauri/icons/128x128.png" width="96" height="96" alt="Norn 图标" />
  <h1>Norn</h1>
  <p>轻量、快速，内置简单 Git 工作流的桌面代码编辑器。</p>

[![CI](https://github.com/duyl328/norn/actions/workflows/ci.yml/badge.svg)](https://github.com/duyl328/norn/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/duyl328/norn)](https://github.com/duyl328/norn/releases/latest)
[![License](https://img.shields.io/github/license/duyl328/norn)](LICENSE)

</div>

Norn 基于 Tauri 2、React、TypeScript 和 CodeMirror 6 构建，面向希望快速查看、编辑代码并完成日常 Git 操作的开发者。它复用系统 Git 配置与凭据，在一个紧凑的桌面工作台中提供文件管理、代码编辑、差异查看、提交、同步和基础分支操作。

> Norn 仍处于早期开发阶段。欢迎试用、反馈问题和参与贡献，但请暂时不要把它作为关键数据的唯一编辑工具。

## 下载

前往 [GitHub Releases](https://github.com/duyl328/norn/releases/latest) 下载最新版本。

| 平台    | 架构          | 安装包             |
| ------- | ------------- | ------------------ |
| Windows | x64           | NSIS `.exe` 或 MSI |
| macOS   | Apple Silicon | `.dmg`             |

macOS 安装包尚未经过 Apple 公证，Windows 安装包也可能触发系统信誉提示。自动更新包具有独立签名校验，但这不等同于操作系统代码签名。

## 功能亮点

- **代码编辑**：多标签页、CodeMirror 6、按需语法高亮、搜索替换、CJK 友好交互和大文件降级。
- **文件工作台**：打开文件夹、目录树、拖放、新建、重命名、移动、复制、回收站和会话恢复。
- **Git 工作流**：仓库识别、变更列表、文件 diff、编辑器行级变更提示、选中文件提交、push、pull 和 fetch。
- **历史与分支**：最近提交、轻量历史图、分支查看、创建、切换及领先/落后状态。
- **冲突处理**：识别冲突块并选择当前版本、传入版本或两者保留。
- **桌面体验**：浅色/深色主题、原生文件能力、外部路径打开、检查更新、Windows 托盘常驻和跨平台安装包。

Norn 的目标是“编辑器中的轻量 Git 工作流”，而不是替代完整 IDE 或专业 Git 客户端。LSP、调试器、插件系统、交互式 rebase、hunk stage 等能力目前不在核心范围内。

## 快速开始

### 环境要求

- Node.js 20+
- pnpm（版本由 `package.json` 锁定）
- Rust stable
- Git CLI
- [Tauri 2 平台依赖](https://v2.tauri.app/start/prerequisites/)

### 本地开发

```bash
git clone https://github.com/duyl328/norn.git
cd norn
pnpm install
pnpm tauri:dev
```

只运行浏览器前端：

```bash
pnpm dev
```

浏览器模式不具备真实文件系统和 Git 原生能力，相关调用由测试桩或空状态代替。

## 常用命令

| 命令               | 用途                 |
| ------------------ | -------------------- |
| `pnpm tauri:dev`   | 启动桌面开发模式     |
| `pnpm dev`         | 启动 Vite 开发服务器 |
| `pnpm build`       | 类型检查并构建前端   |
| `pnpm test:unit`   | 运行单元与组件测试   |
| `pnpm test:e2e`    | 运行 Playwright E2E  |
| `pnpm test:rust`   | 运行 Rust 测试       |
| `pnpm ci:quick`    | 运行前端快速 CI      |
| `pnpm ci:full`     | 运行完整本地检查     |
| `pnpm tauri build` | 构建当前平台安装包   |

Rust 代码还应通过：

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

## 技术栈

| 领域     | 技术                                            |
| -------- | ----------------------------------------------- |
| 桌面框架 | Tauri 2                                         |
| 前端     | React 18、TypeScript、Vite 6                    |
| 编辑器   | CodeMirror 6                                    |
| UI       | Tailwind CSS、Radix UI、lucide-react            |
| 后端     | Rust、Tauri commands                            |
| Git      | 系统 `git` CLI                                  |
| 测试     | Vitest、Testing Library、Playwright、Cargo test |

主要代码位于：

```text
src/                         React 前端
src/features/workbench/      编辑器、文件与 Git 工作台
src-tauri/src/               Rust 后端与 Tauri commands
tests/                       单元、组件和 E2E 测试
.github/workflows/           CI 与 Release 自动化
doc/                         产品与发布文档
```

更详细的产品边界和技术约束请参阅 [doc/产品设计定位与边界.md](doc/产品设计定位与边界.md) 与 [TECH_STACK.md](TECH_STACK.md)。

## 发布与自动更新

推送与项目版本一致的 `vX.Y.Z` tag 后，GitHub Actions 会构建 macOS Apple Silicon 和 Windows x64 安装包、签名更新包并创建 GitHub Release。

客户端通过以下地址检查最新版本：

```text
https://github.com/duyl328/norn/releases/latest/download/latest.json
```

完整流程见 [发布新版本指南](doc/发布新版本指南.md)。

## 参与贡献

欢迎提交 Bug、功能建议、文档改进和代码贡献：

1. 提交前请阅读 [贡献指南](CONTRIBUTING.md)。
2. Bug 和功能建议请使用仓库的 Issue 模板。
3. 安全问题请按 [安全策略](SECURITY.md) 私下报告。
4. 参与项目即表示同意遵守 [行为准则](CODE_OF_CONDUCT.md)。

## 许可证

Norn 使用 [MIT License](LICENSE) 开源。
