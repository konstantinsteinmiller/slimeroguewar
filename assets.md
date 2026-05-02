# Slime Rogue War — Asset Manifest

Every image and audio path the runtime references, organized by where it gets loaded. Drop matching files into `/public/...` to override the procedural fallbacks — the runtime checks `getCachedImage(...).complete && naturalWidth > 0` before drawing the sprite, so missing files silently fall back to the programmatic art (no console errors).

Resolution suffixes are part of the filename so a future device-pixel-ratio split can pick `_128x128` on low-DPI and `_256x256` on retina without renaming code paths.

---

## Currently shipped (already in `/public/images/`)

| Path | Used by | Notes |
|------|---------|-------|
| `images/logo/logo_256x256.webp` | FLogoProgress splash | Centered conic-mask reveal during boot, shrinks to top-left corner when done. |
| `images/bg/parchment-ribbon_553x188.webp` | FReward overlays | Ribbon header behind STAGE CLEAR / DEFEATED captions. |
| `images/bg/bg-tile_400x400.webp` | Splash backdrop | Repeating background tile during boot. |
| `images/bg/bg_1024x1024.webp` | Arena play-field | Tiled inside the canvas via `ctx.createPattern(..., 'repeat')`. The runtime overlays a soft dark vignette (0.18 alpha) on top so slimes and bullets stay readable. Procedural grid fallback paints when the asset isn't decoded yet. |
| `images/icons/settings-icon_128x128.webp` | Bottom-left settings button | Gear glyph. |
| `images/icons/sound-icon_128x128.webp` | Reserved | Currently unused; keep available for future mute/volume UI. |
| `images/icons/difficulty-icon_128x128.webp` | OptionsModal | Difficulty radio header. |
| `images/icons/team_128x128.webp` | Reserved | |
| `images/icons/gears_128x128.webp` | Reserved | |
| `images/icons/movie_128x96.webp` | RouletteWheel "Spin Again" CTA | Ad-rewarded button glyph. |
| `images/icons/chest_128x128.webp` | TreasureChest | Lockable / unlocked-state icon. |
| `images/icons/trophy_128x128.webp` | BattlePass + leaderboard | |
| `images/models/slimes/player_256x256.webp` | Player slime | Hero sprite — skipped from the per-kind multiply tint so its colors come through. |
| `images/models/slimes/player_128x128.webp` | Player slime (low-DPI) | |
| `images/models/slimes/slime_256x256.webp` | Mob slimes | Shared mob art, tinted per-kind via canvas multiply pass (green / blue / red / purple). |
| `images/models/slimes/slime_128x128.webp` | Mob slimes (low-DPI) | |
| `images/models/slimes/slime-tower_256x256.webp` | Bosses + late-stage tough mobs | Auto-selected for `kind: 'boss'` and any non-boss slime above the radius-22 threshold (~stage 33+). |
| `images/models/slimes/slime-tower_128x128.webp` | Bosses + tough mobs (low-DPI) | |
| `images/models/bullet_256x256.png` | Player auto-aim projectiles | North-oriented sprite — the runtime applies a +90° rotation so the tip points along the velocity vector. |
| `images/models/bullet_128x128.png` | Player projectiles (low-DPI) | |
| `images/models/slime-drop_256x256.webp` | Slime-drop currency icon | Used by `IconSlimeDrop.vue` (HUD badges, modals, FReward tags), `useCoinExplosion` VFX, the canvas drop-pickup renderer, and the RouletteWheel segment glyph. Procedural drop silhouette stays as the fallback whenever the asset is missing. |
| `images/models/slime-drop_128x128.webp` | Slime-drop currency icon (low-DPI) | |

---

## To-do art (drop in to replace procedural fallbacks)

These names are referenced by the runtime as the override paths. Until a file exists at the path, the procedural draw renders. The procedural versions are usable but the artist sprites will be sharper.

### Boss artillery cluster ability (`useSlimeGame.ts`)
| Path | Description | Procedural fallback |
|------|-------------|----------------------|
| `images/vfx/artillery-marker_64x64.webp` | Pre-impact ground marker — blinking red dot with a thin ring footprint. The blink rate accelerates as impact approaches. Should be a single static frame; the runtime handles the blink + ring. | Pulsing red ring with a center dot and four cardinal tick marks. |
| `images/vfx/artillery-impact_256x256.webp` | Impact explosion frame — bright yellow-white burst. Single frame; the runtime fades the alpha and expands the radius over the 0.4s display window. Particles + camera shake are spawned separately so the sprite only needs the central burst. | Radial gradient (white → orange → transparent) with a bright outline ring. |
| `images/vfx/boss-cast-aura_256x256.webp` | Boss telegraph aura — orange/yellow glow behind the boss during the 1-second windup. Should read as "this boss is charging an attack". | Pulsing concentric orange rings + a soft fill glow. |

### Jumper slime (`useSlimeGame.ts`)
| Path | Description | Procedural fallback |
|------|-------------|----------------------|
| `images/vfx/jumper-charge-stripe_256x64.webp` | Ground stripe pointing from a charging jumper toward its lunge target. Tapered yellow/orange tongue, longer at the wide end. The runtime rotates it to align with the lunge axis and tiles it once at length 256 px. | Triangle-tapered yellow gradient, fades to transparent at the far end. |

### Disease/fire DoT (`useSlimeGame.ts`)
| Path | Description | Procedural fallback |
|------|-------------|----------------------|
| `images/vfx/burning-flame_64x64.webp` | Overlay drawn on enemies under the player's fire DoT (`fireDot` upgrade). Should read as a soft flame halo — the runtime applies a flicker alpha multiplier and renders it at 2.2× the slime radius. | Flickering orange ring + three small tear-drop "flames" rising from the slime crown. |

---

## Optional / nice-to-have audio (paths referenced by `useSound.ts`)

The slime build reuses chaos-arena's sound bank. Drop files at these paths to extend coverage; without them, fallback or silence applies. Order is the priority for an asset pass.

| Path | Trigger | Notes |
|------|---------|-------|
| `audio/sfx/artillery-warn.ogg` | Cluster markers spawn (boss tele­graph end) | Suggested: brief whistle / mortar drop. |
| `audio/sfx/artillery-impact.ogg` | Each marker explodes | Suggested: heavy thump + glass-shatter tail. |
| `audio/sfx/jumper-charge.ogg` | Jumper enters `charging` state | Suggested: rising hiss for ~0.75s. |
| `audio/sfx/jumper-lunge.ogg` | Jumper releases lunge | Suggested: short "thwip" / pounce. |
| `audio/sfx/level-up.ogg` | Player levels up (already present) | Already shipped — keep it. |

---

## Path-format conventions

- All sprites live under `/public/images/...` (Vite copies `public/` to the dist root verbatim, so the `images/...` paths resolve at runtime as `<base>/images/...`).
- Audio under `/public/audio/sfx/` and `/public/audio/music/`.
- File names: kebab-case + `_WIDTHxHEIGHT.ext`. The size suffix is non-load-bearing today (each path is referenced as a single resolution) but kept consistent for clarity.
- WebP for static decals + slime art (smallest file). PNG for projectiles where edge fidelity matters more than size. OGG for audio.
- Don't reference paths from `src/...` directly — anything that needs to be cached should go through `getCachedImage(src)` (`useAssets.ts`) so it lands in the shared image cache.

---

## Loading priority

Splash-blocking tier (`STATIC_IMAGES` in `useAssets.ts`) — these load before the splash hands off to the arena, so the very first frame is textured:

- `images/logo/logo_256x256.webp`
- `images/icons/*` (every icon listed above)
- `images/bg/parchment-ribbon_553x188.webp`
- `images/bg/bg-tile_400x400.webp`
- `images/models/slimes/player_*.webp`
- `images/models/slimes/slime_*.webp`
- `images/models/slimes/slime-tower_*.webp`
- `images/models/bullet_*.png`
- `images/models/slime-drop_*.webp`

Deferred tier — runs after splash exits, fire-and-forget. Currently includes the legacy chaos-arena VFX list (`big-spark`, `dark-smoke`, `earth-rip-decal`, `explosion`); the new slime VFX above (artillery markers, jumper stripe, boss aura) **don't currently appear in this list** — they're demand-loaded the first time `getCachedImage` is asked for them. If a future asset pass causes noticeable first-cast hitching, add them to the deferred preload tier in `useAssets.ts`.
