# 多格式阅读器 P0：当前基线审计

审计日期：2026-11-03（Asia/Shanghai）  
审计范围：现有源码、配置、测试和多格式候选依赖；本阶段没有实现 PDF/OFD 阅读功能。  
产品基线：MdStudio v0.1.9，只读 Markdown 桌面阅读器。

## 结论

当前项目的真实主阅读链仍是 **Tauri 2 + Rust + React/TypeScript + Comrak** 的只读 Markdown 阅读器。PDF/OFD 阅读器尚未接通。当前工作树里有先前开发留下的未提交多格式骨架：TypeScript 文档类型/adapter/session/workspace、Markdown adapter，以及 Rust 路径类型检查命令；这部分只会识别 PDF/OFD 类型并给出“阅读器未启用”，不解析 PDF/OFD 内容，也没有启用它们的系统文件关联。

Markdown 的打开、渲染、安全处理、搜索、目录、标签、恢复和文件监听均沿用现有路径。现存 Markdown→PDF 导出是独立功能，其 macOS 桌面报告明确记录长时间阻塞并最终返回失败；本次没有运行 PDF 导出，**不得把它判定为已修复**。

## Git 基线与改动保护

审计开始时：分支 `reader-mvp`，HEAD `f6e82f0`，与 `origin/reader-mvp` 同步。工作树有 27 个状态项，均已在本次审计前存在；以下内容不做清理、暂存、覆盖或回滚：

```text
 M src-tauri/src/commands.rs
 M src-tauri/src/lib.rs
 M src-tauri/src/services/mod.rs
 M src-tauri/src/services/reader.rs
 M src-tauri/src/services/watcher.rs
 M src/app/App.test.tsx
 M src/app/App.tsx
 M src/features/i18n.tsx
 M src/features/reader/preferences.test.ts
 M src/features/reader/preferences.ts
 M src/features/reader/tabs.test.ts
 M src/features/reader/tabs.ts
?? brand/reference/
?? docs/brand/
?? docs/roadmap/
?? docs/tasks/
?? legacy/
?? src-tauri/src/services/documents.rs
?? src/components/editor/
?? src/components/reader/ReaderEntryState.tsx
?? src/components/sidebar/
?? src/components/ui/
?? src/features/documents/
?? tests/fixtures/media-viewer/
?? tests/fixtures/mermaid/
?? tests/fixtures/navigation/
?? tests/fixtures/reader-mvp/
```

这份清单是本轮 P0 执行前快照。尤其要注意：源码改动、`brand/`、`legacy/`、`docs/tasks/` 和 `docs/roadmap/` 都不是本轮新建，也不应因“尚未跟踪”而删除。本轮仅更新用户明确指定的六份 P0 文档；不改 App.tsx、Rust 源码、依赖、lockfile 或版本号，不暂存/提交 Git。其余既有未提交内容保持原样。

## 项目版本与依赖

`package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 当前声明版本均为 `0.1.9`。当前安装解析版本由 `pnpm list --depth=0` 和锁文件核对：

| 层 | 关键依赖 | 声明版本 | 当前解析版本 |
|---|---|---:|---:|
| 前端 | React / React DOM | `^19.3.0` | `19.3.1` |
| 前端 | Tauri API / CLI | `^2.12.3` / `^2.12.2` | `2.12.4` / `2.12.4` |
| Markdown | Mermaid / KaTeX / DOMPurify | `11.15.0` / `0.16.47` / `3.4.17` | 同声明版本 |
| 构建 | TypeScript / Vite / Vitest | `~5.9.3` / `^8.3.0` / `^4.1.0` | `5.9.3` / `8.3.5` / `4.1.12` |
| Rust | Tauri / Comrak / Ammonia | `2.12.3` / `0.54.0` / `4.2.3` | `2.12.5` / `0.54.0` / `4.2.4` |
| Rust | `tauri-plugin-single-instance` | `2.5.4` | `2.5.4` |

`pdfjs-dist` 与 OFDRW UI/Engine 均未安装。P0 没有增加依赖。候选版本、API、许可证与联网核查限制见 [02-compatibility-matrix.md](02-compatibility-matrix.md)；在线网页快照不能替代安装前对 npm registry、tarball 与 lockfile 的核验。

## 当前实现清单

| 能力 | 当前代码 | 审计结论 |
|---|---|---|
| 文件选择、多选/批量打开、拖放 | `src/app/App.tsx`、`AppHeader.tsx`、Tauri dialog | Markdown 已接通。当前工作树也能识别 PDF/OFD 并提示未启用；不等于阅读。 |
| 系统打开、启动参数、单实例二次打开 | `src-tauri/src/lib.rs`、`commands.rs`、`tauri.conf.json` | 启动参数、macOS `Opened`、single-instance callback、系统关联都仅允许 `.md/.markdown`。 |
| 标签、多文档去重、状态恢复 | `src/features/reader/tabs.ts`、`preferences.ts`、`App.tsx` | 已实现；当前未提交改动扩展了 document type/session 结构和 V2 持久化，但只恢复 Markdown。 |
| Markdown 解析 | `src-tauri/src/services/reader.rs` | Comrak AST；GFM 表格、任务列表、删除线、Front Matter、数学扩展；Syntect 高亮。 |
| HTML 与资源安全 | `reader.rs`、`commands.rs`、Tauri CSP | Comrak unsafe 关闭，Ammonia 清洗；本地相对链接/图片受路径边界检查。 |
| 搜索、TOC、导航 | `src/features/reader/`、`App.tsx` | 跨正文文本搜索、每标签搜索状态、目录、章节高亮、位置记忆、前进/后退。 |
| Mermaid、公式、图片 Viewer | `src/components/reader/`、`App.tsx` | Mermaid 与 KaTeX 本地按需加载，源码/错误回退、缩放 Viewer、图片相对资源。 |
| 外部修改监视 | `src-tauri/src/services/watcher.rs`、`App.tsx` | native watcher 与轮询、去抖、活动标签刷新/非活动标签 stale、删除后保留最后内容。 |
| 最近文件、设置、国际化 | `preferences.ts`、`src/features/i18n.tsx` | localStorage；英语、简体中文、日语；不持久化文档内容。 |
| Markdown→PDF 导出 | `App.tsx`、`commands.rs`、`services/pdf_export.rs` | macOS/Windows 分平台原生打印代码；macOS 交互仍有未解决的阻塞与失败报告。 |
| PDF/OFD 阅读 | `features/documents/core`、`services/documents.rs`（未提交骨架） | 类型/路径检查及 adapter 插槽；没有 PDF/OFD reader、字节解析或 viewer。 |

`src-tauri/src/services/mod.rs` 当前实际注册 `documents`、`pdf_export`、`reader`、`watcher`。仓库中另有未注册的旧 `files.rs` / `store.rs` 代码；它们不能被当作现行 PDF/OFD 阅读实现，也不得在本阶段删除。

## 必须保护的 Markdown 能力与回归素材

- 打开入口、OS 默认程序优先级（Alternate 文件关联）、启动参数、单实例、拖放、多标签、路径去重、相对 Markdown 新标签打开。
- CommonMark/GFM、Front Matter、任务列表、表格、代码语言与 Syntect 高亮、危险 HTML/URL 清洗。
- 中文和空格路径的相对图片/链接、资源不存在提示、图片按需加载与放大 Viewer。
- Mermaid AST 源码、异步图表、渲染错误回退、源码查看/复制、放大查看/平移/适应窗口。
- Comrak 数学节点、KaTeX 行内/块级公式、多行公式、错误源码回退、源码复制、本地字体。
- 搜索匹配/定位、目录锚点、长目录虚拟化、章节高亮、跨文档/章节前进后退。
- 刷新、外部修改/删除状态、每标签阅读位置/搜索状态、最近文件、会话恢复、主题/字号/阅读宽度和三种 UI 语言。
- 源 Markdown 与图片保持只读；离线资源完整；窗口/标签切换不串文档状态。

自动化素材当前分布于 `tests/fixtures/reader-mvp/`、`tests/fixtures/mermaid/`、`tests/fixtures/math/`、`tests/fixtures/search/`、`tests/fixtures/navigation/`、`tests/fixtures/media-viewer/`。本轮回归结果见 [04-test-plan.md](04-test-plan.md)。

## PDF 导出问题：必须保留为未解决

`docs/TEST_REPORT.md` 记录 macOS 导出时输出 PDF 内容正确，但打印流程约 120 秒后落盘，应用期间无法正常操作，前端随后仍显示失败。`src-tauri/src/services/pdf_export.rs` 使用 WKWebView `NSPrintOperation` 回调和 120 秒 `recv_timeout`；Windows 使用 WebView2 `PrintToPdf` 并有同样的等待上限。源码能够确认等待/回调结构，不能单独证明冻结的唯一根因。本轮只读审计，没有实际触发打印，也没有修复或验证该问题。Windows 的运行行为在项目报告中未实机验证。

## P0 结果与回滚

按要求运行的 `pnpm test`、`pnpm build`、`cd src-tauri && cargo test --locked` 均退出码为 0。当前工作树自动化通过不代表桌面、多平台或 PDF 导出交互验收通过。完整输出摘要在 [04-test-plan.md](04-test-plan.md)。

若撤销本次文档审计，只回滚本次更新的六份 `docs/roadmap/multi-format/` 文件；不要对整个 `docs/roadmap/` 执行删除，不要使用 `git clean`、强制 reset 或覆盖其他未提交内容。
