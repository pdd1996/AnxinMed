#!/usr/bin/env python3
"""打印指定 8 个跨段泄漏样本的聚焦段落，供人工确认「无表格残留」。"""
from __future__ import annotations

import json
from pathlib import Path

CASES = [
    ('drug-a-ka-bo-tang-pian-0p1g', '注意事项'),
    ('drug-jiegou-zhifangru-20-anjisuan-16-putaotang-13-zhusheye-1206ml', '用法用量'),
    ('drug-ruguotang-koufurongye-100ml-h20065730', '注意事项'),
    ('drug-fukangzuo-jiaonang-150mg', '注意事项'),
    ('drug-peiduopuli-shuding-an-pian-4mg', '药物相互作用'),
    ('drug-dulatangtai-zhusheye-0p75mg', '不良反应'),
    ('drug-naqugansugai-zhusheye-0p3ml', '用法用量'),
    ('drug-jiegou-zhifangru-20-anjisuan-16-putaotang-13-zhusheye-1904ml', '不良反应'),
]


def main() -> int:
    for drug_id, section in CASES:
        path = Path('data/manuals') / f'{drug_id}.json'
        draft = json.loads(path.read_text(encoding='utf-8'))
        text = (draft.get('sections') or {}).get(section, '')
        print(f'## {draft["genericName"]} [{section}] len={len(text)}')
        print(text[:700])
        print('-' * 60)
    return 0


if __name__ == '__main__':
    import sys
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    raise SystemExit(main())
