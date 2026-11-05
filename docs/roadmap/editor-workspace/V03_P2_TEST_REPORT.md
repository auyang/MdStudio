# V03-P2 测试报告

日期：2026-11-05

测试平台：macOS（当前开发机）

目标版本：0.3.0；基线版本：0.2.0。

## 自动化结果

| 命令 | 结果 | 实际输出摘要 |
|---|---|---|
| `pnpm test` | 通过 | 29 个测试文件、187 项通过、0 失败。覆盖 CodeMirror 编辑、脏状态、未保存保护、工作区收起状态及上次工作区启动恢复，并回归 MD/PDF/OFD。 |
| `pnpm build` | 通过 | `tsc -b` 与 Vite 8.3.5 生产构建完成；验收复跑的 Vite 构建 2.89 秒。 |
| `cd src-tauri && cargo test --locked` | 通过 | 67 个 Rust 单元测试通过，0 失败；主程序和 doctests 各 0 项、通过。 |
| `cd src-tauri && cargo fmt --check` | 通过 | 无格式差异。 |
| `git diff --check` | 通过 | 无空白错误。 |
| `pnpm tauri build --debug --bundles app` | 通过 | 2026-11-05 发布复核构建耗时 31.45 秒；生成 `src-tauri/target/debug/bundle/macos/MdStudio.app`，大小 52.72 MiB。 |

## 桌面实测：macOS

使用刚构建的 Debug `.app`，不是旧版 `/Applications/MdStudio.app`：

1. 对临时工作区中的 `readme.md` 进入编辑，修改后标签出现“未保存”状态，保存按钮启用。
2. Cmd+S 保存成功，脏标识消失；磁盘文件内容变为 77 B，与编辑器内容一致。
3. 保存触发原子替换后，文件监听短暂报告移除。首次实测发现标签误报删除；加入延迟路径核验及哈希复查后重新构建，回归自动测试通过。
4. 新增未保存草稿后切回阅读，当前内存内容可见；再进入编辑，草稿仍完整。
5. 关闭标签弹出保存/放弃/取消提示；取消后标签和脏草稿保留，放弃后标签关闭。
6. 实测 `reader-sample.pdf` 显示 6 页和连续页面内容；切回 OFD 标签，OFD 发票正文与单页控制正常。

桌面测试只修改 `/private/tmp/mdstudio-workspace-e2e/readme.md` 临时样本，没有改写项目中的 Markdown fixture 或其他用户文档。测试结束时临时样本保留的是已保存版本；未保存验证草稿已放弃。

2026-11-05 验收复跑新增确认：成功打开工作区会记录路径；桌面启动时会调用受控的 `open_workspace` 恢复路径，并在根目录加载文件树。该行为由 `App.test.tsx` 集成用例覆盖。没有在本轮更改其他用户文档。

## 已覆盖的数据保护

- Rust 测试覆盖 BOM、CRLF 往返、外部版本变化拒绝覆盖、目标路径/扩展名检查、符号链接保护、create-only 不覆盖，以及授权会话另存为重新绑定。
- 前端测试覆盖保存失败保留编辑缓冲区、保存后继续修改不误清 dirty、标签关闭决策、应用退出事件提示，以及原子替换文件监听事件不误报删除。
- 未执行真实 Windows/Linux 桌面手工测试，也没有在 Windows/Linux runner 上交叉构建。

## 已知构建提示

- Vite CSS 优化器对现有 `::highlight(...)` 规则报告 4 条语法提示；构建成功，文本搜索高亮依赖该浏览器 API。本阶段未触碰阅读器搜索样式。
- Vite 报告部分既有分块超过 500 kB。CodeMirror 编辑器 chunk 约 550.15 kB（gzip 约 189.84 kB），通过动态导入只在编辑模式加载；OFD Viewer 和其他阅读器大分块属于既有多格式依赖。
- Rust 编译保留 13 条既有未使用代码警告，包括 `is_markdown_file` 与 `files.rs` 历史服务项；没有为消除警告删除历史代码。

## 结论

本机 macOS 桌面主路径和自动化回归通过。Windows/Linux 平台验证仍未完成；本报告不据此声称跨平台实测通过。
