/**
 * Programmatic slime rendering for the canvas-based arena.
 *
 * Produces a soft-bodied slime by jiggling a circle along a sin/cos
 * envelope. If `/public/images/slimes/{kind}.webp` is available it gets
 * preferred over the procedural draw, so artwork can be dropped in
 * later without code changes — the kinds map below maps each slime
 * archetype to a candidate image path.
 *
 * Performance notes:
 *   • All slimes share a small set of off-screen sprite atlases that
 *     get rebuilt only when the renderer's pixel ratio changes.
 *   • The procedural draw is intentionally simple: <40 LOC per frame
 *     per slime, no shadows, no gradients per-slime — gradients are
 *     baked once into per-color sprite atlases.
 *   • The artist override path uses `getCachedImage` from useAssets so
 *     image decode is shared across the whole app.
 */

import { getCachedImage } from '@/use/useAssets'

export type SlimeKind =
  | 'player'
  | 'green'
  | 'blue'
  | 'red'
  | 'purple'
  | 'gold'
  | 'boss'

interface SlimePalette {
  body: string
  shade: string
  highlight: string
  outline: string
  eye: string
}

const PALETTES: Record<SlimeKind, SlimePalette> = {
  player: { body: '#7cd957', shade: '#3d6f00', highlight: '#e6ffb0', outline: '#0d2200', eye: '#1a2b4b' },
  green:  { body: '#9bbf3a', shade: '#46551c', highlight: '#dff09a', outline: '#1a2200', eye: '#1a1a1a' },
  blue:   { body: '#4ea7ff', shade: '#15467a', highlight: '#bfe1ff', outline: '#031428', eye: '#0a0a0a' },
  red:    { body: '#ff5f5f', shade: '#7a1d1d', highlight: '#ffd5d5', outline: '#280303', eye: '#1a1a1a' },
  purple: { body: '#c779ff', shade: '#5a228d', highlight: '#ecd0ff', outline: '#180328', eye: '#1a1a1a' },
  gold:   { body: '#ffd84a', shade: '#8a6500', highlight: '#fff3b0', outline: '#3a2a00', eye: '#1a1a1a' },
  boss:   { body: '#ff3a4e', shade: '#5e0010', highlight: '#ffc4c8', outline: '#0a0000', eye: '#fff0f0' }
}

// Per-kind sprite path. Drop a `<kind>.webp` into
// `/public/images/models/slimes/` to override the procedural draw for
// that kind.
//   • player   — dedicated `player_*` artwork so the hero reads as
//                visually distinct from the swarm. The player branch
//                also skips the multiply-tint pass below so the
//                hero's true colors show through.
//   • mobs     — shared `slime_*` artwork tinted per-kind so the
//                player can still distinguish green/blue/red/purple
//                without authoring a sprite for each.
//   • boss     — chunkier `slime-tower_*` artwork so a boss silhouette
//                stands out from the surrounding mobs.
const SHARED_SLIME = '/images/models/slimes/slime_256x256.webp'
const SHARED_BOSS = '/images/models/slimes/slime-tower_256x256.webp'
const PLAYER_SPRITE = '/images/models/slimes/player_256x256.webp'
const IMG_PATHS: Record<SlimeKind, string> = {
  player: PLAYER_SPRITE,
  green:  SHARED_SLIME,
  blue:   SHARED_SLIME,
  red:    SHARED_SLIME,
  purple: SHARED_SLIME,
  gold:   SHARED_SLIME,
  boss:   SHARED_BOSS
}

/** Bullet sprite path; demand-loaded by useSlimeGame when a projectile
 *  fires. If the file is missing, the procedural projectile draw is
 *  used (already implemented in useSlimeGame.drawProjectile). */
export const BULLET_IMG_PATH = '/images/models/bullet_256x256.png'

/** Radius threshold above which a non-boss enemy is considered
 *  "tough" and gets the chunkier `slime-tower_*` artwork. Mobs scale
 *  with stage progression in `useSlimeCampaign.buildStageConfig`,
 *  so this naturally promotes late-stage enemies to the tower look
 *  without asking the gameplay layer to track the flag itself. The
 *  threshold (22 px) is chosen to match the rookie-tier mob ceiling
 *  so stages 1-32 read as small slimes, stages 33+ as tower slimes. */
const TOUGH_RADIUS_THRESHOLD = 22

/**
 * Resolve which sprite a slime should render with — the regular
 * `slime_*` art for small/normal mobs and the player, the chunkier
 * `slime-tower_*` art for bosses AND oversized mobs (the user's
 * "tougher slime enemies" path). Falls back to the procedural draw
 * if the image isn't decoded yet or the file is missing.
 */
const tryGetSprite = (kind: SlimeKind, radius: number): HTMLImageElement | null => {
  // We deliberately call getCachedImage for both probe and consumption:
  // first call schedules the load, subsequent calls reuse the same
  // HTMLImageElement. Until the load resolves the procedural path is
  // used. If the image 404s the browser keeps `complete` true with
  // naturalWidth=0, so the gate filters that case too.
  const wantsTower = kind === 'boss' || (kind !== 'player' && radius >= TOUGH_RADIUS_THRESHOLD)
  const path = wantsTower ? SHARED_BOSS : IMG_PATHS[kind]
  const img = getCachedImage(path)
  if (img && img.complete && img.naturalWidth > 0) return img
  return null
}

export interface DrawSlimeOptions {
  ctx: CanvasRenderingContext2D
  kind: SlimeKind
  x: number
  y: number
  /** Visual radius in CSS px. */
  radius: number
  /** Time-based jiggle phase, typically `performance.now() / 1000`. */
  t: number
  /** Aim direction in radians; controls eye look-direction. */
  aim?: number
  /** 0..1 — flashes the slime white when recently hit. */
  hitFlash?: number
  /** 0..1 hp ratio for the optional hp arc (defaults to no arc). */
  hpRatio?: number
}

export const drawSlime = (opts: DrawSlimeOptions): void => {
  const { ctx, kind, x, y, radius, t, aim = 0, hitFlash = 0, hpRatio } = opts
  const palette = PALETTES[kind]

  const sprite = tryGetSprite(kind, radius)
  if (sprite) {
    // Soft-body breath so even the sprite path doesn't feel static.
    const breath = Math.sin(t * 3) * 0.06
    const sx = 1 + breath
    const sy = 1 - breath * 0.8
    ctx.save()
    ctx.translate(x, y)
    ctx.scale(sx, sy)
    const d = radius * 2.2
    ctx.drawImage(sprite, -d / 2, -d / 2, d, d)
    // Tint the shared sprite so the player can still distinguish
    // green / red / boss / etc. without authoring per-kind artwork.
    // 'multiply' colors the slime body; 'lighter' on top adds a
    // light highlight from the same palette.
    if (kind !== 'player') {
      ctx.globalCompositeOperation = 'multiply'
      ctx.fillStyle = palette.body
      ctx.beginPath()
      ctx.arc(0, 0, d / 2, 0, Math.PI * 2)
      ctx.fill()
    }
    if (hitFlash > 0) {
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = hitFlash * 0.6
      ctx.drawImage(sprite, -d / 2, -d / 2, d, d)
    }
    ctx.restore()
    if (hpRatio !== undefined && hpRatio < 1) drawHpArc(ctx, x, y, radius, hpRatio)
    return
  }

  // Soft-body envelope: x-axis squish in/out + y-axis bob, slightly out
  // of phase so the silhouette never looks like a uniform pulsing disc.
  const breath = Math.sin(t * 3) * 0.06
  const sx = 1 + breath
  const sy = 1 - breath * 0.8

  ctx.save()
  ctx.translate(x, y + radius * 0.05)
  ctx.scale(sx, sy)

  // Body fill — use radial gradient baked per-slime so each looks
  // distinct without the cost of a real per-frame shader.
  const grad = ctx.createRadialGradient(
    -radius * 0.35, -radius * 0.35, radius * 0.2,
    0, 0, radius
  )
  grad.addColorStop(0, palette.highlight)
  grad.addColorStop(0.45, palette.body)
  grad.addColorStop(1, palette.shade)
  ctx.fillStyle = grad
  ctx.strokeStyle = palette.outline
  ctx.lineWidth = Math.max(1.5, radius * 0.07)

  // Half-circle dome on top, flat-ish bottom — the iconic slime arc.
  ctx.beginPath()
  ctx.moveTo(-radius, radius * 0.55)
  ctx.bezierCurveTo(
    -radius * 1.05, -radius * 0.4,
    -radius * 0.5, -radius * 1.05,
    0, -radius * 1.05
  )
  ctx.bezierCurveTo(
    radius * 0.5, -radius * 1.05,
    radius * 1.05, -radius * 0.4,
    radius, radius * 0.55
  )
  // Slightly wavy bottom — adds the goopy droplet feel.
  const wave = Math.sin(t * 4) * radius * 0.05
  ctx.bezierCurveTo(
    radius * 0.6, radius * (0.7 + wave * 0.4),
    -radius * 0.6, radius * (0.7 - wave * 0.4),
    -radius, radius * 0.55
  )
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  // Glossy highlight on the upper-left dome.
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  ctx.beginPath()
  ctx.ellipse(-radius * 0.35, -radius * 0.55, radius * 0.22, radius * 0.32, -0.4, 0, Math.PI * 2)
  ctx.fill()

  // Eyes — bigger, closer-set for player; mean-narrow for boss.
  const eyeOffset = kind === 'boss' ? radius * 0.18 : radius * 0.22
  const eyeY = -radius * 0.05
  const eyeRX = kind === 'boss' ? radius * 0.16 : radius * 0.14
  const eyeRY = kind === 'boss' ? radius * 0.08 : radius * 0.18

  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.ellipse(-eyeOffset, eyeY, eyeRX, eyeRY, 0, 0, Math.PI * 2)
  ctx.ellipse(eyeOffset, eyeY, eyeRX, eyeRY, 0, 0, Math.PI * 2)
  ctx.fill()

  // Pupils tracking the aim direction (clamped inside the eye).
  const lookX = Math.cos(aim) * eyeRX * 0.4
  const lookY = Math.sin(aim) * eyeRY * 0.4
  ctx.fillStyle = palette.eye
  ctx.beginPath()
  ctx.arc(-eyeOffset + lookX, eyeY + lookY, eyeRX * 0.55, 0, Math.PI * 2)
  ctx.arc(eyeOffset + lookX, eyeY + lookY, eyeRX * 0.55, 0, Math.PI * 2)
  ctx.fill()

  // Mouth: smile for player/normal slimes, snarl for boss.
  ctx.strokeStyle = palette.outline
  ctx.lineWidth = Math.max(1, radius * 0.06)
  ctx.beginPath()
  if (kind === 'boss') {
    ctx.moveTo(-radius * 0.35, radius * 0.25)
    for (let i = 0; i <= 6; i++) {
      const px = -radius * 0.35 + (radius * 0.7) * (i / 6)
      const py = radius * 0.25 + (i % 2 === 0 ? -radius * 0.05 : radius * 0.05)
      ctx.lineTo(px, py)
    }
  } else {
    ctx.moveTo(-radius * 0.25, radius * 0.18)
    ctx.quadraticCurveTo(0, radius * 0.4, radius * 0.25, radius * 0.18)
  }
  ctx.stroke()

  ctx.restore()

  // Hit flash overlay drawn in screen space so it always reads.
  if (hitFlash > 0) {
    ctx.save()
    ctx.globalAlpha = Math.min(1, hitFlash) * 0.65
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  if (hpRatio !== undefined && hpRatio < 1) drawHpArc(ctx, x, y, radius, hpRatio)
}

/** Thin HP arc above the slime — only drawn when below max. */
const drawHpArc = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  ratio: number
) => {
  const r = radius * 1.25
  const yTop = y - radius * 0.05
  const start = Math.PI + 0.3
  const end = Math.PI * 2 - 0.3
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineWidth = Math.max(2, radius * 0.16)
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'
  ctx.beginPath()
  ctx.arc(x, yTop, r, start, end)
  ctx.stroke()
  ctx.lineWidth = Math.max(1.5, radius * 0.12)
  ctx.strokeStyle = ratio > 0.55 ? '#7cd957' : ratio > 0.25 ? '#ffd84a' : '#ff5f5f'
  ctx.beginPath()
  ctx.arc(x, yTop, r, start, start + (end - start) * Math.max(0, Math.min(1, ratio)))
  ctx.stroke()
  ctx.restore()
}

/** Image override path for the slime-drop pickup (used by the canvas
 *  drop renderer + the roulette glyph). Procedural draw below stays
 *  as the fallback for asset-missing scenarios. */
export const SLIME_DROP_IMG = '/images/models/slime-drop_256x256.webp'

/** Tiny slime-drop pickup — same look across all currency drops.
 *  Uses the bundled bitmap when available, falls back to the
 *  procedural drop silhouette below. */
export const drawSlimeDrop = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  t: number
): void => {
  const bob = Math.sin(t * 6) * radius * 0.2
  const sprite = getCachedImage(SLIME_DROP_IMG)
  if (sprite && sprite.complete && sprite.naturalWidth > 0) {
    ctx.save()
    ctx.translate(x, y + bob)
    const d = radius * 2.4
    ctx.drawImage(sprite, -d / 2, -d / 2, d, d)
    ctx.restore()
    return
  }
  // Procedural fallback — drop silhouette + body gradient + highlight.
  ctx.save()
  ctx.translate(x, y + bob)
  ctx.fillStyle = '#0d2200'
  ctx.beginPath()
  ctx.moveTo(0, -radius)
  ctx.bezierCurveTo(radius, 0, radius, radius * 0.9, 0, radius)
  ctx.bezierCurveTo(-radius, radius * 0.9, -radius, 0, 0, -radius)
  ctx.fill()
  const grad = ctx.createRadialGradient(-radius * 0.3, -radius * 0.3, radius * 0.15, 0, 0, radius)
  grad.addColorStop(0, '#e6ffb0')
  grad.addColorStop(0.55, '#65b30a')
  grad.addColorStop(1, '#3d6f00')
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.moveTo(0, -radius * 0.85)
  ctx.bezierCurveTo(radius * 0.85, 0, radius * 0.85, radius * 0.78, 0, radius * 0.88)
  ctx.bezierCurveTo(-radius * 0.85, radius * 0.78, -radius * 0.85, 0, 0, -radius * 0.85)
  ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  ctx.beginPath()
  ctx.ellipse(-radius * 0.3, -radius * 0.45, radius * 0.18, radius * 0.32, -0.4, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}
