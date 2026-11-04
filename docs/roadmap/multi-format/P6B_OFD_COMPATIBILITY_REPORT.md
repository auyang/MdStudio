# MdStudio P6-B：OFD 高保真渲染与兼容性报告

```yaml
current_phase: P6-B
target_version: 0.2.0
status: blocked
next_phase: P6-C（不得自动启动）
```

## 结论

本轮完成了 OFD 兼容性诊断入口和分级呈现，并审计了真实生产渲染链。P6-B **不能验收通过**：上阶段 OFD 字体回退报告仍为 `blocked`；应用没有内置 CJK 兜底字体；当前仓库只保留一份 OFD 发票样本且没有记录样本授权；多页公文、票据、嵌入字体、JPEG/JBIG2、复杂版式等关键覆盖缺失。历史记录还存在发票文字漏显、嵌入字体缺字和 Viewer UI 图片解码取消的问题。

没有从系统目录复制字体，也没有下载或加入未确认许可的字体。没有修改 OFD、签名或印章数据，没有修改 Markdown/PDF 渲染链，没有升级版本或发布应用。

## 执行前审计

- 生产 OFD UI：`@ofdrw/ofdrw-viewer-ui/react` **0.1.7**；渲染引擎：`@ofdrw/ofdrw-viewer-engine` **0.1.7**；二者本地包 manifest 为 MIT，声明 Node.js `>=22`。生产路径由 `src/components/reader/OfdViewer.tsx` 调用 React UI，未重写引擎。
- Rust 字体匹配：`fontdb 0.24.0` + `ttf-parser 0.25.1`，见 `src-tauri/src/services/system_fonts.rs`。已实现原字体优先、本机同名/别名/风格匹配、目标 Unicode 字形覆盖检查、受限字体读取和会话释放；`.ttf/.otf/.ttc` 的解析面索引会校验。前端不能提交任意系统路径。
- 回退状态：OFD 内嵌字体优先；其次本机同名字体；再以同风格且有目标字形覆盖的系统字体补充。**应用内置 CJK 最终兜底尚未实现**。已有设置中的“思源黑体/思源宋体”仅作为系统字体候选名，不是随包字体。
- 上阶段 `OFD_FONT_FALLBACK_REPORT.md` 的状态明确为 `blocked`。macOS 发票样本在系统字体替代开启时主要中文可见，但仍有 `W_FONT_MISSING`（Font 28、Font 4），没有逐对象核验这些告警是否对应实际漏字。Windows/Linux 以及其他字体格式/平台组合尚未实机验收。
- 仓库 OFD 样本目录当前只有 `ofdrw-invoice.ofd`（SHA-256：`f52f1df911c3d84943a7699fc517a528560e9e492082e72ee65d5ef5df8ad976`）。ZIP 内有一张 `qr.png`、一页内容、签名元数据和签章资源；样本许可/脱敏授权没有随仓库记录。没有用它代表其他文种或格式。

## 引擎能力与宿主限制

以 pnpm 当前锁定安装包的公开类型声明为准：PNG/JPEG 由宿主图像解码；JBIG2/TIFF 由 `ImageDecoderPlugin` 扩展；引擎公开 warning 包括 `W_FONT_MISSING`、`W_GLYPH_MISSING`、`W_IMAGE_DECODE`、`W_JBIG2_DECODE`、绘制/裁剪降级、图层顺序及边界异常等。`OFDOpenOptions` 有 `imageDecoders` 参数。

但当前 Viewer UI 的公开 React props 没有将 `imageDecoders` 传入引擎的选项，也没有可用于替换这段内部 `openDocument` 的公开 prop。因而不能在不改第三方源码、不更换阅读主线的前提下，从宿主给当前 UI 增加 JBIG2/TIFF 插件。UI 暴露的 `onWarning`/`onError` 可用于记录引擎报告，不能弥补解码能力本身。

引擎存在 `W_LAYER_ORDER`、`W_BLEND_MODE`、`W_UNSUPPORTED_PAINT`、`W_UNSUPPORTED_CLIP`、`W_PHYSICALBOX_ORIGIN` 等诊断码；这证明有诊断接口，不等于 A4/A5、旋转、裁剪、透明度或签章层级在本应用中通过真实文件对照。

## 本轮实现及后续界面调整

- P6-B 初版曾在 `OfdViewer` 中加入分级的“文档兼容性诊断”入口。根据后续界面要求，诊断面板、字体/资源警告列表和签章提示均已从阅读页移除；渲染失败时仍显示错误及重试入口。主题和设置入口移至状态栏阅读宽度旁。
- 当前 Viewer 不接收引擎 `onWarning` 回调；`debug.console=false` 保持不变。前端没有增加文档全文、字体字节或网络上报日志。
- 没有引入依赖，没有修改 Rust 字体匹配、OFD 容器读取、PDF 或 Markdown 渲染。

## 测试结果

以下完整测试和 Release 构建结果来自诊断面板移除之前的 P6-B 验证。本次按用户要求移除阅读区诊断后，更新了现有组件测试断言，但没有重新运行前端测试或构建；当前代码未声称已通过本次变更后的验证。

| 检查 | 结果 |
| --- | --- |
| OFD Viewer 组件测试 | 诊断面板移除前 6 项通过；本次更新了现有断言，尚未重跑。 |
| 前端完整测试 | 诊断面板移除前 `pnpm test`：24 个文件、169 项通过，0 失败；本次变更后未重跑。 |
| 前端构建 | 诊断面板移除前 `pnpm build` 通过；本次变更后未重建。 |
| Rust 测试 | `cd src-tauri && cargo test --locked`：50 项通过，0 失败。含 OFD ZIP 路径/重复条目/符号链接/加密/损坏 XML 和字体覆盖等既有测试；出现既有 `is_markdown_file` dead-code warning。 |
| Rust 格式 | 本轮未运行 `cargo fmt`；Rust 源码未修改。 |
| OFD 视觉矩阵 | 未完成。仓库无授权的多类别样本与可信参考截图，不能把历史单发票截图代替本轮逐项对照。 |
| PDF/Markdown 回归 | 上述前端和 Rust 全量套件通过；未改变这两条生产渲染链。 |
| macOS 桌面实测 | 诊断面板移除前的 P6-B Release `.app` 已启动并打开仓库中的发票样本；本次 UI 移除后未重建或实测。Windows/Linux 未实测。 |

## 验收判断

| 项目 | 状态 | 证据/缺口 |
| --- | --- | --- |
| 内嵌字体优先与系统字体回退 | 部分完成 | macOS 有自动测试和历史发票实测；Font 28/4 告警未映射到具体文字对象。 |
| 应用内 CJK 兜底字体 | 未实现 | 当前无授权字体资产。 |
| 中文、粗体/斜体、旋转/竖排文字版式 | 未验收 | 缺少对应样本与参考渲染；字体替换可能改变字形宽度。 |
| PNG/JPEG | 部分能力可用，未完成矩阵验证 | 引擎委托宿主解码；仅发票包含单张 PNG，未有独立裁剪/透明度/变换对照。 |
| JBIG2/TIFF | 生产 UI 无法由宿主注入解码器 | 引擎插件接口存在，React UI 未公开转发入口；需要上游 API 或单独批准架构变更。 |
| 页面尺寸、方向、裁剪、图层、透明度 | 未验收 | 缺少 A4/A5/自定义/横向/旋转和复杂页面样本。 |
| 印章外观与验签 | 仅显示声明 | UI 明确标记未验签；不能将外观可见说成密码学签名有效。 |
| 异常隔离、缓存/资源释放 | 自动测试通过，压力数据缺失 | Viewer 当前限制单页 16 MP/8192px、4 页/48 MP 缓存、串行渲染；本轮未采集大文件峰值内存或持续切换数据。 |
| Windows/Linux | 未实测 | 当前环境为 macOS 27.0.1 arm64。 |

## 本轮 macOS 桌面实测

- 环境：macOS 27.0.1 arm64；使用 `pnpm tauri build --bundles app` 生成的 `src-tauri/target/release/bundle/macos/MdStudio.app`。Release 构建耗时 29.81 秒，bundle 为 18.85 MiB。
- 通过新构建应用的原生打开对话框打开 `poc/public/samples/ofdrw-invoice.ofd`。一页发票的主要中文正文、表格、金额、二维码 PNG 和红色签章外观均可见；辅助功能树能读取引擎文字层的文档文本。本轮未实际输入搜索词。页面控制显示 `1 / 1`、`100%`。
- 当前自动系统字体回退报告的候选为 Hiragino Sans GB、PingFang SC、Courier New。此样本本轮没有再报告 `W_FONT_MISSING`；这只证明这一份 macOS 发票在该机器上的当前渲染，不证明其他字形、字体、操作系统完整兼容。
- 诊断面板及签章提示移除前的 P6-B 实机记录为 `信息 2，警告 6，错误 0`，曾显示 ColorSpace 回退、注释外观为空、附件字段和不支持绘制效果等警告；当时也能看见签章外观。当前阅读页不再显示诊断或签章提示。由于没有可信参考阅读器/参考截图，本轮只记录可见内容，不宣称像素级高保真。
- 现有文档状态恢复会在启动后打开已保存的 PDF 与 OFD 混合标签。启动后在该 app 原生打开器再次选择 OFD 也成功。未修改源样本。
- CUA 实机截图在本轮观察并核对了正文、二维码、签章及展开诊断区；未保存为仓库 PNG。没有授权 reference reader，因此没有做并排视觉差异截图。
- Windows/Linux、断网条件、切换压力、峰值内存和发票逐对象字形完整性仍未测。

## 回滚与后续条件

本轮生产代码变更限于 `OfdViewer.tsx`、`OfdViewer.css`、`OfdViewer.test.tsx`、`i18n.tsx` 的兼容性诊断 UI。回滚可单独撤销这四个文件的本轮差异，不触及文档、设置格式、Rust 读取器或版本号。

解除阻塞前至少需要：可记录授权/脱敏来源的发票、公文、票据及图像/印章样本；应用内字体资产及许可审核；在有样本的 macOS/Windows 实机完成逐项视觉对照；确定 JBIG2/TIFF 的 UI 集成路线。当前阶段保持 `blocked`，不进入 P6-C。
