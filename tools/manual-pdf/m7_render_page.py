#!/usr/bin/env python3
"""渲染某份说明书 PDF 指定段落所在的页（M7 抽检目视核对用）。

用法：python tools/manual-pdf/m7_render_page.py --pdf "D:/manuals/xxx.pdf" --section 不良反应 --out .tmp-m7/x.png [--dpi 120]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pymupdf


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--pdf', type=Path, required=True)
    parser.add_argument('--section', default='不良反应')
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--dpi', type=int, default=120)
    parser.add_argument('--page', type=int, default=0, help='直接指定页码（1 起），0 = 按段落名定位')
    args = parser.parse_args()

    doc = pymupdf.open(args.pdf)
    if args.page:
        pages = [args.page - 1]
    else:
        pages = []
        for pno in range(doc.page_count):
            text = doc[pno].get_text()
            if f'【{args.section}】' in text or (args.section in text and pno > 0 and '【' in text):
                pages.append(pno)
    if not pages:
        print('未定位到段落', file=sys.stderr)
        return 1
    page = doc[pages[0]]
    pix = page.get_pixmap(dpi=args.dpi)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    pix.save(args.out)
    print(f'page {pages[0] + 1} → {args.out} ({pix.width}x{pix.height})')
    return 0


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    raise SystemExit(main())
