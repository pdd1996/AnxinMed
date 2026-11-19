#!/usr/bin/env python3
"""mineru_xcheck.py 纯函数单测（不需要 PyMuPDF、不需要 PDF / MinerU 产物）。

跑法（仓库根目录）：
  python tools/manual-pdf/test_mineru_xcheck.py
  python -m unittest discover -s tools/manual-pdf -p 'test_*.py'

覆盖三类判定：HTML 表格 → 网格（含 colspan/rowspan）、贴页边裁切回补候选、段落/草稿口径。
"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import mineru_xcheck as xc  # noqa: E402


class TestHtmlTable(unittest.TestCase):
    def test_plain_2x2(self):
        table = xc.parse_html_table(
            '<table><tbody><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></tbody></table>')
        self.assertEqual((table['nrows'], table['ncols']), (2, 2))
        self.assertEqual(xc.grid_to_markdown_rows(table), [['a', 'b'], ['c', 'd']])

    def test_colspan_covers_cells(self):
        table = xc.parse_html_table(
            '<table><tr><td colspan="3">胃肠系统疾病</td></tr>'
            '<tr><td></td><td>常见</td><td>腹痛、腹泻</td></tr></table>')
        self.assertEqual(table['ncols'], 3)
        self.assertEqual(xc.grid_to_markdown_rows(table)[0], ['胃肠系统疾病', '', ''])
        # colspan 单元格只占一个 cells 条目
        self.assertEqual(len(table['cells']), 4)

    def test_rowspan_anchor_and_blank(self):
        table = xc.parse_html_table(
            '<table><tr><td rowspan="2">血液和淋巴系统疾病</td><td>贫血</td></tr>'
            '<tr><td>血小板减少</td></tr></table>')
        self.assertEqual(table['ncols'], 2)
        rows = xc.grid_to_markdown_rows(table)
        self.assertEqual(rows, [['血液和淋巴系统疾病', '贫血'], ['', '血小板减少']])
        self.assertEqual(xc.table_stats(table)['rowspanCells'], 1)

    def test_br_and_entity(self):
        table = xc.parse_html_table('<table><tr><td>第一行<br>第二行</td><td>A&amp;B</td></tr></table>')
        self.assertEqual(table['cells'][0]['text'], '第一行第二行')
        self.assertEqual(table['cells'][1]['text'], 'A&B')

    def test_rightmost_cells(self):
        table = xc.parse_html_table(
            '<table><tr><td rowspan="2">组</td><td>常见</td><td>腹痛</td></tr>'
            '<tr><td>偶见</td><td>腹泻</td></tr></table>')
        cells = xc.rightmost_cells(table)
        self.assertEqual([c['text'] for c in cells], ['腹痛', '腹泻'])
        self.assertEqual(cells[0]['row'], 0)


class TestMarkdownStats(unittest.TestCase):
    def test_table_with_empty_cells(self):
        body = ('| | 常见 |\n| --- | --- |\n| | 偶见 |\n'
                '| 全身性疾病 | |\n| | 罕见 |')
        stats = xc.markdown_table_stats(body)
        self.assertEqual(stats['tables'], 1)
        self.assertEqual(stats['rows'], 4)
        self.assertEqual(stats['maxCols'], 2)
        self.assertEqual(stats['emptyCellRows'], 4)

    def test_no_table(self):
        self.assertEqual(xc.markdown_table_stats('十分常见：震颤。')['tables'], 0)

    def test_strip_markdown(self):
        body = '| a | b |\n| --- | --- |\n| c | d |\n正文'
        self.assertEqual(xc.strip_markdown(body), 'abcd正文')


class TestCoverage(unittest.TestCase):
    def test_identical(self):
        cov = xc.char_coverage('十分常见：震颤。', '十分常见：震颤。')
        self.assertEqual(cov['rate'], 1.0)
        self.assertEqual(cov['lost'], 0)

    def test_missing_char(self):
        cov = xc.char_coverage('支气管痉挛', '支气管')
        self.assertLess(cov['rate'], 1.0)
        self.assertIn('痉', cov['missingSample'])
        self.assertEqual(cov['lostContent'], 2)
        self.assertEqual(cov['lostDistinctContent'], 2)
        self.assertEqual(cov['lostDistinctCJK'], 2)

    def test_punctuation_only_loss_is_not_content(self):
        cov = xc.char_coverage('1.0mg（10^6 U）', '1.0mg10^6U')
        self.assertEqual(cov['lostContent'], 0)
        self.assertEqual(cov['lostDistinctContent'], 0)
        self.assertEqual(cov['lostDistinctCJK'], 0)

    def test_html_tag_ignored(self):
        cov = xc.char_coverage('腹痛', '<table><tr><td>腹痛</td></tr></table>')
        self.assertEqual(cov['rate'], 1.0)

    def test_less_than_not_treated_as_html(self):
        # 说明书里「<1/10」是阈值不是标签，不能被当 HTML 删掉
        self.assertEqual(xc.strip_html('常见：<1/10，偶见：<1/1000'), '常见：<1/10，偶见：<1/1000')
        cov = xc.char_coverage('心率升高>10bpm的比例为16%', '心率升高&gt;10bpm的比例为16%')
        self.assertGreater(cov['rate'], 0.9)


class TestEdgeAndClip(unittest.TestCase):
    def test_bbox_edge(self):
        self.assertTrue(xc.bbox_touches_edge([0.05, 0.15, 1.0, 0.6]))
        self.assertFalse(xc.bbox_touches_edge([0.05, 0.15, 0.9, 0.6]))
        self.assertFalse(xc.bbox_touches_edge(None))

    def test_clipped_suffix_r1_real_case(self):
        # 丁二磺酸 R1：MinerU 单元格贴着页面右缘被裁，文本层保留「管」
        cell = '口干、消化不良、胃肠胀气、胃肠疼痛、胃肠出血、胃肠系统疾病、呕吐、食'
        line = '偶见口干、消化不良、胃肠胀气、胃肠疼痛、胃肠出血、胃肠系统疾病、呕吐、食管'
        clipped = xc.find_clipped_suffixes([cell], [line])
        self.assertEqual(clipped, [{'cell': cell, 'suffix': '管'}])

    def test_no_suffix_when_line_ends(self):
        self.assertEqual(xc.find_clipped_suffixes(['腹痛、腹泻、恶心'], ['常见腹痛、腹泻、恶心']), [])

    def test_short_cell_ignored(self):
        self.assertEqual(xc.find_clipped_suffixes(['食'], ['食管']), [])

    def test_header_and_colspan_cells_ignored(self):
        # 表头「不良反应」出现在叙述句里、跨列合并的「胃肠系统疾病」出现在行内——都不算裁切
        cells = [{'text': '不良反应', 'row': 0, 'colspan': 1},
                 {'text': '胃肠系统疾病', 'row': 1, 'colspan': 3}]
        lines = ['在腺苷蛋氨酸临床试验期间观察到以下不良反应，频率如下所示。',
                 '偶见口干、消化不良、胃肠系统疾病、呕吐、食管']
        self.assertEqual(xc.find_clipped_suffixes(cells, lines), [])

    def test_body_rightmost_cell_detected(self):
        cells = [{'text': '口干、消化不良、呕吐、食', 'row': 3, 'colspan': 1}]
        clipped = xc.find_clipped_suffixes(cells, ['偶见口干、消化不良、呕吐、食管'])
        self.assertEqual(clipped, [{'cell': '口干、消化不良、呕吐、食', 'suffix': '管'}])


class TestSections(unittest.TestCase):
    def _payload(self):
        return {'pages': [{'blocks': [
            {'type': 'text', 'content': [{'type': 'text', 'content': '【不良反应】'}]},
            {'type': 'table', 'bbox': [0.1, 0.2, 1.0, 0.6],
             'content': [{'type': 'table_body', 'content':
                          '<table><tr><td>组</td><td>频率</td><td>不良反应</td></tr></table>'}]},
            {'type': 'text', 'content': [{'type': 'text', 'content': '【注意事项】'}]},
            {'type': 'text', 'content': [{'type': 'text', 'content': '特别提示'}]},
        ]}]}

    def test_split_sections(self):
        sections = xc.split_mineru_sections(self._payload())
        self.assertEqual(list(sections), ['不良反应', '注意事项'])
        self.assertEqual(len(sections['不良反应']['tables']), 1)
        self.assertIn('特别提示', xc.section_visible_text(sections['注意事项']))

    def test_heading_glued_into_text_block(self):
        # 真实样本：替格瑞洛末页「a‘其它’TIMI…【贮藏】」挤在同一个文本块，随后才是正文
        payload = {'pages': [{'blocks': [
            {'type': 'text', 'content': [
                {'type': 'text', 'content': 'a‘其它’TIMI主要出血是指所有裁定为TIMI主要出血。'},
                {'type': 'text', 'content': '【贮藏】'},
            ]},
            {'type': 'text', 'content': [{'type': 'text', 'content': '30℃以下保存。'}]},
            {'type': 'text', 'content': [{'type': 'text', 'content': '【包装】'}]},
            {'type': 'text', 'content': [{'type': 'text', 'content': '14片/盒。'}]},
        ]}]}
        sections = xc.split_mineru_sections(payload)
        self.assertIn('贮藏', sections)
        self.assertEqual(xc.section_visible_text(sections['贮藏']).strip(), '30℃以下保存。')
        self.assertEqual(xc.section_visible_text(sections['包装']).strip(), '14片/盒。')

    def test_analyze_mineru_audit(self):
        payload = self._payload()
        payload['extensions'] = {'mineru': {'tier': 'basic', 'parse_mode': 'txt'}}
        mu = xc.analyze_mineru(payload)
        self.assertEqual(mu['tier'], 'basic')
        self.assertEqual(mu['parseMode'], 'txt')
        self.assertEqual(mu['tableCount'], 1)
        self.assertEqual(mu['maxCols'], 3)

    def test_analyze_mineru_marks_edge(self):
        payload = self._payload()
        payload['extensions'] = {'mineru': {'tier': 'basic', 'parse_mode': 'txt'}}
        mu = xc.analyze_mineru(payload)
        self.assertEqual(mu['tables'][0]['section'], '不良反应')
        self.assertTrue(mu['tables'][0]['touchesEdge'])
        self.assertEqual(mu['tables'][0]['rightmostCells'][0]['text'], '不良反应')
        self.assertEqual(mu['tables'][0]['page'], 1)


class TestClassify(unittest.TestCase):
    def _cov(self, rate=1.0, lost_cjk=0, lost_digit=0, section_split=False):
        return {'rate': rate, 'lost': 0, 'lostContent': 0,
                'lostDistinctContent': lost_cjk + lost_digit,
                'lostDistinctCJK': lost_cjk, 'lostDistinctDigit': lost_digit,
                'sectionSplit': section_split, 'chars': 10, 'missingSample': ''}

    def test_structure_upgraded(self):
        draft = {'tables': 1, 'rows': 8, 'maxCols': 2, 'emptyCellRows': 3, 'emptyCells': 6}
        mu = {'tables': 1, 'maxCols': 3, 'rowspanCells': 0, 'colspanCells': 2, 'emptyCells': 1}
        verdict, flags = xc.classify_section(draft, mu, self._cov(), [])
        self.assertEqual(verdict, 'structure-upgraded')
        self.assertEqual(flags, [])

    def test_merged_cells_resolved(self):
        draft = {'tables': 1, 'rows': 8, 'maxCols': 3, 'emptyCellRows': 4, 'emptyCells': 8}
        mu = {'tables': 1, 'maxCols': 3, 'rowspanCells': 4, 'colspanCells': 0, 'emptyCells': 0}
        verdict, flags = xc.classify_section(draft, mu, self._cov(), [])
        self.assertEqual(verdict, 'merged-cells-resolved')
        self.assertIn('merged-cells-flattened', flags)

    def test_no_source_table(self):
        empty = {'tables': 0, 'rows': 0, 'maxCols': 0, 'emptyCellRows': 0, 'emptyCells': 0}
        verdict, _ = xc.classify_section(empty, empty, self._cov(), [])
        self.assertEqual(verdict, 'no-source-table')

    def test_mineru_missed_table(self):
        draft = {'tables': 1, 'rows': 5, 'maxCols': 3, 'emptyCellRows': 0, 'emptyCells': 0}
        mu = {'tables': 0, 'maxCols': 0, 'rowspanCells': 0, 'colspanCells': 0, 'emptyCells': 0}
        verdict, _ = xc.classify_section(draft, mu, self._cov(), [])
        self.assertEqual(verdict, 'mineru-missed-table')

    def test_text_gap_flag(self):
        empty = {'tables': 0, 'rows': 0, 'maxCols': 0, 'emptyCellRows': 0, 'emptyCells': 0}
        _, flags = xc.classify_section(empty, empty, self._cov(0.95), [])
        self.assertIn('text-gap', flags)
        self.assertNotIn('serious-text-gap', flags)

    def test_serious_text_gap(self):
        empty = {'tables': 0, 'rows': 0, 'maxCols': 0, 'emptyCellRows': 0, 'emptyCells': 0}
        _, flags = xc.classify_section(empty, empty, self._cov(0.95, lost_cjk=5), [])
        self.assertIn('serious-text-gap', flags)

    def test_latin_only_loss_not_serious(self):
        empty = {'tables': 0, 'rows': 0, 'maxCols': 0, 'emptyCellRows': 0, 'emptyCells': 0}
        cov = {'rate': 0.98, 'lost': 5, 'lostContent': 5, 'lostDistinctContent': 5,
               'lostDistinctCJK': 0, 'lostDistinctDigit': 0, 'chars': 100, 'missingSample': 'Cmax'}
        _, flags = xc.classify_section(empty, empty, cov, [])
        self.assertNotIn('serious-text-gap', flags)

    def test_section_split_not_serious(self):
        empty = {'tables': 0, 'rows': 0, 'maxCols': 0, 'emptyCellRows': 0, 'emptyCells': 0}
        _, flags = xc.classify_section(empty, empty, self._cov(0.9, lost_cjk=20, section_split=True), [])
        self.assertIn('section-split', flags)
        self.assertNotIn('serious-text-gap', flags)

    def test_aggregate_priority(self):
        self.assertEqual(
            xc.aggregate_row_verdict(['no-source-table', 'structure-upgraded', 'structure-same']),
            'structure-upgraded')
        self.assertEqual(xc.aggregate_row_verdict([]), 'no-source-table')


class TestPlan(unittest.TestCase):
    def test_sanitize_slug(self):
        self.assertEqual(
            xc.sanitize_slug('丁二磺酸腺苷蛋氨酸肠溶片[188523].pdf'),
            '丁二磺酸腺苷蛋氨酸肠溶片_188523')
        self.assertEqual(xc.sanitize_slug('结构脂肪乳（20%）丨氨基酸[1,2].pdf'),
                         '结构脂肪乳_20%_丨氨基酸_1_2')

    def test_build_plan_dedupes_multi_spec(self):
        with tempfile.TemporaryDirectory() as tmp:
            pdf_dir = Path(tmp)
            (pdf_dir / 'a[1,2].pdf').write_bytes(b'')
            drafts = {
                'drug-a-2mg': {'drugId': 'drug-a-2mg', 'sourceFile': 'a[1,2].pdf', 'pageCount': 3},
                'drug-a-4mg': {'drugId': 'drug-a-4mg', 'sourceFile': 'a[1,2].pdf', 'pageCount': 3},
            }
            plan = xc.build_plan(drafts, None, list(drafts), pdf_dir)
            self.assertEqual(len(plan), 1)
            self.assertEqual(plan[0]['drugIds'], ['drug-a-2mg', 'drug-a-4mg'])
            self.assertEqual(plan[0]['pageCount'], 3)

    def test_run_script_lf_and_wsl_paths(self):
        plan = [{'slug': 's1', 'sourceFile': 'x.pdf',
                 'pdfPath': 'D:\\manuals\\x.pdf', 'drugIds': ['d1'], 'pageCount': 1}]
        script = xc.render_run_script(plan, 'C:\\repo\\data\\mineru-xcheck\\raw',
                                      '/mnt/d/mineru-home', '~/mvenv/bin/mineru-kit')
        self.assertNotIn('\r', script)
        self.assertIn('/mnt/d/manuals/x.pdf', script)
        self.assertIn('/mnt/c/repo/data/mineru-xcheck/raw', script)
        self.assertIn('--tier basic --format middle_json', script)

    def test_run_script_workers_round_robin(self):
        plan = [{'slug': f's{i}', 'sourceFile': f'{i}.pdf', 'pdfPath': f'D:\\manuals\\{i}.pdf',
                 'drugIds': [f'd{i}'], 'pageCount': 1} for i in range(5)]
        script = xc.render_run_script(plan, 'C:\\repo\\raw', '/mnt/home', 'kit', workers=3)
        for w in range(3):
            self.assertIn(f'worker{w} () {{', script)
        self.assertIn('done: outputs=', script)
        # 轮转分配：worker0 拿到 s0/s3，worker1 拿到 s1/s4，worker2 拿到 s2
        worker0 = script.split('worker0 () {')[1].split('}')[0]
        self.assertIn('"s0"', worker0)
        self.assertIn('"s3"', worker0)
        self.assertNotIn('"s1"', worker0)

    def test_load_drug_ids(self):
        with tempfile.TemporaryDirectory() as tmp:
            txt = Path(tmp) / 'ids.txt'
            txt.write_text('drug-a\ndrug-b\n\n# 注释\ndrug-c\n', encoding='utf-8')
            self.assertEqual(xc.load_drug_ids(txt), ['drug-a', 'drug-b', 'drug-c'])
            jsonl = Path(tmp) / 'ids.jsonl'
            jsonl.write_text('{"drugId": "drug-x", "sourceFile": "x.pdf"}\n', encoding='utf-8')
            self.assertEqual(xc.load_drug_ids(jsonl), ['drug-x'])

    def test_write_text_lf(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'run.sh'
            xc.write_text_lf(path, 'a\r\nb\n')
            self.assertEqual(path.read_bytes(), b'a\nb\n')


class TestFlattenedFreqTable(unittest.TestCase):
    def test_r2_like_list_detected(self):
        body = ('十分常见：震颤。\n常见：锥体外系障碍、嗜睡。\n偶见：昏迷、脑病。\n'
                '罕见：可逆性痴呆。\n未知：复视。')
        self.assertTrue(xc.looks_like_flattened_freq_table(body))

    def test_prose_not_detected(self):
        body = '本品为白色片。\n常见不良反应见下表。\n如有不适请就医。'
        self.assertFalse(xc.looks_like_flattened_freq_table(body))

    def test_markdown_table_ignored(self):
        body = '| a | b |\n| --- | --- |\n| c | d |'
        self.assertFalse(xc.looks_like_flattened_freq_table(body))


class TestSectionResolution(unittest.TestCase):
    def test_exact_match(self):
        sections = {'不良反应': {'texts': ['x'], 'tables': []}}
        self.assertEqual(xc._resolve_mu_section('不良反应', '正文', sections), '不良反应')

    def test_fuzzy_match_when_heading_missing(self):
        long_body = '已证明腺苷蛋氨酸既不改变习惯，也无成瘾性。对本品特别敏感的个体，偶可引起昼夜节律紊乱，' * 3
        sections = {'_preamble': {'texts': [long_body], 'tables': []}}
        self.assertIsNone(xc._resolve_mu_section('不良反应', long_body, sections))

    def test_no_match_for_short_body(self):
        self.assertIsNone(xc._resolve_mu_section('不良反应', '短', {'禁忌': {'texts': [], 'tables': []}}))


class TestActionFor(unittest.TestCase):
    def test_actions(self):
        self.assertEqual(xc._action_for('structure-upgraded', []), 'upgrade-table-structure')
        self.assertEqual(xc._action_for('merged-cells-resolved', []), 'upgrade-table-structure')
        self.assertEqual(xc._action_for('mineru-missed-table', []), 'manual-review')
        self.assertEqual(xc._action_for('no-source-table', [], flattened=True),
                         'confirm-no-source-table')
        self.assertEqual(xc._action_for('no-source-table', [], flattened=False), 'manual-review')
        self.assertEqual(xc._action_for('structure-same', ['text-gap']), 'no-action')
        self.assertEqual(xc._action_for('structure-same', ['section-split']), 'no-action')
        self.assertEqual(xc._action_for('structure-same', []), 'no-action')


class TestReportRender(unittest.TestCase):
    def test_render_report_shape(self):
        row = {
            'drugId': 'drug-x', 'sourceFile': 'x.pdf', 'pageCount': 2,
            'pymupdf': {'tables': 1, 'maxCols': 3},
            'mineru': {'tables': 1, 'maxCols': 3, 'tier': 'basic', 'parseMode': 'txt'},
            'coverage': {'rate': 0.999, 'lost': 1, 'chars': 1000, 'missingSample': '管'},
            'verdict': 'merged-cells-resolved',
            'sections': [{'section': '不良反应', 'verdict': 'merged-cells-resolved',
                          'flags': ['merged-cells-flattened'],
                          'draft': {'tables': 1, 'rows': 4, 'maxCols': 3,
                                    'emptyCellRows': 2, 'emptyCells': 4},
                          'mineru': {'tables': 1, 'maxCols': 3, 'rowspanCells': 2,
                                     'colspanCells': 0, 'emptyCells': 0},
                          'coverage': {'rate': 0.999, 'lost': 1, 'chars': 1000,
                                       'missingSample': '管'},
                          'clipped': []}],
            'candidates': [{'drugId': 'drug-x', 'action': 'upgrade-table-structure'}],
        }
        markdown, payload = xc.render_report([row], {'generatedAt': '2026-11-19T00:00:00+08:00'})
        self.assertIn('# MinerU 交叉复核报告', markdown)
        self.assertIn('| drug-x |', markdown)
        self.assertIn('merged-cells-resolved', markdown)
        self.assertEqual(payload['targets'], 1)
        self.assertEqual(payload['verdicts'], {'merged-cells-resolved': 1})
        self.assertEqual(payload['actions'], {'upgrade-table-structure': 1})


if __name__ == '__main__':
    unittest.main(verbosity=2)
