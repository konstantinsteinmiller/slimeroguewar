<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { spawnCoinExplosion } from '@/use/useCoinExplosion'
import useSounds, { useMusic } from '@/use/useSound'
import useSlimeGame from '@/use/useSlimeGame'
import useSlimeDrops from '@/use/useSlimeDrops'
import useBattlePass from '@/use/useBattlePass'
import { isMobileLandscape, isMobilePortrait, windowWidth, windowHeight } from '@/use/useUser'
import { mobileCheck } from '@/utils/function'

import StageBadge from '@/components/StageBadge.vue'
import CoinBadge from '@/components/organisms/CoinBadge.vue'
import IconSlimeDrop from '@/components/icons/IconSlimeDrop.vue'
import FReward from '@/components/atoms/FReward.vue'
import FMuteButton from '@/components/atoms/FMuteButton.vue'
import SurrenderIcon from '@/components/organisms/SurrenderIcon.vue'

// Off-battle HUD pieces — lazy-loaded so initial paint doesn't pay for
// them. They're hidden during battle anyway, so the user never sees a
// dropped frame from the import.
const DailyRewards = defineAsyncComponent(() => import('@/components/organisms/DailyRewards.vue'))
const AdRewardButton = defineAsyncComponent(() => import('@/components/organisms/AdRewardButton.vue'))
const BattlePass = defineAsyncComponent(() => import('@/components/organisms/BattlePass.vue'))
const TreasureChest = defineAsyncComponent(() => import('@/components/organisms/TreasureChest.vue'))
const OptionsModal = defineAsyncComponent(() => import('@/components/organisms/OptionsModal.vue'))
const RouletteWheel = defineAsyncComponent(() => import('@/components/organisms/RouletteWheel.vue'))
const UpgradeChoiceModal = defineAsyncComponent(() => import('@/components/organisms/UpgradeChoiceModal.vue'))
const UpgradeShopModal = defineAsyncComponent(() => import('@/components/organisms/UpgradeShopModal.vue'))

const { t } = useI18n()
const { playSound } = useSounds()
const { startBattleMusic, stopBattleMusic } = useMusic()
const { drops } = useSlimeDrops()
const { awardCampaignWin } = useBattlePass()

const game = useSlimeGame()
const {
  phase, playerHp, playerMaxHp, playerLevel, playerXp, playerXpNext,
  currentStage, stageProgress, stageSpawned, introCountdown, stageClearReward,
  setViewport, beginStage, update, render, setJoystick, surrender,
  acceptUpgradeChoice, continueAfterClear, continueAfterDefeat
} = game

const canvasEl = ref<HTMLCanvasElement | null>(null)
const coinBadgeRef = ref<{ rootEl: HTMLElement | null } | null>(null)

const showOptions = ref(false)
const showShop = ref(false)
const showRoulette = ref(false)
const showLevelUp = computed({
  get: () => phase.value === 'levelup',
  set: (v: boolean) => { if (!v) phase.value = 'battle' }
})
const showCleared = computed({
  get: () => phase.value === 'cleared',
  set: () => { /* dismissed via continue button */ }
})
const showGameover = computed({
  get: () => phase.value === 'gameover',
  set: () => { /* dismissed via continue button */ }
})

/** Bumped on each successful "Continue" tap so we know when to show
 *  the roulette every 5th cleared stage. Lives in localStorage so the
 *  cadence survives refresh.
 */
const STAGE_CLEAR_COUNTER_KEY = 'slime_stage_clears'
const stageClearCount = ref<number>(parseInt(localStorage.getItem(STAGE_CLEAR_COUNTER_KEY) ?? '0', 10) || 0)

// ─── Canvas + game loop ────────────────────────────────────────────────────

let dpr = 1
let rafId: number | null = null
let lastTime = 0

const sizeCanvas = () => {
  const c = canvasEl.value
  if (!c) return
  const w = c.clientWidth
  const h = c.clientHeight
  dpr = Math.min(2, window.devicePixelRatio || 1)
  c.width = Math.max(1, Math.floor(w * dpr))
  c.height = Math.max(1, Math.floor(h * dpr))
  setViewport(w, h)
}

const tick = (now: number) => {
  if (!canvasEl.value) return
  const ctx = canvasEl.value.getContext('2d')
  if (!ctx) return
  const dt = lastTime === 0 ? 0 : Math.min(0.05, (now - lastTime) / 1000)
  lastTime = now
  update(dt)
  ctx.save()
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, canvasEl.value.clientWidth, canvasEl.value.clientHeight)
  render(ctx)
  ctx.restore()
  rafId = requestAnimationFrame(tick)
}

onMounted(() => {
  sizeCanvas()
  rafId = requestAnimationFrame(tick)
  window.addEventListener('resize', sizeCanvas)
})

onUnmounted(() => {
  if (rafId !== null) cancelAnimationFrame(rafId)
  window.removeEventListener('resize', sizeCanvas)
  stopBattleMusic()
})

watch([windowWidth, windowHeight], () => sizeCanvas())

// ─── Music gating ──────────────────────────────────────────────────────────

watch(phase, (p, prev) => {
  if (p === 'intro' && prev !== 'intro') {
    startBattleMusic()
    playSound('clash-1', 0.04)
  }
  if ((p === 'cleared' || p === 'gameover') && (prev === 'battle' || prev === 'levelup' || prev === 'intro')) {
    stopBattleMusic()
    playSound(p === 'cleared' ? 'win' : 'lose', 0.05)
  }
})

watch(introCountdown, (val) => {
  if (val !== null) playSound('clash-2', 0.035)
})

// ─── Input — virtual joystick (touch & mouse) ──────────────────────────────

interface JoyState {
  active: boolean
  originX: number
  originY: number
  dx: number
  dy: number
  pointerId: number | null
}
const joy = ref<JoyState>({ active: false, originX: 0, originY: 0, dx: 0, dy: 0, pointerId: null })

const stageEl = ref<HTMLElement | null>(null)

const onPointerDown = (e: PointerEvent) => {
  if (phase.value !== 'battle' && phase.value !== 'intro') return
  if (joy.value.pointerId !== null) return
  // Touch joystick is mobile-only — desktop players use WASD/arrows
  // (handled in the keyboard block below). `pointerType` is reliable
  // across modern WebViews; `mobileCheck` is the secondary gate.
  if (e.pointerType !== 'touch' && !mobileCheck()) return
  joy.value.active = true
  joy.value.originX = e.clientX
  joy.value.originY = e.clientY
  joy.value.dx = 0
  joy.value.dy = 0
  joy.value.pointerId = e.pointerId
  setJoystick(0, 0, true)
}

const onPointerMove = (e: PointerEvent) => {
  if (!joy.value.active || joy.value.pointerId !== e.pointerId) return
  const dx = e.clientX - joy.value.originX
  const dy = e.clientY - joy.value.originY
  // Soft cap so the visual stick doesn't fly off; gameplay reads
  // dx/dy normalized inside useSlimeGame anyway.
  const max = 60
  const len = Math.hypot(dx, dy)
  const cdx = len > max ? (dx / len) * max : dx
  const cdy = len > max ? (dy / len) * max : dy
  joy.value.dx = cdx
  joy.value.dy = cdy
  setJoystick(dx, dy, true)
}

const onPointerEnd = (e: PointerEvent) => {
  if (joy.value.pointerId !== e.pointerId) return
  joy.value.active = false
  joy.value.pointerId = null
  joy.value.dx = 0
  joy.value.dy = 0
  setJoystick(0, 0, false)
}

const joyStyle = computed(() => ({
  left: `${joy.value.originX}px`,
  top: `${joy.value.originY}px`,
  transform: 'translate(-50%, -50%)'
}))

const stickStyle = computed(() => ({
  transform: `translate(${joy.value.dx}px, ${joy.value.dy}px)`
}))

// ─── Stage clear → reward flow ─────────────────────────────────────────────

const onClearedContinue = () => {
  // VFX first so the slime drops fly to the badge before the modal closes.
  if (stageClearReward.value && stageClearReward.value.drops > 0 && coinBadgeRef.value?.rootEl && stageEl.value) {
    spawnCoinExplosion({
      sourceEl: stageEl.value,
      targetEl: coinBadgeRef.value.rootEl,
      count: 16
    })
  }
  awardCampaignWin()
  stageClearCount.value += 1
  localStorage.setItem(STAGE_CLEAR_COUNTER_KEY, String(stageClearCount.value))
  const showRoulettePostClear = stageClearCount.value > 0 && stageClearCount.value % 5 === 0
  continueAfterClear()
  if (showRoulettePostClear) {
    setTimeout(() => { showRoulette.value = true }, 350)
  }
}

const onGameoverContinue = () => {
  continueAfterDefeat()
}

// ─── Off-battle HUD visibility ─────────────────────────────────────────────

const isOffBattle = computed(() => phase.value === 'idle')
const isInBattle = computed(() => phase.value === 'battle' || phase.value === 'intro' || phase.value === 'levelup')

// Hide rewards when in battle so the off-battle UI doesn't crowd the canvas.
const showOffBattleHud = computed(() => phase.value === 'idle')

// HP bar — always visible in battle and intro.
const hpRatio = computed(() => {
  if (playerMaxHp.value <= 0) return 0
  return Math.max(0, Math.min(1, playerHp.value / playerMaxHp.value))
})

// XP bar — always visible in battle.
const xpRatio = computed(() => {
  if (playerXpNext.value <= 0) return 0
  return Math.max(0, Math.min(1, playerXp.value / playerXpNext.value))
})

// Decoration: pick an arena-type tint matching the biome for StageBadge.
const arenaTypeForBadge = computed(() => {
  switch (currentStage.value.biome) {
    case 'meadow': return 'forest'
    case 'cave': return 'default'
    case 'tundra': return 'ice'
    case 'swamp': return 'shock'
    case 'volcano': return 'lava'
    default: return 'default'
  }
})

const isMobile = computed(() => mobileCheck())

// ─── Keyboard input (WASD + Arrows) ───────────────────────────────────────
//
// Pure desktop convenience — held keys aggregate into a unit vector
// that's pushed into the same `setJoystick` channel the touch joystick
// uses. We don't render any visual indicator for keyboard input; the
// player just walks. Keys are tracked as a Set so chord presses
// (W+D = NE) work naturally.
const heldKeys = new Set<string>()
const KEY_TO_AXIS: Record<string, { x: number; y: number }> = {
  'KeyW': { x: 0, y: -1 },
  'KeyA': { x: -1, y: 0 },
  'KeyS': { x: 0, y: 1 },
  'KeyD': { x: 1, y: 0 },
  'ArrowUp': { x: 0, y: -1 },
  'ArrowLeft': { x: -1, y: 0 },
  'ArrowDown': { x: 0, y: 1 },
  'ArrowRight': { x: 1, y: 0 }
}

const recomputeKeyboardJoystick = () => {
  let x = 0
  let y = 0
  for (const code of heldKeys) {
    const axis = KEY_TO_AXIS[code]
    if (!axis) continue
    x += axis.x
    y += axis.y
  }
  // Don't override an active touch-joystick. The touch path is
  // exclusive while the user is dragging (sets `joy.active`).
  if (joy.value.active) return
  if (x === 0 && y === 0) {
    setJoystick(0, 0, false)
  } else {
    // Normalize so diagonals don't move √2× faster than cardinals.
    const len = Math.hypot(x, y)
    setJoystick((x / len) * 50, (y / len) * 50, true)
  }
}

const onKeyDown = (e: KeyboardEvent) => {
  if (!(e.code in KEY_TO_AXIS)) return
  if (phase.value !== 'battle' && phase.value !== 'intro') return
  e.preventDefault()
  heldKeys.add(e.code)
  recomputeKeyboardJoystick()
}
const onKeyUp = (e: KeyboardEvent) => {
  if (!(e.code in KEY_TO_AXIS)) return
  heldKeys.delete(e.code)
  recomputeKeyboardJoystick()
}
const onKeyboardBlur = () => {
  heldKeys.clear()
  recomputeKeyboardJoystick()
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onKeyboardBlur)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('blur', onKeyboardBlur)
})

const onCoinsAwardedFromHud = (sourceEl: HTMLElement) => {
  if (!coinBadgeRef.value?.rootEl) return
  spawnCoinExplosion({ sourceEl, targetEl: coinBadgeRef.value.rootEl })
  playSound('reward-continue', 0.06)
}

const onRouletteResult = () => {
  // RouletteWheel emits its own outcome — we only need to play the
  // celebratory VFX from the arena container so drops fly to the badge.
  if (!stageEl.value) return
  onCoinsAwardedFromHud(stageEl.value)
}
</script>

<template lang="pug">
  div.slime-arena.relative.w-full.h-full(ref="stageEl")
    //- Canvas — fills the viewport behind every HUD layer.
    canvas(
      ref="canvasEl"
      class="slime-canvas absolute inset-0"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerEnd"
      @pointercancel="onPointerEnd"
      @pointerleave="onPointerEnd"
    )

    //- ─── Top-left: stage badge + thin progress bar
    div(
      class="absolute top-3 left-3 z-30 flex gap-2 items-start pointer-events-none"
      :style="{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingLeft: 'env(safe-area-inset-left, 0px)' }"
    )
      StageBadge(
        :stage-id="currentStage.id"
        :name="currentStage.name"
        :is-boss="currentStage.isBoss"
        :arena-type="arenaTypeForBadge"
        :player-level="isInBattle ? playerLevel : null"
        :xp-ratio="xpRatio"
        :xp-label="isInBattle ? `${playerXp}/${playerXpNext}` : null"
      )
      //- (Stage-kills progress bar previously rendered here; removed
      //-  because the embedded XP bar inside StageBadge now reads as
      //-  the canonical "how far through the stage" gauge.)

    //- ─── Top-center: intro countdown only. Chaos-arena's BattlePass
    //- button has been moved into the bottom-left HUD row per the
    //- latest layout pass.
    div(class="absolute top-3 z-30 flex flex-col items-center gap-2 pointer-events-none" style="left:50%;transform:translateX(-50%);")
      Transition(name="pop")
        div(
          v-if="introCountdown"
          class="intro-countdown text-white font-black uppercase italic game-text"
        ) {{ introCountdown }}

    //- ─── Top-right column: [Surrender] [DropBadge] / TreasureChest.
    //- SurrenderIcon sits to the left of the SlimeDropBadge (chaos-arena
    //- pattern — red flag, opens its own confirm dialog before firing
    //- `surrender`). TreasureChest sits directly under the badge so the
    //- chest's coin-explosion VFX fires straight up into it.
    div(
      class="absolute top-3 right-3 z-30 flex flex-col items-end gap-2"
      :style="{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingRight: 'env(safe-area-inset-right, 0px)' }"
    )
      div(class="flex items-center gap-2")
        div.pointer-events-auto(v-if="isInBattle")
          SurrenderIcon(@surrender="surrender")
        div.pointer-events-auto
          CoinBadge(ref="coinBadgeRef")
      div.pointer-events-auto(v-if="showOffBattleHud")
        TreasureChest(:target-el="coinBadgeRef?.rootEl ?? null")

    //- ─── Bottom-left HUD cluster:
    //-     [FMute]
    //-     [Settings]
    //-     [DailyRewards] [AdRewardButton] [BattlePass]
    //-
    //- A 3-row vertical stack on the leftmost column (FMute → Settings
    //- → DailyRewards) with AdReward + BattlePass extending the bottom
    //- row to the right. FMute + Settings stay visible in both off-
    //- battle and in-battle states; the reward CTAs are off-battle
    //- only. Gold-gradient settings button mirrors chaos-arena's HUD
    //- styling so the cluster reads as a single decorative block.
    div(
      class="absolute bottom-4 left-3 z-30 flex gap-2 items-end pointer-events-none"
      :style="{ paddingBottom: 'env(safe-area-inset-bottom, 0px)', paddingLeft: 'env(safe-area-inset-left, 0px)' }"
    )
      //- Column 1: FMute + Settings + DailyRewards (bottom of column).
      //- FMute is hidden during a stage battle so the player isn't
      //- tempted to mute mid-fight (volume changes route through the
      //- options modal between stages instead).
      div(class="flex flex-col items-start gap-2")
        div.pointer-events-auto(v-if="showOffBattleHud")
          FMuteButton
        div.pointer-events-auto(v-if="showOffBattleHud")
          //- Chaos-arena-styled settings button: secondary (blue) face
          //- with 3D bottom shadow + dark border + inner shine. Same
          //- gradient FButton uses for `type="secondary"` so the
          //- settings button reads as the cooler-toned counterpart to
          //- the gold reward CTAs sitting next to it.
          button(
            class="cursor-pointer z-10 transition-transform hover:scale-[103%] active:scale-90 scale-80 sm:scale-110"
            @click="showOptions = true"
          )
            div(class="relative")
              div(class="absolute inset-0 translate-y-1 rounded-lg bg-[#102e7a]")
              div(
                class="relative rounded-lg border-2 border-[#0f1a30] bg-gradient-to-b from-[#50aaff] to-[#2266ff] flex items-center justify-center px-2 py-1 sm:py-2 overflow-hidden"
              )
                div(class="absolute inset-x-0 top-0 h-1/2 bg-white/25 rounded-t-lg pointer-events-none")
                img(
                  src="/images/icons/settings-icon_128x128.webp"
                  alt="settings"
                  draggable="false"
                  class="relative w-7 h-7 sm:w-9 sm:h-9"
                )
        div.pointer-events-auto(v-if="showOffBattleHud")
          DailyRewards(@coins-awarded="onCoinsAwardedFromHud")

      //- Column 2: AdReward (sits in the bottom row only).
      div.pointer-events-auto(v-if="showOffBattleHud")
        AdRewardButton(:coins="125" @coins-awarded="onCoinsAwardedFromHud")

      //- Column 3: BattlePass (also bottom row).
      div.pointer-events-auto(v-if="showOffBattleHud")
        BattlePass(@coins-awarded="onCoinsAwardedFromHud")

    //- ─── Bottom-right (off-battle): upgrades shop trigger.
    div(
      v-if="showOffBattleHud"
      class="absolute bottom-4 right-3 z-30 pointer-events-auto"
      :style="{ paddingBottom: 'env(safe-area-inset-bottom, 0px)', paddingRight: 'env(safe-area-inset-right, 0px)' }"
    )
      button(
        @click="showShop = true"
        class="upgrades-btn cursor-pointer transition-transform active:scale-95 hover:scale-105 rounded-2xl border-[3px] border-[#0f1a30] px-4 py-2 text-white font-black uppercase italic game-text"
        :style="{ backgroundImage: 'linear-gradient(to bottom, #ffcd00, #f7a000)', boxShadow: '0 5px 0 #5a3a00' }"
      )
        | Upgrades

    //- ─── Center (off-battle): "tap to start battle" CTA.
    //- Plain pulsing text — no FButton wrapper. Tapping anywhere on
    //- this overlay starts the battle, so the CTA reads as the
    //- entire dimmed playfield rather than a single button.
    div(
      v-if="showOffBattleHud"
      class="absolute inset-0 z-20 flex items-center justify-center pointer-events-auto cursor-pointer select-none"
      @click="beginStage"
    )
      div(class="text-center px-6")
        div(class="tap-to-start text-white font-black uppercase italic game-text text-3xl sm:text-5xl tracking-wider") {{ isMobile ? 'Tap to Start Battle' : 'Click to Start Battle' }}
        div(class="text-white/70 game-text text-xs sm:text-sm italic mt-2") Stage {{ currentStage.id }} · {{ currentStage.name }}

    //- (No bottom HP bar in-battle — the half-ring HP arc rendered
    //-  above each character by `useSlimeRenderer.drawHpArc` is the
    //-  sole health indicator. Keeps the playfield uncluttered and
    //-  forces the player's eye to the slime, not to a HUD strip.)

    //- ─── Virtual joystick (mobile only — desktop uses WASD/Arrows).
    //- The joystick is hidden on non-touch devices regardless of
    //- whether the joy state happened to engage.
    Transition(name="pop")
      div(
        v-if="isMobile && joy.active && (isInBattle || phase === 'intro')"
        class="joy-base fixed pointer-events-none z-40"
        :style="joyStyle"
      )
        div(class="joy-ring rounded-full border-2 border-white/40 w-32 h-32 bg-white/10 backdrop-blur-sm")
        div(
          class="joy-stick absolute rounded-full w-12 h-12 bg-emerald-400/85 border-2 border-emerald-200 shadow-lg"
          style="left:50%;top:50%;"
          :style="stickStyle"
        )

    //- ─── In-battle: level-up choice modal
    UpgradeChoiceModal(
      v-if="phase === 'levelup'"
      v-model="showLevelUp"
      @choose="acceptUpgradeChoice"
    )

    //- ─── Off-battle: upgrade shop modal
    UpgradeShopModal(v-model="showShop")

    //- ─── Off-battle / mid-stage: options modal.
    //- OptionsModal still uses its chaos-arena contract (`isOpen` prop +
    //- `close` event) rather than `v-model`, so the parent has to wire
    //- those two manually — using v-model here silently dropped the
    //- close path.
    OptionsModal(
      :is-open="showOptions"
      @close="showOptions = false"
    )

    //- ─── Stage clear FReward overlay
    FReward(:model-value="phase === 'cleared'" :show-continue="true" @continue="onClearedContinue")
      template(#ribbon)
        span(class="text-white font-black uppercase italic game-text") Stage Clear
      div(class="flex flex-col items-center gap-3 pt-2")
        div(class="text-white font-black italic game-text text-2xl sm:text-3xl") {{ currentStage.name }}
        div(class="flex items-center gap-2 bg-black/40 rounded-xl px-4 py-2")
          IconSlimeDrop(class="w-7 h-7 sm:w-9 sm:h-9")
          div(class="text-amber-200 font-black game-text text-2xl sm:text-3xl") +{{ stageClearReward?.drops ?? 0 }}
        div(class="text-white/90 text-xs sm:text-sm italic") Killed {{ stageSpawned }} of {{ currentStage.enemyCount }} slimes.

    //- ─── Game-over FReward overlay
    FReward(:model-value="phase === 'gameover'" :show-continue="true" @continue="onGameoverContinue")
      template(#ribbon)
        span(class="text-red-200 font-black uppercase italic game-text") Defeated
      div(class="flex flex-col items-center gap-3 pt-2")
        div(class="text-white font-black italic game-text text-2xl sm:text-3xl") {{ currentStage.name }}
        div(class="text-white/90 text-xs sm:text-sm italic") Try again — your upgrades stay.

    //- ─── Roulette (every 5th stage clear) — self-modal, hidden via v-model
    RouletteWheel(v-model="showRoulette" @result="onRouletteResult")
</template>

<style scoped lang="sass">
.slime-arena
  background-color: #0d1d28
  // Cap the arena to the visible safe area so the canvas never paints
  // under the iPhone notch / nav indicator.

.slime-canvas
  display: block
  width: 100%
  height: 100%
  touch-action: none

.intro-countdown
  font-size: clamp(2.5rem, 12vw, 6rem)
  text-shadow: 4px 4px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000
  animation: countdown-pop 0.4s ease-out

@keyframes countdown-pop
  0%
    transform: scale(0.4)
    opacity: 0
  60%
    transform: scale(1.1)
    opacity: 1
  100%
    transform: scale(1)
    opacity: 1

// Soft pulse on the off-battle "tap to start" CTA — invites attention
// without hiding the slime arena behind a solid button.
.tap-to-start
  text-shadow: 4px 4px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000
  animation: tap-pulse 1.6s ease-in-out infinite

@keyframes tap-pulse
  0%, 100%
    opacity: 0.85
    transform: translateY(0)
  50%
    opacity: 1
    transform: translateY(-4px)

// ─── Joystick visuals ─────────────────────────────────────────────────────
.joy-ring
  position: relative

.joy-stick
  pointer-events: none

// ─── Pop transition (intro countdown, joystick) ───────────────────────────
.pop-enter-active, .pop-leave-active
  transition: transform 0.18s ease, opacity 0.18s ease
.pop-enter-from, .pop-leave-to
  transform: scale(0.5)
  opacity: 0

// ─── Buttons + landscape squeeze ─────────────────────────────────────────
.upgrades-btn, .settings-btn
  min-width: 6rem
  font-size: 0.875rem
  @media (min-width: 640px)
    font-size: 1rem

@media (orientation: landscape) and (max-height: 500px)
  .stage-progress
    margin-top: 1rem
</style>
