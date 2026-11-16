#!/usr/bin/env python3
"""把抽检 plan.ids.txt 按库内 curation_status 拆成 crawled / reviewed 两个 ids 文件（导出用）。"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ids = [line.strip() for line in Path(sys.argv[1]).read_text(encoding='utf-8').splitlines() if line.strip()]
statuses = {}
for line in Path(sys.argv[2]).read_text(encoding='utf-8').splitlines():
    if '|' not in line:
        continue
    did, status = line.split('|', 1)
    statuses[did] = status
out_dir = Path(sys.argv[3])
crawled = [i for i in ids if statuses.get(i) == 'crawled']
reviewed = [i for i in ids if statuses.get(i) == 'reviewed']
missing = [i for i in ids if i not in statuses]
(out_dir / 'crawled.ids.txt').write_text('\n'.join(crawled) + '\n', encoding='utf-8')
(out_dir / 'reviewed.ids.txt').write_text('\n'.join(reviewed) + '\n', encoding='utf-8')
print(json.dumps({'total': len(ids), 'crawled': len(crawled), 'reviewed': len(reviewed), 'missing': missing},
                 ensure_ascii=False, indent=2))
