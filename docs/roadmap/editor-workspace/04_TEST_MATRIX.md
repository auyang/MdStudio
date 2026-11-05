# V03-P1 测试矩阵

## 自动测试

| 项目 | 覆盖内容 | 结果 |
|---|---|---|
| Rust workspace service | 多格式扩展大小写、仅即时子项、目录优先排序、忽略非文档/指定目录、越界与 `..`、根/子路径符号链接拒绝、新建不覆盖、非法名称/扩展名 | `cargo test --locked` 通过：54 项，0 失败；单测 1.00 秒（编译 26.35 秒） |
| 前端 workspace preferences | 默认宽度/收起状态、持久化、宽度限制、损坏存储降级 | 3 项通过 |
| FileTree 组件 | 根目录首次加载、仅展开时加载子目录、活动路径高亮、点击回调、创建错误反馈 | 3 项通过 |
| App 集成 | 原生目录选择器 → Rust 登记根目录 → 懒加载树 → Markdown 复用旧 openDocuments/tab/reader；收起/展开保留展开态 | 1 项通过 |
| 全前端回归 | Markdown 阅读、搜索、目录、历史、PDF/OFD、Viewer、设置、国际化 | `pnpm test` 通过：26 个文件、176 项，0 失败，27.66 秒 |
| 构建 | TypeScript 与 Vite 本地生产构建 | `pnpm build` 通过；Vite 8.3.5 2.02 秒。保留 4 条已有 `::highlight` CSS 解析提示与大 chunk 警告（OFD Viewer 1,299.75 kB）。 |
| 桌面验证 | macOS Tauri `.app`：原生目录选择、根层过滤排序、子层懒加载、打开 Markdown/PDF/OFD、新建 Markdown、收起/展开 | 最新 `.app` 实测通过：目录选择与过滤排序、懒加载、收起后保留展开态、新建并打开 Markdown；从工作区文件树打开 6 页 PDF 和 1 页 OFD，显示对应 Viewer/正文。OFD 样本显示不解除 P6-B 阻塞。Tauri Debug `.app` 51.04 MiB，Rust build 22.04 秒。Windows/Linux 未实测。 |

## 未在 P1 验收的能力

- 工作区路径、展开目录跨重启恢复（P4）。
- 脏状态、保存、另存为、未保存关闭提示、外部编辑冲突（P2/P4）。
- 大型目录分页与专业压力数据；目前单层 2,000 条上限，未测试数万条规模。
- Windows/Linux 实机操作；本轮环境为 macOS。
- 工作区路径选择/展开状态 session 恢复。

## 命令记录

最终状态见 `V03_P1_REPORT.md` 和 `PROJECT_STATUS.md`；未经执行的平台测试不得标记通过。
