# P6 — 安全、发布及回滚

> 此阶段一次性执行，结束后停止等待人工验收。

```text
只执行【P6：Security & Release】；确认 P5 已人工接受。

任务：
1. 对文件读取、OFD 解压、PDF/OFD 渲染、脚本和 URL 安全做威胁建模：ZIP Bomb、目录穿越、异常 XML、恶意 PDF、内存/CPU 消耗、外部网络访问、跨标签竞态、敏感路径泄露；修复高风险问题。
2. 审查 Tauri CSP、权限和文件读取限制，不放开不需要的 http/https/eval/全盘 asset 访问。所有 Worker/图片/字体本地离线可用。
3. 验证三格式 Windows/macOS/Linux 文件关联及首开/热启动、文件选择和拖拽、多标签恢复、主题和快捷键。对未具备测试机器的平台标“未验证”，不能造通过记录。
4. 收集 npm/crates 开源许可证和 NOTICE，确认 PDF.js 与 OFDRW 版本、许可，更新 README.zh-CN.md/README.md/README.ja.md、安装说明、截图和已知问题。
5. 再次处理 docs/PROJECT_STATUS.md 的 Reader-P1.9 PDF 导出 macOS 阻塞：独立复测并修复；如果无法修复，显式隔离故障功能并在发布判定中写明，不得把原始 blocker 隐藏或写“已修复”。
6. 重跑 pnpm test、pnpm build、cargo test --locked；各平台打包/安装按真实环境记录；整理版本与回滚策略，并给出 GO/NO-GO。
7. 生成 docs/roadmap/multi-format/05-acceptance.md、RELEASE_NOTES.md、ROLLBACK.md、LICENSE_NOTICES.md 和最新状态。

只做候选版本，不自动发布 GitHub Release、不推送 tag、不修改默认分支、不宣称所有平台通过。最终停在 P6 awaiting_acceptance 或 blocked，等待用户批准。
```
