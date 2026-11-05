# V03-P1 文件夹工作区交付报告

## 本次交付

- 在顶部工具栏和首页增加文件夹工作区入口；用户仍可只用单文件打开。
- 通过 Tauri 原生目录选择器选一个根目录。
- 新增 Rust 工作区服务：登记根目录、即时子项枚举、文档类型过滤、目录优先排序、2,000 项截断、路径边界和符号链接保护。
- 将历史完整树 `FileTree` 改为按需展开加载；支持根目录刷新、活动 tab 高亮、收起/展开、可拖动宽度（180–420 px）及偏好持久化。
- 新建空 Markdown 文件走 Rust `create_new` 安全接口，已存在文件不会覆盖，再通过既有 Markdown reader 打开。
- PDF/OFD 可从目录树打开并使用既有只读 Viewer；没有编辑入口。
- 新增简体中文、英文、日文工作区文案。
- 没有新增依赖、改发布版本、改标签或重构阅读器。

## 自动测试和构建

- `pnpm test`：26 个测试文件、176 项通过，0 失败，27.66 秒。包含 workspace prefs、懒加载组件、原多格式打开流程集成与收起后保留树状态。
- `pnpm build`：TypeScript 与 Vite 通过，Vite 8.3.5 构建 2.02 秒。
- `cd src-tauri && cargo test --locked`：54 项通过，0 失败；单元测试 1.00 秒，编译 26.35 秒。
- `cargo fmt`：通过。
- `pnpm tauri build --debug --bundles app`：macOS Debug `.app` 构建成功，bundle 51.04 MiB，Rust 构建 22.04 秒；构建警告仍有 `is_markdown_file` 未使用。
- Vite 的 CSS 优化器仍报告 4 条 `::highlight(...)` 语法提示，且 OFD Viewer chunk 1,299.75 kB 超过默认阈值；均是既有提示，本阶段未改无关打包策略。

## 桌面验证

macOS 第一轮实测：原生目录选择器打开测试目录；根层按目录优先展示，忽略 `.git`、`node_modules` 与 `.txt`；展开子文件夹后才出现 `nested.markdown`；点击 `readme.md` 后通过原多格式打开流程创建标签并显示内容；新建 `new-note` 后创建 `new-note.md`、加入标签并打开。侧栏宽度默认 250 px，可收起并重开。

最新 `.app` 实机复验通过：再次选择测试工作区，展开 `subfolder`，收起并重新展开侧栏后，子目录仍保持展开。刷新后从工作区文件树打开 6 页 `reader-sample.pdf`，PDF 页码控制和 6 页连续阅读区域出现；再打开 `sample.ofd`，OFD 阅读控制和 1 页正文可见。现有 Markdown 标签仍可切回。首次连接时观察到的是重建前旧进程，退出旧进程后重新启动最新 `.app` 再完成上述复验。OFD 仅验证本地工作区打开和该 POC 样本显示，不代表 P6-B 兼容性矩阵已通过；该路线仍 blocked。Windows/Linux 未在当前 macOS 环境实测。

## 已知风险

- 工作区路径在本次进程中使用，暂不跨重启恢复；属于 V03-P4。
- 单目录层级超过 2,000 项会显示截断标记，目前没有分页。
- Rust 当前用 canonical path + symlink metadata 检查，尚非抵御恶意本地并发路径替换的句柄式沙箱。
- P6-B OFD 兼容性问题仍 blocked，详情保持在多格式路线文档中。

## 可回滚

只需回滚本报告列出的工作区代码和 `docs/roadmap/editor-workspace/` 文件；不要重置整个工作树或触碰 P6-B 状态、用户文件和 `v0.2.0` 发布标签。
