# 基线测试报告与多格式验收计划

测试日期：2026-11-03  
测试目标：本机当前工作树（HEAD `f6e82f0`，含开始 P0 前已存在的未提交改动）。这不是只针对干净 `v0.1.9` tag 的测试。

## P0 已按要求执行的命令

| 命令 | 结果 | 实际输出摘要 |
|---|---|---|
| `pnpm test` | 通过，退出码 0 | Vitest 4.1.12；17 个测试文件、140 项通过，0 失败；Vitest 报告 23.83 秒，命令墙钟约 25.79 秒。 |
| `pnpm build` | 通过，退出码 0 | TypeScript `tsc -b` 与 Vite 8.3.5 生产构建通过；Vite build 2.06 秒，命令墙钟约 5.92 秒。最大 chunk 593.07 kB（未压缩）并有大 chunk 提示；Tailwind 对 `::highlight(...)` 输出 4 条解析警告。 |
| `cd src-tauri && cargo test --locked` | 通过，退出码 0 | 32 个 Rust 单元测试通过，0 失败；Rust 测试 1.13 秒，命令墙钟约 3.15 秒；文档测试 0 项。包含审计开始前工作树内已有的 document-type/path 骨架测试。 |

这些是本机 macOS 上的自动化/前端构建检查。它们不验证安装包关联、Tauri 桌面交互、Windows/Linux 行为或 PDF 导出 UI，不得将其外推为这些项目通过。

## 与仓库既有报告的差异

根目录 `docs/TEST_REPORT.md` 记录的是 v0.1.9 交付时的基线（前端 16 个文件/133 项、Rust 28 项）。当前 dirty worktree 包含审计前已有的多格式骨架和额外测试，本轮重跑得到 17 个前端测试文件/140 项和 32 项 Rust 测试。P0 没有改写根目录报告，避免把未提交代码的测试数覆盖成已发布版本结果；本文件记录本轮 working tree 的真实输出。

## 现有 Markdown 测试覆盖面

- Rust reader：GFM 表格/任务列表、代码语言/高亮标记、Front Matter、数学 AST、价格/代码块保护、Mermaid fence/原文、错误输入、危险 HTML/URL、本地链接图片、安全路径与符号链接、图片尺寸/字节上限、源文档未改写、1 MiB 文档处理。
- Rust documents（当前未提交骨架）：扩展名大小写识别、PDF/OFD 路径元数据检查、拒绝 PDF/OFD 进入 Markdown parser、丢失 Markdown 恢复路径。
- Rust watcher：Markdown 文件过滤、事件合并/去抖相关逻辑。
- React App：启动待打开文件、拖放/选择、tab 激活关闭、导航、搜索、公式/错误回退等交互。
- React search/tabs/preferences：中文/英文匹配、表格和代码文字、路径去重、搜索/阅读状态、恢复与损坏数据回退。
- Fixtures：`reader-mvp/`、`mermaid/`、`math/`、`search/`、`navigation/`、`media-viewer/`。需在后续阶段以哈希断言继续保证源 Markdown 不变。

## 本次未执行

| 检查 | 状态 | 原因/边界 |
|---|---|---|
| Tauri 桌面打包和实际启动 | 未执行 | P0 要求的三条命令不包含桌面打包；本次限定为基线审计。 |
| Windows/Linux 构建与桌面交互 | 未执行 | 当前执行环境为 macOS。 |
| 文件关联、系统打开、二次启动、文件拖放实测 | 未执行 | Rust/UI 自动测试不替代真实 OS event 测试；PDF/OFD association 当前也未接通。 |
| PDF/OFD 实际打开、分页、搜索、缩放、离线/内存 | 未执行 | 两类 reader 尚不存在，也没有依赖。 |
| 现有 Markdown→PDF 导出重测 | 未执行 | `docs/TEST_REPORT.md` 已记录 macOS 导出交互故障；P0 不触发可能再次卡住的 120 秒打印流程。问题仍未解决。 |
| PDF/OFD 样本、签章或压缩炸弹安全测试 | 未执行 | 本地 reader 尚未实现，不能给未运行项目记通过。 |

## 未来阶段共用的 Markdown 回归门

每次改变打开/文档会话/渲染通用层，至少重新执行三条 P0 命令，并验证：

1. 文件选择、批量打开、拖放、系统关联、冷启动参数和已运行实例再次打开；路径/扩展名错误应有可读提示。
2. Mermaid、KaTeX、GFM、Front Matter、代码高亮、相对 Markdown 链接、中文图片路径、缺失图片、暗/亮主题。
3. 搜索和目录定位、章节前进/后退、每 tab 搜索/阅读位置、会话恢复和最近文件。
4. 外部修改/删除刷新状态、watcher 取消、关 tab 后图片资源和 listener 释放、异步打开无串 tab。
5. 危险 HTML/URL、本地路径穿越/符号链接、畸形文档和源 Markdown 阅读前后 SHA-256 一致。
6. macOS、Windows、Linux 的打包/启动结果逐平台记录；不能以一台机器的 Cargo tests 代替 OS 测试。
7. 既有 Markdown→PDF 导出作为独立回归项：必须验证前端响应性、成功/失败返回、实际 PDF 内容与版面。新增 PDF reader 通过不能替代导出问题验收。

## PDF POC 验收样本计划（未运行）

PDF：单页、多页、扫描页、中文嵌入/缺失字体、旋转、书签、透明度、加密、损坏、体积/页数上限。验证首屏、页导航、缩放/适应宽度、文字选择/复制、搜索、离线 worker/字体、缓存、取消渲染、关 tab 资源回收。没有 OCR 时不得宣称扫描件可搜索。

OFD：真实发票/公文，嵌入/缺失字体、图片编码、注释/图层、印章外观、加密、数字签名、损坏文件、超高压缩比/恶意条目。分别验证读取、缩略图、文本搜索、签名验证实现（如有）和受限错误；签章外观不能等同有效签名。

每个多格式阶段都要记录 APK/App 包增量、首次加载、冷启动、RSS/内存、文档长度及机器/OS/WebView 版本；P0 没有 PDF/OFD 性能基线，禁止虚构优化百分比。

## P2 实际执行记录（2026-11-03）

| 项目 | 实际结果 |
|---|---|
| `pnpm test -- --run` | 19 个测试文件、145 项通过、0 失败；Vitest 41.79 秒。 |
| `pnpm build` | TypeScript 与 Vite production build 通过；Vite 1.74 秒。PDF 主异步 chunk 约 430 KB，worker 约 2.23 MB（未压缩）。保留 4 条 Tailwind `::highlight(...)` 解析警告和大 chunk 提示。 |
| `cargo test --locked` | Rust 36 项通过、0 失败；测试 1.58 秒；仍有 `is_markdown_file` dead-code 警告。 |
| macOS `.app` | `pnpm tauri build --bundles app` 成功，`MdStudio.app` 约 18.00 MiB。完整 DMG 构建曾因本机 `hdiutil` “设备未配置”失败；`.app` bundle 可独立成功。 |
| macOS 桌面交互 | 中文 6 页 PDF 首屏/连续页、页码、搜索、缩放适配、旋转、高亮对齐及混合 Markdown/PDF tabs 已手测。扫描、加密、损坏、大文档和带书签样本结果见 `P2-acceptance.md`。 |
| fixture | `tests/fixtures/pdf-reader/` 有中文多页、扫描件、加密、损坏、旋转、书签及大文件样本；自动测试覆盖 PDF viewer 状态、传输/取消和 Rust 范围安全。 |
| Windows/Linux | 当前环境是 macOS；未构建、未实测。 |
| 内存 | shell RSS 采样受当前 sandbox 限制；如 Activity Monitor 无法采样，报告明确不提供估算峰值。 |
| Markdown → PDF 导出 | `pdf_export.rs` 未修改。macOS 既有约 120 秒卡顿后报失败仍存在。 |

P0 没有 PDF 性能基线，因此本阶段只记录资源体积和功能结果，不声称相对性能提升。内存峰值未测得；阅读不会写入原始 PDF；OFD reader 仍未实现。准确限制见 `P2-acceptance.md`。
