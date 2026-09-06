# 合成处方笺 golden case 样张渲染器（M2-T9/T10 共用）。
#
# 读同目录 golden-cases.json（唯一真相源），据每个场景的 lines 渲染清晰打印体中文处方笺 PNG；
# redact 列出的行号画黑框（涂黑遮挡变体：OCR 读不到 → 走人工补，验证「绝不预填猜测」）。
#
# 为什么用 Pillow：对齐 tools/ocr-bench/make_sample.py 的既定做法（微软雅黑打印体，ground truth 精确已知）。
# 样张供 T10 E2E live 真实 OCR / 人工 oracle 审核；CI（fixture 回放）不读像素，只读 golden-cases.json 的文本。
#
# 运行：python app/fixtures/make-fixtures.py   （需 Pillow：pip install pillow）
import json
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = "C:/Windows/Fonts/msyh.ttc"  # 微软雅黑（打印体）；缺失时回退默认字体（不静默：打印告警）

W, H = 1240, 1754  # ~A4 @150dpi
MARGIN_X = 90
LINE_TOP = 70
LINE_H = 62  # 行距（足够容纳 32px 字 + 涂黑框）


def load_font(size):
    try:
        return ImageFont.truetype(FONT, size)
    except OSError:
        print(f"[warn] 未找到字体 {FONT}，回退默认位图字体（中文可能不显示；样张仅 CI 文本用，PNG 供人工参照）")
        return ImageFont.load_default()


def render(lines, redact, out_path):
    """渲染一张处方笺：逐行打印体文本；redact 行号覆盖黑框（涂黑遮挡）。"""
    img = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(img)
    f_title = load_font(44)
    f_body = load_font(32)

    redact_set = set(redact or [])
    for i, text in enumerate(lines):
        y = LINE_TOP + i * LINE_H
        font = f_title if i == 0 else f_body
        # Rp 之前为前记（身份信息区），Rp..处方完毕 为正文，之后为后记（签名）——统一打印体即可
        d.text((MARGIN_X, y), text, font=font, fill="black")
        if i in redact_set:
            # 涂黑遮挡：覆盖该行文本的黑框（模拟用户/系统遮盖敏感或缺失字段）
            d.rectangle([MARGIN_X - 8, y - 6, W - MARGIN_X + 8, y + LINE_H - 18], fill="black")

    img.save(out_path)
    return out_path


def main():
    with open(os.path.join(HERE, "golden-cases.json"), encoding="utf-8") as f:
        spec = json.load(f)

    made = []
    for name, sc in spec["scenarios"].items():
        out = os.path.join(HERE, sc["image"])
        render(sc["lines"], sc.get("redact", []), out)
        made.append((name, sc["image"], len(sc.get("redact", []))))
        print(f"[ok] {name:14s} -> {sc['image']}（涂黑 {len(sc.get('redact', []))} 行）")

    print(f"\n共渲染 {len(made)} 张样张于 {HERE}")
    print("提示：样张含合成假 PII（张三/13800001234/…），仅验证脱敏零泄漏，绝非真实用户信息。")


if __name__ == "__main__":
    main()
