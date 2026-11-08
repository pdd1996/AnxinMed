#!/usr/bin/env python3
"""生成离线说明书审核页（M6-T9）。

输入 review-export 导出的 JSON，把每份 PDF 的前 N 页渲染成 PNG，
连同模板一起输出到目录；审核人用浏览器打开 review.html 逐项核对。

用法（仓库根目录）：
  python tools/manual-pdf/review_page.py --data data/review-batches/batch-01.json \
      --pdf-dir D:/manuals --out data/review-batches/batch-01
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

import fitz


def render_pdf(pdf_path: Path, prefix: Path, max_pages: int, dpi: int) -> list[str]:
    images: list[str] = []
    doc = fitz.open(pdf_path)
    zoom = dpi / 72
    matrix = fitz.Matrix(zoom, zoom)
    for i in range(min(doc.page_count, max_pages)):
        pix = doc.load_page(i).get_pixmap(matrix=matrix)
        name = f'{prefix.stem}-p{i + 1}.png'
        pix.save(prefix.with_name(name))
        images.append(f'assets/{name}')
    doc.close()
    return images


def main() -> int:
    parser = argparse.ArgumentParser(description='生成离线说明书审核页')
    parser.add_argument('--data', type=Path, required=True)
    parser.add_argument('--pdf-dir', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--max-pages', type=int, default=4)
    parser.add_argument('--dpi', type=int, default=100)
    parser.add_argument('--skip-images', action='store_true', help='只生成页面结构（调试用）')
    args = parser.parse_args()

    payload = json.loads(args.data.read_text(encoding='utf-8'))
    args.out.mkdir(parents=True, exist_ok=True)
    assets = args.out / 'assets'
    assets.mkdir(exist_ok=True)

    missing = []
    for idx, item in enumerate(payload['items']):
        item['_images'] = []
        if args.skip_images:
            continue
        pdf = args.pdf_dir / item['sourceFile']
        if not pdf.exists():
            missing.append(item['sourceFile'])
            continue
        try:
            item['_images'] = render_pdf(pdf, assets / f'item-{idx:03d}', args.max_pages, args.dpi)
        except Exception as exc:  # 失败必须可见，不静默跳过
            missing.append(f'{item["sourceFile"]}（{exc}）')

    template = Path(__file__).with_name('review_template.html')
    shutil.copyfile(template, args.out / 'review.html')
    (args.out / 'review-data.js').write_text(
        'window.REVIEW_DATA = ' + json.dumps(payload, ensure_ascii=False).replace('</', '<\\/') + ';\n',
        encoding='utf-8',
    )

    total = sum(p.stat().st_size for p in args.out.rglob('*') if p.is_file())
    print(f'[OK] 审核页：{args.out / "review.html"}')
    print(f'   条目 {len(payload["items"])} 份 / 页图 {sum(len(i["_images"]) for i in payload["items"])} 张 / 大小 {total / 1024 / 1024:.1f} MB')
    if missing:
        print(f'[WARN] {len(missing)} 份未生成页图：')
        for name in missing:
            print(f'   {name}')
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
