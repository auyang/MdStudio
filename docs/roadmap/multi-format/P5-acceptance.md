# P5 Unified Experience 验收记录

日期：2026-11-03  
目标版本：0.1.9（不改版本号）  
阶段门槛：P4 已由用户明确验收；其已知 OFD 兼容问题仍保留在风险中。

## 实现

- PDF 与 OFD 使用同一单行顶栏：页码输入、上一页/下一页、放大/缩小、适合宽度、整页、旋转和重置倍率。PDF Viewer 内部工具栏已移除；OFD Viewer 的内置 toolbar/sidebar/dialog/toast 隐藏，避免双工具栏和未翻译第三方 UI。
- 搜索和导航入口由当前文档能力决定。Markdown 继续使用目录；PDF 导航面板提供书签大纲（存在时）和当前页附近最多五张缩略图；OFD 使用可用 outline，否则提供当前页附近最多五页缩略图。
- 搜索状态和阅读位置分别属于当前标签。异步搜索的 pending 状态按 tabId 记录，关闭标签清理；旧标签迟到的完成事件不会覆盖当前标签的等待指示。
- Markdown 字号、PDF/OFD 页面倍率分开保存；快捷键重置作用于当前文档的对应倍率。阅读宽度仍沿用共用设置。
- OFD 的日文可见控件、导航和签章提示使用 MdStudio 翻译；Viewer 的非日文完整第三方资源不再以 `ja-JP` 模式显示。日文诊断显示已翻译的常见错误摘要；未知项显示日文说明和诊断码，不显示原始未翻译消息。
- 文件选择器接受 `.md`、`.markdown`、`.pdf`、`.ofd`；最近文件、拖拽、会话恢复、启动路径、系统关联、watcher 和 single-instance 继续复用已有调用链。

## 自动验证

| 项目 | 结果 |
|---|---|
| 前端全量测试 | `pnpm test`：24 个测试文件、161 项通过，0 失败；64.48 秒。覆盖混合标签、共享 toolbar、单一导航面板、PDF 文件选择、独立搜索状态/旧回调、PDF 保存页码重新挂载恢复、日文诊断。 |
| Rust 回归 | `cargo test --locked`：41 项通过，0 失败；Rust 单元测试 3.00 秒，首次重编译 58.41 秒。P5 未改 Rust 源码；有 `is_markdown_file` dead-code 警告。 |
| 前端生产构建 | 单独运行 `pnpm build` 通过；实测约 11.01 秒，Vite 4.20 秒。独立构建 OFD Viewer chunk 1,298.53 kB（gzip 418.77 kB），本地 PDF worker 2,229.71 kB。保留 CSS `::highlight` 警告。 |
| macOS Debug app | `pnpm tauri build --debug --bundles app` 通过；Tauri 集成 Vite 3.23 秒、Rust 增量编译 34.40 秒；产物 49.67 MiB，路径为 `src-tauri/target/debug/bundle/macos/MdStudio.app`。该 Debug sourcemap 构建中的 OFD Viewer chunk 为 2,410.79 kB（gzip 631.84 kB，另有 4,304.73 kB sourcemap）。 |

## 桌面和平台状态

- macOS：从指定 Debug `.app` 路径启动成功。原生文件选择器打开 OFD 样本成功；Markdown、PDF、OFD 在同一窗口多标签并存。截图检查确认顶栏单行且无 PDF/OFD 第二套工具栏；PDF 页码、缩放、适宽/整页、导航面板和文字层可用。PDF 搜索高亮可见；Markdown 与 PDF 的搜索状态互不覆盖。把 PDF 跳转到第 3 页后切到 Markdown 再返回，页码与视口恢复为第 3 页；应用会话中的既有标签也能恢复。一个 PDF 搜索样本和一个 Markdown fixture 通过窗口实际读取。
- macOS OFD：共享顶栏与导航入口正常，第三方 toolbar 不可见；打开 `ofdrw-invoice.ofd` 后正文为空。诊断提示缺失楷体/页面字体且文本被跳过，签章标签明确为“签章未验证”。该实际失败仍是 P5 的关键阻塞。
- macOS OS 集成：bundle path 启动与原生文件选择器已测；`open -n` 和 `open -a <app> <file>` 均返回 `kLSNoExecutableErr`；`Info.plist` 指向的 `mdstudio` arm64 可执行文件存在，Launch Services 报错原因未确定。系统 Open With、冷/热启动文件参数、single-instance 转发及拖放路径未完成桌面实测。
- Windows：未构建、未实测；WebView2、多选/拖拽、文件关联和 single-instance 路径未核验。
- Linux：未构建、未实测；WebKitGTK、桌面文件关联和 single-instance 路径未核验。
- 自动用例覆盖搜索竞态、PDF 标签关闭时 range 请求取消和加载任务销毁、OFD 字节清理；尚未做长时间连续开关标签的资源压力测试或峰值内存采样。jsdom Canvas `getContext` 提示属于模拟环境能力限制，不等于桌面 Canvas 失败。

## 已知限制与风险

1. P4 的本机 OFD 发票样本仍存在中文正文缺失；Viewer UI 对双页图片、嵌入字体的兼容问题仍未解决。P4 用户验收只是阶段决策，不代表这些缺陷被修复。OFD 核心阅读能力是三格式统一主流程的已知功能阻塞。
2. 系统 Open With、冷/热启动参数和 single-instance 文件转发没有在 macOS 真实系统流程中验证；`open -n` 与 `open -a <app> <file>` 均返回 `kLSNoExecutableErr`。
3. Windows/Linux、三格式持续打开/关闭压力、完整键盘焦点矩阵和峰值内存均未实测。
4. 构建仍有 CSS `::highlight` 警告和超过 Vite 默认阈值的分包。独立生产构建 OFD Viewer chunk 约 1.30 MB（gzip 419 KB）；Tauri Debug sourcemap 构建约 2.41 MB（gzip 632 KB），PDF worker 约 2.23 MB。
5. Markdown→PDF 导出阻塞是已记录的旧问题，不属于 P5，未修改或宣称修复。

## 结论

共享阅读控件、能力驱动入口、各格式独立的倍率/标签状态，以及日文第三方文案隔离已实现并有自动回归。macOS 窗口已确认 PDF/Markdown 混合阅读、PDF 页码位置恢复和 OFD 统一入口；OFD 正文仍因缺字为空白，且 OS 文件关联/单实例与 Windows/Linux 尚未实测。P5 状态为 **blocked**，停止在本阶段，等待后续解除阻塞和验收；不自动进入下一阶段。
