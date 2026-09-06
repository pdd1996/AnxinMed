# PaddleOCR 自托管实测（M1-T11 候选 A）。
# 对合成打印体处方笺跑 PP-OCRv4，评估：中文识别准确率（医嘱行重点）、字符级置信度 + 坐标可用性（硬要求）、端到端耗时。
# 运行：python tools/ocr-bench/bench_paddle.py
import difflib
import json
import os
import re
import time

HERE = os.path.dirname(os.path.abspath(__file__))
# Windows CPU + PaddlePaddle 3.x 的 oneDNN/PIR 兼容问题（onednn_instruction.cc NotImplementedError）：
# 关闭 mkldnn 走原生 CPU kernel。必须在 import paddle 之前设置。
os.environ.setdefault("FLAGS_use_mkldnn", "0")
os.environ.setdefault("FLAGS_enable_pir_api", "0")
os.environ.setdefault("FLAGS_enable_pir_in_executor", "0")
IMG = os.path.join(HERE, "sample-prescription.png")
GT = json.load(open(os.path.join(HERE, "ground-truth.json"), encoding="utf-8"))


def norm(raw):
    """把 paddleocr 2.x / 3.x 的返回统一为 [(text, conf, poly)]。"""
    items = []
    if isinstance(raw, list) and raw and isinstance(raw[0], dict) and "rec_texts" in raw[0]:
        for r in raw:  # 3.x (PaddleX)
            for t, s, p in zip(r.get("rec_texts", []), r.get("rec_scores", []), r.get("dt_polys", [])):
                items.append((t, s, p))
    else:
        for page in raw:  # 2.x
            if not page:
                continue
            for line in page:
                box, (text, conf) = line[0], line[1]
                items.append((text, conf, box))
    return items


def _norm_ws(s):
    return re.sub(r"\s+", "", s)


def line_accuracy(gt_lines, texts):
    """OCR 会压缩/丢失多余空白，故比较前去除所有空白（对 OCR 公平）。"""
    ratios = []
    exact = 0
    nt = [_norm_ws(t) for t in texts]
    for g in gt_lines:
        gn = _norm_ws(g)
        best = max((difflib.SequenceMatcher(None, gn, t).ratio() for t in nt), default=0.0)
        ratios.append(best)
        if any(t == gn for t in nt):
            exact += 1
    return (sum(ratios) / len(ratios) if ratios else 0.0), exact


def main():
    t_init0 = time.perf_counter()
    from paddleocr import PaddleOCR

    try:
        # 优先在 PaddleX 配置级关 oneDNN（绕过 Windows CPU 的 PIR/oneDNN bug）
        ocr = PaddleOCR(lang="ch", enable_mkldnn=False)
    except (TypeError, ValueError):
        try:
            ocr = PaddleOCR(use_angle_cls=False, lang="ch", show_log=False)
        except (TypeError, ValueError):
            ocr = PaddleOCR(lang="ch")  # 3.x 参数差异
    t_init = time.perf_counter() - t_init0

    t0 = time.perf_counter()
    try:
        raw_cold = ocr.ocr(IMG, cls=False)
    except Exception:
        raw_cold = ocr.predict(IMG)  # 3.x
    t_infer = time.perf_counter() - t0

    # warm 推理（排除首次 kernel 编译/缓存冷启动）
    t0w = time.perf_counter()
    try:
        raw = ocr.ocr(IMG, cls=False)
    except Exception:
        raw = ocr.predict(IMG)
    t_warm = time.perf_counter() - t0w

    items = norm(raw)
    texts = [t for t, _, _ in items]
    confs = [c for _, c, _ in items]
    polys = [p for _, _, p in items]

    order_acc, order_exact = line_accuracy(GT["medical_order_lines"], texts)
    all_acc, all_exact = line_accuracy(GT["all_lines"], texts)

    result = {
        "engine": "PaddleOCR 自托管 (PP-OCRv4, CPU)",
        "init_seconds": round(t_init, 2),
        "inference_seconds": round(t_infer, 2),
        "inference_warm_seconds": round(t_warm, 2),
        "lines_detected": len(items),
        "medical_order_char_accuracy": round(order_acc, 4),
        "medical_order_exact_lines": f"{order_exact}/{len(GT['medical_order_lines'])}",
        "all_char_accuracy": round(all_acc, 4),
        "all_exact_lines": f"{all_exact}/{len(GT['all_lines'])}",
        "char_level_confidence_available": all(c is not None for c in confs),
        "confidence_sample": [round(c, 4) for c in confs[:5]],
        "coordinates_available": all(p is not None and len(p) >= 4 for p in polys),
        "ocr_texts": texts,
    }
    with open(os.path.join(HERE, "paddle-result.json"), "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
