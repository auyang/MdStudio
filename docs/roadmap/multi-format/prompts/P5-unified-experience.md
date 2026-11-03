# P5 — 统一阅读体验、UI 与性能

> 此阶段一次性执行，结束后停止等待人工验收。

```text
请只执行【P5：Unified Experience】，先确认 P4 已人工接受。

保持 MdStudio 现有界面布局、同一行标签页、阅读宽度、主题和设置习惯；让三格式共用 AppHeader/DocumentToolbar 的统一视觉与快捷键。增量使用 shadcn/ui，不做整页视觉重设计。

实施：
1. 统一“打开 / 最近文件 / 拖拽 / 系统关联 / 标签切换 / 关闭 / 保存位置 / 恢复”；检测 Mac 冷/热启动、Windows/Linux single-instance 路径传递。
2. 统一搜索入口和导航接口，但按钮状态由 capabilities 驱动；Markdown 保留目录，PDF/OFD 显示缩略图与大纲（有则显示，无则优雅降级）。
3. 明确放大缩小语义：MD 字号/阅读宽度与 PDF/OFD 页面倍率不同，不要在数据层混为一个数字。
4. 翻译新增的中文/英文/日文文案；修正 OFD 第三方 UI 日文不完整问题，不能放出未经翻译的界面。
5. 做多标签资源压力测试、连续开关文档、搜索竞态、Worker 清理、焦点和滚动位置恢复。
6. 检查有无双工具栏、双滚动条、错误快捷键、PDF/OFD 覆盖 Markdown 设置和旧位置的情况。

验收：三格式阅读主流程一致，原有 Markdown 全部功能保留。运行测试并列出 Mac/Windows/Linux 已实测与未实测条目。停止于 P5 awaiting_acceptance 或 blocked。
```
