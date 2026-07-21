#!/usr/bin/env python3
"""Build the tiny Material Design Icons subset used for PDF topology exports.

jsPDF's built-in TTF embedding (used by svg2pdf.js) only understands cmap
format 4, a BMP-only (<= U+FFFF) format — its parser has no case for format
12, the segmented-coverage format required for codepoints above U+FFFF (see
jspdf.umd.min.js, the cmap subtable class's format switch: only `case 0` and
`case 4` are implemented). Nearly every Material Design Icons glyph — all the
ones used for topology role icons — lives in the Supplementary Private Use
Area above U+FFFF, so jsPDF can never resolve them directly, no matter how
the source font is packaged: registering the full webfont produces a PDF
with a corrupt/empty embedded font (also because MDI's ~7500 glyphs force
the "long" `loca` table format, another spot naive TTF subsetting/embedding
code — jsPDF's included — commonly mishandles).

The fix used here: subset the font down to just the glyphs the topology
export needs, then rewrite its cmap to a single format-4 subtable mapping
those glyphs onto sequential codepoints in the BMP Private Use Area
(U+E000+), which jsPDF's parser *can* read. The exported SVG's icon text is
remapped from the real MDI codepoint to the matching PUA codepoint right
before PDF conversion (see topology_pdf.js, ICON_CODEPOINT_MAP) — the
on-screen SVG keeps using the real MDI webfont and real codepoints
untouched, since browsers have no trouble with astral-plane glyphs.

Usage:
    pip install fonttools
    python3 build_pdf_icon_font.py /path/to/materialdesignicons-webfont.ttf

Re-run this whenever a new icon is added to ROLE_ICONS / APP_TYPE_ICONS /
the pin-indicator glyph in topology_core.js or topology_renderer.js — add
its real MDI codepoint to ICONS below first. Prints the updated
ICON_CODEPOINT_MAP for pasting into topology_pdf.js.
"""
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._c_m_a_p import CmapSubtable

OUT_TTF = 'netbox_map/static/netbox_map/fonts/mdi-pdf-icons.ttf'

# name -> real MDI codepoint. Keep in sync with the icon tables in
# topology_core.js (ROLE_ICONS, APP_TYPE_ICONS) and the pin indicator in
# topology_renderer.js. Look up codepoints in NetBox core's own
# netbox-external.css (search for ".mdi-<name>:before").
ICONS = {
    'router': 0xF11E2,
    'lan': 0xF0317,
    'shield-lock': 0xF099D,
    'server': 0xF048B,
    'harddisk': 0xF02CA,
    'access-point': 0xF0003,
    'power-socket': 0xF0427,
    'battery': 0xF0079,
    'console': 0xF018D,
    'ethernet': 0xF0200,
    'phone': 0xF03F2,
    'camera': 0xF0100,
    'printer': 0xF042A,
    'monitor': 0xF0379,
    'web': 0xF059F,
    'database': 0xF01BC,
    'api': 0xF109B,
    'message': 0xF0361,
    'memory': 0xF035B,
    'pulse': 0xF0430,
    'shield-key': 0xF0BC4,
    'application': 0xF08C6,
    'pin': 0xF0403,
}


def main():
    if len(sys.argv) != 2:
        raise SystemExit('usage: build_pdf_icon_font.py /path/to/materialdesignicons-webfont.ttf')
    src = sys.argv[1]
    tmp = '/tmp/mdi-pdf-subset-tmp.ttf'

    codepoints = sorted(set(ICONS.values()))
    subset.main([
        src,
        '--unicodes=' + ','.join('U+%X' % cp for cp in codepoints),
        '--output-file=' + tmp,
        '--glyph-names', '--notdef-outline', '--recalc-timestamp',
    ])

    font = TTFont(tmp)
    cmap_table = font['cmap']
    best = cmap_table.getBestCmap()  # real codepoint -> glyph name, from the subset's own cmap

    mapping = {}  # real codepoint (hex str, no 0x prefix) -> remapped PUA codepoint
    new_map = {}
    next_pua = 0xE000
    for cp in codepoints:
        glyph_name = best.get(cp)
        if glyph_name is None:
            raise SystemExit('missing glyph for codepoint %X after subsetting' % cp)
        new_map[next_pua] = glyph_name
        mapping[format(cp, 'X')] = next_pua
        next_pua += 1

    new_subtable = CmapSubtable.newSubtable(4)
    new_subtable.platformID = 3
    new_subtable.platEncID = 1
    new_subtable.language = 0
    new_subtable.cmap = new_map
    cmap_table.tables = [new_subtable]

    font.save(OUT_TTF)

    print('Wrote', OUT_TTF)
    print()
    print('ICON_CODEPOINT_MAP for topology_pdf.js:')
    print('{')
    for k, v in mapping.items():
        print("        '\\u{%s}': '\\u%04X'," % (k, v))
    print('}')


if __name__ == '__main__':
    main()
