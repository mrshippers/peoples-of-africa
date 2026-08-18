# DESIGN GATE - peoples-of-africa

Written before system 2, per the brief. Every item below is checked against the
`npm run verify` screenshots (3 zooms + panel-open) and marked pass/fail in the
final column. A fail on any item fails the gate.

The standard: the 1971 NatGeo pair reborn - dense but legible, information-first,
museum-grade restraint. Not a tech demo of a globe.

| # | check | how judged | pass |
|---|-------|-----------|------|
| 1 | **Map is the page.** The globe occupies ≥80% of the viewport; all chrome (legend, scrubber, card) is peripheral and recedes. | screenshot at all 3 zooms | |
| 2 | **Colour explains, never decorates.** Every territory fill is one of the language-family key colours. No colour on screen that isn't family key, earth tone, or ink. | screenshot + palette audit of UI CSS | |
| 3 | **Relief-toned earth.** Physical base reads as muted printed relief - not satellite photography, not flat vector fill, not neon. Family fills sit on it like ink washes on paper. | screenshot at continental zoom | |
| 4 | **Density grows as you approach.** Continental zoom shows only the majors and still composes; closest zoom carries ≥150 labels with zero overlap. The map rewards leaning in. | label audit + screenshots | |
| 5 | **Hand-set cartographic type.** Peoples names run along territory centrelines, curved where the land curves, letterspaced, sized by territory area. Serif display for peoples; mono micro-type for metadata. No grid of horizontal labels. | screenshot at mid + close zoom | |
| 6 | **No pills. No chips.** No rounded-capsule element anywhere, any size, any purpose. Interactive elements are rectilinear (border-radius ≤ 2px). | DOM/CSS audit + screenshots | |
| 7 | **The side card is editorial.** Reads as a magazine column: display serif headline, measure ≤ 66ch, hairline rules, sources footnoted. No stat tiles, no icon rows, no dashboard furniture. | panel-open screenshot | |
| 8 | **Motion passes the purpose test.** Hover/pick feedback ≤ 180ms; card always enters and exits the same direction; zero idle/ornamental animation; zero animation on keyboard-initiated actions. | code audit + interaction capture | |
| 9 | **Heritage reads as historical cartography.** Polity extents are tinted washes with dated small-caps labels; the year scrubber is a timeline rule with ticks and set dates - not a media-player slider. | heritage-layer screenshot | |
| 10 | **Restraint.** No glow filters, no drop-shadow soup, no gradients except limb/atmosphere shading. UI ink palette ≤ 3 hues outside the family key. | screenshot + CSS audit | |
| 11 | **The surround recedes.** Page ground is near-black museum wall; the lit globe is the only light source in the composition. | screenshot at all zooms | |
| 12 | **Sources are credited.** Family key legend legible at rest; Murdock/Nunn, Glottolog, Natural Earth credited in micro-mono type on the page, not buried. | screenshot |  |
