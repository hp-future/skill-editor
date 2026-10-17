"""Generate the tiny TTF used by the demo's custom font preview.

The glyphs are simple 5x7 block letterforms drawn as filled cells, so the
fixture is a few kilobytes and is entirely our own artwork (no third-party font
is redistributed). Rebuild with:

    python scripts/make-demo-font.py

Output: src/demo/fixtures/SkillDemo.ttf
"""

from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

UPM = 1000
CELL = 60
# 5 columns x 7 rows; 1 = ink.
PATTERNS = {
    "A": ("01110", "10001", "10001", "11111", "10001", "10001", "10001"),
    "B": ("11110", "10001", "10001", "11110", "10001", "10001", "11110"),
    "E": ("11111", "10000", "10000", "11110", "10000", "10000", "11111"),
    "S": ("01111", "10000", "10000", "01110", "00001", "00001", "11110"),
    "zero": ("01110", "10001", "10011", "10101", "11001", "10001", "01110"),
    "one": ("00100", "01100", "00100", "00100", "00100", "00100", "01110"),
    "period": ("00000", "00000", "00000", "00000", "00000", "01100", "01100"),
    "hyphen": ("00000", "00000", "00000", "01110", "00000", "00000", "00000"),
}

GLYPH_ORDER = [".notdef", "space", *PATTERNS]
ADVANCE = 5 * CELL + 2 * CELL
BEARING = CELL


def block_glyph(pattern):
    """One rectangle per inked cell, all wound the same way (non-zero fill)."""
    pen = TTGlyphPen(None)
    rows = len(pattern)
    for row_index, row in enumerate(pattern):
        for column, cell in enumerate(row):
            if cell != "1":
                continue
            x = BEARING + column * CELL
            # Row 0 is the top of the letter; the baseline is y = 0.
            y = (rows - 1 - row_index) * CELL
            pen.moveTo((x, y))
            pen.lineTo((x + CELL, y))
            pen.lineTo((x + CELL, y + CELL))
            pen.lineTo((x, y + CELL))
            pen.closePath()
    return pen.glyph()


def empty_glyph():
    return TTGlyphPen(None).glyph()


def main() -> None:
    builder = FontBuilder(UPM, isTTF=True)
    builder.setupGlyphOrder(GLYPH_ORDER)
    builder.setupCharacterMap(
        {
            0x20: "space",
            0x2D: "hyphen",
            0x2E: "period",
            0x30: "zero",
            0x31: "one",
            0x41: "A",
            0x42: "B",
            0x45: "E",
            0x53: "S",
        }
    )

    glyphs = {".notdef": empty_glyph(), "space": empty_glyph()}
    for name, pattern in PATTERNS.items():
        glyphs[name] = block_glyph(pattern)
    builder.setupGlyf(glyphs)

    metrics = {name: (ADVANCE, BEARING) for name in GLYPH_ORDER}
    metrics["space"] = (ADVANCE // 2, 0)
    builder.setupHorizontalMetrics(metrics)
    builder.setupHorizontalHeader(ascent=800, descent=-200)

    builder.setupNameTable(
        {
            "familyName": "Skill Demo",
            "styleName": "Regular",
            "uniqueFontIdentifier": "Skill Demo Regular 1.0",
            "fullName": "Skill Demo Regular",
            "psName": "SkillDemo-Regular",
            "version": "Version 1.0",
        }
    )
    builder.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
    builder.setupPost()

    out = Path(__file__).resolve().parent.parent / "src" / "demo" / "fixtures" / "SkillDemo.ttf"
    out.parent.mkdir(parents=True, exist_ok=True)
    builder.save(out)
    print(f"wrote {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
