import { ref } from 'vue'
import { prependBaseUrl } from '@/utils/function.ts'

// Shared state so it can be accessed by both the loader and the progress component
const loadingProgress = ref(0)
const areAllAssetsLoaded = ref(false)

// THIS IS THE KEY: A persistent memory reference
//
// `audio` holds HTMLAudioElements (used for streamed background music where
// we don't want the whole file decoded into memory).
//
// `audioBuffers` holds decoded PCM data for short SFX — a single shared
// AudioBuffer per file that we replay by spawning a fresh
// `AudioBufferSourceNode` on every `playSound()` call. This is the only
// way to get true "decode once, play many" semantics in the browser:
// HTMLAudioElement.cloneNode() copies the element but NOT the decoded
// audio, so each clone re-fetches (from disk cache at best) and
// re-decodes on the main thread. Web Audio skips both.
export const resourceCache = {
  images: new Map<string, HTMLImageElement>(),
  audio: new Map<string, HTMLAudioElement>(),
  audioBuffers: new Map<string, AudioBuffer>()
}

// ─── Shared AudioContext ───────────────────────────────────────────────────
//
// Browsers cap the number of AudioContexts per page (typically 6), so we
// create one on demand and reuse it everywhere. Also: autoplay policy keeps
// new contexts in a `suspended` state until a user gesture — we arm a
// one-shot click/touch listener to resume it on first interaction.

let sharedAudioCtx: AudioContext | null = null
let resumeListenerArmed = false

export const getAudioContext = (): AudioContext | null => {
  if (sharedAudioCtx) return sharedAudioCtx
  const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext
  if (!Ctor) return null
  try {
    sharedAudioCtx = new Ctor() as AudioContext
  } catch {
    return null
  }
  armResumeOnGesture()
  return sharedAudioCtx
}

const armResumeOnGesture = (): void => {
  if (resumeListenerArmed) return
  resumeListenerArmed = true
  const resume = () => {
    if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
      void sharedAudioCtx.resume()
    }
  }
  // `pointerdown` covers mouse + touch + pen; keydown handles keyboard-only
  // users. `{ once: true }` so we don't leak listeners past the first
  // gesture.
  window.addEventListener('pointerdown', resume, { once: true })
  window.addEventListener('keydown', resume, { once: true })
}

/**
 * Synchronous image lookup that guarantees a single `HTMLImageElement`
 * per `src`. If the image is already in the cache (preloaded or
 * previously demand-loaded) the cached instance is returned immediately.
 * Otherwise a new Image is created, stored in the cache, and returned —
 * so all *subsequent* callers share the decoded bitmap and the browser
 * doesn't re-fetch or re-decode.
 *
 * Call sites can use the return value with `ctx.drawImage` right away;
 * if the image isn't loaded yet the usual `.complete && .naturalWidth`
 * gate handles it (same as the existing render paths).
 */
export const getCachedImage = (src: string): HTMLImageElement => {
  const existing = resourceCache.images.get(src)
  if (existing) return existing
  const img = new Image()
  img.src = src
  resourceCache.images.set(src, img)
  return img
}

/**
 * Decode a remote audio file into an AudioBuffer and cache it. Returns
 * `null` if Web Audio isn't available or decode fails — callers should
 * then fall back to HTMLAudio. Safe to call multiple times; concurrent
 * calls share the same in-flight decode.
 */
const pendingDecodes = new Map<string, Promise<AudioBuffer | null>>()
export const loadAudioBuffer = async (src: string): Promise<AudioBuffer | null> => {
  const cached = resourceCache.audioBuffers.get(src)
  if (cached) return cached
  const existing = pendingDecodes.get(src)
  if (existing) return existing

  const ctx = getAudioContext()
  if (!ctx) return null

  const promise = (async () => {
    try {
      const res = await fetch(src)
      if (!res.ok) return null
      const arrayBuffer = await res.arrayBuffer()
      const buffer = await ctx.decodeAudioData(arrayBuffer)
      resourceCache.audioBuffers.set(src, buffer)
      return buffer
    } catch (e) {
      console.warn(`[assets] decodeAudioData failed for ${src}`, e)
      return null
    } finally {
      pendingDecodes.delete(src)
    }
  })()
  pendingDecodes.set(src, promise)
  return promise
}

// ─── Preload tiers ─────────────────────────────────────────────────────────
//
// Three layers of preload with distinct urgency:
//
//  1. STATIC_IMAGES + critical skins — splash-blocking. These paint the
//     very first UI frame (logo, HUD icons, parchment ribbon, tiled bg)
//     and the skins visible in the opening stage. Kept small and cheap
//     so the FLogoProgress overlay can exit as fast as possible.
//
//  2. SFX + VFX spritesheets — deferred. Fired after the splash-blocking
//     preload resolves, fire-and-forget. SFX go first because they
//     decode quickly and early combat wants them in memory; VFX go last
//     (explosion_2080x160 ≈ 300KB and big-spark_1280x256 ≈ 200KB dwarf
//     the UI icons and would otherwise pad the splash by ~200–500ms on
//     slower connections). By the time the player reaches the arena
//     these are almost always in cache; the few that aren't decode on
//     first use and are then cached in resourceCache forever.
//
//  3. preloadRemainingSkins — every skin not needed for the current
//     stage. Triggered from SpinnerArena on mount, fire-and-forget.
const STATIC_IMAGES = [
  'images/logo/logo_256x256.webp',
  'images/icons/difficulty-icon_128x128.webp',
  'images/icons/settings-icon_128x128.webp',
  'images/icons/sound-icon_128x128.webp',
  'images/icons/team_128x128.webp',
  'images/icons/gears_128x128.webp',
  'images/icons/movie_128x96.webp',
  'images/icons/chest_128x128.webp',
  'images/icons/trophy_128x128.webp',
  'images/bg/parchment-ribbon_553x188.webp',
  'images/bg/bg-tile_400x400.webp',
  // Arena play-field background — tiled inside the canvas via
  // `ctx.createPattern`. Preloaded so the first frame already paints
  // the textured floor instead of the procedural grid fallback.
  'images/bg/bg_1024x1024.webp',
  // Slime + bullet sprites are tiny and on the gameplay hot path —
  // baking them into the splash-blocking tier means the first frame
  // of combat already shows artwork, not the procedural fallback.
  // Player sprite is split off the shared mob artwork so the hero
  // reads as visually distinct from the swarm.
  'images/models/slimes/player_256x256.webp',
  'images/models/slimes/player_128x128.webp',
  'images/models/slimes/slime_256x256.webp',
  'images/models/slimes/slime_128x128.webp',
  'images/models/slimes/slime-tower_256x256.webp',
  'images/models/slimes/slime-tower_128x128.webp',
  'images/models/bullet_256x256.png',
  'images/models/bullet_128x128.png',
  // Slime-drop currency icon — referenced by HUD badges, drop pickups
  // on the canvas, the coin-explosion VFX and the roulette wheel
  // segments. Preloading guarantees no first-paint flicker.
  'images/models/slime-drop_256x256.webp',
  'images/models/slime-drop_128x128.webp'
]

const VFX_ASSETS = [
  'images/vfx/big-spark_1280x256.webp',
  'images/vfx/dark-smoke_1280x128.webp',
  'images/vfx/earth-rip-decal_138x138.webp',
  'images/vfx/explosion_2080x160.webp'
]

const SOUND_ASSETS = [
  'audio/sfx/clash-1.ogg',
  'audio/sfx/clash-2.ogg',
  'audio/sfx/clash-3.ogg',
  'audio/sfx/clash-4.ogg',
  'audio/sfx/clash-5.ogg',
  'audio/sfx/celebration-1.ogg',
  'audio/sfx/celebration-2.ogg',
  'audio/sfx/happy.ogg',
  'audio/sfx/level-up.ogg',
  'audio/sfx/win.ogg',
  'audio/sfx/lose.ogg',
  'audio/sfx/reward-continue.ogg'
]

// Kept for reference — music is streamed on demand from SpinnerArena, not preloaded.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const MUSIC_ASSETS = [
  'audio/music/battle-1.ogg',
  'audio/music/battle-2.ogg',
  'audio/music/battle-3.ogg',
]

// Slime build draws every character procedurally — no per-stage critical
// skin set. The few static UI images above (logo, parchment, settings)
// are the entire splash-blocking image tier. If a future build drops in
// /public/images/slimes/{kind}.webp overrides, the renderer demand-loads
// them via getCachedImage so they don't need to be in the splash tier.

type AssetEntry = { src: string; type: 'image' | 'audio' }

const loadAsset = (
  { src, type }: AssetEntry,
  onLoaded?: () => void
): Promise<unknown> => {
  if (type === 'image' && resourceCache.images.has(src)) {
    onLoaded?.()
    return Promise.resolve()
  }
  if (type === 'audio' && resourceCache.audioBuffers.has(src)) {
    onLoaded?.()
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    if (type === 'image') {
      const img = new Image()
      img.onload = () => {
        resourceCache.images.set(src, img)
        onLoaded?.()
        resolve(img)
      }
      img.onerror = () => {
        console.error('Preload fail:', src)
        onLoaded?.()
        resolve(null)
      }
      img.src = src
    } else {
      // SFX preload path — decode into an AudioBuffer so every playSound
      // call spawns a zero-cost source node instead of re-decoding. If
      // Web Audio is unavailable (very old browsers, private modes that
      // block AudioContext), fall back to caching an HTMLAudioElement so
      // playSound still has something to clone from.
      loadAudioBuffer(src).then((buffer) => {
        if (buffer) {
          onLoaded?.()
          resolve(buffer)
          return
        }
        const audio = new Audio()
        audio.oncanplaythrough = () => {
          resourceCache.audio.set(src, audio)
          onLoaded?.()
          resolve(audio)
        }
        audio.onerror = () => {
          onLoaded?.()
          resolve(null)
        }
        audio.src = src
        audio.load()
      })
    }
  })
}

const runInChunks = async (assets: AssetEntry[], chunkSize: number, onLoaded?: () => void) => {
  for (let i = 0; i < assets.length; i += chunkSize) {
    const chunk = assets.slice(i, i + chunkSize)
    await Promise.all(chunk.map(a => loadAsset(a, onLoaded)))
  }
}

// Cached promise for the SFX+VFX tier so concurrent callers share the
// same in-flight decode set.
let deferredAssetsPromise: Promise<void> | null = null

export default () => {
  const preloadAssets = async () => {
    if (areAllAssetsLoaded.value) return

    // Splash-critical tier: UI chrome only. The slime characters are
    // drawn procedurally on the canvas, so there are no per-stage
    // bitmap dependencies on the hot path. SFX + VFX are deferred so
    // the loader hits 100% the instant the UI bitmaps are decoded.
    const criticalAssets: AssetEntry[] = STATIC_IMAGES.map(src => ({
      src: prependBaseUrl(src),
      type: 'image' as const
    }))

    let loadedCount = 0
    const totalCount = criticalAssets.length
    const onOne = () => {
      loadedCount++
      loadingProgress.value = Math.floor((loadedCount / totalCount) * 100)
    }

    try {
      await runInChunks(criticalAssets, 10, onOne)
      areAllAssetsLoaded.value = true
      loadingProgress.value = 100
    } catch (error) {
      console.error('Preload failed:', error)
      loadingProgress.value = 100
    }

    // Fire-and-forget. Not awaited so the splash can exit the moment
    // the critical tier is done.
    void preloadDeferredAssets()
  }

  /**
   * Background loader for SFX then VFX. SFX first because short OGGs
   * decode in a few ms and the player can generate combat sounds seconds
   * after the splash is gone; VFX second because the spritesheets are
   * hundreds of KB each and the game tolerates a single stutter on first
   * spawn before they land in resourceCache. Idempotent — repeat calls
   * share the same in-flight promise.
   */
  const preloadDeferredAssets = (): Promise<void> => {
    if (deferredAssetsPromise) return deferredAssetsPromise

    const sfx: AssetEntry[] = SOUND_ASSETS
      .map(src => prependBaseUrl(src))
      .filter(src => !resourceCache.audioBuffers.has(src))
      .map(src => ({ src, type: 'audio' as const }))

    const vfx: AssetEntry[] = VFX_ASSETS
      .map(src => prependBaseUrl(src))
      .filter(src => !resourceCache.images.has(src))
      .map(src => ({ src, type: 'image' as const }))

    // Smaller chunks than the critical loader — we're competing with
    // arena render work once the player is interactive, so we keep the
    // bandwidth footprint modest.
    deferredAssetsPromise = (async () => {
      try {
        await runInChunks(sfx, 4)
        await runInChunks(vfx, 4)
      } catch (e) {
        console.error('Deferred asset preload failed:', e)
      }
    })()
    return deferredAssetsPromise
  }

  // Stubs kept for API parity with the chaos-arena build. Old call
  // sites in the codebase still reference these, but slime-rogue-war
  // draws everything procedurally, so the implementations are no-ops
  // that resolve immediately. Avoids cascading edits while we delete
  // the legacy spinner UI.
  const preloadSkinsByIds = (_ids: string[]): Promise<void> => Promise.resolve()
  const preloadRemainingSkins = (): Promise<void> => Promise.resolve()

  return {
    loadingProgress,
    areAllAssetsLoaded,
    preloadAssets,
    preloadDeferredAssets,
    preloadRemainingSkins,
    preloadSkinsByIds,
    resourceCache
  }
}
