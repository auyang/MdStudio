# 文件夹工作区架构

## 范围

本阶段只实现 V03-P1 文件夹工作区。Markdown 编辑、CodeMirror 集成、脏状态、保存和预览不在本阶段。阅读器仍可在不打开文件夹的情况下按原方式使用。

## 调用链

```text
AppHeader 文件夹按钮 / 首页“打开文件夹工作区”
  → Tauri 原生目录选择器（单目录）
  → open_workspace(rootPath)
  → WorkspaceRegistry 保存本窗口授权根目录
  → FileTree 首次请求根目录直接子项
  → Rust list_workspace_directory(directoryPath)
  → 仅返回当前层目录元数据和受支持文档路径
  → 用户展开文件夹时再请求该子目录
  → 用户点文档 → App.openDocuments([path], 'workspace')
  → 原 adapter、canonicalPath 去重、多格式 tab 和 Viewer
```

新建流程：`FileTree` 输入文件名 → `create_workspace_markdown_file` → Rust 在授权目录中校验目录和文件名 → `create_new` 原子排他创建空 `.md` → FileTree 刷新 → App 通过原 Markdown adapter 打开新文档。

## Rust 服务与 Tauri API

`src-tauri/src/services/workspace.rs` 提供：

- `WorkspaceRegistry`：每个 Tauri 应用实例保存一次用户选择的规范目录；不接收任意路径作为文件内容读取权限。
- `open_workspace`：绝对路径、目录类型和根路径符号链接检查后规范化并登记。
- `list_directory`：只列举请求目录的直接子项；检查其位于授权根之内，拒绝路径穿越和目录链符号链接；忽略 `.git`、`node_modules`、`target` 等目录及其他点目录；仅输出 Markdown/PDF/OFD 与普通目录；目录优先、名称排序；每层最多 2,000 项并返回截断标记。
- `create_markdown_file`：仅允许单一文件名和 `.md/.markdown`；拒绝控制字符、路径分隔符、Windows 非法字符及设备名；使用 `create_new`，文件已存在时失败且不覆盖。

三个 Tauri commands 已在普通和 perf-benchmark command handler 中注册。沿用现有 `dialog:allow-open`，不新增文件系统插件或依赖。

## React 组件与状态

- `FileTree.tsx` 负责加载状态、错误、懒展开缓存、刷新、新建表单、当前文件高亮及拖动宽度句柄。
- `App.tsx` 保留 tabs 和文档生命周期为唯一权威；工作区点击直接复用 `openDocuments`。
- 左侧栏宽度限制 180–420 px；展开/收起与宽度放在独立 `mdstudio-workspace-ui-v1` localStorage 偏好中。
- P1 只持久化 sidebar 是否收起和宽度；工作区路径和展开节点不跨重启恢复，这属于 P4。
- 窄窗口时侧栏覆盖正文并有阴影；桌面宽窗口时正文和状态栏为侧栏留出宽度。

## 与历史模块的关系

没有注册旧 `services/files.rs`，避免将递归、仅 Markdown 的 `read_workspace_tree` 变成生产入口。CodeMirror/Milkdown、`DocumentSession` 和 merge 算法都未进入当前 App，本次不安装依赖或改变阅读代码。
