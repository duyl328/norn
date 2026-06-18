# Repository Instructions

## Commit Messages

以后本仓库所有代码提交均必须遵循 Angular Commit Message 规范。

提交信息格式必须为：

```text
<type>(<scope>): <subject>
```

当 `scope` 无法明确时可以省略为 `<type>: <subject>`。

`type` 仅允许使用：`feat`、`fix`、`docs`、`style`、`refactor`、`perf`、`test`、`build`、`ci`、`chore`、`revert`。

`subject` 使用简洁中文描述本次变更，采用祈使句或动宾结构，不超过 50 个中文字符，不以句号结尾。

提交前检查当前工作区变更，只提交与本次任务相关的文件，避免混入无关改动。
