# MdStudio 测试报告

## v0.1.9 数学公式阅读支持

测试日期：2026-11-02（macOS）

### 已执行检查

| 检查 | 结果 | 说明 |
|---|---|---|
| Comrak 数学节点 | 通过 | `$...$`、`$$...$$`、`\(...\)`、`\[...\]` 生成带 `data-math-style` 的节点；普通金额和代码块保持原文。 |
| KaTeX 阅读渲染 | 通过 | 行内、块级、多行 aligned、矩阵、分式、求和、积分和中文混排均在桌面界面及 PDF 中显示。 |
| 错误公式回退 | 通过 | 无效 LaTeX 显示原始源码和中文错误提示，不中断其他公式。 |
| 公式源码复制 | 通过 | 公式节点提供复制源码按钮；前端交互测试通过。 |
| 按需加载与离线 | 通过 | 普通文档不加载 KaTeX；KaTeX、CSS 和字体由应用本地依赖打包，无 CDN。 |
| 大型公式文档 | 通过 | 240 个块公式的 fixture 通过 Rust 解析和前端批量渲染测试。 |
| Markdown 原文未修改 | 通过 | 公式 fixture 测试前后 SHA-256 为 `147516e99ec9f1b2d2ababa41996b99a522af728fec518513e6b854ef5617602`。 |
| 前端测试 | 通过 | `pnpm test`：16 个测试文件、133 项通过。 |
| Rust 测试 | 通过 | `cargo test --locked`：28 项通过。 |
| 前端生产构建 | 通过 | `pnpm build` 成功。KaTeX 独立分包，约 258.86 KB（77.49 KB gzip）；KaTeX CSS 28.83 KB（7.92 KB gzip）。 |
| macOS 桌面构建 | 通过 | `pnpm tauri build --bundles app` 成功，生成 `src-tauri/target/release/bundle/macos/MdStudio.app`，约 15.5 MiB。 |
| PDF 公式内容 | 通过（内容） | 实际导出的一页 A4 PDF 包含行内公式、aligned、矩阵、价格文本、代码中的美元符号和错误公式回退；PDF 已渲染并目视检查。截图见 `screenshots/mdstudio-math-formulas-pdf.png`。 |
| PDF 导出交互 | 未通过 | macOS 原生打印流程在本次桌面验证中约 120 秒后才写出 PDF；应用界面期间不可正常操作，最后仍弹出“导出失败”。因此 PDF 交互稳定性不能验收通过。 |
| Windows 桌面运行 | 未执行 | 当前环境为 macOS。Windows 代码路径仅能在 Windows 环境验证。 |

### 构建备注

构建成功，但仍有既有 CSS `::highlight` 兼容性提示和大入口包警告。KaTeX 作为按需加载分块，普通阅读文档不触发 KaTeX 加载。

### 结论

数学公式渲染、源代码回退、复制、离线资源和原文只读要求均通过自动化及 macOS 实机/PDF 内容检查。当前阶段仍受 macOS PDF 导出交互故障阻塞：输出内容正确，但长时间阻塞界面并报告失败。不得将整体验收标记为完成。
