# P2 — PDF.js 阅读器 MVP

> 此阶段一次性执行，结束后停止等待人工验收。

```text
只执行【P2：PDF Reader】，先核验 P1 已人工接受，否则停止。

保持现有 Markdown 功能；引入 pdfjs-dist，使用 Vite 本地打包的 PDF.js worker、字体/cmap 等必要资源；严禁 CDN。具体 worker 与 TextLayer API 以当前安装版本类型和官方文档为准，不能盲套旧版本示例。

实施：
1. Rust 实现受控的 PDF 文件元信息/路径验证/二进制读取，优先原始 IPC Response 或分块 Channel，禁止 JSON 字节数组。对文件大小、损坏和取消有清楚错误处理。
2. 实现 PdfAdapter、PdfViewer 及 per-tab 资源管理。打开本地 .pdf 后支持首屏、连续浏览、页码导航、下一页/上一页、缩放、适合宽度/整页、旋转（如果可控）。
3. 使用 PDF.js text layer 实现文字选择、复制、搜索及高亮；扫描件无文本时给出合理提示，不引入 OCR。
4. 采用可见页+邻近页渲染、缓存上限和取消无效任务；退出时销毁 PDF document/worker/render tasks/listeners，不让已关闭标签继续渲染。
5. 在原有选择文件、拖拽、启动参数、Open With、最近文件和恢复流程中增加 PDF；多标签混合打开 MD/PDF。
6. 增加样本：普通中文 PDF、多页、扫描、加密/错误、旋转、带书签、较大文件；覆盖相关自动测试。
7. 不修改 `pdf_export.rs` 的行为。若原有 PDF 导出仍阻塞，记录该问题但不得声称修复。

运行 pnpm test、pnpm build、cargo test --locked；在可用平台运行桌面构建/手工检查，记录耗时与峰值内存（如可测）。最后写 P2 awaiting_acceptance 或 blocked、测试/风险/回滚并停止，不进入 P3。
```
