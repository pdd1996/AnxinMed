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


if __name__ == '__main__':
    unittest.main(verbosity=2)
