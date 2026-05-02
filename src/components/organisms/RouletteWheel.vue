<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from 'vue'
import { isRewardedReady, showRewardedAd } from '@/use/useAds'
import { getCachedImage } from '@/use/useAssets'
import { SLIME_DROP_IMG } from '@/use/useSlimeRenderer'

export interface RouletteResult {
  type: 'multiplier'
  multiplier: number
}

interface Segment {
  kind: 'multiplier'
  color: string
  result: RouletteResult
  label: string
  weight: number
}

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'result', value: RouletteResult): void
}>()
const closeOverlay = () => emit('update:modelValue', false)

// ─── Build segments ─────────────────────────────────────────────────────────
// 12 evenly-spaced multiplier wedges. Slime build has no skins yet, so
// every wedge pays out in slime drops — varied multipliers keep the
// suspense without coupling to a skin catalog.

const MULTIPLIER_DEFS: { label: string; multiplier: number; color: string; count: number; weight: number }[] = [
  { label: '0.5x', multiplier: 0.5, color: '#dc2626', count: 3, weight: 12 },
  { label: '1x',   multiplier: 1,   color: '#2563eb', count: 3, weight: 18 },
  { label: '1.5x', multiplier: 1.5, color: '#16a34a', count: 3, weight: 12 },
  { label: '2x',   multiplier: 2,   color: '#d97706', count: 2, weight: 8 },
  { label: '3x',   multiplier: 3,   color: '#a855f7', count: 1, weight: 4 }
]

const buildSegments = (): Segment[] => {
  const segments: Segment[] = []
  for (const def of MULTIPLIER_DEFS) {
    for (let c = 0; c < def.count; c++) {
      segments.push({
        kind: 'multiplier',
        label: def.label,
        color: def.color,
        result: { type: 'multiplier', multiplier: def.multiplier },
        weight: def.weight
      })
    }
  }
  return segments.sort(() => Math.random() - 0.5)
}

const segments = ref<Segment[]>(buildSegments())

// ─── Weighted outcome selection ─────────────────────────────────────────────

const pickOutcomeIndex = (): number => {
  const totalWeight = segments.value.reduce((s, seg) => s + seg.weight, 0)
  let roll = Math.random() * totalWeight
  for (let i = 0; i < segments.value.length; i++) {
    roll -= segments.value[i]!.weight
    if (roll <= 0) return i
  }
  return segments.value.length - 1
}

// ─── State ──────────────────────────────────────────────────────────────────

const canvasRef = ref<HTMLCanvasElement | null>(null)
const isSpinning = ref(false)
const spinCount = ref(0)
const currentRotation = ref(0)
const showAdButton = ref(false)
const lastResult = ref<RouletteResult | null>(null)

const WHEEL_SIZE = 240
const ARROW_HEIGHT = 24
const CANVAS_HEIGHT = WHEEL_SIZE + ARROW_HEIGHT
const CENTER_X = WHEEL_SIZE / 2
const CENTER_Y = WHEEL_SIZE / 2 + ARROW_HEIGHT
const RADIUS = WHEEL_SIZE / 2 - 8

// ─── Canvas drawing ─────────────────────────────────────────────────────────

/**
 * Slime-drop glyph drawn onto the wheel canvas. Prefers the bundled
 * bitmap (`/public/images/models/slime-drop_*.webp`) — falls back to
 * a procedural drop silhouette when the asset isn't decoded yet.
 */
const drawSlimeDropIcon = (ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) => {
  const sprite = getCachedImage(SLIME_DROP_IMG)
  if (sprite && sprite.complete && sprite.naturalWidth > 0) {
    const d = size * 2.2
    ctx.drawImage(sprite, cx - d / 2, cy - d / 2, d, d)
    return
  }
  ctx.save()
  ctx.translate(cx, cy)
  ctx.fillStyle = '#0d2200'
  ctx.beginPath()
  ctx.moveTo(0, -size)
  ctx.bezierCurveTo(size, -0.05 * size, size, 0.85 * size, 0, size)
  ctx.bezierCurveTo(-size, 0.85 * size, -size, -0.05 * size, 0, -size)
  ctx.fill()
  const grad = ctx.createRadialGradient(-size * 0.3, -size * 0.3, size * 0.15, 0, 0, size)
  grad.addColorStop(0, '#e6ffb0')
  grad.addColorStop(0.55, '#65b30a')
  grad.addColorStop(1, '#3d6f00')
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.moveTo(0, -size * 0.85)
  ctx.bezierCurveTo(size * 0.85, -0.04 * size, size * 0.85, 0.78 * size, 0, size * 0.88)
  ctx.bezierCurveTo(-size * 0.85, 0.78 * size, -size * 0.85, -0.04 * size, 0, -size * 0.85)
  ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  ctx.beginPath()
  ctx.ellipse(-size * 0.3, -size * 0.45, size * 0.18, size * 0.32, -0.4, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

const drawWheel = (rotation: number) => {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const dpr = window.devicePixelRatio || 1
  canvas.width = WHEEL_SIZE * dpr
  canvas.height = CANVAS_HEIGHT * dpr
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, WHEEL_SIZE, CANVAS_HEIGHT)

  // Arrow
  const arrowW = 16
  ctx.fillStyle = '#facc15'
  ctx.strokeStyle = '#78350f'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(CENTER_X, ARROW_HEIGHT + 4)
  ctx.lineTo(CENTER_X - arrowW, 0)
  ctx.lineTo(CENTER_X + arrowW, 0)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.save()
  ctx.shadowColor = '#fbbf24'
  ctx.shadowBlur = 12
  ctx.fill()
  ctx.restore()

  const segCount = segments.value.length
  const arcSize = (Math.PI * 2) / segCount

  ctx.save()
  ctx.translate(CENTER_X, CENTER_Y)
  ctx.rotate(rotation)

  for (let i = 0; i < segCount; i++) {
    const seg = segments.value[i]!
    const startAngle = i * arcSize
    const endAngle = startAngle + arcSize

    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.arc(0, 0, RADIUS, startAngle, endAngle)
    ctx.closePath()
    ctx.fillStyle = seg.color
    ctx.fill()

    const grad = ctx.createRadialGradient(0, 0, RADIUS * 0.2, 0, 0, RADIUS)
    grad.addColorStop(0, 'rgba(255,255,255,0.15)')
    grad.addColorStop(1, 'rgba(0,0,0,0.1)')
    ctx.fillStyle = grad
    ctx.fill()

    ctx.strokeStyle = 'rgba(255,255,255,0.4)'
    ctx.lineWidth = 2
    ctx.stroke()

    ctx.save()
    ctx.rotate(startAngle + arcSize / 2)
    drawSlimeDropIcon(ctx, RADIUS * 0.72, 0, 9)
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 13px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = 'rgba(0,0,0,0.6)'
    ctx.shadowBlur = 4
    ctx.fillText(seg.label, RADIUS * 0.45, 0)
    ctx.shadowBlur = 0
    ctx.restore()
  }

  ctx.beginPath()
  ctx.arc(0, 0, RADIUS, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'
  ctx.lineWidth = 4
  ctx.stroke()

  ctx.beginPath()
  ctx.arc(0, 0, 18, 0, Math.PI * 2)
  ctx.fillStyle = '#1e293b'
  ctx.fill()
  ctx.strokeStyle = '#e2e8f0'
  ctx.lineWidth = 3
  ctx.stroke()

  ctx.fillStyle = '#facc15'
  ctx.font = 'bold 16px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('\u2605', 0, 1)

  ctx.restore()
}

// ─── Spin logic ─────────────────────────────────────────────────────────────

const canShowAd = () => isRewardedReady.value

/** Emit the stored result and finalize. */
const finalizeResult = () => {
  if (!lastResult.value) return
  emit('result', lastResult.value)
  // Auto-close so the gameplay HUD comes back without an extra tap.
  closeOverlay()
}

const spin = () => {
  if (isSpinning.value) return
  isSpinning.value = true
  showAdButton.value = false

  const outcomeIndex = pickOutcomeIndex()
  const segCount = segments.value.length
  const arcSize = (Math.PI * 2) / segCount

  const segCenter = outcomeIndex * arcSize + arcSize / 2
  const fullSpins = 5 + Math.floor(Math.random() * 3)
  const targetRotation = -Math.PI / 2 - segCenter + fullSpins * Math.PI * 2

  const startRotation = currentRotation.value
  const totalDelta = targetRotation - startRotation
  const duration = 3500 + Math.random() * 1000
  const startTime = performance.now()

  const animate = (now: number) => {
    const elapsed = now - startTime
    const progress = Math.min(1, elapsed / duration)
    const eased = 1 - Math.pow(1 - progress, 3)

    currentRotation.value = startRotation + totalDelta * eased
    drawWheel(currentRotation.value)

    if (progress < 1) {
      requestAnimationFrame(animate)
    } else {
      isSpinning.value = false
      spinCount.value++
      lastResult.value = segments.value[outcomeIndex]!.result

      // After first spin, offer ad respin if SDK available
      if (spinCount.value === 1 && canShowAd()) {
        showAdButton.value = true
        // Don't emit yet — wait for user decision
      } else {
        // Final spin (either first without SDK, or respin) — emit after brief pause
        setTimeout(finalizeResult, 600)
      }
    }
  }

  requestAnimationFrame(animate)
}

/** User declines ad — finalize with current result. */
const onSkipAd = () => {
  showAdButton.value = false
  setTimeout(finalizeResult, 300)
}

/** User watches ad — respin the wheel with fresh segments. */
const onAdRespin = async () => {
  showAdButton.value = false
  const ok = await showRewardedAd()
  if (ok) {
    segments.value = buildSegments()
    requestAnimationFrame(() => {
      drawWheel(currentRotation.value)
      setTimeout(spin, 300)
    })
  } else {
    // Ad failed/cancelled — finalize with first result
    setTimeout(finalizeResult, 300)
  }
}

const startWheel = () => {
  // Reset internal state so reopening the wheel always starts a fresh
  // spin rather than carrying state from the previous session.
  isSpinning.value = false
  spinCount.value = 0
  showAdButton.value = false
  lastResult.value = null
  segments.value = buildSegments()
  nextTick(() => {
    requestAnimationFrame(() => {
      drawWheel(currentRotation.value)
      setTimeout(spin, 500)
    })
  })
}

watch(() => props.modelValue, (open) => {
  if (open) startWheel()
})

onMounted(() => {
  if (props.modelValue) startWheel()
})
</script>

<template lang="pug">
  Teleport(to="body")
    Transition(name="fade")
      div(
        v-if="modelValue"
        class="roulette-overlay fixed inset-0 z-[110] flex flex-col items-center justify-center bg-black/75 backdrop-blur-sm"
        :style="{\
          paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))',\
          paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))',\
          paddingLeft: 'calc(0.75rem + env(safe-area-inset-left, 0px))',\
          paddingRight: 'calc(0.75rem + env(safe-area-inset-right, 0px))'\
        }"
      )
        div(class="text-amber-300 font-black uppercase tracking-widest game-text text-sm sm:text-base mb-2") Bonus Spin
        div.relative
          canvas(
            ref="canvasRef"
            :style="{ width: WHEEL_SIZE + 'px', height: CANVAS_HEIGHT + 'px', maxWidth: '85vw', maxHeight: '60vh' }"
          )
        //- Fixed-height status slot — no layout shift between spinning / ad / done
        div(class="flex flex-col items-center gap-2 mt-4 min-h-[3rem]")
          span(
            v-if="isSpinning"
            class="text-white font-bold game-text uppercase tracking-wider animate-pulse text-sm"
          ) Spinning...
          //- Post-first-spin: ad respin + skip
          div(v-if="showAdButton" class="flex items-center gap-3")
            button(
              class="cursor-pointer rounded-lg border-2 font-bold flex items-center gap-2 transition-transform px-3 py-1.5 text-sm bg-gradient-to-b from-[#ffcd00] to-[#f7a000] border-[#0f1a30] text-white hover:scale-105 active:scale-95"
              @click="onAdRespin"
            )
              img(src="/images/icons/movie_128x96.webp" class="object-contain h-5 w-5")
              span(class="game-text") Spin Again
            button(
              class="text-white font-bold game-text uppercase tracking-wider cursor-pointer underline opacity-60 text-xs hover:opacity-100"
              @click="onSkipAd"
            ) Skip
</template>

<style scoped lang="sass">
.fade-enter-active, .fade-leave-active
  transition: opacity 0.25s ease
.fade-enter-from, .fade-leave-to
  opacity: 0
</style>
