# 原生与文件树 E2E 实施 TODO

## 1. 目标与原则

- Playwright + Tauri mock 继续负责大量分支、失败注入和可控竞态。
- Windows 原生 Tauri E2E 只覆盖必须经过真实窗口、IPC、Rust、文件系统、watcher、进程和 Git 的关键链路。
- 每条原生测试使用独立临时目录，不读写用户文件，不依赖公网。
- 真实竞态使用测试同步点控制顺序，不使用固定长时间 `sleep` 制造偶发测试。
- P0 原生测试稳定后进入 Windows CI 发布门禁。

## 2. 第一批：真实文件系统原生 E2E（P0）

### 2.0 实施进度（2026-07-26）

已新增 `tests/native-e2e/file-system.spec.ts`，当前 14 条真实 Windows/Tauri E2E 覆盖 15 个用例 ID，全部通过。

- [x] `NATIVE-FILE-OPEN-001` / `NATIVE-FILE-OPEN-003`：真实 Unicode 路径 UTF-8 文件正常打开。
- [x] `NATIVE-FILE-OPEN-002`：UTF-8 BOM、UTF-16 LE/BE 文件正常打开且不显示 BOM 字符。
- [x] `NATIVE-FILE-OPEN-004`：检查文件期间真实文件被删除，不创建半初始化 Tab。
- [x] `NATIVE-FILE-OPEN-005`：读取文件期间被其他进程修改，打开修改后的完整版本。
- [x] `NATIVE-FILE-OPEN-006`：读取文件期间真实文件被重命名，不产生旧、新重复 Tab。
- [x] `NATIVE-FILE-OPEN-007`：检查后被替换为二进制文件时拒绝打开。
- [x] `NATIVE-FILE-EDIT-001`：其他进程修改真实文件后干净文档自动重载。
- [x] `NATIVE-FILE-EDIT-002`：脏文档保留本地内容，选择磁盘版本时读取点击时的最新内容。
- [x] `NATIVE-FILE-EDIT-003`：真实删除后文件树刷新，活动文档显示删除冲突。
- [x] `NATIVE-FILE-EDIT-004`：脏文档被外部删除后保留本地内容、脏状态和恢复操作。
- [x] `NATIVE-FILE-EDIT-005`：真实重命名后文件树刷新，活动 Tab 名称和路径同步更新。
- [x] `NATIVE-FILE-EDIT-006`：脏文档被外部重命名后保留本地内容和脏状态。
- [x] `NATIVE-FILE-EDIT-007`：外部编辑器原子替换文件时识别为内容变化。
- [x] `NATIVE-FILE-EDIT-008`：watcher 事件风暴后收敛到最终磁盘内容且不产生冲突。

本批原生测试发现并已修复的问题：

- [x] `NATIVE-BUG-001` 中文 Windows 的文件不存在错误未被识别，导致活动文档未进入删除冲突。
- [x] `NATIVE-BUG-002` 中文 Windows 的文件不存在错误未被识别，导致重命名检测未更新活动 Tab。

### 2.1 打开与外部变化

- [x] `NATIVE-FILE-OPEN-001` 打开真实 UTF-8 文件，编辑器内容、Tab 名称和路径正确。
- [x] `NATIVE-FILE-OPEN-002` 打开 UTF-8 BOM、UTF-16 LE/BE 文件不出现 BOM 字符或乱码。
- [x] `NATIVE-FILE-OPEN-003` 中文、空格、emoji、`#`、`%` 和方括号路径能够打开。
- [x] `NATIVE-FILE-OPEN-004` 打开过程中真实文件被删除，不创建半初始化 Tab。
- [x] `NATIVE-FILE-OPEN-005` 打开过程中真实文件被其他进程修改，内容和元数据来自同一版本。
- [x] `NATIVE-FILE-OPEN-006` 打开过程中真实文件被重命名，不产生旧、新重复 Tab。
- [x] `NATIVE-FILE-OPEN-007` 读取前替换为二进制文件时拒绝打开。
- [x] `NATIVE-FILE-EDIT-001` 干净文档被外部进程修改后通过真实 watcher 自动重载。
- [x] `NATIVE-FILE-EDIT-002` 脏文档被外部进程修改后保留本地内容并显示冲突。
- [x] `NATIVE-FILE-EDIT-003` 干净文档被外部删除后显示删除冲突。
- [x] `NATIVE-FILE-EDIT-004` 脏文档被外部删除后保留本地内容并允许另存为或丢弃。
- [x] `NATIVE-FILE-EDIT-005` 干净文档被外部重命名后 Tab 和路径跟随更新。
- [x] `NATIVE-FILE-EDIT-006` 脏文档被外部重命名后保留本地内容和脏状态。
- [x] `NATIVE-FILE-EDIT-007` 外部程序采用“临时文件 + rename”原子保存时识别为内容变化。
- [x] `NATIVE-FILE-EDIT-008` watcher 事件风暴最终只产生一次有效刷新或冲突。

### 2.2 保存与数据安全

- [ ] `NATIVE-FILE-SAVE-001` 正常保存真实文件后磁盘字节、mtime 和编辑器保存状态一致。
- [ ] `NATIVE-FILE-SAVE-002` 保存前文件被外部修改时版本校验阻止覆盖。
- [ ] `NATIVE-FILE-SAVE-003` 版本校验后、原子写入前再次修改时不能静默覆盖。
- [ ] `NATIVE-FILE-SAVE-004` 保存进行中继续输入，后续输入保持未保存。
- [ ] `NATIVE-FILE-SAVE-005` 自动保存和手动保存并发时最终磁盘内容正确且不重复写入。
- [ ] `NATIVE-FILE-SAVE-006` 保存前文件被删除或重命名时不意外重建错误路径。
- [ ] `NATIVE-FILE-SAVE-007` 保存时父目录消失后保留编辑器内容和脏状态。
- [ ] `NATIVE-FILE-SAVE-008` Windows `FileShare.None` 文件锁阻止保存，解除锁后可以重试。
- [ ] `NATIVE-FILE-SAVE-009` 文件只读、目录只读或 ACL 权限不足时显示可操作错误。
- [ ] `NATIVE-FILE-SAVE-010` 原子写临时文件或 rename 失败时原文件不损坏、不留下正式半成品。
- [ ] `NATIVE-FILE-SAVE-011` 冲突选择“使用编辑器”后真实磁盘变为编辑器版本。
- [ ] `NATIVE-FILE-SAVE-012` 冲突选择“使用磁盘”时重新读取点击时的最新磁盘版本。
- [ ] `NATIVE-FILE-SAVE-013` 冲突选择“另存为”时原文件不变，新文件内容正确。

### 2.3 关闭、退出和恢复

- [ ] `NATIVE-FILE-LIFE-001` 多个脏文件关闭窗口时依次保存成功后才退出。
- [ ] `NATIVE-FILE-LIFE-002` 后台 Tab 保存失败时阻止退出并聚焦失败文档。
- [ ] `NATIVE-FILE-LIFE-003` 未命名草稿退出后重启能够恢复内容、编码和 Tab。
- [ ] `NATIVE-FILE-LIFE-004` 会话恢复时部分文件已删除、变更或变成二进制，不阻塞其他 Tab。
- [ ] `NATIVE-FILE-LIFE-005` 恢复工作区、Tab 顺序、活动 Tab、光标、滚动和搜索状态。

## 3. 第二批：文件树 mock E2E（P0）

### 3.1 加载、选择和键盘

- [ ] 补齐 `TREE-LOAD-009`、`TREE-LOAD-012`～`TREE-LOAD-018`。
- [ ] 补齐 `TREE-SELECT-006`、`TREE-SELECT-010`、`TREE-SELECT-011`。
- [ ] 完成 `TREE-KEY-001`～`TREE-KEY-015`：方向键、Home/End、展开折叠、Enter、Space、Esc、多选和即时搜索。

### 3.2 CRUD、剪贴板和拖拽

- [ ] 完成 `TREE-CRUD-001`～`TREE-CRUD-016`：新建、重命名、删除、多选、失败和重试。
- [ ] 完成 `TREE-CLIP-001`～`TREE-CLIP-012`：复制、剪切、粘贴、覆盖和过期源文件。
- [ ] 完成 `TREE-DND-001`～`TREE-DND-011`：内部移动、外部拖入、循环保护和部分失败。
- [ ] 完成 `TREE-MENU-001`～`TREE-MENU-007`：右键目标、复制路径、资源管理器和终端。

## 4. 第三批：真实文件树原生 E2E

- [ ] `NATIVE-TREE-001` 真实 watcher 同步外部新增、删除和重命名。
- [ ] `NATIVE-TREE-002` 真实新建文件和文件夹结果正确。
- [ ] `NATIVE-TREE-003` 真实重命名同步已打开 Tab 和当前选择。
- [ ] `NATIVE-TREE-004` 删除到 Windows 回收站后文件消失且可恢复。
- [ ] `NATIVE-TREE-005` 复制、剪切、粘贴和移动真实文件。
- [ ] `NATIVE-TREE-006` 外部拖入真实文件和目录。
- [ ] `NATIVE-TREE-007` 文件锁、权限不足和只读目录错误可恢复。
- [ ] `NATIVE-TREE-008` 中文、超长路径和大小写路径行为正确。
- [ ] `NATIVE-TREE-009` 符号链接循环不会无限展开。
- [ ] `NATIVE-TREE-010` 数千文件目录加载、虚拟滚动和选择稳定。

## 5. 第四批：桌面生命周期、平台与 CI

- [ ] `NATIVE-APP-001` Windows 关闭到托盘、恢复和明确退出语义一致。
- [ ] `NATIVE-APP-002` 第二实例打开文件或文件夹只转发一次且不影响未保存内容。
- [ ] `NATIVE-APP-003` 命令行同时传入文件夹和多个文件时打开顺序正确。
- [ ] `NATIVE-APP-004` 强制结束进程后草稿可恢复。
- [ ] `NATIVE-APP-005` WebView2 或窗口重建后 watcher 和会话恢复正常。
- [ ] `NATIVE-APP-006` Windows 缩放、多显示器和窗口位置恢复安全。
- [ ] Windows CI 执行 P0 原生 E2E，并上传截图、前端日志、Rust 日志和临时目录诊断。
- [ ] 原生 E2E 增加 `@native` / `@p0` 标签和可重复运行门禁。

## 6. 统一验收标准

- 磁盘内容、编辑器内容、`savedContent`、mtime、Tab 脏状态和冲突状态保持一致。
- 外部变化不能静默覆盖本地未保存内容。
- 旧异步响应不能覆盖用户后续操作。
- 测试失败后输出测试临时目录、目标文件元数据、活动 Tab、弹窗和应用日志。
- 测试结束后无残留 Norn、driver、文件锁辅助进程或临时目录。
