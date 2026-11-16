#!/usr/bin/env python3
"""M7 重提取结果分析：完整性异常、规格变化、残留表格（按旧签名口径）。"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

BEFORE = Path('data/manuals')
AFTER = Path('data/manuals-incoming-m7')
REPORTS = Path('data/m7-reports')

FREQ_SIGNATURE = re.compile(r'十分常见[\s\S]{0,80}常见[\s\S]{0,160}(?:偶见|罕见)')


def has_table(text: str) -> bool:
    return text.startswith('|') or '\n|' in text


def flatten_signature(text: str) -> bool:
    return bool(FREQ_SIGNATURE.search(text)) or ('系统器官分类' in text and '常见' in text)


def load(dirpath: Path, drug_ids: set[str] | None = None) -> dict[str, dict]:
    out = {}
    for path in sorted(dirpath.glob('*.json')):
        if drug_ids is not None and path.stem not in drug_ids:
            continue
        d = json.loads(path.read_text(encoding='utf-8'))
        out[d['drugId']] = d
    return out


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description='M7 重提取结果分析')
    parser.add_argument('--before', type=Path, default=BEFORE, help='重提取前的草稿池（M6 归档副本）')
    parser.add_argument('--after', type=Path, default=AFTER)
    parser.add_argument('--reports', type=Path, default=REPORTS)
    args = parser.parse_args()
    before_dir, after_dir, reports_dir = args.before, args.after, args.reports

    ids = set()
    for line in (reports_dir / 'rows.jsonl').open(encoding='utf-8'):
        row = json.loads(line)
        ids.add(row['drugId'])
        if row.get('oldDrugId'):
            ids.add(row['oldDrugId'])
    before = load(before_dir, ids)
    after = load(after_dir, set(r['drugId'] for r in (json.loads(l) for l in (reports_dir / 'rows.jsonl').open(encoding='utf-8'))))

    rows = [json.loads(line) for line in (reports_dir / 'rows.jsonl').open(encoding='utf-8')]
    new_by_id = {r['drugId']: r for r in rows}

    print('=== 1. 完整性异常（丢字）===')
    comps = [json.loads(line) for line in (reports_dir / 'completeness.jsonl').open(encoding='utf-8')]
    heavy = [c for c in comps if c['lostRatio'] > 0.02]
    print(f' 丢字行 {len([c for c in comps if c["lost"] > 0])}，超 2% 阈值 {len(heavy)}')
    for c in sorted(heavy, key=lambda x: -x['lostRatio'])[:15]:
        print(f"   {c['lostRatio']*100:5.2f}% lost={c['lost']:4d} gained={c['gained']:4d} before={c['beforeChars']:6d} {c['drugId']}")

    print('\n=== 2. 丢字样本对照（前 5）===')
    for c in sorted(heavy, key=lambda x: -x['lostRatio'])[:5]:
        old = before.get(c.get('oldDrugId') or '') or before.get(c['drugId'])
        new = after.get(c['drugId'])
        if not old or not new:
            continue
        # 找字符减少最多的段落
        worst = None
        for name, text in (old.get('sections') or {}).items():
            new_text = (new.get('sections') or {}).get(name, '')
            a, b = Counter(text), Counter(new_text)
            lost = sum((a - b).values())
            if lost and (worst is None or lost > worst[1]):
                worst = (name, lost, text, new_text)
        if worst:
            name, lost, ot, nt = worst
            print(f"  ▸ {c['drugId']} · {name} 丢 {lost}")
            # 找出旧文本里多出来的片段
            diff_chars = (Counter(ot) - Counter(nt))
            lost_chars = ''.join(sorted(diff_chars.elements()))
            print(f"     旧段落长度 {len(ot)}，新 {len(nt)}；缺失字符：{lost_chars[:80]!r}")
            print(f"     旧尾部：{ot[-120:]!r}")

    print('\n=== 3. 规格变化 28 行 ===')
    spec_changes = []
    for row in rows:
        old = before.get(row.get('oldDrugId') or '')
        new = after.get(row['drugId'])
        if not old or not new:
            continue
        if old['specification'] != new['specification']:
            spec_changes.append((row['drugId'], old['specification'], new['specification'], row['match']))
    print(f' 共 {len(spec_changes)} 行')
    for item in spec_changes[:30]:
        print(f'   {item[0]}: {item[1]!r} → {item[2]!r}（match={item[3]}）')

    print('\n=== 4. 表格残留（旧签名行是否已带表格）===')
    old_sig = [(did, d) for did, d in before.items() if flatten_signature((d.get('sections') or {}).get('不良反应', ''))]
    fixed = miss = 0
    missing_samples = []
    for old_id, old in old_sig:
        row = new_by_id.get(old_id)
        if row is None:
            # 旧 id 可能映射到新 id
            continue
        new = after.get(row['drugId'])
        if not new:
            continue
        text = (new.get('sections') or {}).get('不良反应', '')
        if has_table(text):
            fixed += 1
        else:
            miss += 1
            if len(missing_samples) < 10:
                missing_samples.append((row['drugId'], text[:160]))
    print(f' 旧签名行 {len(old_sig)} → 已重建表格 {fixed} / 仍无表格 {miss}')
    for did, text in missing_samples:
        print(f'   ✗ {did}: {text[:140]!r}')

    print('\n=== 5. 全库表格覆盖 ===')
    rows_with_table = sum(1 for d in after.values() if any(has_table(t) for t in (d.get('sections') or {}).values()))
    sections_with_table = Counter()
    for d in after.values():
        for name, text in (d.get('sections') or {}).items():
            if has_table(text):
                sections_with_table[name] += 1
    print(f' 含表格的说明书行 {rows_with_table}/{len(after)}')
    print(f' 段落维度：{dict(sections_with_table.most_common(8))}')
    return 0


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    raise SystemExit(main())
