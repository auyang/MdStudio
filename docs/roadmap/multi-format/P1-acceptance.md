# P1 — 共用文档核心验收记录

复核日期：2026-11-03  
应用版本：0.1.9（未改版本号）  
阶段状态：`accepted`（用户于 2026-11-03 验收）  
范围：Document Core；只接入 Markdown，不实现 PDF/OFD 渲染。

## 已交付

1. `src/features/documents/core/types.ts` 定义 `markdown`、`pdf`、`ofd`，能力集合、文档描述符、`MarkdownPosition | PagedPosition` 判别联合、泛型 session/adapter 类型及扩展名类型检测。
2. `registry.ts` 检查适配器/扩展名重复映射并分离“已知格式”和“已注册 reader”。当前只注册 Markdown；PDF/OFD 明确提示“格式已识别但当前版本未启用阅读器”。
3. `workspace.ts` 复用既有 `ReaderTabsState<TPayload>`，不复制 tab reducer。既有 canonicalPath 去重、激活历史、关闭回退行为保留；tab 上增加 `documentType` 与泛型 `session`。
4. Markdown adapter 委托原来的 `load_reader_document` 与图片 token release。关闭 session 幂等；关 tab、替换旧 payload、以及加载完成时 tab 已关闭/请求已过期，都会请求资源释放。
5. Rust `services/documents.rs` 集中扩展名识别、canonical path、普通文件/元数据验证及缺失 Markdown 路径恢复；`inspect_document_path` 不读取 PDF/OFD 内容。
6. `reader::load_document` 通过统一的 Markdown 路径验证后才进入 Comrak。PDF/OFD 输入在 parser 前拒绝。前端拖入 PDF/OFD 时只检查类型并显示未启用提示，不创建伪 reader tab，也不会调用 `load_reader_document`。
7. `preferences.ts` 迁移 V1 设置/会话/最近文件/阅读位置到 V2；V2 保留 `documentType` 元数据。旧 V1 key 继续镜像写入；双写失败时尽力回滚 V2；损坏 V2 会备份并从 V1 恢复。新增回滚镜像断言。
8. `App.tsx` 继续作为既有阅读器组合根；将独立的欢迎首页与 tab 加载/错误状态提取到 `ReaderEntryState.tsx`。AppHeader、SettingsDialog、MediaViewer、搜索高亮、Mermaid 等既有组件继续复用，未重构主 Markdown 流程。
9. 没有新增第三方依赖；现有 CSS/品牌变量和布局保持。没有需要新增控件的场景，因此未接入 shadcn/ui。

## 自动化结果

最终重跑（本机 macOS 当前工作树）：

| 命令 | 结果 | 备注 |
|---|---|---|
| `pnpm test` | 通过：17 个测试文件、140 项通过，0 失败；Vitest 22.07 秒，命令墙钟 23.59 秒 | 覆盖启动待开文件、Markdown 打开/渲染、拖放/文件变更、搜索/目录/公式/Mermaid/Viewer，以及 adapter/PDF-OFD 禁用、session 清理、tab 多类型字段、V1/V2 镜像兼容。 |
| `pnpm build` | 通过；TypeScript 检查和 Vite 8.3.5 构建成功，Vite 构建 1.44 秒，命令墙钟 3.87 秒 | 既有 4 条 CSS `::highlight(...)` 识别警告；最大 bundle chunk 593.07 kB（未压缩）并有大 chunk 警告。 |
| `cd src-tauri && cargo test --locked` | 通过：32 项通过、0 失败；Rust 测试 0.80 秒，命令墙钟 2.45 秒 | 包括扩展名大小写识别、路径检查和 PDF/OFD 在 Markdown parser 前拒绝；源文档只读、图片/链接安全与 watcher 过滤回归通过。 |

本次在 P0 人工验收后重新完整执行三条验收命令，均退出码为 0。全量测试结果为 140 项前端测试与 32 项 Rust 测试通过。

## 尚未验证与限制

- 未运行 Tauri `.app` 打包或桌面窗口实测；Windows/Linux 未构建/运行。启动待开文件、拖放、文件变化监听在自动化中覆盖，但实际 OS 关联和系统单实例行为仍待桌面验收。
- PDF/OFD 只完成类型与路径元数据检查；无字节读取、解析、搜索、分页、viewer、格式 file association 或相应 tab session。
- `docs/PROJECT_STATUS.md` 中既有 macOS Markdown→PDF 导出冻结/失败问题仍未解决，P1 未改其链路。

## 主要变更文件

- 新增：`src/features/documents/core/types.ts`、`registry.ts`、`workspace.ts`、`registry.test.ts`、`src-tauri/src/services/documents.rs`、`src/components/reader/ReaderEntryState.tsx`。
- 修改：`src/features/reader/tabs.ts` 及测试、`src/features/reader/preferences.ts` 及测试、`src/app/App.tsx` 及测试、`src-tauri/src/commands.rs`、`src-tauri/src/lib.rs`、`src-tauri/src/services/mod.rs`、`reader.rs`、`watcher.rs`、`src/features/i18n.tsx`。
- 文档：本报告、`PROJECT_STATUS.md`。

## 验收结论

P1 Document Core 和 Markdown 接入已完成；自动测试与前端构建通过。用户已验收 P1，当前不自动进入 P2。真实 Tauri/跨操作系统验证仍未执行，作为已记录限制保留。
