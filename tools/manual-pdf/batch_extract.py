#!/usr/bin/env python3
"""分批把 NMPA 说明书 PDF 抽成草稿，并按 census manifest 消歧 drugId。

extract.py 的自动 drugId 只看单个 PDF，批量写同一目录时同名会互相覆盖；
本脚本每份 PDF 先抽到独立临时目录，再按 manifest 的 proposedDrugId 改名落盘。
只处理 status=importable 的行；缺核心段落的 PDF 默认跳过（留在 review）。

用法（仓库根目录）：
  python tools/manual-pdf/batch_extract.py --pdf-dir D:/manuals \
      --manifest data/manuals-manifest.jsonl --out data/manuals-incoming \
      --start 0 --limit 100
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import extract as ex  # noqa: E402

CORE_SECTIONS = ('用法用量', '适应症/功能主治')


def main() -> int:
    parser = argparse.ArgumentParser(description='分批抽取说明书 PDF 并按 manifest 消歧')
    parser.add_argument('--pdf-dir', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--start', type=int, default=0)
    parser.add_argument('--limit', type=int, default=100)
    parser.add_argument('--include-missing-core', action='store_true',
                        help='连缺用法用量/适应症的 PDF 一起抽（默认跳过）')
    args = parser.parse_args()

    rows = [json.loads(line) for line in args.manifest.open(encoding='utf-8') if line.strip()]
    by_file: dict[str, list[dict]] = {}
    for row in rows:
        if row['status'] == 'importable':
            by_file.setdefault(row['sourceFile'], []).append(row)
    files = sorted(by_file)
    if not args.include_missing_core:
        files = [f for f in files if not any(
            any(sec in row['missingSections'] for sec in CORE_SECTIONS) for row in by_file[f]
        )]
    chunk = files[args.start:args.start + args.limit]
    if not chunk:
        print(f'空批次：总文件 {len(files)}，start={args.start}', file=sys.stderr)
        return 1

    args.out.mkdir(parents=True, exist_ok=True)
    errors: list[str] = []
    written = 0
    for name in chunk:
        expected = {(r['sourceFile'], r['specification']): r['proposedDrugId'] for r in by_file[name]}
        with tempfile.TemporaryDirectory() as tmp:
            try:
                paths = ex.extract(args.pdf_dir / name, Path(tmp), None)
            except Exception as exc:  # 失败必须可见，不静默跳过
                errors.append(f'{name}: 提取失败 — {exc}')
                continue
            if len(paths) != len(expected):
                errors.append(f'{name}: 草稿 {len(paths)} 份 != 清单 {len(expected)} 行')
                continue
            for path in paths:
                draft = json.loads(path.read_text(encoding='utf-8'))
                key = (draft['sourceFile'], draft['specification'])
                if key not in expected:
                    errors.append(f'{name}: 规格对不上清单 — {draft["specification"]}')
                    continue
                draft['drugId'] = expected[key]
                target = args.out / f'{draft["drugId"]}.json'
                if target.exists():
                    errors.append(f'{name}: 目标草稿已存在 — {target.name}')
                    continue
                target.write_text(json.dumps(draft, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
                written += 1

    print(f'本批 PDF {len(chunk)} 份 / 草稿 {written} 份 / 失败 {len(errors)}')
    for err in errors:
        print(f'  ❌ {err}', file=sys.stderr)
    return 0 if not errors else 1


if __name__ == '__main__':
    raise SystemExit(main())
