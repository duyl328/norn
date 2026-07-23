# 参与贡献

感谢你愿意参与 Norn。Bug 修复、功能建议、测试、文档和体验改进都很有价值。

## 开始之前

- 搜索现有 [Issues](https://github.com/duyl328/norn/issues)，避免重复提交。
- Bug 请提供可复现步骤、Norn 版本、操作系统和相关日志。
- 较大的功能或架构调整建议先创建 Issue，确认方向后再投入实现。
- 安全漏洞不要公开提交 Issue，请遵循 [SECURITY.md](SECURITY.md)。

## 开发环境

需要 Node.js 20+、pnpm、Rust stable、Git CLI，以及目标平台对应的 Tauri 2 系统依赖。

```bash
git clone https://github.com/duyl328/norn.git
cd norn
pnpm install
pnpm tauri:dev
```

浏览器模式可通过 `pnpm dev` 启动，但不包含真实文件系统和 Git 原生能力。

## 变更原则

- 每个提交和 Pull Request 聚焦一个明确问题。
- 不要提交 `node_modules/`、`dist/`、`src-tauri/target/` 或本地临时文件。
- 保持 Norn 的轻量定位，避免在没有讨论的情况下引入大型依赖或完整 IDE 级能力。
- 用户可见行为变化应补充或更新测试和文档。
- 涉及多平台逻辑时，注意 `cfg` 条件编译以及 Windows、macOS、Linux 的行为差异。

## 验证

提交前至少运行与改动相关的检查。推荐基础检查：

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

涉及 Rust 后端时运行 `pnpm test:rust`，涉及完整交互流程时运行 `pnpm test:e2e`。

## 提交信息

本仓库使用 Angular Commit Message 格式：

```text
<type>(<scope>): <subject>
```

无法明确 `scope` 时可省略。允许的 `type`：

- `feat`、`fix`、`docs`、`style`
- `refactor`、`perf`、`test`
- `build`、`ci`、`chore`、`revert`

`subject` 使用简洁中文祈使句或动宾结构，不超过 50 个中文字符，不以句号结尾。

示例：

```text
feat(editor): 添加行级差异提示
fix(windows): 隐藏后台命令窗口
docs(readme): 完善开发说明
```

## Pull Request

Pull Request 应包含：

- 变更内容与原因
- 用户或开发者影响
- 验证方式和结果
- 相关 Issue
- UI 变更截图或录屏（如适用）
- 尚未验证的平台或已知风险

维护者可能要求拆分过大的变更、补充测试或调整实现，以保持代码可维护性和产品边界清晰。
