# MdStudio OFD 中文字体回退报告

```yaml
current_phase: OFD-Font-Fallback
status: blocked
target: OFD 中文缺字时按字体名称、风格和字形覆盖回退
platform_built: macOS 27.0.1 arm64
```

## 结论

已接入系统字体匹配、字形覆盖检查、TTC 面索引校验、字体会话释放和设置项。macOS 的系统字体数据库测试能找到覆盖中文的字体，并验证系统 TTC 字体面；应用内系统字体回退路径也已通过 OFDRW 的公开 `fonts.supplementary` / `fonts.aliases` / `fonts.loader` API 接入。最终构建已在 macOS 实际打开 OFD 样本，并完成回退开关复测。

当前仍为 **blocked**：安装包没有应用自带的中文兜底字体，因此系统也没有目标字形时，无法满足“应用自带字体最终回退”；Windows 真机未实测。macOS 实测中，关闭系统字体替代后该发票的文字消失，重新开启后中文正文恢复可见；在 120% 页面倍率下切换策略后倍率保持。页面诊断区仍出现引擎的 `W_FONT_MISSING`（Font 28、Font 4）提示。文字主体可见，但尚未将这两条提示对应到具体对象，不能确认没有个别文本对象被跳过。字体会话延迟释放问题已通过自动化延迟关闭测试并经此次实机开关循环复验。

尝试取得思源字体官方资产时，自动审批审查拒绝了下载操作（受本任务字体来源/联网约束）。没有通过其他渠道下载或绕开审查。该限制导致应用内字体资产未能加入；需要提供经许可的本地字体文件，或在允许的资产引入流程中完成后，才能解除这一阻塞。

## 实际实现

生产阅读器使用 `@ofdrw/ofdrw-viewer-ui/react` **0.1.7**，底层 `@ofdrw/ofdrw-viewer-engine` **0.1.7**，字体解析依赖 `fontkit` **2.0.4**。本次没有另建渲染引擎。引擎仍先使用 OFD 内嵌原始字体；MdStudio 通过官方 React Viewer 字体加载配置补充本机字体。

回退顺序：

1. OFD 内嵌字体，由 OFDRW 保持原有优先级。
2. 系统同名字体（例如宋体、黑体、楷体、仿宋、微软雅黑及常见中英别名）。
3. 按衬线、字重、斜体、等宽风格选出的系统中文字体；只选择 `ttf-parser` 验证包含文档所需 Unicode 字符的字体面。最多附加两个有目标字形覆盖的补充字体。
4. 应用自带中文字体：**尚未提供**。
5. 系统仍无目标字形时，显示引擎或字体服务诊断，不隐藏缺字问题。

候选排序将“原字体同名命中”与“中文别名/补充字体”区分，确保更高字形覆盖率的替代字体不会越过同名字体优先级。字体面校验支持 TTF、OTF，并使用 fontdb 提供的 TTC face index；实际字体字形通过 cmap 查询，而非只看字体名称。

`Settings → 阅读 → OFD 字体` 提供系统字体自动替代开关（默认开启）和“自动 / 思源黑体 / 思源宋体”偏好。思源选项表示优先搜索该系统字体家族；安装包并未包含思源字体。界面已明确提示这一点，并在缺少系统字体时输出诊断。中文、英文、日文设置文案均已补齐。

## 安全与资源管理

- 前端只能请求 Rust 创建的 session UUID 和字体索引；不能提交任意本机路径。
- 系统字体数据库按首次 OFD 字体解析时加载，之后复用缓存；不发起网络请求。
- 使用 `fontdb` **0.24.0** 查询系统字体，使用 `ttf-parser` **0.25.1** 校验 TTF/OTF/TTC 面和 cmap。
- 单字体上限 **32 MiB**，单文档会话已传输字体总量 **128 MiB**，全局已传输量 **256 MiB**；最多 64 个并存会话、每次最多 64 项字体请求、每项最多 8,192 个目标字符、每会话最多 128 个字体源。
- 字体读取通过 session+index 注册表返回 IPC 二进制响应，不经 JSON 数组，也不暴露系统字体文件路径。
- Viewer 关闭完成后释放会话及计数预算，并清除前端持有的字体字节缓存；系统字体数据库作为应用级缓存保留至进程退出。
- 设置变化会重建 OFD Viewer，同时保留页码、倍率、旋转状态；切换同一文档时从 Viewer 状态恢复滚动位置。PDF 与 Markdown 渲染链未接入字体服务。
- OFD 原始文件只读。本次样本检查验证读取前后字节一致；未改动签名、印章或文档内容。

## 测试记录

### 自动化

| 命令 | 结果 |
| --- | --- |
| `pnpm test` | 24 个测试文件、167 项通过，0 失败。包含设置持久化、三语设置、字体加载配置、Viewer 关闭后释放会话、字体策略重挂载后恢复滚动位置。Vitest/PDF 测试输出 5 条 jsdom `HTMLCanvasElement.getContext()` 未实现提示，不影响断言。 |
| `pnpm build` | 通过。存在既有 CSS `::highlight(...)` 优化器警告和大于 500 KiB 的分块警告（OFD Viewer chunk 约 1.30 MiB）；与本次字体功能无关。 |
| `cd src-tauri && cargo test --locked` | 50 项通过，0 失败。包含字体别名/偏好、字体大小上限、损坏字体拒绝、Latin 字体无汉字 cmap、OTF、同名字体优先排序、系统 CJK/TTC 面检查、实际 OFD 发票字体匹配及资源释放预算。仍有既有 `is_markdown_file` dead-code warning。 |
| `pnpm tauri build --bundles app` | 通过；生成 macOS `MdStudio.app`，约 18.85 MiB。 |

测试样本 `docs/roadmap/multi-format/poc/public/samples/ofdrw-invoice.ofd` 中声明楷体和宋体但没有内嵌字体文件。实测 SHA-256 为 `f52f1df911c3d84943a7699fc517a528560e9e492082e72ee65d5ef5df8ad976`；Rust 样本测试验证解析前后字节相同，新增 macOS 集成测试验证该样本能从本机匹配到覆盖目标汉字的字体来源并读取字体字节。

### 桌面与字体格式验证

- macOS 27.0.1 arm64：在最终构建 `src-tauri/target/release/bundle/macos/MdStudio.app` 实测打开 P3 OFD 发票。系统替代开启时中文标题、表格、金额和印章均可见；关闭时正文文字消失并出现 `FontName=楷体` 缺失诊断；重新开启后文字恢复。将页面倍率放大至 120%，关闭再开启回退后仍为 120%。
- 实测仍有 `W_FONT_MISSING`（Font 28、Font 4）告警，且引擎文案表示对应文字被跳过。该发票的主要中文内容可见，但尚未通过逐对象对照确认这两条告警是否对应真实缺字，因此列为未通过/待查，不以肉眼看到部分正文代替完整性证明。
- 桌面截图已在本次交互检查中查看，但没有写入仓库截图文件。关闭资源释放由组件延迟关闭测试验证；实机回退开关循环没有崩溃。
- Windows：没有可用 Windows 桌面环境，未实测；Linux：未实测。`fontdb` 的跨平台系统字体枚举代码已编译到当前构建，但不能据此声称 Windows/Linux 验收通过。
- TTF：使用随 PDF.js 提供的 LiberationSans TTF 检查有/无目标汉字的 cmap；此字体用于验证解析和缺字判断，不作为中文兜底字体。
- OTF：本地 KaTeX Extra OTF 通过字体面解析测试。
- TTC：macOS 系统数据库测试遍历系统字体集合，以数据库提供的 face index 逐面解析，并确认存在覆盖“中”的字体面。
- 大字体：32 MiB + 1 字节输入在解析前被拒绝。损坏字体数据会拒绝。特殊生僻汉字的独立 OFD 文档样本及未覆盖字形清单尚未建立；没有假设所有 Unicode 字符均可恢复。

## 已知限制与待验收项

1. **应用内中文兜底字体缺失，是当前功能阻塞。** 若操作系统没有匹配字体，尤其是罕见汉字、异体字或私用区字符，仍可能显示缺字；当前会输出诊断，不会静默宣称显示成功。
2. Windows、Linux 的系统字体枚举、TTC 行为及 OFDRW 字体注入尚未在这些平台实际运行。Windows 缺失宋体时的自动替代要求未验收。
3. 使用替代字体不能保证与原始字体的字面形状完全一致。OFD 页面坐标不重排，但不同字体的字形宽度、笔画和基线差异可能导致文字外观变化或局部溢出。
4. 已覆盖的 Unicode 目标字符数受每个资源 8,192 字符限制；超限请求会被拒绝并应以诊断呈现。TTC 使用集合原始字节交给 OFDRW，且已由实际 macOS TTC 测试验证 face index 可解析；其他平台仍需确认 OFDRW 对其具体 TTC 变体的兼容性。
5. Font 28、Font 4 的引擎告警需映射回 OFD 中具体文本对象，确认是否有少数字形仍丢失；需要增加逐对象对照样本。
6. Windows、Linux 平台实测仍待完成。

## 主要代码

- `src-tauri/src/services/system_fonts.rs`：系统字体缓存、别名和风格匹配、字形覆盖校验、大小限额与生命周期。
- `src-tauri/src/services/ofd_reader.rs`：提取 OFD 字体声明与文本所需 Unicode 字符。
- `src-tauri/src/commands.rs`、`src-tauri/src/lib.rs`：受控字体元信息解析、二进制读取、释放命令注册。
- `src/components/reader/OfdViewer.tsx`、`src/components/reader/OfdViewer.css`：通过 OFDRW 字体 API 注入本机字体并在安全关闭后释放。
- `src/components/reader/SettingsDialog.tsx`、`src/features/reader/preferences.ts`、`src/features/i18n.tsx`：字体偏好、持久化和三语文案。
- `src/components/reader/OfdViewer.test.tsx`、`src/components/reader/SettingsDialog.test.tsx`、`src/features/reader/preferences.test.ts`：前端回归测试。

工作区原有未提交改动保持未清理；未提交或覆盖这些变更。PDF 和 Markdown 渲染实现不属于本次字体改动范围。
