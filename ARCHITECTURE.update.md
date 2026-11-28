# ARCHITECTURE.md: sections to replace / merge (map + render)

> Your `ARCHITECTURE.md` was not in the uploaded file, so this is a drop-in replacement for the **map** and **render look** sections only.
> Paste these over the old District / scene.js descriptions and leave the rest of the file as it is.

## game/maps.js: DISTRICT_MAP (combat-parkour arena)

Bright, sunlit sword-duel arena, 4600 x 3200 (hw 2300, hd 1600), point-symmetric (x, z) -> (-x, -z). All numbers in original 2.5D units. 25 boxes (8 floating), 4 pillars, 6 ramps, 2 holes.
`validateMap(DISTRICT_MAP)`: 0 errors, 0 sealed pockets, minimum spawn clearance 470 (>= 250 required).

| Zone | Contents |
|---|---|
| Centre duel sanctuary | raised platform (hw 460, hd 340, h70) + 4 access ramps 0 -> 70 (14 deg): E / W ramps (hw 140, hd 300), N / S ramps (hw 220, hd 140, offset west / east of the pits) |
| Ring-out pits | skylight holes hw 320, hd 160 at (480, -560) and (-480, 560): uppercuts / slashes knock duellists into them |
| Aerial layer | 2 titanium skybridges (y0 155 .. 175, hw 700) and 2 coral wall-run billboards (y0 195 .. 375, hw 560): grapple up, Dive Slam down onto the platform |
| N / S wall-run chains | 6 cobalt panels, 850 long, 22 thick, 240 high, lanes 402 apart centre to centre (380 face to face). North flows east -> west: W1 -> W2 -> W3 -> saffron pad (h118) -> 15 degree downhill speed ramp (360 wide, 440 long) aimed back at the centre. South = twin |
| E / W avenues | open, 4 low limestone cover blocks (h60) |
| Corners | 4 grapple spires (h420, saffron caps), 4 swing pillars (r40, h300) |
| Runout | >= 400 units of open floor around the perimeter (spawns live there) |

Palette `C` (true colours): DECK 0x5c6b7a, COVER 0xd8dee6, BRIDGE 0xeef2f6, WALL 0x2563eb, BILL 0xe85d3f, PAD / SPEED 0xf59e0b, TOWER / PILLAR 0x334155.
Shared helpers `boxSpan`, `floorSlabs`, `rampSpan`, `validateMap` are unchanged.

## render/scene.js: look

Bright, crisp, sunlit architecture (Mirror's Edge / Overwatch). No dark neon, no background geometry.

- Sky gradient `#4b92db` -> `#9ecfff` -> `#e8f3fc`; fog `0xdbeaf7` (near 240, far 1150).
- Lights: `HemisphereLight(0xf0f7ff, 0x8a96a3, 1.85)` + warm-white `DirectionalLight(0xfffcf5, 1.65)` at offset [34, 70, 24] (~60 degrees up). Shadow map stays 1024 x 1024.
- Neutral tone mapper (guarded, three r162+) at exposure 0.9 (`EXPOSURE`) so bright surfaces roll off without hue shifts.
- Procedural textures (CanvasTexture, generated once, no image assets): poured-concrete floor `#c8d0d8` with grain and `#9aa5b1` expansion seams on a 5 m tile; brushed panel texture on every box and ramp, UVs rescaled per face so one tile = 2.5 m.
- Painted accent bands (matte `MeshStandardMaterial`, roughness 0.5, metalness 0.1, nothing emissive), batched into InstancedMesh draw calls: white / deep-cobalt stripes on wall-run panels, white face panels on billboards, teal + white bands on spires and pillars, white edge strips on pads, white edge lines + gold chevrons (pointing downhill) on speed ramps.
- Grapple rope is deep teal (`0x0e7490`) so it reads on the bright sky.
