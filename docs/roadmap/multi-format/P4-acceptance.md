# P4：OFD Reader MVP 验收记录

日期：2026-11-03  
版本：0.1.9（未修改）  
方案：P3 用户已接受的 A（`@ofdrw/ofdrw-viewer-ui/react`，隐藏内置工具栏）  
阶段状态：`blocked`，macOS 实机发现发票中文正文完全缺失，文字搜索无法验证；不进入 P5。

## 交付范围

- 新增 `@ofdrw/ofdrw-viewer-ui@0.1.7` 精确版本，采用本地打包，不使用 CDN、JVM 或远程转换服务。Viewer 懒加载；设置 `features.toolbar=false`，MdStudio 保留原单行顶栏作为统一导航。
- 新增 Rust OFD 容器检查与读取。仅检查本地路径，要求 `.ofd` 后缀、ZIP 签名/结构、`OFD.xml`、文档入口及至少一个页面；PDF/OFD 不进入 Comrak Markdown Parser。
- Rust `read_ofd_document` 通过 `tauri::ipc::Response` 返回原始字节，不使用 JSON 字节数组。读取前后校验文件大小与修改时间。加密文件和不支持容器返回中文错误。
- 新增 OFD Adapter/Session。标签保存页码、缩放、旋转；沿用 V2 会话、最近文件和阅读位置；活动 Viewer 在清理源 buffer 前先关闭，切换标签卸载 Viewer。
- 文件选择器、拖放、启动文件识别、应用文件关联和 watcher 接受 `.ofd`；支持与 Markdown/PDF 混合标签。
- 顶部复用页码输入、上一页/下一页、放大/缩小、适合宽度、旋转及搜索。样式跟随浅色/深色主题。英文字典选择 `en-US`；第三方 Viewer 不支持日语，`ja` 映射 `zh-CN`。
- Viewer 用最多 8 条本地诊断展示引擎 warning/error，解析/页面失败保留阅读区、错误信息和重试入口。保留签章图层但禁用验签能力并明确显示“签章未验证”。开启文字层搜索，不开放未经验证的复制/选择功能。

## 安全和资源上限

| 限制 | 上限/处理 |
|---|---|
| 单个 OFD 文件 | 128 MiB；分块读取并检查打开期间文件是否变化。 |
| ZIP 条目 | 最多 10,000 项；拒绝重复名称、符号链接、绝对路径、盘符/冒号、反斜线、`.`/`..` 路径段和越界范围。拒绝 Zip64 sentinel、多卷、加密标志。 |
| 解压量 | 每条目最多 64 MiB，总量 256 MiB，压缩比最多 200。允许 STORE/DEFLATE。 |
| XML | 单项最多 8 MiB、全部最多 32 MiB；拒绝 DTD 和未知实体；验证 CRC。 |
| 页数/画布 | 最多 20,000 页；Viewer 单页 16 MP、边长 8192、关闭超采样、并发 1，页面缓存 4 页/48 MP，文字 span 12,000。 |
| 签章 | 只报告签章元数据存在，不运行验签，不标为有效。 |
| 网络 | 文件内容只由本机 Rust IPC 提供；不接受 URL 数据源；依赖 JS/CSS 本地打包。 |

容器验证仍由 JS Viewer 处理实际页面和图层。Rust 容器审计不能证明 Viewer 对所有合法 OFD 的视觉兼容，也没有真实攻击集证明全部恶意压缩构造均可安全处理。`inspect_ofd_document` 与读取阶段各自读取并解析一次本地归档，最大文件硬限制仍为 128 MiB；这可能增加大文件打开耗时，未建立性能基线。

## 样本快照与对照

本轮结构回归使用现有 P3 样本 `docs/roadmap/multi-format/poc/public/samples/ofdrw-invoice.ofd`，不复制到安装目录：

- SHA-256：`f52f1df911c3d84943a7699fc517a528560e9e492082e72ee65d5ef5df8ad976`
- 内容快照：1 页；P3 结构分析含 42 个 TextCode、中文字段、1 个 PNG 二维码；没有嵌入用于对应缺字体名称的字体。
- 自动对照：Rust 测试确认 manifest/页数/签章元数据可读取，并在测试后复核文件 SHA 未变化。
- 许可：上游 OFDRW 仓库为 MIT，但容器中内嵌资源的分发权尚未逐项确认，因此该样本仅作本地测试。
- 实机样本快照：2026-11-03 使用当前 Debug `.app` 打开上游 `ofdrw-invoice.ofd`。本轮截图已通过桌面控制结果展示；截图未落盘到仓库，因此不伪称存在可复用的 PNG 文件。视觉观察记录如下：
  - Viewer 正常打开 1 页，顶部页码为 `1 / 1`、缩放为 `100%`，页面外框、表格线、二维码和红色签章轮廓可见。
  - 电子发票中文正文没有显示；诊断区显示 `W_FONT_MISSING`（第 1 页字体 28/4 未加载并跳过文字）及 `FontName=楷体` 缺失。页面因此不能作为可读发票验收。
  - 页面上方明确显示“包含签章；签章未验证”，符合不宣称验签的要求。
  - 诊断区另显示未知 ColorSpace 按 RGB 处理；页面中可见一个空图像占位符。二维码仍可见。
  - 搜索栏可打开并显示 `0 / 0`。尝试输入样本发票代码时，桌面自动化返回 `AXError.cannotComplete`，截图未出现输入词；因此搜索结果与输入交互**未验证**，不能把 `0 / 0` 解释为搜索功能通过。
  - 单页文档的上一页/下一页呈禁用状态是预期；缩放、适应宽度、旋转控件在界面可见，但本轮未验证实际操作效果。

| 对照项 | 当前证据 |
|---|---|
| 文件哈希/原件只读 | 自动通过；打开流程仅读取源文件，测试检查源 SHA-256 不变。 |
| OFD.xml/ZIP/页数 | 合成 ZIP 单元样本通过；上游发票结构通过。 |
| 首屏/中文/二维码/印章外观 | 实机观察到 1 页、二维码、表格线和红色签章轮廓；中文正文完全缺失。签章提示“未验证”。关键内容未通过。 |
| 缺字体/缺图片 | 实机诊断正确显示楷体及字体资源缺失，文字被跳过；二维码可见，另有空图像占位符。缺字被告知但没有应用内恢复方式，发票仍不可读。 |
| 搜索 | 搜索框显示 `0 / 0`；无法通过当前桌面自动化输入查询词（`AXError.cannotComplete`），未验证。 |

## 测试与构建

| 命令/项目 | 结果 |
|---|---|
| `pnpm test` | 21 个文件、151 项通过，0 失败。含跨格式混合标签、OFD 拖放、适配器、viewer 控件/告警/卸载和持久化用例。 |
| `pnpm build` | 通过；OFDRW 懒加载 JS chunk 约 1.30 MB，gzip 约 418 KB；Vite 提示 chunk 超过 500 KB，CSS `::highlight` 兼容提示仍存在。 |
| `cargo test --locked` / `cargo test --locked --offline` | 各 41 项通过，0 失败。 |
| `cargo fmt -- --check` | 通过。 |
| `pnpm tauri build --debug --bundles app` | 通过；生成 `src-tauri/target/debug/bundle/macos/MdStudio.app`，约 49.65 MiB。 |
| `pnpm tauri build --debug` | Rust 与 app 构建通过，DMG 最后因 `hdiutil: create failed - 设备未配置` 失败。 |
| macOS 实机 | 已打开真实 OFD 并观察 Viewer/诊断/签章提示；实测发现中文正文缺失。窗口自动化无法输入搜索词；缩放、旋转和离线断网交互未测。 |
| Windows/WebView2 | 未执行；当前只有 macOS 环境。 |

Rust 构建存在既有 `is_markdown_file` dead-code 警告；本轮没有修改/清理它。MD 自动回归全部通过；本轮未修改 Markdown 渲染或 PDF Reader。既有 Markdown→PDF 导出阻塞保持未修复，且 `src-tauri/src/services/pdf_export.rs` 不属于本轮改动范围。

## 能力与未支持项

- **已实现并经自动化验证**：类型识别与隔离、文件选择/拖放批量建标签、混合 tab 状态、原始二进制 IPC、会话/最近文件/位置持久化、Viewer ref 顶栏控制调用、诊断错误显示、重试、关闭清理调用。
- **部分实现**：OFD 文字搜索由 Viewer `find`/text layer 提供；此实机样本因缺字体没有可搜索文字，且本轮无法键入查询词。旋转/页码等当前只有自动接口验证，待实机交互检查。
- **不支持/未验证**：文字复制/选择、签章验真、加密 OFD、扫描件 OCR、日本语第三方 Viewer 翻译、损坏/恶意 OFD 兼容；文件关联是否由每个 OS 安装器正确注册；Windows/Linux WebView 行为。
- **兼容风险**：P4 实机重新确认本机发票中文正文缺失，尽管诊断已显示。P3 双页 JPEG Viewer UI 空白仍未复测。由于主要文档内容无法阅读，当前按关键阻塞处理；诊断存在不等同于阅读兼容通过。
- **许可风险**：P3 样本只在本地研究目录，不自动打包。公开样本内的字体、商标、印章等须单独确认许可。

## 回滚

回滚 P4 时，移除 OFD Adapter/Viewer、OFD Rust service/commands、`.ofd` 文件关联及 OFD 持久化字段；保留 PDF 和 Markdown 适配器、测试与 V1/V2 原有数据。当前工作树包含用户既有未提交改动，回滚不得用 `git reset` 或清理工作树；应按本验收报告中的 P4 文件变更逐项撤销。V1 Markdown 会话镜像仍保留给旧版读取。

## 最终状态

`current_phase: P4 OFD Reader MVP`、`status: blocked`。自动测试、macOS `.app` 构建通过。已完成上游发票实机打开和视觉对照，但中文正文缺失、搜索交互未验证，离线断网及缩放/旋转操作仍未测。截图在本次桌面检查中显示，未保存为仓库文件。阻塞原因解除并补齐验证前，不进入 P5。
