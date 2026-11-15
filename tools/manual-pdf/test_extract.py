#!/usr/bin/env python3
"""extract.py 纯解析函数单测（不需要 PyMuPDF、不需要 PDF 文件）。

跑法（仓库根目录）：
  python tools/manual-pdf/test_extract.py
  python -m unittest discover -s tools/manual-pdf -p 'test_*.py'

覆盖 2026-11-14 三处修复，每处都钉一个真实 PDF 的失败样本：
  1. 列表编号剥离不能吃掉规格前导数字（0.75mg→75mg / 3ml→ml / 1g←0.1g）；
  2. 「1）」这类裸编号要剥（氟康唑氯化钠注射液）；
  3. 括号内的「；」和「(16)」不是列表分隔（乳果糖口服溶液 / 结构脂肪乳）；
  4. PDF 排版折行不是新条目（钆特酸葡胺 / 氟替美维 / 人促红素 / 脂溶性维生素）。
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import extract  # noqa: E402


class TestParseSpecs(unittest.TestCase):
    def assert_specs(self, raw: str, expected: list[str]) -> None:
        self.assertEqual(extract.parse_specs(raw), expected)

    # ---- 1. 编号剥离不能吃规格数字 ----
    def test_leading_zero_kept(self):
        self.assert_specs('0.75mg：0.5ml（预填充注射笔）\n1.5mg：0.5ml（预填充注射笔）',
                          ['0.75mg：0.5ml（预填充注射笔）', '1.5mg：0.5ml（预填充注射笔）'])

    def test_leading_zero_kept_numbered(self):
        self.assert_specs('(1)0.3ml:2850AXaIU(2)0.4ml:3800AXaIU(3)0.6ml:5700AXaIU',
                          ['0.3ml:2850AXaIU', '0.4ml:3800AXaIU', '0.6ml:5700AXaIU'])

    def test_two_plain_strength_lines(self):
        self.assert_specs('50mg\n0.1g', ['50mg', '0.1g'])

    def test_dot_numbering_still_stripped(self):
        self.assert_specs('1. 0.5g\n2. 0.25g', ['0.5g', '0.25g'])

    # ---- 2. 裸「1）」编号 ----
    def test_bare_paren_marker(self):
        raw = ('1）50ml：氟康唑0.1g与氯化钠0.45g\n'
               '2）100ml：氟康唑0.2g与氯化钠0.9g\n'
               '3）200ml：氟康唑04g与氯化钠1.8g')
        self.assert_specs(raw, [
            '50ml：氟康唑0.1g与氯化钠0.45g',
            '100ml：氟康唑0.2g与氯化钠0.9g',
            '200ml：氟康唑04g与氯化钠1.8g',
        ])

    # ---- 3. 括号内的分隔符不切 ----
    def test_semicolon_inside_brackets(self):
        self.assert_specs('667mg/ml（5ml：3.3g；15ml：10g；100ml：66.7g；200ml：133.4g）',
                          ['667mg/ml（5ml：3.3g；15ml：10g；100ml：66.7g；200ml：133.4g）'])

    def test_marker_inside_brackets_ignored(self):
        raw = ('(1)1206ml[结构脂肪乳(20%)注射液170ml；复方氨基酸(16)注射液380ml；葡萄糖(13%)注射液656ml)]\n'
               '(2)1904ml[结构脂肪乳(20%)注射液268ml；复方氨基酸(16)注射液600ml；葡萄糖(13%)注射液1036ml)]')
        self.assert_specs(raw, [
            '1206ml[结构脂肪乳(20%)注射液170ml；复方氨基酸(16)注射液380ml；葡萄糖(13%)注射液656ml)]',
            '1904ml[结构脂肪乳(20%)注射液268ml；复方氨基酸(16)注射液600ml；葡萄糖(13%)注射液1036ml)]',
        ])

    # ---- 4. 折行段落不当条目 ----
    def test_wrapped_paragraph_not_split(self):
        raw = ('每泡含糠酸氟替卡松100μg、乌美溴铵62.5μg（按C29H34NO2计）与三苯乙酸维兰特罗25μg（按C\n'
               '24H33Cl2NO5计），递送剂量为糠酸氟替卡松92μg、乌美溴铵55μg（按C29H34NO2计）与三苯乙\n'
               '酸维兰特罗22μg（按C24H33Cl2NO5计）。')
        self.assert_specs(raw, [
            '每泡含糠酸氟替卡松100μg、乌美溴铵62.5μg（按C29H34NO2计）与三苯乙酸维兰特罗25μg（按C24H33Cl2NO5计），'
            '递送剂量为糠酸氟替卡松92μg、乌美溴铵55μg（按C29H34NO2计）与三苯乙酸维兰特罗22μg（按C24H33Cl2NO5计）'
        ])

    def test_wrapped_line_with_semicolons_not_split(self):
        raw = ('377mg/ml(以钆特酸葡胺计，相当于0.5mmol/mL），10ml/瓶；15ml/瓶；20ml/瓶，15ml/支/盒（带针\n'
               '头），20ml/支/盒（带针头）。')
        specs = extract.parse_specs(raw)
        self.assertEqual(len(specs), 1)
        self.assertTrue(specs[0].endswith('20ml/支/盒（带针头）'))

    def test_wrapped_long_line_not_split(self):
        raw = ('2000lU/0.5ml/支（预灌封注射器）、4000lU/0.5ml/支（预灌封注射器）、6000lU/0.5ml/支（预灌封注\n'
               '射器）、10000lU/0.5ml/支（预灌封注射器）。')
        self.assertEqual(len(extract.parse_specs(raw)), 1)

    # ---- 5. 正常枚举仍按行切 ----
    def test_complete_lines_split(self):
        raw = ('每片含奥美沙坦酯20mg与氢氯噻嗪12.5mg；\n'
               '每片含奥美沙坦酯40mg与氢氯噻嗪12.5mg；\n'
               '每片含奥美沙坦酯40mg与氢氯噻嗪25mg。')
        self.assert_specs(raw, [
            '每片含奥美沙坦酯20mg与氢氯噻嗪12.5mg',
            '每片含奥美沙坦酯40mg与氢氯噻嗪12.5mg',
            '每片含奥美沙坦酯40mg与氢氯噻嗪25mg',
        ])

    def test_paren_markers_split(self):
        raw = '(1)250ml：羟乙基淀粉130/0.4 15g与氯化钠2.25g；(2)500ml：羟乙基淀粉130/0.4 30g与氯化钠4.5g。'
        self.assert_specs(raw, [
            '250ml：羟乙基淀粉130/0.4 15g与氯化钠2.25g',
            '500ml：羟乙基淀粉130/0.4 30g与氯化钠4.5g',
        ])

    # ---- 6. 空段与兜底 ----
    def test_empty(self):
        self.assertEqual(extract.parse_specs('   '), [])

    def test_no_strength_single(self):
        self.assert_specs('复方', ['复方'])


class TestIdToken(unittest.TestCase):
    def test_leading_zero_token(self):
        self.assertEqual(extract.id_token('0.75mg：0.5ml（预填充注射笔）', 0), '0p75mg')
        self.assertEqual(extract.id_token('3ml：300单位/支', 1), '3ml')

    def test_no_strength_falls_back(self):
        self.assertEqual(extract.id_token('复方', 2), 'spec3')


class TestLineComplete(unittest.TestCase):
    def test_terminal_punctuation_is_complete(self):
        for s in ('每片含奥美沙坦酯20mg与氢氯噻嗪12.5mg；', '1.0ml。', 'x;'):
            self.assertTrue(extract.line_complete(s), s)

    def test_open_tail_is_incomplete(self):
        for s in ('100μg（按C', '与氯化钠0.45g与', '200ml：'):
            self.assertFalse(extract.line_complete(s), s)

    def test_unbalanced_bracket_is_incomplete(self):
        long_wrap = '每泡含糠酸氟替卡松100μg、乌美溴铵62.5μg（按C29H34NO2计）与三苯乙酸维兰特罗25μg（按C'
        self.assertFalse(extract.line_complete(long_wrap))

    def test_line_starting_with_closer_is_incomplete(self):
        self.assertFalse(extract.line_complete('），300ml/瓶；500ml/袋。'))

    def test_long_line_is_incomplete(self):
        long_line = ('377mg/ml(以钆特酸葡胺计，相当于0.5mmol/mL），10ml/瓶；15ml/瓶；20ml/瓶，15ml/支/盒（带针')
        self.assertGreater(len(long_line), 60)
        self.assertFalse(extract.line_complete(long_line))


class TestJoinLines(unittest.TestCase):
    def test_cjk_break_no_space(self):
        self.assertEqual(extract.join_lines(['带针', '头）']), '带针头）')

    def test_formula_break_no_space(self):
        self.assertEqual(extract.join_lines(['（按C', '24H33Cl2NO5计）']), '（按C24H33Cl2NO5计）')

    def test_number_range_break_no_space(self):
        self.assertEqual(extract.join_lines(['维生素K1 67.5-', '90.0μg']), '维生素K1 67.5-90.0μg')

    def test_unit_break_keeps_space(self):
        self.assertEqual(extract.join_lines(['组份', '200ml', '500ml']), '组份200ml 500ml')

    def test_table_columns_keep_space(self):
        self.assertEqual(extract.join_lines(['0.52', '1.3']), '0.52 1.3')

    def test_english_words_keep_space(self):
        self.assertEqual(extract.join_lines(['Luit', 'pold']), 'Luit pold')


# ─────────────────────────────────────────────────────────────────────────────
# M7-T1：bbox 阅读顺序 + 表格 Markdown 重建（2026-11-15）
# ─────────────────────────────────────────────────────────────────────────────

class TestNormCellText(unittest.TestCase):
    def test_cjk_newline_no_space(self):
        self.assertEqual(extract.norm_cell_text('速发过敏反\n应#'), '速发过敏反应#')

    def test_ascii_newline_keeps_space(self):
        self.assertEqual(extract.norm_cell_text('0.52\n1.3'), '0.52 1.3')

    def test_collapses_whitespace(self):
        self.assertEqual(extract.norm_cell_text('  每日  2 次\t'), '每日 2 次')

    def test_strips_table_break(self):
        self.assertEqual(extract.norm_cell_text('甲' + extract.TABLE_BREAK + '乙'), '甲乙')


class TestRenderTable(unittest.TestCase):
    def test_markdown_basic(self):
        md, headings = extract.render_table([['系统器官分类', '十分常见'], ['免疫系统疾病', '过敏反应']])
        self.assertEqual(md.splitlines()[0], '| 系统器官分类 | 十分常见 |')
        self.assertTrue(md.splitlines()[1].startswith('| --- |'))
        self.assertIn('| 免疫系统疾病 | 过敏反应 |', md)
        self.assertEqual(headings, [])

    def test_empty_cells_kept(self):
        md, _ = extract.render_table([['a', 'b', 'c'], ['x', '', 'z']])
        self.assertIn('| x |  | z |', md)

    def test_heading_row_extracted(self):
        md, headings = extract.render_table([['【不良反应】', '', ''], ['期', '常见'], ['a', 'b']])
        self.assertEqual(headings, ['【不良反应】'])
        self.assertEqual(md.splitlines()[0], '| 期 | 常见 |')

    def test_too_small_returns_empty(self):
        md, headings = extract.render_table([['只有一行', '两列']])
        self.assertEqual((md, headings), ('', []))
        md, _ = extract.render_table([['单列'], ['还是单列'], ['第三行']])
        self.assertEqual(md, '')

    def test_trailing_blank_rows_dropped(self):
        md, _ = extract.render_table([['a', 'b'], ['1', '2'], ['', '']])
        self.assertEqual(len(md.splitlines()), 3)


class TestTableCoverage(unittest.TestCase):
    def test_full_coverage(self):
        self.assertEqual(extract.table_coverage('甲 乙\n丙', [['甲乙'], ['丙']]), 1.0)

    def test_partial_coverage(self):
        cov = extract.table_coverage('甲乙丙丁', [['甲乙'], ['丙']])
        self.assertAlmostEqual(cov, 0.75)

    def test_empty_raw(self):
        self.assertEqual(extract.table_coverage('  \n', [['a']]), 1.0)


class TestOrderItems(unittest.TestCase):
    def test_y_then_x(self):
        items = [
            {'kind': 'text', 'bbox': (10, 300, 100, 320), 'text': 'b'},
            {'kind': 'text', 'bbox': (10, 100, 100, 120), 'text': 'a'},
            {'kind': 'text', 'bbox': (10, 300, 20, 320), 'text': 'b2'},
        ]
        self.assertEqual([it['text'] for it in extract.order_items(items)], ['a', 'b', 'b2'])

    def test_table_sorted_into_position(self):
        items = [
            {'kind': 'text', 'bbox': (36, 308, 500, 800), 'text': '正文'},
            {'kind': 'table', 'bbox': (36, 36, 470, 306), 'rows': [['a', 'b'], ['c', 'd']]},
        ]
        self.assertEqual(extract.order_items(items)[0]['kind'], 'table')


class TestBlockInsideTable(unittest.TestCase):
    def test_center_inside(self):
        self.assertTrue(extract.block_inside_table((40, 710, 300, 750), (36, 709, 510, 806)))

    def test_majority_overlap(self):
        self.assertTrue(extract.block_inside_table((0, 0, 100, 100), (0, 0, 80, 100)))

    def test_minority_overlap_kept(self):
        self.assertFalse(extract.block_inside_table((0, 0, 100, 100), (90, 90, 200, 200)))


class TestMergeContinuation(unittest.TestCase):
    def test_bottom_top_same_cols_merges(self):
        prev = {'kind': 'table', 'bbox': (36, 700, 510, 806), 'rows': [['a', 'b']], 'page': 0, 'pageHeight': 842}
        cur = {'kind': 'table', 'bbox': (36, 36, 510, 300), 'rows': [['c', 'd']], 'page': 1, 'pageHeight': 842}
        self.assertTrue(extract.can_merge_continuation(prev, cur))

    def test_not_at_page_bottom_no_merge(self):
        prev = {'kind': 'table', 'bbox': (36, 400, 510, 500), 'rows': [['a', 'b']], 'page': 0, 'pageHeight': 842}
        cur = {'kind': 'table', 'bbox': (36, 36, 510, 300), 'rows': [['c', 'd']], 'page': 1, 'pageHeight': 842}
        self.assertFalse(extract.can_merge_continuation(prev, cur))

    def test_different_cols_no_merge(self):
        prev = {'kind': 'table', 'bbox': (36, 700, 510, 806), 'rows': [['a', 'b']], 'page': 0, 'pageHeight': 842}
        cur = {'kind': 'table', 'bbox': (36, 36, 510, 300), 'rows': [['c', 'd', 'e']], 'page': 1, 'pageHeight': 842}
        self.assertFalse(extract.can_merge_continuation(prev, cur))

    def test_text_item_no_merge(self):
        prev = {'kind': 'table', 'bbox': (36, 700, 510, 806), 'rows': [['a', 'b']], 'page': 0, 'pageHeight': 842}
        cur = {'kind': 'text', 'bbox': (36, 40, 510, 300), 'text': 'x'}
        self.assertFalse(extract.can_merge_continuation(prev, cur))


class TestMergeTableRows(unittest.TestCase):
    def _table(self, rows, cells):
        return {'rows': [list(r) for r in rows], 'cells': cells}

    def test_continuation_cell_appended(self):
        rects = [(36, 0, 114, 10), (114, 0, 201, 10), (201, 0, 291, 10)]
        prev = self._table([['代谢疾病', '低血糖（与二甲双胍']], [rects])
        cur = self._table([['', '联用时）']], [rects])
        extract.merge_table_rows(prev, cur)
        self.assertEqual(prev['rows'], [['代谢疾病', '低血糖（与二甲双胍联用时）']])

    def test_repeated_header_dropped(self):
        prev = self._table([['分类', '频率'], ['a', 'b']], [])
        cur = self._table([['分类', '频率'], ['c', 'd']], [])
        extract.merge_table_rows(prev, cur)
        self.assertEqual(prev['rows'], [['分类', '频率'], ['a', 'b'], ['c', 'd']])

    def test_plain_rows_appended(self):
        prev = self._table([['a', 'b']], [])
        cur = self._table([['c', 'd'], ['e', 'f']], [])
        extract.merge_table_rows(prev, cur)
        self.assertEqual(prev['rows'], [['a', 'b'], ['c', 'd'], ['e', 'f']])


class TestAssemblePages(unittest.TestCase):
    def test_tables_in_position(self):
        pages = [
            [
                {'kind': 'text', 'bbox': (36, 40, 500, 600), 'text': '第一页正文'},
                {'kind': 'table', 'bbox': (36, 620, 500, 700), 'rows': [['a', 'b'], ['c', 'd']], 'cells': []},
            ],
            [
                {'kind': 'table', 'bbox': (36, 36, 500, 200), 'rows': [['e', 'f'], ['g', 'h']], 'cells': []},
                {'kind': 'text', 'bbox': (36, 300, 500, 700), 'text': '第二页正文'},
            ],
        ]
        text, audit = extract.assemble_pages(pages, [842, 842])
        self.assertLess(text.index('第一页正文'), text.index('| a | b |'))
        self.assertLess(text.index('| a | b |'), text.index('| e | f |'))
        self.assertLess(text.index('| e | f |'), text.index('第二页正文'))
        self.assertEqual(audit['tables'], 2)

    def test_cross_page_merge(self):
        pages = [
            [{'kind': 'table', 'bbox': (36, 700, 500, 806), 'rows': [['h', 'k'], ['a', 'b']], 'cells': []}],
            [{'kind': 'table', 'bbox': (36, 36, 500, 200), 'rows': [['h', 'k'], ['c', 'd']], 'cells': []}],
        ]
        text, audit = extract.assemble_pages(pages, [842, 842])
        self.assertEqual(audit['mergedContinuations'], 1)
        self.assertIn('| a | b |', text)
        self.assertIn('| c | d |', text)
        self.assertEqual(text.count('| h | k |'), 1)

    def test_adjacent_tables_keep_blank_line(self):
        pages = [[
            {'kind': 'table', 'bbox': (36, 100, 500, 200), 'rows': [['a', 'b'], ['c', 'd']], 'cells': []},
            {'kind': 'table', 'bbox': (36, 210, 500, 300), 'rows': [['e', 'f'], ['g', 'h']], 'cells': []},
        ]]
        text, _ = extract.assemble_pages(pages, [842])
        _, sections = extract.split_sections('【成份】' + text)
        self.assertIn('\n\n| e | f |', sections['成份'])


class TestNormalizeSection(unittest.TestCase):
    def test_collapses_blank_lines(self):
        self.assertEqual(extract.normalize_section('甲\n\n\n乙'), '甲\n乙')

    def test_table_break_keeps_one_blank_line(self):
        raw = '| a |\n| b |' + extract.TABLE_BREAK + '| c |\n| d |'
        self.assertEqual(extract.normalize_section(raw), '| a |\n| b |\n\n| c |\n| d |')

    def test_no_table_break_no_blank_line(self):
        self.assertNotIn('\n\n', extract.normalize_section('甲\n乙\n\n丙'))


# ─────────────────────────────────────────────────────────────────────────────
# M7-T2：批准文号按规格归属；M7-T3：商品名标签变体（2026-11-15）
# ─────────────────────────────────────────────────────────────────────────────

class TestCanonicalStrengths(unittest.TestCase):
    def test_gram_to_milligram(self):
        self.assertEqual(extract.canonical_strengths('0.15g'), {'150mg'})
        self.assertEqual(extract.canonical_strengths('150mg'), {'150mg'})

    def test_microgram(self):
        self.assertEqual(extract.canonical_strengths('0.25μg'), {'0.00025mg'})

    def test_chinese_units(self):
        self.assertEqual(extract.canonical_strengths('15毫升：0.15克'), {'15ml', '150mg'})

    def test_percent_kept(self):
        self.assertEqual(extract.canonical_strengths('0.9%'), {'0.9%'})


class TestApprovalTokens(unittest.TestCase):
    def test_import_prefix_stripped(self):
        self.assertEqual(
            extract.approval_tokens('进口药品注册证号：H20150051'), ['H20150051'])

    def test_cn_approval_kept(self):
        self.assertEqual(extract.approval_tokens('0.25μg国药准字H20000065'), ['国药准字H20000065'])

    def test_packaging_suffix_kept(self):
        tokens = extract.approval_tokens('国药准字H20000065（分包装）')
        self.assertEqual(tokens, ['国药准字H20000065（分包装）'])


class TestParseApprovals(unittest.TestCase):
    def parse(self, raw: str, specs: list[str]):
        return extract.parse_approvals(raw, specs)

    # ---- §3.6 缺陷样本：无冒号按行归属 ----
    def test_no_colon_two_specs_two_numbers(self):
        approvals, warnings = self.parse(
            '0.25μg国药准字H20000065\n0.5μg国药准字H20000066', ['0.25μg', '0.5μg'])
        self.assertEqual(approvals['0.25μg'], ['国药准字H20000065'])
        self.assertEqual(approvals['0.5μg'], ['国药准字H20000066'])
        self.assertEqual(warnings, [])

    def test_circled_markers(self):
        approvals, _ = self.parse(
            '①5mg；国药准字H20041506\n②10mg；国药准字H20041507', ['①5mg', '②10mg'])
        self.assertEqual(approvals['①5mg'], ['国药准字H20041506'])
        self.assertEqual(approvals['②10mg'], ['国药准字H20041507'])

    def test_paren_numbers_and_unit_conversion(self):
        approvals, _ = self.parse(
            '1）0.15g 国药准字H10960164；\n2）50mg 国药准字H10960165。', ['50mg', '150mg'])
        self.assertEqual(approvals['50mg'], ['国药准字H10960165'])
        self.assertEqual(approvals['150mg'], ['国药准字H10960164'])

    def test_dabigatran_style(self):
        raw = ('（1）110mg（以达比加群酯计）：国药准字H20213234\n'
               '（2）150mg（以达比加群酯计）：国药准字H20213235')
        specs = ['110mg（以达比加群酯计）和', '150mg（以达比加群酯计）']
        approvals, _ = self.parse(raw, specs)
        self.assertEqual(approvals[specs[0]], ['国药准字H20213234'])
        self.assertEqual(approvals[specs[1]], ['国药准字H20213235'])

    # ---- 正常情形 ----
    def test_same_spec_multiple_numbers(self):
        raw = ('布地奈德鼻喷雾剂\n进口药品注册证号H20150051\n'
               '国药准字J20150001\n分包装：国药准字J20150002')
        approvals, _ = self.parse(raw, ['每瓶120喷'])
        self.assertEqual(len(approvals['每瓶120喷']), 3)

    def test_one_line_two_specs_shares_number(self):
        approvals, _ = self.parse('1）50mg 2）200mg', ['1）50mg 2）200mg'])
        self.assertEqual(approvals['1）50mg 2）200mg'], [])

    def test_voriconazole_label_lines(self):
        approvals, _ = self.parse(
            '进口药品注册证号：\n50mg：H20150051\n200mg：H20150052', ['1）50mg 2）200mg'])
        self.assertEqual(sorted(approvals['1）50mg 2）200mg']), ['H20150051', 'H20150052'])

    def test_label_then_value_on_next_line(self):
        approvals, _ = self.parse('0.25μg：\n国药准字H20000065\n0.5μg：\n国药准字H20000066',
                                  ['0.25μg', '0.5μg'])
        self.assertEqual(approvals['0.25μg'], ['国药准字H20000065'])
        self.assertEqual(approvals['0.5μg'], ['国药准字H20000066'])

    # ---- 无法归属：留空 + 告警，禁止全挂 ----
    def test_unmapped_left_empty_with_warning(self):
        approvals, warnings = self.parse(
            '0.25μg：国药准字H20000065\n0.5μg：国药准字H20000066\n国药准字H99999999',
            ['0.25μg', '0.5μg'])
        self.assertEqual(approvals['0.25μg'], ['国药准字H20000065'])
        self.assertEqual(approvals['0.5μg'], ['国药准字H20000066'])
        self.assertTrue(warnings)
        self.assertNotIn('国药准字H99999999', approvals['0.25μg'] + approvals['0.5μg'])

    def test_single_spec_gets_everything(self):
        approvals, warnings = self.parse('国药准字H20000065\nH20000066', ['70mg'])
        self.assertEqual(approvals['70mg'], ['国药准字H20000065', 'H20000066'])
        self.assertEqual(warnings, [])

    def test_empty_section(self):
        self.assertEqual(self.parse('', ['1mg']), ({'1mg': []}, []))


class TestBrandName(unittest.TestCase):
    def test_shangpin_ming_label(self):
        names = {'通用名称': '阿仑膦酸钠片', '商品名': '福善美'}
        self.assertEqual(extract.clean_brand_name(extract.pick_brand_name(names)), '福善美')

    def test_shangpin_mingcheng_label(self):
        names = {'通用名称': '阿卡波糖片', '商品名称': '拜唐苹'}
        self.assertEqual(extract.pick_brand_name(names), '拜唐苹')

    def test_parenthesized_label(self):
        names = {'通用名称': 'X', '商品名称（中文）': '欧乃派克'}
        self.assertEqual(extract.pick_brand_name(names), '欧乃派克')

    def test_english_brand_not_picked(self):
        names = {'通用名称': 'X', '英文商品名': 'Fluimucil'}
        self.assertIsNone(extract.pick_brand_name(names))

    def test_none_value_is_none(self):
        self.assertIsNone(extract.clean_brand_name('无'))
        self.assertIsNone(extract.clean_brand_name('—'))
        self.assertIsNone(extract.clean_brand_name(None))

    def test_value_trimmed(self):
        self.assertEqual(extract.clean_brand_name(' 雅施达 '), '雅施达')


if __name__ == '__main__':
    unittest.main(verbosity=2)
