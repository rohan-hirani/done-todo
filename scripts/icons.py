# Generates PWA icons (run: python3 scripts/icons.py). Requires Pillow.
from PIL import Image, ImageDraw
import os
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')
BLUE, RED, WHITE = (47, 107, 255), (229, 72, 77), (255, 255, 255)
S = 2048

def render(size, maskable=False, rounded=True):
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if rounded:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.225), fill=BLUE)
    else:
        d.rectangle([0, 0, S, S], fill=BLUE)
    k = 0.74 if maskable else 1.0   # keep artwork inside the maskable safe zone
    c = S / 2
    def P(x, y): return (c + (x - 0.5) * S * k, c + (y - 0.5) * S * k)
    pts = [P(0.29, 0.52), P(0.44, 0.67), P(0.72, 0.34)]
    w = int(S * 0.115 * k)
    d.line(pts, fill=WHITE, width=w, joint='curve')
    for p in (pts[0], pts[2]):
        d.ellipse([p[0] - w / 2, p[1] - w / 2, p[0] + w / 2, p[1] + w / 2], fill=WHITE)
    r = S * 0.062 * k
    q = P(0.76, 0.24 - 0.0)
    q = P(0.80, 0.20)
    d.ellipse([q[0] - r, q[1] - r, q[0] + r, q[1] + r], fill=RED)
    return im.resize((size, size), Image.LANCZOS)

render(192).save(f'{OUT}/icon-192.png')
render(512).save(f'{OUT}/icon-512.png')
render(192, maskable=True, rounded=False).save(f'{OUT}/maskable-192.png')
render(512, maskable=True, rounded=False).save(f'{OUT}/maskable-512.png')
render(180, rounded=False).convert('RGB').save(f'{OUT}/apple-touch-icon.png')
render(32).save(f'{OUT}/favicon-32.png')

# iOS launch screens (apple-touch-startup-image): app background with the icon centered, light + dark.
# (device px w, h, css w, h, dpr). Run again when adding new iPhone sizes; index.html lists the same set.
SPLASH = [(1320, 2868, 440, 956, 3), (1206, 2622, 402, 874, 3), (1260, 2736, 420, 912, 3), (1290, 2796, 430, 932, 3),
          (1179, 2556, 393, 852, 3), (1284, 2778, 428, 926, 3), (1170, 2532, 390, 844, 3), (1125, 2436, 375, 812, 3),
          (1242, 2688, 414, 896, 3), (828, 1792, 414, 896, 2), (750, 1334, 375, 667, 2)]
SP = os.path.join(os.path.dirname(__file__), '..', 'public', 'splash')
os.makedirs(SP, exist_ok=True)
icon = render(96 * 3)
for (w, h, cw, ch, dpr) in SPLASH:
    for name, bg in (('light', (246, 245, 241)), ('dark', (14, 16, 19))):
        im = Image.new('RGB', (w, h), bg)
        ic = icon.resize((96 * dpr, 96 * dpr), Image.LANCZOS)
        im.paste(ic, ((w - ic.width) // 2, (h - ic.height) // 2), ic)
        im.save(f'{SP}/splash-{w}x{h}-{name}.png', optimize=True)
