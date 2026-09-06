# 合成打印体处方笺样张生成器（M1-T11 OCR 实测）。
# 用 Pillow 渲染清晰打印体中文处方笺，ground truth 精确已知，作为 OCR 基准输入。
# 运行：python tools/ocr-bench/make_sample.py
import json
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = "C:/Windows/Fonts/msyh.ttc"  # 微软雅黑（打印体）

W, H = 1240, 1754  # ~A4 @150dpi
img = Image.new("RGB", (W, H), "white")
d = ImageDraw.Draw(img)

f_title = ImageFont.truetype(FONT, 46)
f_sub = ImageFont.truetype(FONT, 26)
f_body = ImageFont.truetype(FONT, 32)
f_small = ImageFont.truetype(FONT, 24)

lines = []  # (text, font, x, y)


def add(text, font, x, y):
    lines.append((text, font, x, y))


add("示例市第二医院  处方笺", f_title, 330, 60)
add("处方编号：20260906-001    费别：自费", f_sub, 80, 150)
add("姓名：张某某    性别：男    年龄：68岁", f_sub, 80, 200)
add("临床诊断：高血压  2型糖尿病", f_sub, 80, 250)
add("日期：2026年09月06日", f_sub, 80, 300)
d.line([(80, 350), (W - 80, 350)], fill="black", width=3)

add("Rp", f_body, 90, 390)
add("1. 苯磺酸氨氯地平片  5mg×14片", f_body, 140, 460)
add("用法：每次1片  每日1次  口服", f_body, 180, 520)
add("2. 盐酸二甲双胍片  0.5g×30片", f_body, 140, 600)
add("用法：每次1片  每日2次  口服", f_body, 180, 660)

d.line([(80, 760), (W - 80, 760)], fill="black", width=2)
add("医师：李某某        药师：王某某", f_sub, 80, 800)
add("处方完毕", f_sub, 80, 850)

for text, font, x, y in lines:
    d.text((x, y), text, font=font, fill="black")

out_png = os.path.join(HERE, "sample-prescription.png")
img.save(out_png)

# ground truth：逐行精确文本（OCR 准确率以此为准；医嘱行为重点）
ground_truth = {
    "all_lines": [t for t, _, _, _ in lines],
    "medical_order_lines": [
        "1. 苯磺酸氨氯地平片  5mg×14片",
        "用法：每次1片  每日1次  口服",
        "2. 盐酸二甲双胍片  0.5g×30片",
        "用法：每次1片  每日2次  口服",
    ],
}
with open(os.path.join(HERE, "ground-truth.json"), "w", encoding="utf-8") as f:
    json.dump(ground_truth, f, ensure_ascii=False, indent=2)

print("saved:", out_png)
print("ground truth lines:", len(ground_truth["all_lines"]))
