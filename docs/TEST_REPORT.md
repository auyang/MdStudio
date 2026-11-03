# MdStudio 测试报告

## v0.1.9 数学公式阅读支持

测试日期：2026-11-02（macOS）

### 已执行检查

| 检查 | 结果 | 说明 |
|---|---|---|
| Comrak 数学节点 | 通过 | `$...$`、`$$...$$`、`\(...\)`、`\[...\]` 生成带 `data-math-style` 的节点；普通金额和代码块保持原文。 |
| KaTeX 阅读渲染 | 通过 | 行内、块级、多行 aligned、矩阵、分式、求和、积分和中文混排均在桌面界面及 PDF 中显示。 |
| 错误公式回退 | 通过 | 无效 LaTeX 显示原始源码和中文错误提示，不中断其他公式。 |
| 公式源码复制 | 通过 | 公式节点提供复制源码按钮；前端交互测试通过。 |
| 按需加载与离线 | 通过 | 普通文档不加载 KaTeX；KaTeX、CSS 和字体由应用本地依赖打包，无 CDN。 |
| 大型公式文档 | 通过 | 240 个块公式的 fixture 通过 Rust 解析和前端批量渲染测试。 |
| Markdown 原文未修改 | 通过 | 公式 fixture 测试前后 SHA-256 为 `147516e99ec9f1b2d2ababa41996b99a522af728fec518513e6b854ef5617602`。 |
| 前端测试 | 通过 | `pnpm test`：16 个测试文件、133 项通过。 |
| Rust 测试 | 通过 | `cargo test --locked`：28 项通过。 |
| 前端生产构建 | 通过 | `pnpm build` 成功。KaTeX 独立分包，约 258.86 KB（77.49 KB gzip）；KaTeX CSS 28.83 KB（7.92 KB gzip）。 |
| macOS 桌面构建 | 通过 | `pnpm tauri build --bundles app` 成功，生成 `src-tauri/target/release/bundle/macos/MdStudio.app`，约 15.5 MiB。 |
| PDF 公式内容 | 通过（内容） | 实际导出的一页 A4 PDF 包含行内公式、aligned、矩阵、价格文本、代码中的美元符号和错误公式回退；PDF 已渲染并目视检查。截图见 `screenshots/mdstudio-math-formulas-pdf.png`。 |
| PDF 导出交互 | 未通过 | macOS 原生打印流程在本次桌面验证中约 120 秒后才写出 PDF；应用界面期间不可正常操作，最后仍弹出“导出失败”。因此 PDF 交互稳定性不能验收通过。 |
| Windows 桌面运行 | 未执行 | 当前环境为 macOS。Windows 代码路径仅能在 Windows 环境验证。 |

### 构建备注

构建成功，但仍有既有 CSS `::highlight` 兼容性提示和大入口包警告。KaTeX 作为按需加载分块，普通阅读文档不触发 KaTeX 加载。

### 结论

数学公式渲染、源代码回退、复制、离线资源和原文只读要求均通过自动化及 macOS 实机/PDF 内容检查。当前阶段仍受 macOS PDF 导出交互故障阻塞：输出内容正确，但长时间阻塞界面并报告失败。不得将整体验收标记为完成。

## P2 PDF Reader（本地工作树，2026-11-03）

| 检查 | 实际结果 |
|---|---|
| `pnpm test -- --run` | 通过：19 个测试文件、145 项通过，0 失败；41.79 秒。 |
| `pnpm build` | 通过；Vite 1.74 秒。PDF.js 主异步 chunk 约 430 KB，worker 约 2.23 MB（未压缩）。 |
| `cd src-tauri && cargo test --locked` | 通过：36 项通过，0 失败；1.58 秒。存在 `is_markdown_file` 未使用警告。 |
| macOS app 构建 | `pnpm tauri build --bundles app` 通过；生成约 18.00 MiB 的 `.app`。DMG 流程因 `hdiutil`“设备未配置”失败。 |
| PDF 桌面手测 | 中文多页、Markdown/PDF 混合标签、页码/缩放/适应、搜索与旋转高亮、扫描件提示、加密和损坏错误回退、大文档翻页及含书签样本打开均已检查。详见 `roadmap/multi-format/P2-acceptance.md`。 |
| 跨平台与内存 | Windows/Linux 未构建或手测；RSS 采样受沙箱限制，内存峰值未测量。 |
| Markdown→PDF 导出 | `pdf_export.rs` 未修改。此前约 120 秒阻塞后仍报失败的问题继续存在，未宣称修复。 |

本阶段依赖 `pdfjs-dist@6.4.299`（Apache-2.0）；PDF.js worker、CMap、标准字体、WASM 和 ICC 资源本地随包提供，不使用 CDN。自动及桌面结果、限制、回滚说明见 [P2 验收报告](roadmap/multi-format/P2-acceptance.md)。用户已于 2026-11-03 验收 P2；项目状态为 `P2 / accepted`，P3 未启动。

## P4 OFD Reader MVP（2026-11-03）

| 检查 | 实际结果 |
|---|---|
| 前端自动测试 | 全量 `pnpm test`：21 个测试文件、151 项通过，0 失败（包括混合 Markdown/PDF/OFD 拖入、多标签打开、OFD Viewer 控件/诊断/卸载、适配器加密错误）。 |
| OFD Rust 测试 | `cargo test --locked` 与 `cargo test --locked --offline`：各 41 项通过，0 失败；覆盖 PDF/OFD 类型隔离、ZIP 路径穿越、重复项/符号链接、缺失 OFD.xml、加密标记、无效 XML、资源/CRC/文件变更/取消和只读读取。使用 P3 上游发票校验字节未修改。 |
| Rust 格式 | `cargo fmt -- --check` 通过。 |
| 前端生产构建 | `pnpm build` 通过。OFDRW UI 懒加载分块约 1.30 MB（gzip 418 KB）；因第三方依赖仍高于 500 KB 阈值而提示。构建另有既有 `::highlight` CSS 解析提示。普通无 OFD 文档不请求该懒加载模块。 |
| macOS 桌面构建 | `pnpm tauri build --debug --bundles app` 成功，`src-tauri/target/debug/bundle/macos/MdStudio.app` 约 49.65 MiB（debug）。 |
| DMG 打包 | `pnpm tauri build --debug` 的 Rust/App 构建成功；最后 `hdiutil` 因设备未配置失败。该失败属于当前打包环境，单独的 `.app` 目标成功。 |
| macOS Viewer 实机 | 已用 Debug `.app` 打开 `ofdrw-invoice.ofd`。1/1 页和 100% 控件可见，二维码、表格线及红色签章轮廓可见；中文正文全部缺失。诊断显示字体 28/4 跳过文字及 `FontName=楷体` 缺失。页面标注“签章未验证”。 |
| 搜索/控件手测 | 搜索框显示 `0 / 0`；输入查询词时桌面自动化返回 `AXError.cannotComplete`，所以搜索交互未验证。缩放、适应宽度、旋转控件可见但未操作；切网离线未执行。单页上一页/下一页禁用符合预期。 |
| 实机截图与样本对照 | 截图在本轮桌面检查中显示，但未保存为仓库文件。视觉记录和样本 SHA-256 见 [P4 验收报告](roadmap/multi-format/P4-acceptance.md)。中文缺失构成关键兼容阻塞。 |
| Windows | 未执行：当前环境是 macOS，未构建 WebView2。 |
| Markdown/PDF 回归 | 前端和 Rust 全量套件通过；本轮未改写 Markdown 文件或 PDF 渲染代码。PDF 导出链路保持既有状态，P4 未修改 `pdf_export.rs`。 |

自动测试覆盖用合成 ZIP/OFD XML 和现有只读 P3 上游样本；没有将未获单项再分发授权的 OFD 测试件复制进发行目录。自动校验不等于视觉兼容或 ZIP bomb 实攻击测试。当前阶段状态为 `blocked`：实机发票正文缺失，搜索交互和离线桌面检查未通过/未测。最终逐项状态及样本哈希见 [P4 验收报告](roadmap/multi-format/P4-acceptance.md)。

## P5 Unified Experience（2026-11-03）

| 检查 | 实际结果 |
|---|---|
| `pnpm test` | 通过：24 个测试文件、161 项通过，0 失败；64.48 秒。覆盖统一 PDF 顶栏、单一导航面板、PDF 选择器、搜索竞态、PDF Viewer 重新挂载后的页码恢复、OFD 日语诊断。jsdom 有 Canvas `getContext` 模拟缺省提示，不影响测试结果。 |
| `pnpm build` | 通过；命令实测约 11.01 秒，Vite 4.20 秒。独立生产构建 OFD Viewer chunk 1,298.53 kB（gzip 418.77 kB），PDF worker 2,229.71 kB。 |
| `cargo test --locked` | 通过：41 项通过，0 失败；单测执行 3.00 秒，首次重编译 58.41 秒。仍有 `is_markdown_file` dead-code 警告。 |
| `pnpm tauri build --debug --bundles app` | 通过；Tauri 集成 Vite 3.23 秒、Rust 增量编译 34.40 秒，Debug `.app` 为 49.67 MiB。Debug sourcemap 构建 OFD Viewer chunk 2,410.79 kB（gzip 631.84 kB），sourcemap 4,304.73 kB。 |
| macOS PDF/Markdown 桌面检查 | 按构建 `.app` 路径启动成功；PDF、Markdown 混合标签同窗工作。单行顶栏只有一套 PDF 控件，PDF 文字层/搜索高亮与导航面板可见；Markdown 搜索状态在切换到 PDF 后仍保留。跳至 PDF 第 3 页，切换 Markdown 再返回后仍回到第 3 页。 |
| macOS OFD 桌面检查 | 原生文件选择器打开 `ofdrw-invoice.ofd` 成功，共享顶栏显示 OFD 控件且没有第三方第二套工具栏。页面正文为空；诊断列出缺失字体并提示文字跳过，签章提示“签章未验证”。该问题未解决，是本阶段阻塞。 |
| macOS OS 文件集成 | bundle path 启动和原生选择器已测；`open -n` 和 `open -a <app> <file>` 均返回 `kLSNoExecutableErr`；`Info.plist` 指向的 `mdstudio` arm64 可执行文件存在，Launch Services 报错原因未确定。Open With、冷/热启动参数、single-instance 路径转发及拖放 OS 流程未完成实机验证。 |
| 生命周期与压力 | 自动用例覆盖搜索竞态、PDF 标签关闭时取消 range 请求并销毁 loading task、OFD 关闭时清理二进制。连续开关文档压力测试和峰值内存采样未执行。 |
| Windows/Linux | 未构建、未实测。 |

P5 还修复 PDF 标签重新挂载后只更新页码字段、没有滚动到保存页的状态错位。Markdown、PDF.js Rust IPC 与 `pdf_export.rs` 均未改动。P5 自动回归及 macOS 部分窗口检查通过，但 OFD 正文兼容、OS 文件关联/单实例和跨平台验证仍未完成；状态为 `blocked`，详细范围见 [P5 验收报告](roadmap/multi-format/P5-acceptance.md)。
