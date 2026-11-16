#!/usr/bin/env python3
"""M7 抽检自查：把 40 行按缺陷类打印成 markdown，便于逐条判定并落 verdicts。

对每行输出：
- 身份字段（通用名/规格/商品名/批准文号）；
- 表格类：对应段落里的 Markdown 表格（前 12 行）+ 段落里是否还残留频率表拉平行；
- 文号类：【批准文号】原文 + 每规格归属结果；
- 商品名类：【药品名称】原文里的商品名标签 + 入库 brand_name。

用法（仓库根目录）：
  python tools/manual-pdf/m7_review_check.py \
      --plan data/review-batches/m7-spotcheck-40/plan.json \
      --drafts data/manuals-incoming-m7 \
      --out data/review-batches/m7-spotcheck-40/self-check.md
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

FREQ_SIGNATURE = re.compile(r'十分常见[\s\S]{0,80}常见[\s\S]{0,160}(?:偶见|罕见)')


def has_table(text: str) -> bool:
    return text.startswith('|') or '\n|' in text


def table_preview(text: str, max_lines: int = 14) -> list[str]:
    lines = [line for line in text.split('\n') if line.startswith('|')]
    return lines[:max_lines]


def flatten_lines(text: str) -> list[str]:
    out = []
    for line in text.split('\n'):
        if line.startswith('|'):
            continue
        if FREQ_SIGNATURE.search(line) or ('系统器官分类' in line and '常见' in line):
            out.append(line[:110])
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--drafts', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()

    plan = json.loads(args.plan.read_text(encoding='utf-8'))
    drafts = {}
    for path in args.drafts.glob('*.json'):
        d = json.loads(path.read_text(encoding='utf-8'))
        drafts[d['drugId']] = d

    out: list[str] = ['# M7 抽检自查（40 行）', '']
    for index, item in enumerate(plan['items'], 1):
        draft = drafts.get(item['drugId'])
        out.append(f"## {index}. {item['drugId']}  ·  {item['batchLabel']}")
        if draft is None:
            out.append('- ❌ 草稿缺失')
            continue
        out.append(f"- 通用名：{draft['genericName']}")
        out.append(f"- 规格：{draft['specification']}")
        out.append(f"- 商品名：{draft['brandName']!r}")
        out.append(f"- 批准文号：{draft['approvalNumbers']}")
        out.append(f"- 聚焦段：{item['focusLabel']}（{item['focusNote']}）")
        section_name = {'adverse': '不良反应', 'precautions': '注意事项', 'dosage': '用法用量',
                        'interactions': '药物相互作用', 'indication': '适应症'}[item['focusSection']]
        text = draft['sections'].get(section_name, '')
        if item['batch'] == 'table':
            out.append(f"- 【{section_name}】含 Markdown 表格：{has_table(text)}")
            preview = table_preview(text)
            if preview:
                out.append('```')
                out.extend(preview)
                out.append('```')
            residual = flatten_lines(text)
            if residual:
                out.append('- 残留拉平行：')
                for line in residual:
                    out.append(f'  - {line}')
        elif item['batch'] == 'approval':
            out.append(f"- 【批准文号】原文：`{draft['sections'].get('批准文号', '')[:400]}`")
            out.append(f"- 【规格】原文：`{draft['sections'].get('规格', '')[:200]}`")
        elif item['batch'] == 'brand':
            names = draft['sections'].get('药品名称', '')
            out.append(f"- 【药品名称】原文：`{names[:300]}`")
        out.append('')
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text('\n'.join(out), encoding='utf-8')
    print(f'✅ 自查报告：{args.out}（{len(plan["items"])} 行）')
    return 0


if __name__ == '__main__':
    if hasattr(__import__('sys').stdout, 'reconfigure'):
        __import__('sys').stdout.reconfigure(encoding='utf-8')
    raise SystemExit(main())
