# PDF 阅读器验收素材

这些文件是本地测试素材，不包含生产文档。用于验证 PDF.js 本地资源加载、页渲染、文字层搜索、取消/关闭以及异常提示。

| 文件 | 覆盖场景 |
| --- | --- |
| `normal-chinese-multipage.pdf` | 6 页中文/英文可搜索文本、连续阅读 |
| `scanned-image-only.pdf` | 仅含图片的扫描件；应提示没有可搜索文字，不执行 OCR |
| `encrypted.pdf` | 密码保护错误；测试密码为 `fixture-secret` |
| `corrupt.pdf` | 无效/损坏内容的错误回退 |
| `rotated-page.pdf` | 页面自带旋转信息和查看器旋转 |
| `bookmarks.pdf` | PDF 目录/书签读取 |
| `large-document.pdf` | 约 4.5 MB、20 页的分块读取和按需绘制 |

所有文件均为固定测试夹具。阅读器只读打开，不回写这些文件。
