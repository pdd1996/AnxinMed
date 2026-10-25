#!/usr/bin/env python3
"""全量预检（census）——扫描说明书 PDF 库，产出与 AnxinMed 表结构的匹配度统计。

默认只读，不写数据库；只有显式传 --json / --manifest 时才写指定输出文件。复用 extract.py 的
解析函数，模拟批量提取的 drugId / version / 规格 / 批准文号 / 厂家推导，量化：
  1. 段名分布（哪些真实段名在 package_inserts 列映射之外）；
  2. drugId 撞车（同一 drugId 来自不同文件 / 不同厂家 → drug_master 身份歧义）；
  3. (drugId, version) 撞车（import-manuals 会走「刷新」分支互相覆盖）；
  4. 解析异常（无段名 / 无规格 / 批准文号漏提 / 版本回退 pdf-*）。

用法（仓库根目录执行）：
  python tools/manual-pdf/census.py "C:/Users/Pan/Desktop/manuals" [--limit N] [--json OUT]
  python tools/manual-pdf/census.py "C:/Users/Pan/Desktop/manuals" --manifest [OUT] \
      [--summary OUT] [--existing-drafts data/manuals]

--manifest 额外产出只读导入清单（默认 data/manuals-manifest.jsonl）：
  每个规格行一条，含建议 drugId、身份指纹、来源哈希、撞名/跨厂家标记、缺失字段，
  并把行分为 importable / review / herbal / parse-failed；同名多身份按批准文号/厂家后缀消歧。
  --existing-drafts 里同身份草稿的 drugId 优先复用，避免给已入库产品另起新名。
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import extract as ex  # noqa: E402  同目录的解析函数

# 与 app/packages/api/src/db/identity.ts 保持一致（已用 import-log 的真实 identityKey 校验）
CONTENT_SECTION_ALIASES = {
    '适应症/功能主治': ('适应症', '功能主治'),
    '用法用量': ('用法用量', '用法与用量'),
    '禁忌': ('禁忌',),
    '不良反应': ('不良反应',),
    '注意事项': ('注意事项',),
    '成份': ('成份', '成分'),
    '药物相互作用': ('药物相互作用',),
    '贮藏': ('贮藏', '储存'),
    '药理毒理': ('药理毒理', '药理作用'),
    '药代动力学': ('药代动力学',),
    '孕妇用药': ('孕妇和哺乳期妇女用药', '孕妇用药'),
    '儿童用药': ('儿童用药',),
    '老年用药': ('老年用药',),
    '药物过量': ('药物过量',),
}


def first_line(s: str) -> str:
    """段体首行（空段体安全——extract.py 的 splitlines()[0] 在空段体上会 IndexError）。"""
    lines = [l for l in (s or '').splitlines() if l.strip()]
    return lines[0].strip() if lines else ''


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def norm_key(value: object) -> str:
    """identity.ts normKey：去所有空白 + 小写。"""
    return re.sub(r'\s+', '', str(value or '')).lower()


CN_UNIT_MAP = {
    '千克': 'kg', '公斤': 'kg', '毫克': 'mg', '微克': 'ug', '克': 'g', '毫升': 'ml', '升': 'l',
    '毫摩尔': 'mmol', '微摩尔': 'umol', '摩尔': 'mol',
    '万单位': '万iu', '国际单位': 'iu', '单位': 'iu',
}
CN_UNIT_PATTERN = r'千克|公斤|毫克|微克|毫升|毫摩尔|微摩尔|万单位|国际单位|摩尔|克|升|单位'


def to_half_width(value: str) -> str:
    out: list[str] = []
    for ch in value:
        code = ord(ch)
        if 0xFF01 <= code <= 0xFF5E:
            out.append(chr(code - 0xFEE0))
        elif code == 0x3000:
            out.append(' ')
        elif ch in '【〔':
            out.append('(')
        elif ch in '】〕':
            out.append(')')
        else:
            out.append(ch)
    return ''.join(out)


def normalize_specification(value: object) -> str:
    """与 identity.ts normalizeSpecification 保持一致（规格单位/全角标点/尾零）。"""
    s = to_half_width(str(value or '')).lower()
    s = s.replace('μ', 'u').replace('µ', 'u').replace('mcg', 'ug')
    s = re.sub(
        r'(\d+(?:\.\d+)?)\s*(' + CN_UNIT_PATTERN + r')',
        lambda m: m.group(1) + CN_UNIT_MAP[m.group(2)],
        s,
    )
    s = re.sub(
        r'毫克|微克|毫升|千克|公斤|毫摩尔|微摩尔|万单位|国际单位',
        lambda m: CN_UNIT_MAP[m.group(0)],
        s,
    )
    # 单字单位只在斜杠后替换，避免误伤「克霉唑」「升压」等名称
    s = re.sub(
        r'/(摩尔|克|升|单位)',
        lambda m: '/' + CN_UNIT_MAP[m.group(1)],
        s,
    )
    s = re.sub(r'(\d+\.\d+)', lambda m: m.group(1).rstrip('0').rstrip('.'), s)
    s = re.sub(r'[~–—−]', '-', s)
    return re.sub(r'\s+', '', s)


def primary_approval(approvals: list[str]) -> str:
    return next((a for a in approvals if '分包装' not in a), approvals[0] if approvals else '')


def make_identity_key(
    generic: str, spec: str, form: str, manufacturer: str | None, approvals: list[str],
) -> str:
    parts = [
        norm_key(generic),
        normalize_specification(spec),
        norm_key(form),
        norm_key(manufacturer or ''),
        norm_key(primary_approval(approvals)),
    ]
    return sha256_text('|'.join(parts))


def make_generic_id(generic: str, form: str) -> str:
    return f'dg-{sha256_text("|".join(norm_key(x) for x in [generic, form]))[:16]}'


def make_source_document_id(source_file_hash: str | None, content_hash: str) -> str:
    return f'sd-{sha256_text(source_file_hash or content_hash)[:16]}'


def approval_token(approvals: list[str]) -> str:
    """批准文号 → drugId 后缀（国药准字HJ20140951 → hj20140951）。"""
    return re.sub(r'[^a-z0-9]+', '', primary_approval(approvals).lower())


def missing_content_sections(sections: dict[str, str]) -> list[str]:
    return [
        label for label, keys in CONTENT_SECTION_ALIASES.items()
        if not any(sections.get(key) for key in keys)
    ]


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def load_existing_draft_ids(manuals_dir: Path) -> dict[str, str]:
    """data/manuals 里已入库草稿的 identityKey → drugId（同身份复用原 ID）。"""
    ids: dict[str, str] = {}
    if not manuals_dir.is_dir():
        return ids
    for path in sorted(manuals_dir.glob('*.json')):
        try:
            d = json.loads(path.read_text(encoding='utf-8'))
            if d.get('source') != 'manual-pdf':
                continue
            identity_key = make_identity_key(
                d['genericName'],
                d['specification'],
                d['form'],
                d.get('manufacturer'),
                d.get('approvalNumbers') or [],
            )
            ids.setdefault(identity_key, d['drugId'])
        except Exception as exc:
            print(f'⚠️ 跳过现有草稿 {path.name}: {exc}', file=sys.stderr)
    return ids


def file_meta(p: Path) -> dict:
    source_file_hash = file_sha256(p)
    doc = ex.fitz.open(p)
    try:
        raw_text = '\n'.join(page.get_text() for page in doc)
        date = ex.pdf_date(doc, p)
        page_count = doc.page_count
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
    all_approvals = [a for values in approvals.values() for a in values]
    product_type = ex.infer_product_type(
        generic,
        all_approvals,
        bool(sections.get('药品名称')),
        form,
    )

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
        spec_approvals = approvals.get(spec, [])
        rows.append({
            'drugId': drug_id,
            'spec': spec,
            'approvals': spec_approvals,
            'version': version,
            'manufacturer': manufacturer,
            'repackager': repackager,
            'identityKey': make_identity_key(generic, spec, form, manufacturer, spec_approvals),
            'genericId': make_generic_id(generic, form),
            'primaryApproval': primary_approval(spec_approvals),
        })

    content_hash = ex.sha256_sections(sections)
    return {
        'file': p.name,
        'recordIds': record_ids,
        'pageCount': page_count,
        'pdfDate': date,
        'sourceFileHash': source_file_hash,
        'contentHash': content_hash,
        'sections': sections,
        'hasNameSection': bool(sections.get('药品名称')),
        'hasMfrSection': bool(sections.get('生产企业')),
        'generic': generic,
        'brand': brand,
        'english': english,
        'pinyin': pinyin,
        'form': form,
        'productType': product_type,
        'execStandard': exec_standard,
        'shelfLife': shelf_life,
        'rows': rows,
        'unmappedApprovals': unmapped,
        'missingSections': missing_content_sections(sections),
    }


BLOCKING_MISSING = {'规格', '批准文号', '生产企业', '剂型', '名称段', 'drugId'}


def manifest_row(meta: dict, row: dict) -> dict:
    approvals = row['approvals']
    manufacturer = row['manufacturer']
    missing: list[str] = []
    if row['spec'] == '未标注规格':
        missing.append('规格')
    if not approvals:
        missing.append('批准文号')
    if not manufacturer:
        missing.append('生产企业')
    if meta['form'] == '未标注剂型':
        missing.append('剂型')
    if not meta['execStandard']:
        missing.append('执行标准')
    if not meta['hasNameSection']:
        missing.append('名称段')
    if not row['drugId']:
        missing.append('drugId')

    # 药典饮片正文没有【药品名称】/批准文号/生产企业；有批准文号的无名 PDF 不算饮片
    herbal = (
        (not meta['hasNameSection']) and not approvals and not manufacturer
    ) or (meta['productType'] == '中药材' and not approvals)
    blocking = [m for m in missing if m in BLOCKING_MISSING]
    status = 'herbal' if herbal else ('review' if blocking else 'importable')

    warnings: list[str] = []
    if '执行标准' in missing:
        warnings.append('执行标准缺失，version 回退为 pdf-日期')
    if meta['missingSections']:
        warnings.append('内容段落缺口：' + '、'.join(meta['missingSections']))
    if meta['unmappedApprovals']:
        warnings.append('批准文号分组与规格未一一对应：' + '、'.join(meta['unmappedApprovals']))

    return {
        'sourceFile': meta['file'],
        'sourceRecordIds': meta['recordIds'],
        'pageCount': meta['pageCount'],
        'pdfCreatedAt': meta['pdfDate'],
        'genericName': meta['generic'],
        'brandName': meta['brand'],
        'englishName': meta['english'],
        'pinyin': meta['pinyin'],
        'form': meta['form'],
        'productType': meta['productType'],
        'specification': row['spec'],
        'approvalNumbers': approvals,
        'manufacturer': manufacturer,
        'repackager': row['repackager'],
        'executionStandard': meta['execStandard'],
        'shelfLife': meta['shelfLife'],
        'version': row['version'],
        'sourceFileHash': meta['sourceFileHash'],
        'contentHash': meta['contentHash'],
        'sourceDocumentId': make_source_document_id(meta['sourceFileHash'], meta['contentHash']),
        'identityKey': row['identityKey'],
        'genericId': row['genericId'],
        'baseDrugId': row['drugId'],
        'proposedDrugId': None,
        'status': status,
        'reviewReasons': [f'缺{m}' for m in blocking],
        'missingFields': missing,
        'missingSections': meta['missingSections'],
        'warnings': warnings,
        'sectionNames': sorted(meta['sections']),
        'collision': None,
        'identitySourceCount': 1,
        'sameIdentityDuplicate': False,
        'duplicateOf': None,
        'duplicateSourceHash': None,
        'duplicateContentHash': None,
    }


def parse_failed_row(p: Path, error: str, source_file_hash: str | None, meta: dict | None = None) -> dict:
    return {
        'sourceFile': p.name,
        'sourceRecordIds': meta['recordIds'] if meta else [],
        'pageCount': meta['pageCount'] if meta else None,
        'pdfCreatedAt': meta['pdfDate'] if meta else None,
        'genericName': meta['generic'] if meta else None,
        'brandName': None,
        'englishName': None,
        'pinyin': None,
        'form': None,
        'productType': None,
        'specification': None,
        'approvalNumbers': [],
        'manufacturer': None,
        'repackager': None,
        'executionStandard': None,
        'shelfLife': None,
        'version': None,
        'sourceFileHash': source_file_hash,
        'contentHash': meta['contentHash'] if meta else None,
        'sourceDocumentId': None,
        'identityKey': None,
        'genericId': None,
        'baseDrugId': None,
        'proposedDrugId': None,
        'status': 'parse-failed',
        'reviewReasons': [f'解析失败：{error}'],
        'missingFields': [],
        'missingSections': [],
        'warnings': [],
        'sectionNames': sorted(meta['sections']) if meta else [],
        'collision': None,
        'identitySourceCount': 0,
        'sameIdentityDuplicate': False,
        'duplicateOf': None,
        'duplicateSourceHash': None,
        'duplicateContentHash': None,
        'parseError': error,
    }


def build_manifest(rows: list[dict], pdf_dir: Path, existing_ids: dict[str, str] | None = None) -> dict:
    groups: dict[str, list[int]] = defaultdict(list)
    for i, r in enumerate(rows):
        if r['status'] != 'parse-failed' and r['identityKey'] and r['baseDrugId']:
            groups[r['identityKey']].append(i)

    infos: dict[str, dict] = {}
    for identity_key, idxs in groups.items():
        base_counts = Counter(rows[i]['baseDrugId'] for i in idxs)
        base = min(base_counts, key=lambda b: (-base_counts[b], b))
        source_files = sorted({rows[i]['sourceFile'] for i in idxs})
        infos[identity_key] = {
            'identityKey': identity_key,
            'rows': idxs,
            'baseDrugId': base,
            'sourceFiles': source_files,
            'manufacturers': sorted({rows[i]['manufacturer'] or '（缺）' for i in idxs}),
            'approvals': next((rows[i]['approvalNumbers'] for i in idxs if rows[i]['approvalNumbers']), []),
            'hasApproval': any(rows[i]['approvalNumbers'] for i in idxs),
            'hasMfr': any(rows[i]['manufacturer'] for i in idxs),
            'firstFile': source_files[0],
            'resolution': 'base',
        }

    by_base: dict[str, list[str]] = defaultdict(list)
    for identity_key, info in infos.items():
        by_base[info['baseDrugId']].append(identity_key)

    def rank(identity_key: str) -> tuple:
        info = infos[identity_key]
        completeness = int(info['hasApproval']) + int(info['hasMfr'])
        return (-completeness, info['firstFile'], identity_key)

    # 先给每个 base 选一个身份占住原名，再给同 base 的其它身份加后缀，
    # 避免后缀恰好又撞上另一个 base。
    assigned: dict[str, str] = {}
    used_ids: set[str] = set()
    for base, identity_keys in by_base.items():
        winner = sorted(identity_keys, key=rank)[0]
        assigned[winner] = base
        infos[winner]['resolution'] = 'base'
        used_ids.add(base)

    for base, identity_keys in by_base.items():
        for identity_key in sorted(identity_keys, key=rank)[1:]:
            info = infos[identity_key]
            suffix = approval_token(info['approvals'])
            if not suffix:
                mfr_name = next((x for x in info['manufacturers'] if x != '（缺）'), '')
                if mfr_name:
                    suffix = f'mfr-{sha256_text(norm_key(mfr_name))[:6]}'
            if not suffix:
                suffix = f'id-{identity_key[:6]}'
            candidate = f'{base}-{suffix}'
            n = 1
            while candidate in used_ids:
                n += 1
                candidate = f'{base}-{suffix}-{n}'
            assigned[identity_key] = candidate
            infos[identity_key]['resolution'] = f'suffix:{suffix}'
            used_ids.add(candidate)

    # 已入库草稿的同身份产品沿用原 drugId（例如 omega-3 的 drug-omega-3-fish-oil-*）
    resolved_existing = 0
    existing_conflicts: list[str] = []
    for identity_key, existing_id in (existing_ids or {}).items():
        if identity_key not in infos:
            continue
        current = assigned[identity_key]
        if existing_id != current and any(
            ik != identity_key and value == existing_id for ik, value in assigned.items()
        ):
            existing_conflicts.append(f'{identity_key[:8]} → {existing_id}')
            infos[identity_key]['resolution'] = 'existing-conflict'
            continue
        if existing_id != current:
            assigned[identity_key] = existing_id
            used_ids.add(existing_id)
            if not any(ik != identity_key and value == current for ik, value in assigned.items()):
                used_ids.discard(current)
        infos[identity_key]['resolution'] = 'existing'
        resolved_existing += 1

    # 同一身份跨文件复用同一个 drugId；同一 PDF 内的重复规格行必须拆开
    for identity_key, info in infos.items():
        by_file: dict[str, list[int]] = defaultdict(list)
        for i in info['rows']:
            by_file[rows[i]['sourceFile']].append(i)
        for idxs in by_file.values():
            for n, i in enumerate(idxs[1:], 2):
                dup_id = f'{assigned[identity_key]}-dup{n}'
                while dup_id in used_ids:
                    n += 1
                    dup_id = f'{assigned[identity_key]}-dup{n}'
                used_ids.add(dup_id)
                rows[i]['proposedDrugId'] = dup_id
                rows[i]['status'] = 'review'
                rows[i]['reviewReasons'].append('同一 PDF 内重复规格行')

    # 撞名/跨厂家标注
    for base, identity_keys in by_base.items():
        if len(identity_keys) < 2:
            continue
        cross_mfr = len({
            norm_key(rows[i]['manufacturer'])
            for identity_key in identity_keys
            for i in infos[identity_key]['rows']
        }) > 1
        for identity_key in identity_keys:
            info = infos[identity_key]
            for i in info['rows']:
                r = rows[i]
                if r['proposedDrugId'] is None:
                    r['proposedDrugId'] = assigned[identity_key]
                r['collision'] = {
                    'baseDrugId': base,
                    'identityCount': len(identity_keys),
                    'crossManufacturer': cross_mfr,
                    'isBaseWinner': assigned[identity_key] == base,
                    'resolvedDrugId': r['proposedDrugId'],
                }
                r['warnings'].append(
                    f'命名撞车：{base} 被 {len(identity_keys)} 个身份共用'
                    + ('（跨厂家/厂家缺失）' if cross_mfr else '')
                    + f'，本行解析为 {r["proposedDrugId"]}'
                )

    # 同身份多来源：保留一份主来源，其余行转 review（import-manuals 会拒绝重复 drugId）
    status_rank = {'importable': 0, 'review': 1, 'herbal': 2, 'parse-failed': 3}
    same_identity_groups = 0
    same_identity_duplicate_rows = 0
    for identity_key, info in infos.items():
        count = len(info['sourceFiles'])
        primary_file = None
        if count > 1:
            same_identity_groups += 1

            def file_rank(file: str) -> tuple:
                file_rows = [i for i in info['rows'] if rows[i]['sourceFile'] == file]
                best = min(file_rows, key=lambda i: (
                    status_rank.get(rows[i]['status'], 9),
                    len(rows[i]['missingSections']),
                    len(rows[i]['missingFields']),
                ))
                return (
                    status_rank.get(rows[best]['status'], 9),
                    len(rows[best]['missingSections']),
                    len(rows[best]['missingFields']),
                    file,
                )

            primary_file = min(info['sourceFiles'], key=file_rank)

        for i in info['rows']:
            r = rows[i]
            r['identitySourceCount'] = count
            if r['proposedDrugId'] is None:
                r['proposedDrugId'] = assigned[identity_key]
            if count > 1 and r['sourceFile'] != primary_file:
                r['sameIdentityDuplicate'] = True
                r['duplicateOf'] = primary_file
                r['status'] = 'review'
                r['reviewReasons'].append(f'同身份多来源，建议只入库主来源 {primary_file}')
                r['warnings'].append(f'同身份多来源：共 {count} 份 PDF，本行不是主来源')
                same_identity_duplicate_rows += 1

    # 重复文件 / 重复正文
    files_by_source_hash: dict[str, set[str]] = defaultdict(set)
    files_by_content_hash: dict[str, set[str]] = defaultdict(set)
    for r in rows:
        if r['sourceFileHash']:
            files_by_source_hash[r['sourceFileHash']].add(r['sourceFile'])
        if r['contentHash']:
            files_by_content_hash[r['contentHash']].add(r['sourceFile'])
    duplicate_source = {
        h: sorted(fs) for h, fs in files_by_source_hash.items() if len(fs) > 1
    }
    duplicate_content = {
        h: sorted(fs) for h, fs in files_by_content_hash.items() if len(fs) > 1
    }
    for r in rows:
        if r['sourceFileHash'] in duplicate_source:
            others = [f for f in duplicate_source[r['sourceFileHash']] if f != r['sourceFile']]
            r['duplicateSourceHash'] = others
            r['warnings'].append('文件哈希与其它 PDF 完全相同：' + '、'.join(others))
        if r['contentHash'] in duplicate_content:
            others = [f for f in duplicate_content[r['contentHash']] if f != r['sourceFile']]
            r['duplicateContentHash'] = others
            r['warnings'].append('正文内容哈希与其它 PDF 相同：' + '、'.join(others))

    # 唯一性校验：同一个 drugId 只能属于同一身份；同一 PDF 内不得复用
    owners: dict[str, tuple[str, str]] = {}
    for r in rows:
        drug_id = r['proposedDrugId']
        if not drug_id:
            continue
        if drug_id in owners:
            owner_identity, owner_file = owners[drug_id]
            if owner_identity != r['identityKey'] or owner_file == r['sourceFile']:
                raise RuntimeError(
                    f'manifest drugId 冲突：{drug_id} 同时用于 {owner_file} 与 {r["sourceFile"]}'
                )
        else:
            owners[drug_id] = (r['identityKey'], r['sourceFile'])

    importable_ids = [r['proposedDrugId'] for r in rows if r['status'] == 'importable']
    if len(importable_ids) != len(set(importable_ids)):
        raise RuntimeError('manifest 可直接入库行仍有重复 drugId，import-manuals 会拒绝')

    status_counts = Counter(r['status'] for r in rows)
    file_statuses: dict[str, set[str]] = defaultdict(set)
    for r in rows:
        file_statuses[r['sourceFile']].add(r['status'])
    file_status_counts: Counter[str] = Counter()
    for statuses in file_statuses.values():
        for status in ('parse-failed', 'review', 'herbal', 'importable'):
            if status in statuses:
                file_status_counts[status] += 1
                break

    parsed_rows = [r for r in rows if r['status'] != 'parse-failed']
    identities = {r['identityKey'] for r in parsed_rows if r['identityKey']}
    collision_rows = [r for r in rows if r['collision']]
    collision_bases = {r['collision']['baseDrugId'] for r in collision_rows}
    cross_rows = [r for r in collision_rows if r['collision']['crossManufacturer']]
    cross_bases = {r['collision']['baseDrugId'] for r in cross_rows}

    non_herbal_rows = [r for r in parsed_rows if r['status'] != 'herbal']
    missing_counter: Counter[str] = Counter()
    for r in non_herbal_rows:
        missing_counter.update(r['missingFields'])
    gap_counter: Counter[str] = Counter()
    for r in non_herbal_rows:
        gap_counter.update(r['missingSections'])

    core_complete_importable = sum(
        1 for r in parsed_rows
        if r['status'] == 'importable'
        and '适应症/功能主治' not in r['missingSections']
        and '用法用量' not in r['missingSections']
    )

    collision_groups = []
    for base, identity_keys in sorted(by_base.items()):
        if len(identity_keys) < 2:
            continue
        identity_details = []
        for identity_key in sorted(identity_keys, key=rank):
            info = infos[identity_key]
            first = rows[info['rows'][0]]
            identity_details.append({
                'identityKey': identity_key,
                'proposedDrugId': assigned[identity_key],
                'resolution': info['resolution'],
                'genericName': first['genericName'],
                'specification': first['specification'],
                'manufacturer': first['manufacturer'],
                'primaryApproval': primary_approval(first['approvalNumbers']),
                'sourceFiles': info['sourceFiles'],
                'rows': len(info['rows']),
            })
        collision_groups.append({
            'baseDrugId': base,
            'crossManufacturer': len({d['manufacturer'] or '（缺）' for d in identity_details}) > 1,
            'identities': identity_details,
        })

    return {
        'generatedAt': datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z'),
        'pdfDir': str(pdf_dir),
        'files': len(file_statuses),
        'rows': len(rows),
        'parsedRows': len(parsed_rows),
        'identities': len(identities),
        'status': dict(status_counts),
        'filesByStatus': dict(file_status_counts),
        'importableCoreComplete': core_complete_importable,
        'collisions': {
            'bases': len(collision_bases),
            'identities': len({r['identityKey'] for r in collision_rows}),
            'rows': len(collision_rows),
            'crossManufacturerBases': len(cross_bases),
            'crossManufacturerRows': len(cross_rows),
        },
        'sameIdentityGroups': same_identity_groups,
        'sameIdentityDuplicateRows': same_identity_duplicate_rows,
        'existingDraftIdentities': resolved_existing,
        'existingDraftConflicts': existing_conflicts,
        'duplicateSourceHashGroups': len(duplicate_source),
        'duplicateContentHashGroups': len(duplicate_content),
        'duplicateSourceFiles': sorted({f for fs in duplicate_source.values() for f in fs}),
        'duplicateContentFiles': sorted({f for fs in duplicate_content.values() for f in fs}),
        'missingFields': dict(missing_counter),
        'contentGaps': dict(gap_counter),
        'collisionGroups': collision_groups,
        'parseFailures': [r['reviewReasons'][0] for r in rows if r['status'] == 'parse-failed'],
    }


def print_manifest_summary(summary: dict, manifest_out: Path, summary_out: Path) -> None:
    status = summary['status']
    files = summary['filesByStatus']
    print('\n' + '=' * 64)
    print('说明书导入清单（manifest）')
    print(f'  JSONL：{manifest_out}')
    print(f'  汇总： {summary_out}')
    print(f"\n── 分流（{summary['rows']} 行 / {summary['parsedRows']} 行可解析 / {summary['identities']} 个身份）──")
    print(f"  可直接入库：{status.get('importable', 0):5d} 行（{files.get('importable', 0)} 份 PDF）")
    print(f"  需人工裁决：{status.get('review', 0):5d} 行（{files.get('review', 0)} 份 PDF）")
    print(f"  饮片：      {status.get('herbal', 0):5d} 行（{files.get('herbal', 0)} 份 PDF）")
    print(f"  解析失败：  {files.get('parse-failed', 0):5d} 份 PDF")
    print(f"  可入库中核心段落齐全（适应症/功能主治 + 用法用量）：{summary['importableCoreComplete']} 行")
    if summary['existingDraftIdentities']:
        print(f"  复用 data/manuals 现有身份 ID：{summary['existingDraftIdentities']} 个")
    if summary['existingDraftConflicts']:
        print(f"  ⚠️ 现有身份 ID 冲突未复用：{len(summary['existingDraftConflicts'])} 个")

    collisions = summary['collisions']
    print('\n── 命名撞车（同 base drugId 多个产品身份）──')
    print(f"  撞名：{collisions['bases']} 个 base / {collisions['identities']} 个身份 / {collisions['rows']} 行")
    print(f"  其中跨厂家/厂家缺失：{collisions['crossManufacturerBases']} 个 base / {collisions['crossManufacturerRows']} 行")
    for group in summary['collisionGroups'][:10]:
        print(f"    {group['baseDrugId']}（{len(group['identities'])} 个身份{'，跨厂家' if group['crossManufacturer'] else ''}）")
        for d in group['identities'][:4]:
            print(f"      → {d['proposedDrugId']}  {d['genericName']} / {d['specification']} / {d['manufacturer'] or '（缺厂家）'} / {d['primaryApproval'] or '（缺批号）'}")
    if len(summary['collisionGroups']) > 10:
        print(f"    … 其余 {len(summary['collisionGroups']) - 10} 组见汇总 JSON")

    print('\n── 缺失字段（非饮片可解析行）──')
    for key, cnt in sorted(summary['missingFields'].items(), key=lambda kv: -kv[1]):
        print(f"  {key}: {cnt}")

    print('\n── 内容段落缺口（非饮片可解析行）──')
    for key, cnt in sorted(summary['contentGaps'].items(), key=lambda kv: -kv[1]):
        print(f"  {key}: {cnt}")

    print('\n── 重复来源 ──')
    print(f"  同身份多来源：{summary['sameIdentityGroups']} 组，{summary['sameIdentityDuplicateRows']} 行转 review（每身份保留一份主来源）")
    print(f"  文件哈希完全相同的 PDF 组：{summary['duplicateSourceHashGroups']}")
    print(f"  正文内容哈希相同的 PDF 组：{summary['duplicateContentHashGroups']}")


def main() -> int:
    args = sys.argv[1:]
    limit = None
    json_out = None
    manifest_out = None
    summary_out = None
    pdf_dir = Path(args[0]) if args else Path('.')
    rest = args[1:] if args else []
    if '--limit' in rest:
        limit = int(rest[rest.index('--limit') + 1])
    if '--json' in rest:
        json_out = Path(rest[rest.index('--json') + 1])
    if '--manifest' in rest:
        idx = rest.index('--manifest')
        if idx + 1 < len(rest) and not rest[idx + 1].startswith('--'):
            manifest_out = Path(rest[idx + 1])
        else:
            manifest_out = Path(__file__).resolve().parents[2] / 'data' / 'manuals-manifest.jsonl'
    if '--summary' in rest:
        summary_out = Path(rest[rest.index('--summary') + 1])
    if manifest_out and summary_out is None:
        summary_out = manifest_out.with_name(manifest_out.stem + '.summary.json')
    existing_drafts_dir = Path(__file__).resolve().parents[2] / 'data' / 'manuals'
    if '--existing-drafts' in rest:
        existing_drafts_dir = Path(rest[rest.index('--existing-drafts') + 1])

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
    manifest_rows: list[dict] = []

    for i, p in enumerate(files, 1):
        try:
            meta = file_meta(p)
        except Exception as exc:
            parse_failures.append(f'{p.name}: {exc}')
            if manifest_out:
                try:
                    source_hash = file_sha256(p)
                except Exception:
                    source_hash = None
                manifest_rows.append(parse_failed_row(p, str(exc), source_hash))
            continue
        if not meta['sections']:
            parse_failures.append(f'{p.name}: 未解析到【段名】')
            if manifest_out:
                manifest_rows.append(parse_failed_row(p, '未解析到【段名】', meta['sourceFileHash'], meta))
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
        if manifest_out:
            manifest_rows.extend(manifest_row(meta, r) for r in meta['rows'])
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

    if manifest_out:
        existing_ids = load_existing_draft_ids(existing_drafts_dir)
        summary = build_manifest(manifest_rows, pdf_dir, existing_ids)
        manifest_out.parent.mkdir(parents=True, exist_ok=True)
        with manifest_out.open('w', encoding='utf-8') as fh:
            for row in manifest_rows:
                fh.write(json.dumps(row, ensure_ascii=False) + '\n')
        assert summary_out is not None
        summary_out.parent.mkdir(parents=True, exist_ok=True)
        summary_out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
        print_manifest_summary(summary, manifest_out, summary_out)
    return 0


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    raise SystemExit(main())
