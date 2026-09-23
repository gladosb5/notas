"""Regenerate the app icons from the brand artwork.

    python scripts/make-icons.py

The source is a black brush wordmark on a flat near-white field. Luminance is
used as an alpha channel, so the anti-aliased brush edges survive and the mark
can be tinted to the theme's ink colour rather than being baked black.

The wordmark is 4:1. It reads from about 64px up and is an illegible smear at
favicon sizes, so the small icons use the leading glyph as a monogram. Both come
from the same artwork, so it stays one identity.
"""
from PIL import Image, ImageDraw
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'assets' / 'logo-source.png'
OUT = ROOT / 'assets'
PAPER = (245, 246, 244, 255)   # --paper
INK = (34, 37, 42, 255)        # --graphite
FIELD = 246                    # the artwork's background luminance


def wordmark():
    src = Image.open(SRC).convert('RGB')
    w, h = src.size
    px = src.load()
    alpha = Image.new('L', (w, h))
    ap = alpha.load()
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            lum = (r * 299 + g * 587 + b * 114) // 1000
            ap[x, y] = max(0, min(255, round((FIELD - lum) * 255 / FIELD)))
    mark = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    mark.putalpha(alpha)
    return mark.crop(mark.getbbox())


def tinted(art, colour):
    out = Image.new('RGBA', art.size, colour[:3] + (0,))
    out.putalpha(art.getchannel('A'))
    return out


def tile(size, radius, art, frac, fit_height=False):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(img).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=PAPER)
    if fit_height:
        ah = int(size * frac)
        aw = max(1, round(ah * art.size[0] / art.size[1]))
    else:
        aw = int(size * frac)
        ah = max(1, round(aw * art.size[1] / art.size[0]))
    img.alpha_composite(tinted(art, INK).resize((aw, ah), Image.LANCZOS),
                        ((size - aw) // 2, (size - ah) // 2))
    return img


def main():
    mark = wordmark()
    # the letters are tied together by one long swash, so the monogram is cut by
    # proportion rather than by looking for a gap between glyphs - there is none
    mono = mark.crop((0, 0, int(mark.size[0] * 0.235), mark.size[1]))
    mono = mono.crop(mono.getbbox())

    tinted(mark, INK).save(OUT / 'logo.png')
    tile(512, int(512 * 0.22), mark, 0.82).save(OUT / 'icon-512.png')
    tile(192, int(192 * 0.22), mark, 0.82).save(OUT / 'icon-192.png')
    # maskable is full bleed and must sit inside the 80% safe zone
    tile(512, 0, mark, 0.60).save(OUT / 'icon-maskable-512.png')
    tile(180, 0, mark, 0.82).save(OUT / 'apple-touch-icon.png')   # iOS masks it itself
    tile(32, 6, mono, 0.68, fit_height=True).save(OUT / 'icon-32.png')
    tile(16, 3, mono, 0.72, fit_height=True).save(OUT / 'icon-16.png')
    print('wordmark', mark.size, ' monogram', mono.size, '-> icons written to assets/')


if __name__ == '__main__':
    main()
