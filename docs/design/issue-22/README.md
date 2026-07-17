# Issue #22 visual acceptance contract

Source: Codex task `019f70a4-5a9e-7763-92d0-de080213fc66`.

Variant B (People stacks) is the selected direction. These artifacts are the primary visual reference for issue #22; prose requirements and automated checks supplement them but do not replace them.

## Required visual hierarchy

- Keep the signed-in shell light and quiet: OpenJob brand, selected Group control, and one blue new-Task action.
- Use one compact segmented `Open` / `Done` / `All` control.
- Organize Tasks into ownership-first Member panels: avatar, Username, Task count, and a compact blue add action in each current-Member header.
- Nest clean Task rows inside each Member panel with a large, unmistakable completion control and subdued metadata.
- Use one full-width Member-panel column on phones and an adaptive two-column grid on larger screens.
- Preserve the prototype's spacing, density, and hierarchy while translating its rounded surfaces into OpenJob's requested boxy language: near-square corners, ink borders, restrained elevation, off-white surfaces, and blue emphasis.

## Decisions made after the prototype screenshot

- The selected Group Name is the only page heading. Do not render `People`, `Task List by owner`, role, or Group ID in the primary Task List header.
- `Open` means unfinished, `Done` means completed, and `All` combines both.
- Only Member sections containing Tasks matching the current filter render.
- Existing accessibility, Task lifecycle, Group navigation, and governance requirements remain in force.

The original mobile image still contains the discarded `People` and `Task List by owner` labels. It is authoritative for composition, proportions, control placement, panel structure, and visual rhythm—not for those superseded labels.

## Artifacts

- `variant-b-mobile-original.png`: selected mobile prototype captured during the design session.
- `variant-b-desktop-original.png`: the same selected prototype rendered at 1440 by 1000 pixels.
- `prototype.html`: the full original three-variant throwaway prototype; open with `?variant=B` for the selected direction.
- Playwright `variant-b-phone` and `variant-b-desktop` baselines under `tests/browser/openjob-web.spec.ts-snapshots/`: the production implementation after applying the content decisions above.
