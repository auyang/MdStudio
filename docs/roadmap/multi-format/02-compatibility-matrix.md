# PDF/OFD 兼容性与候选依赖审计

核验日期：2026-11-03。以下区分本机项目证据、在线官方资料和未验证项。候选依赖都未安装，本节不代表已完成 Tauri 集成或兼容性验收。

## 当前格式状态

| 格式 | 本机实现状态 | 接入限制 |
|---|---|---|
| Markdown | 已运行的主阅读器 | 扩展名 `.md` / `.markdown`；Comrak 路径只读。必须作为后续每个阶段的回归基线。 |
| PDF | 当前工作树能识别扩展名并检查本地路径，reader 未启用 | 没有 PDF 文件关联、byte reader、PDF.js、分页 viewer 或 PDF tab session。现有 Markdown→PDF 导出单独存在且 macOS 未通过实测。 |
| OFD | 当前工作树能识别扩展名并检查本地路径，reader 未启用 | 没有 OFD 文件关联、容器/字节解析、OFD viewer 或 OFD session。 |

识别 PDF/OFD 类型不等于验证文件内容或确认格式有效。`src-tauri/src/services/documents.rs::inspect_document_path` 只 canonicalize 本地路径并读取文件元数据；测试甚至用非 PDF 字节确认这只是路径检查。TypeScript registry 发现没有注册的 PDF/OFD adapter 后拒绝打开。

## `pdfjs-dist`

| 项目 | 当前核查 |
|---|---|
| 本地依赖 | `package.json`、`pnpm-lock.yaml` 均没有 `pdfjs-dist`。 |
| 当前线上版本快照 | npm 包 README 页当前显示 `6.5.438`；npm 版本页网页快照仍显示 `6.4.299`。两个官方页面显示不一致，不能据此宣称已确认 registry `latest`。本机 registry 查询失败，实际 dist-tag 与可安装 tarball待验证。 |
| 许可证 | npm 包页标注 Apache-2.0。采纳前需核对选定 tarball 内的 LICENSE、依赖树及分发义务。 |
| 可用 API | 官方入口 `getDocument(src)` 返回 `PDFDocumentLoadingTask`；可传 `data` 并配置 `cMapUrl`、`standardFontDataUrl`、`wasmUrl`、`iccUrl` 等资源。`PDFDocumentLoadingTask.destroy()` 用于中止加载并销毁 worker；`PDFPageProxy` 提供 viewport、render 和 text content API。当前 PDF.js 源码的 `TextLayer({ textContentSource, container, viewport })` 提供 `render()` 与 `cancel()`。这些是官方当前源码/API 文档快照，实际实现必须以最终安装版本的类型定义为准，不能直接照搬旧版 `TextLayerBuilder` 示例。 |
| Runtime | PDF.js 面向浏览器及 Web Worker 的 JavaScript 环境；Vite/Tauri 的 worker URL、MIME、字体和 WebView CSP 行为尚未在 WKWebView、WebView2、WebKitGTK 验证。不能把浏览器支持推断为三个 Tauri 平台通过。 |
| 离线和包体 | Worker 与所需 CMap、标准字体、WASM/ICC 资源必须从同一锁定版本本地打包，禁止 CDN。当前未测 bundle 增量、首次加载、内存或离线。 |
| registry 核验缺口 | 本机 `pnpm view` 未成功取得 registry 响应；没有验证 dist-tag、tarball integrity、最终包内类型/API 与依赖许可证。进入实现前需在可访问 registry 的环境核对并锁定精确版本。 |

官方资料：[npm 包与 license](https://www.npmjs.com/package/pdfjs-dist?activeTab=readme)、[npm 版本页](https://www.npmjs.com/package/pdfjs-dist?activeTab=versions)、[PDF.js 部署与本地资源说明](https://github.com/mozilla/pdf.js/wiki/Setup-pdf.js-in-a-website)、[PDF.js `getDocument` API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html)、[加载任务销毁 API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFDocumentLoadingTask.html)、[页面 API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFPageProxy.html)、[`TextLayer` 当前源码](https://github.com/mozilla/pdf.js/blob/master/src/display/text_layer.js)。网页文档包含 draft/API 变动风险，实施时以安装版本的类型声明与匹配源码为准。

## `@ofdrw/ofdrw-viewer-ui` 与 `@ofdrw/ofdrw-viewer-engine`

| 项目 | 当前核查 |
|---|---|
| 本地依赖 | UI、Engine 和相关 Crypto 包都未出现在 `package.json`/`pnpm-lock.yaml`。 |
| 官方 GitHub `main` manifest 快照 | UI manifest 为 `0.1.2`、MIT、Node `>=22`、React/React DOM peer `>=18`；Engine manifest 为 `0.1.4`、MIT、Node `>=22`。Engine manifest 依赖 `fflate`、`fontkit`、`saxes`；UI 还依赖 Engine、Crypto 和 `fflate`。这些是 GitHub `main` 源码快照，不等同于 npm 发布内容。 |
| npm 发布状态 | 本机 npm registry 查询未完成，不能确认 npm `latest`、对应 tarball 与 integrity 是否等于 GitHub `main` manifest。故 `0.1.2/0.1.4` 只表示仓库源码 manifest 版本，不得当作本机已验证可安装的发布版本。 |
| 版本自洽性 | 同一 GitHub `main` 的 UI API 文档又说 `VERSION` 当前为 `0.1.0`，Engine README 的 CDN 示例固定写 `0.1.7`，与 UI/Engine manifests 的 `0.1.2/0.1.4` 不一致。实现前必须从实际 npm tarball 查 `package.json`、导出版本和依赖范围。 |
| UI API | 官方 README/API 说明有 React `/react` 入口和 `features`/`featureDisplay` 配置。`features.toolbar=false` 可隐藏内置工具栏；`featureDisplay: 'hide'` 可隐藏已关闭的功能入口。`features.find` 是搜索能力，依赖 `textLayer`。React handle 文档列出 `open`、`close`、`goToPage`、`nextPage`、`previousPage`、`setScale`、`setZoomMode`、`setRotation`、`find`、`getState`、`setFeatures`、`getFeatureState`、`isFeatureEnabled` 等控制方法。需核对具体版本签名；隐藏工具栏不代表这些能力不可从 handle 调用。README 还要求显式引入样式并给 viewer 容器确定高度。 |
| React 兼容 | GitHub README 声明 React 18/19；manifest peer 范围为 `>=18`。这不是当前 MdStudio React 19.3/Tauri 环境下的实测结果。 |
| 日语 | UI 文档列出的内置 locale 只有 `zh-CN`、`en-US`；无法识别的语言回退到 `zh-CN`。MdStudio 的 `ja` 不能直接映射为内置日语。通过公开配置完整覆盖第三方 UI 字典的能力尚未验证；稳妥选项是提供并维护日语翻译覆盖（若 API 支持）或采用 Engine 自行实现薄 UI。 |
| Engine API | 官方 README 给出 `OFDDocument.open({source:{kind:'blob', blob:file}})`、`getPage(0)`、`getViewport()`、`page.render(...).promise`、`doc.close()` 的逐页渲染方式；README 也列出 Tauri 示例目录，但不构成 MdStudio 实测。 |
| 真实 OFD 能力 | 未使用真实 OFD 样本验证字体、印章图层、签名、加密、注解、文字检索、损坏文档和压缩炸弹边界。不能将签章外观表述为验签通过。 |

官方资料：[Viewer UI README](https://github.com/ofdrw/ofdrw-viewer/blob/main/packages/ofdrw-viewer-ui/README.md)、[UI API](https://github.com/ofdrw/ofdrw-viewer/blob/main/packages/ofdrw-viewer-ui/skills/API.md)、[UI manifest](https://raw.githubusercontent.com/ofdrw/ofdrw-viewer/main/packages/ofdrw-viewer-ui/package.json)、[Engine README](https://github.com/ofdrw/ofdrw-viewer/blob/main/packages/ofdrw-viewer-engine/README.md)、[Engine manifest](https://raw.githubusercontent.com/ofdrw/ofdrw-viewer/main/packages/ofdrw-viewer-engine/package.json)。

## 运行时兼容与性能待测

| 维度 | macOS | Windows | Linux |
|---|---|---|---|
| PDF.js worker / local assets | WKWebView 未测 | WebView2 未测 | WebKitGTK 未测 |
| OFDRW canvas、字体、压缩包处理 | 未测 | 未测 | 未测 |
| 文件选择、关联、拖放、单实例 | Markdown 当前功能存在；二进制入口未接通 | 同左；PDF 导出代码路径也未实机验证 | Markdown 当前功能存在；当前 PDF 导出明确不支持 |
| 关闭文档资源释放 | Markdown image token/watcher 有管理 | 同左 | 同左 |

在各操作系统的具体 WebView runtime 版本、Worker MIME/URL 行为、Canvas 上限、字体差异、JS/WASM 策略方面，现有本机仓库没有足够证据做通过判定。

## P0 依赖结论

不根据候选 README 直接安装。后续实现前先在可访问 npm registry 的环境取精确版本、tarball integrity、运行依赖许可证清单，并构建最小离线 Tauri POC。OFDRW 官方文档描述了隐藏工具栏和 handle 控制 API，但日语覆盖与 MdStudio 运行时尚未验证；PDF.js Core API 需要由项目补足页管理和 reader UI。

## P2 执行后状态（2026-11-03）

以下为当前工作树的实施事实，覆盖上文“候选依赖未安装”的 P0 审计结论；上文保留作历史记录。

| 项目 | 实际实现与验证 |
|---|---|
| PDF.js 版本 | `pdfjs-dist@6.4.299` 精确版本写入 `package.json` 与 `pnpm-lock.yaml`。运行时从当前安装版本导入，使用安装版本的 `PDFDataRangeTransport`、`TextLayer`、`PDFDocumentLoadingTask.destroy()` 等 API。 |
| 许可证 | 包内许可证为 Apache-2.0；随 PDF.js 运行资源复制到 `public/pdfjs/LICENSE`。 |
| Worker | `pdf.worker.mjs?url` 由 Vite 作为本地 worker 资源构建，无 CDN；worker 输出约 2.23 MB（未压缩）。 |
| PDF.js 资源 | CMaps、标准字体、WASM、ICC 放在 `public/pdfjs/` 并随 Tauri bundle 打包；PDF 主模块按需动态导入。 |
| API 与传输 | PDF.js range transport 通过 Rust `read_pdf_range` command 获取 Raw IPC `Response`，前端收到 `ArrayBuffer`。请求默认按 64 KiB 传输，Rust 限制单次范围 1 MiB，并重复检查路径、文件大小、签名及打开时修改时间。 |
| 实机兼容性 | macOS 本机 `.app` 实际打开中文多页 PDF、文字搜索、缩放/适应、旋转、混合 Markdown/PDF tabs。Windows、Linux WebView 与系统关联未执行。 |
| OFD | 仍未实现；不将 PDF.js 能力推断到 OFD。 |

## P3 OFD POC 实测（2026-11-03）

本节记录 docs/roadmap/multi-format/poc/ 隔离实验。生产依赖、Markdown/PDF 阅读链路和 PDF 导出均未修改。

### 运行环境、依赖和构建

| 项目 | 实测 |
|---|---|
| Viewer UI | @ofdrw/ofdrw-viewer-ui@0.1.7；本地 manifest 为 MIT、Node >=22，React/React DOM peer >=18、Vue peer >=3.3。 |
| Engine | @ofdrw/ofdrw-viewer-engine@0.1.7；MIT、Node >=22；运行依赖含 fflate、fontkit、saxes。 |
| Crypto | @ofdrw/ofdrw-viewer-crypto@0.1.7；MIT、Node >=22。 |
| 环境 | Node v22.20.0、React 19.3.0、Vite 8.3.5、Tauri Rust crate 2.12.3。 |
| 包体 | node_modules 解包目录：UI 7.4 MB、Engine 10 MB、Crypto 3.5 MB；不是应用净增量。 |
| 前端构建 | npm run build 通过；主 chunk 1,522.77 kB / gzip 489.56 kB，超过 500 kB 提示阈值。UI 与 Engine 同时打包，不能归因到单一方案。 |
| macOS 打包 | cargo tauri build --bundles app 通过，release 阶段约 26.80 秒；POC .app 约 9.8 MiB。实际启动在 tauri://localhost。 |
| 其他系统 | Windows/WebView2、Linux/WebKitGTK 未测。 |

版本依据为本地锁定的 npm 安装包与 manifest；POC 开始时查询 registry 的 latest 为 0.1.7。GitHub main 上 manifest/API 文档与 npm 内容曾出现版本不一致，因此本报告不把 GitHub main 当成 npm 发布时间或当前 latest 的证明。官方资料：[UI npm](https://www.npmjs.com/package/@ofdrw/ofdrw-viewer-ui)、[Engine npm](https://www.npmjs.com/package/@ofdrw/ofdrw-viewer-engine)、[Crypto npm](https://www.npmjs.com/package/@ofdrw/ofdrw-viewer-crypto)、[UI API](https://github.com/ofdrw/ofdrw-viewer/blob/main/packages/ofdrw-viewer-ui/skills/API.md)。

### Tauri WebView 实测

- UI wrapper 和 Engine 都在实际 macOS Tauri WebView 中打开官方发票并报告 1 页。
- UI wrapper 的 features.toolbar=false 初始隐藏有效；POC 开关能显示/隐藏工具栏。React ref 缩放效果可见；适应宽度调用成功但未量测最终比例；打开侧栏能看到第 1 页缩略图。
- Engine 实际将页面绘制到 Canvas。二维码、红色椭圆轮廓和表格矢量线条可见；从 100% 增至 110% 后 Canvas 尺寸从 794×529 变为 873×582 CSS px。
- 两种路线均未显示中文正文。首次加载曾报告 W_FONT_MISSING（字体 28 未加载、文字跳过）；通过 find("050001700111") 实测时 UI 返回 W_TEXT_EMPTY。搜索/复制不能标记为通过。
- UI 的签章面板将样本报告为“验证无效”；无信任根时另有 W_CRYPTO_TRUST_UNKNOWN。画面空心红椭圆不证明印章图像或签名正确呈现。
- 打开内置工具栏后，页码、缩放、缩略图等控件存在。POC 的两栏布局无明显遮挡；但没有将第三方 viewer 放入 MdStudio 主界面，因此宿主快捷键、滚动容器和全局 CSS 冲突未测。
- locale 运行切换：zh-CN 与 en-US 工具栏词条可用；选择 ja-JP 后第三方工具栏回退中文。MdStudio 自定义控件本身没有随 package locale 翻译。
- 关闭应用窗口后 POC 进程退出。没有 JS heap、监听器或 document close 的运行时仪表，不能证明逐项资源释放。
- 单次小样本冒烟回调：UI onDocumentOpen 306 ms，Engine 首屏 333 ms；文件 13,584 bytes、1 页，两种 viewer 同时挂载，不能视为性能基线。峰值内存和大文档未测。

样本 hash、来源和许可范围见 poc/SAMPLES.md。当前唯一 OFD 是 OFDRW 官方仓库的 MIT 发票测试资源：16 个 ZIP 条目、解压总量 38,227 bytes、1 页；包含 qr.png 和签章元数据。没有许可证覆盖声明之外的样本集。

### POC 能力状态

| 检查项 | Viewer UI | Engine 自绘 | 判定 |
|---|---|---|---|
| 页数 | 1 页 | 1 页 | 仅当前样本通过 |
| 首屏 | 图形/二维码可见，中文缺失 | 图形/二维码可见，中文缺失 | 内容保真未通过 |
| 翻页 | 样本只有一页 | 样本只有一页 | 多页未测 |
| 缩放 | ref 缩放可操作 | 100%→110%，Canvas 尺寸改变 | 单样本通过 |
| 缩略图 | 显示一页缩略图 | 无 | UI 单页通过，多页缓存未测 |
| 搜索/复制 | find() 返回 W_TEXT_EMPTY | 未实现文字层 | 未通过/未测 |
| 字体 | 观察到字体缺失告警，中文不显示 | 中文不显示 | 回退质量未通过 |
| 图片 | QR 显示 | QR 显示 | 当前样本通过 |
| 印章 | 签章无效；空心椭圆，无确证印章图像 | 同一椭圆轮廓 | 印章兼容未通过 |
| 加密/损坏 | 无样本 | 无样本 | 未测 |
| 清理 | 关闭窗口后 POC 进程退出 | 有取消/close 代码，但无内存测量 | 应用退出通过；资源释放未完全验证 |
| 语言 | zh/en 可用，ja 回退 zh | 自绘可自行翻译 | A 路线日语降级 |
| 样式/快捷键 | 隔离 POC 正常；快捷键未测 | POC 自控 | MdStudio 集成未测 |
| 性能 | 306 ms | 333 ms | 小样本冒烟，非基准 |

### P3 结论与安全边界

推荐 C（暂缓 OFD 生产接入）。现有实测只证明这两套 JS 实现能在当前 macOS WebView 打开一个公开的 1 页发票，并渲染部分非文字元素。不能推断票据、公文、印章、中文字形、加密和损坏文件兼容，也没有证明安全资源限制在恶意输入下有效。详细 Go/No-Go、风险策略及回滚范围见 POC_GO_NO_GO.md。

## P3 字体缺失修复与样本复评（2026-11-03）

此前 P3 表格是初次评估的历史记录。本节追加本轮修复证据，更新生产决策判断；复评仍建议 C / No-Go。

### 缺字根因与回退复测

`ofdrw-invoice.ofd` 有 42 个文本节点，包含发票代码 `050001700111` 与中文正文；`PublicRes.xml` 引用楷体/宋体，但包内没有嵌入字体。未提供其他字体时，Engine 发出 `W_FONT_MISSING` 并跳过字形，导致文字内容无法呈现、文字层为空。给 OFDViewer 的 `fonts.supplementary` 与 Engine `OFDDocument.open({ supplementaryFonts })` 传入本机 Hiragino 字体后，此发票在两个渲染面均能显示中文，UI 搜索代码得到 1 项。脚本测得无回退时 0 项/0 字/2 个缺字告警；有回退时 74 项/564 字/0 个缺字告警。

该回退只验证了一份本机发票和一份本机字体，字体没有捆绑、复制或公开分发。不能当作所有 OFD 都能自动选到正确字体的证明。

### 样本覆盖与实机结果

| 样本 | 结构覆盖 | macOS Viewer UI | macOS Engine Canvas | 当前判定 |
|---|---|---|---|---|
| OFDRW 发票示例 | 1 页、42 TextCode、中文、1 PNG、无嵌入字体 | 无回退字缺；加本机回退后中文可见，搜索发票代码 1 项 | 同样显示中文 | 缺字根因与单样本回退通过 |
| 发票监制章-数科 | 1 页、54 TextCode、中文、1 PNG | 印章图形与文字可见 | 印章图形可见 | 外观样本可见；有 “For Evaluation Only” 水印，不可分发/代表真实验签 |
| 文字横向-数科 | 1 页、18 TextCode、中文、2 个内嵌 TTF | 资源 23 报 `W_FONT_MISSING`，未显示中文 | 显示部分 Latin 测试字样，中文未通过 | 嵌入字体兼容未通过 |
| containsJPEG | 2 页、2 JPEG、无文本 | 识别两页且可翻页；报 `W_IMAGE_DECODE: 渲染已取消`，页面空白 | 图片可见；两页均可翻页 | UI 图片渲染未通过，Engine 多页图片冒烟通过 |
| testImageNotFound | 2 页、11 TextCode、中文、3 TTF、1 图像资源 | 中文文本可读取；报 `W_IMAGE_DECODE: 图片 135 未解码，已跳过` | 读取/绘制首屏 | 缺失资源有显式降级；完整视觉结果未通过 |
| SignScaleError | 2 页、422 TextCode、签章目录 | 样本可打开；本轮未完成人工逐页比对 | 样本可打开；本轮未完成人工逐页比对 | 签章缩放待测 |

六份样本的 ZIP/OFD XML/页数/TextCode/资源和路径结构校验由 `npm run test:samples` 全部通过。结构测试不等于视觉符合或安全攻击测试。样本许可边界见 `poc/SAMPLES.md` 与 `poc/UPSTREAM-SAMPLES-NOTICE.md`。

### 复评结论

- A（Viewer UI）：发票在指定系统字体下可读可搜；双页 JPEG 空白、嵌入字体中文缺失，因此暂不满足可作为唯一生产 reader 的条件。
- B（Engine）：发票回退和 JPEG 多页图片路径能显示；没有选择/复制/搜索 UI，中文字形样本仍不完整，生产成本与风险更高。
- C（暂缓）：继续推荐。仍缺授权票据、公文、明确授权的 CJK 字体、加密/损坏/ZIP bomb/大文件样本，且 Viewer UI 图片空白的 `OFD_ABORTED` 渲染告警尚未追根修复。Windows、Linux、内存峰值均未测。

自动测试与构建：样本校验、字体回退 Node 验证、TS/Vite build 均通过；macOS Tauri app build 通过。Vite 主 chunk 1,524.98 kB（gzip 490.26 kB）并出现 >500 kB 提示。此 build 数字同时包含 UI 和 Engine，不能用作任一生产方案的净增量。

## P3 本轮复验补充（2026-11-03）

本轮依据 P2 已验收记录启动，只重跑隔离 POC 检查与构建，不改变生产依赖或阅读主线。此处把本轮自动结果与此前真实桌面证据分开记录。

### 本地包约束与 API

| 包/检查 | 本机锁定事实 | 验证边界 |
|---|---|---|
| `@ofdrw/ofdrw-viewer-ui` | 0.1.7；manifest `MIT` 且含 `LICENSE`；Node `>=22`；React/React DOM peer `>=18`、Vue peer `>=3.3`。 | 本地 manifest 已核；没有本轮 registry latest 响应，不能称为当前最新版本。 |
| `@ofdrw/ofdrw-viewer-engine` | 0.1.7；MIT；Node `>=22`；直接依赖 `fflate`、`fontkit`、`saxes`。 | 本地类型声明/POC 构建与 Canvas 实验核验；完整依赖许可证清单未审。 |
| `@ofdrw/ofdrw-viewer-crypto` | 0.1.7，作为 UI 传递依赖；MIT；Node `>=22`。 | 本地锁定依赖版本；未验证完整密码学签名兼容矩阵。 |
| Viewer UI API | `./react` 为 `forwardRef`；handle 包含 `close`、页码/前后页、缩放/旋转、`setFeatures`、`find` 和状态查询；`features.toolbar=false`。 | API 来自已安装 `.d.ts`；隐藏工具栏、ref 控制在此前 macOS Tauri WebView 实测通过。 |
| Runtime/build | Node 22.20.0、React 19.3.0、Vite 8.3.5、Tauri crate 2.12.3；未使用 JVM/远程服务。 | macOS POC build；Windows WebView2、Linux WebKitGTK 未验证。 |

### 复验项目矩阵

| 项目 | Viewer UI | Engine Canvas | 本轮判定 |
|---|---|---|---|
| 包中的 `OFD.xml`/ZIP 校验 | 不由组件自动替代生产安全入口 | 同左 | 6 份隔离样本离线结构脚本通过；ZIP bomb/异常压缩和恶意 XML 未测。 |
| 电子发票页数/首屏 | 单页样本；系统字体回退后中文可见 | 同样能显示回退后的中文 | 此为此前 WebView 实测；无回退中文丢失，不满足默认阅读。 |
| 多页/翻页 | 双页 JPEG 页码可变化，但内容空白并报 `W_IMAGE_DECODE: 渲染已取消` | 两页图像可见并能翻页 | UI 未通过；Engine 仅样本冒烟通过。 |
| 缩放/适应与旋转 | 本地 ref 类型存在；此前缩放/适应调用有效 | Canvas 缩放可见改变 | 普通样本操作通过；旋转/极端边界完整性未测。 |
| 缩略图 | 此前单页缩略图显示 | 无内置缩略图 UI | 多页缩略图和缓存上限未测。 |
| 搜索 | 发票在用户选择系统字体回退后查询命中 1；无字体时 `W_TEXT_EMPTY` | 没有文字搜索层 | 有条件部分通过；不能称为默认可搜。 |
| 文字选择/复制 | 未证明复制成功 | 无文本层 | 未测/未实现。 |
| 字体 | 无回退发票缺字；回退修复该样本；嵌入字体样本仍缺中文 | 同左样本中文字形仍不完整 | 未通过跨样本兼容。 |
| 图片/印章 | 发票二维码和评估水印印章图形可见；JPEG viewer 页面空白 | 二维码/JPEG/印章图形样本可见 | 部分通过；印章显示不等同签名验证。 |
| 损坏/加密容器 | 无授权样本 | 无授权样本 | 未测。 |
| 关闭清理 | 关闭应用后进程退出 | `close` API 存在 | 只证明进程退出，未测每个 task/listener/内存回收。 |
| 性能/大文件 | 历史小样本 306 ms 回调，不是基线 | 历史 333 ms 首屏回调，不是基线 | 本轮未重新计时；峰值内存和大文件未测。 |
| CSS/快捷键/滚动 | 隔离双栏无明显冲突；并未嵌入 MdStudio 主阅读器 | 独立 Canvas 容器 | 与主应用 CSS、快捷键、滚动容器冲突未测。 |
| i18n | zh/en 可用；ja-JP 回退中文 | 自绘 UI 可自行本地化，尚无生产集成 | UI 日语未通过。 |

本轮 `npm run test:samples`、`npm run test:font-fallback`、`npm run build` 与 macOS `cargo tauri build --bundles app` 均通过；Tauri release 构建耗时 25.27 秒，日志有 `STATIC_VCRUNTIME` 弃用警告。前端主 chunk 1,524.98 kB（gzip 490.26 kB），仍有 Vite chunk 警告。重打包后因 Mac 锁屏未能重新操作窗口；实际桌面行为沿用上表明确标注的此前实测。安全设计中的 ZIP entry/展开上限、路径规范化、DTD/实体拒绝、Canvas 像素预算、Worker 超时/内存策略仍属待验证设计，不计为安全测试通过。

**技术复验结论：A、B 均未达到生产兼容门槛，原始建议为 C / No-Go。** 缺少票据、公文、损坏/加密/恶意压缩和大文件样本；Viewer UI 图片空白、内嵌字体缺字及文字复制不确定未解决。不能据结构脚本通过推断完整阅读兼容或生产安全。

## P3 决策变更（用户指示，2026-11-03）

本节是当前项目决策，覆盖本文早先的 C / No-Go 建议，但不覆盖或改写测试结果。用户明确要求将 P3 改为 Go。当前方案更新为 **A：Viewer UI，有条件进入 P4 MVP**。理由是其 React ref、工具栏关闭、页码/缩放控制和基础查找接口已在当前 POC 核验；B 还需另建文字选择/复制/搜索和缩略图交互。

该规划决策不改变上方技术测试结果：图片空白、内嵌字体缺字、样本许可与类型缺口、文字复制和安全攻击测试仍未通过或未测。P4 必须逐项解决或明确降级，不能静默显示空白；未验签时只能提示“签章未验证”。本轮仅更新决策文档，P4 尚未启动，OFD 仍不属于生产支持格式。

## P4 Reader MVP（生产接入审查，2026-11-03）

用户后来明确接受 P3 A 路线并要求进入 P4。下表是当前工作树 P4 实际实现的核验，不追溯更改 P3 的历史缺陷记录。

| 能力/风险 | 当前实现与测试 | 结论 |
|---|---|---|
| 类型检测与读取边界 | Rust 统一识别 `.ofd`；仍由 `load_reader_document` 拒绝 PDF/OFD。OFD 经 `inspect_ofd_document` 验证后由 Raw IPC `Response` 返回原始字节，不编码为 JSON 数组。 | 自动测试通过；不走 Comrak。 |
| ZIP / OFD XML | 中央目录校验、ZIP CRC、唯一条目名、压缩方式与展开上限；检查根 `OFD.xml`、`DocRoot` 和页面数量；拒绝路径穿越、绝对/反斜线路径、链接、重复条目、Zip64 sentinel、加密标志、DTD/未知实体。 | Rust 合成归档测试通过；没有真实恶意 ZIP bomb 或复杂变体攻击集。 |
| 资源额度 | OFD 文件 ≤128 MiB；≤10,000 个 ZIP 条目；每项 ≤64 MiB；总展开 ≤256 MiB；XML 单项 ≤8 MiB、合计 ≤32 MiB；压缩比 ≤200；≤20,000 页。Viewer 每页 ≤16 MP/边长 ≤8192、并发 1、缓存最多 4 页/48 MP。 | 代码约束存在；峰值内存/大文件性能未实测。 |
| 页面/标签生命周期 | Adapter 管理 `DocumentSession`；页码、缩放、旋转写入 V2；tab 切换卸载并关闭 Viewer；关闭活动 OFD tab 先等待 Viewer `close()` 再清零读取缓冲。 | 自动组件和 app tab 测试通过；桌面内存回收未测。 |
| 页码、缩放、适合宽度、旋转 | 集成现有顶部单行工具栏，调用已安装 0.1.7 React handle 的 `goToPage`、`setScale`、`setZoomMode('page-width')`、`setRotation`。 | 实机看到 1/1、100% 与控件；单页翻页禁用符合预期。缩放/适应/旋转的动作效果未手测。 |
| 搜索/选择/复制 | Viewer `find` 和 text layer 按需使用共享搜索框；未开放文字选择/复制。 | 搜索框显示 0/0，但样本字体缺失且 WebView 自动化无法输入查询词（`AXError.cannotComplete`），结果未验证。复制关闭。 |
| 印章/验签 | 保留 viewer 的签章绘制功能；关闭 verifier 入口并显示“签章未验证”。 | 未做密码学验签；视觉印章正确性尚需授权样本对照。 |
| 字体/图像/页面错误 | 接收 Viewer `onWarning`/`onError`，显示诊断码、消息和重试；ZIP/OFD 容器错误在打开前拒绝。 | 实机诊断报告字体 28/4 未加载及 `FontName=楷体` 缺失，但发票中文正文全部缺失；二维码、线框及红色签章轮廓可见，另见空图像占位符。告警虽可见，主要内容仍不可读。 |
| 主题/语言 | Viewer 跟随 MdStudio 深浅主题；英语映射到 `en-US`，中文和日语当前映射 `zh-CN`。 | 英文第三方文案可用；日本语不支持，仍降级为简体中文。 |
| 离线 | Viewer 收到本地 IPC 字节，NPM CSS/JS 随 Vite 打包；没有提供 HTTP/URL 文档源或 CDN。 | 代码检查确认无网络源；切断网络的桌面检查尚未完成。 |
| 样本/对照 | P3 的只读公开发票样本 SHA-256：`f52f1df911c3d84943a7699fc517a528560e9e492082e72ee65d5ef5df8ad976`。Rust 测试检查页数/签章元数据且确认原始字节未变。 | 实机人工对照已执行：页面、二维码、线框、签章轮廓可见，中文内容因缺字体失败；签章标签正确标为未验证。截图在本次桌面会话展示但未保存到仓库。其它 P3 样本的再分发权未确认，未加入发行资源。 |
| macOS 构建 | 当前 P4 `.app` Debug 构建成功，49.65 MiB；默认 DMG `hdiutil` 设备未配置失败。 | `.app` 通过，DMG 失败。窗口实测发现中文正文缺失；缩放/旋转动作未验。 |
| Windows/Linux | 当前环境无 Windows/Linux 主机。 | 未构建、未实测。 |

## P5 统一体验回归（2026-11-03）

| 项目 | Markdown | PDF | OFD | 判定/边界 |
|---|---|---|---|---|
| 单行顶栏 | 原目录、主题、搜索与历史导航保留 | 页码/缩放/适合/旋转使用共享顶栏 | 使用共享顶栏；第三方 chrome 隐藏 | 自动组件测试通过；macOS P5 窗口行为未确认。 |
| 搜索与多标签状态 | 原文内搜索和每标签 query 延续 | PDF text layer 搜索，pending 按 tab 分离 | Viewer 本地 find 能力，pending 按 tab 分离 | 竞态自动测试通过；真实 OFD 中文样本搜索内容仍受缺字问题影响。 |
| 目录/页面导航 | Markdown 标题目录 | PDF outline 可用则显示；否则显示附近页缩略图 | Viewer outline 可用则显示；否则显示附近页缩略图 | PDF outline 与缩略图逻辑自动覆盖；OFD 真实大纲样本覆盖不足。 |
| 缩放/阅读宽度 | 字号倍率与全局宽度设置 | 页面倍率独立，阅读容器使用同一宽度设置 | 页面倍率独立，阅读容器使用同一宽度设置 | reducer/component tests 通过；跨平台 UI 动作未实测。 |
| 日本语 UI | MdStudio i18n | MdStudio i18n | 第三方未完整 ja-JP UI 隐藏；常见诊断翻译，未知诊断只呈代码及本地化说明 | 日文组件测试通过；第三方 Canvas 内部兼容与字体不因 UI 翻译解决。 |
| 打开/最近/恢复/文件传递 | 既有流程保留 | 共用选择器、拖拽、会话、recent、系统关联/single-instance | 同上 | 自动路径测试覆盖；本轮 macOS 打开 PDF 未确认；Windows/Linux 未测。 |
| OFD 正文兼容 | 不适用 | 不适用 | P4 发票中文缺失、图片/内嵌字体兼容风险持续存在 | **阻塞**。P4 人工验收未消除该技术缺陷。 |
| 平台 | macOS 构建通过 | macOS Debug `.app` 构建通过；本轮窗口打开行为未确认 | macOS `.app` 通过；历史中文缺失 | Windows 与 Linux 均未构建或实测。 |

完整 P5 结果见 [P5 验收记录](P5-acceptance.md)。

**当前兼容判定：P4 阶段为 blocked。** 自动回归通过，但实机确认样本的中文正文完全缺失；搜索结果未验证，断网离线操作也未执行。诊断没有被静默吞掉，但这不足以使发票阅读可用。P3 双页 JPEG Viewer UI 空白仍未复测；任何测试覆盖外 OFD 均不能据此承诺兼容。
