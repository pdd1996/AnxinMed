#!/usr/bin/env python3
"""诊断 63 行「残留拉平签名」：源 PDF 的【不良反应】页到底有没有表格结构。

判据：找到【不良反应】标题所在页（及后续一页），统计 find_tables(strategy=lines) 的表格数，
并检查该段文本是否真的像表格（含「系统器官分类/血液和淋巴系统异常 + 常见：」这类）；
用于区分「源文本来就是分频率的叙述」与「表格没被识别」。

用法：python tools/manual-pdf/m7_residual_probe.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pymupdf

REPORTS = Path('data/m7-reports')
AFTER = Path('data/manuals-incoming-m7')
PDF_DIR = Path('D:/manuals')

FREQ_SIGNATURE = re.compile(r'十分常见[\s\S]{0,80}常见[\s\S]{0,160}(?:偶见|罕见)')


def flatten_signature(text: str) -> bool:
    return bool(FREQ_SIGNATURE.search(text)) or ('系统器官分类' in text and '常见' in text)


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description='残留拉平签名分类诊断')
    parser.add_argument('--before', type=Path, default=Path('data/manuals'),
                        help='重提取前的草稿池（M6 归档副本）')
    parser.add_argument('--after', type=Path, default=AFTER)
    parser.add_argument('--pdf-dir', type=Path, default=PDF_DIR)
    args = parser.parse_args()
    pdf_dir = args.pdf_dir

    drafts = {}
    for path in args.after.glob('*.json'):
        d = json.loads(path.read_text(encoding='utf-8'))
        drafts[d['drugId']] = d

    # 旧签名行：从旧草稿池里找
    rows = []
    for path in args.before.glob('*.json'):
        d = json.loads(path.read_text(encoding='utf-8'))
        if not flatten_signature((d.get('sections') or {}).get('不良反应', '')):
            continue
        new = drafts.get(d['drugId'])
        if new is None:
            continue
        text = (new.get('sections') or {}).get('不良反应', '')
        if text.startswith('|') or '\n|' in text:
            continue
        rows.append((d['drugId'], d['sourceFile'], text))

    print(f'残留候选 {len(rows)} 行')
    classified = {'source-has-table': [], 'no-table-anywhere': [], 'pdf-missing': [], 'prose-only': []}
    for drug_id, source_file, text in rows:
        pdf = pdf_dir / source_file
        if not pdf.exists():
            classified['pdf-missing'].append((drug_id, source_file))
            continue
        doc = pymupdf.open(pdf)
        # 不良反应标题页：逐页找 【不良反应】 或 不良反应 作为段名
        pages = []
        for pno in range(doc.page_count):
            page_text = doc[pno].get_text()
            if '不良反应' in page_text and ('【不良反应】' in page_text or re.search(r'不良反应\s*\n', page_text)):
                pages.append(pno)
                if len(pages) >= 2:
                    break
        table_pages = []
        table_count = 0
        for pno in pages:
            for span in (0, 1):
                idx = pno + span
                if idx >= doc.page_count:
                    continue
                finder = doc[idx].find_tables()
                if finder.tables:
                    table_pages.append(idx + 1)
                    table_count += len(finder.tables)
        total_tables = 0
        for pno in range(doc.page_count):
            total_tables += len(doc[pno].find_tables().tables)
            if total_tables > 0:
                break
        # 该段是否本来就是「分频率叙述」（每个器官系统后跟 常见：/偶见：/罕见：）
        prose_style = len(re.findall(r'(十分常见|常见|偶见|罕见|未知)[：:]', text)) >= 3
        if table_pages:
            classified['source-has-table'].append((drug_id, source_file, table_pages, table_count))
        elif prose_style:
            classified['prose-only'].append((drug_id, source_file))
        elif total_tables == 0:
            classified['no-table-anywhere'].append((drug_id, source_file))
        else:
            classified['no-table-anywhere'].append((drug_id, source_file))
        doc.close()

    for key, items in classified.items():
        print(f'\n== {key}: {len(items)} ==')
        for item in items[:25]:
            print('  ', item)
    return 0


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    raise SystemExit(main())
