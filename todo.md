# Norn 待办事项

## 当前进度记录123123123123

- [x] 搭建 Tauri 2 + React + TypeScript + Vite 项目壳
- [x] 完成主工作台界面骨架：标题栏、工具栏、文件树区、编辑器区、Git 面板、状态栏
- [x] 支持浅色 / 深色主题切换
- [x] 接入 CodeMirror 6 编辑器：多标签页、按需语法高亮、大文件降级
- [x] 接入真实本地项目目录与目录树（Tauri command）
- [x] 接入真实文件读写：打开 / 保存 / 另存为 / 新建 / 重命名 / 移动 / 复制 / 回收站
- [x] Git 工作区探测：识别仓库根目录与当前分支
- [x] 前端构建通过：`pnpm build`
- [x] Rust / Tauri 基础检查通过：`cargo check`
- [x] 建立编码规范（见 `CODING_STANDARDS.md`）、统一 pnpm、接入 ESLint + Prettier
- [x] 拆分工作台前导区：types / constants / codemirror-setup / workbench-utils 模块化
- [x] 拆分工作台子组件到 `components/`（titlebar / file-tree / editor-surface / git-panel 等 8 个文件）
- [x] 接入 Playwright 前端冒烟测试（含注入 Tauri mock 驱动数据流）：`pnpm test:e2e`
- [x] 接入 Mac 本地 CI：`pnpm ci:quick` / `pnpm ci:full`
- [x] 接入 Vitest 覆盖率报告与基线门禁：`pnpm test:coverage`
- [ ] 继续收敛工作台状态与大文件结构（`workbench-page.tsx` 约 900 行，`editor-surface.tsx` 仍超过 800 行）
- [x] 接入轻量 Git CLI 工作流（status / diff / 文件版本对比 / 勾选文件提交 / commit / push / pull / branch / log）
- [ ] 为轻量 Git 工作流补真实临时仓库集成测试（status / diff / 勾选文件提交 / push / pull / 冲突）
- [ ] 后续补 Windows 平台验证（当前手头仅 Mac，Windows 路径 / 权限 / UI 差异待单独处理）

## Git UI / 交互改进（进行中）

已完成（本轮重做，记录在案）：

- [x] 右侧 Git 面板改为竖向 tab 三模式（提交 / 分支 / 历史），纵向滑动切换；删除全屏浮层 `git-preview`
- [x] 分支模式：分支树（按 `/` 折叠成文件夹）+ 选中分支的关系（上游、领先/落后、独有提交）
- [x] 历史模式：面板内分支拓扑图（地铁 / IDEA 式正交圆角走线）+ 选中提交的改动；ref 徽章整理（当前分支 / 标签 / 远程 / 本地）
- [x] 提交模式：变更列表改为文件树（按目录折叠）
- [x] 双击变更文件 → `@codemirror/merge` IDEA 式并排 diff（行级 + 词级高亮、改动 gutter、折叠未改动、语法高亮）；后端新增 `git_file_versions`
- [x] 修复提交图连线缺失（`git.rs` log 格式 `%P` → `%p`，父子 hash 对齐）

已完成（续）：

- [x] ③ 文件级选择性提交
  - [x] 变更文件树加勾选框（文件 / 文件夹三态），按勾选提交
  - [x] 后端 `git_commit` 支持 pathspec（只提交选中文件）+ amend
  - [x] 两个提交按钮合并为 split 按钮：提交 / 提交并推送 / 修订(amend)
- [x] ④ 冲突合并能力（含 Rust）
  - [x] 含冲突标记的文件双击打开「冲突解决视图」（采用当前 / 采用传入 / 两者都要，逐块选择）
  - [x] 解析普通与 diff3 两种冲突标记（`conflict-parse.ts` + 单测）
  - [x] 后端 `git_resolve_conflict`：写回解决后内容并 `git add` 标记已解决

待完成：

- [ ] 冲突视图增强（可选）：接 MergeView 做并排三方 + 直接编辑；当前为逐块取舍
- [ ] 新建分支的 `window.prompt` 换成项目内 dialog 组件（`git-branches-pane.tsx`、`git-branch-menu.tsx`）
- [ ] 分支关系保持轻量展示，清理不必要的“完整 Git 客户端”文案和入口
- [ ] 清理：删除已无引用的 `.git-file-row` / `.git-file-list` CSS（`GitFileRow` 已移除）、`use-git.ts` 中已不再使用的 `loadDiff`
- [ ] 可选优化：文件树 / 分支树单链目录合并显示（`a/b/c` 折成一行，VS Code 风格）
- [ ] 在 Windows 上 `pnpm tauri dev` 重编验证：`git_file_versions` 并排 diff、提交图连线、三模式手感（WSL 侧无法编译 Tauri）

## 按顺序推进

1. [ ] 整理仓库状态
   - [ ] 决定是否将 `.idea/` 加入 `.gitignore`
   - [ ] 确认 `todo.md` 是否纳入版本控制
   - [x] 统一 npm / pnpm 锁文件策略
   - [ ] 检查当前未提交改动，只保留与任务相关的文件

2. [ ] 更新项目文档
   - [x] 更新 README 中的当前完成度说明
   - [x] 标明 CodeMirror 已接入
   - [x] 标明本地文件系统已接入、Git 为轻量集成而非完整客户端
   - [x] 补充环境依赖、包管理器和许可证说明

3. [ ] 继续拆分工作台大组件
   - [x] 从 `workbench-page.tsx` 拆出标题栏组件
   - [ ] 拆出工具栏组件
   - [x] 拆出文件树组件
   - [x] 拆出编辑器组件
   - [x] 拆出 Git 面板组件
   - [x] 拆出状态栏组件
   - [ ] 保留清晰的数据流和事件边界

4. [x] 接入 Tauri 文件系统能力
   - [x] 支持选择并打开本地项目目录
   - [x] 支持读取目录树
   - [x] 支持读取本地文件内容
   - [x] 支持写入本地文件内容
   - [x] 处理无权限、文件不存在、路径异常等错误
   - [x] 默认忽略 `.git`、`node_modules`、`target`、`dist` 等目录

5. [ ] 建立真实工作区状态
   - [ ] 保存当前工作区路径
   - [ ] 识别 Git root
   - [ ] 管理文件树展开 / 折叠状态
   - [ ] 管理当前选中文件
   - [ ] 支持刷新文件树
   - [ ] 打开非 Git 目录时禁用或提示 Git 功能

6. [ ] 完善编辑器文档模型
   - [ ] 支持多文件 Tab
   - [ ] 已打开文件再次点击时切换到已有 Tab
   - [ ] 记录每个 Tab 的文件路径、内容、保存状态和光标位置
   - [ ] 未保存文件显示修改标记
   - [ ] 关闭未保存文件时提示保存、丢弃或取消

7. [ ] 实现文件保存
   - [ ] 支持 `Ctrl+S` / `Cmd+S` 保存当前文件
   - [ ] 支持保存全部打开文件
   - [ ] 保持原文件换行符风格
   - [ ] 处理外部修改冲突
   - [ ] 处理文件不存在、无写权限、编码异常

8. [ ] 扩展 CodeMirror 语言能力
   - [ ] 按文件后缀动态加载语言包
   - [ ] 使用 `Compartment` 在编辑器创建后切换语言扩展
   - [ ] 支持 JS、JSX、TS、TSX、JSON、HTML、CSS、Markdown
   - [ ] 支持 Java、Kotlin、Go、Python、Rust
   - [ ] 支持 YAML、TOML、XML、Properties、ENV、Shell
   - [ ] 未识别文件使用 Plain Text
   - [ ] 大文件自动降级为纯文本或关闭高级能力

9. [ ] 补齐基础编辑能力
   - [ ] 支持自动闭合括号和引号
   - [ ] 支持代码折叠和折叠 gutter
   - [ ] 支持 Tab / Space、缩进宽度、自动换行等设置
   - [ ] 支持注释行、复制行、删除行、移动行等常用快捷键

10. [ ] 实现当前文件搜索与替换
    - [ ] 支持 `Ctrl+F` / `Cmd+F` 查找
    - [ ] 支持 `Ctrl+R` / `Cmd+R` 替换
    - [ ] 支持查找上一个、下一个
    - [ ] 支持大小写匹配、全词匹配、正则搜索
    - [ ] 支持全部替换

11. [ ] 建立 Action System
    - [ ] 统一注册打开项目、打开文件、保存、搜索、Git 操作等动作
    - [ ] 将快捷键绑定到 action，而不是直接写在 UI 事件中
    - [ ] 支持查看默认快捷键
    - [ ] 检测快捷键冲突

12. [x] 接入轻量 Git CLI 后端
    - [x] 通过 Rust / Tauri command 调用系统 `git`
    - [x] 使用参数数组执行命令，禁止拼接 shell 字符串
    - [x] 设置固定工作目录
    - [x] 捕获 stdout、stderr、退出码
    - [x] 处理 git 未安装、非 Git 仓库、权限不足等错误

13. [x] 解析 Git 仓库信息
    - [x] 使用 `git rev-parse --show-toplevel` 识别仓库根目录
    - [x] 使用 `git branch --show-current` 显示当前分支
    - [x] 子目录打开时仍能找到 Git root
    - [x] 非 Git 目录显示清晰提示

14. [x] 实现轻量 Git 状态列表
    - [x] 使用 `git status --porcelain=v2 --branch -z`
    - [x] 显示 modified、added、deleted、renamed、untracked、conflict
    - [x] 正确处理空格、换行和特殊字符文件名
    - [x] 文件状态变化后自动刷新
    - [ ] 不实现完整 staged / unstaged 双栏模型；当前采用勾选文件提交模型

15. [x] 实现 Diff 查看
    - [x] 支持工作区文件与 HEAD 的对比
    - [x] 支持并排版本对比
    - [x] 处理新增文件、删除文件、重命名文件的基础展示
    - [ ] 补充二进制文件和大文件 diff 的明确提示
    - [ ] 支持从 diff 跳转到编辑器对应行

16. [x] 实现文件级选择性提交
    - [x] 变更文件树支持勾选文件 / 文件夹
    - [x] 提交前按勾选文件执行 `git add -A -- <files>`
    - [x] 操作失败时展示 Git 错误信息
    - [x] 操作完成后刷新 Git 状态
    - [ ] 不实现专业 Git 客户端式完整 stage / unstage 面板

17. [x] 实现 Commit / Push / Pull
    - [x] 校验 commit message 不能为空
    - [x] 校验必须勾选至少一个文件
    - [x] 执行 `git commit -m`
    - [x] 显示 hook、GPG、用户身份配置等错误
    - [x] 支持 `git push`
    - [x] 支持 upstream 缺失时尝试 `push -u origin <branch>`
    - [x] 支持 `git pull`
    - [x] pull 冲突时显示冲突状态和冲突文件
    - [ ] 补充真实仓库集成测试覆盖 commit / push / pull 关键路径

18. [ ] 实现本地持久化
    - [ ] 保存最近打开项目
    - [ ] 保存最后工作区
    - [ ] 保存打开的 Tab 状态
    - [ ] 保存窗口布局
    - [ ] 保存主题配置
    - [ ] 保存编辑器设置
    - [ ] 优先使用本地 JSON，后续按需考虑 SQLite

19. [ ] 完善错误提示体系
    - [ ] 所有错误包含摘要
    - [ ] 展示原始错误信息
    - [ ] 给出可能原因
    - [ ] 给出可操作建议
    - [ ] Git 破坏性操作前必须二次确认

20. [ ] 补充性能策略
    - [ ] 文件树扫描忽略常见大目录
    - [ ] Git 状态刷新加防抖
    - [ ] 大文件打开前提示确认
    - [ ] 大文件关闭语法高亮、折叠、补全等高级能力
    - [ ] CodeMirror 语言包按需加载，降低首包体积

21. [ ] 补充测试和工程脚本
    - [x] 添加 `lint` 脚本
    - [x] 添加 `format` 脚本
    - [x] 添加 `test` 脚本
    - [x] 添加覆盖率脚本和基线门禁
    - [x] 添加本地 CI 脚本（Mac 当前执行环境）
    - [x] 为 Git 状态解析添加单元测试
    - [ ] 为 Git CLI 核心流程添加临时仓库集成测试
    - [x] 为 Rust command 添加基础测试
    - [x] 添加前端工作台冒烟测试
    - [ ] 在 Windows 机器上补充本地 CI 验证与平台差异测试

22. [ ] 补充发布基础
    - [ ] 添加 LICENSE
    - [x] 添加本地 CI 检查
    - [ ] 添加 Windows 平台 CI / 本地验证流程
    - [ ] 补充 Tauri 打包说明
    - [ ] 补充 Windows、macOS、Linux 依赖说明
    - [ ] 明确安装包产物路径和发布流程

## 暂不优先做

- [ ] 暂不接入 LSP
- [ ] 暂不做跨文件符号补全
- [ ] 暂不做查找引用和精确跳转定义
- [ ] 暂不做自动 import
- [ ] 暂不做重构能力
- [ ] 暂不做 Debugger
- [ ] 暂不优先实现 minimap
- [ ] 暂不做插件系统
- [ ] 暂不做 hunk 级 stage
- [ ] 暂不做完整 stage / unstage 双栏面板
- [ ] 暂不做 stash / blame / rebase / cherry-pick / tag / force push
- [ ] 暂不做三方可编辑冲突解决器
