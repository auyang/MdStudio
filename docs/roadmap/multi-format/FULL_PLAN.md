# MdStudio 多格式（Markdown + PDF + OFD）阅读器技术方案与 Codex 执行提示词

> 版本：方案草案 1.0（2026-11-02）  
> 目标项目：https://github.com/auyang/MdStudio  
> 基线：`main` 分支，`package.json` / `Cargo.toml` 均为 `0.1.9`。  
> 项目原则：**渐进式升级、只读离线、保留 Markdown 全能力、阶段验收、禁止自动进入下一阶段。**  
> 注意：这是实施计划，不代表代码已经修改或相应阶段已通过验收。

## 0. 实际源码核对与明确约束

已检查：`package.json`、`README.md`、`docs/PROJECT_STATUS.md`、`docs/TEST_REPORT.md`、`src/app/App.tsx`、`src/features/reader/tabs.ts`、`src/features/reader/preferences.ts`、`src/components/layout/AppHeader.tsx`、`src-tauri/src/{commands,lib}.rs`、`src-tauri/src/services/{reader,files,watcher,pdf_export,store}.rs`、`src-tauri/tauri.conf.json`、`src-tauri/capabilities/default.json`。

- 现有桌面应用为 Tauri 2 + Rust + React 19 + TypeScript + Tailwind CSS 4 + Vite 8，**仓库尚无标准 shadcn/ui 组件目录**。本计划渐进引入 shadcn/ui，不重绘所有界面。
- Markdown 渲染已有 Rust Comrak + Syntect + Ammonia、安全 HTML、本地资源边界；前端 KaTeX、Mermaid、目录、搜索、高亮、阅读进度、双击关闭标签、设置、i18n（中/英/日）等均需保留。
- `src/app/App.tsx` 约 2250 行，相关业务需要逐步迁出；`tabs.ts` 支持泛型 tab 及路径去重。
- Rust `lib.rs` / `commands.rs`、`App.tsx`、`preferences.ts`、`watcher.rs` 等位置存在 `.md/.markdown` 扩展名限制，须通过单一受控类型注册机制升级。
- `docs/PROJECT_STATUS.md` 显示 Reader-P1.9 `blocked`：macOS 原生 PDF 导出可能阻塞，且报告失败。**此导出功能与新增 PDF 查看功能是两件事**；不得以“PDF 能打开”覆盖此缺陷。P6 必须修复或明确隔离并阻止包含故障功能的发布。
- 现有 `pdf_export.rs` 应保留，不能被新阅读器覆盖、误删或重用作 PDF 文件渲染。
- 既有测试基线见 `docs/TEST_REPORT.md`：前端 133 项、Rust 28 项通过（报告日期 2026-11-02）；这是历史基线，Codex 需实际重跑。

## 1. 目标产品与范围

**定位**：MdStudio —— 统一的 Markdown、PDF、OFD 离线只读阅读器。跨平台 Windows/macOS/Linux；文件选择器、拖拽、操作系统双击或“打开方式”；多标签、目录/缩略图、缩放、搜索、阅读位置恢复；保持一致的工具栏和视觉风格。

不做：文档编辑、批注编辑、云服务、账户、在线转换、OCR、AI 助手、PDF 表单编辑、OFD 文件写入、需要外部 Java/JVM 的主路径。

### 1.1 引擎选择

| 格式 | 主实现 | 关键约束 |
|---|---|---|
| Markdown | 原有 Rust Comrak + Syntect + Ammonia，前端 KaTeX/Mermaid | 不重写，不改变已有安全语义 |
| PDF | `pdfjs-dist`（PDF.js） | Worker 本地打包；按需绘制；文本层；离屏资源释放 |
| OFD | `@ofdrw/ofdrw-viewer-ui/react` 初期优先评估；底层 `@ofdrw/ofdrw-viewer-engine` | 首选复用全文查找/缩略图/文本层等成熟封装；设置 `features.toolbar=false` 适配统一工具栏；POC 必须验证 Windows/macOS/Linux、字体、签章及运行时兼容；若包装器不适配，则改为 engine 直接集成，严禁同时维护两套完整 OFD UI |

核对过 OFDRW 官方仓库，`@ofdrw/ofdrw-viewer-ui` 的 `package.json` 目前为 `0.1.7`，有 React 19 示例、`features` 配置可关闭内置 toolbar、`ref` 方法。安装时锁定实际可获取的 npm 版本并确认 license（MIT），不要根据文档版本硬编码未知 API。其 React UI 原生语言主要是 zh-CN 和 en-US，日语壳层不能假设第三方控件已经本地化；需要包装或翻译。

官方参考：
- https://github.com/ofdrw/ofdrw-viewer/tree/main/packages/ofdrw-viewer-engine
- https://github.com/ofdrw/ofdrw-viewer/tree/main/packages/ofdrw-viewer-ui
- https://github.com/ofdrw/ofdrw-viewer/tree/main/examples/viewer-ui-react
- https://mozilla.github.io/pdf.js/getting_started/
- https://v2.tauri.app/reference/config/
- https://docs.rs/tauri/latest/tauri/ipc/struct.Channel.html

## 2. 目标架构

```text
app/App.tsx (composition root; reduce business logic)
  └── features/documents/DocumentWorkspace
        ├── DocumentTabs + DocumentToolbar + Sidebar + SearchBar
        ├── DocumentAdapterRegistry
        │     ├── MarkdownAdapter → original markdown rendering
        │     ├── PdfAdapter      → pdfjs-dist + local worker + canvas/text layers
        │     └── OfdAdapter      → OFDRW viewer-ui/react (headless toolbar)
        ├── DocumentSession (per-tab lifecycle; AbortController / cancellation)
        ├── DocumentCapabilities (search/outline/rotate/print/selection)
        └── Persistence V2 / migration V1 / i18n
  └── Tauri IPC (Rust)
        ├── open_document_metadata: strict filename/header/container validation
        ├── read_document_bytes: raw IPC response / streaming Channel
        ├── existing load_reader_document (Markdown only)
        ├── existing watcher / pending startup opens / single-instance opens
        └── existing export_reader_pdf (legacy export, independent)
```

### 2.1 目录组织（目标态，不要求一次性迁移完成）

```text
MdStudio/
├── docs/roadmap/multi-format/
│   ├── 00-current-baseline.md
│   ├── 01-architecture.md
│   ├── 02-compatibility-matrix.md
│   ├── 03-security-design.md
│   ├── 04-test-plan.md
│   ├── 05-acceptance.md
│   ├── PROJECT_STATUS.md
│   └── prompts/P0-audit.md ... P6-release.md
├── src/
│   ├── app/App.tsx
│   ├── components/
│   │   ├── layout/          (preserve existing)
│   │   ├── reader/          (preserve existing during migration)
│   │   ├── document/        DocumentHost, DocumentToolbar, DocumentTabs, DocumentSidebar
│   │   └── ui/              shadcn/ui components, selectively introduced
│   └── features/
│       ├── reader/          (legacy Markdown state/helpers)
│       ├── documents/       types, registry, workspace, persistence, capabilities
│       ├── markdown/        MarkdownAdapter
│       ├── pdf/             PdfAdapter, PdfViewer, pdfWorker, pdfSearch
│       └── ofd/             OfdAdapter, OfdViewer, ofdCompatibility
├── src-tauri/
│   ├── src/
│   │   ├── commands.rs
│   │   ├── lib.rs
│   │   └── services/
│   │       ├── reader.rs         original Markdown renderer
│   │       ├── documents.rs      new format/path validation
│   │       ├── binary.rs         new binary read/streaming
│   │       ├── watcher.rs        existing watch functionality
│   │       └── pdf_export.rs     original Markdown-to-PDF export
│   └── tauri.conf.json
└── tests/fixtures/{markdown,pdf,ofd,malformed}/
```

### 2.2 接口模型

```ts
export type DocumentType = 'markdown' | 'pdf' | 'ofd';
export type Capability = 'outline' | 'search' | 'textSelection' | 'print' | 'export' | 'rotate' | 'signature';
export type DocumentPosition =
  | { kind: 'markdown'; scrollRatio: number; headingId?: string }
  | { kind: 'paged'; page: number; offsetRatio?: number };

export interface DocumentDescriptor {
  id: string; canonicalPath: string; name: string;
  type: DocumentType; size: number; modifiedAt?: number;
}
export interface DocumentSession {
  descriptor: DocumentDescriptor;
  capabilities: ReadonlySet<Capability>;
  getPosition(): DocumentPosition;
  navigate(position: DocumentPosition): Promise<void>;
  close(): Promise<void>;
}
export interface DocumentAdapter {
  readonly type: DocumentType;
  open(descriptor: DocumentDescriptor, signal: AbortSignal): Promise<DocumentSession>;
}
```

- 其余功能通过独立、类型安全的扩展 controller / capabilities 提供，避免所有 adapter 被迫实现 `search`, `print`, `rotate` 等空方法。
- 大型 PDF/OFD 文件严禁使用 `Vec<u8>` 作为 JSON 数组返回。使用 Tauri `tauri::ipc::Response` 的原始字节返回或 `Channel<InvokeResponseBody>`。前端接收 `ArrayBuffer` 或 `Uint8Array`，明确分块合并/所有权及超时取消；需要按需流式读取时由明确的句柄和 Range API 支持。
- 不要通过任意文件路径 / `file://` / 全局 asset 协议向 WebView 开放整个磁盘目录。
- Tauri 侧路径必须 `canonicalize`，允许通过文件选择器、命令行启动、拖拽、恢复会话等入口。文件头匹配且符合格式约束才接受；PDF `%PDF-`，OFD ZIP/OFD.xml + 关键文件，不依赖扩展名决定内容可信度；避免简单 ZIP 炸弹判定。
- 每个 tab 独立 `AbortController`、异步 generation id 和渲染资源，关闭/切换时清理，防止竞态、内存泄露与跨标签渲染。
- shadcn/ui 采用渐进加入：优先 `Button`, `Tooltip`, `DropdownMenu`, `Dialog`, `ScrollArea`，用现有 Tailwind token 保持 UI，不全量替换历史组件，不引入客户端在线字体。

### 2.3 统一阅读状态与持久化

建议 `settings-v2/session-v2/positions-v2`，加载时优先 V2，若不存在则迁移 V1：先完整读取、验证、归一化，再落盘；迁移失败保留 V1 + 安全默认值。Markdown 旧的 `scrollRatio`, `headingId`, `scrollTop` 仍有效；分页文档记录页码（统一 1-based UI）、缩放模式、页内偏移、旋转（可选）；恢复缺失或损坏文件时平稳降级。

### 2.4 OFD 模块的两条路径

**主路径：Viewer UI React 包装**

- 最小 POC 安装锁定版本 `@ofdrw/ofdrw-viewer-ui`；导入 `@ofdrw/ofdrw-viewer-ui/react` 及 `style.css`。
- `features={{toolbar:false,keyboardShortcuts:false}}` 关闭第三方工具栏与潜在冲突快捷键，按实际类型定义确认。
- 通过 `ref` 控制 `goToPage`, `setScale`, `find`, `print` 等，向 MdStudio DocumentToolbar 映射；启用其内置虚拟滚动、缩略图、文本选择等现有能力。
- 隐藏第三方工具栏并不等于所有功能可通过 API 访问。对不能稳定调用的能力要列出缺口；保留第三方侧栏的项目，应协调 UI 布局并消除双重侧栏/双层滚动。

**备选：Engine 直接适配**

- 如果第三方 UI CSS 冲突、语言受限、外部工具栏控制困难，改用 `@ofdrw/ofdrw-viewer-engine`，API 示例为 `OFDDocument.open({ source:{kind:'blob',blob:file} })`、`doc.getPage(0)`、`page.getViewport({dpi:144})`、`page.render({canvasContext,viewport}).promise`、`doc.close()`。
- 只有在验收确认必要时才自行实现搜索层、缩略图和分页。不得使用引擎本身没有提供的 API 名称。

**注意**：电子印章的外观展示、密码学验签、证书链可信性和时间戳四件事必须分开。验签不能直接等同于法律效力判断；默认只读，不支持修改签章。

## 3. 优先级、阶段与发布闸门

| 阶段 | 目标 | 最低交付物 | 退出条件 |
|---|---|---|---|
| P0 | 现状审计与冻结基线 | 架构/差距/基线/回滚风险文档 | 测试报告、基线 commit、0.1.9 PDF 导出问题记录 |
| P1 | 统一文档核心 | DocumentType/Adapter、读取路径、UI 最小解耦、持久化 V2 | 原有 MD 所有功能和测试不退化，尚不强制打开 PDF/OFD |
| P2 | PDF 查看 MVP | PDF.js、Worker、文本层、分页缩放、搜索、资源释放 | 普通/扫描/多页 PDF 样本可读；MD 测试通过 |
| P3 | OFD 技术 POC | OFDRW Viewer UI/Engine 双方案试验及兼容报告 | 有真实样本结果、明确 go/no-go、不得虚报签章支持 |
| P4 | OFD 查看 MVP | OFD Adapter、页面与搜索/导航、错误回退 | OFD 样本兼容通过；PDF/MD 回归通过 |
| P5 | 统一体验与性能 | 共用工具栏、拖拽/系统文件关联、恢复状态、虚拟渲染、i18n | 三格式流程一致，逐页资源清理有效 |
| P6 | 安全/兼容/发布验收 | 三平台验证、打包、开源许可、回滚手册 | 通过 release gate；现有 PDF 导出故障已修复或功能显式隔离且相关承诺调整 |

建议内部发布为 **0.2.x**，具体版本须在既有 `Reader-P1.9` 阻塞记录及目标完成情况验收后确定。产品“2.0”是方向，不等同于立刻把软件版本改为 `2.0.0`。

**阶段状态格式**：`planned` → `in_progress` → `awaiting_acceptance` → `accepted`；遇到阻塞：`blocked`。Codex **每次只执行用户指定阶段**，进入 `awaiting_acceptance` 后停止，未经确认不得升级阶段状态为 `accepted` 或继续下一阶段。

## 4. 回归验收清单

### 4.1 Markdown 必须保持的旧功能

- 文件选择器、拖拽、系统“打开方式”、冷启动/单实例二次打开、多标签、双击标签关闭。
- GFM/表格/任务列表/引用/代码高亮、本地图片、相对链接、安全 HTML、目录与标题定位、文内搜索/高亮、前进后退、刷新。
- KaTeX 行内及块级公式、多行公式、错误回退、源码复制、按需离线加载。
- Mermaid 图表、放大/平移/缩放、源码查看复制。
- 中/英/日语言、主题、字号、阅读宽度（包括 Fit）、阅读位置恢复、最近文件、设置。
- **原有 MD→PDF 导出功能不能丢失**，其已知阻塞必须在文档中保持显式，不能写作“已通过”。

### 4.2 PDF

- 至少验证：单页文本 PDF、多页文本 PDF、扫描 PDF、中文嵌入字体、旋转页面、带书签、加密 PDF、损坏 PDF、较大 PDF。
- 基础功能：首屏、下一页、目录（若存在）、文本层选择/复制、搜索高亮、缩放、适合宽度/整页、关闭释放、错误可理解、保留上次页码。
- 无文字扫描件应说明“当前不支持 OCR/不可搜索”，不可声称搜索成功。

### 4.3 OFD

- 至少验证：电子发票、电子票据、政务公文、嵌入字体、缺省字体、电子印章、JBIG2/TIFF 等图像、含图层/注解、加密文档、损坏或恶意容器。
- 搜索、复制、缩略图等按实际 engine/UI 能力逐项打勾，不能用 UI 声明代替测试。
- 验签如未接入必须显示“未验证”而非“有效”；不提供错误的法律效力保证。

### 4.4 安全和性能

- 不访问远程 CDN；Tauri CSP 最小化，Worker、WASM 等只开放实际需要的加载源。
- 限制文件字节数、OFD ZIP 条目数、解压总体积与膨胀比、单页 Canvas 像素预算。阈值在 P0/P3 依据样本测试确定，不把临时数字当规范值。
- 未授权目录路径和 ZIP 路径穿越必须被拒绝；敏感文档路径和内容不写入日志/URL 查询参数。
- 多标签连续开关/切换 50 次，关注内存峰值、CPU 占用、卡顿、后台 Worker、缓存与侦听器清理。
- PDF.js worker 和 OFD 依赖资源在 macOS、Windows WebView2、Linux WebKitGTK 上均需实际运行验证。
- 保存 release 候选的基线、依赖许可清单、已知问题与回滚方式。

## 5. Codex 通用执行约束（所有 Prompt 必须继承）

1. 当前工作目录是现有 MdStudio 源码；先 `git status --short`，如有用户未提交修改先识别并保护。禁止强制重置或覆盖。
2. 从当前本地源码分析，不假设所有路径与分支情况与方案完全一致；保留现有代码与许可证。
3. 不推倒重写、不进行跨阶段开发、不新增云服务/账号/OCR/AI 编辑功能。
4. 只读语义不可破坏；Markdown 输入安全策略不可减弱。
5. 不删除 `src-tauri/src/services/pdf_export.rs`、已有公式、Mermaid、测试和 i18n 代码。
6. 新依赖使用可信源并记录版本/许可证；安装先检查 Node/Rust/Tauri/WebView 平台约束。
7. 每个阶段重跑 `pnpm test`、`pnpm build`、`cd src-tauri && cargo test --locked`，如有环境或测试阻塞必须写明，不能标记通过。OS 打包可按当前环境验证，并注明未测试的平台。
8. 每阶段在 `docs/roadmap/multi-format/PROJECT_STATUS.md` 记录 `current_phase`, `status`, `next_phase`, `summary`, `tests`, `risks`, `rollback`；旧 `docs/PROJECT_STATUS.md` 既有 Reader-P1.9 blocked 不能擅自改成完成。
9. 每阶段完成后停在 `awaiting_acceptance`（或 `blocked`），提交变更摘要、修改文件清单、测试结果、风险以及下阶段推荐；等待用户明确继续。

## 6. 直接执行的 Codex Prompt

### P0 —— 基线审计与迁移计划（第一条先执行）

```text
你现在是 MdStudio 项目的首席架构师和高级 Rust/Tauri/React 工程师。请只执行【P0：基线审计】，不要编写 PDF/OFD 功能。

项目：当前工作目录下的 MdStudio 本地源码。目标是在现有 Markdown 只读阅读器中逐步加入 PDF/OFD，而不是重写。技术栈：Rust、Tauri 2、React、TypeScript、Tailwind CSS，未来渐进引入 shadcn/ui。

任务：
1. 读取 git status、package.json、Cargo.toml、README、docs/PROJECT_STATUS.md、docs/TEST_REPORT.md、App.tsx、AppHeader.tsx、tabs.ts、preferences.ts、i18n、Rust commands.rs/lib.rs、reader.rs、watcher.rs、pdf_export.rs、tauri.conf.json、capabilities/default.json。
2. 绘制当前打开文件、渲染 Markdown、文件监听、最近文件、会话恢复、搜索、目录、PDF 导出、冷启动与单实例打开的调用链；列出 .md/.markdown 限制位置和最小修改范围。
3. 列出所有已实现且必须保护的 Markdown 功能和测试；核实当前 PDF 导出阻塞，禁止误判为已修复。
4. 调查 pdfjs-dist、@ofdrw/ofdrw-viewer-ui、@ofdrw/ofdrw-viewer-engine 的当前版本/运行时/许可证和可用 API；调查 OFDRW React UI 隐藏工具栏、搜索和控制接口以及日语语言问题。无法联网的事实写待验证，不臆造。
5. 新建 docs/roadmap/multi-format/00-current-baseline.md、01-architecture.md、02-compatibility-matrix.md、03-security-design.md、04-test-plan.md、PROJECT_STATUS.md。目录及架构必须与实际代码吻合。
6. 尝试运行 pnpm test、pnpm build、cd src-tauri && cargo test --locked，并记录真实输出。

禁令：本阶段不得重构 App.tsx，不得引入依赖或实现 PDF/OFD，不得改变已有功能，不得修改软件版本号，不得修改用户未提交更改。
完成后写 current_phase=P0, status=awaiting_acceptance 或 blocked，提供文件清单、测试摘要、风险和可回滚说明，然后停止。不要自动执行 P1。
```

### P1 —— 共用文档核心与无损 Markdown 适配

```text
请在当前 MdStudio 本地源码中只执行【P1：Document Core】，先读取 docs/roadmap/multi-format/PROJECT_STATUS.md 与 P0 交付物，确认 P0 已被人工接受；如未接受，停止并报告，不自动越级。

目标：为 Markdown/PDF/OFD 建立统一类型识别和生命周期抽象，但只对 Markdown 做可运行接入，不实现 PDF/OFD 渲染。

任务：
1. 在 src/features/documents/ 中创建类型、adapter registry、workspace state、capabilities 和清理生命周期；不制造过度抽象，允许 MarkdownPosition 与 PagedPosition 采用判别联合。
2. 复用 src/features/reader/tabs.ts 的现有泛型能力，保留按 canonicalPath 去重和关闭行为；使文档类型可作为 tab 字段。
3. 把 App.tsx 中相互独立的 UI/业务流程分离为最小组件，确保原 Markdown 渲染、公式、Mermaid、搜索高亮、目录、快捷键、历史导航不变。
4. 新增 Rust 端 DocumentType 检测/路径验证集中入口；现有 load_reader_document 仍只解析 Markdown。此阶段的 PDF/OFD 只能返回“格式已识别但阅读器未启用”，不能发送给 Comrak。
5. 增加 V1→V2 本地设置/会话/阅读位置兼容迁移，保留 V1 以便回滚。
6. 仅按需接入 shadcn/ui 少量组件；沿用既有 CSS、主题变量和布局，不大改首页、标签栏、设置页。
7. 补充 MD 相关状态与跨格式类型测试；运行所有既有测试和构建。

验收：.md/.markdown 功能、回归测试、启动/拖拽/文件监听不退化；不存在破坏原有应用的 PDF/OFD 假功能。输出变更清单和测试结果。更新状态为 P1 awaiting_acceptance 或 blocked，然后停止，不进入 P2。
```

### P2 —— PDF.js 阅读器 MVP

```text
只执行【P2：PDF Reader】，先核验 P1 已人工接受，否则停止。

保持现有 Markdown 功能；引入 pdfjs-dist，使用 Vite 本地打包的 PDF.js worker、字体/cmap 等必要资源；严禁 CDN。具体 worker 与 TextLayer API 以当前安装版本类型和官方文档为准，不能盲套旧版本示例。

实施：
1. Rust 实现受控的 PDF 文件元信息/路径验证/二进制读取，优先原始 IPC Response 或分块 Channel，禁止 JSON 字节数组。对文件大小、损坏和取消有清楚错误处理。
2. 实现 PdfAdapter、PdfViewer 及 per-tab 资源管理。打开本地 .pdf 后支持首屏、连续浏览、页码导航、下一页/上一页、缩放、适合宽度/整页、旋转（如果可控）。
3. 使用 PDF.js text layer 实现文字选择、复制、搜索及高亮；扫描件无文本时给出合理提示，不引入 OCR。
4. 采用可见页+邻近页渲染、缓存上限和取消无效任务；退出时销毁 PDF document/worker/render tasks/listeners，不让已关闭标签继续渲染。
5. 在原有选择文件、拖拽、启动参数、Open With、最近文件和恢复流程中增加 PDF；多标签混合打开 MD/PDF。
6. 增加样本：普通中文 PDF、多页、扫描、加密/错误、旋转、带书签、较大文件；覆盖相关自动测试。
7. 不修改 `pdf_export.rs` 的行为。若原有 PDF 导出仍阻塞，记录该问题但不得声称修复。

运行 pnpm test、pnpm build、cargo test --locked；在可用平台运行桌面构建/手工检查，记录耗时与峰值内存（如可测）。最后写 P2 awaiting_acceptance 或 blocked、测试/风险/回滚并停止，不进入 P3。
```

### P3 —— OFD 引擎兼容性 POC（不直接上生产）

```text
只执行【P3：OFD POC】，前提是 P2 已被人工接受。

目标：确认当前 MdStudio 的 Tauri WebView 环境中，@ofdrw/ofdrw-viewer-ui/react 与底层 engine 的真实可用性。禁止把官网宣称等同于 MdStudio 实测。

要求：
1. 核实当前 npm 包版本、MIT 许可、Node/打包约束；主评估 viewer-ui/react（可关闭工具栏）和 engine（可自行绘制 Canvas），各做最小实验；不引入 JVM 或远程转换服务。
2. 从用户许可/开源样本中建立 OFD 兼容测试集，至少含电子发票、票据、公文、中文/缺失字体、图片、印章和损坏容器；样本不足时明确阻塞并列出待测类型。
3. 单独测试：页面总数、首屏精度、翻页、缩放、缩略图、搜索、文字复制、字体缺失警告、内嵌图片、印章外观、加密文档错误信息、关闭清理、性能与大文件。标注未测、未通过和降级。
4. 检验 viewer-ui 能否隐藏内置 toolbar、通过 React ref 控制，验证是否与现有 CSS/快捷键/滚动容器冲突；检查 i18n zh-CN/en/ja 的可行性。
5. 定义 zip bomb、资源路径穿越、Canvas 尺寸、异常 XML、内存和超时处理策略；不能只看后缀。
6. 产出 docs/roadmap/multi-format/02-compatibility-matrix.md 与 POC_GO_NO_GO.md，明确 A（UI 封装）、B（engine 自定义）、C（暂缓）三选一的建议和依据。

除隔离的 POC/样本/文档外，不改变生产阅读主线。不自动把 POC 当生产支持。不执行 P4。最终状态 P3 awaiting_acceptance 或 blocked，停止。
```

### P4 —— OFD 生产集成 MVP

```text
只执行【P4：OFD Reader MVP】，先确认 P3 的 GO/NO-GO 决策已由用户接受；如果 P3 为 no-go，禁止强行开发。

优先实现 P3 选定方案：若 A 则使用 @ofdrw/ofdrw-viewer-ui/react 并设置 features.toolbar=false，统一与 MdStudio 顶部工具栏的页码/缩放/查找控制；若 B 则用 engine 的官方稳定 API 实现 Canvas 渲染，不猜测方法名。

任务：
1. 实现受控 .ofd 打开、OFD ZIP/OFD.xml 校验及资源限制、二进制输送、清晰的异常状态。
2. 实现 OfdAdapter 与 DocumentSession，页码跳转、缩放、阅读位置恢复、多标签切换、资源释放；搜索和复制仅在已验证能力下启用。
3. 保留印章显示；若未实现验签则显示“签章未验证”，禁止用绿色“有效”误导用户。加密文件不支持时明确提示。
4. 对字体/图像/页面失败提供诊断和手工可处理的错误提示，不静默空白；不要自动把 OFD 转成 PDF 作为默认阅读方式。
5. 增加 md/pdf/ofd 混合多标签测试和 OFD 样本快照/人工对照记录。
6. 保证三格式均在本地离线工作；运行所有测试及桌面构建。

更新 P4 状态、测试、兼容矩阵、明确尚不支持功能，停在 awaiting_acceptance 或 blocked，不进入 P5。
```

### P5 —— 统一阅读体验、UI 与性能

```text
请只执行【P5：Unified Experience】，先确认 P4 已人工接受。

保持 MdStudio 现有界面布局、同一行标签页、阅读宽度、主题和设置习惯；让三格式共用 AppHeader/DocumentToolbar 的统一视觉与快捷键。增量使用 shadcn/ui，不做整页视觉重设计。

实施：
1. 统一“打开 / 最近文件 / 拖拽 / 系统关联 / 标签切换 / 关闭 / 保存位置 / 恢复”；检测 Mac 冷/热启动、Windows/Linux single-instance 路径传递。
2. 统一搜索入口和导航接口，但按钮状态由 capabilities 驱动；Markdown 保留目录，PDF/OFD 显示缩略图与大纲（有则显示，无则优雅降级）。
3. 明确放大缩小语义：MD 字号/阅读宽度与 PDF/OFD 页面倍率不同，不要在数据层混为一个数字。
4. 翻译新增的中文/英文/日文文案；修正 OFD 第三方 UI 日文不完整问题，不能放出未经翻译的界面。
5. 做多标签资源压力测试、连续开关文档、搜索竞态、Worker 清理、焦点和滚动位置恢复。
6. 检查有无双工具栏、双滚动条、错误快捷键、PDF/OFD 覆盖 Markdown 设置和旧位置的情况。

验收：三格式阅读主流程一致，原有 Markdown 全部功能保留。运行测试并列出 Mac/Windows/Linux 已实测与未实测条目。停止于 P5 awaiting_acceptance 或 blocked。
```

### P6 —— 安全、发布及回滚

```text
只执行【P6：Security & Release】；确认 P5 已人工接受。

任务：
1. 对文件读取、OFD 解压、PDF/OFD 渲染、脚本和 URL 安全做威胁建模：ZIP Bomb、目录穿越、异常 XML、恶意 PDF、内存/CPU 消耗、外部网络访问、跨标签竞态、敏感路径泄露；修复高风险问题。
2. 审查 Tauri CSP、权限和文件读取限制，不放开不需要的 http/https/eval/全盘 asset 访问。所有 Worker/图片/字体本地离线可用。
3. 验证三格式 Windows/macOS/Linux 文件关联及首开/热启动、文件选择和拖拽、多标签恢复、主题和快捷键。对未具备测试机器的平台标“未验证”，不能造通过记录。
4. 收集 npm/crates 开源许可证和 NOTICE，确认 PDF.js 与 OFDRW 版本、许可，更新 README.zh-CN.md/README.md/README.ja.md、安装说明、截图和已知问题。
5. 再次处理 docs/PROJECT_STATUS.md 的 Reader-P1.9 PDF 导出 macOS 阻塞：独立复测并修复；如果无法修复，显式隔离故障功能并在发布判定中写明，不得把原始 blocker 隐藏或写“已修复”。
6. 重跑 pnpm test、pnpm build、cargo test --locked；各平台打包/安装按真实环境记录；整理版本与回滚策略，并给出 GO/NO-GO。
7. 生成 docs/roadmap/multi-format/05-acceptance.md、RELEASE_NOTES.md、ROLLBACK.md、LICENSE_NOTICES.md 和最新状态。

只做候选版本，不自动发布 GitHub Release、不推送 tag、不修改默认分支、不宣称所有平台通过。最终停在 P6 awaiting_acceptance 或 blocked，等待用户批准。
```

## 7. 一键开始方式

在 MdStudio 仓库根目录打开 Codex，先粘贴 **P0 Prompt**。P0 交付并人工检查后，再单独粘贴 P1。后续按 P2/P3/P4/P5/P6 顺序推进。**不建议让 Codex 在一个会话中连跑 P0–P6**，因为 OFD 引擎兼容性、原有导出 blocker 和跨平台实测有硬闸门。

建议首个版本交付边界：
- P1 + P2：先形成稳定的 Markdown + PDF 阅读器；
- P3 + P4：通过真实 OFD 样本验证后再加入 OFD；
- P5 + P6：统一 UX、风险加固、跨平台构建与发布验收。
