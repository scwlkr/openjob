# OpenJob brand foundation

Open [index.html](index.html) directly in a browser. The guide works offline with local artwork, font, styles, and concept controls. To serve it locally from the repository root:

```sh
python3 -m http.server 4027 --bind 127.0.0.1 --directory docs/brand
```

Open `http://127.0.0.1:4027`. Mail, Calendar, Tasks, Agents, and appearance controls are local illustrative concepts. “Create linked task” adds one sample task; permission switches update sample access text. They do not connect accounts or change product data.

## Authority and adoption

Shane supplied [this original brand board](source/openjob-brand-board.png) on 15 October 2026 and asked to use its direction. This folder is the identity source for the OpenJob overhaul. [OpenJob-Master-Mission.md](../../OpenJob-Master-Mission.md) remains the product direction.

The original is preserved unchanged. The folded mark is a geometric reconstruction from the raster image; fine folds and shading are approximations. The board’s exact font is unknown. Inter 4.1 is the chosen match; the wordmark uses outlined Inter Display 700 letterforms with tightened spacing. These SVGs are editable paths and shapes, with no embedded raster image or font dependency.

The shipped `OPENJOB.` / square `O.` identity in `public/brand`, browser/native icons, and native logo components remains legacy artwork. Apply the new masters deliberately during the overhaul, including actual web/native placements, metadata, app icons, and theme tokens. This brand setup does not alter those product surfaces or claim the pictured future capabilities are implemented.

## Vector masters

| File | Use |
| --- | --- |
| [openjob-mark.svg](assets/openjob-mark.svg) | Folded Cobalt mark, 32 px and above, light surfaces |
| [openjob-mark-reverse.svg](assets/openjob-mark-reverse.svg) | Brighter folded mark for Graphite surfaces |
| [openjob-mark-small.svg](assets/openjob-mark-small.svg) | Flat Cobalt geometry at 16–31 px on light surfaces |
| [openjob-mark-mono.svg](assets/openjob-mark-mono.svg) | One-color Graphite mark; print or flat reproduction |
| [openjob-mark-mono-reverse.svg](assets/openjob-mark-mono-reverse.svg) | One-color Chalk mark; small marks on dark surfaces |
| [openjob-wordmark.svg](assets/openjob-wordmark.svg) | Mixed-case OpenJob lettering, Graphite |
| [openjob-wordmark-reverse.svg](assets/openjob-wordmark-reverse.svg) | Mixed-case OpenJob lettering, Chalk |
| [openjob-lockup.svg](assets/openjob-lockup.svg) | Primary mark + wordmark, 120 px wide and above |
| [openjob-lockup-reverse.svg](assets/openjob-lockup-reverse.svg) | Reverse mark + wordmark on Graphite |
| [openjob-app-icon.svg](assets/openjob-app-icon.svg) | 512 px square master; platform supplies the mask |

Preserve proportions and the open center. Leave one ribbon width around the mark and half the mark height around a lockup. Do not add a period, rotate the mark, change its fold direction, or add effects. Use the flat variant when printing cannot reproduce gradients.

## Color and type

The five palette values come from the supplied board: Chalk `#F7F8FA`, Graphite `#20242B`, Cobalt `#4169E1`, Blue Gray `#E7ECF4`, Sage `#83A18C`.

[tokens.css](tokens.css) contains the palette, light/dark semantic roles, font references, spacing unit, and corner radii. Add `openjob-brand` to the application or component root to adopt them. Set `data-theme="dark"` on that root or a descendant to use dark semantic roles. Importing the file alone does not retheme an app. Copy the `fonts/` folder alongside it when relocating the CSS; adjust the relative font URL if necessary.

Use Graphite for text on Chalk (14.65:1) and Sage (5.52:1). White on Cobalt is 4.85:1; Cobalt on Chalk is 4.56:1. Sage on Chalk is 2.66:1 and needs a darker semantic color for normal text. Blue Gray on Chalk is 1.12:1, suitable for decorative separators or selected fills; essential control edges need `--oj-control-line` or another sufficient indicator. Add text or icons alongside color states.

The reverse identity uses brighter Cobalt folds; dark links use `#9BB4FF`. White button text retains the standard Cobalt fill. Body text uses Inter 400, headings 600, display/wordmark 700. Use 16 px body text with 1.55 leading, UI labels at 13–14 px, and system monospace for commands. The compact concept is an illustrative brand application, not a production typography specification.

## Font source and reproduction

- Typeface: [Inter](https://rsms.me/inter/), Rasmus Andersson and contributors.
- Pinned source: [official Inter 4.1 release](https://github.com/rsms/inter/releases/tag/v4.1), `Inter-4.1.zip` → `web/InterVariable.woff2`.
- License: [SIL Open Font License 1.1](fonts/LICENSE.txt), retained from the same archive.
- Font SHA-256: `693b77d4f32ee9b8bfc995589b5fad5e99adf2832738661f5402f9978429a8e3`.
- Original board SHA-256: `7de52422eba6fee913074e8d9b35803af302316de712c4c0e61785ab9383b26b`.

`generate_assets.py` rebuilds the ten masters from geometric paths and the bundled font. Its optional build dependency is `fonttools[woff]`; the guide and SVGs need no Python package at runtime. With that dependency available:

```sh
python3 docs/brand/generate_assets.py
```

## Voice

Use “OpenJob”, “Mail. Calendar. Tasks.”, and “Clear space. Focused work.” Explain capabilities with concrete actions and limits. Say “Can read this mailbox and create drafts. Sending is off.” Describe the broader workspace as product direction until its workflows are verified. Keep provider compatibility and platform coverage tied to observed support.
