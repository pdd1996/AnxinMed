#!/usr/bin/env python3
"""NMPA 版式说明书 PDF → AnxinMed data/manuals 草稿。

用法（在仓库根目录执行）：
  python tools/manual-pdf/extract.py "../../manuals/<药品名>[<源记录ID>].pdf" \
      --drug-id-prefix drug-<英文通用名 slug>

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

try:  # PyMuPDF 只在 extract() 里用；parse_specs 等纯函数单测不需要它
    import fitz
except ModuleNotFoundError:  # pragma: no cover - 缺依赖时 extract() 会显式报错
    fitz = None  # type: ignore[assignment]

EXTRACTOR_VERSION = 'manual-pdf-2026-11-15'

# ── 阅读顺序与表格重建（M7-T1，2026-11-15）──────────────────────────────────
# PDF 文本层按内容流顺序输出，表格单元格是后画的对象 → 整张表被排到页尾，跨页时
# 错落到别的段落中间（M6 §3.5：结构脂肪乳组份表落进【用法用量】、培哚普利提示框插断
# 句子、氟康唑【注意事项】混入不良反应表碎片）。修复：每页按 bbox 重建阅读顺序，
# 表格按「行 → 单元格」渲染成 Markdown 表插回 bbox 所在位置。
TABLE_TOP_MARGIN = 42.0     # 表格 bbox 顶边距页顶 ≤ 该值 → 视为页首表格，可跨页续接
TABLE_BOTTOM_MARGIN = 42.0  # 表格 bbox 底边距页底 ≤ 该值 → 视为页尾表格，可跨页续接
TABLE_COVERAGE_MIN = 0.98   # 单元格字符覆盖率下限；低于此值整张表回退为原始文本块（不丢字）
TABLE_MIN_ROWS = 2
TABLE_MIN_COLS = 2
CJK_RE = re.compile(r'[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]')
HEADING_CELL_RE = re.compile(r'^【[^】]{1,20}】$')
# 相邻两张 Markdown 表之间的段落分隔哨兵：normalize_section 见到它才保留一个空行，
# 其余位置仍折叠空行（与 M6 草稿口径一致，不给无表格段落制造空白差异）。
TABLE_BREAK = '\u0001'

SECTION_RE = re.compile(r'【([^】]{1,20})】')
FILENAME_RE = re.compile(r'^(?P<name>.*?)\[(?P<ids>[^\]]+)\](?:-\d+)?$')
LABEL_RE = re.compile(r'^\s*([^：:]{1,16})\s*[：:]\s*(.+?)\s*$')
STRENGTH_RE = re.compile(r'(\d+(?:\.\d+)?)\s*(%|mg|g|μg|µg|ml|mL|毫升|毫克|微克|克)', re.I)
# 列表编号前缀：仅剥「(1)」「1）」「1.」「1、」，不碰「50mg」「0.1g」这类规格数字
LIST_MARKER_RE = re.compile(
    r'^[\(（]\s*\d{1,2}\s*[\)）]\s*|^\d{1,2}\s*[\)）]\s*|^\d{1,2}\s*[.、](?!\d)\s*'
)
# 规格段内的列表标记（括号深度为 0 才算标记；「(16)」「(13)」这类在 [] 内的是成份分子式，不能切）
SPEC_MARKER_RE = re.compile(r'[\(（]\s*(\d{1,2})\s*[\)）]')
BRACKET_PAIRS = {'(': ')', '（': '）', '[': ']', '【': '】'}
BRACKET_CLOSERS = set(BRACKET_PAIRS.values())
# 折行判断：行尾是这些字符说明句子没写完（PDF 排版换行，不是新条目）
LINE_OPEN_TAIL = (
    '（', '(', '[', '【', '：', ':', '、', '，', ',',
    '与', '和', '及', '的', '—', '-',
)
APPROVAL_RE = re.compile(
    r'(国药准字[A-Za-z0-9]+(?:[（(][^）)]*[）)])?|进口药品注册证号[^\s，,；;]+|H\d{8,}|[A-Z]\d{8,})'
)

MANUFACTURER_LABELS = {
    '企业名称', '企业各称', '公司名称', '生产名称', '生产企业', '生产企业名称',
    '药品生产企业', '生产厂', '生产厂名称', '生产厂商', '厂商名称', '制造商名称',
    '上市许可持有人/企业名称', '受托方', '受托生产企业',
}
MAH_LABELS = {
    '上市许可持有人', '药品上市许可持有人', '委托方', '委托企业',
}
DOMESTIC_CONTACT_RE = re.compile(r'^[\[【]?(?:境内|国内)[^：:]{0,6}(?:联系|代理|机构)')
ADDRESS_LABEL_RE = re.compile(r'地址|邮编|电话|传真|网址|邮箱|联系方式')
COMPANY_SUFFIX_RE = re.compile(
    r'(?:公司|集团|总厂|药厂|制药厂|工厂|厂)$'
    r'|(?:GmbH|Ltd|Limited|Inc|LLC|L\.L\.C|S\.A|S\.p\.A|S\.R\.L|SRL|B\.V|N\.V|Co|KG|AG|SAS|PLC|Pty|LP|Corp|Corporation|A/S)$',
    re.I,
)
MANUFACTURER_VALUE_CUT_RE = re.compile(
    r'\s*(?:生产|注册|公司|企业|经营)?地址\s*[：:]'
    r'|\s*(?:邮政)?邮编\s*[：:]'
    r'|\s*电话\s*[：:]|\s*传真\s*[：:]|\s*网址\s*[：:]'
)
ADDRESS_VALUE_RE = re.compile(r'[路街]|号(?:楼|院|层)?$|Road|Street|Avenue', re.I)

FORM_SUFFIXES = [
    # 长词优先：干混悬剂 / 口服混悬液 / 口服溶液 / 注射用水 必须先于短词命中
    '干混悬剂', '口服混悬液', '混悬液', '混悬剂',
    '口服溶液', '浓溶液', '溶液',
    '粉雾剂', '喷雾剂', '气雾剂', '吸入剂',
    '缓释胶囊', '控释胶囊', '肠溶胶囊', '缓释片', '控释片', '肠溶片',
    '分散片', '咀嚼片', '泡腾片', '含片', '舌下片',
    '注射用水', '注射液',
    '滴眼液', '滴眼剂', '滴鼻液', '滴耳液', '眼膏',
    '贴膏', '乳膏', '软膏',
    '凝胶剂', '凝胶',
    '口服液', '合剂', '洗液', '洗剂',
    '乳胶剂', '滴剂', '口溶膜', '灌肠剂', '含漱液', '植入剂',
    '乳剂', '搽剂', '贴剂', '膜剂', '胶浆',
    '胶囊', '颗粒', '滴丸', '丸', '片', '栓', '糖浆', '散', '酊',
    # 传统剂型放在最后，避免抢在更具体的后缀之前
    '微球', '露', '膏药', '膏', '水', '丹', '液', '饮', '贴', '皂',
]


def clean_line(line: str) -> str:
    line = line.replace('\u00a0', ' ').replace('\u3000', ' ')
    return re.sub(r'[ \t]+', ' ', line).strip()


def normalize_section(body: str) -> str:
    """空白归一化：折叠排版空白，但两张相邻 Markdown 表之间保留一个空行。"""
    parts = body.split(TABLE_BREAK)
    cleaned: list[str] = []
    for part in parts:
        part = part.replace('\r\n', '\n').replace('\r', '\n')
        part = re.sub(r'[ \t]+\n', '\n', part)
        part = re.sub(r'\n[ \t]+', '\n', part)
        part = re.sub(r'\n{2,}', '\n', part)
        part = re.sub(r'[ \t]{2,}', ' ', part)
        cleaned.append(part.strip('\n'))
    return '\n\n'.join(part for part in cleaned if part).strip()


# ─────────────────────────────────────────────────────────────────────────────
# 表格重建（纯函数，可脱 PDF 单测）
# ─────────────────────────────────────────────────────────────────────────────

def norm_cell_text(value: str) -> str:
    """单元格文本只做空白归一化，不增删字符：换行按中文/西文规则并回一行。"""
    s = str(value or '').replace('\r\n', '\n').replace('\r', '\n')
    s = s.replace('\u00a0', ' ').replace('\u3000', ' ').replace(TABLE_BREAK, '')
    out = ''
    for line in s.split('\n'):
        line = line.strip()
        if not line:
            continue
        if not out:
            out = line
            continue
        prev, nxt = out[-1], line[0]
        if CJK_RE.match(prev) and CJK_RE.match(nxt):
            out += line                      # 中文折行：不插空格
        elif prev.isascii() and nxt.isascii() and prev.isalnum() and nxt.isalnum():
            out += ' ' + line                # 英文单词 / 数值列：保留分隔
        else:
            out += line
    return re.sub(r'[ \t]{2,}', ' ', out)


def _is_heading_row(row: list[str]) -> bool:
    """整行只有一个【段名】：find_tables 偶尔把段标题吞进表格（结构脂肪乳【不良反应】）。"""
    cells = [c.strip() for c in row if c and c.strip()]
    return len(cells) == 1 and bool(HEADING_CELL_RE.match(cells[0]))


def render_table(rows: list[list[str]]) -> tuple[str, list[str]]:
    """「行 → 单元格」渲染 Markdown 表；返回 (markdown, 被吐出的段标题)。

    口径：只恢复行列归属，不改字；空单元格保留占位；整张表少于 2 行/2 列视为误判。
    """
    cleaned = [[norm_cell_text(c) for c in row] for row in rows if row is not None]
    headings: list[str] = []
    while cleaned and _is_heading_row(cleaned[0]):
        headings.extend(c.strip() for c in cleaned.pop(0) if c and c.strip())
    while cleaned and not any(c for c in cleaned[-1]):
        cleaned.pop()
    width = max((len(r) for r in cleaned), default=0)
    if len(cleaned) < TABLE_MIN_ROWS or width < TABLE_MIN_COLS:
        return '', headings
    padded = [r + [''] * (width - len(r)) for r in cleaned]
    lines = ['| ' + ' | '.join(padded[0]) + ' |', '|' + ' --- |' * width]
    lines.extend('| ' + ' | '.join(r) + ' |' for r in padded[1:])
    return '\n'.join(lines), headings


def char_multiset(text: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for ch in text:
        if ch.isspace():
            continue
        counts[ch] = counts.get(ch, 0) + 1
    return counts


def table_coverage(raw_text: str, rows: list[list[str]]) -> float:
    """表格 bbox 内原文的非空白字符，有多大比例出现在重建单元格里（安全网）。"""
    want = char_multiset(raw_text)
    total = sum(want.values())
    if total == 0:
        return 1.0
    have = char_multiset(''.join(''.join(str(c or '') for c in row) for row in rows))
    covered = sum(min(n, have.get(ch, 0)) for ch, n in want.items())
    return covered / total


def order_items(items: list[dict]) -> list[dict]:
    """按 bbox 重建阅读顺序：先上后下、同一行内先左后右。"""
    return sorted(items, key=lambda it: (round(it['bbox'][1], 2), round(it['bbox'][0], 2)))


def block_inside_table(block_bbox: tuple[float, float, float, float],
                       table_bbox: tuple[float, float, float, float]) -> bool:
    """文本块是否属于表格：中心点在表内，或与表格重叠面积超过自身一半。"""
    bx0, by0, bx1, by1 = block_bbox
    tx0, ty0, tx1, ty1 = table_bbox
    cx, cy = (bx0 + bx1) / 2, (by0 + by1) / 2
    if tx0 <= cx <= tx1 and ty0 <= cy <= ty1:
        return True
    ix = max(0.0, min(bx1, tx1) - max(bx0, tx0))
    iy = max(0.0, min(by1, ty1) - max(by0, ty0))
    area = max((bx1 - bx0) * (by1 - by0), 1e-6)
    return ix * iy / area > 0.5


def can_merge_continuation(prev: dict, cur: dict) -> bool:
    """跨页续表：上一页表格触底、本页表格触顶、列数相同（bbox 均为 (x0,y0,x1,y1)）。"""
    if prev['kind'] != 'table' or cur['kind'] != 'table':
        return False
    prev_bbox, cur_bbox = prev['bbox'], cur['bbox']
    if prev_bbox[3] < prev['pageHeight'] - TABLE_BOTTOM_MARGIN:
        return False
    if cur_bbox[1] > TABLE_TOP_MARGIN:
        return False
    prev_cols = max((len(r) for r in prev.get('rows') or []), default=0)
    cur_cols = max((len(r) for r in cur.get('rows') or []), default=0)
    return prev_cols > 0 and prev_cols == cur_cols


def _cells_aligned(prev_cells: list, cur_cells: list) -> bool:
    """续行判定：至少一列（首列之后）的 x 区间与前一行同列对齐。"""
    for i in range(1, min(len(prev_cells), len(cur_cells))):
        a, b = prev_cells[i], cur_cells[i]
        if not a or not b:
            continue
        if abs(a[0] - b[0]) < 5 and abs(a[2] - b[2]) < 5:
            return True
    return False


def merge_table_rows(prev: dict, cur: dict) -> None:
    """把下一页续接的表格行并入 prev（原地修改）。

    跨页被截断的单元格：续页首列通常为空、正文从第 2 列起 → 按列拼回上一行；
    续页重复的表头行去重。
    """
    prev_rows: list[list[str]] = prev['rows']
    prev_cells: list[list] = prev.get('cells') or []
    cur_rows: list[list[str]] = cur['rows']
    cur_cells: list[list] = cur.get('cells') or []
    start = 0
    if cur_rows and prev_rows and cur_cells and prev_cells:
        first = cur_rows[0]
        if first and norm_cell_text(first[0]) == '' and norm_cell_text(prev_rows[-1][0]) != '':
            if _cells_aligned(prev_cells[-1], cur_cells[0]):
                for ci, cell in enumerate(first):
                    text = norm_cell_text(cell)
                    if not text or ci >= len(prev_rows[-1]):
                        continue
                    prev_rows[-1][ci] = (prev_rows[-1][ci] + text).strip()
                start = 1
    if start < len(cur_rows) and prev_rows:
        same_header = [norm_cell_text(c) for c in cur_rows[start]] == [norm_cell_text(c) for c in prev_rows[0]]
        if same_header:
            start += 1
    prev_rows.extend(cur_rows[start:])
    prev['cells'] = prev_cells + cur_cells[start:]


def assemble_pages(pages: list[list[dict]], page_heights: list[float]) -> tuple[str, dict]:
    """逐页按 bbox 顺序拼正文，处理跨页续表，最后渲染 Markdown 表。"""
    audit = {'tables': 0, 'mergedContinuations': 0, 'headingsExtracted': 0}
    flat: list[dict] = []
    for pno, items in enumerate(pages):
        height = page_heights[pno] if pno < len(page_heights) else 0.0
        for raw_item in items:
            item = dict(raw_item)
            item['page'] = pno
            item['pageHeight'] = height
            if item['kind'] == 'table':
                last = flat[-1] if flat else None
                if last is not None and last['kind'] == 'table' and last['page'] == pno - 1 \
                        and can_merge_continuation(last, item):
                    merge_table_rows(last, item)
                    audit['mergedContinuations'] += 1
                    continue
            flat.append(item)

    blocks: list[tuple[str, str]] = []
    for item in flat:
        if item['kind'] != 'table':
            blocks.append(('text', item['text']))
            continue
        audit['tables'] += 1
        markdown, headings = render_table(item['rows'])
        if headings:
            audit['headingsExtracted'] += len(headings)
            blocks.append(('text', '\n'.join(headings)))
        if markdown:
            blocks.append(('table', markdown))
    # 相邻两张表之间插哨兵 → normalize_section 保留一个空行（Markdown 表需要分隔）
    parts: list[str] = []
    prev_kind: str | None = None
    for kind, text in blocks:
        if not text:
            continue
        if kind == 'table' and prev_kind == 'table':
            parts.append(TABLE_BREAK)
        parts.append(text)
        prev_kind = kind
    return '\n'.join(parts), audit


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
    while True:
        stripped = re.sub(r'[（(][^）)]*[）)]\s*$', '', name).strip()
        stripped = re.sub(r'\[[^\]]*\]\s*$', '', stripped).strip()
        if stripped == name:
            return stripped
        name = stripped


def form_of(generic_name: str) -> str | None:
    base = strip_paren_suffix(generic_name)
    base = re.sub(r'\s*(?:复合包装|组合包装|合包装)$', '', base).strip()
    if base == '石膏':
        return None
    suffix = next((s for s in FORM_SUFFIXES if base.endswith(s)), None)
    if suffix:
        return suffix
    if '注射用' in base:
        return '注射用'
    if base.startswith('吸入用'):
        return '吸入用'
    return None


def has_strength(text: str) -> bool:
    return bool(STRENGTH_RE.search(text))


def strength_tokens(text: str) -> set[str]:
    tokens: set[str] = set()
    for value, unit in STRENGTH_RE.findall(text):
        u = {'毫升': 'ml', '毫克': 'mg', '微克': 'ug', '克': 'g'}.get(unit, unit.lower())
        tokens.add(f'{value}{u}')
    return tokens


# 规格比较用：换算到统一基准单位，0.15g ≡ 150mg、1ml ≡ 1毫升。
# （源文正文与【规格】段经常不同单位，氟康唑胶囊【规格】写 150mg、【批准文号】写 0.15g）
_STRENGTH_BASE_UNITS: dict[str, tuple[str, float]] = {
    'mg': ('mg', 1.0), '毫克': ('mg', 1.0),
    'g': ('mg', 1000.0), '克': ('mg', 1000.0),
    'μg': ('mg', 0.001), 'µg': ('mg', 0.001), 'ug': ('mg', 0.001), 'mcg': ('mg', 0.001),
    '微克': ('mg', 0.001),
    'ml': ('ml', 1.0), '毫升': ('ml', 1.0),
    'l': ('ml', 1000.0), '升': ('ml', 1000.0),
    '%': ('%', 1.0),
}


def canonical_strengths(text: str) -> set[str]:
    """把文本里的「数值+单位」换算成基准单位 token（0.15g → 150mg）。"""
    tokens: set[str] = set()
    for value, unit in STRENGTH_RE.findall(str(text or '')):
        key = unit.lower().replace('µ', 'μ')
        base = _STRENGTH_BASE_UNITS.get(key)
        if not base:
            tokens.add(f'{value}{key}')
            continue
        base_unit, factor = base
        try:
            number = float(value) * factor
        except ValueError:
            tokens.add(f'{value}{key}')
            continue
        tokens.add(f'{number:g}{base_unit}')
    return tokens


def approval_tokens(line: str) -> list[str]:
    """一行里的批准文号（去掉「进口药品注册证号：」这类标签前缀与标点）。"""
    tokens: list[str] = []
    for match in APPROVAL_RE.finditer(line):
        token = re.sub(r'\s+', '', match.group(0)).strip('：:；;,，')
        token = re.sub(r'^进口药品注册证号[：:]?', '', token)
        if not re.search(r'\d', token):
            continue
        if token not in tokens:
            tokens.append(token)
    return tokens


def split_by_strength_tokens(line: str) -> list[str]:
    """按行内「数值+单位」位置切段：一格规格 token 开一段，文号归属紧随其后的那段。

    例：`0.25μg国药准字H20000065 0.5μg国药准字H20000066`
        → ['0.25μg国药准字H20000065 ', '0.5μg国药准字H20000066']
    """
    matches = list(STRENGTH_RE.finditer(line))
    if len(matches) <= 1:
        return [line]
    segments: list[str] = []
    for i, match in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(line)
        segments.append(line[match.start():end])
    return segments


def bracket_depths(text: str) -> list[int]:
    """每个字符之前所处的括号深度。"""
    depth = 0
    depths: list[int] = []
    for ch in text:
        depths.append(depth)
        if ch in BRACKET_PAIRS:
            depth += 1
        elif ch in BRACKET_CLOSERS:
            depth = max(0, depth - 1)
    return depths


def top_level_markers(text: str) -> list[tuple[re.Match[str], int]]:
    """只取括号深度 0 的「(1)」「（1）」标记，跳过段内的「(16)」这类成份编号。"""
    depths = bracket_depths(text)
    return [(m, depths[m.start()]) for m in SPEC_MARKER_RE.finditer(text) if depths[m.start()] == 0]


def split_top_level(text: str, separators: str) -> list[str]:
    """按分隔符切分，但括号内的分隔符不切。"""
    depths = bracket_depths(text)
    parts: list[str] = []
    buf: list[str] = []
    for ch, depth in zip(text, depths):
        if ch in separators and depth == 0:
            parts.append(''.join(buf))
            buf = []
        else:
            buf.append(ch)
    parts.append(''.join(buf))
    return parts


def line_complete(line: str) -> bool:
    """判断规格段里的这一行是不是一个写完了的条目（而不是 PDF 排版折行）。"""
    s = line.strip()
    if not s:
        return False
    # 行内括号没闭合，或本行以右括号开头 → 上一行/下一行是排版折行
    depth = 0
    for ch in s:
        if ch in BRACKET_PAIRS:
            depth += 1
        elif ch in BRACKET_CLOSERS:
            depth = max(0, depth - 1)
    if depth != 0 or s[0] in BRACKET_CLOSERS:
        return False
    if s.endswith(('。', '；', ';')):
        return True
    if len(s) > 60:
        return False
    return not s.endswith(LINE_OPEN_TAIL)


UNIT_TAIL_RE = re.compile(r'(?:ml|mL|mg|g|μg|µg|IU|lU|U|kg|%)$')


def join_lines(lines: list[str]) -> str:
    """把折行拼回一行：PDF 排版换行多数不该留空格（中文、化学式、数值+单位）。"""
    out = ''
    for line in lines:
        if not out:
            out = line
            continue
        prev, nxt = out[-1], line[0]
        if _join_with_space(out, nxt):
            out += ' ' + line
        else:
            out += line
    return out


def _join_with_space(text: str, next_char: str) -> bool:
    prev = text[-1]
    if not (prev.isascii() and next_char.isascii()):
        return False
    if prev == '+' and next_char.isdigit():  # Cr3+ 0.2μmol
        return True
    if not (prev.isalnum() and next_char.isalnum()):
        return False
    if UNIT_TAIL_RE.search(text):  # 75ml / 500ml 这类单位后接数字
        return True
    if prev.isdigit() and next_char.isdigit():  # 表格列：0.52 | 1.3
        return True
    return prev.isalpha() and next_char.isalpha()  # 英文单词折行


def pick_brand_name(names: dict[str, str]) -> str | None:
    """商品名标签变体（M7-T3）：源文有「商品名称：」「商品名：」「商品名称（中文）：」等多种写法。"""
    for label in ('商品名称', '商品名'):
        if names.get(label):
            return names[label]
    for label, value in names.items():
        if value and label.startswith('商品名') and '英文' not in label and '外文' not in label:
            return value
    return None


def clean_brand_name(value: str | None) -> str | None:
    if not value:
        return None
    cleaned = value.strip().strip('：:').strip()
    if cleaned in {'', '无', '—', '-', '/', '无商品名', '无。', '未标注'}:
        return None
    return cleaned


def parse_specs(raw: str) -> list[str]:
    raw = raw.strip()
    if not raw:
        return []
    lines = [clean_line(l) for l in raw.splitlines() if clean_line(l)]
    joined = join_lines(lines)

    markers = top_level_markers(joined)
    if len(markers) >= 2:
        specs = []
        for i, (marker, _depth) in enumerate(markers):
            end = markers[i + 1][0].start() if i + 1 < len(markers) else len(joined)
            part = joined[marker.end():end].strip(' ；;。')
            if part:
                specs.append(part)
        return specs

    if len(lines) > 1:
        complete = all(line_complete(l) for l in lines)
        if complete and all(has_strength(l) for l in lines):
            return [LIST_MARKER_RE.sub('', l).strip(' ；;。') for l in lines]
        if not complete:
            # 折行段落：换行只是排版，不是新条目——整段当一个规格
            return [joined.strip(' ；;。')]

    parts = [p.strip(' ；;。') for p in split_top_level(joined, '；;') if p.strip()]
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
    """按规格归属批准文号（M7-T2）。

    源文有两种写法：
      1. 「0.25μg：国药准字H20000065」——有冒号，旧逻辑靠 LABEL_RE 分组；
      2. 「0.25μg国药准字H20000065」「①5mg；国药准字H20041506」——**无冒号**，
         旧逻辑分组失败，退化为每个规格都挂整组文号（M6 §3.6：93 份 PDF 命中）。
    新逻辑以**行内规格 token** 归属：行里出现哪个规格的数字/单位（含 0.15g≡150mg 的
    单位换算），文号就归给哪个规格；一行多组按分隔符切段各自归属；多规格 PDF 里无法
    归属的文号**留空并告警**，绝不退化为「全挂」。
    """
    if not raw.strip():
        return {s: [] for s in specs}, []

    result: dict[str, list[str]] = {s: [] for s in specs}
    warnings: list[str] = []
    spec_tokens = [(spec, canonical_strengths(spec)) for spec in specs]

    def assign(spec: str, tokens: list[str]) -> None:
        for token in tokens:
            if token not in result[spec]:
                result[spec].append(token)

    def match_specs(text: str) -> list[str]:
        tokens = canonical_strengths(text)
        if not tokens:
            return []
        return [spec for spec, spec_set in spec_tokens if spec_set & tokens]

    pending: list[str] = []  # 已定位到规格、但文号在下一行的行（「0.25μg：」换行）
    for raw_line in raw.splitlines():
        line = clean_line(raw_line)
        if not line:
            continue
        tokens = approval_tokens(line)
        matched = match_specs(line)
        if len(matched) == 1:
            if tokens:
                assign(matched[0], tokens)
                pending = []
            else:
                pending = matched
            continue
        if len(matched) > 1:
            assigned = False
            for segment in split_by_strength_tokens(line):
                segment_tokens = approval_tokens(segment)
                segment_matched = match_specs(segment)
                if len(segment_matched) == 1 and segment_tokens:
                    assign(segment_matched[0], segment_tokens)
                    assigned = True
            if not assigned and tokens:
                # 一行覆盖多规格（伏立康唑「1）50mg 2）200mg」）：文号由两规格共享
                for spec in matched:
                    assign(spec, tokens)
            pending = []
            continue
        if not tokens:
            continue
        if pending:
            for spec in pending:
                assign(spec, tokens)
            pending = []
        elif len(specs) == 1:
            assign(specs[0], tokens)
        else:
            warnings.append(f"未归属文号 {'、'.join(tokens)}（行：{line[:40]}）")

    for spec in specs:
        result[spec].sort(key=lambda a: 1 if '分包装' in a else 0)
    return result, warnings


def company_like(value: str) -> bool:
    cleaned = re.sub(r'[\s.,;；。]+$', '', value.strip())
    return bool(COMPANY_SUFFIX_RE.search(cleaned))


def split_label(line: str) -> tuple[str | None, str]:
    m = LABEL_RE.match(line)
    if not m:
        return None, line
    return m.group(1).strip(), m.group(2).strip()


def parse_manufacturer(block: str) -> tuple[str | None, str | None]:
    main = repack = None
    main_priority = repack_priority = 99
    in_repack = False
    in_domestic = False
    pending_label: str | None = None

    for line in block.splitlines():
        s = clean_line(line)
        if not s:
            continue
        if re.match(r'^[\[【]?\s*分包装\s*[\]】]?\s*$', s):
            in_repack = True
            in_domestic = False
            continue
        if re.match(r'^[\[【]?分包装', s):
            in_repack = True
            in_domestic = False
            s = re.sub(r'^[\[【]?分包装[\]】]?\s*', '', s)
            if not s:
                continue
        if re.match(r'^[\[【]?(?:进口)?分装', s) or (
            s.startswith(('[', '【')) and '分包装' in s
        ):
            in_repack = True
            in_domestic = False
            continue
        if DOMESTIC_CONTACT_RE.match(s):
            in_domestic = True
            continue
        if in_domestic:
            continue

        label, value = split_label(s)
        if label is None and re.fullmatch(r'[^：:]{1,16}\s*[：:]', s):
            pending_label = re.sub(r'\s*[：:]$', '', s).strip()
            continue
        if label is None and pending_label:
            label, value = pending_label, s
        pending_label = None
        value = MANUFACTURER_VALUE_CUT_RE.split(value, maxsplit=1)[0].strip(' ；;，,')
        if not value:
            continue
        if ADDRESS_VALUE_RE.search(value) and not company_like(value):
            continue

        if label:
            normalized = label.replace(' ', '').replace('\u3000', '')
            if ADDRESS_LABEL_RE.search(normalized):
                # 个别 PDF 把公司名称误标成「公司地址」；真地址不会以公司/厂后缀结尾
                if normalized != '公司地址' or not company_like(value):
                    continue
                priority = 3
            elif normalized in MANUFACTURER_LABELS:
                priority = 0
            elif normalized == '名称':
                priority = 1
            elif normalized in MAH_LABELS:
                priority = 2
            elif company_like(value):
                priority = 3
            else:
                continue
        else:
            if not company_like(value):
                continue
            priority = 1

        if in_repack:
            if priority < repack_priority:
                repack = value
                repack_priority = priority
        elif priority < main_priority:
            main = value
            main_priority = priority
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
    name_note: str | None = None,
) -> str:
    notes = [
        '【PDF 自动提取·未人工核对】',
        '按【段名】逐字切分，仅空白归一化',
        f'PDF 批次 {date}（{source_file}）',
    ]
    if name_note:
        notes.append(name_note)
    if record_ids:
        notes.append(f'源记录 ID {"、".join(record_ids)}')
    if spec_count > 1:
        notes.append(f'同一 PDF 覆盖 {spec_count} 个规格，本行为其中之一，正文相同')
    notes.append(f'本行规格「{spec}」')
    if approvals:
        notes.append(f'批准文号 {"、".join(approvals)}')
    if unmapped:
        notes.append(f'批准文号无法归属到具体规格（{ "、".join(unmapped) }），已留空待人工补')
    if exec_standard:
        notes.append(f'执行标准 {exec_standard}')
    if shelf_life:
        notes.append(f'有效期 {shelf_life}')
    notes.append('用法用量表格为文本化（结构可能丢失）')
    notes.append('禁忌/注意事项为整段单元素数组，待人工拆分')
    return '；'.join(notes)


def _table_cell_boxes(tab) -> list[list]:
    boxes: list[list] = []
    for row in tab.rows:
        cells = []
        for cell in row.cells:
            cells.append(None if cell is None else tuple(cell))
        boxes.append(cells)
    return boxes


def page_items(page) -> tuple[list[dict], list[dict]]:
    """一页的阅读项：表格 + 文本块，已按 bbox 排序；表格 bbox 内的文本块丢弃。"""
    items: list[dict] = []
    fallbacks: list[dict] = []
    table_boxes: list[tuple[float, float, float, float]] = []
    tables = []
    try:
        tables = list(page.find_tables().tables)
    except Exception as exc:  # find_tables 在个别畸形页面上会抛错——失败必须可见
        fallbacks.append({'page': page.number + 1, 'reason': f'find_tables 失败：{exc}'})
    for tab in tables:
        bbox = tuple(tab.bbox)
        rows = [list(r) for r in tab.extract()]
        cols = max((len(r) for r in rows), default=0)
        if len(rows) < TABLE_MIN_ROWS or cols < TABLE_MIN_COLS:
            continue  # 误判：单行/单列不足以构成表格
        raw = page.get_text('text', clip=fitz.Rect(bbox))
        coverage = table_coverage(raw, rows)
        if coverage < TABLE_COVERAGE_MIN:
            # 找不到的单元格会丢字 → 整张表回退为原始文本块（宁可保留拉平文本）
            fallbacks.append({'page': page.number + 1, 'bbox': [round(v, 1) for v in bbox],
                              'coverage': round(coverage, 4), 'reason': '单元格覆盖率不足'})
            continue
        table_boxes.append(bbox)
        items.append({'kind': 'table', 'bbox': bbox, 'rows': rows,
                      'cells': _table_cell_boxes(tab), 'coverage': coverage})
    for block in page.get_text('dict')['blocks']:
        if block.get('type') != 0:
            continue
        # 逐行保留换行：规格/批准文号段依赖行结构（一行一条），不能把行首尾拼死
        text = '\n'.join(''.join(span['text'] for span in line['spans']) for line in block['lines'])
        if not text.strip():
            continue
        bbox = tuple(block['bbox'])
        if any(block_inside_table(bbox, tb) for tb in table_boxes):
            continue
        items.append({'kind': 'text', 'bbox': bbox, 'text': text})
    return order_items(items), fallbacks


def document_text(doc) -> tuple[str, dict]:
    """整份 PDF 的正文：逐页 bbox 排序 + 表格 Markdown 重建 + 跨页续表合并。"""
    pages: list[list[dict]] = []
    heights: list[float] = []
    fallbacks: list[dict] = []
    for page in doc:
        items, page_fallbacks = page_items(page)
        pages.append(items)
        heights.append(page.rect.height)
        fallbacks.extend(page_fallbacks)
    text, audit = assemble_pages(pages, heights)
    audit['fallbacks'] = fallbacks
    return text, audit


def audit_pdf(pdf_path: Path) -> dict:
    """诊断入口（--audit）：逐页打印表格、回退与阅读项，供抽检定位。"""
    doc = fitz.open(pdf_path)
    report = {'file': pdf_path.name, 'pages': []}
    for page in doc:
        items, fallbacks = page_items(page)
        page_report = {
            'page': page.number + 1,
            'fallbacks': fallbacks,
            'items': [
                {'kind': it['kind'], 'bbox': [round(v, 1) for v in it['bbox']],
                 'rows': len(it.get('rows') or []), 'cols': max((len(r) for r in it.get('rows') or []), default=0),
                 'coverage': round(it.get('coverage', 1.0), 4) if it['kind'] == 'table' else None,
                 'preview': (render_table(it['rows'])[0] if it['kind'] == 'table' else it['text'])[:120].replace('\n', ' ⏎ ')}
                for it in items
            ],
        }
        report['pages'].append(page_report)
    return report


def extract(pdf_path: Path, out_dir: Path, id_prefix: str | None, audit: dict | None = None) -> list[Path]:
    if fitz is None:
        raise RuntimeError('缺少 PyMuPDF：pip install pymupdf（只有 extract() 需要，纯解析函数不受影响）')
    doc = fitz.open(pdf_path)
    raw_text, doc_audit = document_text(doc)
    if audit is not None:
        audit.clear()
        audit.update(doc_audit)
    _, sections = split_sections(raw_text)
    date = pdf_date(doc, pdf_path)

    m = FILENAME_RE.match(pdf_path.stem)
    file_name = m.group('name').strip() if m else pdf_path.stem
    record_ids = [x.strip() for x in m.group('ids').split(',') if x.strip()] if m else []

    name_block = sections.get('药品名称', '')
    names = labeled_values(name_block)
    generic_name_raw = names.get('通用名称') or file_name
    generic_name = re.sub(r'^[\s:：]+', '', generic_name_raw)
    name_note = None
    if generic_name != generic_name_raw:
        name_note = f'源文「通用名称」标签后重复冒号（{generic_name_raw[:4]}…），身份字段已剔除前导冒号，正文段保持原样'
    brand_name = clean_brand_name(pick_brand_name(names))
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
                name_note=name_note,
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
    parser.add_argument('--audit', action='store_true',
                        help='诊断模式：逐页打印表格识别、回退原因与阅读项（不写草稿）')
    args = parser.parse_args()

    if args.drug_id_prefix and len(args.pdfs) > 1:
        parser.error('--drug-id-prefix 只能用于单个 PDF；批量请留空')

    if args.audit:
        for pdf_path in args.pdfs:
            report = audit_pdf(pdf_path)
            print(f"📄 {report['file']}")
            for page in report['pages']:
                print(f"  ── 第 {page['page']} 页：{len(page['items'])} 个阅读项")
                for fb in page['fallbacks']:
                    print(f"     ⚠️ 表格回退：{fb.get('reason')} bbox={fb.get('bbox')} 覆盖率={fb.get('coverage')}")
                for it in page['items']:
                    extra = f" rows={it['rows']} cols={it['cols']} cov={it['coverage']}" if it['kind'] == 'table' else ''
                    print(f"     [{it['kind']}{extra}] y={it['bbox'][1]:.0f} :: {it['preview']}")
        return 0

    failed = False
    for pdf_path in args.pdfs:
        audit: dict = {}
        try:
            written = extract(pdf_path, args.out, args.drug_id_prefix, audit=audit)
        except Exception as exc:  # 失败必须可见，不静默跳过
            failed = True
            print(f'❌ {pdf_path.name}: {exc}', file=sys.stderr)
            continue
        fb = len(audit.get('fallbacks') or [])
        print(f"✅ {pdf_path.name} → {len(written)} 份草稿"
              f"（表格 {audit.get('tables', 0)} 张 / 跨页合并 {audit.get('mergedContinuations', 0)}"
              f" / 回退 {fb}）")
        for path in written:
            print(f'   {path}')
    return 1 if failed else 0


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    raise SystemExit(main())
