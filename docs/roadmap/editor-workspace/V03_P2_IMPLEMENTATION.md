# V03-P2 实施记录：Markdown 轻量编辑与安全保存

## 范围

本阶段只为 Markdown 增加源码编辑与受控保存。PDF、OFD 保持只读；原 Comrak 阅读管线继续负责已保存和未保存文本的安全渲染。没有接入 Milkdown、AI、自动保存或 V03-P3 分屏模式，也没有更改应用版本号和发布标签。

## 实现内容

- 使用 CodeMirror 6 实现按需加载的 Markdown 源码编辑器，包含语法高亮、行号、自动换行、缩进、括号匹配、撤销/重做、查找，以及字号和光标/滚动状态保持。
- Markdown 标签增加“阅读 / 编辑”、保存、撤销、重做入口；脏标签显示圆点。编辑器按需导入，阅读模式仍使用现有 Reader。
- 每个标签独立保留编辑会话和内存草稿。切回阅读时将当前草稿送到 Rust Comrak + Ammonia 原有渲染管线，未保存草稿不会被磁盘或阅读状态覆盖。
- 新增 Rust 编辑会话授权：打开时登记路径和磁盘哈希；普通保存只允许写回已授权 Markdown 文件；另存为重新校验目标路径和版本；新建使用原子 create-only，不能覆盖已有目标。
- 保存使用临时文件与原子替换，保留 UTF-8 BOM 与 LF/CRLF；保存期间若磁盘版本变化则拒绝覆盖。写入前再次检查目标版本，缩小外部并发修改窗口。
- Cmd/Ctrl+S 保存；保存失败或保存后又产生新修改时，草稿继续保持 dirty。
- 关闭未保存标签、退出、切换工作区时提供“保存 / 放弃 / 取消”。退出保护在 Tauri 侧读取脏文档计数，阻止无提示退出并通知前端弹出决策框。
- 外部修改、删除以及 watcher 竞态保留内存草稿并显示冲突提示；支持明确选择重新加载、另存为或继续当前草稿。重新加载前会提示草稿将被替换。
- 修复原子替换文件监听竞态：监听报告移除时等待短暂稳定窗口，再通过 Rust 路径检查确认文件是否真的不存在；如果目标仍存在，则继续比较授权会话哈希。由此避免正常保存误报“文件已删除”，同时保留真实删除检测。
- 文件树中新建 Markdown 后打开对应标签并切到编辑模式；PDF/OFD 没有编辑和保存入口。
- 编辑器字号设置持久化；新增的提示和操作文案覆盖简体中文、英文和日文。

## 主要代码

- `src/components/editor/CodeMirrorEditor.tsx`：CodeMirror 6 编辑器和状态保留。
- `src/components/editor/UnsavedChangesDialog.tsx`、`ExternalChangeBanner.tsx`：未保存与磁盘冲突处理。
- `src/app/App.tsx`、`src/components/layout/AppHeader.tsx`：模式、会话、保存和退出保护集成。
- `src-tauri/src/services/editor.rs`、`files.rs`、`reader.rs`：会话授权、受控写入和共享安全 Markdown 渲染。
- `src-tauri/src/commands.rs`、`lib.rs`：IPC 命令注册与退出拦截。
- `src/features/reader/preferences.ts`、`src/components/reader/SettingsDialog.tsx`、`src/features/i18n.tsx`：字号偏好和多语言文案。

## 安全边界

只有 `.md` 和 `.markdown` 可创建、编辑或保存；编辑会话读取也会校验文件类型。写入命令不能任意写入 PDF/OFD，常规保存受会话授权限制；另存为和创建操作在 Rust 侧校验扩展名、父目录、符号链接和目标版本。路径中的符号链接目标会被拒绝。Markdown 内容不会作为原始 HTML 直接插入 DOM。

该实现不是针对恶意本机进程的文件句柄沙箱：若本机其他进程在路径检查与文件系统操作之间竞争替换目录项，标准路径 API 仍有残余竞态；当前写入前二次校验用于降低而非消除这类风险。

## 与 V03-P3 边界

当前只实现“阅读”和“编辑”。没有分屏布局，也没有让编辑器预览与编辑器成为独立模块；草稿预览复用既有 Rust 渲染命令。V03-P3 可基于此会话接口增加分屏，但必须沿用草稿缓冲区、版本冲突和安全渲染边界。
