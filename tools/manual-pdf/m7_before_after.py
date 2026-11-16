#!/usr/bin/env python3
"""生成 M7 效果对照（修复前 M6 草稿 vs 修复后草稿），落到 data/m7-reports/before-after.md。

只读本地草稿池与备份，不碰数据库。
用法：python tools/manual-pdf/m7_before_after.py --before <M6 草稿备份> --after data/manuals \
        --out data/m7-reports/before-after.md
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

CASES = [
    # (drugId, 段落, 展示行数, 标题)
    ('drug-dulatangtai-zhusheye-0p75mg', '不良反应', 16, '§3.5 表格：度拉糖肽【不良反应】频率表（修复前拉平 / 修复后 Markdown 表 + 跨页合并）'),
    ('drug-jiegou-zhifangru-20-anjisuan-16-putaotang-13-zhusheye-1206ml', '用法用量', 10, '§3.5 跨段泄漏：结构脂肪乳【用法用量】（修复前混入组份汇总表 / 修复后干净）'),
    ('drug-jiegou-zhifangru-20-anjisuan-16-putaotang-13-zhusheye-1206ml', '成份', 12, '§3.5 跨段泄漏（续）：同一份【成份】段（修复后组份表回到这里）'),
    ('drug-afaguhuachun-ruan-jiaonang-0p25ug-h20000065', '批准文号', 6, '§3.6 批准文号：阿法骨化醇 0.25μg/0.5μg 两规格（修复前两行都挂两个文号）'),
    ('drug-fukangzuo-jiaonang-50mg', '批准文号', 6, '§3.6 批准文号：氟康唑胶囊（0.15g ≡ 150mg 单位换算后归属）'),
    ('drug-alunlinsuanna-pian-70mg', '药品名称', 8, '§3.7 商品名：阿仑膦酸钠（商品名：福善美，修复前 brandName 为空）'),
]


def load(directory: Path, drug_id: str) -> dict:
    return json.loads((directory / f'{drug_id}.json').read_text(encoding='utf-8'))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--before', type=Path, required=True)
    parser.add_argument('--after', type=Path, default=Path('data/manuals'))
    parser.add_argument('--out', type=Path, default=Path('data/m7-reports/before-after.md'))
    args = parser.parse_args()

    lines: list[str] = ['# M7 修复前后对照（M6 草稿 → M7 草稿）', '',
                        '> 数据源：`data/manuals`（M7 修复后）vs M6 关账时草稿备份；只节选关键段落。', '']
    for drug_id, section, limit, title in CASES:
        before = load(args.before, drug_id)
        after = load(args.after, drug_id)
        lines.append(f'## {title}')
        lines.append('')
        lines.append(f'`{drug_id}` · 【{section}】')
        lines.append('')
        lines.append('**修复前（M6）**：')
        lines.append('```')
        old = (before.get('sections') or {}).get(section, '')
        lines.extend(old.split('\n')[:limit])
        if len(old.split('\n')) > limit:
            lines.append('…（截断）')
        lines.append('```')
        lines.append('')
        lines.append('**修复后（M7）**：')
        lines.append('```')
        new = (after.get('sections') or {}).get(section, '')
        lines.extend(new.split('\n')[:limit])
        if len(new.split('\n')) > limit:
            lines.append('…（截断）')
        lines.append('```')
        lines.append('')
        if section == '批准文号':
            lines.append(f"- 规格：{after['specification']!r}")
            lines.append(f"- 修复前 approvalNumbers：{before.get('approvalNumbers')}")
            lines.append(f"- 修复后 approvalNumbers：{after.get('approvalNumbers')}")
            lines.append('')
        if section == '药品名称':
            lines.append(f"- 修复前 brandName：{before.get('brandName')!r}")
            lines.append(f"- 修复后 brandName：{after.get('brandName')!r}")
            lines.append('')
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(f'✅ 对照报告：{args.out}')
    return 0


if __name__ == '__main__':
    if hasattr(__import__('sys').stdout, 'reconfigure'):
        __import__('sys').stdout.reconfigure(encoding='utf-8')
    raise SystemExit(main())
