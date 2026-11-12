#!/usr/bin/env python3
"""生成 reviewed 批次抽检 plan（M6-T9 后续）。

输入：`npm run db:review-export -- --status reviewed --out reviewed.json` 导出的快照。
输出：`spotcheck_page.py --plan` 所需的 plan.json，以及抽中 drugId 清单（供再次导出精简快照）。

口径（确定性、可复现，全部字段可从快照判定）：
- 分层随机：按 productType 分层，层内以固定 seed 随机抽取，样本数默认 15；
- 风险补充：不占随机名额，按风险等级补抽，默认最多 5 份；
  风险来源 = 无核对留档 / 核对时有修正 / 必核段源文缺段 / 多批准文号合并 PDF / 注射剂或生物制品；
- 焦点段轮换：每份随机项除必看的用法用量外，再轮换一个段（适应症/禁忌/注意事项/不良反应/相互作用）。

完整流程（导出在 app/packages/api，其余在仓库根）：
  1. cd app/packages/api && npm run db:review-export -- --status reviewed \
       --out ../../../data/review-batches/spotcheck-15/reviewed.json
  2. python tools/manual-pdf/spotcheck_plan.py \
       --data data/review-batches/spotcheck-15/reviewed.json \
       --out data/review-batches/spotcheck-15/plan.json --sample 15 --seed 20261112
  3. cd app/packages/api && npm run db:review-export -- --status reviewed \
       --ids-file ../../../data/review-batches/spotcheck-15/plan.ids.txt \
       --out ../../../data/review-batches/spotcheck-15/export.json
  4. python tools/manual-pdf/spotcheck_page.py \
       --data data/review-batches/spotcheck-15/export.json \
       --plan data/review-batches/spotcheck-15/plan.json \
       --pdf-dir C:/Users/Pan/Desktop/manuals --out data/review-batches/spotcheck-15
"""
from __future__ import annotations

import argparse
import json
import random
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REQUIRED_SECTIONS = [
    ('indication', '适应症/功能主治', ['适应症', '功能主治']),
    ('contraindication', '禁忌', ['禁忌']),
    ('precautions', '注意事项', ['注意事项']),
    ('adverse', '不良反应', ['不良反应']),
    ('interactions', '药物相互作用', ['药物相互作用']),
    ('dosage', '用法用量', ['用法用量', '用法与用量']),
]
SECTION_LABEL = {key: label for key, label, _ in REQUIRED_SECTIONS}
FOCUS_ROTATION = ['indication', 'contraindication', 'precautions', 'adverse', 'interactions']

RISK_LABEL = {
    5: '无核对留档（reviewedBy/reviewMeta 缺失），需确认确实人工核过',
    4: '核对时做过段修正，复查修正后的正文',
    3: '必核段源文缺段，复核「源文确无此段」的判定',
    2: '多批准文号合并 PDF，复核标签与文号对应',
    1: '注射剂/生物制品，高风险剂型',
}


def has_section(item: dict[str, Any], keys: list[str]) -> bool:
    sections = item.get('sourceSections') or {}
    return any((sections.get(key) or '').strip() for key in keys)


def risk_of(item: dict[str, Any]) -> tuple[int, list[str]]:
    review = item.get('review') or {}
    meta = review.get('reviewMeta') or {}
    reasons: list[str] = []
    level = 0

    if not review.get('reviewedBy') or not meta:
        level = max(level, 5)
        reasons.append(RISK_LABEL[5])
    if (meta.get('corrections') or []):
        level = max(level, 4)
        reasons.append(RISK_LABEL[4])
    missing = [label for key, label, keys in REQUIRED_SECTIONS if not has_section(item, keys)]
    if missing:
        level = max(level, 3)
        reasons.append(f"{RISK_LABEL[3]}：{'、'.join(missing)}")
    if len(item.get('identity', {}).get('approvalNumbers') or []) > 1:
        level = max(level, 2)
        reasons.append(RISK_LABEL[2])
    if '注射' in (item.get('identity', {}).get('form') or '') or \
            item.get('identity', {}).get('productType') == '生物制品':
        level = max(level, 1)
        reasons.append(RISK_LABEL[1])
    return level, reasons


def quota_by_layer(groups: dict[str, list[dict[str, Any]]], sample: int) -> dict[str, int]:
    """按层大小分配样本（最大余数法）；层数超过样本时取最大层各 1。"""
    if sample >= sum(len(v) for v in groups.values()):
        return {k: len(v) for k, v in groups.items()}
    if sample < len(groups):
        biggest = sorted(groups, key=lambda k: (-len(groups[k]), k))[:sample]
        return {k: 1 for k in biggest}
    total = sum(len(v) for v in groups.values())
    raw = {k: sample * len(v) / total for k, v in groups.items()}
    quotas = {k: max(1, int(v)) for k, v in raw.items()}
    while sum(quotas.values()) > sample:
        candidates = [k for k in quotas if quotas[k] > 1]
        if not candidates:
            break
        k = max(candidates, key=lambda x: (quotas[x] - raw[x], quotas[x]))
        quotas[k] -= 1
    while sum(quotas.values()) < sample:
        candidates = [k for k in quotas if quotas[k] < len(groups[k])]
        if not candidates:
            break
        k = max(candidates, key=lambda x: (raw[x] - quotas[x], len(groups[x])))
        quotas[k] += 1
    return {k: quotas[k] for k in groups}


def main() -> int:
    parser = argparse.ArgumentParser(description='生成 reviewed 抽检 plan')
    parser.add_argument('--data', type=Path, required=True, help='review-export --status reviewed 的 JSON')
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--sample', type=int, default=15)
    parser.add_argument('--seed', type=int, default=20261112)
    parser.add_argument('--risk-max', type=int, default=5)
    args = parser.parse_args()

    if args.sample <= 0:
        print('[ERROR] --sample 必须大于 0')
        return 1
    payload = json.loads(args.data.read_text(encoding='utf-8'))
    items = payload.get('items') or []
    if payload.get('status') != 'reviewed':
        print(f"[ERROR] 输入快照 status={payload.get('status')}，请先用 --status reviewed 导出")
        return 1
    if not items:
        print('[ERROR] 快照中没有 reviewed 记录，无法抽检')
        return 1

    seen: set[str] = set()
    for item in items:
        drug_id = item.get('drugId')
        if not drug_id or drug_id in seen:
            print(f'[ERROR] drugId 缺失或重复：{drug_id}')
            return 1
        seen.add(drug_id)

    rng = random.Random(args.seed)
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in items:
        groups[item.get('identity', {}).get('productType') or '未标注'].append(item)

    quotas = quota_by_layer(groups, min(args.sample, len(items)))
    picked: list[dict[str, Any]] = []
    for layer in sorted(quotas):
        pool = sorted(groups[layer], key=lambda x: x['drugId'])
        picked.extend(rng.sample(pool, quotas[layer]))

    # 风险补充：按等级从高到低补，不占随机名额
    picked_ids = {item['drugId'] for item in picked}
    risk_ranked = []
    for item in items:
        if item['drugId'] in picked_ids:
            continue
        level, reasons = risk_of(item)
        if level > 0:
            risk_ranked.append((level, item['drugId'], item, reasons))
    risk_ranked.sort(key=lambda row: (-row[0], row[1]))
    risk_picked = risk_ranked[:max(0, args.risk_max)]

    # 批次：按核对日期分组
    dates = sorted({(item.get('review') or {}).get('reviewedAt') or '' for item in items})
    date_batches = {d: f'b{i + 1}' for i, d in enumerate(dates)}

    def plan_item(item: dict[str, Any], index: int, risk_reasons: list[str]) -> dict[str, Any]:
        reviewed_at = (item.get('review') or {}).get('reviewedAt') or ''
        day = reviewed_at[:10]
        focus = FOCUS_ROTATION[index % len(FOCUS_ROTATION)]
        return {
            'drugId': item['drugId'],
            'insertId': item['insertId'],
            'batch': date_batches.get(day, 'unknown'),
            'batchLabel': f'{day or "未记录日期"} 批',
            'focusSection': focus,
            'focusLabel': SECTION_LABEL[focus],
            'multiLabel': len(item.get('identity', {}).get('approvalNumbers') or []) > 1,
            'risk': bool(risk_reasons),
            'riskReason': '；'.join(risk_reasons),
            'productType': item.get('identity', {}).get('productType'),
            'reviewedAt': reviewed_at or None,
        }

    plan_items = [plan_item(item, i, []) for i, item in enumerate(picked)]
    plan_items += [plan_item(row[2], len(picked) + i, row[3]) for i, row in enumerate(risk_picked)]

    plan = {
        'schemaVersion': 1,
        'seed': args.seed,
        'method': '分层随机（productType）+ 风险补充；焦点段轮换',
        'totalReviewed': len(items),
        'sampleSize': len(picked),
        'riskSize': len(risk_picked),
        'createdAt': datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z'),
        'items': plan_items,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    ids_path = args.out.with_suffix('.ids.txt')
    ids_path.write_text('\n'.join(item['drugId'] for item in plan_items) + '\n', encoding='utf-8')

    by_layer = Counter((item.get('identity') or {}).get('productType') or '未标注' for item in picked)
    by_focus = Counter(item['focusLabel'] for item in plan_items if not item['risk'])
    print(f'[OK] 抽检 plan：{args.out}')
    print(f'   随机 {len(picked)} 份 / 风险补充 {len(risk_picked)} 份 · 已 reviewed {len(items)} 条 · seed {args.seed}')
    print(f'   分层：{", ".join(f"{k} {v}" for k, v in by_layer.items())}')
    print(f'   焦点段：{", ".join(f"{k} {v}" for k, v in by_focus.items())}')
    if plan_items:
        print(f'   drugId 清单：{ids_path}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
