#!/usr/bin/env python3
"""M7 抽检批次计划（T6）——从 staging 草稿里选 40 行，覆盖三条缺陷类。

批次构成（seed 固定，可复现）：
  table     20 行：【不良反应】旧「拉平签名」行里随机抽（reviewed 优先），聚焦表格行列重建；
  cross     8 行：M6 已确认的跨段泄漏样本（阿卡波糖/结构脂肪乳/乳果糖/氟康唑胶囊/培哚普利…）；
  approval  6 行：M7-T2 文号归属修复样本（阿法骨化醇/阿立哌唑/氟康唑胶囊/达比加群 + 2 正常多包装）；
  brand     6 行：M7-T3 商品名补齐样本（25 行里抽 6，含 3 个 M6 确认样本）。

输出：plan.json（spotcheck_page.py 输入）+ plan.ids.txt（review-export 用）。
判据里不做「存疑即跳过」：抽检按三维度判定（表格行列 / 文号归属 / 商品名），见 T6。

用法（仓库根目录，重提取且库内修复后执行）：
  python tools/manual-pdf/m7_spotcheck_plan.py --staging data/manuals-incoming-m7 \
      --before data/manuals --out data/review-batches/m7-spotcheck-40 --seed 20261115
"""
from __future__ import annotations

import argparse
import json
import random
import re
from datetime import datetime, timezone
from pathlib import Path

FREQ_SIGNATURE = re.compile(r'十分常见[\s\S]{0,80}常见[\s\S]{0,160}(?:偶见|罕见)')

# M6 已确认的跨段泄漏样本（genericName 关键字 → 聚焦段）
CROSS_SAMPLES = [
    ('阿卡波糖', 'precautions', '注意事项混入不良反应频率表（低血糖被劈开）'),
    ('结构脂肪乳', 'dosage', '用法用量混入组份汇总表（劈句）'),
    ('乳果糖', 'precautions', '注意事项混入用法用量表片段'),
    ('氟康唑胶囊', 'precautions', '注意事项开头即不良反应表格碎片'),
    ('培哚普利', 'interactions', '药物相互作用被提示框从句子中间插断'),
    ('度拉糖肽', 'adverse', '不良反应频率表跨页拆分'),
    ('阿卡波糖', 'adverse', '不良反应频率表（reviewed）'),
    ('结构脂肪乳', 'adverse', '不良反应表（reviewed）'),
]

# M7-T2 / T3 已确认样本（genericName 关键字）
APPROVAL_SAMPLES = [
    ('阿法骨化醇', '吸入', '阿法骨化醇软胶囊：0.25μg/0.5μg 各挂两文号'),
    ('阿立哌唑', '片', '①5mg/②10mg 无冒号行归属失败'),
    ('氟康唑胶囊', '胶囊', '0.15g 与 50mg 单位换算归属'),
    ('达比加群酯', '胶囊', '（1）110mg/（2）150mg 冒号行误分组'),
    ('布地奈德鼻喷雾剂', '喷', '同规格三文号（正常多包装）'),
    ('阿仑膦酸钠', '片', '同规格多文号（正常多包装）'),
]
BRAND_SAMPLES = [
    ('阿仑膦酸钠', '福善美（M6 确认缺陷）'),
    ('头孢呋辛酯', '达力新（M6 确认缺陷）'),
    ('培哚普利叔丁胺', '雅施达（M6 确认缺陷）'),
    ('富马酸喹硫平', '思瑞康/SEROQUEL'),
    ('甲巯咪唑', '赛治'),
    ('硫酸沙丁胺醇吸入气雾剂', '万托林'),
]

LABEL = {
    'indication': '适应症', 'contraindication': '禁忌', 'precautions': '注意事项',
    'adverse': '不良反应', 'interactions': '药物相互作用', 'dosage': '用法用量',
}


def flatten_signature(text: str) -> bool:
    return bool(FREQ_SIGNATURE.search(text)) or ('系统器官分类' in text and '常见' in text)


def load(directory: Path) -> list[dict]:
    drafts = []
    for path in sorted(directory.glob('*.json')):
        drafts.append(json.loads(path.read_text(encoding='utf-8')))
    return drafts


def find_by_generic(drafts: list[dict], keyword: str, prefer_contains: str = '') -> dict | None:
    hits = [d for d in drafts if keyword in d['genericName']]
    if prefer_contains:
        preferred = [d for d in hits if prefer_contains in d['genericName']]
        if preferred:
            hits = preferred
    if not hits:
        return None
    # 同通用名多规格时取第一个（规格序稳定）
    return sorted(hits, key=lambda d: d['drugId'])[0]


def item(draft: dict, batch: str, batch_label: str, focus: str, focus_note: str = '', multi: str = '—') -> dict:
    return {
        'drugId': draft['drugId'],
        'sourceFile': draft['sourceFile'],
        'genericName': draft['genericName'],
        'specification': draft['specification'],
        'batch': batch,
        'batchLabel': batch_label,
        'focusSection': focus,
        'focusLabel': LABEL[focus],
        'focusNote': focus_note,
        'multiLabel': multi,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description='M7 抽检计划')
    parser.add_argument('--staging', type=Path, required=True)
    parser.add_argument('--before', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--seed', type=int, default=20261115)
    args = parser.parse_args()

    staging = load(args.staging)
    before = {d['drugId']: d for d in load(args.before)}
    by_id = {d['drugId']: d for d in staging}
    items: list[dict] = []
    used: set[str] = set()

    def add(draft: dict | None, batch: str, label: str, focus: str, note: str = '', multi: str = '—') -> bool:
        if draft is None or draft['drugId'] in used:
            return False
        items.append(item(draft, batch, label, focus, note, multi))
        used.add(draft['drugId'])
        return True

    # 1) 跨段泄漏已知样本（8）
    for keyword, focus, note in CROSS_SAMPLES:
        add(find_by_generic(staging, keyword), 'cross', '跨段泄漏已知样本', focus, note)

    # 2) 文号样本（6）
    for keyword, prefer, note in APPROVAL_SAMPLES:
        add(find_by_generic(staging, keyword, prefer), 'approval', '批准文号归属', 'indication', note)

    # 3) 商品名样本（6）
    for keyword, note in BRAND_SAMPLES:
        add(find_by_generic(staging, keyword), 'brand', '商品名补齐', 'indication', note)

    # 4) 表格样本（20）：旧签名行随机抽（reviewed 行由落库脚本单独审计，不在此重复）
    old_sig = [
        did for did, d in before.items()
        if flatten_signature((d.get('sections') or {}).get('不良反应', '')) and did in by_id
    ]
    crawled_candidates = sorted(did for did in old_sig if did not in used)
    rng = random.Random(args.seed)
    rng.shuffle(crawled_candidates)
    for did in crawled_candidates:
        if sum(1 for it in items if it['batch'] == 'table') >= 20:
            break
        add(by_id[did], 'table', '表格重建（随机）', 'adverse', '旧【不良反应】段含频率表拉平签名')

    plan = {
        'milestone': 'M7',
        'createdAt': datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z'),
        'seed': args.seed,
        'method': 'M7 三条缺陷分层抽样：表格重建 20 / 跨段泄漏 8 / 批准文号 6 / 商品名 6',
        'totalReviewed': sum(1 for it in items if before.get(it['drugId'], {}).get('curationStatus') == 'reviewed'),
        'count': len(items),        'items': items,
    }
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / 'plan.json').write_text(json.dumps(plan, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (args.out / 'plan.ids.txt').write_text('\n'.join(it['drugId'] for it in items) + '\n', encoding='utf-8')

    print(f'✅ M7 抽检计划：{len(items)} 行 → {args.out / "plan.json"}')
    for batch in ('cross', 'approval', 'brand', 'table'):
        subset = [it for it in items if it['batch'] == batch]
        print(f'   {batch}: {len(subset)}')
        for it in subset[:3]:
            print(f'      {it["drugId"]}  [{it["focusLabel"]}] {it["focusNote"]}')
    missing = [kw for kw, _f, _n in CROSS_SAMPLES if not any(kw in it['genericName'] for it in items)]
    if missing:
        print(f'⚠️ 未找到样本：{missing}', file=__import__('sys').stderr)
    return 0


if __name__ == '__main__':
    if hasattr(__import__('sys').stdout, 'reconfigure'):
        __import__('sys').stdout.reconfigure(encoding='utf-8')
    raise SystemExit(main())
