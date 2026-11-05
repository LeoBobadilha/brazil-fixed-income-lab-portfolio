# Visual design notes

## Colour by job

| Job | Encoding |
|---|---|
| Identity | Fixed entity colours site-wide: Prefixado (nominal) blue, IPCA+ (real) orange, Selic aqua, NTN-B1 (Renda+/Educa+) violet, inflation yellow, gross debt magenta, net debt green |
| Polarity | Diverging blue (positive) ↔ red (negative) with a grey midpoint (scenario heatmap, fiscal balances, reconciliation table) |
| Magnitude/time | Single-hue sequential ramp (price–yield cloud coloured by date) |
| Status | Reserved good/warning/critical colours, always with an icon and a label |

Comparison slots A/B/C use position colours (blue, orange, aqua). The page says so explicitly.

## Validation

Categorical sets that share a chart were checked with the data-viz palette validator (CVD separation, normal-vision floor, contrast) in both modes:

- blue / orange / aqua (all pairs): pass
- orange / violet (all pairs): pass
- magenta / green (adjacent): pass
- orange / magenta / green was rejected (normal-vision ΔE 11.6), so Renda+ uses violet and never shares a scatter with more than one other hue

Where a light-mode colour sits below 3:1 against the surface, the chart also has visible labels or a table view. Text never uses series colours. Link and status text use dedicated tokens (`--accent-text`, `--good-text`) that clear 4.5:1 in both themes, which axe verifies in CI.

## Marks and interaction

- 2 px lines, 4 px rounded bar ends, hairline grids and a single y-axis per chart (no dual axes).
- Crosshair tooltips list the value first, then the series name.
- Every chart card has a table view, so tooltips never gate information.
- Filters sit in one row above the content they scope.

## 3D surface

- Lazy-loaded and renders on demand only (no idle loop).
- DPR capped at 2, paused when hidden or off-screen, context loss handled, all GPU resources disposed on unmount.
- Respects reduced-motion.
- Shares the grid and the clipped colour/height scale with the 2D heatmap, and a test checks that the values match cell by cell.
