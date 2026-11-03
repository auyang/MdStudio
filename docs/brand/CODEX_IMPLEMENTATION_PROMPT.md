# Codex 执行 Prompt：MdStudio 官方品牌落地（BRAND-01）

> **使用方式**：将以下整个 Prompt 原样发送给 Codex；务必让 Codex 能读取同目录下的品牌规范、tokens 和 PNG 参考图。  
> **任务类型**：在现有或新建的 MdStudio（Rust + Tauri 2 + React）项目中实现品牌，而不只是生成视觉稿。

---

你是一名资深 Rust/Tauri 2/React/shadcn/ui 桌面产品设计工程师、品牌设计工程师和交付负责人。

现在要将用户**已经选定的第一版 MdStudio 品牌视觉**，真正落实到产品 UI、Logo、桌面图标、主题与工程配置。**不得重新创作一套新 Logo**。

## 一、品牌唯一依据

必须先阅读以下本地文件：

1. `docs/brand/BRAND_GUIDELINES.md`
2. `docs/brand/EXECUTION_STEPS.md`
3. `brand/tokens/mdstudio.tokens.json`
4. `brand/reference/MdStudio_Brand_Board_Approved.png`
5. `brand/reference/Logo_Mark_Reference_NOT_FINAL.png`
6. `brand/reference/Logo_Lockup_Reference_NOT_FINAL.png`
7. `brand/reference/UI_Preview_Reference_NOT_FINAL.png`

如文件相对路径不同，在仓库内查找同名文件。不得改用网上搜索出来的同名 MdStudio 产品 Logo；只有本地用户选定参考图是设计依据。

若图形能力无法读取参考图，需要如实报告视觉验证阻塞，不能声称矢量复刻无误。

## 二、必须保持的品牌特征

- 名称：**MdStudio**。
- 中文定位语：**AI 时代的 Markdown 编辑工作台**。
- 英文口号：**Write · Read · Create with AI**。
- Logo：**蓝青渐变几何 M + 浅色 Markdown 文件纸张 + 右上蓝色折角 + 深色 I 形文本光标**。
- 字标：所选首版视觉板采用**深色、粗体、现代无衬线 MdStudio 字标**；不要换成其他提案的渐变字标。
- 主色：`#0F172A`, `#3B82F6`, `#06B6D4`, `#A78BFA`, `#E5E7EB`, `#F8FAFC`。
- 英文字体：Inter。中文遵循平台字体回退。
- 视觉语气：Professional / Minimal / Developer-friendly / Intelligent / Reliable。

禁止换成山峰 M、绿色笔记图标、AI 机器人图标、通用 `M↓` 字符图标等备选方向。

## 三、产品技术约束

MdStudio 预定技术栈：

- Rust + Tauri 2
- React + TypeScript + Vite
- shadcn/ui + Tailwind CSS
- Milkdown（所见即所得编辑）
- CodeMirror 6（源码编辑）

这次任务是 **BRAND-01 品牌集成任务**，不能打乱既定编辑器开发主线。

1. 如果已有项目：首先阅读当前源码，原地最小化修改，不要覆盖用户改动、不重新建仓库。
2. 如果当前是空项目：可按既定技术栈初始化最小工程，然后完成品牌基座；不要顺带实施尚未批准的 AI / 分享 / 云同步功能。
3. 现有编辑器的 WYSIWYG、Source、Split、保存、文件树、标签、TOC 和安全机制应保留。
4. 不允许通过整张品牌视觉板作为 App UI 背景或把参考裁切图放大充当正式矢量图标来完成任务。

## 四、按以下阶段实施

### B0 工程与资源盘点

- 查明现有样式系统、字体、logo/icon 资源、Tauri 配置和构建脚本。
- 检查 `git status` 或等效状态；不可覆盖已有未提交改动。
- 列出品牌规范与现有实现的差距。
- 初始化 `docs/brand/BRAND_IMPLEMENTATION_REPORT.md`。

### B1 建立 Design Tokens

- 将 `brand/tokens/mdstudio.tokens.json` 映射为当前项目实际使用的 CSS 变量 / Tailwind 主题配置。
- 保证没有重复且冲突的颜色定义。
- 建立浅色、深色主题，并统一按钮、选中态、边框、焦点圈、表格和 Markdown 正文样式。
- `#3B82F6` 为品牌色，不直接用于需要小字白色文字的按钮；按钮使用有足够对比度的衍生 action blue。
- 字体 Inter 为英文首选，中文使用系统回退，不能未经授权捆绑字体文件。

### B2 Logo / App Icon

- 以提供的 Logo 截图为几何基准，人工或利用现有矢量工具复刻符号。
- 输出独立 SVG：浅底水平组合、深底水平组合、图形符号、单色深/浅两种。
- 生成 1024px app icon 母版，再生成 Tauri 平台需要的 icon 文件。
- SVG 应无外部资源依赖，具有合理 viewBox。
- 对小尺寸渲染进行检查；参考图的蓝色折角、M 的形态、I 型光标必须能辨认。
- 如无法忠实还原，请交付候选稿、对照截图和差异清单，并明确 `awaiting_visual_approval`；不要假装已通过。

### B3 应用品牌 UI

- 顶部、欢迎页、关于页面接入批准的 MdStudio 字标和口号。
- 三栏工作台采用左侧文件树 / 中间 Markdown 编辑 / 右侧 Outline，符合参考图简洁布局。
- 文件选中态使用柔和蓝色，列表、标签和状态栏减少视觉噪声。
- 中央文档保持大面积白色/暖白留白，阅读正文高可读。
- 应用编辑模式切换、状态提示和文件保存不得失效。
- 可以保留 AI Chat 的架构扩展位置，但不能生成可点击的假 AI 功能。

### B4 平台元数据与图标

- Tauri 的 productName 设置为 MdStudio。
- 对已发布应用保留现有 identifier；对新项目生成稳定 identifier 并记录。
- 检查 Windows / macOS / Linux 图标输出，避免旧 Logo 残留。
- 不擅自修改签名、自动更新地址、历史版本兼容配置。

### B5 质量与报告

- 运行项目已有测试、Rust 检查、TypeScript 检查、前端构建和 Tauri 构建。
- 使用实际运行截图（不是从品牌板裁切）证明界面集成效果。
- 对照 `docs/brand/EXECUTION_STEPS.md` 的 V-01~V-10 验收场景。
- 输出所有改动文件清单、成功和失败命令、视觉偏差、未完项。
- 不允许假造截图、测试成功、图标产物或实际运行情况。

## 五、必须保护的数据与工程规则

- 不能更改用户 Markdown 内容，不能自动迁移或清空文档目录。
- 不得因品牌改动改变本地保存行为或丢失特殊 Markdown 语法。
- 不引入额外的远程服务器、遥测或用户登录。
- 不要为追求与静态 UI 示意稿一致而牺牲键盘可访问性或中文输入法。
- 使用成熟依赖；遵循实际仓库版本和官方 API，不使用明显过期实现。
- 如果平台缺失编译依赖，报告阻塞和可复现安装命令。

## 六、交付清单

1. `src/assets/brand/` 下的正式 SVG / PNG 品牌文件（如果完成）。
2. UI 中生效的 Design Tokens / 明暗主题。
3. Tauri 产品名称与图标产物。
4. 实际运行的浅色 / 深色 UI 截图，以及 Logo 小尺寸对照图。
5. `docs/brand/BRAND_IMPLEMENTATION_REPORT.md`。
6. 对 `docs/PROJECT_STATUS.md` 或现有项目状态文件的增量记录（若存在）。

推荐校验命令（按项目脚本调整）：

```bash
cargo fmt --check
cargo check
cargo test
pnpm exec tsc --noEmit
pnpm build
pnpm tauri build
```

**最终输出格式**：

- 已实现：具体文件路径 + 功能点
- 未实现：原因 + 风险
- 测试：命令、真实结果、失败处理
- 视觉对照：Logo 相似性与偏差、UI 相似性与偏差
- 本地启动：准确运行命令
- 需要用户审阅：仅实际存在的待决事项

最后设置品牌任务状态为：

```yaml
brand_task: BRAND-01
status: awaiting_acceptance
next_action: user_visual_review
```

**完成当前品牌任务后停止，不自动进入下一阶段，也不自动新增 AI 能力。现在开始执行 B0 → B5。**
