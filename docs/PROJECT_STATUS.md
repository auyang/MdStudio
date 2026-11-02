# MdStudio 项目状态

current_phase: Reader-P1.9
target_version: 0.1.9
status: blocked
next_phase: Reader-P1.10

## 本阶段进度

- Comrak 数学扩展、KaTeX 本地懒加载、行内/块级渲染、错误源码回退和源码复制：已实现。
- 货币文本、转义美元符号及代码块保护：自动测试通过。
- 大型公式文档与离线公式资源：自动测试和桌面渲染通过。
- Rust、前端测试及 macOS 应用构建：通过，详见 [测试报告](TEST_REPORT.md)。
- PDF 包含公式且版面已实测，但 macOS 原生打印流程仍会让应用约 120 秒不可操作，最终显示导出失败；因此本阶段整体状态为 blocked。

## 当前阻塞

macOS PDF 导出产生了正确的 A4 PDF 文件，但原生打印操作没有在应用等待期限内可靠返回，用户界面期间无法正常操作，且前端收到失败结果。此问题不属于 KaTeX 解析，但违反本阶段 PDF 导出可靠性要求。修复并完成桌面回归后，状态才能改为 `awaiting_acceptance`。

## 截图

实际 PDF 数学排版截图：[mdstudio-math-formulas-pdf.png](screenshots/mdstudio-math-formulas-pdf.png)
