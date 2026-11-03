# P0 — 基线审计与迁移计划（第一条先执行）

> 此阶段一次性执行，结束后停止等待人工验收。

```text
你现在是 MdStudio 项目的首席架构师和高级 Rust/Tauri/React 工程师。请只执行【P0：基线审计】，不要编写 PDF/OFD 功能。

项目：当前工作目录下的 MdStudio 本地源码。目标是在现有 Markdown 只读阅读器中逐步加入 PDF/OFD，而不是重写。技术栈：Rust、Tauri 2、React、TypeScript、Tailwind CSS，未来渐进引入 shadcn/ui。

任务：
1. 读取 git status、package.json、Cargo.toml、README、docs/PROJECT_STATUS.md、docs/TEST_REPORT.md、App.tsx、AppHeader.tsx、tabs.ts、preferences.ts、i18n、Rust commands.rs/lib.rs、reader.rs、watcher.rs、pdf_export.rs、tauri.conf.json、capabilities/default.json。
2. 绘制当前打开文件、渲染 Markdown、文件监听、最近文件、会话恢复、搜索、目录、PDF 导出、冷启动与单实例打开的调用链；列出 .md/.markdown 限制位置和最小修改范围。
3. 列出所有已实现且必须保护的 Markdown 功能和测试；核实当前 PDF 导出阻塞，禁止误判为已修复。
4. 调查 pdfjs-dist、@ofdrw/ofdrw-viewer-ui、@ofdrw/ofdrw-viewer-engine 的当前版本/运行时/许可证和可用 API；调查 OFDRW React UI 隐藏工具栏、搜索和控制接口以及日语语言问题。无法联网的事实写待验证，不臆造。
5. 新建 docs/roadmap/multi-format/00-current-baseline.md、01-architecture.md、02-compatibility-matrix.md、03-security-design.md、04-test-plan.md、PROJECT_STATUS.md。目录及架构必须与实际代码吻合。
6. 尝试运行 pnpm test、pnpm build、cd src-tauri && cargo test --locked，并记录真实输出。

禁令：本阶段不得重构 App.tsx，不得引入依赖或实现 PDF/OFD，不得改变已有功能，不得修改软件版本号，不得修改用户未提交更改。
完成后写 current_phase=P0, status=awaiting_acceptance 或 blocked，提供文件清单、测试摘要、风险和可回滚说明，然后停止。不要自动执行 P1。
```
