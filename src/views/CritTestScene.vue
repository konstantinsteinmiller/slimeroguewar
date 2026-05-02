<script setup lang="ts">
import { ref, onMounted, onUnmounted, type Ref } from 'vue'
import useSpinnerGame, { ARENA_RADIUS } from '@/use/useSpinnerGame'
import type { SpinnerConfig } from '@/types/spinner'

// ─── Crit Test Scene ────────────────────────────────────────────────────────
// Launches a fast player blade directly into the rear of a slower-moving NPC
// blade so the back-side crit cone fires. Used to visually verify the orange
// pulsating crit damage number.

const {
  phase,
  playerBlades,
  npcBlades,
  initGame,
  startPhysics,
  stopPhysics,
  render
} = useSpinnerGame()

const canvasRef: Ref<HTMLCanvasElement | null> = ref(null)
const canvasWidth: Ref<number> = ref(0)
const canvasHeight: Ref<number> = ref(0)

const updateCanvasSize = () => {
  const canvas = canvasRef.value
  if (!canvas) return
  canvasWidth.value = window.innerWidth
  canvasHeight.value = window.innerHeight
  canvas.width = canvasWidth.value
  canvas.height = canvasHeight.value
}

const setupScene = () => {
  const playerCfg: SpinnerConfig = { topPartId: 'star', bottomPartId: 'speedy' }
  const npcCfg: SpinnerConfig = { topPartId: 'round', bottomPartId: 'tanky' }

  initGame([playerCfg], [npcCfg], false, 'default')

  const player = playerBlades.value[0]
  const npc = npcBlades.value[0]
  if (!player || !npc) return

  // NPC: centered, moving steadily to the right at ~40% of max launch force
  // (well above the 25% crit speed gate).
  npc.x = 0
  npc.y = 0
  npc.vx = 5.5
  npc.vy = 0
  npc.ax = 0
  npc.ay = 0
  npc.accelFramesLeft = 0
  npc.wallBounceCount = 0

  // Player: positioned directly behind the NPC (to its LEFT, since NPC moves
  // right) and launched at full speed in the same direction so it catches the
  // NPC's rear within the 90° cone.
  player.x = -ARENA_RADIUS * 0.55
  player.y = 0
  player.vx = 14
  player.vy = 0
  player.ax = 0
  player.ay = 0
  player.accelFramesLeft = 0
  player.wallBounceCount = 0

  // Skip the launch/turn machinery — pretend the player just launched so the
  // physics step processes collisions and game-over checks normally.
  phase.value = 'player_launched'

  startPhysics()
}

const restart = () => {
  stopPhysics()
  setupScene()
}

let renderRafId: number | null = null

const renderLoop = () => {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  render(ctx, canvasWidth.value, canvasHeight.value, false)
  renderRafId = requestAnimationFrame(renderLoop)
}

onMounted(() => {
  updateCanvasSize()
  window.addEventListener('resize', updateCanvasSize)
  setupScene()
  renderRafId = requestAnimationFrame(renderLoop)
})

onUnmounted(() => {
  window.removeEventListener('resize', updateCanvasSize)
  stopPhysics()
  if (renderRafId !== null) cancelAnimationFrame(renderRafId)
})
</script>

<template lang="pug">
  div.relative.w-screen.h-screen.overflow-hidden.flex.items-center.justify-center(class="bg-[#0d1117]")
    canvas(ref="canvasRef" class="block touch-none")

    div.absolute.top-2.left-2.flex.flex-col.gap-2.pointer-events-auto
      div.text-white.font-bold.game-text(class="text-xs sm:text-sm bg-black/60 px-2 py-1 rounded")
        | Crit Test — player chases NPC from behind
      button(
        @click="restart"
        class="self-start bg-yellow-500 hover:bg-yellow-400 text-white font-bold px-3 py-1 rounded cursor-pointer game-text text-xs sm:text-sm"
      ) Restart
</template>
