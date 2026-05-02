/**
 * Reusable currency-explosion VFX.
 *
 * Drops burst outward from a source element, then fly toward a target
 * element (typically the SlimeDropBadge in the HUD). Visual is the
 * slime-drop icon — this is the only currency in slime-rogue-war.
 *
 * The function name is kept as `spawnCoinExplosion` for backwards
 * compatibility with the chaos-arena HUD components that already call
 * it (TreasureChest, RouletteWheel, AdRewardButton, BattlePass,
 * DailyRewards). Swapping icon + colors here lets every drop reward
 * feel consistent without touching every call site.
 *
 * Visual: prefers the bundled slime-drop bitmap
 * (`/public/images/models/slime-drop_256x256.webp`); falls back to a
 * procedural inline SVG when the file isn't decoded yet or 404s.
 */

import { getCachedImage } from '@/use/useAssets'

const SLIME_DROP_IMG_PATH = '/images/models/slime-drop_256x256.webp'

const SLIME_DROP_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" style="width:22px;height:22px;display:block">' +
  '<path d="M12 2 C 6 8 3 12 3 16 a 9 9 0 0 0 18 0 c 0 -4 -3 -8 -9 -14 z" fill="#0d2200" stroke="#0d2200" stroke-width="1.2" stroke-linejoin="round"/>' +
  '<path d="M12 3.4 C 6.8 8.7 4.2 12.3 4.2 15.9 a 7.8 7.8 0 0 0 15.6 0 c 0 -3.6 -2.6 -7.2 -7.8 -12.5 z" fill="#65b30a"/>' +
  '<ellipse cx="9" cy="9.5" rx="2.2" ry="3.2" fill="#ffffff" fill-opacity="0.55" transform="rotate(-22 9 9.5)"/>' +
  '<circle cx="14.6" cy="13.6" r="0.7" fill="#ffffff" fill-opacity="0.6"/>' +
  '</svg>'

const SLIME_DROP_IMG_HTML =
  `<img src="${SLIME_DROP_IMG_PATH}" style="width:22px;height:22px;display:block;pointer-events:none" draggable="false" alt="" />`

/** Pick markup for a single drop particle: bitmap when the asset is
 *  ready, procedural SVG otherwise. The decision is made once per
 *  spawn call so all particles in the burst use the same path. */
const resolveDropMarkup = (): string => {
  const sprite = getCachedImage(SLIME_DROP_IMG_PATH)
  if (sprite && sprite.complete && sprite.naturalWidth > 0) {
    return SLIME_DROP_IMG_HTML
  }
  return SLIME_DROP_SVG
}

export interface CoinExplosionOptions {
  /** Element the drops burst out of. */
  sourceEl: HTMLElement
  /** Element the drops fly toward (e.g. SlimeDropBadge). */
  targetEl: HTMLElement
  /** Number of drops to spawn (default 18). */
  count?: number
  /** Max burst radius in px (default 110). */
  burstRadius?: number
}

export function spawnCoinExplosion(opts: CoinExplosionOptions) {
  const { sourceEl, targetEl, count = 18, burstRadius = 110 } = opts

  const sourceRect = sourceEl.getBoundingClientRect()
  const cx = sourceRect.left + sourceRect.width / 2
  const cy = sourceRect.top + sourceRect.height / 2

  const els: HTMLDivElement[] = []
  const angles: number[] = []
  const distances: number[] = []
  const staggerDelays: number[] = []

  const container = document.getElementById('app') || document.body
  const dropMarkup = resolveDropMarkup()

  for (let i = 0; i < count; i++) {
    const el = document.createElement('div')
    el.innerHTML = dropMarkup
    el.style.cssText =
      'position:absolute;left:0;top:0;pointer-events:none;z-index:100;will-change:transform,opacity;'
    el.style.transform = `translate(${cx - 11}px,${cy - 11}px)`
    container.appendChild(el)
    els.push(el)
    angles.push(Math.random() * Math.PI * 2)
    distances.push(40 + Math.random() * (burstRadius - 40))
    staggerDelays.push(Math.random() * 300)
  }

  const startTime = performance.now()
  const explodeDuration = 600
  const flyDuration = 500

  let flyStartPositions: { x: number; y: number }[] | null = null
  let tx = 0
  let ty = 0

  const animate = (now: number) => {
    const elapsed = now - startTime

    if (elapsed < explodeDuration) {
      const progress = elapsed / explodeDuration
      for (let i = 0; i < count; i++) {
        const x = cx - 11 + Math.cos(angles[i]!) * distances[i]! * progress
        const y = cy - 11 + Math.sin(angles[i]!) * distances[i]! * progress
        els[i]!.style.transform = `translate(${x}px,${y}px)`
      }
      requestAnimationFrame(animate)
    } else {
      if (!flyStartPositions) {
        const badgeRect = targetEl.getBoundingClientRect()
        flyStartPositions = els.map((_, i) => ({
          x: cx - 11 + Math.cos(angles[i]!) * distances[i]!,
          y: cy - 11 + Math.sin(angles[i]!) * distances[i]!
        }))
        tx = badgeRect.left + badgeRect.width / 2 - 11
        ty = badgeRect.top + badgeRect.height / 2 - 11
      }

      const flyElapsed = elapsed - explodeDuration
      let allDone = true

      for (let i = 0; i < count; i++) {
        const localElapsed = flyElapsed - staggerDelays[i]!
        if (localElapsed < 0) {
          allDone = false
          continue
        }
        const t = Math.min(1, localElapsed / flyDuration)
        const ease = t * t
        const sx = flyStartPositions[i]!.x
        const sy = flyStartPositions[i]!.y
        const x = sx + (tx - sx) * ease
        const y = sy + (ty - sy) * ease
        els[i]!.style.transform = `translate(${x}px,${y}px)`
        els[i]!.style.opacity = String(1 - ease)
        if (t < 1) allDone = false
      }

      if (!allDone) {
        requestAnimationFrame(animate)
      } else {
        for (const el of els) el.remove()
      }
    }
  }
  requestAnimationFrame(animate)
}
