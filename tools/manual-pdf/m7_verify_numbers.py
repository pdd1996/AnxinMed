#!/usr/bin/env python3
"""M7 关账数字复核：用最终产物（map / 草稿池 / DB 快照）复算所有已发布数字。

口径定义（M7 关账文档必须写清）：
- **PDF 级**：每份 PDF 的表格检测数（find_tables 张数），同一 PDF 多规格行不重复计；
- **行级**：每份说明书行（drugId）里重建出的 Markdown 表格块数（多规格行会重复计）；
- **段落块**：草稿里以「| 行 + |---| 分隔行」为一块的表格块数。

用法：python tools/manual-pdf/m7_verify_numbers.py --map data/m7-reports/reextract-map.jsonl \
        --drafts data/manuals --before <M6 草稿归档> --reports data/m7-reports/full
"""
from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path

FREQ_SIG = re.compile(r'十分常见[\s\S]{0,80}常见[\s\S]{0,160}(?:偶见|罕见)')
TABLE_SEP = re.compile(r'^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$')  # 必须含 ---，空行 | | | | 不算


def freq_signature(text: str) -> bool:
    return bool(FREQ_SIG.search(text)) or ('系统器官分类' in text and '常见' in text)


def count_table_blocks(text: str) -> int:
    """段落里的 Markdown 表格块数（以「分隔行」为块计数：每张表恰好一条分隔行）。"""
    return sum(1 for line in text.split('\n') if TABLE_SEP.match(line))


def load_drafts(directory: Path) -> dict[str, dict]:
    drafts = {}
    for path in sorted(directory.glob('*.json')):
        d = json.loads(path.read_text(encoding='utf-8'))
        drafts[d['drugId']] = d
    return drafts


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--map', type=Path, default=Path('data/m7-reports/reextract-map.jsonl'))
    parser.add_argument('--drafts', type=Path, default=Path('data/manuals'))
    parser.add_argument('--before', type=Path, required=True, help='M6 草稿归档目录')
    parser.add_argument('--reports', type=Path, default=Path('data/m7-reports/full'))
    args = parser.parse_args()

    # ---- 1) map：PDF 级 vs 行级（同一 sourceFile 去重） ----
    map_rows = [json.loads(line) for line in args.map.open(encoding='utf-8') if line.strip()]
    per_file: dict[str, dict] = {}
    row_level_tables = 0
    row_level_merged = 0
    for row in map_rows:
        if row['kind'] != 'draft':
            continue
        row_level_tables += int(row.get('tables') or 0)
        row_level_merged += int(row.get('mergedContinuations') or 0)
        per_file[row['sourceFile']] = {
            'tables': int(row.get('tables') or 0),
            'merged': int(row.get('mergedContinuations') or 0),
            'fallbacks': row.get('fallbacks') or [],
        }
    pdf_tables = sum(v['tables'] for v in per_file.values())
    pdf_merged = sum(v['merged'] for v in per_file.values())
    fb = Counter()
    for v in per_file.values():
        for item in v.get('fallbacks') or []:
            reason = item.get('reason', '') if isinstance(item, dict) else ''
            fb['line' if '行' in reason else 'table'] += 1
    row_fb = Counter()
    for row in map_rows:
        if row['kind'] != 'draft':
            continue
        for item in row.get('fallbacks') or []:
            reason = item.get('reason', '') if isinstance(item, dict) else ''
            row_fb['line' if '行' in reason else 'table'] += 1
    print('== 1) 表格口径 ==')
    print(f'   PDF 级（去重）：{len(per_file)} 份 PDF，表格 {pdf_tables} 张，跨页合并 {pdf_merged} 处')
    print(f'   行级（map 逐行累加）：表格 {row_level_tables} 张，跨页合并 {row_level_merged} 处')
    print(f'   回退（PDF 级去重）：行级 {fb["line"]} / 表格级 {fb["table"]}（合计 {sum(fb.values())}，{len([1 for v in per_file.values() if v.get("fallbacks")])} 份 PDF）')
    print(f'   回退（行级累加）：行级 {row_fb["line"]} / 表格级 {row_fb["table"]}（合计 {sum(row_fb.values())}）')

    # ---- 2) 草稿池：行级表格块 ----
    drafts = load_drafts(args.drafts)
    block_total = 0
    rows_with_blocks = 0
    for draft in drafts.values():
        blocks = sum(count_table_blocks(text) for text in (draft.get('sections') or {}).values())
        block_total += blocks
        if blocks:
            rows_with_blocks += 1
    print('\n== 2) 草稿池（M7 行级） ==')
    print(f'   行 {len(drafts)}，含表行 {rows_with_blocks}，表格块 {block_total}')

    # ---- 3) 频率签名口径 ----
    before = load_drafts(args.before)
    sig_old = sum(1 for d in before.values() if freq_signature((d.get('sections') or {}).get('不良反应', '')))
    sig_new = sum(1 for d in drafts.values() if freq_signature((d.get('sections') or {}).get('不良反应', '')))
    old_sig_ids = [d['drugId'] for d in before.values()
                   if freq_signature((d.get('sections') or {}).get('不良反应', ''))]
    has_table = [did for did in old_sig_ids
                 if '\n|' in (drafts.get(did, {}).get('sections') or {}).get('不良反应', '')
                 or (drafts.get(did, {}).get('sections') or {}).get('不良反应', '').startswith('|')]
    print('\n== 3) 频率表拉平签名 ==')
    print(f'   M6 草稿口径：{sig_old} 行；M7 草稿口径：{sig_new} 行')
    print(f'   旧签名行中已带重建表：{len(has_table)}；仍无表：{len(old_sig_ids) - len(has_table)}')

    # ---- 4) 报告数字对照 ----
    summary = json.loads((args.reports / 'summary.json').read_text(encoding='utf-8'))
    print('\n== 4) full/summary.json（行级口径） ==')
    t = summary['tables']
    print(f'   rowsWithTables={t["rowsWithTables"]} tableCount={t["tableCount"]} '
          f'mergedContinuations={t["mergedContinuations"]} fallbacks={t["fallbacks"]}')
    print(f'   completeness={summary["completeness"]}')
    print(f'   字段变化={summary["fieldChanges"]}')
    print(f'   行数 before/after={summary["beforeRows"]}/{summary["afterRows"]}')

    print('\n== 5) 口径对照结论 ==')
    print(f'   关账文档「2375 张表 / 395 合并」= PDF 级：{pdf_tables} / {pdf_merged}')
    print(f'   关账文档「3529 张 / 609 合并」= 报告行级：{row_level_tables} / {row_level_merged}')
    print(f'   关账文档「760 行含表」= 行级（含表行）：{rows_with_blocks}')
    return 0


if __name__ == '__main__':
    if hasattr(__import__('sys').stdout, 'reconfigure'):
        __import__('sys').stdout.reconfigure(encoding='utf-8')
    raise SystemExit(main())
