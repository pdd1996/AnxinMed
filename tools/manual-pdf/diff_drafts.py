#!/usr/bin/env python3
"""M7 重提取差异与质量报告（T4）——staging vs 现有草稿池。

只读，不写数据库。产出（默认 data/m7-reports/）：
  summary.json           总览：字段/段落变更计数、表格统计、完整性结论、残留拉平签名
  rows.jsonl             逐行差异明细（字段、段落长度、完整性、表格标记）
  completeness.jsonl     「字符多重集」有增减的行（证据保全：只允许重排、不允许丢字）
  residual-flattened.jsonl 仍以「拉平文本」形态出现频率表特征的行

完整性判据（M7 §4.1）：把整行说明书所有段落拼起来，去掉空白、Markdown 表格分隔线与
`|`，比较非空白字符的多重集。表格重建只应移动字符，不应增删。

用法（仓库根目录）：
  python tools/manual-pdf/diff_drafts.py --before data/manuals \
      --after data/manuals-incoming-m7 --map data/m7-reports/reextract-map.jsonl \
      --out data/m7-reports
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

TABLE_LINE_RE = re.compile(r'^\s*\|')
FREQ_SIGNATURE_RE = re.compile(r'十分常见[\s\S]{0,80}常见[\s\S]{0,160}(?:偶见|罕见)')
PIPE_NORMALIZE_RE = re.compile(r'[ \t]*\|[ \t]*')


def strip_markdown(text: str) -> str:
    """去掉 Markdown 表格分隔线、管道符与空白，只留正文可见字符。"""
    lines = []
    for line in str(text or '').split('\n'):
        if TABLE_LINE_RE.match(line) and re.fullmatch(r'\|[\s\-:|]+\|?', line.strip()):
            continue  # | --- | --- | 分隔行
        lines.append(line)
    joined = '\n'.join(lines)
    joined = PIPE_NORMALIZE_RE.sub('', joined)
    return re.sub(r'\s+', '', joined)


def char_diff(before: str, after: str) -> dict:
    """before 的字符有多大比例仍出现在 after（丢失率），after 多出多少（重复/新增）。"""
    a = Counter(strip_markdown(before))
    b = Counter(strip_markdown(after))
    lost = sum((a - b).values())
    gained = sum((b - a).values())
    total = sum(a.values()) or 1
    return {'lost': lost, 'gained': gained, 'beforeChars': sum(a.values()), 'afterChars': sum(b.values()),
            'lostRatio': round(lost / total, 6)}


def flatten_residual_lines(text: str) -> list[str]:
    """段落里仍是「拉平文本」形态的频率表特征行（非 Markdown 表格行）。"""
    residuals = []
    for line in str(text or '').split('\n'):
        if TABLE_LINE_RE.match(line):
            continue
        if FREQ_SIGNATURE_RE.search(line) or ('系统器官分类' in line and '常见' in line):
            residuals.append(line[:120])
    return residuals


def load_drafts(directory: Path) -> dict[str, dict]:
    drafts = {}
    for path in sorted(directory.glob('*.json')):
        draft = json.loads(path.read_text(encoding='utf-8'))
        drafts[draft['drugId']] = draft
    return drafts


def main() -> int:
    parser = argparse.ArgumentParser(description='M7 重提取差异与质量报告')
    parser.add_argument('--before', type=Path, required=True)
    parser.add_argument('--after', type=Path, required=True)
    parser.add_argument('--map', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()

    before = load_drafts(args.before)
    after = load_drafts(args.after)
    args.out.mkdir(parents=True, exist_ok=True)

    map_rows = [json.loads(line) for line in args.map.open(encoding='utf-8') if line.strip()]
    draft_map = [r for r in map_rows if r['kind'] == 'draft']
    deleted = [r for r in map_rows if r['kind'] == 'deleted-old']
    old_to_new = {r['oldDrugId']: r['drugId'] for r in draft_map if r.get('oldDrugId')}
    new_to_old = {r['drugId']: r['oldDrugId'] for r in draft_map if r.get('oldDrugId')}

    field_changes = Counter()
    section_changes = Counter()
    rows_out = []
    completeness = []
    residuals = []
    tables = {'rowsWithTables': 0, 'tableCount': 0, 'mergedContinuations': 0, 'fallbacks': 0}
    spec_changed = []
    approval_changed = []
    brand_filled = []
    new_rows = []

    for info in draft_map:
        drug_id = info['drugId']
        new = after.get(drug_id)
        if new is None:
            continue
        old = before.get(info['oldDrugId']) if info.get('oldDrugId') else None
        tables['tableCount'] += int(info.get('tables') or 0)
        tables['mergedContinuations'] += int(info.get('mergedContinuations') or 0)
        tables['fallbacks'] += len(info.get('fallbacks') or [])
        if (info.get('tables') or 0) > 0:
            tables['rowsWithTables'] += 1

        diff = {'drugId': drug_id, 'oldDrugId': info.get('oldDrugId'), 'match': info['match'],
                'specification': new['specification'], 'changedFields': [], 'changedSections': {},
                'tables': info.get('tables', 0)}
        if old is None:
            new_rows.append({'drugId': drug_id, 'specification': new['specification'],
                             'oldDrugId': None, 'match': info['match']})
            rows_out.append(diff)
            continue

        for field in ('brandName', 'specification', 'approvalNumbers', 'form', 'manufacturer',
                      'version', 'genericName'):
            if old.get(field) != new.get(field):
                diff['changedFields'].append(field)
                field_changes[field] += 1
                if field == 'specification':
                    spec_changed.append({'drugId': drug_id, 'from': old.get(field), 'to': new.get(field)})
                if field == 'approvalNumbers':
                    approval_changed.append({'drugId': drug_id, 'from': old.get(field), 'to': new.get(field)})
                if field == 'brandName' and not old.get(field) and new.get(field):
                    brand_filled.append({'drugId': drug_id, 'brandName': new.get(field)})

        old_sections = old.get('sections') or {}
        new_sections = new.get('sections') or {}
        for name in sorted(set(old_sections) | set(new_sections)):
            old_text = old_sections.get(name, '')
            new_text = new_sections.get(name, '')
            if old_text == new_text:
                continue
            section_changes[name] += 1
            diff['changedSections'][name] = {
                'beforeLen': len(old_text), 'afterLen': len(new_text),
                'hasTable': '\n|' in new_text or new_text.startswith('|'),
            }
        diff['completeness'] = char_diff(''.join(old_sections.values()), ''.join(new_sections.values()))
        if diff['completeness']['lost'] > 0 or diff['completeness']['gained'] > 0:
            completeness.append({'drugId': drug_id, 'oldDrugId': info.get('oldDrugId'), **diff['completeness']})
        for name, text in new_sections.items():
            found = flatten_residual_lines(text)
            if found:
                residuals.append({'drugId': drug_id, 'section': name, 'lines': found})
        rows_out.append(diff)

    # 旧行没有在新池子里出现（且不属于已映射）→ 消失
    disappeared = sorted(set(before) - set(after) - set(old_to_new))
    summary = {
        'generatedAt': '2026-11-15',
        'beforeRows': len(before),
        'afterRows': len(after),
        'mappedRows': len(draft_map),
        'matchedSpec': sum(1 for r in draft_map if r['match'] == 'spec'),
        'matchedStrength': sum(1 for r in draft_map if r['match'] == 'strength'),
        'specChangedRows': sum(1 for r in draft_map if r['match'] == 'spec-changed'),
        'newIdRows': sum(1 for r in draft_map if r['match'] == 'new'),
        'deletedOldRows': len(deleted),
        'disappearedOldRows': len(disappeared),
        'fieldChanges': dict(field_changes),
        'sectionChanges': dict(section_changes),
        'tables': tables,
        'completeness': {
            'rowsWithDiff': len(completeness),
            'rowsWithLoss': sum(1 for c in completeness if c['lost'] > 0),
            'rowsWithGain': sum(1 for c in completeness if c['gained'] > 0),
            'totalLost': sum(c['lost'] for c in completeness),
            'totalGained': sum(c['gained'] for c in completeness),
        },
        'residualFlattenedRows': len(residuals),
        'residualFlattenedSamples': residuals[:20],
        'brandFilled': len(brand_filled),
        'approvalChangedRows': len(approval_changed),
        'specChangedSamples': spec_changed[:20],
        'newRows': new_rows,
        'disappeared': disappeared,
    }
    (args.out / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    with (args.out / 'rows.jsonl').open('w', encoding='utf-8') as fh:
        for row in rows_out:
            fh.write(json.dumps(row, ensure_ascii=False) + '\n')
    with (args.out / 'completeness.jsonl').open('w', encoding='utf-8') as fh:
        for row in completeness:
            fh.write(json.dumps(row, ensure_ascii=False) + '\n')
    with (args.out / 'residual-flattened.jsonl').open('w', encoding='utf-8') as fh:
        for row in residuals:
            fh.write(json.dumps(row, ensure_ascii=False) + '\n')
    with (args.out / 'approval-changes.jsonl').open('w', encoding='utf-8') as fh:
        for row in approval_changed:
            fh.write(json.dumps(row, ensure_ascii=False) + '\n')

    print('📊 M7 重提取差异报告')
    print(f'   行数：before {len(before)} → after {len(after)}（映射 {len(draft_map)}，新 ID {summary["newIdRows"]}，旧行消失 {len(deleted) + len(disappeared)}）')
    print(f'   匹配：规格精确 {summary["matchedSpec"]} / 数值集合 {summary["matchedStrength"]} / 规格变化 {summary["specChangedRows"]}')
    print(f'   字段变化：{summary["fieldChanges"]}')
    print(f'   段落变化：{summary["sectionChanges"]}')
    print(f'   表格：{tables["tableCount"]} 张 / 涉及行 {tables["rowsWithTables"]} / 跨页合并 {tables["mergedContinuations"]} / 回退 {tables["fallbacks"]}')
    print(f'   完整性：有差异行 {len(completeness)}（丢字 {summary["completeness"]["rowsWithLoss"]}，多字 {summary["completeness"]["rowsWithGain"]}）'
          f' 丢 {summary["completeness"]["totalLost"]} / 多 {summary["completeness"]["totalGained"]}')
    print(f'   残留拉平签名：{len(residuals)} 行')
    print(f'   商品名补齐：{len(brand_filled)} 行 / 批准文号变化：{len(approval_changed)} 行')
    print(f'   报告目录：{args.out}')
    return 0


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    raise SystemExit(main())
