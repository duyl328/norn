# Contributing

## Commit Message

本仓库所有代码提交必须遵循 Angular Commit Message 规范，提交信息使用以下格式：

```text
<type>(<scope>): <subject>
```

当无法明确 `scope` 时，可以省略为：

```text
<type>: <subject>
```

`type` 仅允许使用：

- `feat`：新增功能
- `fix`：修复缺陷
- `docs`：文档变更
- `style`：代码格式或样式调整，不影响逻辑
- `refactor`：重构，不新增功能或修复缺陷
- `perf`：性能优化
- `test`：测试相关变更
- `build`：构建系统或依赖变更
- `ci`：持续集成配置变更
- `chore`：工程杂项、维护任务
- `revert`：回滚提交

`scope` 应根据本次变更涉及的模块、目录或功能命名，例如 `ui`、`tauri`、`docs`、`workflow`。

`subject` 必须使用简洁中文描述本次变更，采用祈使句或动宾结构，不超过 50 个中文字符，并且不以句号结尾。

示例：

```text
feat(workbench): 添加工作台初始界面
docs(workflow): 固化提交信息规范
fix(tauri): 修复窗口初始化异常
```

如果一次提交包含多类内容，优先选择最核心的 `type`；必要时在提交正文中补充说明变更点。

## Pre-Commit Checklist

提交前必须检查当前工作区变更，确认只提交与本次任务相关的文件，避免混入无关改动、依赖目录或构建产物。
