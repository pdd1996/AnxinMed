#!/usr/bin/env python3
"""生成离线抽检页（M6-T9 后续）。

输入 review-export --status reviewed 导出的 JSON 与采样 plan：
- 按该行批准文号定位多批准文号合并 PDF 中的正确标签；
- 截取身份区、6 个必核段的源文原图（默认只看用法用量 + 轮换段，其余可展开）；
- 输出 review.html，供人工快速确认口径、标记存疑并导出 verdicts。

用法（仓库根目录）：
  python tools/manual-pdf/spotcheck_page.py \
      --data data/review-batches/spotcheck-15/export.json \
      --plan data/review-batches/spotcheck-15/plan.json \
      --pdf-dir D:/manuals --out data/review-batches/spotcheck-15
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import unicodedata
from pathlib import Path

import fitz

REQUIRED = [
    {'key': 'indication', 'label': '适应症/功能主治', 'sourceKeys': ['适应症', '功能主治']},
    {'key': 'contraindication', 'label': '禁忌', 'sourceKeys': ['禁忌']},
    {'key': 'precautions', 'label': '注意事项', 'sourceKeys': ['注意事项']},
    {'key': 'adverse', 'label': '不良反应', 'sourceKeys': ['不良反应']},
    {'key': 'interactions', 'label': '药物相互作用', 'sourceKeys': ['药物相互作用']},
    {'key': 'dosage', 'label': '用法用量', 'sourceKeys': ['用法用量', '用法与用量']},
]

CANON_HEADINGS = [
    '药品名称', '成份', '成分', '性状', '适应症', '功能主治', '规格', '用法用量', '用法与用量',
    '禁忌', '不良反应', '注意事项', '孕妇及哺乳期妇女用药', '孕妇和哺乳期妇女用药',
    '儿童用药', '老年用药', '药物相互作用', '药物过量', '药理毒理', '药理作用', '药代动力学',
    '贮藏', '储存', '包装', '有效期', '执行标准', '批准文号', '生产企业', '警示语',
    '核准日期', '修改日期', '药品说明书',
]


def norm(text: str | None) -> str:
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', text or ''))


def resolve(item: dict, slot: dict) -> tuple[str, str | None]:
    for key in slot['sourceKeys']:
        text = item['sourceSections'].get(key, '')
        if text and text.strip():
            return text, key
    return item['mapped'].get(slot['key'], ''), None


def page_texts(doc: fitz.Document) -> list[str]:
    return [page.get_text() for page in doc]


def heading_rects(page: fitz.Page, has_bracket: bool, names: list[str]) -> list[tuple[fitz.Rect, str]]:
    out = []
    for name in names:
        patterns = [f'【{name}】']
        if not has_bracket:
            patterns.append(name)
        for pattern in patterns:
            for rect in page.search_for(pattern):
                out.append((rect, name))
    return out


def pick_heading(page: fitz.Page, has_bracket: bool, names: list[str], body_rect: fitz.Rect | None):
    candidates = heading_rects(page, has_bracket, names)
    if not candidates:
        return None, None
    if body_rect is not None:
        above = [c for c in candidates if c[0].y0 <= body_rect.y0 + 2]
        if above:
            return max(above, key=lambda c: c[0].y0)
    return min(candidates, key=lambda c: c[0].y0)


def body_rect_for(page: fitz.Page, text: str) -> fitz.Rect | None:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    probes = []
    for line in lines[:3]:
        if len(line) >= 8:
            probes.append(line[:28])
    if lines:
        first = norm(lines[0])
        if len(first) >= 8:
            probes.append(first[:16])
    for probe in probes:
        rects = page.search_for(probe)
        if rects:
            return rects[0]
    return None


def section_probes(text: str) -> list[str]:
    """按特异性排序：整段开头 > 首行 > 次行 > 最长行 > 中段。"""
    body = norm(text)
    lines = [line.strip() for line in text.splitlines() if len(norm(line)) >= 4]
    probes = []
    if len(body) >= 8:
        probes.append(body[:40])
    if lines:
        probes.append(norm(lines[0])[:30])
        if len(lines) > 1:
            probes.append(norm(lines[1])[:30])
        longest = max(lines, key=lambda line: len(norm(line)))
        probes.append(norm(longest)[:30])
    if len(body) > 80:
        probes.append(body[len(body) // 2:len(body) // 2 + 40])
    return list(dict.fromkeys(probe for probe in probes if len(probe) >= 4))


def find_section_page(norms: list[str], text: str, approvals: list[str]) -> tuple[int | None, str, str]:
    body = norm(text)
    if len(body) < 8:
        return None, 'short', ''
    probes = section_probes(text)
    if not probes:
        return None, 'missing', ''
    approval_pages = [i for i, page in enumerate(norms) if any(norm(a) and norm(a) in page for a in approvals)]

    for probe in probes:
        hits = [i for i, page in enumerate(norms) if probe in page]
        if not hits:
            continue
        if len(hits) == 1:
            return hits[0], 'unique', probe
        if approval_pages:
            # 多标签 PDF：选离批准文号页最近且不靠后的同名段
            def score(index: int) -> int:
                dist = min(abs(index - ap) for ap in approval_pages)
                return dist if index <= max(approval_pages) else dist + 3
            return min(hits, key=score), 'approval', probe
        return hits[0], 'first', probe
    return None, 'missing', ''


def heading_pages(norms: list[str], slot: dict) -> tuple[list[int], str]:
    bracket = [i for i, page in enumerate(norms) if any(f'【{key}】' in page for key in slot['sourceKeys'])]
    if bracket:
        return bracket, 'bracket'
    plain = [i for i, page in enumerate(norms) if any(norm(key) in page for key in slot['sourceKeys'])]
    return plain, 'plain'


def choose_heading_page(pages: list[int], approval_pages: list[int]) -> int:
    if len(pages) == 1 or not approval_pages:
        return pages[0]
    before = [page for page in pages if page <= max(approval_pages)]
    if before:
        return max(before)
    return min(pages, key=lambda page: min(abs(page - ap) for ap in approval_pages))


def locate_section_page(norms: list[str], slot: dict, text: str, approvals: list[str]) -> tuple[int | None, str]:
    approval_pages = [i for i, page in enumerate(norms) if any(norm(a) and norm(a) in page for a in approvals)]
    pages, kind = heading_pages(norms, slot)
    if pages:
        page = choose_heading_page(pages, approval_pages)
        return page, ('heading-unique' if len(pages) == 1 else f'heading-{kind}')
    page, confidence, _ = find_section_page(norms, text, approvals)
    return page, confidence


def render_crop(page: fitz.Page, rect: fitz.Rect, path: Path, dpi: int) -> None:
    zoom = dpi / 72
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), clip=rect)
    pix.save(path)


def section_image(doc: fitz.Document, page_index: int, text: str, slot: dict, approvals: list[str],
                  names: list[str], assets: Path, stem: str, dpi: int) -> dict:
    page = doc.load_page(page_index)
    page_text = page.get_text()
    has_bracket = '【' in page_text and '】' in page_text
    body_rect = body_rect_for(page, text)
    heading, heading_name = pick_heading(page, has_bracket, slot['sourceKeys'], body_rect)

    if heading is not None:
        start = max(page.rect.y0 + 8, heading.y0 - 5)
        end = page.rect.y1 - 12
        for rect, _ in heading_rects(page, has_bracket, names):
            if rect.y0 > heading.y0 + 4 and rect.y0 - 4 < end:
                end = rect.y0 - 4
        if end - start < 40:
            end = min(page.rect.y1 - 12, start + 110)
    elif body_rect is not None:
        start = max(page.rect.y0 + 8, body_rect.y0 - 28)
        end = min(page.rect.y1 - 12, body_rect.y1 + 420)
    else:
        start, end = page.rect.y0 + 8, min(page.rect.y1 - 12, page.rect.y0 + page.rect.height * 0.6)

    rect = fitz.Rect(page.rect.x0 + 18, start, page.rect.x1 - 18, end)
    image_path = assets / f'{stem}.png'
    render_crop(page, rect, image_path, dpi)
    images = [{'src': f'assets/{image_path.name}', 'label': f'第 {page_index + 1} 页', 'page': page_index + 1}]

    # 段落触底时补一张续页（下一文件页无新标题才截）
    if heading is not None and end >= page.rect.y1 - 20 and page_index + 1 < doc.page_count:
        nxt = doc.load_page(page_index + 1)
        nxt_text = nxt.get_text()
        nxt_bracket = '【' in nxt_text and '】' in nxt_text
        next_heads = heading_rects(nxt, nxt_bracket, names)
        first_head = min((r.y0 for r, _ in next_heads), default=None)
        if first_head is None or first_head > 90:
            cont_end = (first_head - 4) if first_head is not None else nxt.rect.y1 - 12
            cont_rect = fitz.Rect(nxt.rect.x0 + 18, nxt.rect.y0 + 8, nxt.rect.x1 - 18, cont_end)
            cont_path = assets / f'{stem}-cont.png'
            render_crop(nxt, cont_rect, cont_path, dpi)
            images.append({'src': f'assets/{cont_path.name}', 'label': f'第 {page_index + 2} 页（续）', 'page': page_index + 2})

    return {
        'images': images,
        'page': page_index + 1,
        'headingFound': heading is not None,
        'headingName': heading_name,
        'bodyProbeFound': body_rect is not None,
    }


def identity_images(doc: fitz.Document, item: dict, assets: Path, stem: str, dpi: int) -> tuple[list[dict], list[str]]:
    warnings = []
    pages = [page.get_text() for page in doc]
    norms = [norm(text) for text in pages]
    name = item['identity'].get('genericName') or ''
    approvals = [a for a in (item['identity'].get('approvalNumbers') or []) if a]
    name_norm = norm(name)

    approval_pages = [i for i, page in enumerate(norms) if any(norm(a) in page for a in approvals)]
    title_pages = [i for i, page in enumerate(norms) if '【药品名称】' in page]
    if not title_pages:
        title_pages = [i for i, page in enumerate(norms) if name_norm and name_norm in page]
    if title_pages:
        if approval_pages:
            before = [p for p in title_pages if p <= max(approval_pages)]
            id_page = max(before) if before else title_pages[0]
        else:
            id_page = title_pages[0]
    else:
        id_page = approval_pages[0] if approval_pages else 0

    page = doc.load_page(id_page)
    page_text = page.get_text()
    has_bracket = '【' in page_text and '】' in page_text
    body_start_names = ['适应症', '功能主治', '用法用量', '用法与用量']
    starts = [r.y0 for r, _ in heading_rects(page, has_bracket, body_start_names)]
    end = (min(starts) - 4) if starts else page.rect.y0 + page.rect.height * 0.45
    rect = fitz.Rect(page.rect.x0 + 18, page.rect.y0 + 8, page.rect.x1 - 18, max(page.rect.y0 + 120, end))
    path = assets / f'{stem}-identity.png'
    render_crop(page, rect, path, dpi)
    images = [{'src': f'assets/{path.name}', 'label': f'身份区（第 {id_page + 1} 页）', 'page': id_page + 1}]

    spec_rects = page.search_for('【规格】')
    if not spec_rects and not has_bracket:
        spec_rects = page.search_for('规格')
    spec_in_identity = bool(spec_rects) and spec_rects[0].y1 <= end
    if not spec_in_identity:
        spec_pages = [i for i, page_norm in enumerate(norms) if '【规格】' in page_norm]
        if not spec_pages:
            spec_pages = [i for i, page_norm in enumerate(norms) if '规格' in page_norm]
        if spec_pages:
            sp = choose_heading_page(spec_pages, approval_pages)
            spage = doc.load_page(sp)
            sp_text = spage.get_text()
            sp_bracket = '【' in sp_text and '】' in sp_text
            heads = heading_rects(spage, sp_bracket, ['规格'])
            if heads:
                srect = heads[0][0]
                send = spage.rect.y1 - 12
                for r, _ in heading_rects(spage, sp_bracket, CANON_HEADINGS):
                    if r.y0 > srect.y0 + 4 and r.y0 - 4 < send:
                        send = r.y0 - 4
                if send - srect.y0 < 36:
                    send = min(spage.rect.y1 - 12, srect.y0 + 100)
                spec_path = assets / f'{stem}-spec.png'
                render_crop(spage, fitz.Rect(spage.rect.x0 + 18, srect.y0 - 4, spage.rect.x1 - 18, send), spec_path, dpi)
                images.append({'src': f'assets/{spec_path.name}', 'label': f'规格（第 {sp + 1} 页）', 'page': sp + 1})
            else:
                warnings.append('源文未定位到「规格」标题，请人工核对规格')
        else:
            warnings.append('源文未定位到「规格」段，请人工核对规格')

    if approval_pages:
        ap = min(approval_pages, key=lambda p: abs(p - id_page))
        apage = doc.load_page(ap)
        ap_text = apage.get_text()
        ap_bracket = '【' in ap_text and '】' in ap_text
        heads = heading_rects(apage, ap_bracket, ['批准文号', '生产企业'])
        if heads:
            top = min(r.y0 for r, _ in heads) - 5
            bottom = apage.rect.y1 - 12
            later = [r.y0 for r, _ in heads if r.y0 > top + 30]
            if later:
                bottom = min(bottom, min(later) + 120)
            rect2 = fitz.Rect(apage.rect.x0 + 18, max(apage.rect.y0 + 8, top), apage.rect.x1 - 18, bottom)
        else:
            rect2 = fitz.Rect(apage.rect.x0 + 18, apage.rect.y0 + apage.rect.height * 0.65,
                              apage.rect.x1 - 18, apage.rect.y1 - 12)
            warnings.append(f'第 {ap + 1} 页未找到「批准文号」标题，已截取页尾')
        path2 = assets / f'{stem}-approval.png'
        render_crop(apage, rect2, path2, dpi)
        images.append({'src': f'assets/{path2.name}', 'label': f'批准文号/生产企业（第 {ap + 1} 页）', 'page': ap + 1})
    else:
        warnings.append('源文未定位到本行批准文号，请人工核对批准文号与生产企业')

    return images, warnings


def main() -> int:
    parser = argparse.ArgumentParser(description='生成 M6 抽检页')
    parser.add_argument('--data', type=Path, required=True)
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--pdf-dir', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--dpi', type=int, default=120)
    parser.add_argument('--skip-images', action='store_true', help='只生成页面结构（调试用）')
    args = parser.parse_args()

    payload = json.loads(args.data.read_text(encoding='utf-8'))
    plan = json.loads(args.plan.read_text(encoding='utf-8'))
    plan_by_id = {item['drugId']: item for item in plan['items']}
    export_ids = {item['drugId'] for item in payload['items']}
    missing_plan = export_ids - set(plan_by_id)
    missing_export = set(plan_by_id) - export_ids
    if missing_plan or missing_export:
        print(f'[ERROR] plan/export 不一致：缺 plan {sorted(missing_plan)} / 缺 export {sorted(missing_export)}')
        return 1

    payload['plan'] = {
        'seed': plan.get('seed'),
        'method': plan.get('method'),
        'totalReviewed': plan.get('totalReviewed'),
        'createdAt': plan.get('createdAt'),
    }

    args.out.mkdir(parents=True, exist_ok=True)
    assets = args.out / 'assets'
    assets.mkdir(exist_ok=True)
    # 清掉上次生成的页图，避免同名残留
    for old in assets.glob('*.png'):
        old.unlink()

    locate_report = []
    missing = []
    for idx, item in enumerate(payload['items']):
        plan_item = plan_by_id[item['drugId']]
        item['_spotcheck'] = {
            'batch': plan_item['batch'],
            'batchLabel': plan_item['batchLabel'],
            'focusSection': plan_item['focusSection'],
            'focusLabel': plan_item['focusLabel'],
            'multiLabel': plan_item['multiLabel'],
            'risk': bool(plan_item.get('risk')),
            'riskReason': plan_item.get('riskReason') or '',
        }
        item['_source'] = {'identityImages': [], 'sections': {}, 'warnings': []}
        if args.skip_images:
            continue

        pdf = args.pdf_dir / item['sourceFile']
        if not pdf.exists():
            item['_source']['warnings'].append(f'源文 PDF 不存在：{item["sourceFile"]}')
            missing.append(item['sourceFile'])
            continue

        try:
            doc = fitz.open(pdf)
            texts = page_texts(doc)
            norms = [norm(text) for text in texts]
            names = list(dict.fromkeys(CANON_HEADINGS + list(item['sourceSections'].keys())))
            approvals = item['identity'].get('approvalNumbers') or []
            image_list, warns = identity_images(doc, item, assets, f'item-{idx:03d}', args.dpi)
            item['_source']['identityImages'] = image_list
            item['_source']['warnings'].extend(warns)

            for slot in REQUIRED:
                text, source_key = resolve(item, slot)
                entry = {'resolvedFrom': source_key or 'mapped', 'textLength': len(text.strip()), 'images': []}
                if not text.strip():
                    entry.update({'page': None, 'confidence': 'empty'})
                    item['_source']['sections'][slot['key']] = entry
                    continue
                page_index, confidence = locate_section_page(norms, slot, text, approvals)
                if page_index is None:
                    page_index = 0
                    confidence = 'page-fallback'
                    item['_source']['warnings'].append(f'{slot["label"]}：源文正文与标题均未定位，已退回第 1 页')
                entry.update(section_image(
                    doc, page_index, text, slot, approvals, names, assets,
                    f'item-{idx:03d}-{slot["key"]}', args.dpi,
                ))
                entry['confidence'] = confidence
                item['_source']['sections'][slot['key']] = entry
                locate_report.append({
                    'drugId': item['drugId'],
                    'name': item['identity']['genericName'],
                    'section': slot['label'],
                    'page': entry['page'],
                    'confidence': confidence,
                    'headingFound': entry['headingFound'],
                    'bodyProbeFound': entry['bodyProbeFound'],
                })
            doc.close()
        except Exception as exc:  # 失败必须可见，不静默跳过
            item['_source']['warnings'].append(f'页图生成失败：{exc}')
            missing.append(f'{item["sourceFile"]}（{exc}）')

    template = Path(__file__).with_name('spotcheck_template.html')
    shutil.copyfile(template, args.out / 'review.html')
    (args.out / 'review-data.js').write_text(
        'window.SPOTCHECK_DATA = ' + json.dumps(payload, ensure_ascii=False).replace('</', '<\\/') + ';\n',
        encoding='utf-8',
    )
    (args.out / 'locate-report.json').write_text(
        json.dumps(locate_report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    total = sum(p.stat().st_size for p in args.out.rglob('*') if p.is_file())
    print(f'[OK] 抽检页：{args.out / "review.html"}')
    print(f'   条目 {len(payload["items"])} 份 / 页图 {sum(len(i["_source"]["identityImages"]) + sum(len(s["images"]) for s in i["_source"]["sections"].values()) for i in payload["items"])} 张 / 大小 {total / 1024 / 1024:.1f} MB')
    low = [r for r in locate_report if r['confidence'] in ('heading-fallback', 'page-fallback', 'missing')]
    if low:
        print(f'[WARN] {len(low)} 段定位降级：')
        for row in low[:12]:
            print(f'   {row["name"]} · {row["section"]} · {row["confidence"]} · 第 {row["page"]} 页')
    if missing:
        print(f'[WARN] {len(missing)} 份未生成页图：')
        for name in missing:
            print(f'   {name}')
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
