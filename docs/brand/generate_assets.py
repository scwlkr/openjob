"""Rebuild editable identity masters. Requires fonttools[woff] 4.60.1.

Run: python3 docs/brand/generate_assets.py
The bundled Inter 4.1 font and its license are in fonts/.
"""

from pathlib import Path
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "assets"
OUT.mkdir(exist_ok=True)


def svg(name, width, height, artwork, description):
    (OUT / f"openjob-{name}.svg").write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" '
        f'height="{height}" viewBox="0 0 {width} {height}" '
        'role="img" aria-labelledby="title description">\n'
        '  <title id="title">OpenJob</title>\n'
        f'  <desc id="description">{description}</desc>\n'
        f'{artwork}\n</svg>\n'
    )


def mark(reverse=False, mono=False, small=False):
    # Reconstructed from the supplied raster board, not a traced original.
    front = "M8 26 26 16V60H62L52 74H8Z"
    back = "M30 4H74Q76 4 76 6V50L62 60V18H24Z"
    if mono or small:
        fill = "#F7F8FA" if reverse else ("#20242B" if mono else "#4169E1")
        return f'  <g fill="{fill}"><path d="{back}"/><path d="{front}"/></g>'
    colors = ("#6389FF", "#4169E1", "#8CA8FF") if reverse else (
        "#4169E1", "#3157D5", "#6C90FF"
    )
    return f'''  <defs>
    <linearGradient id="back" x1="24" y1="4" x2="76" y2="60" gradientUnits="userSpaceOnUse">
      <stop stop-color="{colors[2]}"/><stop offset=".55" stop-color="{colors[0]}"/>
      <stop offset="1" stop-color="{colors[1]}"/>
    </linearGradient>
    <linearGradient id="front" x1="8" y1="26" x2="62" y2="74" gradientUnits="userSpaceOnUse">
      <stop stop-color="{colors[0]}"/><stop offset=".6" stop-color="{colors[1]}"/>
      <stop offset="1" stop-color="{colors[0]}"/>
    </linearGradient>
  </defs>
  <path fill="url(#back)" d="{back}"/>
  <path fill="url(#front)" d="{front}"/>
  <path fill="{colors[2]}" opacity=".65" d="M30 4H41L36 18H24Z"/>
  <path fill="#F7F8FA" opacity=".17" d="m33 4-5 14h3l5-14Z"/>
  <path fill="{colors[2]}" opacity=".7" d="M36 60H50L44 74H30Z"/>
  <path fill="#F7F8FA" opacity=".22" d="m40 60-6 14h3l6-14Z"/>'''


font = instantiateVariableFont(
    TTFont(ROOT / "fonts/InterVariable.woff2"), {"wght": 700, "opsz": 32}
)
glyphs = font.getGlyphSet()
cmap = font.getBestCmap()
scale = 64 / font["head"].unitsPerEm
cursor = 0
paths = []
for letter in "OpenJob":
    glyph = glyphs[cmap[ord(letter)]]
    pen = SVGPathPen(glyphs)
    glyph.draw(TransformPen(pen, (scale, 0, 0, -scale, cursor, 66)))
    paths.append(pen.getCommands())
    cursor += glyph.width * scale - 2.4
word_width = round(cursor + 6)


def wordmark(reverse=False):
    fill = "#F7F8FA" if reverse else "#20242B"
    return f'  <g fill="{fill}">' + "".join(
        f'<path d="{path}"/>' for path in paths
    ) + "</g>"


for suffix, reverse, mono, small in [
    ("mark", False, False, False),
    ("mark-reverse", True, False, False),
    ("mark-mono", False, True, False),
    ("mark-mono-reverse", True, True, False),
    ("mark-small", False, False, True),
]:
    svg(suffix, 84, 80, mark(reverse, mono, small),
        "An offset open frame with a folded ribbon construction.")

for suffix, reverse in [("", False), ("-reverse", True)]:
    svg("wordmark" + suffix, word_width, 84, wordmark(reverse),
        "Mixed-case OpenJob lettering, outlined from Inter Display 700.")
    art = mark(reverse) + f'<g transform="translate(104 0)">{wordmark(reverse)}</g>'
    svg("lockup" + suffix, word_width + 104, 84, art,
        "The folded frame beside mixed-case OpenJob lettering.")

svg("app-icon", 512, 512,
    '<rect width="512" height="512" fill="#20242B"/>'
    '<g transform="translate(88 96) scale(4)">' + mark(True) + '</g>',
    "The folded cobalt frame on Graphite. Platforms apply their own icon mask.")
print(f"Wrote 10 SVG masters to {OUT}")
