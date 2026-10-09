# 质量预检退化样张生成器（M5-T6b · 05e §2-T6-b 独立验收、§5 表 2「合成图退化矩阵」）。
#
# 用途：在真机/模拟器上验「照片质量可能影响识别」那张卡——四张各命中一类判据、一张对照应当不出卡，
# 逐条核对卡上文案是否走 core 的 QUALITY_ISSUE_LABEL + QUALITY_HINTS（禁新写话术），并确认
# 「仍要上传」永远可点（预检是建议，不拦人，05e §0-1）。
#
# 为什么是 PNG：像素值要精确可控（阈值判的就是 meanLuma/clippedRatio/sharpness 三个数），
# RN 链路里图片进原生缩放后一律转 JPEG 再解码，输入用 PNG 不影响那条路。
#
# 四张图都刻意「只命中一条」：条纹周期与幅度按缩放后的梯度门槛反推（sharpness 阈值 0.02 ⇒
# 缩放网格上相邻像素平均梯度要 >5.1），这样卡上只出一行文案，判读结果不被噪声污染。
# 判读数学在 core 的 `statsFromRgba`（与 web 的 canvas 那份同源）。
#
# 运行：python app/fixtures/make-quality-fixtures.py   （需 Pillow，与 make-fixtures.py 同依赖）
import os

from PIL import Image, ImageDraw

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "quality")
W, H = 1240, 1754  # 与 golden case 样张同尺寸（rx-normal.png 等）


def stripes(values, period, size=(W, H)):
    """竖条纹图：values=[暗, 亮]，period=一个明暗周期的像素宽。

    ⚠️ 必须传 (v, v, v) 三元组：Pillow 对 RGB 图传单个 int 会被当成**纯红通道**，
    灰度值直接缩水成 0.299 倍（实测 212 变成 63），阈值全部对不上。
    """
    dark, light = [(v, v, v) for v in values]
    img = Image.new("RGB", size, dark)
    d = ImageDraw.Draw(img)
    half = period // 2
    for x0 in range(0, size[0], period):
        d.rectangle([x0 + half, 0, x0 + period - 1, size[1]], fill=light)
    return img


def dark() -> Image.Image:
    """过暗：0/60 条纹，meanLuma≈30（阈值 60）；周期 24px，缩放后梯度仍够，不被判模糊。"""
    return stripes([0, 60], 24)


def glare() -> Image.Image:
    """反光：252/160 条纹，约一半像素 luma>245（阈值占比 0.18）；亮度居中、梯度够密不被判模糊。"""
    return stripes([160, 252], 32)


def blurry() -> Image.Image:
    """模糊：220→40 的横向平滑渐变，整幅总变化量 180 摊在 362px 网格上 ⇒ 梯度≈0。"""
    img = Image.new("L", (W, H))
    px = img.load()
    for x in range(W):
        value = 220 - int(180 * x / (W - 1))
        for y in range(H):
            px[x, y] = value
    return img.convert("RGB")


def small() -> Image.Image:
    """分辨率过低：文件本身就是 320×240（阈值 480）；条纹够密，其余三条排除。"""
    return stripes([80, 200], 6, size=(320, 240))


def ok() -> Image.Image:
    """对照：190/90 条纹，meanLuma=140、无截断、梯度足 —— 这张应当不出质量卡。"""
    return stripes([90, 190], 24)


CASES = {
    "quality-dark.png": (dark, "过暗（meanLuma≈30）"),
    "quality-glare.png": (glare, "反光（luma>245 占比≈0.5）"),
    "quality-blurry.png": (blurry, "模糊（渐变图，梯度≈0）"),
    "quality-small.png": (small, "分辨率过低（原图 320×240）"),
    "quality-ok.png": (ok, "对照：四条都不该命中"),
}


def main():
    os.makedirs(HERE, exist_ok=True)
    for name, (build, note) in CASES.items():
        out = os.path.join(HERE, name)
        build().save(out)
        print(f"[ok] {name:22s} {note}")
    print(f"\n输出目录：{HERE}")
    print("推设备相册：adb push 到 /sdcard/DCIM/Camera/ 后跑媒体扫描，口令见 05e §2-T6-b。")


if __name__ == "__main__":
    main()
