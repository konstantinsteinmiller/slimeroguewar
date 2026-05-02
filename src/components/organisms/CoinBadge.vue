<script setup lang="ts">
import { ref } from 'vue'
import IconSlimeDrop from '@/components/icons/IconSlimeDrop.vue'
import useSlimeDrops from '@/use/useSlimeDrops'

const { drops } = useSlimeDrops()

// Exposed so siblings (TreasureChest, FReward, AdRewardButton, etc.) can
// target the badge as the fly-to anchor for spawnCoinExplosion VFX.
const rootEl = ref<HTMLElement | null>(null)
defineExpose({ rootEl })
</script>

<template lang="pug">
  div.slime-drop-badge.relative.flex.items-center.gap-2.rounded-full.font-bold(
    ref="rootEl"
    class="pl-1 pr-3 py-1 text-sm sm:text-base"
  )
    div.slime-drop-badge__icon.flex.items-center.justify-center.rounded-full(
      class="w-7 h-7 sm:w-8 sm:h-8"
    )
      IconSlimeDrop(class="w-5 h-5 sm:w-6 sm:h-6 drop-shadow")
    span.game-text.slime-drop-badge__value {{ drops }}
</template>

<style scoped lang="sass">
.slime-drop-badge
  background: linear-gradient(135deg, #50aaff 0%, #2266ff 50%, #1b3e95 100%)
  border: 2px solid #bdf264
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6), 0 4px 10px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.25), inset 0 -2px 4px rgba(0, 0, 0, 0.4)
  overflow: hidden

  &::before
    content: ''
    position: absolute
    inset: 0
    background: linear-gradient(115deg, transparent 35%, rgba(255, 255, 255, 0.35) 50%, transparent 65%)
    background-size: 250% 100%
    animation: slime-shine 3.5s linear infinite
    pointer-events: none

  &__icon
    background: radial-gradient(circle at 30% 30%, #e6ffb0 0%, #bdf264 35%, #5a8d00 100%)
    box-shadow: 0 0 8px rgba(189, 242, 100, 0.7), inset 0 -2px 3px rgba(0, 0, 0, 0.35), inset 0 1px 2px rgba(255, 255, 255, 0.6)
    border: 1px solid #2e4a00

  &__value
    color: #f0ffd6
    text-shadow: 0 1px 0 #000, 0 0 6px rgba(189, 242, 100, 0.7)
    letter-spacing: 0.5px
    position: relative

@keyframes slime-shine
  0%
    background-position: 200% 0
  100%
    background-position: -100% 0
</style>
