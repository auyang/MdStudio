# P4 — OFD 生产集成 MVP

> 此阶段一次性执行，结束后停止等待人工验收。

```text
只执行【P4：OFD Reader MVP】，先确认 P3 的 GO/NO-GO 决策已由用户接受；如果 P3 为 no-go，禁止强行开发。

优先实现 P3 选定方案：若 A 则使用 @ofdrw/ofdrw-viewer-ui/react 并设置 features.toolbar=false，统一与 MdStudio 顶部工具栏的页码/缩放/查找控制；若 B 则用 engine 的官方稳定 API 实现 Canvas 渲染，不猜测方法名。

任务：
1. 实现受控 .ofd 打开、OFD ZIP/OFD.xml 校验及资源限制、二进制输送、清晰的异常状态。
2. 实现 OfdAdapter 与 DocumentSession，页码跳转、缩放、阅读位置恢复、多标签切换、资源释放；搜索和复制仅在已验证能力下启用。
3. 保留印章显示；若未实现验签则显示“签章未验证”，禁止用绿色“有效”误导用户。加密文件不支持时明确提示。
4. 对字体/图像/页面失败提供诊断和手工可处理的错误提示，不静默空白；不要自动把 OFD 转成 PDF 作为默认阅读方式。
5. 增加 md/pdf/ofd 混合多标签测试和 OFD 样本快照/人工对照记录。
6. 保证三格式均在本地离线工作；运行所有测试及桌面构建。

更新 P4 状态、测试、兼容矩阵、明确尚不支持功能，停在 awaiting_acceptance 或 blocked，不进入 P5。
```
