# P2：PDF Reader 验收记录

日期：2026-11-03  
工作树：macOS，本地未提交工作树  
阶段：P2 PDF Reader  
状态：`accepted`  
P1 已于 2026-11-03 经用户明确验收后开始本阶段；用户于 2026-11-03 验收 P2。未开始 P3。

## 交付范围

在现有多格式文档核心上加入本地 PDF 阅读。Markdown 阅读与 `pdf_export.rs` 不在本次改动范围内。OFD 仍只识别为未启用格式。

### 已实现

- 使用 `pdfjs-dist@6.4.299`（Apache-2.0）本地解析 PDF。worker、CMap、标准字体、WASM、ICC 资源随应用打包，不使用 CDN。
- Rust 侧检查 canonical path、普通文件、`.pdf` 扩展名、PDF 签名、文件大小和读取期间的文件元数据变化。单文件上限 256 MiB；IPC 使用原始二进制响应，不将字节编码为 JSON 数组。分块读取上限 1 MiB、内部读取块 64 KiB，并支持取消。
- 新增 PDF adapter 和按标签管理的文档/渲染生命周期。保留原有 Markdown reader，只在扩展名识别入口增加 PDF 分流；支持混合 Markdown/PDF 标签、文件选择、拖放、启动参数/系统打开、最近文件和会话恢复。
- PDF 连续分页；页码跳转、上一页/下一页、缩放、适合宽度、整页和旋转。
- 使用 PDF.js TextLayer 提供文本选择、复制、搜索和高亮。扫描件无文本时提示当前没有 OCR。
- 使用可见区域和邻近页延迟渲染，限制 canvas 像素、释放离屏画布/文本层、取消已失效的渲染任务，并在标签关闭时销毁 PDF.js 文档/worker 资源。
- 加密、损坏、读取中变化和打开取消均有可读错误处理。
- 新增样本：`tests/fixtures/pdf-reader/normal-chinese-multipage.pdf`、`scanned-image-only.pdf`、`encrypted.pdf`、`corrupt.pdf`、`rotated-page.pdf`、`bookmarks.pdf`、`large-document.pdf`。

### 主要代码位置

- Rust 路径、元信息与范围读取：[pdf_reader.rs](../../../src-tauri/src/services/pdf_reader.rs)、[commands.rs](../../../src-tauri/src/commands.rs)
- PDF adapter、PDF.js 本地资源和生命周期：[reader.ts](../../../src/features/documents/pdf/reader.ts)
- 阅读器与页面组件：[PdfViewer.tsx](../../../src/components/reader/PdfViewer.tsx)、[PdfViewer.css](../../../src/components/reader/PdfViewer.css)
- 现有混合打开、恢复和 tab 接入：[App.tsx](../../../src/app/App.tsx)
- 测试：[reader.test.ts](../../../src/features/documents/pdf/reader.test.ts)、[PdfViewer.test.tsx](../../../src/components/reader/PdfViewer.test.tsx)、`src-tauri/src/services/pdf_reader.rs` 内单元测试

## 自动化测试与构建

| 命令 | 实际结果 |
|---|---|
| `pnpm test -- --run` | 通过：19 个测试文件、145 项通过、0 失败；Vitest 41.79 秒。 |
| `pnpm build` | 通过：TypeScript 与 Vite production build 成功；Vite 1.74 秒。 |
| `cd src-tauri && cargo test --locked` | 通过：36 项 Rust 测试通过、0 失败；测试 1.58 秒。 |
| `pnpm tauri build --bundles app` | 通过：生成 macOS `MdStudio.app`，约 18.00 MiB。 |
| `pnpm tauri build`（DMG） | 未通过：系统 `hdiutil` 返回“设备未配置”。单独 `.app` bundle 构建成功。 |

构建仍有 4 条 Tailwind 对 `::highlight(...)` 的解析警告、Vite 大 chunk 提示，以及 Rust `is_markdown_file` 未使用警告。PDF 主异步 chunk 约 430 KB，PDF worker 约 2.23 MB（均为未压缩构建产物）；`public/pdfjs/` 资源约 3.9 MiB。无 P0 PDF 性能基线，不报告性能提升比例。

## macOS 桌面手工验证

使用本次构建的 `.app` 打开本地真实 PDF fixtures：

| 样本/操作 | 结果 |
|---|---|
| 中文 6 页 PDF | 正文、连续页、分页计数正常；可与 Markdown 标签混合打开。 |
| 页码、下一页、缩放、适应宽度/整页 | 正常。 |
| 搜索 `MdStudio` | 结果计数和定位正常；测试中为 `1/12`。 |
| 旋转后的页面搜索高亮 | 发现 TextLayer 与 canvas 坐标错位。已按 PDF.js 的 90/180/270 度旋转规则补齐 TextLayer CSS；重新构建后文字和高亮对齐。 |
| 扫描图片 PDF | 图像显示；搜索无文本时提示“可能是扫描件”，没有 OCR。 |
| 加密 PDF | 显示不支持密码输入的错误，不崩溃。 |
| 损坏 PDF | 显示格式无效错误，不崩溃。 |
| 20 页、约 4.5 MiB 大文档 | 首屏显示，下一页导航有效；视口邻近页按需渲染。 |
| 含书签 PDF | 4 页正文可以打开和连续显示。adapter 会读取 PDF outline；当前界面未显示 PDF 书签导航，见已知限制。 |

原 PDF 文件只读；Rust 仅执行受控读取。本次未对 PDF fixtures 写入内容。

## 兼容性与安全边界

- 已在 macOS 桌面应用完成构建和手工验证。Windows、Linux 没有可用运行环境，未构建、未手工验证，不能据 macOS 结果声称跨平台通过。
- `pdfjs-dist` 6.4.299 的 worker 与引擎在 Vite 本地打包；标准字体、CMap、WASM、ICC 通过本地资源 URL 加载。未使用 CDN。
- PDF 文件大小上限为 256 MiB；读取范围上限 1 MiB。超限或读取期间变更会拒绝读取。
- 加密 PDF 无密码输入支持；扫描 PDF 无 OCR；PDF JavaScript 和附件不执行/不处理。
- 带书签样本可正常阅读，但书签 outline 尚未接入 UI 导航。
- 内存峰值未测得。`ps` RSS 采样被运行沙箱拒绝，未用估算值代替实测。
- `src-tauri/src/services/pdf_export.rs` 未修改。既有 macOS Markdown→PDF 导出长时间阻塞并最终报失败的问题仍未解决；PDF 阅读器成功不代表导出修复。

## 回滚与工作树保护

本次未创建提交。工作树原先包含未提交改动，本阶段没有执行 `git reset`、`git clean` 或整体回滚。若需撤销 P2，应逐项回退 PDF 专属变更：移除 `pdfjs-dist` 依赖及 `public/pdfjs/` 资源、PDF reader/adapter/组件与 Rust commands，并恢复打开分流接入；不要清理整个工作树，也不要覆盖此前存在的 Markdown、多格式核心及用户修改。`pdf_export.rs` 保持原样。

## 验收结论

用户于 2026-11-03 验收 P2。macOS PDF 阅读主路径和本地自动测试结果、Windows/Linux 未验证、内存峰值未测及 PDF 书签导航未接入 UI 等边界均保留在本报告中。当前阶段已验收；P3 尚未启动，等待后续指示。
