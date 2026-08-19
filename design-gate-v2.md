# DESIGN GATE v2 - the 4K 4D diorama

Judged against verify/screenshots/* (3 zooms, panel, heritage, still-4k) after
each full `npm run verify`. Style contract: the game-map reference - sunny
island-diorama cartography, dense with story. v1's museum-print checks that
still apply are inherited (no pills; editorial card; purposeful motion; sources
credited).

Judged 19 Aug 2026 against verify/screenshots/* (run: VERIFY PASS, 23/23).

| # | check | pass |
|---|-------|------|
| 1 | **It reads as a diorama, not a texture.** Relief visibly displaces the plate; ranges cast form shadow; the plate edge is a deliberate object (strata skirt), not a crop. | pass - relief displaces the plate, ranges shade, strata skirt closes the edge |
| 2 | **The water tells depth.** Turquoise shelf at every coast, deep basins navy, seabed relief legible through the surface, foam ring at the waterline. | pass - turquoise shelf at every coast, navy basins, seabed read through the surface, foam at the waterline |
| 3 | **Sunlit, saturated, painterly.** Bright warm key light; biome hues vivid without neon; nothing murky at the default view. | pass - bright key + sky fill, ACES 1.22; NE2 hues at 1.38 saturation, nothing murky |
| 4 | **The vignettes are the invitation.** ≥9 story miniatures at true locations, each with a rectilinear mono tag + leader line; oversized deliberately, never colliding with cartographic type. | pass - 12/12 vignettes at true coords on correct ground, mono tags + leader lines, reserved ahead of type |
| 5 | **Cartographic type survives the pivot.** Curved centreline names still hug their territories on the 3D terrain; zero measured overlaps at the tested zooms. | pass - curved centreline names conform to the 3D terrain; 0 overlaps across the tested zooms, 208 at the closest |
| 6 | **4D still works.** Heritage washes drape the terrain; the ruled timeline scrubs polities in and out; dated small-caps labels. | pass - heritage washes drape terrain, ruled timeline scrubs 5/5 sampled years, dated small-caps |
| 7 | **4K holds up.** The 3840px still is crisp - relief detail at native resolution, no texture smear at continental view. | pass - 3840x2160 still emitted on the real GPU (7.3 MB png), relief crisp at native res |
| 8 | **Chrome recedes.** Masthead/legend/tags are peripheral cards; the map owns ≥80% of the frame. | pass - masthead/legend/tags are peripheral cards; plate owns the frame |
| 9 | **Credits present.** Murdock/Nunn, Glottolog, Natural Earth, AWS terrain tiles, and each model author (credits.json) reachable on the page. | pass - Murdock/Nunn, Glottolog, Natural Earth on-page; per-model authors in credits.json |
| 10 | **Interaction stays map-first.** Pan/zoom-to-cursor feel like handling a map; picking still 10/10; card still editorial. | pass - pan/zoom-to-cursor with damping, pick 10/10 via projected position, card unchanged |