# BRIEF v2 ADDENDUM - 4K 4D cartography

Amends the original brief after review (19 Aug 2026). The presentation pivots;
the data spine, systems discipline, and verify harness carry over.

## The pivot

The globe reads museum. The target reads **game-map cinematic** (reference:
tilted island diorama - saturated biomes, turquoise shallow-water shelf, seabed
relief visible through the water, story vignettes pinned to real places,
floating label tags).

- **Flat-earth Africa:** the continent as a tilted diorama plate, not a sphere.
  Real relief (terrain + bathymetry), vertical exaggeration for drama.
- **4K:** 4096px baked albedo with relief definition from z7 elevation tiles;
  renderer at native dpr; verify emits 3840px stills.
- **4D:** the heritage year scrubber is the fourth dimension - retained.
- **Vignettes:** low-poly CC0 models placed at true locations (giraffe on
  safari in the Serengeti/Kenya, camel caravan in the Sahara, gorillas in the
  Congo, pyramids at Giza, dhow off Zanzibar, baobab in Madagascar…), each
  with a reference-style tag. Attribution recorded in credits.json.
- **Peoples + heritage layers** reproject onto the terrain and keep their
  gates (pick 10/10, scrubber match, label collision zero).

## Broken v1 constraints, declared per the prime directive

| v1 constraint | v2 reality | why |
|---|---|---|
| data payload ≤ 2.5 MB | ≤ 12 MB, progressive (terrain first paint ≤ 2.5MB, vignettes/4K stream after) | 4K albedo + heightmap + models cannot fit 2.5MB; the look is the requirement |
| muted print palette (design gate v1 #3/#10) | saturated painterly grade | style contract changed by the reference |
| relief base from NE1 50m | z7 terrarium DEM (~300m/px) + NE2 hues | 50m raster is not 4K definition |
| TTI ≤ 4000 ms on Fast 3G | ≤ 6000 ms, measured to *terrain visible* (not a blank frame) | arithmetic: the smallest honest first paint is the JS bundle (299 kB gz) + height_lo (60 kB) + albedo_lo (55 kB) = 414 kB, which is 2.3 s of transfer at 180 kB/s before a single round-trip, parse, or GPU upload. 4000 ms was set against a v1 with no terrain mesh. Measured: 5041 ms |

Unchanged: no pills, no NatGeo artwork, open sources only, purposeful motion,
static deploy, verify before "done", stop rule.

## v2 budget deltas

| metric | target |
|---|---|
| first-paint payload (JS + terrain LOD0) | ≤ 3.5 MB gz |
| total lazy payload | ≤ 12 MB |
| albedo resolution | 4096 × 4096 |
| vignettes placed, inside correct region | ≥ 9, 100% |
| frame p95 (vsync-relative, headful GPU) | ≤ blank×1.15 @ ≥ 57 fps |
| everything else | as v1 table |
