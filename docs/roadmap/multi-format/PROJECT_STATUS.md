# MdStudio 多格式阅读器路线状态

current_phase: P5-A macOS Native Window Fusion
target_version: 0.2.0
p3_decision: GO_A_CONDITIONAL
p4_user_acceptance: accepted（2026-11-03）
status: awaiting_acceptance（仅 P5-A；P5 总阶段仍阻塞）
parent_phase_status: blocked（OFD 中文正文及系统文件关联/其他平台验证未完成）
next_phase: none（等待 P5-A 验收；不得自动进入后续阶段）
current_subphase_status: awaiting_acceptance（自动测试、macOS 构建和三格式主界面检查完成；拖动位移与窄窗实测未能由桌面接口确认）

## P3 本轮复验（2026-11-03）

- 阶段门槛：P2 已由用户人工验收。本轮只重新检查隔离 OFD POC；没有接入生产 reader、修改生产依赖或执行 P4。
- 本地安装包：`@ofdrw/ofdrw-viewer-ui`、`@ofdrw/ofdrw-viewer-engine`、传递依赖 `@ofdrw/ofdrw-viewer-crypto` 均为 0.1.7；包内 manifest 标记 MIT、Node `>=22`。UI peer 要求 React/React DOM `>=18`、Vue `>=3.3`。实验运行时为 Node 22.20.0、React 19.3.0、Vite 8.3.5。以上是本机隔离 POC 锁定包的版本，不代表 registry 的当前 latest；本轮未取得 registry 最新版本响应。
- UI 的本地类型声明导出 `./react` `forwardRef` 组件，支持 `features.toolbar=false`、`goToPage`、前后页、缩放/旋转、`find`、`close` 等接口；此前 macOS Tauri WebView 已实际验证 toolbar 隐藏、ref 控制、缩略图及缩放。Engine 的类型声明支持本地字节源、`OFDDocument` 生命周期、Canvas 绘制任务和补充字体。两条路线均为纯前端本地实验，没有 JVM 或远程转换服务。
- 本轮自动验证：6 份样本 ZIP CRC/OFD XML/路径与资源结构检查通过；字体回退脚本通过；TypeScript/Vite 构建通过；隔离 macOS Tauri `.app` 构建通过（release 25.27 秒）。前端主 chunk 1,524.98 kB（gzip 490.26 kB），仍有 Vite 500 kB 警告。完整输出与单项限制见 [P3 本轮决策记录](POC_GO_NO_GO.md)。
- 桌面证据沿用同一 POC UI/Engine 版本此前的真实 macOS Tauri WebView 检查：本机字体回退后发票中文与搜索可用；双页 JPEG 的 Engine 可绘制并翻页，Viewer UI 却渲染空白；嵌入字体中文样本仍缺字。此次重打包后 Mac 锁屏，未能重复窗口级手工操作，故没有把旧的 UI 实测标为本轮新测。
- 技术复验仍有阻塞：票据、公文、授权明确的 CJK 字体、损坏/加密/ZIP bomb 和大文件样本缺失；Viewer UI 图片渲染及内嵌字体兼容有已知失败；复制、恶意包资源边界、逐项关闭清理、峰值内存、Windows/Linux 均未通过或未测。
- 用户于 2026-11-03 明确要求将 P3 改为 Go。本路线据此选择 **A（Viewer UI）有条件 Go**，状态记为 `accepted`。这是进入 P4 MVP 的规划决策，不表示上述测试已通过，也不表示 OFD 已获得生产支持。P4 必须解决或明确隔离已知渲染缺陷并补齐关键样本与安全验证；本轮不启动 P4。

## P0：基线审计（已验收）

用户于 2026-11-03 明确验收 P0，本次据此开始 P1 Document Core。P0 资料保留在 `00-current-baseline.md` 至 `04-test-plan.md`。

## P1：Document Core

本阶段只把 Markdown 接入统一文档类型、适配器、tab/session 生命周期与持久化兼容层。PDF/OFD 只做类型识别和本地路径元数据检查，不解析内容、不建立 reader tab、不发送给 Comrak。

当前工作树内的 P1 实现经代码审计和回归复测通过；核心变更原已存在于本地未提交工作树，本轮没有覆盖或清理其他修改。详细变更与测试结果见 [P1 验收记录](P1-acceptance.md)。

## 已知风险与停止点

- P2 已在 macOS 构建并手测；Windows/Linux 未构建或运行，平台行为仍待各自环境验证。
- PDF viewer 可读取 PDF outline，但书签导航尚未接入界面；PDF 大小上限 256 MiB；加密 PDF 无密码输入，扫描 PDF 无 OCR。
- 内存峰值未测得；Markdown→PDF 导出仍有既有长时间无响应并最终报告失败的问题，本阶段未触碰导出链路。

用户已于 2026-11-03 明确验收 P1 并授权执行 P2 PDF Reader；用户现已验收 P2，满足开始 P3 的阶段门槛。

## P3 修复与复评（2026-11-03）

- 本轮处理的是用户已验收的 P3 No-Go 后续：补充隔离样本并定位发票中文缺失根因；不接入生产。
- 根因：原始发票 `PublicRes.xml` 引用楷体/宋体，但容器没有嵌入对应字体。OFDRW 在缺字时发出 `W_FONT_MISSING` 并跳过文本；Viewer UI 与 Engine 都因此没有文字层，find 返回空。不是 MdStudio 的 Markdown/Comrak 问题。
- POC 增加本机字体回退输入，32 MiB 上限；使用 23.5 MiB 的 Hiragino Sans GB TTC 实测后，原发票在 Viewer UI 和 Engine 中均显示中文，搜索发票代码得到 1 项。离线 Engine 验证从无回退的 0 项/0 字、2 个缺字体告警，变为 74 项/564 字、无缺字体告警。
- 补充至 6 份结构校验样本：发票、带评估水印的印章、内嵌字体文字、多页 JPEG、缺失图片、签章缩放异常。`npm run test:samples` 与 `npm run test:font-fallback` 均通过。
- 实机 macOS 测试发现新限制：内嵌字体文字样本仍有 `W_FONT_MISSING` 且中文没有显示；双页 JPEG 在 Engine Canvas 可见并可翻页，Viewer UI 则报告 `W_IMAGE_DECODE: 渲染已取消` 且画面空白。缺失图片样本能保留中文文字并明确报 `图片 135 未解码，已跳过`。带 “For Evaluation Only” 水印的印章样本可见印章图形，但不证明验签正确。
- `npm run build` 通过，主 chunk 1,524.98 kB（gzip 490.26 kB），仍有超过 500 kB 的警告。POC macOS `.app` 构建通过（release 约 29.54 秒，应用约 10.45 MiB）。Windows/Linux 未验证；峰值内存未测。
- 复评结论仍为 **C / No-Go**：手动字体回退修复了单一发票样本，但不是跨样本默认字体解决方案；Viewer UI 对图片样本有空白问题，内嵌字体样本仍降级，且票据/公文/加密/损坏/大文件和样本授权覆盖不足。不得进入 P4。
- 用户于 2026-11-03 验收本轮复评的 C / No-Go。P4 仍不启动；决策细节见 [复评记录](POC_GO_NO_GO.md) 和 [兼容矩阵](02-compatibility-matrix.md)。

## P2：PDF Reader（已验收）

- 状态：`accepted`；用户于 2026-11-03 验收；版本保持 0.1.9。
- 已实现本地 `pdfjs-dist` 阅读器、受控 Rust 二进制 range IPC、分页连续阅读、文本选择/搜索、缩放/适应/旋转、PDF outline 读取、扫描件提示、每标签阅读状态与会话恢复。书签导航 UI 尚未实现。
- PDF.js worker、CMap、标准字体、WASM 与 ICC 资源均随应用本地打包；无 CDN。
- macOS `.app` 构建及手工打开 PDF / 混合 Markdown 标签验证已执行；自动测试结果见 [P2 验收报告](P2-acceptance.md)。Windows 实机/构建未执行。
- 未改动 `src-tauri/src/services/pdf_export.rs`；既有 Markdown→PDF 导出在 macOS 的长时间阻塞并报失败问题仍存在，不能据 PDF 阅读能力推断已修复。
- OFD 尚未接入生产阅读器。本阶段 P3 仅在 `docs/roadmap/multi-format/poc/` 建立独立 React/Vite/Tauri 实验，不改变生产依赖或 Markdown/PDF 阅读主线。

## P3：OFD POC（已验收，A 有条件 Go）

- 用户先后验收过 P3 的 C / No-Go 复评；之后于 2026-11-03 明确要求将 P3 决策改为 Go。本文件当前决策按该最新指示记为 **A（Viewer UI）有条件 Go**。
- 该 Go 授权在用户另行指令后进入 P4 MVP，不代表 OFD 生产兼容已通过；P4 尚未启动。
- 已知问题和未测项保持不变：Viewer UI 双页 JPEG 空白、嵌入字体中文缺失；票据/公文/损坏/加密/恶意压缩/大文件样本、复制、内存和逐项清理、Windows/Linux 实测不足。P4 必须处理这些门槛，不得静默空白，也不得把印章外观说成验签有效。
- POC 与依赖仍隔离在 `docs/roadmap/multi-format/poc/`；本次只更新决策文件，没有修改生产阅读代码。测试细节见 [P3 Go/No-Go 记录](POC_GO_NO_GO.md) 与[兼容矩阵](02-compatibility-matrix.md)。

## P4：OFD Reader MVP（实现完成，实机验证阻塞）

- 阶段门槛：用户已明确将 P3 决策改为 Go；本阶段按 A（`@ofdrw/ofdrw-viewer-ui/react`）实现生产 Reader 接入。该门槛只授权 P4，不表示 OFD 全格式兼容已通过。
- 已接入 `.ofd` 类型、文件选择/拖放/文件关联/启动路径/最近文件与恢复、多标签 DocumentSession、阅读位置记忆、watcher、顶部单行页码/缩放/适合宽度/旋转/搜索控制。
- Rust 先验证 ZIP 中央目录、`OFD.xml` 和 Document XML，再以 Tauri Raw IPC `Response` 传原始字节；限制 128 MiB 文件、10,000 条目、单条目 64 MiB、总展开 256 MiB、压缩比 200、XML 32 MiB、20,000 页。拒绝加密 ZIP、Zip64 sentinel、路径穿越、符号链接、重复条目、DTD/未知实体和损坏 CRC。搜索使用 Viewer UI 本地文字层；文字选择/复制未证实，故关闭。签章只提示“签章未验证”。
- 关闭活动 OFD 标签时先关闭 Viewer，再清理会话二进制；切换标签由 Viewer 卸载清理；原始 `Uint8Array` 在会话关闭时清零。单页画布上限 16 MP、最大边长 8192、串行渲染、4 页/48 MP 页面缓存。
- 自动验证：`pnpm test` 21 个文件/151 项；Rust `cargo test --locked` 与 `cargo test --locked --offline` 各 41 项；`cargo fmt -- --check` 通过。批量拖放和混合 MD/PDF/OFD 标签集成测试通过。
- 前端构建通过。macOS Debug `.app` 构建成功，约 49.65 MiB；默认全目标打包制作 DMG 时，`hdiutil` 报“设备未配置”，改为 `--bundles app` 后构建通过。构建仍有 `::highlight` CSS 提示、chunk 大小提示和已有 `is_markdown_file` dead-code 警告。
- 解锁后 macOS 实机已打开 `ofdrw-invoice.ofd`。页面框架、二维码、表格线和红色签章轮廓可见，Viewer 显示 1/1 页和 100%；中文正文全部缺失。诊断列出字体 28/4 未加载、文字被跳过以及 `FontName=楷体` 缺失。签章提示为“签章未验证”。实机截图结果在本轮桌面检查中展示，但未保存为仓库 PNG。
- 搜索框能打开并显示 `0 / 0`；自动化输入查询词时 WebView 返回 `AXError.cannotComplete`，没有确认查询交互或结果。缩放、适应宽度、旋转控件可见，实际操作未验证；切网离线亦未执行。
- 用户于 2026-11-03 明确验收 P4 并要求开始 P5。该人工验收解除阶段门槛，但不改变发票中文正文缺失、搜索交互未验证等技术结果。
- 未更改 Markdown 原文、`pdf_export.rs` 导出行为或既有 PDF.js 渲染内核。

## P5：Unified Experience（当前阶段）

- PDF 与 OFD 共用单行顶栏页码、前后页、缩放、适合宽度/整页、重置和旋转控件；PDF Viewer 不再绘制第二套工具栏，OFD 第三方工具栏、侧栏、弹窗和 toast 隐藏。Markdown 保留原目录；PDF 书签/缩略图与 OFD 可用大纲/附近页缩略图进入统一导航面板。
- 搜索与导航入口按活动标签 capabilities 决定；MD/PDF/OFD 的搜索词、匹配状态及阅读位置保留在各自标签。等待态改为按标签分别维护，标签关闭时清理，迟到的旧标签回调不会覆盖当前标签状态。
- 缩放遵守格式语义：Markdown 保留字号缩放，PDF/OFD 使用页面倍率和独立位置；`⌘0` / `Ctrl+0` 重置当前格式对应的倍率。阅读宽度仍使用同一设置。
- OFD 日文环境不再请求第三方不完整的 `ja-JP` 文案。隐藏第三方工具条/侧栏/弹层，由 MdStudio 三语控件提供可见交互；日文诊断将已知引擎码映射成日文摘要，未知码显示日文说明和代码，不显示未翻译的原始消息。
- 打开入口复用文件选择器、最近文件、拖放、系统文件关联、启动路径、恢复和 Tauri single-instance 队列。选择器扩展为 `.md`、`.markdown`、`.pdf`、`.ofd`；没有引入新状态库或远程转换服务。
- 最终自动回归：`pnpm test` 24 个文件、161 项通过，0 失败（64.48 秒）；包含混合三格式标签、统一顶栏、页码导航、搜索竞态、PDF 选择器和日文 OFD 诊断用例。Rust `cargo test --locked` 41 项通过，0 失败；本轮首次重编译 58.41 秒，单元测试 3.00 秒。
- `pnpm build` 通过，命令实测约 11.01 秒（Vite 4.20 秒）；独立构建 OFD Viewer chunk 1,298.53 kB（gzip 418.77 kB），PDF worker 2,229.71 kB。Tauri 集成构建的 Vite 步骤 3.23 秒，Debug sourcemap 构建中的 OFD Viewer chunk 2,410.79 kB（gzip 631.84 kB，含 4,304.73 kB sourcemap）。保留 CSS `::highlight` 解析提示和大 chunk 警告。`pnpm tauri build --debug --bundles app` 通过，Rust 增量编译 34.40 秒，Debug `.app` 为 49.67 MiB。
- macOS 桌面复核：通过桌面自动化按本轮 `.app` 路径启动；原生文件选择器成功打开本地 OFD 样本。PDF 与 Markdown 混合标签可见，PDF 顶栏只有一套共享控件，Markdown 搜索状态在切换标签后保留，PDF 也能独立定位。将 PDF 页码设为 3、切到 Markdown 再切回，页码及页面位置恢复到第 3 页；自动测试也覆盖 PDF Viewer 重新挂载时恢复保存页码。PDF 缩略图/大纲面板及搜索高亮已在 macOS 窗口检查。
- OFD 桌面检查确认统一顶栏正常且没有显示第三方第二套工具栏；但 `ofdrw-invoice.ofd` 正文仍为空白。Viewer 诊断明确列出楷体/字体缺失并跳过文字，同时展示“签章未验证”。这是 P4 已知的内容兼容缺陷，P5 没有修复。
- Mac 应用 bundle 路径启动和原生文件选择器已实测；系统 Open With、冷/热启动文件参数及 single-instance 参数转发没有完成验证。`open -n` 与 `open -a <app> <file>` 均返回 `kLSNoExecutableErr`。核对确认 `Info.plist` 的 `CFBundleExecutable=mdstudio` 且该 arm64 可执行文件存在；具体 Launch Services 原因未确定，因此相关 OS 集成不标记通过。Windows/Linux 未构建、未实测。重复开关标签的压力测试、进程峰值内存及完整键盘焦点矩阵未测。
- 自动测试验证了搜索竞态、关闭时 PDF range 取消/worker 销毁、OFD 二进制清理等生命周期；未进行长时间资源压力或峰值内存采样。P5 的自动测试及 macOS 部分主流程通过，不代表所有三格式内容兼容。
- 因 OFD 正文可读性仍失败，且系统文件关联/单实例和其他平台尚未完成验证，P5 `status: blocked`；停止于本阶段，不启动后续阶段。

详细结果见 [P5 验收报告](P5-acceptance.md)。

## P5-A：macOS 桌面原生窗口融合

- 本子阶段将 macOS Overlay 拖动区域改为 Tauri `deep` 语义，启用 `acceptFirstMouse` 和拖动 capability，并将次要工具收进单行顶栏的“更多”菜单；MD/PDF/OFD 阅读器代码未改。
- 最终 `pnpm test` 24 个测试文件、163 项通过；`pnpm build`、串行 `cargo test --locked -j 1`（41 项）及最新 macOS Debug `.app` 构建通过。桌面已验证原生按钮同排、MD/PDF/OFD 混合标签、PDF 菜单控件和全屏进出。
- CUA 已执行顶栏拖动操作，但接口不提供窗口位置/尺寸，无法确认位移；窄窗口也无法通过该接口缩小原生窗口。两项按未确认记录，等待人工验收；详见 [P5-A 报告](P5A_REPORT.md)。
- P5 全阶段仍因既有 OFD 正文缺字以及系统文件关联/Windows/Linux 未验证而阻塞。P5-A 完成不能作为 P5 全阶段通过的依据。
