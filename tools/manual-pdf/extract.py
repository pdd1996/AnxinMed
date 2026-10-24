#!/usr/bin/env python3
"""NMPA 版式说明书 PDF → AnxinMed data/manuals 草稿。

用法（在仓库根目录执行）：
  python tools/manual-pdf/extract.py "../../manuals/ω-3鱼油脂肪乳注射液[187040,186994,187403,187458].pdf" \
      --drug-id-prefix drug-omega-3-fish-oil

规则：按【段名】逐字切分，仅做空白归一化；一个 PDF 覆盖多个规格时，每个规格产出一份草稿。
依赖：PyMuPDF（import fitz）。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import fitz

EXTRACTOR_VERSION = 'manual-pdf-2026-10-24'

SECTION_RE = re.compile(r'【([^】]{1,20})】')
FILENAME_RE = re.compile(r'^(?P<name>.*?)\[(?P<ids>[^\]]+)\](?:-\d+)?$')
LABEL_RE = re.compile(r'^\s*([^：:]{1,16})\s*[：:]\s*(.+?)\s*$')
STRENGTH_RE = re.compile(r'(\d+(?:\.\d+)?)\s*(%|mg|g|μg|µg|ml|mL|毫升|毫克|微克|克)', re.I)
APPROVAL_RE = re.compile(
    r'(国药准字[A-Za-z0-9]+(?:[（(][^）)]*[）)])?|进口药品注册证号[^\s，,；;]+|H\d{8,}|[A-Z]\d{8,})'
)

FORM_SUFFIXES = [
    '注射液', '注射用', '滴眼液', '滴鼻液', '滴耳液', '口服溶液', '口服混悬液', '混悬液',
    '喷雾剂', '气雾剂', '吸入剂', '缓释胶囊', '控释胶囊', '肠溶胶囊', '缓释片', '控释片',
    '肠溶片', '分散片', '咀嚼片', '泡腾片', '含片', '舌下片', '贴膏', '乳膏', '软膏',
    '凝胶', '胶囊', '颗粒', '滴丸', '丸', '片', '栓', '糖浆', '散', '酊', '洗剂',
    '搽剂', '贴剂', '膜剂', '胶浆',
]


def clean_line(line: str) -> str:
    line = line.replace('\u00a0', ' ').replace('\u3000', ' ')
    return re.sub(r'[ \t]+', ' ', line).strip()


def normalize_section(body: str) -> str:
    body = body.replace('\r\n', '\n').replace('\r', '\n')
    body = re.sub(r'[ \t]+\n', '\n', body)
    body = re.sub(r'\n[ \t]+', '\n', body)
    body = re.sub(r'\n{2,}', '\n', body)
    body = re.sub(r'[ \t]{2,}', ' ', body)
    return body.strip()


def split_sections(text: str) -> tuple[str, dict[str, str]]:
    parts = SECTION_RE.split(text)
    preamble = normalize_section(parts[0])
    sections: dict[str, str] = {}
    for i in range(1, len(parts), 2):
        name = parts[i].strip()
        body = normalize_section(parts[i + 1])
        sections[name] = f'{sections[name]}\n{body}'.strip() if name in sections else body
    return preamble, sections


def labeled_values(block: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in block.splitlines():
        m = LABEL_RE.match(line)
        if m:
            values.setdefault(m.group(1).strip(), m.group(2).strip())
    return values


def strip_paren_suffix(name: str) -> str:
    return re.sub(r'[（(][^）)]*[）)]\s*$', '', name).strip()


def form_of(generic_name: str) -> str | None:
    base = strip_paren_suffix(generic_name)
    return next((s for s in FORM_SUFFIXES if base.endswith(s)), None)


def has_strength(text: str) -> bool:
    return bool(STRENGTH_RE.search(text))


def strength_tokens(text: str) -> set[str]:
    tokens: set[str] = set()
    for value, unit in STRENGTH_RE.findall(text):
        u = {'毫升': 'ml', '毫克': 'mg', '微克': 'ug', '克': 'g'}.get(unit, unit.lower())
        tokens.add(f'{value}{u}')
    return tokens


def parse_specs(raw: str) -> list[str]:
    raw = raw.strip()
    if not raw:
        return []
    lines = [clean_line(l) for l in raw.splitlines() if clean_line(l)]
    joined = ' '.join(lines)

    markers = list(re.finditer(r'[\(（]\s*(\d+)\s*[\)）]\s*', joined))
    if len(markers) >= 2:
        specs = []
        for i, marker in enumerate(markers):
            end = markers[i + 1].start() if i + 1 < len(markers) else len(joined)
            part = joined[marker.end():end].strip(' ；;。')
            if part:
                specs.append(part)
        return specs

    if len(lines) > 1 and all(has_strength(l) for l in lines):
        return [re.sub(r'^[\(（]?\d+[\)）]?[.、]?\s*', '', l).strip(' ；;。') for l in lines]

    parts = [p.strip(' ；;。') for p in re.split(r'[；;]', joined) if p.strip()]
    if len(parts) > 1 and all(has_strength(p) for p in parts):
        return parts
    return [joined.strip(' ；;。')]


def id_token(spec: str, index: int) -> str:
    m = STRENGTH_RE.search(spec)
    if not m:
        return f'spec{index + 1}'
    token = f'{m.group(1)}{m.group(2)}'
    token = token.replace('.', 'p').replace('%', 'pct').replace('μ', 'u').replace('µ', 'u')
    return re.sub(r'[^a-z0-9]+', '', token.lower()) or f'spec{index + 1}'


def parse_approvals(raw: str, specs: list[str]) -> tuple[dict[str, list[str]], list[str]]:
    if not raw.strip():
        return {s: [] for s in specs}, []

    groups: list[dict[str, object]] = []
    current: dict[str, object] | None = None
    for line in (clean_line(l) for l in raw.splitlines() if clean_line(l)):
        m = LABEL_RE.match(line)
        label = m.group(1).strip() if m and re.search(r'\d', m.group(1)) else None
        rest = m.group(2).strip() if m else line
        found = [re.sub(r'\s+', '', x) for x in APPROVAL_RE.findall(rest)]
        if label:
            current = {'label': label, 'approvals': []}
            groups.append(current)
        if found:
            if current is None:
                current = {'label': '', 'approvals': []}
                groups.append(current)
            current['approvals'].extend(found)  # type: ignore[union-attr]

    if not groups:
        return {s: [] for s in specs}, []

    unmapped = [
        str(group['label'])
        for group in groups
        if group['label']
        and not any(strength_tokens(str(group['label'])) & strength_tokens(spec) for spec in specs)
    ]

    result: dict[str, list[str]] = {}
    for spec in specs:
        approvals: list[str] = []
        matched = False
        for group in groups:
            label = str(group['label'])
            if not label or strength_tokens(label) & strength_tokens(spec):
                matched = True
                approvals.extend(group['approvals'])  # type: ignore[arg-type]
        if not matched:
            for group in groups:
                approvals.extend(group['approvals'])  # type: ignore[arg-type]
        seen: set[str] = set()
        ordered = [a for a in approvals if not (a in seen or seen.add(a))]
        ordered.sort(key=lambda a: 1 if '分包装' in a else 0)
        result[spec] = ordered
    return result, unmapped


def parse_manufacturer(block: str) -> tuple[str | None, str | None]:
    main = repack = None
    in_repack = False
    for line in block.splitlines():
        s = clean_line(line)
        if re.match(r'^[\[【]?分包装', s):
            in_repack = True
        m = re.match(r'^企业名称\s*[：:]\s*(.+)$', s)
        if m:
            name = m.group(1).strip()
            if in_repack and repack is None:
                repack = name
            elif main is None:
                main = name
    return main, repack


def pdf_date(doc: fitz.Document, path: Path) -> str:
    meta = doc.metadata or {}
    m = re.search(r'D:(\d{8})', meta.get('creationDate') or '')
    if m:
        d = m.group(1)
        return f'{d[:4]}-{d[4:6]}-{d[6:8]}'
    return datetime.fromtimestamp(path.stat().st_mtime).strftime('%Y-%m-%d')


def slugify(text: str) -> str:
    text = text.replace('ω', 'omega').replace('Ω', 'omega')
    text = text.lower()
    text = re.sub(r'[^a-z0-9]+', '-', text)
    return re.sub(r'-{2,}', '-', text).strip('-')


def make_version(exec_standard: str | None, date: str) -> str:
    if exec_standard:
        v = re.sub(r'[^A-Za-z0-9._-]+', '-', exec_standard).strip('-')
        if v:
            return f'nmpa-{v}'
    return f'pdf-{date}'


def first_line(block: str | None) -> str | None:
    lines = [l.strip() for l in (block or '').splitlines() if l.strip()]
    return lines[0] if lines else None


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_sections(sections: dict[str, str]) -> str:
    canonical = json.dumps(sections, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(canonical.encode('utf-8')).hexdigest()


def infer_product_type(generic_name: str, approvals: list[str], has_name_section: bool, form: str) -> str:
    if not has_name_section or form == '中药材':
        return '中药材'
    joined = ' '.join(approvals)
    if '国药准字Z' in joined or '国药准字B' in joined:
        return '中成药'
    if '国药准字S' in joined:
        return '生物制品'
    if '械' in generic_name:
        return '医疗器械'
    return '化学药'


def build_note(
    *,
    source_file: str,
    date: str,
    record_ids: list[str],
    spec: str,
    approvals: list[str],
    exec_standard: str | None,
    shelf_life: str | None,
    spec_count: int,
    unmapped: list[str],
) -> str:
    notes = [
        '【PDF 自动提取·未人工核对】',
        '按【段名】逐字切分，仅空白归一化',
        f'PDF 批次 {date}（{source_file}）',
    ]
    if record_ids:
        notes.append(f'源记录 ID {"、".join(record_ids)}')
    if spec_count > 1:
        notes.append(f'同一 PDF 覆盖 {spec_count} 个规格，本行为其中之一，正文相同')
    notes.append(f'本行规格「{spec}」')
    if approvals:
        notes.append(f'批准文号 {"、".join(approvals)}')
    if unmapped:
        notes.append(f'批准文号分组与规格未能一一对应（{ "、".join(unmapped) }），已按全部文号处理')
    if exec_standard:
        notes.append(f'执行标准 {exec_standard}')
    if shelf_life:
        notes.append(f'有效期 {shelf_life}')
    notes.append('用法用量表格为文本化（结构可能丢失）')
    notes.append('禁忌/注意事项为整段单元素数组，待人工拆分')
    return '；'.join(notes)


def extract(pdf_path: Path, out_dir: Path, id_prefix: str | None) -> list[Path]:
    doc = fitz.open(pdf_path)
    raw_text = '\n'.join(page.get_text() for page in doc)
    _, sections = split_sections(raw_text)
    date = pdf_date(doc, pdf_path)

    m = FILENAME_RE.match(pdf_path.stem)
    file_name = m.group('name').strip() if m else pdf_path.stem
    record_ids = [x.strip() for x in m.group('ids').split(',') if x.strip()] if m else []

    name_block = sections.get('药品名称', '')
    names = labeled_values(name_block)
    generic_name = names.get('通用名称') or file_name
    brand_name = names.get('商品名称')
    if brand_name in {'无', '—', '-'}:
        brand_name = None
    english_name = names.get('英文名称')
    pinyin = names.get('汉语拼音')

    form = form_of(generic_name)
    if form is None:
        form = '中药材' if not name_block else '未标注剂型'

    specs = parse_specs(sections.get('规格', ''))
    if not specs:
        specs = ['未标注规格']

    approvals, unmapped = parse_approvals(sections.get('批准文号', ''), specs)
    manufacturer, repackager = parse_manufacturer(sections.get('生产企业', ''))
    exec_standard = first_line(sections.get('执行标准'))
    shelf_life = first_line(sections.get('有效期'))
    version = make_version(exec_standard, date)
    source_file_hash = sha256_bytes(pdf_path.read_bytes())
    content_hash = sha256_sections(sections)
    product_type = infer_product_type(
        generic_name,
        [a for values in approvals.values() for a in values],
        bool(name_block),
        form,
    )

    if id_prefix:
        prefix = id_prefix
    else:
        base = slugify(pinyin or '') or slugify(english_name or '') or slugify(generic_name)
        if not base:
            raise SystemExit(f'{pdf_path.name}: 无法生成 drugId，请传 --drug-id-prefix')
        prefix = f'drug-{base}'
    if not prefix.startswith('drug-'):
        prefix = f'drug-{prefix}'
    prefix = re.sub(r'[^a-z0-9-]+', '-', prefix.lower())
    prefix = re.sub(r'-{2,}', '-', prefix).strip('-')

    out_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    used_ids: set[str] = set()
    for i, spec in enumerate(specs):
        drug_id = f'{prefix}-{id_token(spec, i)}'
        if drug_id in used_ids:
            drug_id = f'{drug_id}-{i + 1}'
        used_ids.add(drug_id)
        draft = {
            'source': 'manual-pdf',
            'sourceFile': pdf_path.name,
            'sourceRecordIds': record_ids,
            'extractedAt': datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z'),
            'pdfCreatedAt': date,
            'extractorVersion': EXTRACTOR_VERSION,
            'pageCount': doc.page_count,
            'sourceFileHash': source_file_hash,
            'contentHash': content_hash,
            'drugId': drug_id,
            'genericName': generic_name,
            'brandName': brand_name,
            'englishName': english_name,
            'pinyin': pinyin,
            'form': form,
            'productType': product_type,
            'specification': spec,
            'approvalNumbers': approvals.get(spec, []),
            'manufacturer': manufacturer,
            'repackager': repackager,
            'executionStandard': exec_standard,
            'shelfLife': shelf_life,
            'version': version,
            'sections': sections,
            'curationStatus': 'crawled',
            'curationNote': build_note(
                source_file=pdf_path.name,
                date=date,
                record_ids=record_ids,
                spec=spec,
                approvals=approvals.get(spec, []),
                exec_standard=exec_standard,
                shelf_life=shelf_life,
                spec_count=len(specs),
                unmapped=unmapped,
            ),
        }
        out_path = out_dir / f'{drug_id}.json'
        out_path.write_text(json.dumps(draft, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        written.append(out_path)
    return written


def main() -> int:
    default_out = Path(__file__).resolve().parents[2] / 'data' / 'manuals'
    parser = argparse.ArgumentParser(description='NMPA 说明书 PDF → data/manuals 草稿')
    parser.add_argument('pdfs', nargs='+', type=Path)
    parser.add_argument('--out', type=Path, default=default_out)
    parser.add_argument('--drug-id-prefix', help='单 PDF 试跑时指定 drugId 前缀，如 drug-omega-3-fish-oil')
    args = parser.parse_args()

    if args.drug_id_prefix and len(args.pdfs) > 1:
        parser.error('--drug-id-prefix 只能用于单个 PDF；批量请留空')

    failed = False
    for pdf_path in args.pdfs:
        try:
            written = extract(pdf_path, args.out, args.drug_id_prefix)
        except Exception as exc:  # 失败必须可见，不静默跳过
            failed = True
            print(f'❌ {pdf_path.name}: {exc}', file=sys.stderr)
            continue
        print(f'✅ {pdf_path.name} → {len(written)} 份草稿')
        for path in written:
            print(f'   {path}')
    return 1 if failed else 0


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    raise SystemExit(main())
