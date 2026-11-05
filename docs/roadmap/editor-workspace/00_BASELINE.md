# MdStudio v0.3.0 路线基线审计

审计日期：2026-11-04（Asia/Shanghai）

审计目标：在现有 v0.2.0 多格式只读阅读器上增量建设文件夹工作区与轻量 Markdown 编辑能力，不替换当前阅读主线。

## Git 与版本基线

- 审计开始时分支为 `main`，HEAD `787a3f0`（`ci: split Windows installer artifacts`），精确对应 `v0.2.0`，工作树干净。
- `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 声明版本均为 `0.2.0`。
- P1 实施没有变更版本号、发布标签或多格式路线状态。

## 真实接入情况

| 模块 | 审计结论 |
|---|---|
| `src/app/App.tsx` | 当前主流程。维护多格式 tabs、打开/去重、阅读位置、搜索、目录、历史、恢复、watcher、导出和 Viewer 生命周期。约 2,700 行；本阶段只加工作区状态和回调，不重构。 |
| `src/components/editor/CodeMirrorEditor.tsx` | 存在于源码，但未被当前运行组件导入；依赖的 `@codemirror/*` 不在 `package.json` 和 `pnpm-lock.yaml`。不是已接入编辑器。 |
| `src/components/editor/MarkdownPreview.tsx` | 历史组件，未接入 App；不得据文件存在判定实时预览已实现。 |
| `src/components/editor/MilkdownEditor.tsx` | 历史组件，未接入 App；Milkdown/ProseMirror 未安装。与本次 P1 无关，保留文件。 |
| `src/components/sidebar/FileTree.tsx` | 原实现读取递归完整树且未在 App 使用。本次用其建立按需展开的工作区树；不调用旧递归 Rust API。 |
| `src/features/documents/session.ts`、`merge.ts` | 文档编辑会话与合并算法在主阅读器没有调用点；属于历史/未接入代码。本次不复用编辑保存能力。 |
| `src-tauri/src/services/files.rs` | `services/mod.rs` 未注册，相关 Tauri commands 未注册。含旧 Markdown 保存及递归 Markdown-only 树读取；本次不注册、不直接暴露。 |
| `src-tauri/src/services/documents.rs` | 现行类型检测/文档路径检查服务，支持 Markdown、PDF、OFD；由当前打开流程使用。 |
| `src-tauri/src/services/mod.rs`、`commands.rs`、`lib.rs` | P1 新增专用 `workspace` 服务及三个命令，显式注册。文件内容仍通过既有 `load_reader_document` / PDF / OFD adapter 流程打开。 |
| Tauri dialog | `@tauri-apps/plugin-dialog` 2.8.2 已安装，`dialog:allow-open` 已授权；现有单文件、多选打开入口保留。新增目录选择调用原生 `open({directory:true,multiple:false})`。 |
| 依赖 | `package.json` 已有 React 19、Tauri API 2.12、PDF.js、OFDRW UI；CodeMirror 与 Milkdown 缺失。本阶段无新增依赖，不改 lockfile。 |

## 现有主调用链（必须保护）

- 单文件/多选：顶部 `+` 或首页按钮 → Tauri Dialog → `openDocuments(paths, source)` → `DocumentAdapterRegistry` 识别/规范路径 → 按 canonical path 去重并激活 tab → Markdown/PDF/OFD adapter → 对应 Viewer。
- 系统打开/启动参数/单实例：Rust `lib.rs` 启动参数与平台事件、single-instance plugin → `enqueue_open_file` → `mdstudio:open-file`/pending queue → App 监听 → `openDocuments`。
- 拖放：Tauri webview drag/drop → `documentAdapters.knownTypeForPath` 过滤 → `openDocuments`。
- Markdown：Rust `load_reader_document` → `services/reader.rs` Comrak AST/HTML 清洗/资源注册 → React reader article → 公式/图片/Mermaid 后处理。
- PDF/OFD：各自现有 reader adapter 及受控 IPC → `PdfViewer` / `OfdViewer`；仍是只读。
- 文件监听：Rust `watcher.rs` → `mdstudio:file-change` → App 活动 tab 重载、非活动 tab stale、删除时保留最后读取内容。
- 最近文件/恢复/阅读位置：`features/reader/preferences.ts` localStorage 持久化路径和位置 → App 初始化恢复 → `openDocuments`；不缓存正文。
- 搜索/目录/历史：按当前活动 tab capabilities 选择；Markdown 目录、跨标签搜索状态、章节导航历史保持原实现。
- PDF 导出：App → `export_reader_pdf` → `services/pdf_export.rs`。多格式路线仍记录 macOS 长时间阻塞后报失败；本阶段未触碰，也未宣称修复。

## 文件扩展限制位置

当前活动打开入口由 `DocumentAdapterRegistry` 和 Rust `documents::document_type` 覆盖 `.md/.markdown/.pdf/.ofd`。系统关联、拖放、选择器也沿用这些格式。历史 `files.rs` 保存/树逻辑仅 Markdown，且未注册。本阶段目录树使用 `documents::document_type` 过滤文件，不建立第二个内容读取器。

## 多格式路线边界

`docs/roadmap/multi-format/PROJECT_STATUS.md` 仍为 `current_phase: P6-B`、`status: blocked`。已知 OFD 中文字体/样本/图像兼容性和跨平台缺口保持原样；新路线不覆盖、不继承为通过。P1 的 `awaiting_acceptance` 仅代表本路线的文件夹工作区交付等待验收。
