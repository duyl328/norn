# Norn 编码规范

本文件定义 Norn 项目的编码、样式、工程化约束。所有提交需遵循本规范，由 ESLint / Prettier 自动强制（见“工程化”一节）。提交信息规范见 [AGENTS.md](./AGENTS.md)，技术栈与 UI 约束见 [TECH_STACK.md](./TECH_STACK.md)。

## 1. 包管理

- **统一使用 pnpm**，禁止混用 npm / yarn。
- 仓库只保留 `pnpm-lock.yaml`，不提交 `package-lock.json` / `yarn.lock`。
- 通过 `package.json` 的 `packageManager` 字段锁定 pnpm 版本，建议用 `corepack enable` 启用。
- 安装依赖：`pnpm install`；运行脚本：`pnpm <script>`（如 `pnpm dev`、`pnpm lint`）。

## 2. 文件与代码体积

| 约束            | 阈值                               | 强制方式                                  |
| --------------- | ---------------------------------- | ----------------------------------------- |
| 单行长度        | ≤ 120 字符                         | Prettier 自动换行 + ESLint `max-len` 警告 |
| 单文件行数      | ≤ 800 行（超出 ESLint 警告）       | ESLint `max-lines`                        |
| 单函数行数      | 建议 ≤ 80 行                       | 人工约束                                  |
| 单组件 useState | 建议 ≤ 8 个，超出应抽 hook / store | 人工约束                                  |

- 超过 800 行的文件视为需要拆分的信号。组件按职责拆分到独立文件，复杂状态抽到 Zustand store 或自定义 hook。
- 不允许新增超大“God Component”。新组件优先单一职责。

## 3. 目录结构约定

```text
src/
├── app.tsx                      # 应用根组件
├── main.tsx                     # DOM 挂载入口
├── styles.css                   # 全局样式、design token、动画
├── components/ui/               # 通用基础 UI 组件（shadcn 风格，与业务无关）
├── features/<feature>/          # 业务功能模块
│   ├── components/              # 该功能的展示组件（单文件 ≤ 800 行）
│   ├── hooks/                   # 该功能的自定义 hooks
│   ├── store/                   # 该功能的 Zustand store
│   ├── types.ts                 # 该功能的类型定义
│   └── <feature>-page.tsx       # 功能入口，只做装配与布局
└── lib/                         # 跨功能的纯工具函数（无副作用、无 React）
```

- 业务组件放 `features/<feature>/components/`，不放 `components/ui/`。
- `components/ui/` 只放与业务解耦的通用组件。

## 4. TypeScript

- 全量开启 `strict`，禁止 `any`（确需时用 `unknown` + 收窄，并写注释说明）。
- 禁止 `@ts-ignore`；必要时用 `@ts-expect-error` 并附原因。
- 公共类型集中在功能模块的 `types.ts`，避免在大文件顶部堆叠几十个 `type`。
- 组件 props 用 `type` 定义；优先 `import type` 引入纯类型。
- 路径别名统一用 `@/`，禁止深层相对路径 `../../../`。

## 5. React

- 函数组件 + Hooks，禁止类组件。
- 遵守 Hooks 规则（`react-hooks/rules-of-hooks`、`exhaustive-deps`）。
- 副作用集中在 `useEffect`，并保持依赖数组正确；复杂副作用抽自定义 hook。
- 列表渲染必须有稳定 `key`，禁止用数组索引作为可变列表的 key。
- 事件处理与业务逻辑尽量下沉到 hook / store，组件保持“声明式渲染”。

## 6. 状态管理

- 跨组件 / 复杂业务状态使用 **Zustand**：按域建 store（如 `documentsStore`、`fileTreeStore`、`panelsStore`、`gitStore`）。
- 仅组件内部的局部 UI 状态（如某个下拉是否展开）可继续用 `useState`。
- 单个组件 `useState` 超过 ~8 个时，应拆分组件或上移到 store / 自定义 hook。
- store 中区分 state 与 action；action 命名用动词（`openDocument`、`closeDocument`）。
- 持久化逻辑（localStorage / Tauri）封装在 store 或 hook，不散落在组件里。

## 7. 样式规范（Tailwind 优先）

样式策略按以下优先级，**新代码一律优先 Tailwind utility**：

1. **首选 Tailwind utility class**：直接写在 `className` 上。绝大多数布局、间距、颜色、字号都应这样写。
2. **变体逻辑用 `cva`**：组件有多种状态/尺寸变体时，用 `class-variance-authority` 收敛到组件内，不要散写条件 class。
3. **CSS 自定义类仅用于**：① 无法用 utility 表达的（如 `::-webkit-scrollbar`、`@keyframes`、vibrancy/frosted 效果）；② 被大量复用且结构稳定的语义块。新增此类 class 需写在 `styles.css` 的 `@layer components` 内。
4. **内联 `style={}` 仅用于运行时动态值**（如拖拽产生的像素宽度、CSS 变量注入）。禁止把静态样式写进 `style`。

### Design Token

- 颜色：统一用 `styles.css` 的 CSS 变量 + `tailwind.config.ts` 映射的语义色（`bg-background`、`text-muted-foreground` 等），**禁止硬编码十六进制颜色**。
- 字号：使用 `tailwind.config.ts` 的 `ui-*` 字号刻度（`text-ui-2xs`=8px、`text-ui-xs`=9px、`text-ui-sm`=10px、`text-ui-md`=11px、`text-ui`=12px、`text-ui-lg`=13px、`text-ui-xl`=14px、`text-ui-2xl`=24px；主字号 `text-ui` / `text-ui-lg`）。**禁止散写任意值** `text-[11px]`。如需新字号，先在 config 增加 token。
- 尺寸：避免散写 `h-[17px]` 一类任意值；高频尺寸应抽进 config token（后续逐步收敛）。
- 圆角：默认 2–4px，使用 `rounded-sm/md/lg`（映射自 `--radius`）。
- 遵守 TECH_STACK 的 UI 约束：紧凑工具风格、主字号 12–13px、阴影从简、边框/灰阶优先，禁止大留白与装饰背景。

## 8. 命名约定

- 文件：组件文件用 `kebab-case.tsx`（如 `file-tree-row.tsx`）；hook 文件 `use-xxx.ts`。
- 组件：`PascalCase`；hook：`useCamelCase`；变量 / 函数：`camelCase`；常量：`UPPER_SNAKE_CASE` 或模块级 `camelCase` 常量。
- 类型 / 接口：`PascalCase`，不加 `I` 前缀。
- 事件处理函数：`handleXxx`；传入 props 的回调：`onXxx`。
- Tauri command（Rust）：`snake_case`，前端 `invoke` 字符串与之一致。

## 9. 工程化与脚本

| 脚本                 | 说明                                  |
| -------------------- | ------------------------------------- |
| `pnpm dev`           | 启动 Vite 开发服务器                  |
| `pnpm build`         | `tsc` 类型检查 + Vite 构建            |
| `pnpm lint`          | ESLint 检查（flat config，ESLint 9）  |
| `pnpm lint:fix`      | ESLint 自动修复                       |
| `pnpm format`        | Prettier 格式化                       |
| `pnpm format:check`  | Prettier 校验（CI 用）                |
| `pnpm typecheck`     | 仅 `tsc --noEmit`                     |
| `pnpm test`          | Vitest 单测 + 组件测试                |
| `pnpm test:coverage` | Vitest 覆盖率报告 + 基线门禁          |
| `pnpm test:e2e`      | Playwright 浏览器 E2E                 |
| `pnpm test:rust`     | Rust 后端测试                         |
| `pnpm check`         | 类型、lint、测试、覆盖率、构建检查    |
| `pnpm check:all`     | `check` + Rust 测试 + E2E             |
| `pnpm ci:quick`      | 本地快速 CI：前端静态校验、测试、构建 |
| `pnpm ci:full`       | 本地完整 CI：`ci:quick` + Rust + E2E  |

- 提交前应保证 `pnpm check` 通过；涉及 Rust 或 E2E 的变更需同时跑 `pnpm test:rust` / `pnpm test:e2e`。
- 当前覆盖率门禁以全量 `src/**/*.{ts,tsx}` 为口径，先按现有基线防回退；新增测试后逐步上调到 80%~90%。
- 当前本地 CI 以 macOS 为执行环境；Windows 不视为无需支持，后续在 Windows 机器上单独补路径、权限、窗口和 UI 差异验证。
- 不提交 `console.log` / `console.warn`（调试除外，需在提交前清理）；ESLint 对其告警。

### 覆盖率目标

- React 页面 / App 装配层：目标约 40%，重点依赖 E2E 验证关键用户流程。
- 核心文件能力（编辑保存、大文件打开、文件树整理、重命名 / 移动 / 复制 / 删除）：目标 80%~90%，同时覆盖成功路径、异常路径和边界条件。
- 纯工具函数 / 核心算法：目标 ≥ 95%，优先用单测覆盖分支和边界输入。

覆盖率只说明测试执行到了代码，不说明业务场景已经完整。核心能力变更除覆盖率外，还应补充场景清单：正常路径、失败路径、边界输入、平台差异、并发 / 重入、权限和大文件压力。

## 10. Rust / Tauri

- Tauri command 使用参数数组执行外部进程，禁止拼接 shell 字符串。
- 错误向前端返回结构化信息（kind + message），不返回裸字符串。
- `pnpm test:rust` / `cargo test` 应通过；后续补 `cargo clippy` / `cargo fmt --check`。
