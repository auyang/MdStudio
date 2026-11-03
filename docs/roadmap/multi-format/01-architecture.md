# 当前架构与调用链

审计日期：2026-11-03。以下以本机实际源码为准。当前工作树存在审计前已有的未提交多格式类型/adapter 骨架，但实际文档读取与展示仍只走 Markdown reader；P0 未改源码。

## 组件边界

```text
Tauri 2 / Rust
  lib.rs                 启动参数、单实例、macOS Opened、命令注册
  commands.rs            IPC 边界、路径标准化、资源 token、文件 watcher/PDF 导出命令
  services/reader.rs     Markdown 文件验证、Comrak + Syntect、HTML 清洗、资源解析
  services/watcher.rs    文档目录 watcher、轮询、去抖和变化事件
  services/pdf_export.rs Markdown 阅读视图的打印导出（不是 PDF 阅读器）
  services/documents.rs  [未提交] 文档扩展名/本地路径描述符检查，不解析 PDF/OFD

React / TypeScript
  src/app/App.tsx                    打开/恢复/切换/渲染/搜索/目录/刷新/导出编排
  components/layout/AppHeader.tsx    单行顶部栏、标签、阅读操作入口
  features/reader/                   tab、设置持久化、搜索、位置与导航状态
  features/documents/core/           [未提交] 类型/adapter/session/workspace 骨架
  components/reader/                 Markdown、Mermaid、KaTeX、图片与通用 Viewer
```

## 文件打开调用链

```text
工具栏 + / Cmd/Ctrl+O / 文件选择器多选 / 拖入文件 / Markdown 相对链接 / 最近文件
  -> App.openDocuments(paths, source)
  -> 当前工作树的 registry 从扩展名判断 document type
       PDF/OFD: invoke inspect_document_path，只拿类型和本地路径元数据，显示未启用提示后结束
       Markdown: 进入既有阅读加载路径
  -> invoke normalize_reader_path
  -> commands::normalize_reader_path
  -> reader::normalize_markdown_path：canonicalize + Markdown 路径校验
  -> addOrActivateTab：按 canonicalPath 去重；已开则激活
  -> App.loadReaderTab
  -> 当前 Markdown adapter.open -> invoke load_reader_document
  -> commands::load_reader_document：spawn_blocking
  -> reader::load_document
  -> ReaderDocument 返回前端并建立图片资源 token
```

关键位置：`src/app/App.tsx::chooseFile/openDocuments/loadReaderTab/activateTab`、`src/features/reader/tabs.ts::addOrActivateTab`、`src/features/documents/core/registry.ts`、`src-tauri/src/commands.rs::normalize_reader_path/load_reader_document`。

多选和批量拖放由前端打开入口消费。重复 canonical path 不新建第二个 tab。Markdown 相对文档链接先由 Rust 清洗/解析成可控本地路径，再由前端以新 tab 打开。

## 冷启动与单实例打开

```text
应用首次启动：
  lib.rs::startup_markdown_paths
  -> 读取 argv 中现存文件，只接受 .md/.markdown
  -> canonicalize -> PendingOpenFiles
  -> 建立 Tauri app/window 和 single-instance plugin
  -> React 先注册 mdstudio:open-file、mdstudio:file-change、拖放监听
  -> invoke take_pending_open_files
  -> 按偏好恢复上一会话，再处理启动参数队列

已运行时再次打开：
  single_instance::init(args, cwd)
  -> lib.rs::incoming_arguments 解析相对路径、只接受 Markdown
  -> commands::enqueue_open_file
  -> PendingOpenFiles + mdstudio:open-file event
  -> 已存在窗口 show/focus -> React 打开文件

macOS 文件打开：
  Tauri RunEvent::Opened URL
  -> file URL 转路径、is_file、is_markdown_file、canonicalize
  -> enqueue_open_file -> 同一前端打开事件
```

系统 `fileAssociations` 在 `src-tauri/tauri.conf.json` 只注册 `md`、`markdown`，且 role 为 `Viewer` / rank `Alternate`，不主动抢系统默认关联。上述三种 OS/桌面入口现状都只传 Markdown；当前 PDF/OFD 类型检查命令没有接入 CLI 参数/RunEvent 读取。

## Markdown 解析与安全渲染链

```text
App.loadReaderTab
  -> invoke load_reader_document
  -> commands.rs 在 spawn_blocking 运行 reader::load_document
  -> reader.rs 检查扩展名/路径/普通文件/UTF-8/64 MiB 上限
  -> Comrak AST（GFM、Front Matter、math_dollars、math_latex；unsafe=false）
  -> AST 提取标题、Mermaid 源码、公式标记与受限资源
  -> Comrak HTML + Syntect 代码高亮
  -> Ammonia 清洗；链接和图片 URL 再经过 allowlist 与路径边界检查
  -> ReaderDocument { html, headings, mermaidDiagrams, images, ... }
  -> React Markdown 阅读视图挂载正文
  -> 本地 KaTeX / Mermaid 按需渲染；图片通过受限 IPC token 加载
```

数学和 Mermaid 不是独立 Markdown parser：Rust Comrak AST 是源语义，前端组件只消费结构化标记/代码内容。普通 HTML 经 Ammonia 清洗；Mermaid SVG 在组件渲染边界再次过滤；本地相对图片不是任意 asset URL，而由 Rust 返回受限 token 内容。

关键位置：`src-tauri/src/services/reader.rs::load_document`、`commands.rs::load_reader_image/release_reader_image_document`、`src/app/App.tsx` 正文 mount/render effects、`src/components/reader/`。

## 文件监听与刷新链

```text
App 从已打开 tab 提取 Markdown canonical paths
  -> invoke set_reader_watch
  -> commands.rs -> FileWatcherService::set_targets
  -> notify watcher + 8 秒轮询（native watcher 不可用时仍可轮询）
  -> 280 ms debounce + blake3 去重
  -> emit mdstudio:file-change
  -> 活动 tab 自动 reload；非活动 tab 标记 stale；删除/改名标记 missing
```

前端卸载时清理 Tauri event listener；Rust watcher drop 时停止/回收 watcher worker。当前 watcher 校验只接受 Markdown 文件和目标目录。

## 最近文件、会话恢复、阅读位置

```text
preferences.ts loadReaderPersistence(storage)
  -> 读取 mdstudio-reader-persistence-v2；损坏时备份并回退 V1
  -> 验证 settings/session/recents/positions 中的文档类型
  -> App 启动注册桌面监听后恢复 Markdown tabs
  -> loadReaderTab 成功时更新最近文件
  -> 滚动/搜索/tab 更新分别维护运行态状态
  -> debounce 将设置、session、recents、positions 写入 localStorage
```

本地状态里不保存文档正文。当前树中的 V2 结构允许 descriptor 联合类型，但 position 只写 Markdown；PDF/OFD session 恢复尚未有实现。旧 V1 localStorage 兼容仍存在。

## 搜索和目录

搜索从活动阅读 DOM 提取文本节点，按块构建匹配，支持表格/代码区文字；CSS Custom Highlight API 可用时使用命名 highlight，不可用时走高亮层回退。输入防抖，匹配计数/索引绑定到每个 tab，Range 定位后滚动目标。

TOC 使用 Rust 返回的 `headings` 列表；长目录仅渲染可视附近条目。正文滚动更新 active heading、heading offset 和每文档阅读位置。章节与跨文档历史在阅读导航 state 中管理。

## PDF 导出链（非 PDF 阅读）

```text
AppHeader PDF 按钮
  -> App.exportPdf
  -> Tauri dialog save，基于当前 Markdown 文件名建议 .pdf
  -> 等待 Markdown 当前视图的公式、字体、图片、Mermaid 资源就绪
  -> invoke export_reader_pdf
  -> commands::export_reader_pdf -> spawn_blocking -> pdf_export::export
       macOS：with_webview -> WKWebView NSPrintOperation -> modal completion callback
       Windows：with_webview -> WebView2 PrintToPdf async callback
  -> Rust 最长 recv_timeout 120 s -> 成功或超时错误回前端
```

`docs/TEST_REPORT.md` 已记录 macOS 操作中 UI 长时间无响应、约 120 秒才生成文件、最终前端仍报失败。这是一个明确的未解决故障。源码能看到 `NSPrintOperation` 与 120 秒同步 receiver 等待，但不够证明“主线程阻塞”是唯一根因。P0 不运行导出动作，也不做任何修复。

## `.md/.markdown` 限制点与最小修改面

| 层 | 位置 | 当前限制 | 为未来格式演进的最小变更边界 |
|---|---|---|---|
| OS file association | `src-tauri/tauri.conf.json::bundle.fileAssociations` | 仅 md/markdown | 单独增加相应 ext/MIME/role；验证安装包注册而不是仅验证 React picker。 |
| 首次启动参数 | `lib.rs::startup_markdown_paths` | `is_markdown_file` + 只 canonicalize 已存在 Markdown | 改用 descriptor/type policy，再 dispatch 专用 reader；不能把二进制传给 Comrak。 |
| 单实例 callback | `lib.rs::incoming_arguments`、`commands.rs::enqueue_open_file` | 拒绝非 Markdown | 各类型验证路径与权限后发统一 open-request event。 |
| macOS `Opened` | `lib.rs::RunEvent::Opened` | 只接受 Markdown URL | 保持 URL 转路径和 canonicalize，按已注册类型派发。 |
| 选择器/拖放/相对链接 | `App.tsx::chooseFile/openDocuments` 与组件入口 | Markdown 类型过滤；PDF/OFD 当前仅识别/提示 | 做 UI type registry 与 Rust policy 的一致映射；各 reader 使用独立 payload/session。 |
| Rust 输入校验 | `services/reader.rs::normalize_markdown_path/load_document` | 只准 md/markdown，UTF-8 文本、64 MiB | 保留 Markdown reader 不变，另建 PDF/OFD byte reader、格式签名/资源限额检查。 |
| watcher | `services/watcher.rs::is_markdown_or_directory` | 仅监听 Markdown 文档及目录 | 继续监听父目录，事件关联由文档类型 session 处理；不要把二进制内容读入 Markdown watcher。 |
| session/持久化 | `tabs.ts`、`preferences.ts` | 运行态多格式 descriptor，但持久化恢复/位置主要限 Markdown | 每种格式添加经过验证的位置 schema；迁移/损坏回退保留。 |
| 文件类型文本 | `features/i18n.tsx` | 文案按 Markdown | 添加格式/错误提示翻译，不修改现有 i18n key 语义。 |

原则：复用 tab/history/settings 外壳，reader payload 与资源生命周期按格式分离；Markdown Comrak/Ammonia 路径不扩成“任意文件”。P0 不改 App.tsx，也不实现这些未来变更。

## P2 PDF 阅读调用链（当前实现，覆盖 P0 中 PDF 未启用的基线描述）

```text
工具栏选择 / 多文件拖放 / 启动参数 / macOS Opened / 单实例转发 / 最近文件或会话恢复
  -> App.openDocuments(paths, source)
  -> adapter registry 按扩展名识别 PDF
  -> invoke inspect_pdf_document(filePath)
  -> Rust canonicalize + 普通文件/大小/签名验证，返回 canonicalPath、size、mtime
  -> PDF tab 按 canonical path 去重并激活
  -> PdfAdapter.open -> 动态 import pdfjs-dist@6.4.299
  -> getDocument({ range: PDFDataRangeTransport, disableStream, disableAutoFetch, ... })
  -> PDF.js worker 使用 Vite ?url 本地 worker；CMap/fonts/WASM/ICC 从应用资源目录读取
  -> PDFDataRangeTransport 调用 read_pdf_range
  -> Rust 重新验证路径、类型、大小、mtime；以 Raw IPC Response 返回有界字节范围
  -> PdfViewer 连续挂载页容器；共享 IntersectionObserver 仅绘制可见页与 600px 邻近页
  -> PDF.js Canvas 页面 + 官方 TextLayer；单页画布采样预算 4MP，最大 DPR 2
  -> 文字选择/复制；本地文本索引提供搜索匹配并在 TextLayer 文字节点中标记
  -> 页码/缩放/旋转/搜索状态按 tab 维护；会话持久化 PDF 类型和阅读位置
  -> 关闭/替换 tab -> 取消 range 请求与 RenderTask，销毁 PDFDocumentProxy/worker，释放页面画布与 TextLayer
```

Rust range IPC 返回 `tauri::ipc::Response::new(bytes)`，前端以 `ArrayBuffer` 接收，不经过 JSON 数组。每段读取最多 1 MiB，PDF.js 默认用 64 KiB chunk 请求；文件上限 256 MiB。读取期间文件变化、取消、损坏、加密和越界范围均有明确错误路径。PDF reader 仅通过 `documentType === 'pdf'` 分支挂载，Markdown 仍由原 Comrak -> Ammonia -> React 路径打开。

OFD 无 adapter、解析器或渲染器，仍提示格式已识别但 reader 未启用。PDF JavaScript/附件不执行、不提取，不含 OCR。原有 Markdown → PDF 导出链 `pdf_export.rs` 未修改，其 macOS 阻塞和失败问题仍未解决。
