<script setup lang="ts">
import { computed } from 'vue'
import FModal from '@/components/molecules/FModal.vue'
import IconSlimeDrop from '@/components/icons/IconSlimeDrop.vue'
import {
  UPGRADE_DEFS,
  UPGRADE_IDS,
  collectRadiusCost,
  upgradeCost,
  useSlimeUpgrades,
  type SlimeUpgradeId
} from '@/use/useSlimeUpgrades'
import useSlimeDrops from '@/use/useSlimeDrops'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', open: boolean): void }>()

const { drops, spendDrops } = useSlimeDrops()
const upgrades = useSlimeUpgrades()

const closeModal = () => emit('update:modelValue', false)

/** Shop only sells permanent upgrades — `tempOnly` ones (defense /
 *  autoRegen / moveSpeed / evade / splash / fireDot) are level-up
 *  modal exclusives, so we filter them out of the shop grid. */
const SHOP_UPGRADE_IDS = UPGRADE_IDS.filter((id) => !UPGRADE_DEFS[id].tempOnly)

const valueFor = (id: SlimeUpgradeId, level: number) => {
  const def = UPGRADE_DEFS[id]
  if (def.unit === '%') {
    const pct = Math.round((def.perLevelPct ?? 0) * level * 100)
    return `+${pct}%`
  }
  return `+${(def.perLevelFlat ?? 0) * level} HP`
}

// The shop only renders perm upgrades (filtered by SHOP_UPGRADE_IDS),
// but the SlimeUpgradeId union also covers temp-only entries. Default
// branches keep the function exhaustive without us hand-listing every
// temp-only label here — those are owned by UpgradeChoiceModal.
const titleFor = (id: SlimeUpgradeId): string => {
  switch (id) {
    case 'damage': return 'Sticky Damage'
    case 'fireRate': return 'Quick Splat'
    case 'critRate': return 'Lucky Goop'
    case 'critDamage': return 'Crit Crush'
    case 'maxHp': return 'Bigger Belly'
    default: return ''
  }
}

const descriptionFor = (id: SlimeUpgradeId): string => {
  switch (id) {
    case 'damage': return 'Each shot hits harder. Permanent buff.'
    case 'fireRate': return 'You shoot faster. Permanent buff.'
    case 'critRate': return 'Higher chance to deal a critical hit.'
    case 'critDamage': return 'Critical hits do even more damage.'
    case 'maxHp': return 'You can take more punishment per stage.'
    default: return ''
  }
}

const buy = (id: SlimeUpgradeId) => {
  const lvl = upgrades.levelOf(id)
  const cost = upgradeCost(lvl)
  if (!spendDrops(cost)) return
  upgrades.incrementLevel(id)
}

const buyCollect = () => {
  const cost = collectRadiusCost(upgrades.collectRadiusLevel.value)
  if (!spendDrops(cost)) return
  upgrades.incrementCollectLevel()
}

const cardStyle = (id: SlimeUpgradeId) => {
  const def = UPGRADE_DEFS[id]
  return {
    backgroundImage: `linear-gradient(to bottom, ${def.colorFrom}, ${def.colorTo})`,
    boxShadow: `0 5px 0 ${def.shadowColor}`
  }
}

const collectStyle = computed(() => ({
  backgroundImage: 'linear-gradient(to bottom, #50aaff, #1a4ec4)',
  boxShadow: '0 5px 0 #102e7a'
}))
</script>

<template lang="pug">
  FModal(:model-value="modelValue" @update:model-value="closeModal" title="Upgrades")
    div(class="flex flex-col gap-3 w-full max-w-2xl mx-auto p-2")
      //- Player upgrades — five stat cards
      div(class="upgrade-row grid gap-2 grid-cols-1 sm:grid-cols-2")
        div(
          v-for="id in SHOP_UPGRADE_IDS"
          :key="id"
          class="relative rounded-xl border-[3px] border-[#0f1a30] p-3 text-left text-white"
          :style="cardStyle(id)"
        )
          div(class="absolute inset-x-0 top-0 h-1/2 bg-white/20 rounded-t-xl pointer-events-none")
          div(class="relative flex flex-col gap-1")
            div(class="flex justify-between items-start gap-2")
              div(class="font-black uppercase italic game-text text-base sm:text-lg leading-tight") {{ titleFor(id) }}
              div(class="bg-black/40 text-amber-200 font-black rounded-md px-2 py-0.5 text-xs game-text") Lv {{ upgrades.levelOf(id) }}
            div(class="text-white/95 text-xs sm:text-sm font-bold leading-snug") {{ descriptionFor(id) }}
            div(class="text-white/95 text-[11px] sm:text-xs italic") Now: {{ valueFor(id, upgrades.levelOf(id)) || 'none' }} → Next: {{ valueFor(id, upgrades.levelOf(id) + 1) }}
            button(
              class="mt-1 self-end flex items-center gap-1.5 bg-black/30 hover:bg-black/50 active:scale-95 transition-transform rounded-lg border-2 border-black/40 px-3 py-1 text-white font-black text-xs sm:text-sm cursor-pointer"
              :disabled="drops < upgradeCost(upgrades.levelOf(id))"
              :class="{ 'opacity-50 grayscale pointer-events-none': drops < upgradeCost(upgrades.levelOf(id)) }"
              @click="buy(id)"
            )
              IconSlimeDrop(class="w-4 h-4")
              span {{ upgradeCost(upgrades.levelOf(id)) }}

      //- Collection radius card (purchased separately, not part of the
      //- in-battle level-up pool).
      div(
        class="relative rounded-xl border-[3px] border-[#0f1a30] p-3 text-left text-white"
        :style="collectStyle"
      )
        div(class="absolute inset-x-0 top-0 h-1/2 bg-white/20 rounded-t-xl pointer-events-none")
        div(class="relative flex flex-col gap-1")
          div(class="flex justify-between items-start gap-2")
            div(class="font-black uppercase italic game-text text-base sm:text-lg leading-tight") Drop Magnet
            div(class="bg-black/40 text-amber-200 font-black rounded-md px-2 py-0.5 text-xs game-text") Lv {{ upgrades.collectRadiusLevel }}
          div(class="text-white/95 text-xs sm:text-sm font-bold leading-snug") Slime drops are pulled in from a wider radius around you.
          div(class="text-white/95 text-[11px] sm:text-xs italic") Now: {{ Math.round(upgrades.collectRadius.value) }} px → Next: {{ Math.round(upgrades.collectRadius.value) + 18 }} px
          button(
            class="mt-1 self-end flex items-center gap-1.5 bg-black/30 hover:bg-black/50 active:scale-95 transition-transform rounded-lg border-2 border-black/40 px-3 py-1 text-white font-black text-xs sm:text-sm cursor-pointer"
            :disabled="drops < collectRadiusCost(upgrades.collectRadiusLevel)"
            :class="{ 'opacity-50 grayscale pointer-events-none': drops < collectRadiusCost(upgrades.collectRadiusLevel) }"
            @click="buyCollect"
          )
            IconSlimeDrop(class="w-4 h-4")
            span {{ collectRadiusCost(upgrades.collectRadiusLevel) }}
</template>
