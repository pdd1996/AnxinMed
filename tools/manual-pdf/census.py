#!/usr/bin/env python3
"""全量预检（census）——扫描说明书 PDF 库，产出与 AnxinMed 表结构的匹配度统计。

只读分析，不写任何文件。复用 extract.py 的解析函数，模拟批量提取的 drugId / version / 规格 /
批准文号 / 厂家推导，量化：
  1. 段名分布（哪些真实段名在 package_inserts 列映射之外）；
  2. drugId 撞车（同一 drugId 来自不同文件 / 不同厂家 → drug_master 身份歧义）；
  3. (drugId, version) 撞车（import-manuals 会走「刷新」分支互相覆盖）；
  4. 解析异常（无段名 / 无规格 / 批准文号漏提 / 版本回退 pdf-*）。

用法（仓库根目录执行）：
  python tools/manual-pdf/census.py "C:/Users/Pan/Desktop/manuals" [--limit N] [--json OUT]
"""
from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import extract as ex  # noqa: E402  同目录的解析函数


def first_line(s: str) -> str:
    """段体首行（空段体安全——extract.py 的 splitlines()[0] 在空段体上会 IndexError）。"""
    lines = [l for l in (s or '').splitlines() if l.strip()]
    return lines[0].strip() if lines else ''


def file_meta(p: Path) -> dict:
    doc = ex.fitz.open(p)
    try:
        raw_text = '\n'.join(page.get_text() for page in doc)
        date = ex.pdf_date(doc, p)
    finally:
        doc.close()
    _, sections = ex.split_sections(raw_text)

    m = ex.FILENAME_RE.match(p.stem)
    file_name = m.group('name').strip() if m else p.stem
    record_ids = [x.strip() for x in m.group('ids').split(',')] if m else []

    names = ex.labeled_values(sections.get('药品名称', ''))
    generic = names.get('通用名称') or file_name
    brand = names.get('商品名称')
    if brand in {'无', '—', '-'}:
        brand = None
    english = names.get('英文名称')
    pinyin = names.get('汉语拼音')

    form = ex.form_of(generic)
    if form is None:
        form = '中药材' if not sections.get('药品名称') else '未标注剂型'

    specs = ex.parse_specs(sections.get('规格', ''))
    if not specs:
        specs = ['未标注规格']
    approvals, unmapped = ex.parse_approvals(sections.get('批准文号', ''), specs)
    manufacturer, repackager = ex.parse_manufacturer(sections.get('生产企业', ''))
    exec_standard = first_line(sections.get('执行标准')) or None
    shelf_life = first_line(sections.get('有效期')) or None
    version = ex.make_version(exec_standard, date)

    base = ex.slugify(pinyin or '') or ex.slugify(english or '') or ex.slugify(generic)
    prefix = f'drug-{base}' if base else None

    rows = []
    used_ids: set[str] = set()
    for i, spec in enumerate(specs):
        drug_id = f'{prefix}-{ex.id_token(spec, i)}' if prefix else None
        if drug_id and drug_id in used_ids:
            drug_id = f'{drug_id}-{i + 1}'
        if drug_id:
            used_ids.add(drug_id)
        rows.append({
            'drugId': drug_id,
            'spec': spec,
            'approvals': approvals.get(spec, []),
            'version': version,
            'manufacturer': manufacturer,
            'repackager': repackager,
        })

    return {
        'file': p.name,
        'recordIds': record_ids,
        'sections': sections,
        'hasNameSection': bool(sections.get('药品名称')),
        'hasMfrSection': bool(sections.get('生产企业')),
        'generic': generic,
        'brand': brand,
        'english': english,
        'pinyin': pinyin,
        'form': form,
        'execStandard': exec_standard,
        'shelfLife': shelf_life,
        'rows': rows,
        'unmappedApprovals': unmapped,
    }


def main() -> int:
    args = sys.argv[1:]
    limit = None
    json_out = None
    pdf_dir = Path(args[0]) if args else Path('.')
    rest = args[1:] if args else []
    if '--limit' in rest:
        limit = int(rest[rest.index('--limit') + 1])
    if '--json' in rest:
        json_out = Path(rest[rest.index('--json') + 1])

    files = sorted(pdf_dir.glob('*.pdf'))
    if limit:
        files = files[:limit]

    section_counter: Counter[str] = Counter()
    anomalies: dict[str, list[str]] = defaultdict(list)
    parse_failures: list[str] = []
    # drugId → [行记录]（跨文件聚合）
    drug_rows: dict[str, list[dict]] = defaultdict(list)
    total_rows = 0
    no_prefix_files: list[str] = []

    for i, p in enumerate(files, 1):
        try:
            meta = file_meta(p)
        except Exception as exc:
            parse_failures.append(f'{p.name}: {exc}')
            continue
        if not meta['sections']:
            parse_failures.append(f'{p.name}: 未解析到【段名】')
            continue
        if i % 300 == 0:
            print(f'  … {i}/{len(files)}', file=sys.stderr)

        for s in meta['sections']:
            section_counter[s] += 1

        if not any(r['drugId'] for r in meta['rows']):
            no_prefix_files.append(p.name)
            anomalies['no-drugId'].append(p.name)
        for r in meta['rows']:
            total_rows += 1
            if r['drugId']:
                drug_rows[r['drugId']].append({
                    'file': meta['file'],
                    'spec': r['spec'],
                    'mfr': r['manufacturer'],
                    'version': r['version'],
                    'brand': meta['brand'],
                    'generic': meta['generic'],
                })
            if r['spec'] == '未标注规格':
                anomalies['no-spec'].append(p.name)
            if meta['sections'].get('批准文号') and not r['approvals']:
                anomalies['approval-miss'].append(p.name)
        if meta['unmappedApprovals']:
            anomalies['approval-unmapped'].append(p.name)
        if not meta['hasNameSection']:
            anomalies['no-name-section'].append(p.name)
        if meta['hasMfrSection'] and meta['rows'] and not meta['rows'][0]['manufacturer']:
            anomalies['mfr-miss'].append(p.name)
        if meta['rows'] and meta['rows'][0]['version'].startswith('pdf-'):
            anomalies['version-fallback'].append(p.name)
        if len(meta['rows']) > 6:
            anomalies['many-specs'].append(f'{p.name} → {len(meta["rows"])} 规格行')

    n = len(files)
    print(f'\n===== 说明书 PDF 全量预检（{n} 份，失败 {len(parse_failures)}）=====')
    print(f'模拟产出 package_inserts / drug_master 行数：{total_rows}')

    print('\n── 段名分布（段名 → 出现文件数）──')
    for name, cnt in section_counter.most_common():
        print(f'  {cnt:5d}  {name}')

    # drugId 撞车分析
    dup_same_file = 0
    cross_file: dict[str, list[dict]] = {}
    for did, rows in drug_rows.items():
        if len({r['file'] for r in rows}) > 1:
            cross_file[did] = rows
    print(f'\n── drugId 唯一性（自动拼音 slug 口径）──')
    print(f'  唯一 drugId 数：{len(drug_rows)}')
    print(f'  跨文件同 drugId：{len(cross_file)} 个')
    mfr_conflict = {d: rows for d, rows in cross_file.items() if len({r["mfr"] for r in rows}) > 1}
    print(f'  其中不同厂家同 drugId（身份歧义，drug_master 会合并错误）：{len(mfr_conflict)} 个')
    for d, rows in list(mfr_conflict.items())[:15]:
        mfrs = ' | '.join(sorted({str(r["mfr"]) for r in rows}))
        print(f'    {d}')
        print(f'      厂家：{mfrs}')
        for r in rows[:4]:
            print(f'      ← {r["file"]}（{r["generic"]}/{r["spec"]}）')

    # (drugId, version) 撞车 → import 会互相覆盖
    key_files: dict[tuple, set] = defaultdict(set)
    for did, rows in drug_rows.items():
        for r in rows:
            key_files[(did, r['version'])].add(r['file'])
    version_clash = {k: v for k, v in key_files.items() if len(v) > 1}
    print(f'\n── (drugId, version) 撞车（import-manuals 走「刷新」互相覆盖，后到者胜）──')
    print(f'  撞键数：{len(version_clash)}')
    for (did, ver), fs in list(version_clash.items())[:10]:
        print(f'    {did} @ {ver}  ← {len(fs)} 份文件')
        for f in sorted(fs)[:4]:
            print(f'      {f}')

    print('\n── 解析异常 ──')
    for k, v in anomalies.items():
        print(f'  {k}: {len(v)}')
        for f in v[:5]:
            print(f'    {f}')
    if parse_failures:
        print(f'  解析失败: {len(parse_failures)}')
        for f in parse_failures[:10]:
            print(f'    {f}')

    if json_out:
        out = {
            'files': n,
            'rows': total_rows,
            'sections': dict(section_counter),
            'uniqueDrugIds': len(drug_rows),
            'crossFileDrugIds': len(cross_file),
            'mfrConflictDrugIds': len(mfr_conflict),
            'versionClashes': len(version_clash),
            'anomalies': {k: v for k, v in anomalies.items()},
            'parseFailures': parse_failures,
            'mfrConflicts': {d: rows for d, rows in mfr_conflict.items()},
            'versionClashDetail': {f'{k[0]}@{k[1]}': sorted(v) for k, v in version_clash.items()},
        }
        json_out.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding='utf-8')
        print(f'\n详细 JSON 已写入：{json_out}')
    return 0


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    raise SystemExit(main())
