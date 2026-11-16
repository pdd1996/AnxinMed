#!/usr/bin/env python3
"""合并两份 review-export 输出（crawled + reviewed）为一份 export.json（供 spotcheck_page.py）。"""
from __future__ import annotations

import json
import sys
from pathlib import Path

out = Path(sys.argv[1])
sources = [Path(p) for p in sys.argv[2:]]
items = []
meta = {}
for src in sources:
    payload = json.loads(src.read_text(encoding='utf-8'))
    items.extend(payload.get('items') or [])
    for key, value in payload.items():
        if key == 'items':
            continue
        meta.setdefault(key, value)
meta['items'] = items
out.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'out': str(out), 'items': len(items)}, ensure_ascii=False))
