#!/usr/bin/env python3
"""MinerU 交叉复核：用 MinerU 4.x（basic 档、文本层模式）给说明书 PDF 做「表格结构第二意见」。

定位：只读工具，不写数据库、不改草稿。MinerU 产物只用来生成人工签核用的差异报告。
- 为什么是 basic 档：MinerU 在文本层 PDF 上 parse_mode=txt（不 OCR），版面/表格小模型只
  判定结构、不改写文字；standard/advanced 的 VLM 档有改写原文的风险，说明书逐字场景不用。
- 为什么是交叉复核而不是替换：MinerU 输出是整份 Markdown/MiddleJSON，不是【段名】+多规格
  契约；且表格按 bbox 识别，贴页边的表格单元格会被页面边界裁掉（PyMuPDF 文本层反而保留
  页外文字）。两者互补：MinerU 给行列/合并单元格结构，PyMuPDF 给逐字文本。

两个子命令：
  plan    选目标 PDF（默认 M7 质量扫描的 30 行残差），写 plan.jsonl + WSL/Linux 批跑脚本
  report  消费 MinerU middle_json，产出 report.json / report.md / candidates.jsonl

用法（仓库根目录）：
  python tools/manual-pdf/mineru_xcheck.py plan
  # 在 WSL/Linux 里跑（脚本含 MINERU_HOME / 模型源 / 档位，默认 basic + CPU）：
  bash data/mineru-xcheck/run-mineru.sh
  python tools/manual-pdf/mineru_xcheck.py report

依赖：report 需要 PyMuPDF（与 extract.py 一致，仅 PDF 读取）；纯函数单测不需要。
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
import unicodedata
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path

try:  # PyMuPDF 只在 report 的 PDF 分析里用；纯函数单测不需要
    import fitz
except ModuleNotFoundError:  # pragma: no cover - 缺依赖时 report 会显式报错
    fitz = None  # type: ignore[assignment]

sys.path.insert(0, str(Path(__file__).resolve().parent))
import extract as ex  # noqa: E402

TOOL_VERSION = 'mineru-xcheck-2026-11-19b'
TABLE_LINE_RE = re.compile(r'^\s*\|')
TABLE_SEP_RE = re.compile(r'^\s*\|?[\s:|-]+\|[\s:|-]*$')
FREQ_PREFIX_RE = re.compile(r'^(十分常见|常见|偶见|罕见|十分罕见|未知|不常见|非常常见)[：:、]?')
SECTION_RE = ex.SECTION_RE
EDGE_EPS = 0.99          # middle_json bbox 已归一化到 0-1，贴边阈值
CLIP_MIN_CELL_LEN = 6    # 短单元格不做裁切匹配（噪音大）
CLIP_MAX_SUFFIX = 8      # 裁切候选最多回补多少字


# ─────────────────────────────────────────────────────────────────────────────
# 纯函数：HTML 表格 → 网格
# ─────────────────────────────────────────────────────────────────────────────

class _TableHTMLParser(HTMLParser):
    """把 MinerU（以及浏览器复制粘贴）的 <table> 解析成行/单元格，保留 colspan/rowspan。"""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[list[dict]] = []
        self._row: list[dict] | None = None
        self._cell: dict | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = {k: (v or '') for k, v in attrs}
        if tag == 'tr':
            self._row = []
        elif tag in ('td', 'th'):
            self._cell = {
                'text': '',
                'colspan': _span(attr.get('colspan')),
                'rowspan': _span(attr.get('rowspan')),
            }
        elif tag == 'br' and self._cell is not None:
            self._cell['text'] += '\n'

    def handle_endtag(self, tag: str) -> None:
        if tag in ('td', 'th') and self._cell is not None:
            if self._row is None:
                self._row = []
            self._row.append(self._cell)
            self._cell = None
        elif tag == 'tr' and self._row is not None:
            self.rows.append(self._row)
            self._row = None

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell['text'] += data


def _span(raw: str) -> int:
    try:
        return max(1, int(raw))
    except (TypeError, ValueError):
        return 1


def parse_html_table(html: str) -> dict:
    """解析一张 HTML 表 → 网格。

    返回 {'nrows','ncols','cells','grid'}：
      cells: [{'text','row','col','rowspan','colspan'}]，text 用 extract.norm_cell_text 归一
      grid:  nrows × ncols，元素是 cells 下标（被合并覆盖的格子指向锚点单元格）或 None
    """
    parser = _TableHTMLParser()
    parser.feed(html or '')
    cells: list[dict] = []
    occupied: dict[tuple[int, int], int] = {}
    ncols = 0
    for r, row in enumerate(parser.rows):
        c = 0
        for raw in row:
            while (r, c) in occupied:
                c += 1
            cell = {
                'text': ex.norm_cell_text(raw['text']),
                'row': r,
                'col': c,
                'rowspan': raw['rowspan'],
                'colspan': raw['colspan'],
            }
            idx = len(cells)
            cells.append(cell)
            for rr in range(r, r + cell['rowspan']):
                for cc in range(c, c + cell['colspan']):
                    occupied[(rr, cc)] = idx
            c += cell['colspan']
            ncols = max(ncols, c)
    nrows = max((r for r, _ in occupied), default=-1) + 1
    grid = [[None] * ncols for _ in range(nrows)]
    for (rr, cc), idx in occupied.items():
        grid[rr][cc] = idx
    return {'nrows': nrows, 'ncols': ncols, 'cells': cells, 'grid': grid}


def grid_to_markdown_rows(table: dict) -> list[list[str]]:
    """网格 → 行文本；合并单元格只在锚点行写文字，被覆盖的格子留空（与现有草稿口径一致）。"""
    rows: list[list[str]] = []
    for r in range(table['nrows']):
        row: list[str] = []
        for c in range(table['ncols']):
            idx = table['grid'][r][c]
            if idx is None:
                row.append('')
                continue
            cell = table['cells'][idx]
            row.append(cell['text'] if (cell['row'] == r and cell['col'] == c) else '')
        rows.append(row)
    return rows


def table_stats(table: dict) -> dict:
    cells = table['cells']
    return {
        'rows': table['nrows'],
        'cols': table['ncols'],
        'cells': len(cells),
        'rowspanCells': sum(1 for c in cells if c['rowspan'] > 1),
        'colspanCells': sum(1 for c in cells if c['colspan'] > 1),
        'emptyCells': sum(1 for c in cells if not c['text']),
    }


def rightmost_cells(table: dict) -> list[dict]:
    """表格最右列中「真正独立」的单元格（贴页边裁切只会发生在最右列）。

    返回 [{'text','row','colspan'}]；跨列合并单元格与表头行不参与裁切匹配——它们容易
    在正文行里被误命中（例如表头的「不良反应」出现在叙述句里）。
    """
    if table['ncols'] == 0:
        return []
    out: list[dict] = []
    seen: set[int] = set()
    for r in range(table['nrows']):
        idx = table['grid'][r][table['ncols'] - 1]
        if idx is None or idx in seen:
            continue
        seen.add(idx)
        cell = table['cells'][idx]
        out.append({'text': cell['text'], 'row': cell['row'], 'colspan': cell['colspan']})
    return out


# ─────────────────────────────────────────────────────────────────────────────
# 纯函数：Markdown 表格统计 / 文本归一化
# ─────────────────────────────────────────────────────────────────────────────

def markdown_table_stats(body: str) -> dict:
    """草稿段落里的 Markdown 表格统计：表数、行数、最大列数、空单元格行数。"""
    blocks: list[list[str]] = []
    current: list[str] = []
    for line in str(body or '').split('\n'):
        if TABLE_LINE_RE.match(line):
            current.append(line)
        elif current:
            blocks.append(current)
            current = []
    if current:
        blocks.append(current)
    tables = rows = max_cols = empty_rows = empty_cells = 0
    for block in blocks:
        data_lines = [ln for ln in block if not TABLE_SEP_RE.match(ln)]
        width = max((len(_cells(ln)) for ln in data_lines), default=0)
        if len(data_lines) < 2 or width < 2:
            continue
        tables += 1
        rows += len(data_lines)
        max_cols = max(max_cols, width)
        for ln in data_lines:
            cells = _cells(ln)
            empties = sum(1 for c in cells if not c.strip())
            empty_cells += empties
            if empties:
                empty_rows += 1
    return {'tables': tables, 'rows': rows, 'maxCols': max_cols,
            'emptyCellRows': empty_rows, 'emptyCells': empty_cells}


def _cells(markdown_line: str) -> list[str]:
    return markdown_line.strip().strip('|').split('|')


def strip_markdown(text: str) -> str:
    """去掉表格分隔行、管道符与空白，只留可见字符（与 diff_drafts 的完整性口径一致）。"""
    lines = [ln for ln in str(text or '').split('\n') if not TABLE_SEP_RE.match(ln)]
    return re.sub(r'\s+', '', re.sub(r'[ \t]*\|[ \t]*', '', '\n'.join(lines)))


HTML_TAG_RE = re.compile(
    r'</?(?:table|tbody|thead|tfoot|tr|td|th|caption|colgroup|col|sup|sub|br|hr|'
    r'p|div|span|img|a|ul|ol|li|b|i|strong|em|font)\b[^>]*>',
    re.IGNORECASE,
)


def strip_html(text: str) -> str:
    """只去真正的 HTML 标签；说明书里「<1/10」「>10bpm」这类小于/大于号必须保留。"""
    return HTML_TAG_RE.sub('', text or '')


def norm_text(text: str) -> str:
    """NFKC + HTML 实体解码 + 去全部空白；用于逐字比对。"""
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', html.unescape(text or '')))


def char_coverage(draft_text: str, mineru_text: str) -> dict:
    """草稿可见字符有多大比例仍出现在 MinerU 文本里（丢失率；只允许重排不允许丢字）。

    两个细分指标用来区分「真丢字」与「草稿自身重复/标点变化」：
      lostContent        丢失的文字/数字计数（multiset 差值，草稿表格+正文重复时偏高）
      lostDistinctContent 完全没在 MinerU 段落里出现过的文字/数字种数（更接近真丢字）
    """
    a = Counter(norm_text(strip_markdown(draft_text)))
    b = Counter(norm_text(strip_html(mineru_text)))
    lost = a - b
    total = sum(a.values()) or 1
    # 丢字样本按字符去重，便于人眼判断（重复计数没有信息量）
    missing = ''.join(sorted(lost))
    lost_content = sum(n for ch, n in lost.items() if ch.isalnum())
    lost_distinct = sum(1 for ch in lost if ch.isalnum() and b.get(ch, 0) == 0)
    # 汉字与数字分开计：化学式/上下标的拉丁字母丢失通常只是 LaTeX 表示差异，不算真丢字
    lost_distinct_cjk = sum(1 for ch in lost if b.get(ch, 0) == 0 and _is_cjk(ch))
    lost_distinct_digit = sum(1 for ch in lost if b.get(ch, 0) == 0 and ch.isdigit())
    return {'chars': sum(a.values()), 'lost': sum(lost.values()),
            'lostContent': lost_content, 'lostDistinctContent': lost_distinct,
            'lostDistinctCJK': lost_distinct_cjk, 'lostDistinctDigit': lost_distinct_digit,
            'rate': round(1 - sum(lost.values()) / total, 6),
            'missingSample': missing[:40]}


def _is_cjk(ch: str) -> bool:
    return '\u3400' <= ch <= '\u4dbf' or '\u4e00' <= ch <= '\u9fff' or '\uf900' <= ch <= '\ufaff'


# ─────────────────────────────────────────────────────────────────────────────
# 纯函数：贴边表格的裁切检测
# ─────────────────────────────────────────────────────────────────────────────

def bbox_touches_edge(bbox: list[float] | None, eps: float = EDGE_EPS) -> bool:
    """归一化 bbox 是否贴页边（右/下），即源表被页面裁切的征兆。"""
    if not bbox or len(bbox) < 4:
        return False
    return bbox[2] >= eps or bbox[3] >= eps


def find_clipped_suffixes(cells: list, page_lines: list[str],
                          max_suffix: int = CLIP_MAX_SUFFIX) -> list[dict]:
    """贴边表格最右列单元格：PDF 文本层里同一行若还有后续字符，就是被页面裁掉的尾巴。

    cells 可以是字符串或 rightmost_cells() 的 dict；dict 会跳过表头行（row==0）与
    跨列合并单元格（colspan>1），避免在正文里误命中表头文字。
    返回 [{'cell','suffix'}]，suffix 是文本层里紧接 cell 的字符（建议人工确认后回补）。
    """
    out: list[dict] = []
    seen: set[str] = set()
    compact_lines = [norm_text(ln) for ln in page_lines if norm_text(ln)]
    for item in cells:
        if isinstance(item, dict):
            if item.get('row') == 0 or item.get('colspan', 1) > 1:
                continue
            raw = item.get('text', '')
        else:
            raw = item
        cell = norm_text(raw)
        if len(cell) < CLIP_MIN_CELL_LEN or cell in seen:
            continue
        for line in compact_lines:
            pos = line.find(cell)
            if pos < 0:
                continue
            tail = line[pos + len(cell): pos + len(cell) + max_suffix]
            if tail:
                seen.add(cell)
                out.append({'cell': cell, 'suffix': tail})
                break
    return out


# ─────────────────────────────────────────────────────────────────────────────
# 纯函数：MinerU MiddleJSON → 按【段名】切分
# ─────────────────────────────────────────────────────────────────────────────

def iter_chunks(node) -> list[tuple[str, str]]:
    """把 MinerU 块内容摊平成 [('text', str) | ('table', html)]，保持文档顺序。"""
    out: list[tuple[str, str]] = []
    _walk_chunks(node, out)
    return out


def _walk_chunks(node, out: list[tuple[str, str]]) -> None:
    if isinstance(node, str):
        out.append(('text', node))
    elif isinstance(node, dict):
        if node.get('type') == 'table_body' and isinstance(node.get('content'), str):
            out.append(('table', node['content']))
        else:
            _walk_chunks(node.get('content'), out)
    elif isinstance(node, list):
        for item in node:
            _walk_chunks(item, out)


def split_mineru_sections(payload: dict) -> dict[str, dict]:
    """按【段名】把 MinerU 页面重组为段落。

    {name: {'texts': [...], 'tables': [{'html','page','bbox'}, ...]}}；page 从 1 开始。
    段标题可能和正文挤在同一个文本块里（例如「…【贮藏】\\n30℃以下保存。」），所以按
    「任意位置出现的【段名】」切分，而不是只看块首。
    """
    sections: dict[str, dict] = {}
    current: dict | None = None

    def ensure(name: str) -> dict:
        nonlocal current
        if name not in sections:
            sections[name] = {'texts': [], 'tables': []}
        current = sections[name]
        return current

    for page_no, page in enumerate(payload.get('pages') or [], start=1):
        for block in page.get('blocks') or []:
            for kind, value in iter_chunks(block):
                if kind == 'table':
                    table = {'html': value, 'page': page_no, 'bbox': block.get('bbox')}
                    (current or ensure('_preamble'))['tables'].append(table)
                    continue
                for piece_kind, piece in _split_heading_pieces(value):
                    if piece_kind == 'section':
                        ensure(piece)
                    elif current is not None and piece.strip():
                        current['texts'].append(piece)
    return sections


def _split_heading_pieces(text: str) -> list[tuple[str, str]]:
    """把一段文本按【段名】切成 [('section', 段名) | ('text', 内容)]。"""
    out: list[tuple[str, str]] = []
    pos = 0
    for match in SECTION_RE.finditer(text or ''):
        if match.start() > pos:
            out.append(('text', (text or '')[pos:match.start()]))
        out.append(('section', match.group(1).strip()))
        pos = match.end()
    if pos < len(text or ''):
        out.append(('text', (text or '')[pos:]))
    return out


def section_visible_text(section: dict) -> str:
    """段落可见文本 = 文本块 + 表格单元格文字（去 HTML 标签）。"""
    parts = list(section.get('texts') or [])
    parts.extend(strip_html(table['html']) for table in section.get('tables') or [])
    return '\n'.join(parts)


def mineru_tables_stats(sections: dict[str, dict]) -> list[dict]:
    """MinerU 段落表格汇总（含所属页、bbox、是否贴边、最右列文本）。"""
    out: list[dict] = []
    for name, section in sections.items():
        for table_block in section.get('tables') or []:
            table = parse_html_table(table_block['html'])
            stats = table_stats(table)
            stats.update({
                'section': name,
                'page': table_block.get('page'),
                'bbox': table_block.get('bbox'),
                'touchesEdge': bbox_touches_edge(table_block.get('bbox')),
                'rightmostCells': rightmost_cells(table),
                'markdownRows': grid_to_markdown_rows(table),
            })
            out.append(stats)
    return out


# ─────────────────────────────────────────────────────────────────────────────
# 判定
# ─────────────────────────────────────────────────────────────────────────────

def classify_section(draft_stats: dict, mu_stats: dict, coverage: dict,
                     clipped: list[dict]) -> tuple[str, list[str]]:
    """单段判定。

    verdict：no-source-table / structure-upgraded / merged-cells-resolved /
             mineru-missed-table / mineru-extra-table / structure-same
    flags：text-gap / serious-text-gap / source-clipped / merged-cells-flattened
    """
    flags: list[str] = []
    if coverage['rate'] < 0.99:
        flags.append('text-gap')
    if coverage.get('sectionSplit'):
        # 段内缺、全文有：MinerU 阅读顺序/段边界归位问题，不是丢字
        flags.append('section-split')
    elif coverage.get('lostDistinctCJK', 0) >= 3 or coverage.get('lostDistinctDigit', 0) >= 3:
        flags.append('serious-text-gap')
    if clipped:
        flags.append('source-clipped')

    draft_tables = draft_stats.get('tables', 0)
    mu_tables = mu_stats.get('tables', 0)
    if draft_tables == 0 and mu_tables == 0:
        return 'no-source-table', flags
    if mu_tables == 0:
        return 'mineru-missed-table', flags
    if draft_tables == 0:
        return 'mineru-extra-table', flags
    if mu_stats.get('maxCols', 0) > draft_stats.get('maxCols', 0):
        return 'structure-upgraded', flags
    if mu_stats.get('rowspanCells', 0) + mu_stats.get('colspanCells', 0) > 0 \
            and draft_stats.get('emptyCellRows', 0) >= 2:
        flags.append('merged-cells-flattened')
        return 'merged-cells-resolved', flags
    return 'structure-same', flags


def aggregate_row_verdict(section_verdicts: list[str]) -> str:
    """行级判定：结构升级 > 合并格 > 结构相同 > 无源表。"""
    priority = {'structure-upgraded': 0, 'merged-cells-resolved': 1,
                'mineru-extra-table': 2, 'mineru-missed-table': 3,
                'structure-same': 4, 'no-source-table': 5}
    if not section_verdicts:
        return 'no-source-table'
    return sorted(section_verdicts, key=lambda v: priority.get(v, 9))[0]


# ─────────────────────────────────────────────────────────────────────────────
# plan：选目标 + 写批跑脚本
# ─────────────────────────────────────────────────────────────────────────────

def sanitize_slug(source_file: str) -> str:
    stem = Path(source_file).stem
    # 只替换文件名非法字符与标点；「丨」保留（药品名里的分隔符，可读性更好）
    slug = re.sub(r'[\[\]（）/:*?"<>,\\，]', '_', stem)
    slug = re.sub(r'_+', '_', slug).strip('_')
    return slug[:100] or 'unnamed'


def build_plan(drafts: dict[str, dict], scan_samples: list[dict] | None,
               drug_ids: list[str] | None, pdf_dir: Path) -> list[dict]:
    """按 drugId 选 PDF（同一 PDF 多规格合并为一条），返回 plan 行。"""
    targets: list[str] = []
    if drug_ids:
        targets.extend(drug_ids)
    if scan_samples:
        targets.extend(s['drugId'] for s in scan_samples)
    plan: list[dict] = []
    seen: dict[str, dict] = {}
    for did in targets:
        draft = drafts.get(did)
        if draft is None:
            continue
        src = draft.get('sourceFile') or ''
        pdf = pdf_dir / src
        if not pdf.exists():
            continue
        if src in seen:
            seen[src]['drugIds'].append(did)
            continue
        entry = {'slug': sanitize_slug(src), 'sourceFile': src,
                 'pdfPath': str(pdf), 'drugIds': [did],
                 'pageCount': draft.get('pageCount')}
        seen[src] = entry
        plan.append(entry)
    # slug 去重（极端情况下两个 PDF 清洗后同名）
    used: set[str] = set()
    for entry in plan:
        base, n = entry['slug'], 2
        while entry['slug'] in used:
            entry['slug'] = f'{base}_{n}'
            n += 1
        used.add(entry['slug'])
    return plan


def render_run_script(plan: list[dict], out_dir: str, mineru_home: str,
                      mineru_bin: str, workers: int = 1) -> str:
    """生成 WSL/Linux 批跑脚本（LF 换行；在 Windows 上写盘时由 write_text_lf 保证）。

    workers>1 时按轮转把 PDF 分给多个后台 worker 并行跑；单文件失败只记录到 .failed，
    不中断其他文件。MinerU 每个进程会加载一次模型，并行是「多文件小 PDF」场景的主要提速手段。
    """
    out_path = Path(out_dir)
    if not out_path.is_absolute():
        out_path = Path.cwd() / out_path
    out_wsl = str(out_path.resolve()).replace('\\', '/')
    if re.match(r'^[A-Za-z]:/', out_wsl):
        out_wsl = '/mnt/' + out_wsl[0].lower() + out_wsl[2:]
    workers = max(1, int(workers or 1))
    lines = [
        '#!/usr/bin/env bash',
        'set -uo pipefail',
        f'export MINERU_HOME={mineru_home}',
        'export MINERU_MODEL_SOURCE=${MINERU_MODEL_SOURCE:-modelscope}',
        'export MINERU_MODEL_ONNX_DEVICE=${MINERU_MODEL_ONNX_DEVICE:-cpu}',
        f'M={mineru_bin}',
        f'OUT={out_wsl}',
        'mkdir -p "$OUT"',
        'rm -f "$OUT/.failed"',
        'echo "=== mineru: $($M --version 2>&1 | head -1) ==="',
        'echo "=== models: $($M models show 2>&1 | grep -E \'^  basic:\' | head -1) ==="',
        'parse_one () {',
        '  local pdf="$1" slug="$2" log="/tmp/xc_${2}.log"',
        '  if $M parse "$pdf" -o "$OUT/$slug.middle_json" --tier basic '
        '--format middle_json --pages all >"$log" 2>&1; then',
        '    echo "  ok $slug"',
        '  else',
        '    echo "  FAILED $slug"; echo "$slug" >> "$OUT/.failed"',
        '  fi',
        '}',
    ]

    def pdf_arg(entry: dict) -> str:
        pdf = entry['pdfPath'].replace('\\', '/')
        if re.match(r'^[A-Za-z]:/', pdf):
            pdf = '/mnt/' + pdf[0].lower() + pdf[2:]
        return pdf

    for w in range(workers):
        chunk = plan[w::workers]
        lines.append(f'worker{w} () {{')
        if not chunk:
            lines.append('  true')
        for entry in chunk:
            lines.append(f'  parse_one "{pdf_arg(entry)}" "{entry["slug"]}"')
        lines.append('}')
    for w in range(workers):
        lines.append(f'worker{w} & p{w}=$!')
    lines.append('for pid in ' + ' '.join(f'$p{w}' for w in range(workers)) + '; do wait "$pid"; done')
    lines += [
        'failed=$( [ -f "$OUT/.failed" ] && wc -l < "$OUT/.failed" || echo 0 )',
        'echo "=== done: outputs=$(ls -1 "$OUT" 2>/dev/null | wc -l) failed=$failed ==="',
        '[ "$failed" -eq 0 ] || { echo "failed slugs:"; cat "$OUT/.failed"; exit 1; }',
    ]
    return '\n'.join(lines) + '\n'


def write_text_lf(path: Path, text: str) -> None:
    """显式 LF 写盘：bash 脚本在 Windows 上被转成 CRLF 会直接语法错误。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(text.replace('\r\n', '\n').encode('utf-8'))


def load_drug_ids(path: str | Path) -> list[str]:
    """drugId 清单文件：一行一个 drugId，或 JSONL（每行含 drugId 字段）。"""
    ids: list[str] = []
    for line in Path(path).read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if line.startswith('{'):
            ids.append(json.loads(line)['drugId'])
        else:
            ids.append(line)
    return ids


def load_drafts(drafts_dir: Path, only: list[str] | None = None) -> dict[str, dict]:
    wanted = set(only or [])
    out: dict[str, dict] = {}
    for path in sorted(drafts_dir.glob('*.json')):
        if wanted and path.stem not in wanted:
            continue
        out[path.stem] = json.loads(path.read_text(encoding='utf-8'))
    return out


# ─────────────────────────────────────────────────────────────────────────────
# report：PDF / MinerU / 草稿三方对照
# ─────────────────────────────────────────────────────────────────────────────

def analyze_pdf(pdf_path: Path) -> dict:
    """PyMuPDF 侧：每页 find_tables 统计 + 文本层行（供裁切回补用）。"""
    if fitz is None:  # pragma: no cover
        raise SystemExit('report 需要 PyMuPDF：pip install pymupdf')
    doc = fitz.open(str(pdf_path))
    pages: list[dict] = []
    for i, page in enumerate(doc):
        try:
            tables = page.find_tables().tables
        except Exception:
            tables = []
        table_rows = []
        for table in tables:
            try:
                rows = table.extract()
            except Exception:
                rows = []
            table_rows.append({'rows': len(rows),
                               'cols': max((len(r) for r in rows), default=0)})
        lines = [ln for ln in page.get_text('text').split('\n') if ln.strip()]
        pages.append({'page': i + 1, 'tables': table_rows, 'lines': lines})
    doc.close()
    return {
        'pages': pages,
        'pageCount': len(pages),
        'tableCount': sum(len(p['tables']) for p in pages),
        'maxCols': max((t['cols'] for p in pages for t in p['tables']), default=0),
    }


def analyze_mineru(payload: dict) -> dict:
    """MinerU MiddleJSON 侧：段名 → 文本/表格；附 parse_mode 审计。"""
    ext = (payload.get('extensions') or {}).get('mineru') or {}
    sections = split_mineru_sections(payload)
    tables = mineru_tables_stats(sections)
    return {
        'tier': ext.get('tier'), 'parseMode': ext.get('parse_mode'),
        'sections': sections, 'tables': tables,
        'tableCount': len(tables),
        'maxCols': max((t['cols'] for t in tables), default=0),
    }


def looks_like_flattened_freq_table(body: str) -> bool:
    """草稿段落是否像「被拉平的频率表」：出现 ≥3 条频率前缀行，且占比不低。

    用于区分 R2 类的「源文本来就不是表格、只是分频率叙述」——这类不需要表格结构升级。
    """
    lines = [ln.strip() for ln in str(body or '').split('\n')
             if ln.strip() and not TABLE_LINE_RE.match(ln)]
    if len(lines) < 3:
        return False
    freq = [ln for ln in lines if FREQ_PREFIX_RE.match(ln)]
    return len(freq) >= 3 and len(freq) * 4 >= len(lines)


def _resolve_mu_section(name: str, draft_body: str, mu_sections: dict[str, dict]) -> str | None:
    """段落名对齐：精确名优先；否则按文本覆盖度兜底（应对分段解析/标题被吞）。"""
    if name in mu_sections:
        return name
    if len(draft_body) < 50:
        return None
    best, best_rate = None, 0.0
    for candidate, section in mu_sections.items():
        if candidate == '_preamble':
            continue
        rate = char_coverage(draft_body, section_visible_text(section))['rate']
        if rate > best_rate:
            best, best_rate = candidate, rate
    return best if best_rate >= 0.85 else None


def build_row(entry: dict, draft: dict, pdf: dict, mu: dict) -> dict:
    """单份说明书行的对照结果 + 候选处置。"""
    sections_out: list[dict] = []
    candidates: list[dict] = []
    mu_sections = mu['sections']
    draft_sections = draft.get('sections') or {}
    doc_text = _all_text(mu)
    names = list(draft_sections)
    for name in mu_sections:
        if name not in names and name != '_preamble':
            names.append(name)

    for name in names:
        body = draft_sections.get(name, '')
        draft_stats = markdown_table_stats(body)
        resolved = _resolve_mu_section(name, body, mu_sections)
        mu_section = mu_sections.get(resolved) if resolved else None
        mu_tables = [t for t in mu['tables'] if resolved and t['section'] == resolved]
        mu_stats = {
            'tables': len(mu_tables),
            'maxCols': max((t['cols'] for t in mu_tables), default=0),
            'rowspanCells': sum(t['rowspanCells'] for t in mu_tables),
            'colspanCells': sum(t['colspanCells'] for t in mu_tables),
            'emptyCells': sum(t['emptyCells'] for t in mu_tables),
        }
        coverage = char_coverage(body, section_visible_text(mu_section or {'texts': [], 'tables': []}))
        if body.strip() and coverage['rate'] < 0.99:
            # 段内缺、全文有 → MinerU 段边界/阅读顺序归位问题，不是丢字
            doc_cov = char_coverage(body, doc_text)
            if doc_cov['lostContent'] <= 3 and doc_cov['lostDistinctContent'] <= 2:
                coverage = dict(coverage)
                coverage['sectionSplit'] = True
                coverage['docRate'] = doc_cov['rate']

        # 贴边表格 → 该页文本层最右列的裁切回补候选
        clipped: list[dict] = []
        for table in mu_tables:
            if not table['touchesEdge']:
                continue
            clipped.extend(find_clipped_suffixes(table['rightmostCells'],
                                                 _page_lines(pdf, table.get('page'))))
        clipped = _dedupe_clipped(clipped)

        verdict, flags = classify_section(draft_stats, mu_stats, coverage, clipped)
        flattened = looks_like_flattened_freq_table(body)
        if draft_stats['tables'] == 0 and mu_stats['tables'] == 0:
            if not flattened and 'serious-text-gap' not in flags and not clipped:
                continue
        action = _action_for(verdict, flags, flattened)
        sections_out.append({
            'section': name, 'verdict': verdict, 'flags': flags, 'action': action,
            'draft': draft_stats, 'mineru': mu_stats,
            'coverage': coverage, 'clipped': clipped,
            'mergedSection': resolved if resolved and resolved != name else None,
        })
        if action == 'no-action':
            continue
        candidates.append({
            'drugId': draft['drugId'], 'sourceFile': entry['sourceFile'],
            'section': name, 'action': action, 'verdict': verdict, 'flags': flags,
            'evidence': {'draft': draft_stats, 'mineru': mu_stats,
                         'coverage': coverage, 'clipped': clipped},
            'proposedMarkdownTables': [_render_mu_tables(mu_tables)] if mu_tables else [],
        })
        # 结构可升级但 MinerU 自己丢了字：再给一条「人工复核」候选，别让结构升级掩盖丢字
        if 'serious-text-gap' in flags and action not in ('manual-review', 'no-action'):
            candidates.append({
                'drugId': draft['drugId'], 'sourceFile': entry['sourceFile'],
                'section': name, 'action': 'manual-review', 'verdict': verdict,
                'flags': flags,
                'evidence': {'draft': draft_stats, 'mineru': mu_stats,
                             'coverage': coverage, 'clipped': clipped},
                'proposedMarkdownTables': [],
            })

    whole = char_coverage('\n'.join(draft_sections.values()), doc_text)
    return {
        'drugId': draft['drugId'], 'sourceFile': entry['sourceFile'],
        'pageCount': entry.get('pageCount'),
        'pymupdf': {'tables': pdf['tableCount'], 'maxCols': pdf['maxCols']},
        'mineru': {'tables': mu['tableCount'], 'maxCols': mu['maxCols'],
                   'tier': mu['tier'], 'parseMode': mu['parseMode']},
        'coverage': whole,
        'verdict': aggregate_row_verdict([s['verdict'] for s in sections_out]),
        'sections': sections_out,
        'candidates': candidates,
    }


def _action_for(verdict: str, flags: list[str], flattened: bool = False) -> str:
    if verdict == 'structure-upgraded' or verdict == 'merged-cells-resolved':
        return 'upgrade-table-structure'
    if verdict == 'mineru-extra-table':
        return 'review-extra-table'
    if verdict == 'mineru-missed-table':
        return 'manual-review'
    if verdict == 'no-source-table':
        return 'confirm-no-source-table' if flattened else 'manual-review'
    if 'serious-text-gap' in flags:
        return 'manual-review'
    if 'section-split' in flags and verdict == 'structure-same':
        return 'no-action'
    return 'no-action'


def _page_lines(pdf: dict, page_no: int | None) -> list[str]:
    for page in pdf['pages']:
        if page['page'] == page_no:
            return page['lines']
    return [line for page in pdf['pages'] for line in page['lines']]


def _all_text(mu: dict) -> str:
    return '\n'.join(section_visible_text(s) for s in mu['sections'].values())


def _dedupe_clipped(items: list[dict]) -> list[dict]:
    seen: set[tuple[str, str]] = set()
    out: list[dict] = []
    for item in items:
        key = (item['cell'], item['suffix'])
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def _render_mu_tables(mu_tables: list[dict]) -> str:
    rendered: list[str] = []
    for table in mu_tables:
        markdown, _headings = ex.render_table(table.get('markdownRows') or [])
        if markdown:
            rendered.append(markdown)
    return '\n\n'.join(rendered)


# ─────────────────────────────────────────────────────────────────────────────
# 报告输出
# ─────────────────────────────────────────────────────────────────────────────

def render_report(rows: list[dict], meta: dict) -> tuple[str, dict]:
    verdict_counter = Counter(row['verdict'] for row in rows)
    action_counter = Counter(c['action'] for row in rows for c in row['candidates'])
    flags_counter = Counter(f for row in rows for sec in row['sections'] for f in sec['flags'])
    actions = {a: sum(1 for row in rows for c in row['candidates'] if c['action'] == a)
               for a in sorted(action_counter)}
    payload = {
        'tool': TOOL_VERSION, 'generatedAt': meta.get('generatedAt'),
        'targets': len(rows),
        'verdicts': dict(verdict_counter),
        'actions': actions,
        'flags': dict(flags_counter),
        'rows': rows,
    }
    lines = [
        '# MinerU 交叉复核报告（说明书 PDF 表格结构第二意见）',
        '',
        f'- 工具：{TOOL_VERSION}；档位：basic（文本层模式，非 OCR）；目标：{len(rows)} 行说明书',
        f'- 判定分布：{dict(verdict_counter)}',
        f'- 候选处置分布：{actions}',
        f'- flags 分布（按段）：{dict(flags_counter)}',
        '',
        '## 总表',
        '',
        '| drugId | 页数 | PyMuPDF 表/列 | MinerU 表/列 | 草稿覆盖 | 判定 | 候选 |',
        '| --- | --- | --- | --- | --- | --- | --- |',
    ]
    for row in rows:
        lines.append(
            f"| {row['drugId']} | {row['pageCount']} | "
            f"{row['pymupdf']['tables']}/{row['pymupdf']['maxCols']} | "
            f"{row['mineru']['tables']}/{row['mineru']['maxCols']} | "
            f"{row['coverage']['rate']:.4f} | {row['verdict']} | {len(row['candidates'])} |"
        )
    lines += ['', '## 逐行明细', '']
    for row in rows:
        lines.append(f"### {row['drugId']}")
        lines.append('')
        lines.append(
            f"- 源 PDF：`{row['sourceFile']}`；页数 {row['pageCount']}；"
            f"MinerU {row['mineru']['tier']}/{row['mineru']['parseMode']}"
        )
        lines.append(
            f"- 表数：PyMuPDF {row['pymupdf']['tables']}（最大 {row['pymupdf']['maxCols']} 列）；"
            f"MinerU {row['mineru']['tables']}（最大 {row['mineru']['maxCols']} 列）；"
            f"整行字符覆盖 {row['coverage']['rate']:.5f}"
        )
        for sec in row['sections']:
            if sec.get('action', 'no-action') == 'no-action' and not sec['flags']:
                continue
            lines.append(
                f"  - 【{sec['section']}】{sec['verdict']} → {sec.get('action')}"
                + (f" flags={sec['flags']}" if sec['flags'] else '')
                + f"；草稿表 {sec['draft']['tables']} 张/{sec['draft']['rows']} 行，"
                f"空单元格行 {sec['draft']['emptyCellRows']}；"
                f"MinerU 表 {sec['mineru']['tables']} 张/"
                f"合并格 {sec['mineru']['rowspanCells'] + sec['mineru']['colspanCells']}"
                f"；覆盖 {sec['coverage']['rate']:.5f}"
            )
            if sec['clipped']:
                lines.append('    - 贴页边裁切回补候选：' + '；'.join(
                    f"`{c['cell']}` + `{c['suffix']}`" for c in sec['clipped'][:5]))
            if sec['coverage']['missingSample']:
                lines.append(f"    - 丢字样本：`{sec['coverage']['missingSample']}`")
        lines.append('')
    return '\n'.join(lines) + '\n', payload


# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────

def cmd_plan(args: argparse.Namespace) -> int:
    scan_samples = None
    if args.scan and not args.no_scan:
        scan = json.loads(Path(args.scan).read_text(encoding='utf-8'))
        scan_samples = scan.get('samples') or []
    drug_ids = list(args.drug_ids or [])
    if args.drug_ids_file:
        drug_ids.extend(load_drug_ids(args.drug_ids_file))
    if not scan_samples and not drug_ids:
        print('需要 --scan / --drug-ids / --drug-ids-file 至少一个', file=sys.stderr)
        return 2
    wanted = drug_ids + [s['drugId'] for s in (scan_samples or [])]
    drafts = load_drafts(Path(args.drafts), only=wanted)
    plan = build_plan(drafts, scan_samples, drug_ids, Path(args.pdf_dir))
    missing = sorted({s['drugId'] for s in (scan_samples or [])} - set(drafts))
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    plan_path = out_dir / 'plan.jsonl'
    write_text_lf(plan_path, '\n'.join(json.dumps(p, ensure_ascii=False) for p in plan) + '\n')
    script = render_run_script(plan, str(out_dir / 'raw'), args.mineru_home, args.mineru_bin,
                               args.workers)
    write_text_lf(out_dir / 'run-mineru.sh', script)
    print(json.dumps({
        'plan': str(plan_path), 'script': str(out_dir / 'run-mineru.sh'),
        'pdfs': len(plan), 'drugRows': sum(len(p['drugIds']) for p in plan),
        'pages': sum(p.get('pageCount') or 0 for p in plan),
        'workers': max(1, int(args.workers or 1)),
        'missingDrafts': missing,
    }, ensure_ascii=False, indent=2))
    return 0


def cmd_report(args: argparse.Namespace) -> int:
    plan = [json.loads(line) for line in Path(args.plan).read_text(encoding='utf-8').splitlines() if line.strip()]
    if args.limit:
        plan = plan[: args.limit]
    wanted = [did for entry in plan for did in entry['drugIds']]
    drafts = load_drafts(Path(args.drafts), only=wanted)
    rows: list[dict] = []
    failures: list[dict] = []
    for entry in plan:
        mu_path = Path(args.mineru_out) / f"{entry['slug']}.middle_json"
        if not mu_path.exists():
            failures.append({'slug': entry['slug'], 'error': 'mineru output missing', 'path': str(mu_path)})
            continue
        pdf = analyze_pdf(Path(entry['pdfPath']))
        mu = analyze_mineru(json.loads(mu_path.read_text(encoding='utf-8')))
        for did in entry['drugIds']:
            draft = drafts.get(did)
            if draft is None:
                failures.append({'slug': entry['slug'], 'drugId': did, 'error': 'draft missing'})
                continue
            rows.append(build_row(entry, draft, pdf, mu))
    import datetime
    now = datetime.datetime.now().astimezone().isoformat(timespec='seconds')
    report_md, payload = render_report(rows, {'generatedAt': now})
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    write_text_lf(out_dir / 'report.md', report_md)
    (out_dir / 'report.json').write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    candidates = [c for row in rows for c in row['candidates']]
    write_text_lf(out_dir / 'candidates.jsonl',
                  '\n'.join(json.dumps(c, ensure_ascii=False) for c in candidates) + '\n')
    print(json.dumps({
        'rows': len(rows), 'failures': failures,
        'verdicts': payload['verdicts'], 'actions': payload['actions'],
        'report': str(out_dir / 'report.md'), 'candidates': len(candidates),
    }, ensure_ascii=False, indent=2))
    return 0 if not failures else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description='MinerU 交叉复核（表格结构第二意见）')
    sub = parser.add_subparsers(dest='command', required=True)

    plan = sub.add_parser('plan', help='选目标 PDF 并生成 plan.jsonl + 批跑脚本')
    plan.add_argument('--scan', default='data/m7-reports/quality-scan.json',
                      help='M7 质量扫描结果（默认 30 行残差样本）')
    plan.add_argument('--no-scan', action='store_true', help='不用默认扫描样本，只按 --drug-ids 选')
    plan.add_argument('--drug-ids', nargs='*', default=None, help='额外/指定的 drugId 列表')
    plan.add_argument('--drug-ids-file', default=None,
                      help='drugId 清单文件（一行一个，或 JSONL 含 drugId 字段）')
    plan.add_argument('--workers', type=int, default=1, help='批跑并行 worker 数（默认 1）')
    plan.add_argument('--drafts', default='data/manuals')
    plan.add_argument('--pdf-dir', default='D:/manuals')
    plan.add_argument('--out', default='data/mineru-xcheck')
    plan.add_argument('--mineru-home', default='/mnt/d/tmp/mineru-pilot/home-wsl')
    plan.add_argument('--mineru-bin', default='~/mvenv/bin/mineru-kit')
    plan.set_defaults(func=cmd_plan)

    report = sub.add_parser('report', help='消费 middle_json 生成三方对照报告')
    report.add_argument('--plan', default='data/mineru-xcheck/plan.jsonl')
    report.add_argument('--mineru-out', default='data/mineru-xcheck/raw')
    report.add_argument('--drafts', default='data/manuals')
    report.add_argument('--out', default='data/mineru-xcheck')
    report.add_argument('--limit', type=int, default=0)
    report.set_defaults(func=cmd_report)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    raise SystemExit(main())
