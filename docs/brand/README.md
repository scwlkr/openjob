# OpenJob brand foundation

Open [index.html](index.html) directly in a browser. The guide works offline with local artwork, font, styles, and concept controls. To serve it locally from the repository root:

```sh
python3 -m http.server 4027 --bind 127.0.0.1 --directory docs/brand
```

Open `http://127.0.0.1:4027`. Mail, Calendar, Tasks, Agents, and appearance controls are local illustrative concepts. “Create linked task” adds one sample task; permission switches update sample access text. They do not connect accounts or change product data.

## Authority and adoption

Shane supplied [this original brand board](source/openjob-brand-board.png) on 15 October 2026 and asked to use its direction. This folder is the identity source for the OpenJob overhaul. [The master mission](../MASTER_MISSION.md) remains the product direction.

The original is preserved unchanged. The folded mark is a geometric reconstruction from the raster image; fine folds and shading are approximations. The board’s exact font is unknown. Inter 4.1 is the chosen match; the wordmark uses outlined Inter Display 700 letterforms with tightened spacing. These SVGs are editable paths and shapes, with no embedded raster image or font dependency.

This is the standard identity for the web, iOS, and Android apps. The apps use the folded mark, outlined mixed-case lockup, local Inter, and shared light/dark semantic roles. Browser metadata, install icons, native adaptive icons, and splash artwork use the same masters. The pictured Mail, Calendar, and agent-mail workflows remain illustrative product direction. Current Task and Group behavior stays grounded in the master mission.

## Applying the identity

Future agents must read this page and the visual guide before changing app styling. [AGENTS.md](../../AGENTS.md) points here. Use the mixed-case **OpenJob** name without a period. Keep the folded mark and its proportions; use the reverse lockup on dark surfaces. Use semantic color roles for actions, text, selection, controls, and status rather than substituting palette colors by appearance.

```sh
npm run brand:assets  # rebuild platform assets and adapters from these sources
npm run brand:check   # fail when a source or generated output is stale
```

The generator owns `public/brand/`, browser/install/social images, `public/site.webmanifest`, `app/brand-tokens.css`, `native/src/brand-assets.ts`, `native/src/brand-tokens.ts`, and `native/assets/fonts/`. Edit the sources here or `scripts/brand-assets.mjs`, then regenerate. The deterministic test gate checks freshness using source/generator hashes and saved output hashes in `generated-assets.json`. Check mode does not rerasterize, so platform rendering differences do not invalidate an unchanged generated set. Regeneration updates the saved hashes alongside the outputs.

Web components use `app/openjob-brand.tsx` and global semantic tokens, following system appearance. Native components use `native/src/brand-marks.tsx` and `native/src/theme.tsx`, with the same semantic roles and local Inter weights 400/600/700. Preserve 44 px web and 48 dp native touch targets, legible state labels, focus indicators, and provider-specific sign-in requirements. Put future shared visual decisions here before adding competing styles.

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
| [openjob-social-card.svg](assets/openjob-social-card.svg) | Outlined 1200 × 630 social card; local font outlines |

Preserve proportions and the open center. Leave one ribbon width around the mark and half the mark height around a lockup. Do not add a period, rotate the mark, change its fold direction, or add effects. Use the flat variant when printing cannot reproduce gradients.

## Color and type

The five palette values come from the supplied board: Chalk `#F7F8FA`, Graphite `#20242B`, Cobalt `#4169E1`, Blue Gray `#E7ECF4`, Sage `#83A18C`.

[tokens.css](tokens.css) contains the palette, light/dark semantic roles, font references, spacing unit, and corner radii. Add `openjob-brand` to the application or component root to adopt them. Set `data-theme="dark"` on that root or a descendant to use dark semantic roles. Importing the file alone does not retheme an app. Copy the `fonts/` folder alongside it when relocating the CSS; adjust the relative font URL if necessary.

Use Graphite for text on Chalk (14.65:1) and Sage (5.52:1). White on Cobalt is 4.85:1; Cobalt on Chalk is 4.56:1. Sage on Chalk is 2.66:1 and needs a darker semantic color for normal text. Blue Gray on Chalk is 1.12:1, suitable for decorative separators or selected fills; essential control edges need `--oj-control-line` or another sufficient indicator. Add text or icons alongside color states.

The reverse identity uses brighter Cobalt folds; dark links use `#9BB4FF`. White button text retains the standard Cobalt fill. Body text uses Inter 400, headings 600, display/wordmark 700. Use 16 px body text with 1.55 leading, UI labels at 13–14 px, and system monospace for commands. The compact concept is an illustrative brand application, not a production typography specification.

## Font source and reproduction

- Typeface: [Inter](https://rsms.me/inter/), Rasmus Andersson and contributors.
- Pinned source: [official Inter 4.1 release](https://github.com/rsms/inter/releases/tag/v4.1), `Inter-4.1.zip` → `web/InterVariable.woff2`.
- Native font sources from the same archive: `extras/ttf/Inter-Regular.ttf`, `Inter-SemiBold.ttf`, and `Inter-Bold.ttf`, retained here and copied to `native/assets/fonts` by `npm run brand:assets`. Native apps load these local files; web uses the local variable WOFF2. Both retain the same OFL license.
- License: [SIL Open Font License 1.1](fonts/LICENSE.txt), retained from the same archive.
- Font SHA-256: `693b77d4f32ee9b8bfc995589b5fad5e99adf2832738661f5402f9978429a8e3`.
- TTF SHA-256: Regular `40d692fce188e4471e2b3cba937be967878f631ad3ebbbdcd587687c7ebe0c82`; SemiBold `78a843fade9d4612a5567302fb595b56976eb5fcebf4fea5a5912d638bafcde3`; Bold `288316099b1e0a47a4716d159098005eef7c0066921f34e3200393dbdb01947f`.
- Original board SHA-256: `7de52422eba6fee913074e8d9b35803af302316de712c4c0e61785ab9383b26b`.

`generate_assets.py` rebuilds the eleven masters from geometric paths and the bundled font. Its optional build dependency is `fonttools[woff]`; the guide and SVGs need no Python package at runtime. With that dependency available:

```sh
python3 docs/brand/generate_assets.py
```

## Voice

Use “OpenJob”, “Mail. Calendar. Tasks.”, and “Clear space. Focused work.” Explain capabilities with concrete actions and limits. Say “Can read this mailbox and create drafts. Sending is off.” Describe the broader workspace as product direction until its workflows are verified. Keep provider compatibility and platform coverage tied to observed support.
