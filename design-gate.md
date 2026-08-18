# DESIGN GATE - peoples-of-africa

Written before system 2, per the brief. Every item below is checked against the
`npm run verify` screenshots (3 zooms + panel-open) and marked pass/fail in the
final column. Judged 18 Aug 2026 against verify/screenshots/* (run: VERIFY PASS, 20/20). A fail on any item fails the gate.

The standard: the 1971 NatGeo pair reborn - dense but legible, information-first,
museum-grade restraint. Not a tech demo of a globe.

| # | check | how judged | pass |
|---|-------|-----------|------|
| 1 | **Map is the page.** The globe occupies ≥80% of the viewport; all chrome (legend, scrubber, card) is peripheral and recedes. | screenshot at all 3 zooms | pass — globe fills the frame; masthead/legend/timeline are backed peripheral cards |
| 2 | **Colour explains, never decorates.** Every territory fill is one of the language-family key colours. No colour on screen that isn't family key, earth tone, or ink. | screenshot + palette audit of UI CSS | pass — territory fills are the 6-key only; heritage washes earth-toned; UI is ink on near-black |
| 3 | **Relief-toned earth.** Physical base reads as muted printed relief - not satellite photography, not flat vector fill, not neon. Family fills sit on it like ink washes on paper. | screenshot at continental zoom | pass — NE1 desaturated to print tone in-shader; washes at 0.52 alpha read as ink |
| 4 | **Density grows as you approach.** Continental zoom shows only the majors and still composes; closest zoom carries ≥150 labels with zero overlap. The map rewards leaning in. | label audit + screenshots | pass — 117 labels at 2.35 -> 196 at 1.6, grid in verify; 82% coverage at 1.25 |
| 5 | **Hand-set cartographic type.** Peoples names run along territory centrelines, curved where the land curves, letterspaced, sized by territory area. Serif display for peoples; mono micro-type for metadata. No grid of horizontal labels. | screenshot at mid + close zoom | pass — principal-axis curved baselines, area-sized, tracked caps; mono micro-labels |
| 6 | **No pills. No chips.** No rounded-capsule element anywhere, any size, any purpose. Interactive elements are rectilinear (border-radius ≤ 2px). | DOM/CSS audit + screenshots | pass — max border-radius 2px; no capsule anywhere |
| 7 | **The side card is editorial.** Reads as a magazine column: display serif headline, measure ≤ 66ch, hairline rules, sources footnoted. No stat tiles, no icon rows, no dashboard furniture. | panel-open screenshot | pass — serif display head, hairline rules, 66ch measure, sourced footer; no tiles |
| 8 | **Motion passes the purpose test.** Hover/pick feedback ≤ 180ms; card always enters and exits the same direction; zero idle/ornamental animation; zero animation on keyboard-initiated actions. | code audit + interaction capture | pass — card always slides from right 240ms (reduced-motion: none); hover 140ms; labels settle-fade; keyboard steps instant |
| 9 | **Heritage reads as historical cartography.** Polity extents are tinted washes with dated small-caps labels; the year scrubber is a timeline rule with ticks and set dates - not a media-player slider. | heritage-layer screenshot | pass — tinted washes + dated small-caps from 12px; scrubber is a ruled timeline with set ticks |
| 10 | **Restraint.** No glow filters, no drop-shadow soup, no gradients except limb/atmosphere shading. UI ink palette ≤ 3 hues outside the family key. | screenshot + CSS audit | pass — no glow/shadow; text halo is a cartographic stroke; only limb shading gradient |
| 11 | **The surround recedes.** Page ground is near-black museum wall; the lit globe is the only light source in the composition. | screenshot at all zooms | pass — #0a0a0c ground; the lit globe is the composition's light source |
| 12 | **Sources are credited.** Family key legend legible at rest; Murdock/Nunn, Glottolog, Natural Earth credited in micro-mono type on the page, not buried. | screenshot | pass — Murdock/Nunn, Glottolog, Natural Earth in legend; per-item sources in cards |