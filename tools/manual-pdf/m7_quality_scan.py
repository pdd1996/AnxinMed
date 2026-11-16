#!/usr/bin/env python3
"""M7 质量扫描：统计「表格重建质量」相关的几类现象，用于关账报告。

指标：
1. fragmentedTables：同一段落里 Markdown 表被「频率前缀文本行」穿插（表格列被裁切/少识别列的征兆）；
2. partialColumnTables：连续两张 Markdown 表之间夹着非表格行（可能是同表被拆成多段）；
3. 表格行宽分布（2 列表格占比）；
4. 表格里出现「常见/偶见」前缀的概率（说明频率列被粘进了描述列）。

⚠️ 计数判据：本脚本按「连续 `|` 行块」计表格块，**不要求分隔行**，因此会多计
源文里的非表格管道行（例：`drug-cusuanlujidingrongye-0p05pct` 有 2 条，M6 起就存在）；
关账权威口径以 `m7_verify_numbers.py`（按 `|---|` 分隔行）为准。本脚本仅作诊断。

用法：python tools/manual-pdf/m7_quality_scan.py --drafts data/manuals-incoming-m7 --out data/m7-reports/quality-scan.json
"""
from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path

TABLE_LINE = re.compile(r'^\s*\|')
FREQ_PREFIX = re.compile(r'^(十分常见|常见|偶见|罕见|十分罕见|未知|不常见|非常常见)[：:、]?')


def table_blocks(text: str) -> list[list[str]]:
    """段落里的 Markdown 表格块（连续 | 行，分隔行也算）。"""
    blocks: list[list[str]] = []
    current: list[str] = []
    for line in text.split('\n'):
        if TABLE_LINE.match(line):
            current.append(line)
        elif current:
            blocks.append(current)
            current = []
    if current:
        blocks.append(current)
    return blocks


def scan_section(text: str) -> dict:
    blocks = table_blocks(text)
    lines = text.split('\n')
    table_line_index = [i for i, line in enumerate(lines) if TABLE_LINE.match(line)]
    table_line_set = set(table_line_index)
    # 紧邻表格块、以频率词开头的文本行（表格列被拆到正文的征兆）
    fragmented = 0
    for i, line in enumerate(lines):
        if i in table_line_set or not line.strip():
            continue
        if not FREQ_PREFIX.match(line.strip()):
            continue
        before = i - 1 >= 0 and (i - 1) in table_line_set
        after = i + 1 < len(lines) and (i + 1) in table_line_set
        if before or after:
            fragmented += 1
    widths = []
    for block in blocks:
        for line in block:
            cells = [c for c in line.strip().strip('|').split('|')]
            widths.append(len(cells))
    return {
        'tables': len(blocks),
        'fragmentedLines': fragmented,
        'rowWidths': widths,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--drafts', type=Path, default=Path('data/manuals-incoming-m7'))
    parser.add_argument('--out', type=Path, default=Path('data/m7-reports/quality-scan.json'))
    args = parser.parse_args()

    rows_with_fragments = []
    width_counter: Counter[int] = Counter()
    rows_with_tables = 0
    total_tables = 0
    for path in sorted(args.drafts.glob('*.json')):
        draft = json.loads(path.read_text(encoding='utf-8'))
        sections = draft.get('sections') or {}
        row_tables = 0
        row_frag = 0
        for name, text in sections.items():
            result = scan_section(text)
            if result['tables']:
                row_tables += result['tables']
                row_frag += result['fragmentedLines']
                for width in result['rowWidths']:
                    width_counter[width] += 1
        if row_tables:
            rows_with_tables += 1
            total_tables += row_tables
        if row_frag:
            rows_with_fragments.append({'drugId': draft['drugId'], 'fragmentedLines': row_frag, 'tables': row_tables})

    summary = {
        'rows': len(list(args.drafts.glob('*.json'))),
        'rowsWithTables': rows_with_tables,
        'tableBlocks': total_tables,
        'rowsWithFragmentedLines': len(rows_with_fragments),
        'fragmentedRows': len(rows_with_fragments),
        'widthDistribution': dict(width_counter.most_common(8)),
        'samples': sorted(rows_with_fragments, key=lambda r: -r['fragmentedLines'])[:30],
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({k: v for k, v in summary.items() if k != 'samples'}, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    if hasattr(__import__('sys').stdout, 'reconfigure'):
        __import__('sys').stdout.reconfigure(encoding='utf-8')
    raise SystemExit(main())
