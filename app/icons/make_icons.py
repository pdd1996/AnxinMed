#!/usr/bin/env python3
"""安心用药 · 图标生成器（唯一真相源：app/icons/anxin_icon.png）

源图 2048×2048：`#F5F7F4` 白色圆角底板 + `#127A58` 绿色药丸；药丸中间有一道白色
「掰开缝」，上半颗里嵌一个白色对勾；四个圆角在导出时被压平成了黑色（实际是透明）。
本脚本把黑角还原成 alpha，并按品牌色重建为纯平色（去掉源图 ±2 级噪点），再派生：
  · 移动端（Expo / Android）：launcher 图标、自适应前景 / 单色、启动图、通知栏图标
  · Web 端（Vite / PWA）：favicon、apple-touch-icon、PWA any / maskable 图标 + manifest

用法（任意目录）：
    python app/icons/make_icons.py                  # 生成
    python app/icons/make_icons.py --preview <dir>  # 生成 + 输出人眼验收预览图

依赖：Pillow + numpy。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
APP = HERE.parent
SRC = HERE / "anxin_icon.png"
MOBILE_ASSETS = APP / "packages" / "mobile" / "assets" / "images"
WEB_PUBLIC = APP / "packages" / "web" / "public"

PLATE = (245, 247, 244)  # 底板 #F5F7F4（源图实测主色）
PLATE_HEX = "#F5F7F4"
GREEN = (18, 122, 88)  # 药丸 #127A58（源图实测主色）
GREEN_HEX = "#127A58"
PLATE_F = np.array(PLATE, dtype=np.float64) / 255.0
GREEN_F = np.array(GREEN, dtype=np.float64) / 255.0

# Android 自适应图标安全区：官方口径「108dp 图层中心 66dp 直径圆」→ 半径 33/108。
ADAPTIVE_SAFE_RADIUS = 33.0 / 108.0
# 通知栏小图标（Android 24dp 里要填满）：药丸最远点放到画布边长的 46%（内切圆 0.5 以内）。
NOTIFICATION_RADIUS = 0.46


# ── 源图解析 ────────────────────────────────────────────────────────────────


def load_source() -> np.ndarray:
    """读源图 → float64 RGB（0..1）。"""
    img = Image.open(SRC).convert("RGB")
    if img.size[0] != img.size[1]:
        raise SystemExit(f"源图必须是正方形，实际 {img.size}")
    return np.asarray(img).astype(np.float64) / 255.0


def build_layers(rgb: np.ndarray) -> dict[str, np.ndarray]:
    """从源图还原各层覆盖率（源分辨率，0..1）。

    plate_alpha —— 白色圆角底板覆盖率（黑角 = 0，边缘抗锯齿线性可还原）
    pill_alpha  —— 绿色药丸覆盖率（掰开缝与对勾均为镂空 → 0）
    pill_solid  —— 药丸实心剪影（把对勾这类被围住的洞补上）
    mono_alpha  —— 单色版：药丸实心 + 对勾镂空
    """
    lum = rgb.sum(axis=2)  # 0..3
    plate_ref = float(PLATE_F.sum())  # ≈2.886

    # 1) 底板覆盖率：底色白 → 1，黑角 → 0；再把被药丸占住的内部补实成不透明。
    plate_alpha = np.clip(lum / plate_ref, 0.0, 1.0)
    plate_hole_free = _filled_holes(plate_alpha > 0.5)

    # 2) 药丸覆盖率：把像素投影到底色白 ↔ 药丸绿 的连线上取投影长度；
    #    白对勾 / 白缝与底板同色 → 投影为 0；黑角残差大 → 直接判 0。
    # ⚠ 只在「底板内部」取药丸：底板自身的抗锯齿边（白→黑）投影到同一条线时
    #    会残留极淡的假 alpha，不拦住就会在圆角处留下鬼影弧线。药丸离底板边
    #    至少 350px，所以按底板剪影内缩 80px 再取，误杀不了药丸。
    direction = GREEN_F - PLATE_F
    proj = np.tensordot(rgb - PLATE_F, direction, axes=([2], [0])) / float(direction @ direction)
    residual = np.linalg.norm((rgb - PLATE_F) - proj[..., None] * direction, axis=2)
    pill_alpha = np.where(residual < 0.05, np.clip(proj, 0.0, 1.0), 0.0)
    pill_alpha = np.where(pill_alpha > 0.02, pill_alpha, 0.0)
    pill_alpha = np.where(_erode(plate_hole_free, 80), pill_alpha, 0.0)
    # 开运算去掉孤立噪点（AI 生成源图在底板里有零星偏绿噪点），再回套原 alpha 保边缘平滑。
    support = _dilate(_erode(pill_alpha > 0.02, 2), 2)
    pill_alpha = np.where(support, pill_alpha, 0.0)

    # 3) 药丸实心剪影：对勾是被上半颗药丸围住的洞，用洪水填充补实。
    pill_solid = _filled_holes(pill_alpha > 0.5)

    # 4) 单色版：实心药丸减去对勾（主题图标要留镂空）。
    hole_cov = np.where(pill_solid, 1.0 - pill_alpha, 0.0)
    mono_alpha = np.where(pill_solid, 1.0, pill_alpha) * (1.0 - hole_cov)

    return {
        "plate_alpha": plate_alpha,
        "plate_solid": plate_hole_free,
        "pill_alpha": pill_alpha,
        "pill_solid": pill_solid,
        "mono_alpha": np.clip(mono_alpha, 0.0, 1.0),
    }


def _filled_holes(binary: np.ndarray) -> np.ndarray:
    """补上 binary 内部被围住的空洞（PIL floodfill，免装 scipy）。"""
    mask = Image.fromarray(np.where(binary, 255, 0).astype(np.uint8), "L")
    flooded = mask.copy()
    ImageDraw.floodfill(flooded, (0, 0), 128)
    return np.asarray(flooded) != 128


def _erode(mask: np.ndarray, iterations: int) -> np.ndarray:
    """二值形态学腐蚀（不做 wrap，画布边按背景处理）。"""
    m = mask
    for _ in range(iterations):
        e = np.zeros_like(m)
        e[1:-1, 1:-1] = (
            m[1:-1, 1:-1] & m[:-2, 1:-1] & m[2:, 1:-1] & m[1:-1, :-2] & m[1:-1, 2:]
        )
        m = e
    return m


def _dilate(mask: np.ndarray, iterations: int) -> np.ndarray:
    """二值形态学膨胀（QC 用）。"""
    m = mask
    for _ in range(iterations):
        d = m.copy()
        d[1:, :] |= m[:-1, :]
        d[:-1, :] |= m[1:, :]
        d[:, 1:] |= m[:, :-1]
        d[:, :-1] |= m[:, 1:]
        m = d
    return m


def pill_radius_ratio(layers: dict[str, np.ndarray]) -> float:
    """药丸最远点距画面中心的距离 / 画布边长。"""
    solid = layers["pill_alpha"] > 0.5
    ys, xs = np.nonzero(solid)
    h, w = solid.shape
    return float(np.max(np.hypot(xs - w / 2.0, ys - h / 2.0))) / w


# ── 合成 ────────────────────────────────────────────────────────────────────


def to_rgba(alpha01: np.ndarray, color: tuple[int, int, int]) -> Image.Image:
    h, w = alpha01.shape
    rgb = np.tile(np.array(color, dtype=np.float64) / 255.0, (h, w, 1))
    rgb8 = np.clip(rgb * 255.0 + 0.5, 0, 255).astype(np.uint8)
    a8 = np.clip(alpha01 * 255.0 + 0.5, 0, 255).astype(np.uint8)
    return Image.fromarray(np.dstack([rgb8, a8]), "RGBA")


def resize_rgba(img: Image.Image, size: int, fill: tuple[int, int, int]) -> Image.Image:
    """缩放 RGBA；透明区先刷成目标底色，避免 LANCZOS 把透明黑混进边缘形成暗边。"""
    if img.size == (size, size):
        return img
    arr = np.asarray(img).astype(np.float64).copy()
    opaque = arr[..., 3:4] > 0
    arr[..., :3] = np.where(opaque, arr[..., :3], np.array(fill, dtype=np.float64))
    out = Image.fromarray(np.clip(arr + 0.5, 0, 255).astype(np.uint8), "RGBA")
    return out.resize((size, size), Image.LANCZOS)


def place_scaled(
    canvas: Image.Image, layer: Image.Image, scale: float, fill: tuple[int, int, int]
) -> Image.Image:
    """把 layer 按 scale 缩放后居中叠到 canvas 上。"""
    size = max(1, int(round(canvas.width * scale)))
    small = resize_rgba(layer, size, fill)
    out = canvas.copy()
    out.alpha_composite(small, ((canvas.width - size) // 2, (canvas.height - size) // 2))
    return out


def scaled_layer(
    layer: Image.Image, scale: float, fill: tuple[int, int, int] = PLATE
) -> Image.Image:
    """把 layer 缩到画布尺寸的 scale 倍并居中（保持画布尺寸不变，四周透明）。"""
    canvas = Image.new("RGBA", layer.size, fill + (0,))
    return place_scaled(canvas, layer, scale, fill)


def compose_masters(rgb: np.ndarray, layers: dict[str, np.ndarray]) -> dict[str, Image.Image]:
    """源分辨率母图（后续只做降采样，不再缩放比例）。"""
    pill = to_rgba(layers["pill_alpha"], GREEN)

    # 底板覆盖率要「填实」：源图底板内部被药丸占着（亮度低），直接按亮度算会让
    # 底板在药丸足迹处半透明，合成缩放后的药丸时露出一圈鬼影。
    plate_alpha = np.where(layers["plate_solid"], 1.0, layers["plate_alpha"])

    # 满铺不透明：底板色铺满 + 药丸（iOS / 商店 / legacy launcher 口径）。
    full_bleed = Image.new("RGB", pill.size, PLATE)
    full_bleed.paste(pill, (0, 0), pill)
    # 圆角透明底板（源图外形），用于 favicon / PWA。
    plate_rounded = to_rgba(plate_alpha, PLATE)
    return {
        "full_bleed": full_bleed,
        "plate_rounded": plate_rounded,
        "pill": pill,
        "mono": to_rgba(layers["mono_alpha"], (255, 255, 255)),
    }


# ── 输出 ────────────────────────────────────────────────────────────────────


def write_mobile(masters: dict[str, Image.Image], radius: float) -> list[Path]:
    """移动端：app.json 引用的五个文件。"""
    MOBILE_ASSETS.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    safe = ADAPTIVE_SAFE_RADIUS / radius  # 药丸缩到自适应安全圆

    # icon.png：1024 不透明满铺（iOS / 商店 / legacy launcher；Android 8+ 走自适应图标）。
    p = MOBILE_ASSETS / "icon.png"
    resize_rgba(masters["full_bleed"].convert("RGBA"), 1024, PLATE).convert("RGB").save(
        p, optimize=True
    )
    written.append(p)

    # 自适应前景：透明底 + 安全区内的药丸。
    p = MOBILE_ASSETS / "android-icon-foreground.png"
    resize_rgba(scaled_layer(masters["pill"], safe), 1024, PLATE).save(p, optimize=True)
    written.append(p)

    # 单色（Android 13 主题图标）：纯白 RGB + alpha 剪影，同样缩到安全区。
    p = MOBILE_ASSETS / "android-icon-monochrome.png"
    resize_rgba(scaled_layer(masters["mono"], safe, (255, 255, 255)), 1024, (255, 255, 255)).save(
        p, optimize=True
    )
    written.append(p)

    # 通知栏小图标：不进 launcher 安全区，药丸放大到近乎撑满（24dp 里才看得见）。
    p = MOBILE_ASSETS / "notification-icon.png"
    resize_rgba(
        scaled_layer(masters["mono"], NOTIFICATION_RADIUS / radius, (255, 255, 255)),
        1024,
        (255, 255, 255),
    ).save(p, optimize=True)
    written.append(p)

    # 启动图：按源图比例（不缩安全区），配合 app.json 的 backgroundColor #F5F7F4。
    p = MOBILE_ASSETS / "splash-icon.png"
    resize_rgba(masters["pill"], 1024, PLATE).save(p, optimize=True)
    written.append(p)

    # app.json 改用 backgroundColor，旧的 Expo 模板背景图不再需要。
    stale = MOBILE_ASSETS / "android-icon-background.png"
    if stale.exists():
        stale.unlink()

    return written


def write_web(masters: dict[str, Image.Image], radius: float) -> list[Path]:
    """Web 端：favicon + PWA 图标 + manifest。"""
    WEB_PUBLIC.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    safe = ADAPTIVE_SAFE_RADIUS / radius

    # favicon / PWA any：圆角底板 + 安全区药丸（16px 下药丸也够大）。
    badge = Image.alpha_composite(
        masters["plate_rounded"], scaled_layer(masters["pill"], safe)
    )
    for size in (16, 32):
        p = WEB_PUBLIC / f"favicon-{size}x{size}.png"
        resize_rgba(badge, size, PLATE).save(p, optimize=True)
        written.append(p)
    p = WEB_PUBLIC / "favicon.ico"
    resize_rgba(badge, 256, PLATE).save(p, format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])
    written.append(p)

    # 添加到主屏幕：iOS 自己切圆角，必须给不透明满铺图（比例同 icon.png）。
    p = WEB_PUBLIC / "apple-touch-icon.png"
    resize_rgba(masters["full_bleed"].convert("RGBA"), 180, PLATE).convert("RGB").save(
        p, optimize=True
    )
    written.append(p)

    # PWA "any"：同 favicon 的圆角外形。
    for size in (192, 512):
        p = WEB_PUBLIC / f"icon-{size}.png"
        resize_rgba(badge, size, PLATE).save(p, optimize=True)
        written.append(p)

    # PWA "maskable"：满铺底色 + 药丸在 80% 安全圆内（maskable 安全半径 0.40）。
    maskable = Image.new("RGBA", (2048, 2048), PLATE + (255,))
    maskable = place_scaled(maskable, masters["pill"], safe, PLATE)
    p = WEB_PUBLIC / "icon-maskable-512.png"
    resize_rgba(maskable, 512, PLATE).save(p, optimize=True)
    written.append(p)

    manifest = {
        "name": "安心用药",
        "short_name": "安心用药",
        "description": "把一个人所有来源的药放进同一个药箱——管依从、管冲突、管效期。",
        "lang": "zh-CN",
        "start_url": "/",
        "scope": "/",
        "display": "standalone",
        "background_color": PLATE_HEX,
        "theme_color": "#25695b",
        "icons": [
            {"src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
            {
                "src": "/icon-maskable-512.png",
                "sizes": "512x512",
                "type": "image/png",
                "purpose": "maskable",
            },
        ],
    }
    p = WEB_PUBLIC / "site.webmanifest"
    p.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    written.append(p)

    return written


# ── 验收预览 ────────────────────────────────────────────────────────────────


def _mask(size: int, kind: str, radius_ratio: float = 0.0) -> Image.Image:
    big = size * 4
    m = Image.new("L", (big, big), 0)
    d = ImageDraw.Draw(m)
    if kind == "circle":
        d.ellipse((0, 0, big - 1, big - 1), fill=255)
    else:
        d.rounded_rectangle((0, 0, big - 1, big - 1), radius=int(big * radius_ratio), fill=255)
    return m.resize((size, size), Image.LANCZOS)


def _paste_masked(target: Image.Image, img: Image.Image, box: tuple[int, int], mask: Image.Image) -> None:
    clipped = img.copy()
    clipped.putalpha(mask)
    target.paste(clipped, box, clipped)


def write_preview(masters: dict[str, Image.Image], radius: float) -> Path:
    """人眼验收：图标本体 / Android 各掩模 / 单色 / 启动图 / favicon 真实像素 / maskable。"""
    PW, GAP, MARGIN = 240, 30, 30
    SHEET_W = MARGIN * 2 + (PW + GAP) * 3 + 420  # 最后一格放 favicon 实际像素
    sheet = Image.new("RGB", (SHEET_W, 800), (238, 238, 238))
    draw = ImageDraw.Draw(sheet)
    safe = ADAPTIVE_SAFE_RADIUS / radius

    def label(x: int, y: int, text: str) -> None:
        draw.text((x, y), text, fill=(25, 25, 25))

    def cell(col: int, row: int) -> tuple[int, int]:
        return MARGIN + col * (PW + GAP), 70 + row * (PW + 120)

    # 第 1 行：icon.png / favicon 圆角版 / 自适应圆掩模 / 自适应方圆掩模
    x, y = cell(0, 0)
    sheet.paste(resize_rgba(masters["full_bleed"].convert("RGBA"), PW, PLATE).convert("RGB"), (x, y))
    label(x, y - 22, "icon.png 1024 (full-bleed)")

    badge = Image.alpha_composite(masters["plate_rounded"], scaled_layer(masters["pill"], safe))
    x, y = cell(1, 0)
    bg = Image.new("RGB", (PW, PW), (238, 238, 238))
    b = resize_rgba(badge, PW, PLATE)
    bg.paste(b, (0, 0), b)
    sheet.paste(bg, (x, y))
    label(x, y - 22, "favicon / PWA any (rounded)")

    fg = resize_rgba(scaled_layer(masters["pill"], safe), PW, PLATE)
    adaptive = Image.new("RGBA", (PW, PW), PLATE + (255,))
    adaptive.alpha_composite(fg)
    for i, (kind, rr) in enumerate([("circle", 0.0), ("squircle", 0.30)]):
        x, y = cell(2 + i, 0)
        _paste_masked(sheet, adaptive, (x, y), _mask(PW, kind, rr))
        label(x, y - 22, f"adaptive foreground · {kind} mask")

    # 第 2 行：单色（深底）/ 启动图 / maskable / favicon 实际像素 ×8
    x, y = cell(0, 1)
    mono = resize_rgba(scaled_layer(masters["mono"], safe, (255, 255, 255)), PW, (255, 255, 255))
    dark = Image.new("RGB", (PW, PW), (32, 36, 35))
    dark.paste(mono, (0, 0), mono)
    sheet.paste(dark, (x, y))
    label(x, y - 22, "monochrome (themed icon, dark bg)")

    x, y = cell(1, 1)
    splash = Image.new("RGB", (PW, PW), PLATE)
    pill = resize_rgba(masters["pill"], int(PW * 0.65), PLATE)
    splash.paste(pill, ((PW - pill.width) // 2, (PW - pill.height) // 2), pill)
    sheet.paste(splash, (x, y))
    label(x, y - 22, "splash sim (imageWidth 160dp)")

    x, y = cell(2, 1)
    maskable = Image.new("RGBA", (PW, PW), PLATE + (255,))
    maskable = place_scaled(maskable, resize_rgba(masters["pill"], PW * 2, PLATE), safe, PLATE)
    maskable = maskable.convert("RGB").convert("RGBA")
    _paste_masked(sheet, maskable, (x, y), _mask(PW, "circle"))
    label(x, y - 22, "PWA maskable 512 · circle mask")

    x, y = cell(3, 1)
    for i, size in enumerate((16, 32)):
        f = resize_rgba(badge, size, PLATE).resize((size * 8, size * 8), Image.NEAREST)
        white_bg = Image.new("RGB", f.size, (255, 255, 255))
        white_bg.paste(f, (0, 0), f)
        sheet.paste(white_bg, (x + i * 180, y))
    label(x, y - 22, "favicon 16px / 32px (x8, white tab)")

    draw.multiline_text(
        (MARGIN, 730),
        f"plate {PLATE_HEX}   pill {GREEN_HEX}   pill radius/canvas = {radius:.3f}   "
        f"adaptive safe radius = {ADAPTIVE_SAFE_RADIUS:.3f} (scale {safe:.3f})\n"
        f"notification icon scale = {NOTIFICATION_RADIUS / radius:.3f}   "
        f"source: app/icons/anxin_icon.png (2048, 四个黑角=透明)",
        fill=(70, 70, 70),
    )

    out_dir = Path(sys.argv[sys.argv.index("--preview") + 1]).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / "icon-preview.png"
    sheet.save(out)
    return out


# ── 自检 ────────────────────────────────────────────────────────────────────


def quality_report(rgb: np.ndarray, layers: dict[str, np.ndarray]) -> None:
    """重建误差 + 游离像素：确保没把底板抗锯齿边之类的杂讯当成药丸带进产物。"""
    plate_rgb = np.tile(PLATE_F, rgb.shape[:2] + (1,))
    green_rgb = np.tile(GREEN_F, rgb.shape[:2] + (1,))
    a = layers["pill_alpha"][..., None]
    rebuilt = green_rgb * a + plate_rgb * (1 - a)
    plate_zone = layers["plate_alpha"] > 0.99
    err = np.abs(rebuilt - rgb)[plate_zone] * 255.0
    print(
        f"  重建误差（底板区，0-255）：mean={err.mean():.2f}  p99={np.percentile(err, 99):.2f}  "
        f"max={err.max():.2f}"
    )
    if err.mean() > 2.0:
        raise SystemExit("重建误差过大，源图解析参数需要复核（不静默产出坏图标）")

    # 药丸剪影以外不该有任何 alpha：否则会变成自适应前景 / 单色层里的可见鬼影。
    solid_zone = _dilate(layers["pill_solid"], 3)  # 留出剪影自身的抗锯齿边
    count = int(((layers["pill_alpha"] > 0.0) & ~solid_zone).sum())
    print(f"  药丸剪影外的游离像素：{count}")
    if count:
        raise SystemExit("药丸层有游离像素（会变成可见鬼影），需要复核掩模判定")


def main() -> int:
    rgb = load_source()
    layers = build_layers(rgb)
    quality_report(rgb, layers)
    radius = pill_radius_ratio(layers)
    masters = compose_masters(rgb, layers)
    written = write_mobile(masters, radius) + write_web(masters, radius)
    if "--preview" in sys.argv:
        written.append(write_preview(masters, radius))
    for p in written:
        try:
            shown = p.relative_to(APP)
        except ValueError:
            shown = p
        print(f"  {shown}  ({p.stat().st_size} B)")
    print(
        f"  药丸最大半径 / 边长 = {radius:.3f}；自适应前景 / 单色缩到安全区 "
        f"{ADAPTIVE_SAFE_RADIUS:.3f}（缩放 {ADAPTIVE_SAFE_RADIUS / radius:.3f}）；"
        f"通知栏图标缩放 {NOTIFICATION_RADIUS / radius:.3f}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
