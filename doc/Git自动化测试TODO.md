# Git 自动化测试 TODO

## 0. 首轮自动化基线（2026-07-26）

本轮只新增测试、测试夹具和 Windows 原生 E2E 基础设施，没有修改 Git 业务实现来迁就失败用例。

| 测试层 | 执行命令 | 结果 | 当前结论 |
| --- | --- | --- | --- |
| Rust 单元与真实 Git 集成 | `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1` | 69 通过，8 失败 | Git 基础操作大多可用；错误分类与 linked worktree 事件识别需修复 |
| 前端状态流及现有 Vitest | `pnpm test` | 349 通过，1 失败 | 切换工作区后，旧仓库的慢刷新会覆盖新仓库状态 |
| Windows 原生 Tauri E2E | `pnpm test:e2e:native` | 5 通过，0 失败 | 真实窗口中的提交、推送、拉取、合并、建分支均通过 |
| TypeScript | `pnpm typecheck` | 通过 | 新增测试和配置类型正确 |
| ESLint | `pnpm lint` | 0 错误，33 个既有警告 | 新增测试文件定向复检为 0 错误、0 警告 |

首轮失败项：

- 权限错误文本 `Permission denied (publickey)` 未归类为 `AuthFailed`。
- non-fast-forward / `fetch first` 推送拒绝未归类为 `Conflict`。
- 同一输出同时包含权限警告与冲突时，权限分类错误地覆盖冲突分类。
- 已删除工作区路径未归类为 `NotRepository`。
- 无 upstream 的 pull、无 remote 的 push 未归类为 `NoUpstream`。
- linked worktree 根目录的 `.git` 文件事件未触发 Git 状态刷新判断。
- 切换工作区后，前一个工作区尚未完成的 `refreshGit` 会回写旧状态。

Windows 原生 E2E 还观察到一个与 Git 操作无关、但会影响“命令行打开仓库”测试的现象：第二实例参数转发时，应用把 `argv[0]` 的 `norn.exe` 当成待打开文件，界面提示该二进制文件无法按文本编码打开。该问题本轮只记录，未修改实现。

## 1. 目标

为 Norn 的轻量 Git 工作流建立稳定、可重复、可在 Windows CI 中执行的自动化测试体系。

测试重点不是追求完整 Git 客户端功能，而是保证与 IDEA、VS Code 相近的基础体验：

- Git 操作结果与系统 Git CLI 一致。
- 不丢失未提交、未选择或未推送的数据。
- 文件系统、仓库元数据或远端状态异常时不崩溃、不无限等待。
- 操作成功后界面最终状态与磁盘、HEAD、index、refs 和 remote 一致。
- 操作失败时给出明确、可操作的错误反馈，并恢复 loading/busy 状态。
- 重复点击、并发刷新和外部 Git 操作不会导致重复执行或旧状态覆盖新状态。

## 2. 范围

### 2.1 核心发布门禁（P0）

- 仓库识别与 Git 状态刷新。
- changed、untracked、deleted、renamed、conflict 文件展示。
- 文件选择、commit、amend、commit and push。
- fetch、pull、push。
- 本地/远程分支展示、创建和切换。
- merge、冲突识别、冲突解决和 abort。
- 外部文件或 Git 元数据变化后的自动刷新。
- 错误分类、并发防抖、超时和失败恢复。

### 2.2 次级稳定性范围（P1）

- linked worktree 和 `.git` 中的 `gitdir:` 文件。
- detached HEAD、从历史提交创建分支。
- reset、revert。
- worktree 创建、列出、删除和 prune。
- `.git`、HEAD、index、refs、config 损坏或失效。
- Windows 文件锁、CRLF、长路径、Unicode 路径。

### 2.3 暂不纳入

- 完整 staged/unstaged 双栏管理。
- hunk 级 stage/unstage。
- rebase、interactive rebase、cherry-pick。
- stash、tag、blame。
- force push。
- 分支删除。
- 依赖真实 GitHub/GitLab 账号、真实凭据或公网稳定性的 E2E。

## 3. 测试分层

### 3.1 Rust 纯函数测试

目标：快速覆盖解析、分类和路径判断，不启动真实 UI。

- [ ] Git status porcelain v2 解析。
- [ ] numstat、rename、branch tracking、worktree porcelain 解析。
- [ ] Git stderr/stdout 错误分类表。
- [ ] `.git` 目录和 `gitdir:` 文件解析。
- [ ] Git 元数据事件是否需要刷新。
- [ ] 工作区路径、文件路径和越界路径校验。

### 3.2 Rust 真实 Git 集成测试

目标：在 `tempfile` 临时目录中执行系统 Git CLI，验证真实 HEAD、index、工作区、refs 和 remote。

- 每个测试使用独立仓库。
- remote 使用本地 bare repository，不访问公网。
- 测试仓库显式配置 `user.name`、`user.email`、`commit.gpgsign=false`。
- 测试仓库显式控制 `core.autocrlf`，不继承开发机行为。
- hooks 使用临时空目录，不使用平台相关的 `/dev/null`。
- 需要失败 hook 时，在测试自己的 bare remote 中创建。

### 3.3 前端 Git 状态流测试

目标：mock Tauri `invoke`，验证 store、busy、notice、刷新和并发行为。

- [ ] `refreshGit` 正常刷新全部 Git 数据。
- [ ] 任一读取失败时错误进入 `gitError`。
- [ ] fetch 与本地刷新并行时 spinner 不闪烁。
- [ ] 多次刷新时较旧请求不能覆盖较新仓库状态。
- [ ] 切换工作区后旧请求结果被忽略。
- [ ] Git 写操作期间重复点击只执行一次。
- [ ] 成功和失败后 `gitBusy` 一定复位。
- [ ] 成功 notice、错误 notice 和自动消失行为正确。
- [ ] commit 成功但 push 失败时显示部分成功，而不是误报 commit 未发生。

### 3.4 浏览器 UI 测试

保留现有 Playwright + Tauri mock，用于快速验证布局、按钮、对话框和前端交互。

浏览器测试不作为真实文件系统或真实 Git 行为的证明。

### 3.5 Windows 原生 Tauri E2E

新增独立的 WebdriverIO/Tauri WebDriver 测试套件，启动真实 Tauri 二进制和真实临时 Git 仓库。

- [ ] 新建 `tests/native-e2e/`。
- [ ] 新建 `wdio.tauri.conf.ts`。
- [ ] 新增 `test:e2e:native:windows` 脚本。
- [ ] 使用 debug、no-bundle 构建缩短测试时间。
- [ ] 通过应用启动参数传入临时仓库目录，避免操作原生文件选择对话框。
- [ ] 串行运行，`maxInstances: 1`。
- [ ] 测试结束后关闭应用、driver，并清理临时仓库。
- [ ] 失败时保存前端/后端日志、截图和 WebDriver 诊断信息。

## 4. 仓库识别与状态 TODO

### P0

- [ ] 普通 Git 仓库显示当前分支。
- [ ] 非 Git 目录显示初始化提示，Git 写操作不可用。
- [ ] 从仓库子目录打开时识别真正 Git root。
- [ ] 空仓库/unborn branch 不崩溃。
- [ ] detached HEAD 正确展示。
- [ ] 新增、修改、删除、重命名、未跟踪、冲突状态解析正确。
- [ ] 同一文件 staged/unstaged 混合状态不会漏报。
- [ ] ahead、behind 和 upstream 解析正确。
- [ ] ignored 文件不会混入普通变更列表。
- [ ] 文件名包含空格、中文、emoji、Tab、换行时解析正确。
- [ ] 外部执行 commit 后 Git 面板自动刷新。
- [ ] 外部执行 checkout 后分支、文件树和编辑器自动刷新。
- [ ] 外部执行 reset/merge 后状态自动刷新。

### P1

- [ ] `.git` 为 linked worktree 的 `gitdir:` 文件时识别仓库。
- [ ] `.git` 文件使用绝对目标路径。
- [ ] `.git` 文件使用相对目标路径。
- [ ] `.git` 文件被原子替换后重新解析目标。
- [ ] `.git` 文件指向另一个有效 gitdir 时重新绑定监听。
- [ ] `.git` 文件为空、格式错误或不可读时返回明确错误。
- [ ] `.git` 文件指向不存在目录时不崩溃。
- [ ] 主仓库移动或删除后 linked worktree 失效时不崩溃。
- [ ] `.git` 为 symlink 或 Windows junction 时行为明确。
- [ ] `.git/HEAD`、index、packed-refs、refs 变化触发 Git 刷新。
- [ ] objects、logs 和临时 `.lock` churn 不造成刷新风暴。
- [ ] `.git` 自身被删除和恢复时界面状态能够恢复。

## 5. Commit TODO

### P0

- [ ] 提交单个已修改文件。
- [ ] 提交多个文件。
- [ ] 只提交选中文件，未选择文件保持原状。
- [ ] 同时提交新增、修改、删除、重命名文件。
- [ ] 提交未跟踪文件。
- [ ] 提交已加入 `.gitignore` 的 cached removal。
- [ ] commit message 为空时 UI 阻止提交。
- [ ] 没有选中文件时 UI 阻止提交。
- [ ] nothing to commit 返回结构化错误。
- [ ] message 包含中文、emoji、引号、换行和类似命令行参数的文本。
- [ ] amend 修改上一条提交内容和 message。
- [ ] amend message 为空时保留原 message。
- [ ] 用户身份未配置时返回 `identity-missing`。
- [ ] commit hook 拒绝时显示 hook 输出。
- [ ] GPG signing 失败时显示 Git 原始错误。
- [ ] 双击提交只生成一个 commit。
- [ ] 提交失败后 index 和未提交文件不丢失。
- [ ] 提交成功后变更列表、历史和分支 ahead 数量刷新。

### P1

- [ ] `.git/index.lock` 存在时提交安全失败。
- [ ] index 无写权限时安全失败。
- [ ] 文件在点击提交后、执行 `git add` 前被外部删除。
- [ ] 文件在 `git add` 后、`git commit` 前变化时结果可解释。
- [ ] 文件父目录在提交期间消失时不崩溃。
- [ ] 仓库目录在提交期间被移动或删除时不崩溃。
- [ ] 大量文件提交，例如 5,000 个变更文件。
- [ ] 大文件和二进制文件提交。
- [ ] `core.autocrlf=true` 和 `false` 下内容及状态正确。
- [ ] Windows 只读文件不会被意外覆盖。
- [ ] commit 成功、push 失败时保留 commit 并明确提示部分成功。

## 6. Push TODO

### P0

- [ ] 当前分支有 upstream 时正常 push。
- [ ] 新分支没有 upstream 时执行 `push -u origin <branch>`。
- [ ] push 后 remote ref 与本地 HEAD 一致。
- [ ] 没有 origin 时返回明确错误。
- [ ] origin 不存在或路径失效时返回明确错误。
- [ ] upstream 指向不存在的远程分支时返回明确错误。
- [ ] non-fast-forward 被识别为远端拒绝，而不是通用 IO。
- [ ] pre-push hook 拒绝时显示 hook 输出。
- [ ] remote pre-receive hook 拒绝时显示远端输出。
- [ ] protected branch 风格错误被识别为 remote rejected。
- [ ] SSH `Permission denied (publickey)` 被识别为认证失败。
- [ ] HTTPS authentication failed、401、403 被识别为认证失败。
- [ ] GitHub `Permission to ... denied to ...` 错误被识别。
- [ ] 网络连接失败、超时和连接重置能结束操作并恢复 busy。
- [ ] 凭据需要交互时不能让应用无限挂起。
- [ ] 重复点击 push 只运行一个进程。

### P1

- [ ] remote 在 push 开始前被删除。
- [ ] remote 在对象传输期间拒绝更新。
- [ ] 大提交 push 时 UI 保持响应。
- [ ] 多个 remote 存在时仍只使用当前 upstream/origin 策略。
- [ ] 分支名包含 `/`、中文或类似参数的前缀时参数安全。

## 7. Pull/Fetch TODO

### P0

- [ ] fetch 更新远程分支和 ahead/behind，但不修改工作区。
- [ ] pull 已是最新。
- [ ] pull fast-forward。
- [ ] pull 新增文件。
- [ ] pull 修改、删除和重命名文件。
- [ ] 本地存在不冲突的未提交修改时 pull 行为与 Git CLI 一致。
- [ ] 本地修改会被覆盖时安全拒绝，不丢失修改。
- [ ] 本地与远端分叉时遵循用户 Git pull 配置并明确反馈。
- [ ] pull 产生冲突时显示冲突文件和 pending operation。
- [ ] pull 后文件树、编辑器、Git 面板、历史和 ahead/behind 一致刷新。
- [ ] 没有 upstream 时返回明确错误。
- [ ] 没有 remote 或 remote 失效时返回明确错误。
- [ ] fetch/pull 认证失败和网络失败时恢复 spinner/busy。
- [ ] 连续点击刷新不会并发执行多个 fetch。

### P1

- [ ] pull 期间已打开文件被远端修改且编辑器无本地未保存内容。
- [ ] pull 期间已打开文件被远端修改且编辑器有未保存内容，不能静默覆盖。
- [ ] pull 期间文件或父目录被外部删除。
- [ ] pull 完成后 watcher 大量事件只触发有限次数刷新。
- [ ] fetch/prune 后已删除远程分支从界面消失。

## 8. Branch TODO

### P0

- [ ] 显示本地、远程和当前分支。
- [ ] 显示 upstream、ahead、behind。
- [ ] 创建普通分支并切换。
- [ ] 创建 `feature/a/b` 多级名称分支。
- [ ] 创建空名称、非法名称、重复名称时明确失败。
- [ ] 切换干净分支。
- [ ] 有未提交但不冲突的修改时切换，结果与 Git CLI 一致。
- [ ] 切换会覆盖本地修改时安全拒绝且不丢数据。
- [ ] 切换远程分支并创建本地 tracking branch。
- [ ] detached HEAD 后创建分支恢复正常状态。
- [ ] 快速连续点击两个分支不会出现旧请求覆盖新状态。
- [ ] 切换后当前分支、工作区文件和状态栏一致。

### P1

- [ ] 分支名含空格风格非法输入、Unicode、emoji 和类似命令行参数的文本。
- [ ] 目标分支在点击后被外部删除。
- [ ] 分支切换期间工作区目录失效。
- [ ] 分支数量达到数千时列表仍能使用。
- [ ] 大小写敏感和 Windows 大小写不敏感路径场景。

## 9. Merge TODO

### P0

- [ ] 合并自身和 already up-to-date。
- [ ] fast-forward merge。
- [ ] 普通三方合并并生成 merge commit。
- [ ] 合并新增、修改、删除和重命名文件。
- [ ] dirty working tree 会被覆盖时安全拒绝。
- [ ] 文本内容冲突被识别。
- [ ] delete/modify 冲突被识别。
- [ ] rename/rename、rename/delete 冲突被识别。
- [ ] 冲突文件出现在 Git 面板中。
- [ ] 解决全部冲突后可以提交。
- [ ] 只解决部分冲突时仍保持 merge pending。
- [ ] abort merge 后 HEAD、index 和工作区恢复到合并前。
- [ ] merge hook 失败时显示 hook 输出。
- [ ] 双击 merge 只执行一次。
- [ ] 合并完成后历史图和分支关系刷新。

### P1

- [ ] 合并过程中源分支被外部删除。
- [ ] 合并过程中仓库或文件父目录失效。
- [ ] 合并大量文件。
- [ ] CRLF/LF 不同分支合并行为稳定。
- [ ] 二进制文件冲突不尝试按文本解析。

## 10. Worktree 与文件系统异常 TODO

### P1

- [ ] 正常创建、列出、打开和删除 worktree。
- [ ] worktree `.git` 文件正确指向主仓库管理目录。
- [ ] 在 linked worktree 中 commit、pull、push、switch、merge。
- [ ] linked worktree 外部 commit/checkout 后触发界面刷新。
- [ ] worktree 根目录被手动删除。
- [ ] worktree 根目录存在，但 `.git` 文件被删除。
- [ ] `.git` 文件存在，但 `.git/worktrees/<name>` 元数据被删除。
- [ ] 主仓库被移动或删除后 linked worktree 失效。
- [ ] stale worktree 在列表中标记为 prunable。
- [ ] stale worktree 普通 remove、force remove 和 prune。
- [ ] 连续执行 prune 保持幂等。
- [ ] 有未提交修改时普通 remove 被拒绝。
- [ ] force remove 只删除目标 worktree，不影响主仓库。
- [ ] worktree 路径包含空格、中文、emoji 和长路径。
- [ ] worktree 目标父目录不存在或创建期间消失。

## 11. Windows 原生 E2E 首批用例

以下用例使用真实 Norn Tauri 窗口、真实临时仓库和本地 bare remote：

- [ ] `E2E-GIT-001` 打开仓库，显示当前分支和真实变更。
- [ ] `E2E-GIT-002` 编辑并保存文件，查看 diff，选择文件并 commit。
- [ ] `E2E-GIT-003` 两个文件只选择一个提交，另一个保持未提交。
- [ ] `E2E-GIT-004` commit and push 到本地 bare remote。
- [ ] `E2E-GIT-005` 由第二个 clone 推送更新，Norn pull 后刷新文件和界面。
- [ ] `E2E-GIT-006` 从界面创建分支并切换。
- [ ] `E2E-GIT-007` dirty checkout 会覆盖修改时拒绝切换且保留内容。
- [ ] `E2E-GIT-008` 从界面执行 fast-forward merge。
- [ ] `E2E-GIT-009` 制造 merge conflict，显示冲突并 abort。
- [ ] `E2E-GIT-010` remote hook 拒绝 push，界面显示错误且 busy 恢复。
- [ ] `E2E-GIT-011` 外部终端 commit/checkout 后 Norn 自动刷新。
- [ ] `E2E-GIT-012` 仓库路径和文件名包含中文、空格，启用 CRLF。

后续稳定性 E2E：

- [ ] `E2E-GIT-013` linked worktree 中提交并刷新。
- [ ] `E2E-GIT-014` worktree gitdir 失效后界面显示仓库错误而不崩溃。
- [ ] `E2E-GIT-015` `.git/index.lock` 阻止 commit 后解除锁可恢复。
- [ ] `E2E-GIT-016` commit 成功但 push 失败时显示部分成功。

## 12. 错误分类 TODO

建议在现有错误类型基础上评估新增：

- [ ] `workspace-missing`
- [ ] `repository-metadata-missing`
- [ ] `remote-missing`
- [ ] `remote-rejected`
- [ ] `non-fast-forward`
- [ ] `network`
- [ ] `timeout`
- [ ] `partial-success`

必须覆盖的错误文本来源：

- [ ] Git for Windows。
- [ ] Git Linux/macOS。
- [ ] GitHub HTTPS/SSH。
- [ ] GitLab HTTPS/SSH。
- [ ] Azure DevOps 常见认证错误。
- [ ] 本地 hook 和 remote hook。

## 13. 并发、超时和稳定性 TODO

- [ ] 所有 Git 写操作都有单次执行防抖。
- [ ] read refresh 可并行，但旧结果不能覆盖新结果。
- [ ] 工作区切换使旧仓库请求失效。
- [ ] 网络 Git 命令有明确超时策略或可取消策略。
- [ ] 需要终端输入的 Git 命令不能无限挂起。
- [ ] 应用关闭时正在运行的 Git 子进程得到处理。
- [ ] watcher 事件风暴不会触发无限刷新。
- [ ] 同一个核心场景循环运行 20 次无偶发失败。
- [ ] nightly 异常套件循环运行 Windows 文件锁和目录失效场景。

## 14. CI TODO

- [ ] Rust Git 测试至少运行于 `windows-latest` 和 `ubuntu-latest`。
- [ ] Windows 原生 E2E 在 PR 或 main 分支运行核心 12 条。
- [ ] P1 文件系统异常和压力测试放入 nightly 或手动 workflow。
- [ ] 单元测试失败时输出被测 Git 版本和关键仓库配置。
- [ ] 原生 E2E 失败时上传日志、截图和测试临时仓库诊断信息。
- [ ] 不上传凭据、token、用户全局 Git 配置或敏感 remote URL。
- [ ] 测试结果区分产品失败、环境缺失和 driver 启动失败。

## 15. 统一验收标准

每条真实 Git 测试至少验证以下适用项：

- [ ] Git 命令返回值和结构化错误类型。
- [ ] HEAD 指向。
- [ ] 当前分支和 upstream。
- [ ] index 内容。
- [ ] 工作区文件内容。
- [ ] 未选择、未提交内容仍然存在。
- [ ] remote ref 是否符合预期。
- [ ] Git 面板、文件树、编辑器、历史和状态栏最终一致。
- [ ] busy/loading/refreshing 状态复位。
- [ ] 错误提示明确且包含可操作信息。
- [ ] 无 panic、崩溃、死锁或无限等待。
- [ ] 重复操作不产生重复 commit、push 或 merge。
- [ ] 测试不依赖真实公网和用户个人凭据。

## 16. 已知基线问题

- 当前 Rust Git 测试已有较多正常流程覆盖，但 Windows 执行受系统 `core.autocrlf=true` 影响，存在固定 LF 断言失败；测试 fixture 需要显式控制换行配置。
- 当前 CI 的 Rust job 只运行于 Ubuntu，无法发现 Windows Git 和文件系统差异。
- 当前 Playwright E2E 使用 Vite 浏览器模式和 Tauri mock，不覆盖真实 Tauri IPC、真实文件系统和真实 Git CLI。
- 当前普通仓库 `.git/HEAD`、index、refs 有路径判断测试，但 linked worktree 的真实 gitdir 位于工作区外，现有 watcher 未验证是否能够刷新。
- 当前远端测试只覆盖本地 bare remote 的成功 push/pull/fetch，没有覆盖权限、远端拒绝、超时和部分成功。
- 当前 `use-git.ts` 缺少直接测试，并发刷新和旧请求覆盖风险没有被固定。

## 17. 推荐实施顺序

### 第一批：稳定测试基建

- [ ] 修复 Windows 换行相关测试 fixture。
- [ ] 为 Git 测试建立统一 repo、remote、clone、hook fixture。
- [ ] 增加错误分类表测试。
- [ ] CI 增加 Windows Rust job。

### 第二批：核心 Git 后端

- [ ] Commit P0。
- [ ] Push P0。
- [ ] Pull/Fetch P0。
- [ ] Branch P0。
- [ ] Merge P0。

### 第三批：前端状态流

- [ ] `refreshGit` 和 fetch 并发。
- [ ] 写操作防抖和 busy 恢复。
- [ ] 工作区切换和旧请求失效。
- [ ] 部分成功语义。

### 第四批：Windows 原生 E2E

- [ ] 建立 WebdriverIO/Tauri WebDriver 基础设施。
- [ ] 落地 `E2E-GIT-001` 至 `E2E-GIT-012`。
- [ ] 接入 Windows CI。

### 第五批：异常与压力

- [ ] linked worktree 和 gitdir watcher。
- [ ] 元数据损坏、目录消失和文件锁。
- [ ] 大仓库、长路径、大量分支和大量变更。
- [ ] nightly 重复与压力运行。
