#!/usr/bin/env python3
"""M7 全库重提取（只重抽已入库的 PDF，不新增药品）——产出 staging 草稿与映射表。

背景：M6 关账带三条提取缺陷（表格拉平 / 批准文号未按规格归属 / 商品名标签变体），
提取器已在 M7-T1~T3 修好。本脚本把 `data/manuals` 现有 1588 行的来源 PDF 重新抽一遍，
写进 `data/manuals-incoming-m7/`（本地，不入库），并尽量**沿用原 drugId**：

  1. 先按 (sourceFile, 规格归一化) 精确匹配 → 沿用原 drugId；
  2. 再按 (sourceFile, 规格数值集合) 匹配 → 沿用（单位换算：0.15g ≡ 150mg）；
  3. 同一 PDF 只剩一对一 → 视为规格文本变化，沿用原 drugId（T5 走改名/改规格审计）；
  4. 其余 → 用提取器自动 drugId，并保证全局唯一。

映射与异常全部落到 `data/m7-reports/reextract-map.jsonl`（本地），供 diff 与落库脚本使用。
只会处理「现有草稿出现过的 sourceFile」，D:/manuals 里新增/未入库的 PDF 不在 M7 范围。

提取阶段按进程并行（Windows 用 spawn）；每个 worker 先写临时 JSON，父进程再统一分配 drugId，
避免并行写同一输出目录时的 ID 竞争。

用法（仓库根目录）：
  python tools/manual-pdf/m7_reextract.py --pdf-dir D:/manuals \
      --existing data/manuals --out data/manuals-incoming-m7 \
      --map data/m7-reports/reextract-map.jsonl [--workers 4] [--limit N] [--start N]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
import time
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import extract as ex  # noqa: E402

CIRCLED_RE = re.compile(r'[①-⑳]')
LEADING_MARKER_RE = re.compile(r'^[\(（]\s*\d{1,2}\s*[\)）]\s*|^\d{1,2}\s*[\)）.、]\s*')


def spec_key(spec: str) -> str:
    """规格匹配键：去圈码/编号/空白/尾标点，只留数值+单位+中文描述。"""
    s = CIRCLED_RE.sub('', str(spec or ''))
    s = LEADING_MARKER_RE.sub('', s)
    s = re.sub(r'\s+', '', s)
    return s.strip('；;。，,、')


def strength_key(spec: str) -> tuple[str, ...]:
    """规格数值集合键（含单位换算）；无强度 token 时退回 spec_key。"""
    tokens = ex.canonical_strengths(spec)
    return tuple(sorted(tokens)) if tokens else ('spec:' + spec_key(spec),)


def load_existing(drafts_dir: Path) -> dict[str, list[dict]]:
    by_file: dict[str, list[dict]] = defaultdict(list)
    for path in sorted(drafts_dir.glob('*.json')):
        draft = json.loads(path.read_text(encoding='utf-8'))
        draft['_draftPath'] = str(path)
        by_file[draft['sourceFile']].append(draft)
    return by_file


def unique_id(base: str, used: set[str]) -> str:
    candidate = base
    n = 1
    while candidate in used:
        candidate = f'{base}-m7{n}'
        n += 1
    used.add(candidate)
    return candidate


def assign_ids(old_rows: list[dict], new_drafts: list[dict], used_ids: set[str]) -> tuple[dict[int, dict], list[dict]]:
    """把新草稿对到旧行上；返回 {新草稿序号: {drugId, match, old}} 与未匹配旧行。"""
    old_by_spec: dict[str, dict] = {}
    for row in old_rows:
        old_by_spec.setdefault(spec_key(row['specification']), row)
    assignments: dict[int, dict] = {}
    taken_old: set[str] = set()

    pending: list[int] = []
    for i, draft in enumerate(new_drafts):
        row = old_by_spec.get(spec_key(draft['specification']))
        if row is not None and row['drugId'] not in taken_old:
            assignments[i] = {'drugId': row['drugId'], 'match': 'spec', 'old': row}
            taken_old.add(row['drugId'])
        else:
            pending.append(i)

    # 2) 数值集合匹配（单位换算后）
    if pending:
        old_by_strength: dict[tuple, list[dict]] = defaultdict(list)
        for row in old_rows:
            if row['drugId'] not in taken_old:
                old_by_strength[strength_key(row['specification'])].append(row)
        still_pending = []
        for i in pending:
            key = strength_key(new_drafts[i]['specification'])
            candidates = [r for r in old_by_strength.get(key, []) if r['drugId'] not in taken_old]
            if len(candidates) == 1:
                row = candidates[0]
                assignments[i] = {'drugId': row['drugId'], 'match': 'strength', 'old': row}
                taken_old.add(row['drugId'])
            else:
                still_pending.append(i)
        pending = still_pending

    # 3) 一对一兜底：视为规格文本变化
    leftovers = [row for row in old_rows if row['drugId'] not in taken_old]
    if pending and len(pending) == 1 and len(leftovers) == 1:
        row = leftovers[0]
        assignments[pending[0]] = {'drugId': row['drugId'], 'match': 'spec-changed', 'old': row}
        taken_old.add(row['drugId'])
        pending = []

    # 4) 其余：用提取器生成的 drugId（全局唯一化）
    for i in pending:
        assignments[i] = {'drugId': unique_id(new_drafts[i]['drugId'], used_ids), 'match': 'new', 'old': None}

    unmatched_old = [row for row in old_rows if row['drugId'] not in taken_old]
    return assignments, unmatched_old


def _extract_worker(job: tuple[int, str, str, str]) -> dict:
    """子进程：抽一份 PDF 写到临时 JSON（不解析 drugId，父进程统一分配）。"""
    idx, pdf_path, raw_dir, file_name = job
    import json as _json
    from pathlib import Path as _Path

    import extract as _ex

    audit: dict = {}
    try:
        with tempfile.TemporaryDirectory() as tmp:
            paths = _ex.extract(_Path(pdf_path), _Path(tmp), 'drug-m7tmp', audit=audit)
            drafts = [_json.loads(p.read_text(encoding='utf-8')) for p in paths]
    except Exception as exc:  # 失败必须可见，由父进程汇总
        return {'idx': idx, 'file': file_name, 'error': repr(exc), 'count': 0,
                'tables': 0, 'merged': 0, 'fallbacks': 0}
    raw_file = _Path(raw_dir) / f'{idx:05d}.json'
    raw_file.write_text(_json.dumps(drafts, ensure_ascii=False), encoding='utf-8')
    return {'idx': idx, 'file': file_name, 'error': None, 'count': len(drafts),
            'tables': audit.get('tables', 0), 'merged': audit.get('mergedContinuations', 0),
            'fallbacks': audit.get('fallbacks', [])}


def main() -> int:
    parser = argparse.ArgumentParser(description='M7 全库重提取（staging，并行）')
    parser.add_argument('--pdf-dir', type=Path, required=True)
    parser.add_argument('--existing', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--map', type=Path, required=True)
    parser.add_argument('--workers', type=int, default=max(2, min(8, (os.cpu_count() or 4) - 1)))
    parser.add_argument('--start', type=int, default=0)
    parser.add_argument('--limit', type=int, default=0, help='0 = 全量')
    args = parser.parse_args()

    old_by_file = load_existing(args.existing)
    if args.out.resolve() == args.existing.resolve():
        print('❌ --out 不能等于 --existing（会覆盖草稿池）', file=sys.stderr)
        return 1
    files = sorted(old_by_file)
    if args.limit:
        files = files[args.start:args.start + args.limit]
    elif args.start:
        files = files[args.start:]
    if not files:
        print('❌ 没有可处理的 PDF（--existing 目录里没有草稿？）', file=sys.stderr)
        return 1

    args.out.mkdir(parents=True, exist_ok=True)
    for stale in args.out.glob('*.json'):  # 清掉上一轮 staging，避免新旧混在一起
        stale.unlink()
    args.map.parent.mkdir(parents=True, exist_ok=True)
    used_ids = {row['drugId'] for rows in old_by_file.values() for row in rows}

    errors: list[str] = []
    stats = {'files': 0, 'rows': 0, 'matchedSpec': 0, 'matchedStrength': 0, 'specChanged': 0,
             'newIds': 0, 'deletedOld': 0, 'tables': 0, 'merged': 0, 'fallbacks': 0, 'fallbackRows': 0}
    started = time.perf_counter()

    with tempfile.TemporaryDirectory() as raw_dir:
        jobs = [(i, str(args.pdf_dir / name), raw_dir, name) for i, name in enumerate(files)]
        results: dict[int, dict] = {}
        with ProcessPoolExecutor(max_workers=args.workers) as pool:
            futures = {pool.submit(_extract_worker, job): job[0] for job in jobs}
            done = 0
            for future in as_completed(futures):
                result = future.result()
                results[result['idx']] = result
                done += 1
                if result['error']:
                    errors.append(f"{result['file']}: 提取失败 — {result['error']}")
                else:
                    stats['tables'] += result['tables']
                    stats['merged'] += result['merged']
                    stats['fallbacks'] += len(result['fallbacks'])
                    stats['fallbackRows'] += 1 if result['fallbacks'] else 0
                if done % 50 == 0 or done == len(files):
                    elapsed = time.perf_counter() - started
                    print(f'  [抽取 {done}/{len(files)}] 表格 {stats["tables"]} / 跨页合并 {stats["merged"]}'
                          f' / 回退 {stats["fallbacks"]} / 失败 {len(errors)} / {elapsed:.0f}s', flush=True)

        map_rows: list[dict] = []
        for idx, file_name in enumerate(files):
            result = results.get(idx)
            if result is None or result['error']:
                continue
            drafts = json.loads((Path(raw_dir) / f'{idx:05d}.json').read_text(encoding='utf-8'))
            old_rows = old_by_file[file_name]
            assignments, unmatched_old = assign_ids(old_rows, drafts, used_ids)
            for row in unmatched_old:
                stats['deletedOld'] += 1
                map_rows.append({'kind': 'deleted-old', 'sourceFile': file_name, 'drugId': row['drugId'],
                                 'specification': row['specification']})
            for i, draft in enumerate(drafts):
                info = assignments[i]
                old = info['old']
                stats[{'spec': 'matchedSpec', 'strength': 'matchedStrength',
                       'spec-changed': 'specChanged', 'new': 'newIds'}[info['match']]] += 1
                draft['drugId'] = info['drugId']
                draft['drugIdMatch'] = info['match']
                (args.out / f"{draft['drugId']}.json").write_text(
                    json.dumps(draft, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
                map_rows.append({
                    'kind': 'draft',
                    'sourceFile': file_name,
                    'drugId': info['drugId'],
                    'match': info['match'],
                    'newSpec': draft['specification'],
                    'oldDrugId': old['drugId'] if old else None,
                    'oldSpec': old['specification'] if old else None,
                    'brandName': draft['brandName'],
                    'approvalNumbers': draft['approvalNumbers'],
                    'extractorVersion': draft['extractorVersion'],
                    'tables': result['tables'],
                    'mergedContinuations': result['merged'],
                    'fallbacks': result['fallbacks'],
                })
                stats['rows'] += 1
            stats['files'] += 1

    with args.map.open('w', encoding='utf-8') as fh:
        for row in map_rows:
            fh.write(json.dumps(row, ensure_ascii=False) + '\n')

    print('\n✅ 重提取完成')
    print(f'   PDF {stats["files"]} 份 / 草稿行 {stats["rows"]} 行')
    print(f'   匹配：规格精确 {stats["matchedSpec"]} / 数值集合 {stats["matchedStrength"]}'
          f' / 规格变化 {stats["specChanged"]} / 新 ID {stats["newIds"]} / 旧行消失 {stats["deletedOld"]}')
    print(f'   表格 {stats["tables"]} 张 / 跨页合并 {stats["merged"]} / 覆盖率回退 {stats["fallbacks"]}（{stats["fallbackRows"]} 份 PDF）')
    print(f'   映射表：{args.map}')
    if errors:
        print(f'\n⚠️ {len(errors)} 份失败：', file=sys.stderr)
        for err in errors[:50]:
            print(f'   ❌ {err}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    raise SystemExit(main())
