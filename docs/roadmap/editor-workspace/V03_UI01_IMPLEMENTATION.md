# V03-UI-01 首页与导航实现记录

## 范围

本阶段只调整桌面首页、最近文件入口和左侧主导航。保留现有 Markdown、PDF、OFD 阅读与 Markdown 编辑/保存流程，未改变版本号、窗口原生按钮或窗口融合配置，也未进入后续阶段。

本轮用户消息未附视觉稿图片，因此实现依据为需求中明确给出的布局、文案和样式要求，并复用仓库现有 MdStudio 品牌 Logo。未据此另行设计 Logo。

## 审计结论

- `App.tsx` 已实现多格式文档标签、最近记录、工作区状态、目录树、设置入口和 Markdown 编辑状态。新导航通过已有流程切换页面，没有建立第二套文档打开或标签管理。
- 文件夹工作区能够通过现有 Tauri 原生目录选择器打开，目录树按需加载，并调用现有 MD/PDF/OFD 多格式打开流程；Markdown 新建走已注册的安全文件服务。
- 最近记录来自本地持久化的路径、文档类型和打开时间。现有记录不持久化文件大小，所以列表仅在当前打开文档提供该元数据时显示大小，其余显示“—”。
- Markdown 编辑缓冲区和脏状态已实现。主视图切换采用隐藏而非卸载方式，避免离开阅读页时销毁编辑器、PDF/OFD Viewer 或丢失当前内存状态。
- 设置仍由原来的设置对话框承载；侧栏“设置”打开该对话框，不创建外观相似但无功能的设置页。
- macOS 原生标题栏和红黄绿按钮仍使用 Tauri Overlay 与现有坐标配置。启动时原生窗口先建立标题栏，再完成 WebView 首屏布局；早期只在 Rust `setup` 阶段重套样式，可能发生在最终窗口布局前。现在 React 首帧后调用 `realign_macos_title_bar` 再套一次 Overlay，促使 AppKit 按配置位置重新布局。未改坐标、窗口样式或窗口融合方式。

## 实现

- 新增 `HomePage`：品牌欢迎区、打开文档/工作区操作、格式提示和最近文档摘要。新建 Markdown 仍通过已有工具栏/工作区入口使用，不重复放在首页“打开工作区”旁。
- 新增 `RecentFilesTable`：读取现有最近记录，显示格式标识、名称、完整路径提示、已知文件大小、真实打开时间和移除最近记录操作。点击继续调用既有文档打开逻辑，已打开文档复用现有标签。
- 新增 `SidebarNavigation`：首页、最近、工作区、设置导航；默认展开宽度 230px，支持收起、恢复及调整宽度。工作区存在时复用原 `FileTree`，不在关闭工作区时伪装成可用目录。
- 在 `App.tsx` 增加最小页面路由状态。切换页面时保留文档内容组件挂载；打开文档或点击标签时回到阅读页。
- 自定义弹出菜单统一支持点击外部关闭，覆盖阅读宽度、顶部更多操作和最近文件行内菜单；菜单内点击不会触发外部关闭。
- `AppHeader` 品牌入口可返回首页，现有标签、打开、搜索和更多操作仍走原逻辑。
- 扩展中、英、日三种语言的新增导航与首页文案。
- 工作区 UI 偏好从 V1 迁移至 V2：旧键保留以供回滚；旧版“侧栏隐藏”状态转换为新版本的展开/收起语义。未找到旧设置的用户默认看到 230px 展开的侧栏。

## 主要变更文件

- `src/app/App.tsx`、`src/app/App.test.tsx`
- `src/components/layout/AppHeader.tsx`
- `src/components/reader/ReaderEntryState.tsx`
- `src/components/sidebar/FileTree.tsx`
- `src/components/home/HomePage.tsx`
- `src/components/home/RecentFilesTable.tsx`
- `src/components/home/SidebarNavigation.tsx`
- `src/components/home/HomePage.test.tsx`
- `src/features/workspace/preferences.ts`、`src/features/workspace/preferences.test.ts`
- `src/features/i18n.tsx`
- `src/styles.css`
- `src-tauri/src/commands.rs`、`src-tauri/src/lib.rs`（首屏后重套 Overlay）

## 回滚

本阶段改动集中在首页/导航组件、路由显示状态、侧栏偏好迁移和相关样式。回滚时可撤销上述文件中的 UI-01 改动；原 V1 偏好键仍保留。不要整体回退工作树，因为其中还有此前 V03-P1/P2/P3 的独立改动。
