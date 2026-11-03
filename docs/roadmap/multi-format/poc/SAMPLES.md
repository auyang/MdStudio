# OFD POC 样本集

更新日期：2026-11-03。样本仅供隔离 POC 使用，不代表生产兼容，也不作为正式安装包资源。

## 来源与范围

现有样本来自 [OFDRW 仓库](https://github.com/ofdrw/ofdrw) 的 `ofdrw-converter/src/test/resources`。仓库声明 MIT 许可；本地文件保留原始字节并记录 SHA-256。来源文件链接可从表格打开。仓库级 MIT 不足以单独证明 OFD 内嵌图像、字体、印章等第三方内容可再分发；因此这些样本留在研究 POC 中，生产包、公开样本集或商业发行前仍需逐项确认资源授权。详细说明见 [上游样本许可提示](UPSTREAM-SAMPLES-NOTICE.md)。

## 样本清单

| 本地样本 | 上游来源 | 实际覆盖（离线结构检查） | SHA-256 |
|---|---|---|---|
| `public/samples/ofdrw-invoice.ofd` | [发票示例.ofd](https://github.com/ofdrw/ofdrw/blob/master/ofdrw-converter/src/test/resources/%E5%8F%91%E7%A5%A8%E7%A4%BA%E4%BE%8B.ofd) | 1 页；42 个 TextCode；含中文；无嵌入字体；1 张 PNG 二维码。复现原始缺字体问题。 | `f52f1df911c3d84943a7699fc517a528560e9e492082e72ee65d5ef5df8ad976` |
| `public/samples/upstream-ofdrw/ofdrw-seal-sample.ofd` | [发票监制章-数科.ofd](https://github.com/ofdrw/ofdrw/blob/master/ofdrw-converter/src/test/resources/%E5%8F%91%E7%A5%A8%E7%9B%91%E5%88%B6%E7%AB%A0-%E6%95%B0%E7%A7%91.ofd) | 1 页；54 个 TextCode；含中文；无嵌入字体；1 张 PNG。页面含 “For Evaluation Only” 字样，明确不作为产品资源。 | `6cf19b83504d726c6e410a1dc1932110796273cb008712a798d605e644a75f2e` |
| `public/samples/upstream-ofdrw/ofdrw-text-layout.ofd` | [文字横向-数科.ofd](https://github.com/ofdrw/ofdrw/blob/master/ofdrw-converter/src/test/resources/%E6%96%87%E5%AD%97%E6%A8%AA%E5%90%91-%E6%95%B0%E7%A7%91.ofd) | 1 页；18 个 TextCode；含中文；包内 2 个 TTF；用于检查内嵌字体路径。 | `af966418d8dbab115e97efcb6f0ba58e684441bdca148315eaf59b1bcf239956` |
| `public/samples/upstream-ofdrw/ofdrw-jpeg-sample.ofd` | [containsJPEG.ofd](https://github.com/ofdrw/ofdrw/blob/master/ofdrw-converter/src/test/resources/containsJPEG.ofd) | 2 页；2 个 JPEG；没有 TextCode；用于多页/位图路径，不代表扫描件 OCR 能力。 | `2cb4f2c28b2593a803f7f2516fc100ba6277a48816c4175e8636e0ed25c800bb` |
| `public/samples/upstream-ofdrw/ofdrw-missing-image.ofd` | [testImageNotFound.ofd](https://github.com/ofdrw/ofdrw/blob/master/ofdrw-converter/src/test/resources/testImageNotFound.ofd) | 2 页；11 个 TextCode；含中文；3 个嵌入字体、1 个图像资源；用于资源缺失/图像诊断。 | `1fbdf67be374c2b453ef8a07051a697dcbbb32117cc7835d2639552101ca953c` |
| `public/samples/upstream-ofdrw/ofdrw-sign-scale-error.ofd` | [SignScaleError.ofd](https://github.com/ofdrw/ofdrw/blob/master/ofdrw-converter/src/test/resources/SignScaleError.ofd) | 2 页；422 个 TextCode；含中文；包含签章目录；用于签章缩放异常路径。不是验签成功样本。 | `7999a96a8426eecde425e020dfcab7ed4bfa5e2d00f24482418e12596b4247c3` |

结构检查脚本：`python3 scripts/validate_samples.py`。它校验 ZIP CRC、OFD.xml 可解析、页数、中文 TextCode、嵌入字体/图片计数和 ZIP 路径；它不校验画面是否正确，也不证明密码学签章有效。

## 仍然缺少的独立样本

- 真实可公开授权的票据（非发票）及行政公文样本；本轮未找到可确认具体文件许可的测试件。
- 无字体与嵌入字体两种情形下的渲染对照，以及至少一份明确声明许可的可再分发 CJK fallback 字体。
- 权属明确、允许复测/分发的真实印章样本及验签对照；当前 seal 文件虽能显示印章图形，但带 “For Evaluation Only”，且没有验证签名链。
- 加密文件、损坏 ZIP/缺失 OFD.xml、异常 XML、压缩炸弹和大文件样本。
- 多页文字内容完整、搜索和复制均有期望结果的样本。

## 本轮桌面复测记录（macOS）

- 原始发票无回退字体时复现 `W_FONT_MISSING`；加载本机 `Hiragino Sans GB.ttc`（23.5 MiB）后，Viewer UI 和 Engine 均显示中文，搜索发票代码返回 1 项。字体只在本机 POC 临时读取，不随样本或应用复制。
- 中文内嵌字体样本在 UI 仍报告 `W_FONT_MISSING`（资源 23），中文未显示；Engine 只显示部分 Latin 内容。内嵌字体路径仍未通过。
- 双页 JPEG 样本两套阅读器都识别页数并可翻页。Engine 显示图像；Viewer UI 报 `W_IMAGE_DECODE: 渲染已取消`，页面为空白。
- 缺失图像样本仍能读取中文正文，并报告 `图片 135 未解码，已跳过`。这验证了可见降级提示，不验证缺失图像恢复。
- 监制章样本在两个 viewer 中都可见红色章图形，但样本带 “For Evaluation Only”。仅证明该测试件的外观绘制，不代表正式样本授权，也不代表验签通过。

样本和字体修复能复现核心发票问题，但剩余空白/缺字及样本许可缺口使 P3 复评仍为 C / No-Go；Windows/Linux、恶意容器、加密文档、大文件、内存峰值和签章验证仍未测。详见 [P3 复评](../POC_GO_NO_GO.md) 与 [兼容矩阵](../02-compatibility-matrix.md)。
