import { prependBaseUrl } from '@/utils/function'
import useUser from '@/use/useUser'
import { getAudioContext, loadAudioBuffer, resourceCache } from '@/use/useAssets'

import { ref, onMounted, watch, onUnmounted } from 'vue'

// We keep the audio instance outside the hook so it's a true Singleton
const bgMusic = ref<HTMLAudioElement | null>(null)
const isLoaded = ref(false)
const isPlaying = ref(false)
// Tracks whether music is *meant* to be playing right now (i.e. a battle is
// in progress). Used so visibility-change resume only un-pauses when there's
// actually a battle running.
const shouldPlay = ref(false)

export const useMusic = () => {
  const { userMusicVolume } = useUser()

  watch(userMusicVolume, () => {
    if (!bgMusic.value) return
    bgMusic.value.volume = Math.max(0, Math.min(1, (userMusicVolume.value ?? 0.6) * 0.025))
  })

  const pauseMusic = () => {
    if (bgMusic.value) {
      bgMusic.value.pause()
      isPlaying.value = false
    }
  }

  const continueMusic = () => {
    if (bgMusic.value && shouldPlay.value) {
      playWithFade()
    }
  }

  const initMusic = () => {
    onMounted(() => {
      if (bgMusic.value) return // Already initialized
      const audio = new Audio()
      audio.loop = true
      audio.volume = 0
      audio.preload = 'auto'
      bgMusic.value = audio
    })
    onUnmounted(() => {
      bgMusic.value?.pause()
      bgMusic.value?.removeAttribute('src')
      bgMusic.value = null
      shouldPlay.value = false
      isPlaying.value = false
      isLoaded.value = false
    })
  }

  const startBattleMusic = () => {
    if (!bgMusic.value) return
    // Already playing a battle track — leave it alone so we don't restart
    // mid-fight on extra calls.
    if (shouldPlay.value && isPlaying.value) return
    shouldPlay.value = true
    const idx = Math.floor(Math.random() * 3) + 1
    const filename = `battle-${idx}.ogg`
    const src = prependBaseUrl('audio/music/' + filename)
    const cached = resourceCache.audio.get(src)

    bgMusic.value.pause()
    bgMusic.value.volume = 0

    if (cached) {
      // Use preloaded audio — already decoded, skip network fetch
      bgMusic.value.src = cached.src
      isLoaded.value = true
      playWithFade()
    } else {
      bgMusic.value.src = src
      bgMusic.value.load()
      bgMusic.value.addEventListener('canplaythrough', () => {
        isLoaded.value = true
        playWithFade()
      }, { once: true })
    }
  }

  const stopBattleMusic = () => {
    shouldPlay.value = false
    if (!bgMusic.value) return
    fadeOut(() => {
      bgMusic.value?.pause()
      isPlaying.value = false
    })
  }

  const playWithFade = () => {
    if (!bgMusic.value) return

    // Browsers block autoplay until user interaction
    bgMusic.value.play().then(() => {
      isPlaying.value = true
      fadeIn()
    }).catch(() => {
      // Attach a one-time listener to the window to play on first click
      window.addEventListener('click', () => {
        if (!isPlaying.value && shouldPlay.value) playWithFade()
      }, { once: true })
    })
  }

  const fadeIn = () => {
    if (!bgMusic.value) return
    let vol = 0
    const target = Math.max(0, Math.min(1, (userMusicVolume.value ?? 0.6) * 0.025))
    const interval = setInterval(() => {
      if (!bgMusic.value || !shouldPlay.value) {
        clearInterval(interval)
        return
      }
      if (vol < target) {
        vol += 0.005
        bgMusic.value.volume = Math.min(vol, target)
      } else {
        clearInterval(interval)
      }
    }, 50)
  }

  const fadeOut = (onDone?: () => void) => {
    if (!bgMusic.value) {
      onDone?.()
      return
    }
    const interval = setInterval(() => {
      if (!bgMusic.value) {
        clearInterval(interval)
        onDone?.()
        return
      }
      const v = bgMusic.value.volume
      if (v > 0.005) {
        bgMusic.value.volume = Math.max(0, v - 0.005)
      } else {
        bgMusic.value.volume = 0
        clearInterval(interval)
        onDone?.()
      }
    }, 50)
  }


  return { initMusic, isLoaded, isPlaying, pauseMusic, continueMusic, startBattleMusic, stopBattleMusic }
}

// ─── SFX playback ──────────────────────────────────────────────────────────
//
// `playSound` has two paths:
//
//   1. Web Audio (fast path) — a preloaded AudioBuffer lives in
//      resourceCache.audioBuffers. We spawn a fresh AudioBufferSourceNode
//      + GainNode and start it. No fetch, no decode, no media-element
//      allocation — typically <0.5 ms on the main thread.
//
//      If the buffer isn't cached yet (sound played before preload
//      finished, or a sound not in the preload list), we kick off a
//      fetch+decode in the background. The first call on that sound still
//      pays the decode cost, but every subsequent call hits the fast path.
//
//   2. HTMLAudio fallback — only used when Web Audio is unavailable
//      (extremely rare in 2025). We keep the old cloneNode() + new Audio()
//      logic intact so nothing breaks.
//
// Return value: a minimal `SoundHandle` interface so existing callers that
// do `audio.addEventListener('ended', ...)` keep working. The handle is
// backed by either the source node (Web Audio) or the Audio element
// (fallback). `error` events never fire in the Web Audio path — a source
// that fails to start throws synchronously from `start()` and we map that
// to an immediate 'ended' dispatch so caller cleanup logic still runs.

export type SoundHandle = Pick<
  HTMLAudioElement,
  'addEventListener' | 'removeEventListener'
>

const makeWebAudioHandle = (source: AudioBufferSourceNode): SoundHandle => {
  // AudioBufferSourceNode is already an EventTarget and fires 'ended' when
  // playback finishes or stop() is called. We just need to ignore 'error'
  // (Web Audio doesn't emit one) so callers that add both listeners don't
  // crash. Treating 'error' as a no-op is safe because 'ended' always
  // fires for a successfully-started source.
  return {
    addEventListener: ((event: string, cb: EventListener, opts?: AddEventListenerOptions | boolean) => {
      if (event === 'ended') source.addEventListener('ended', cb, opts)
    }) as HTMLAudioElement['addEventListener'],
    removeEventListener: ((event: string, cb: EventListener, opts?: EventListenerOptions | boolean) => {
      if (event === 'ended') source.removeEventListener('ended', cb, opts)
    }) as HTMLAudioElement['removeEventListener']
  }
}

const useSounds = () => {
  const { userSoundVolume } = useUser()

  const clampVolume = (ratio: number): number =>
    Math.max(0, Math.min(1, (userSoundVolume.value ?? 0.7) * ratio))

  const playViaWebAudio = (
    ctx: AudioContext,
    buffer: AudioBuffer,
    ratio: number
  ): SoundHandle | null => {
    try {
      const source = ctx.createBufferSource()
      source.buffer = buffer
      const gain = ctx.createGain()
      gain.gain.value = clampVolume(ratio)
      source.connect(gain).connect(ctx.destination)
      source.start()
      return makeWebAudioHandle(source)
    } catch (e) {
      // Browser refused to start (context killed, etc.) — signal the
      // caller's cleanup via a dispatched 'ended' so they don't leak a
      // slot in their active-sounds counter.
      console.warn('[sfx] Web Audio start failed', e)
      return null
    }
  }

  const playViaHtmlAudio = (src: string, ratio: number): HTMLAudioElement => {
    const cached = resourceCache.audio.get(src)
    const audio = cached
      ? (cached.cloneNode(false) as HTMLAudioElement)
      : new Audio(src)
    // iOS requires volume to be set BEFORE play(). Clamp to [0,1] —
    // Firefox throws DOMException if volume is NaN or out of range (can
    // happen when userSoundVolume hasn't loaded from IndexedDB yet).
    audio.volume = clampVolume(ratio)
    audio.play().catch(() => {
      /* autoplay blocked or media failed — ignore */
    })
    return audio
  }

  const playSound = (effect: string, ratio = 0.025): SoundHandle | null => {
    const src = prependBaseUrl(`audio/sfx/${effect}.ogg`)

    // Fast path: preloaded AudioBuffer + Web Audio.
    const buffer = resourceCache.audioBuffers.get(src)
    const ctx = getAudioContext()
    if (ctx && buffer) {
      return playViaWebAudio(ctx, buffer, ratio)
    }

    // Slow path: Web Audio available but buffer not yet decoded. Kick off
    // a background decode so subsequent calls hit the fast path, and play
    // *this* call via HTMLAudio so the player still hears it immediately.
    if (ctx && !buffer) {
      void loadAudioBuffer(src)
    }

    // Fallback: HTMLAudio (also used when Web Audio is unavailable).
    return playViaHtmlAudio(src, ratio)
  }

  return {
    playSound
  }
}

export default useSounds

