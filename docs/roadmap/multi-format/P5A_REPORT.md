# P5-A macOS 桌面原生窗口融合报告

日期：2026-11-03  
目标版本：0.1.9（本阶段未改版本号）  
状态：`awaiting_acceptance`（P5-A 实现与自动化通过；窗口拖动位移和窄窗实测仍需人工确认）

## 审计结论

- 工作树已有大量未提交的 P1-P5 用户改动。本次只增量修改窗口顶栏、响应式样式、顶栏测试、Tauri 窗口配置和拖动权限；未清理或重置其他改动。
- 当前 Tauri 2 窗口已使用 `titleBarStyle: Overlay`、`decorations: true`、`hiddenTitle: true` 和原生 `trafficLightPosition`。关闭、最小化、全屏按钮继续由 macOS 绘制。
- PDF、OFD 与 Markdown 继续复用现有单行顶栏和阅读器；本次未触及三种格式的解析、渲染或会话代码。
- P5 总阶段仍受已知 OFD 中文正文缺失、Launch Services 冷/热启动和其他未测项阻塞。本报告只评估 P5-A，不代表 P5 整体验收。

## 本次变更

- 将 macOS 顶栏设为 `data-tauri-drag-region="deep"`。Tauri 2.12 的拖动脚本要求父级区域使用 `deep` 才会覆盖非交互子元素；可点击的按钮、链接和标签仍由 Tauri 作为交互元素排除。新增 `core:window:allow-start-dragging` capability。
- 设置窗口 `acceptFirstMouse: true`，让非活动窗口上的首击能交给 WebView，避免 Overlay 拖动因窗口激活首击被系统吞掉。
- macOS 桌面将次要阅读操作收进现有“更多”菜单，主行保留文档标签、页码/缩放、后退前进、刷新和搜索。适宽、整页、旋转、页面导航、主题和设置仍可从菜单访问。
- 窄屏使用既有更多菜单和响应式断点；PDF/OFD 的适宽、整页和旋转没有再被窄屏样式隐藏。
- 顶栏组件测试覆盖 macOS 深层拖动区域标记、平台布局差异和 PDF/OFD 菜单回调。

## 自动化与构建

| 验证 | 结果 |
|---|---|
| `pnpm test` | 通过：24 个测试文件、163 项通过、0 失败；本轮最终运行 38.02 秒。jsdom 对 Canvas `getContext()` 的提示属于测试环境限制。 |
| 顶栏定向测试 | 通过：`AppHeader.test.tsx` 4 项通过。 |
| `pnpm build` | 通过：TypeScript 与 Vite 生产构建完成，Vite 4.74 秒。保留已有 CSS `::highlight` 解析提示和 OFD 大分包提示。 |
| `cd src-tauri && cargo test --locked -j 1` | 通过：41 项通过、0 失败；首次单独编译约 64 秒，测试 0.98 秒。与 Tauri 构建并行的首次运行曾异常退出，串行重跑通过。 |
| `pnpm tauri build --debug --bundles app` | 通过：生成 `src-tauri/target/debug/bundle/macos/MdStudio.app`，49.67 MiB；最后一次构建约 26 秒。 |
| `git diff --check` | 通过：无空白错误。 |

构建保留已有 `is_markdown_file` dead-code 警告。Tauri Debug 构建仍显示既有 CSS 解析与大 chunk 提示，没有新增构建错误。

## macOS 桌面验证

| 项目 | 结果 |
|---|---|
| 最新 `.app` 启动与原生按钮 | 已启动。AX 树仍包含原生 close、full screen、minimize 控件；屏幕截图中它们与 Logo、标签及工具栏在同一行。 |
| 顶栏布局 | 已确认单行，没有第二行工具栏。macOS 精简菜单包含适宽、整页、旋转、页面导航、主题和设置。 |
| Markdown/PDF/OFD 混合标签 | 已打开并切换三种格式。Markdown 正常渲染；6 页中文 PDF 显示正文；OFD 页框架、二维码和印章可见，签章明确标记“未验证”。OFD 中文正文仍被缺失字体跳过，属于已知 P4 缺陷。 |
| PDF/OFD 主控件 | 已确认顶栏有共享页码/缩放控件；更多菜单可打开。 |
| 全屏 | 已通过原生全屏按钮进入，并用 macOS“视图 → Toggle Full Screen”退出。全屏时工具栏和正文仍可见，没有观察到裁切；退出后原生按钮恢复。 |
| 窗口拖动 | 已在顶栏空白处发起桌面拖动操作；自动化接口没有暴露窗口屏幕坐标，截图只返回窗口内容，因此无法据此确认窗口位移量。本次按 Tauri 2.12 官方拖动机制修正 `deep` 区域和首击行为，但不把位移标成实测通过。 |
| 窄窗口/调整尺寸 | 响应式 CSS 断点已确认：窄屏次要动作进入“更多”，页码/缩放保持可用；桌面接口无法提供窗口边界的可靠尺寸读数，本轮未完成人工窄宽窗口验收。 |

## 未完成验证与已知限制

- macOS 窗口拖动的实际位移、窄宽窗口尺寸适配仍需人工目视确认。当前实现依据 Tauri 2.12.5 注入脚本对 `data-tauri-drag-region="deep"` 的定义和官方 `acceptFirstMouse` 窗口选项；参考 [Tauri Window Customization](https://v2.tauri.app/learn/window-customization/) 与 [Tauri WindowConfig](https://v2.tauri.app/reference/config/#windowconfig)。
- Windows/Linux 未构建、未实测；本次仅调整 macOS 条件化菜单样式和共享窗口能力。
- OFD 样本仍缺中文正文，因为样本声明楷体但未包含字体；本阶段没有修复该兼容性问题。
- 既有 Markdown→PDF 导出阻塞未修改，也没有声称已修复。
- Launch Services 的系统 Open With、冷/热启动参数和 single-instance 转发仍是 P5 总阶段的未解决项。

## 回滚

回滚本阶段时，只撤销以下文件中本阶段对应的增量：

- `src/components/layout/AppHeader.tsx`
- `src/components/layout/AppHeader.test.tsx`
- `src/styles.css`
- `src-tauri/capabilities/default.json`
- `src-tauri/tauri.conf.json`

不要重置整个工作树。`tauri.conf.json` 与 capability 文件包含此前阶段的用户改动，应只移除本阶段新增的 `acceptFirstMouse` 和 `core:window:allow-start-dragging`，并恢复顶栏本次差异。
