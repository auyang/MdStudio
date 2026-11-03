#!/usr/bin/env python3
"""离线检查 OFD POC 样本的 ZIP、入口 XML、页数和内容覆盖。"""

from __future__ import annotations

import html
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path, PurePosixPath
from zipfile import BadZipFile, ZipFile


ROOT = Path(__file__).resolve().parents[1] / "public" / "samples"
SAMPLES = [
    {"file": "ofdrw-invoice.ofd", "pages": 1, "cjk": True, "fonts": 0, "images": 1},
    {"file": "upstream-ofdrw/ofdrw-seal-sample.ofd", "pages": 1, "cjk": True, "fonts": 0, "images": 1},
    {"file": "upstream-ofdrw/ofdrw-text-layout.ofd", "pages": 1, "cjk": True, "fonts": 2, "images": 0},
    {"file": "upstream-ofdrw/ofdrw-jpeg-sample.ofd", "pages": 2, "cjk": False, "fonts": 0, "images": 2},
    {"file": "upstream-ofdrw/ofdrw-missing-image.ofd", "pages": 2, "cjk": True, "fonts": 3, "images": 1},
    {"file": "upstream-ofdrw/ofdrw-sign-scale-error.ofd", "pages": 2, "cjk": True, "fonts": 0, "images": 0},
]


def inspect(sample: dict[str, object]) -> dict[str, object]:
    path = ROOT / str(sample["file"])
    if not path.is_file():
        raise AssertionError(f"缺少样本：{path}")

    with ZipFile(path) as archive:
        bad_member = archive.testzip()
        if bad_member:
            raise AssertionError(f"ZIP CRC 校验失败：{sample['file']} -> {bad_member}")

        names = archive.namelist()
        normalized: set[str] = set()
        for name in names:
            entry = PurePosixPath(name)
            if entry.is_absolute() or ".." in entry.parts or "\\" in name:
                raise AssertionError(f"样本包含不安全的 ZIP 路径：{sample['file']} -> {name}")
            key = str(entry)
            if key in normalized:
                raise AssertionError(f"样本包含规范化后重复的 ZIP 路径：{sample['file']} -> {name}")
            normalized.add(key)

        root_name = next((name for name in names if name.casefold() == "ofd.xml"), None)
        if not root_name:
            raise AssertionError(f"样本缺少 OFD.xml：{sample['file']}")
        ET.fromstring(archive.read(root_name))

        page_files = [
            name for name in names
            if re.search(r"(?:^|/)Pages/Page_[^/]+/Content\.xml$", name, re.IGNORECASE)
        ]
        if len(page_files) != sample["pages"]:
            raise AssertionError(f"页数变化：{sample['file']} 期望 {sample['pages']}，实得 {len(page_files)}")

        page_text = "".join(archive.read(name).decode("utf-8", "replace") for name in page_files)
        text_codes = re.findall(r"<(?:[\w.-]+:)?TextCode\b[^>]*>(.*?)</(?:[\w.-]+:)?TextCode>", page_text, re.DOTALL)
        decoded_text = html.unescape("".join(text_codes))
        has_cjk = bool(re.search(r"[\u3400-\u9fff]", decoded_text))
        font_files = [name for name in names if name.lower().endswith((".ttf", ".otf", ".ttc"))]
        image_files = [name for name in names if name.lower().endswith((".png", ".jpg", ".jpeg", ".tif", ".tiff"))]

        if has_cjk != sample["cjk"]:
            raise AssertionError(f"中文文本覆盖变化：{sample['file']} 期望 {sample['cjk']}，实得 {has_cjk}")
        if len(font_files) != sample["fonts"]:
            raise AssertionError(f"嵌入字体数变化：{sample['file']} 期望 {sample['fonts']}，实得 {len(font_files)}")
        if len(image_files) != sample["images"]:
            raise AssertionError(f"图像资源数变化：{sample['file']} 期望 {sample['images']}，实得 {len(image_files)}")

        return {
            "file": sample["file"],
            "size": path.stat().st_size,
            "pages": len(page_files),
            "textCodes": len(text_codes),
            "cjkText": has_cjk,
            "embeddedFonts": len(font_files),
            "images": len(image_files),
            "zipEntries": len(names),
        }


def main() -> int:
    try:
        report = [inspect(sample) for sample in SAMPLES]
    except (AssertionError, BadZipFile, OSError, ET.ParseError) as error:
        print(f"样本校验失败：{error}", file=sys.stderr)
        return 1
    print(json.dumps(report, ensure_ascii=False, indent=2))
    print(f"样本校验通过：{len(report)} 个 OFD 文件")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
