# MdStudio Editor + Workspace Route 状态

```yaml
baseline_version: 0.2.0
target_version: 0.3.0
current_phase: V03-P2 Markdown Editing
status: accepted
next_phase: V03-P3
auto_advance: false
release_version: 0.3.0
```

本路线独立于 `docs/roadmap/multi-format/`。V03-P2 已按用户指令验收并准备作为 v0.3.0 发布；Markdown 支持阅读/源码编辑与安全保存，PDF/OFD 仍为只读。V03-P3 分屏编辑尚未开始，不会自动进入下一阶段。

## V03-P0 / P1

- P0 实际代码与边界审计已记录于 `00_BASELINE.md`。
- P1 已由用户验收；Rust 授权工作区服务、懒加载文件树、侧栏偏好和 Markdown 安全创建入口已交付。目录及多格式实测见 `V03_P1_REPORT.md`。
- P2 实施见 `V03_P2_IMPLEMENTATION.md`；自动化与 macOS 实测见 `V03_P2_TEST_REPORT.md`；逐项验收见 `V03_P2_ACCEPTANCE.md`。

## 既有多格式路线

`docs/roadmap/multi-format/PROJECT_STATUS.md` 当前 P6-B `blocked`，继续保留：应用内 CJK 兜底字体缺失、OF(D) 授权样本矩阵不足、JPEG Viewer 空白复测、JBIG2/TIFF 插件接入和 Windows/Linux 测试等缺口。此路线未被本次工作区实现解除。

## V03-P2 验收结果

用户于 2026-11-04 明确验收 V03-P1。用户于 2026-11-05 指示先验收 V03-P2 再发布 v0.3.0；前端全套测试、构建、Rust 测试和格式检查通过，P2 验收门禁已解除。

P6-B OFD 兼容性路线继续保持独立 `blocked` 状态；本次 v0.3.0 发布不改变该状态。

## V03-P2 交付状态

- CodeMirror 6 源码编辑、按标签草稿、同一安全 Comrak 预览、保存/另存为/新建、脏状态、冲突处理和退出保护已实现。
- `pnpm test`、`pnpm build`、`cargo test --locked`、`cargo fmt --check` 与 macOS Debug `.app` 构建均已通过；详细输出见 `V03_P2_TEST_REPORT.md`。
- macOS 手工验证过编辑、Cmd+S、未保存预览、关闭决策，以及 PDF/OFD 阅读回归。Windows/Linux 桌面交互未测试。
- 用户验收后停在 V03-P2；`next_phase` 保持 `V03-P3` 且 `auto_advance: false`，本次发布不实施 P3。

## V03-P3 状态

V03-P3 分屏编辑未开始。本次用户要求仅验收 P2 并发布 v0.3.0；不得自动开始 P3。
