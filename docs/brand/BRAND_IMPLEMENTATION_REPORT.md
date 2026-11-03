# MdStudio 品牌集成报告 BRAND-01

```yaml
brand_task: BRAND-01
phase: B5
status: awaiting_acceptance
next_action: user_visual_review
```

## 执行结论

- B0–B4 已落地；B5 的代码检查、测试和 macOS `.app` 构建通过。
- 实际启动打包后的 MdStudio，并通过 CUA 采集、在本会话显示欢迎页、浅色/深色所见即所得、深色源码、深色分栏和窄窗口分栏界面截图；模式切换后原始中文示例内容与保存状态保持正常。
- **实机截图已在本会话输出，但未归档为仓库 PNG 文件**。已尝试 `screencapture -x`，系统返回 `could not create image from display`；CUA 的截图接口只将图像输出到会话，不提供文件写入接口。`docs/brand/screenshots/` 中目前只有图标尺寸对照图。
- 任务按要求停在 `awaiting_acceptance`，没有进入 P2 或实施 AI/分享功能。

## B0 工程与资源盘点

- 现有工程为 Tauri 2 + React 19 + TypeScript + Vite；Milkdown、CodeMirror、多标签、工作区文件树、文档大纲、明暗主题和本地文件安全机制均沿用。
- Tauri `productName` 已为 `MdStudio`，稳定 `identifier` 为 `com.mdstudio.desktop`；两项保持不变。
- 主题入口为 `src/styles.css`，界面入口为 `src/app/App.tsx`，应用图标位于 `src-tauri/icons/`。
- 参考图与规范资产均已读取。工程有 Git 元数据，当前 `main` 没有任何提交且所有文件均为未跟踪状态，因此没有已提交基线可供 diff；本次未暂存、提交、重置或清理，也未覆盖用户 Markdown 文档。

## B1 Design Tokens 与主题

- 在 `src/styles.css` 建立品牌语义变量：海军蓝 `#0F172A`、品牌蓝 `#3B82F6`、青色 `#06B6D4`、淡紫 `#A78BFA`、浅灰 `#E5E7EB`、暖白 `#F8FAFC`。
- 增加有对比度的操作蓝 `#2563EB` / hover `#1D4ED8`；白字主按钮用操作蓝，不用 `#3B82F6`。
- 浅色和深色主题映射到同一组语义变量；保留警示、危险、选中、焦点环的可读颜色。
- 英文字体栈以 Inter 优先，中文回退系统字体；没有捆绑 Inter 字体文件。阅读正文改用品牌 sans-serif 栈，代码字体保留等宽回退。
- 已计算主要色对比：白底白字按钮所用操作蓝 `#2563EB` 为 5.17:1；浅色次级文字 `#64748B` / `#F8FAFC` 为 4.55:1；深色正文 `#CBD5E1` / `#111D30` 为 11.39:1。

## B2 Logo 与 App Icon

### 交付资产

- `src/assets/brand/logo-symbol.svg`
- `src/assets/brand/logo-horizontal-light.svg`
- `src/assets/brand/logo-horizontal-dark.svg`
- `src/assets/brand/logo-symbol-mono-dark.svg`
- `src/assets/brand/logo-symbol-mono-light.svg`
- `src/assets/brand/app-icon-master.svg`
- `src/assets/brand/app-icon-master.png`（1024 × 1024）
- `src-tauri/icons/` 下由 `pnpm tauri icon` 生成的 PNG、ICNS、ICO、Android 与 iOS 图标
- 小尺寸对照：`docs/brand/screenshots/logo-icon-size-comparison.png`

Logo 依据用户选择的参考裁切图人工重绘成 SVG；**不是从参考图恢复或提取原始矢量**。重绘保留蓝青几何 M、浅色纸张、右上蓝色折角和深色 I 型光标。页纸渐变与 M 曲线是近似描摹，和原图会有少量几何/渐变差异；水平组合的字标是 SVG 文本而非轮廓字形。需由用户做最终视觉验收。

已查看 PNG 母版与 Tauri 输出的 16、24、32、64、128、256px 效果；各尺寸仍能辨识 M、折角和 I 型光标。对照图展示浅色及深色背景。

## B3 编辑器 UI 品牌化

- `src/app/App.tsx` 的顶栏和欢迎页接入独立图形标志；欢迎页显示 `AI 时代的 Markdown 编辑工作台`、`MdStudio` 和 `Write · Read · Create with AI`。
- 口号作为品牌愿景展示；P1 仍标明当前阶段，本次没有增加 AI 或分享操作入口。
- 现有文件菜单、搜索、主题/设置、工作区、新建/打开/保存、标签、所见即所得/源码/分栏、TOC 与冲突保护逻辑未修改。
- 打包应用实际打开 `tests/fixtures/中文示例.md`，截图中显示中文、加粗/斜体/行内代码、待办列表、表格、标签、保存状态和大纲。源码与分栏模式也显示同一文档内容及实时预览；未编辑或保存该 fixture。
- 实机截图由 CUA 在本会话显示（欢迎页、浅色/深色所见即所得、深色源码/分栏、窄窗口分栏）；截图没有写入 `docs/brand/screenshots/`。图标尺寸对照 PNG 已在项目中。
- 已增加 About 页面，展示产品定位、版本、Milkdown/CodeMirror 技术栈及当前阶段；最终包的设置菜单打开 About 已实机检查。

## B4 Tauri 元数据与平台图标

- `productName: MdStudio` 和 `identifier: com.mdstudio.desktop` 已核对并保留。
- 已替换 Tauri 配置引用的应用图标以及 Android/iOS 输出资产；桌面 bundle 配置和发布标识不变。
- 本机 macOS `.app` 已重新构建并实际运行。Windows/Linux 运行时图标没有在本机实测。

## B5 检查与构建结果

| 命令 / 检查 | 结果 |
| --- | --- |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | 通过 |
| `cargo check --manifest-path src-tauri/Cargo.toml` | 通过 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 通过：最终 P2 共 7 项测试（此前 P1 基线为 3 项） |
| `pnpm exec tsc --noEmit` | 通过 |
| `pnpm test` | 通过：最终 P2 共 16 项测试（此前 P1 基线为 6 项） |
| `pnpm build` | 通过；Vite 报告 Milkdown 编辑器 chunk 大于 500 KB（仍为动态加载） |
| `pnpm tauri build --bundles app` | 通过；最终生成 macOS arm64 `MdStudio.app`，11.40 MiB |
| `pnpm tauri dev` | 开发服务器因沙箱拒绝监听 `127.0.0.1:1420`（`EPERM`）未启动；改为实际运行上述打包 `.app` 做界面检查 |

### B5 视觉验收状态

| 用例 | 本轮状态 | 说明 |
| --- | --- | --- |
| V-01 浅色 Logo | 已检查 | 实际欢迎页和顶栏展示，M/纸张折角/I 光标清晰 |
| V-02 深色 Logo | 已检查 | 深色主题实机图中彩色图形与深色字标可辨；独立深色 lockup 与单色 SVG 已产出 |
| V-03 16/32px 图标 | 已检查 | Tauri ICO/PNG 及 16–256px 对照图可见 |
| V-04 浅色编辑器 | 已检查 | 浅色实机图显示中文示例、文件树、标签、大纲和状态栏 |
| V-05 深色编辑器 | 已检查 | 深色实机图中正文、按钮、边框、列表和表格可读 |
| V-06 WYSIWYG | 已检查 | 深浅主题下均显示示例文档；本轮未修改内容，P1 回归记录包含编辑与保存验证 |
| V-07 Source | 已检查 | 深色源码实机图显示 Markdown、高亮行号和中文内容；未在本轮输入或保存 |
| V-08 Split | 已检查 | 深色实机图显示 Markdown 源码和对应实时预览；两侧均呈现中文、待办和表格 |
| V-09 窄窗口 | 已检查 | macOS 半屏窗口下分栏内容正常换行；文件树和大纲均可折叠/恢复，大纲在窄视口自动隐藏；原文保持已保存 |
| V-10 外部修改冲突 | 代码未变 | Rust 冲突保护单测通过；本轮未重复桌面冲突操作 |

## 改动文件范围

- 前端：`src/styles.css`、`src/app/App.tsx`、`src/vite-env.d.ts`
- 品牌源资产：`src/assets/brand/`（6 个 SVG 与 1024px PNG）
- Tauri 平台图标：`src-tauri/icons/`（Tauri 官方工具生成的图标文件）
- 截图资产：`docs/brand/screenshots/logo-icon-size-comparison.png`；欢迎页、编辑器与窄窗口实机截图已在本会话 CUA 输出中，没有归档为文件。
- 文档：本报告及 `docs/PROJECT_STATUS.md` 中的 BRAND-01 状态段。

## 验收前待处理

1. 用户检查本会话展示的实际品牌界面及 Logo 重绘差异。
2. 实机截图已在本会话输出；如需项目内可下载的 PNG 文件，仍需将 CUA 输出图像另行归档到 `docs/brand/screenshots/`。当前截图接口不支持文件写入，`screencapture` 也无法从显示会话读取图像。

当前品牌任务状态：`awaiting_acceptance`；MdStudio 项目已进入 P2，完整项目状态见 [`docs/PROJECT_STATUS.md`](../PROJECT_STATUS.md)。本轮 P2 实机截图也通过 CUA 在会话中显示，但不能写盘归档；macOS `screencapture` 对当前显示会话返回 `could not create image from display`。P2 各项验收覆盖见 [`docs/P2_ACCEPTANCE_REPORT.md`](../P2_ACCEPTANCE_REPORT.md)。
