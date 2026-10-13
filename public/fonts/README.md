# PDF 字體

`jiahe-cjk-regular.ttf` is the static regular-weight instance of Noto Sans TC from
Google Fonts, retaining all glyphs supported by the source font. It is used for
Traditional Chinese PDF exports and is distributed under the SIL Open Font
License in `OFL-NotoSansTC.txt`.

Source: https://github.com/google/fonts/tree/main/ofl/notosanstc

The source variable font is instantiated at `wght=400` using FontTools 4.66.1. PDF
exports embed the complete static font because dynamic TrueType subsetting can
omit composite CJK outlines. Optional OpenType substitution features are
disabled so mixed Latin letters, digits and CJK text retain correct widths and
Unicode mappings. Unsupported Unicode characters
are represented by their codepoint so that values are never silently removed.

Source SHA-256: `864727d210d54f2537bbe23b3a839436c3992af72de9322af5270897246bd44f`

Static regular SHA-256: `6261c76f3067bc57ac1fea55b9fd4dc5164eb04bb94c70e678b0e9ac19b4e25d`
