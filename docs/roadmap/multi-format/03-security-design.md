# 多格式阅读器安全设计基线

审计日期：2026-11-03。本文记录当前 Markdown 实现的安全边界和未来 PDF/OFD 阶段的门槛；本轮未改权限、CSP 或解析实现。

本文件区分当前 Markdown 已有边界与未来 PDF/OFD 开发前的安全要求。它是审计设计记录，不是对 PDF/OFD reader 的安全认证；本阶段没有加入任何读取能力或放宽权限。

## 当前 Markdown 安全边界

| 边界 | 当前实现位置与行为 | 限制/证据范围 |
|---|---|---|
| 只读源文件 | `reader::load_document` 读取并在内存解析；设置、tab、搜索和阅读位置写 localStorage | Rust 测试校验源 Markdown 未被修改；不是操作系统层面的只读句柄。 |
| 文档类型、路径、体积 | `reader.rs` 只接受 `.md/.markdown`，canonicalize，要求普通文件/有效 UTF-8，文档上限 64 MiB | 当前工作树新加 `documents.rs` 可识别 PDF/OFD 扩展名，但只做路径/元数据检查；没有二进制内容校验。 |
| Markdown HTML | Comrak `unsafe=false`，随后由 Ammonia allowlist 清洗 | 不信任 Markdown 内任意原始 HTML；没有放宽全部 HTML/SVG 标签。 |
| URL | 清理 `href/src`；片段、受控相对 Markdown 资源和经过检查的 HTTPS 链接分开处理 | `javascript:` 等危险协议被移除；HTTPS 仅在用户点击后由系统浏览器打开。 |
| 本地相对资源 | percent-decode 后相对文档目录解析；拒绝绝对路径、NUL、冒号、`..`/canonicalize 逃逸和外部图片 | 图片由 Rust 再验证 token、扩展/MIME/签名、长度与像素阈值；不是给 WebView 任意 file URL 权限。 |
| 图片资源上限 | 单图最多 20 MiB、文档累计最多 40 MiB、64,000,000 像素 | 详见 `reader.rs` 和测试；并不覆盖 PDF/OFD 解析资源预算。 |
| CSP | `tauri.conf.json` 当前：`default-src 'self' asset:`；`img-src 'self' data:`；`font-src 'self' data:`；`style-src 'self' 'unsafe-inline'`；`script-src 'self'`；`connect-src ipc: http://ipc.localhost` | 没有在 P0 开 `worker-src *`、任意远程脚本或任意网络连接。PDF.js Worker 还需在真实 bundle 环境设计 CSP。 |
| Tauri capability | `capabilities/default.json` 允许 core 默认、window close/destroy、dialog open/save | 未发现通用文件系统访问 capability；Rust commands 是受限读文件入口。 |
| 外链 | opener 关闭自动打开 JS 链接，React 调用自定义 URL 检查后再交给系统 | 不自动打开 Markdown 中的链接。 |

上述是源码和已有自动测试审计，不是独立渗透测试，也未对攻击样本作完整 fuzzing。

## PDF reader 的安全边界（实施前门槛）

1. **授权路径**：只能从用户选择、明确拖放、OS open event 或已授权会话得到路径。Rust 侧 canonicalize、检查普通文件、大小、PDF 签名字节；不得让 React 从 Markdown 控制的 `file://` 路径读取文件。
2. **字节通道**：PDF.js 接收受控 `Uint8Array` 或经授权的读取通道。评估 Tauri IPC 拷贝、生命周期、取消、每文档内存上限；不能将全盘 asset protocol 暴露给 WebView。
3. **Worker/资源**：API 与 Worker 必须使用同一精确 lock 版本，Worker、标准字体、CMap、WASM、ICC 等如有需要须本地打包。显式验证实际请求目标，保持 CSP 最小化。
4. **内容主动性**：禁用/不实现 PDF JavaScript、附件自动执行、网络资源自动加载。URI annotation 仅显示安全跳转提示或走 HTTPS allowlist 的系统打开命令。
5. **资源与取消**：限制文档最大字节数、页数、单页 Canvas 像素、同时渲染数及累计缓存；关闭 tab 时取消 RenderTask、销毁 PDFDocumentProxy/worker、释放 Canvas/监听器。
6. **错误与来源**：损坏/加密/不支持的文件给出明确提示；不静默改写源 PDF。读取前后源哈希相同。

## OFD reader 的安全边界（实施前门槛）

1. **容器解析**：OFD 是压缩容器输入。限制条目数、单条目/总解压大小、压缩比、路径深度和总耗时；拒绝绝对条目名、`..`、重复关键条目及符号链接逃逸。
2. **信任域区分**：OFD 页面、XML、字体、图片、注释、附件、印章和签名都视为不可信输入。禁止外部 XML 实体、脚本、外链资源的自动解析。
3. **签章展示**：页面中的印章外观不等于签名验证。没有合适的密码学算法、根证书配置、证书链和撤销策略，不得显示“签名有效”或暗示法律效力。
4. **Viewer 接口**：隐藏第三方 toolbar 是 UI 选择，不是安全权限边界。检查 viewer 的打印、下载、附件导出、本机字体授权、网络字体和外部请求，并逐个决定是否启用。
5. **依赖来源**：基于实际 npm tarball 与 lockfile 审许可证、transitive dependencies、integrity 和发布版本；不能只信 GitHub `main` 文档或在线演示。

## 威胁与控制映射

| 威胁 | 控制方式 | 验收方式 |
|---|---|---|
| Markdown/文档内容执行脚本 | Ammonia、协议 allowlist；PDF/OFD 不通过 Comrak/innerHTML 任意渲染 | XSS fixture、`javascript:`/data URL fixture、实际 WebView 控制台观察 |
| 路径穿越与越权本地读取 | Rust canonical path + 文档根限制 + type-specific command | `%2e%2e`、符号链接、绝对路径、非授权同目录/跨目录样本 |
| PDF/OFD parser 资源耗尽 | 类型签名、大小/页数/解压/Canvas/并发预算，取消语义 | 超大文件、巨页、压缩炸弹、过多对象和关闭 tab 压力样本 |
| 外部网络泄漏 | Reader 默认离线、资源本地打包、禁止自动外链/图片请求 | 网络面板/代理日志离线验收，无意外 DNS/HTTP 请求 |
| Viewer 生命周期泄露 | session close 时 cancel/destroy worker、renderer、事件监听 | 多轮打开/关闭并检查 heap、worker 与监听器数量稳定 |
| 文档原文被改变 | 仅打开/读取 API，不复用保存接口 | 阅读前后文件字节哈希完全相同 |

## P0 变更边界

P0 仅审计和更新路线文档。本次没有改 CSP、Tauri capability、文件关联、Rust 路径权限或 HTML sanitizer，也没有加入 PDF/OFD 解析依赖。安全门槛必须在实现阶段通过测试验证，不能据此宣称未来 reader 已安全。

## P2 PDF Reader 当前控制（覆盖上文 P0 的 PDF 实施前状态）

- **依赖与资源**：精确锁定 `pdfjs-dist@6.4.299`，Apache-2.0。PDF.js 按需动态导入；worker 用 Vite `?url` 打包；CMap、标准字体、WASM、ICC 从 `public/pdfjs/` 本地资源读取，无 CDN。
- **路径与格式**：Rust 对用户授权打开的路径 canonicalize，要求普通 `.pdf` 文件，限制 256 MiB，并检测 `%PDF-` 签名。PDF 字节不会传入 Comrak。
- **二进制传输**：不返回 JSON 数字数组。Tauri command 返回 `tauri::ipc::Response::new(Vec<u8>)`；单段最多 1 MiB，循环读取块 64 KiB。每段重新验证 canonical path、文件长度、修改时间和签名；文件变化时拒绝后续字节。
- **取消**：每个 range 请求有不透明 UUID；Rust registry 支持活动及早到取消，读取循环检查原子取消标志。关闭 tab 会销毁 PDF.js loading task/document/worker、取消 range 请求和 render task，并清理 TextLayer 和画布。
- **渲染预算**：只绘制可见页与视口上下 600 CSS px 邻近页；单页 canvas 采样预算 4,000,000 像素、device scale 上限 2。离开缓存范围时释放画布和文本节点。
- **内容行为**：不调用 PDF JavaScript，不自动处理附件或外链，不联网，无 OCR。加密 PDF 目前明确提示不支持密码输入，保留原文件。
- **权限/CSP**：PDF 资源从本地 Tauri bundle 提供，连接范围保持 Tauri IPC；未开放通用文件系统 capability，读取只能通过专用 Rust commands。
- **安全验证范围**：自动测试覆盖路径签名、文件大小/范围、文件变化/取消、扫描/加密/损坏 fixture 的处理；尚未做 PDF.js fuzzing、恶意 PDF 专业审计、网络代理捕包及 Windows/Linux WebView 验证。
