# P3 — OFD 引擎兼容性 POC（不直接上生产）

> 此阶段一次性执行，结束后停止等待人工验收。

```text
只执行【P3：OFD POC】，前提是 P2 已被人工接受。

目标：确认当前 MdStudio 的 Tauri WebView 环境中，@ofdrw/ofdrw-viewer-ui/react 与底层 engine 的真实可用性。禁止把官网宣称等同于 MdStudio 实测。

要求：
1. 核实当前 npm 包版本、MIT 许可、Node/打包约束；主评估 viewer-ui/react（可关闭工具栏）和 engine（可自行绘制 Canvas），各做最小实验；不引入 JVM 或远程转换服务。
2. 从用户许可/开源样本中建立 OFD 兼容测试集，至少含电子发票、票据、公文、中文/缺失字体、图片、印章和损坏容器；样本不足时明确阻塞并列出待测类型。
3. 单独测试：页面总数、首屏精度、翻页、缩放、缩略图、搜索、文字复制、字体缺失警告、内嵌图片、印章外观、加密文档错误信息、关闭清理、性能与大文件。标注未测、未通过和降级。
4. 检验 viewer-ui 能否隐藏内置 toolbar、通过 React ref 控制，验证是否与现有 CSS/快捷键/滚动容器冲突；检查 i18n zh-CN/en/ja 的可行性。
5. 定义 zip bomb、资源路径穿越、Canvas 尺寸、异常 XML、内存和超时处理策略；不能只看后缀。
6. 产出 docs/roadmap/multi-format/02-compatibility-matrix.md 与 POC_GO_NO_GO.md，明确 A（UI 封装）、B（engine 自定义）、C（暂缓）三选一的建议和依据。

除隔离的 POC/样本/文档外，不改变生产阅读主线。不自动把 POC 当生产支持。不执行 P4。最终状态 P3 awaiting_acceptance 或 blocked，停止。
```
