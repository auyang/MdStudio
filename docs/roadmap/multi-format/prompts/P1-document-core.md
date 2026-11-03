# P1 — 共用文档核心与无损 Markdown 适配

> 此阶段一次性执行，结束后停止等待人工验收。

```text
请在当前 MdStudio 本地源码中只执行【P1：Document Core】，先读取 docs/roadmap/multi-format/PROJECT_STATUS.md 与 P0 交付物，确认 P0 已被人工接受；如未接受，停止并报告，不自动越级。

目标：为 Markdown/PDF/OFD 建立统一类型识别和生命周期抽象，但只对 Markdown 做可运行接入，不实现 PDF/OFD 渲染。

任务：
1. 在 src/features/documents/ 中创建类型、adapter registry、workspace state、capabilities 和清理生命周期；不制造过度抽象，允许 MarkdownPosition 与 PagedPosition 采用判别联合。
2. 复用 src/features/reader/tabs.ts 的现有泛型能力，保留按 canonicalPath 去重和关闭行为；使文档类型可作为 tab 字段。
3. 把 App.tsx 中相互独立的 UI/业务流程分离为最小组件，确保原 Markdown 渲染、公式、Mermaid、搜索高亮、目录、快捷键、历史导航不变。
4. 新增 Rust 端 DocumentType 检测/路径验证集中入口；现有 load_reader_document 仍只解析 Markdown。此阶段的 PDF/OFD 只能返回“格式已识别但阅读器未启用”，不能发送给 Comrak。
5. 增加 V1→V2 本地设置/会话/阅读位置兼容迁移，保留 V1 以便回滚。
6. 仅按需接入 shadcn/ui 少量组件；沿用既有 CSS、主题变量和布局，不大改首页、标签栏、设置页。
7. 补充 MD 相关状态与跨格式类型测试；运行所有既有测试和构建。

验收：.md/.markdown 功能、回归测试、启动/拖拽/文件监听不退化；不存在破坏原有应用的 PDF/OFD 假功能。输出变更清单和测试结果。更新状态为 P1 awaiting_acceptance 或 blocked，然后停止，不进入 P2。
```
