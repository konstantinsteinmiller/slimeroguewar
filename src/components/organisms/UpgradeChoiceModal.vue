<script setup lang="ts">
import { ref, watch } from 'vue'
import { UPGRADE_DEFS, UPGRADE_IDS, useSlimeUpgrades, type SlimeUpgradeId } from '@/use/useSlimeUpgrades'
import { getTempLevel } from '@/use/useSlimeGame'

const props = defineProps<{
  /** Open when the player just leveled up. */
  modelValue: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', open: boolean): void
  (e: 'choose', id: SlimeUpgradeId): void
}>()

const upgrades = useSlimeUpgrades()

/** Effective level seen on the modal cards = perm shop levels + this
 *  stage's accumulated temp levels. Reads `getTempLevel` from the
 *  game module so the chip on each pick reflects the player's actual
 *  in-stage progression instead of resetting per modal open. */
const effectiveLevel = (id: SlimeUpgradeId): number =>
  upgrades.levelOf(id) + getTempLevel(id)

/** Picks 3 unique upgrades each time the modal opens. Filters out any
 *  upgrades that have already hit their `maxLevel` cap so the player
 *  never sees a card they can't actually take. */
const choices = ref<SlimeUpgradeId[]>([])
const rerollChoices = () => {
  const eligible = UPGRADE_IDS.filter((id) => {
    const def = UPGRADE_DEFS[id]
    if (def.maxLevel !== undefined && effectiveLevel(id) >= def.maxLevel) return false
    return true
  })
  const pool = [...eligible]
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j]!, pool[i]!]
  }
  choices.value = pool.slice(0, 3)
}

watch(() => props.modelValue, (open) => {
  if (open) rerollChoices()
}, { immediate: true })

/** Render helper — formats a (level → value) label across all units
 *  the upgrade pool now supports (`%`, `HP`, `HP/s`). Centralized so
 *  the next-level chip and the current-level subtitle share format
 *  rules. */
const formatValueAtLevel = (id: SlimeUpgradeId, level: number): string => {
  const def = UPGRADE_DEFS[id]
  if (def.unit === '%') {
    const pct = Math.round((def.perLevelPct ?? 0) * level * 100)
    return `+${pct}%`
  }
  if (def.unit === 'HP/s') {
    const value = (def.perLevelFlat ?? 0) * level
    // Round-half to 1 decimal so 1.5 → "1.5", 4.5 → "4.5", 6 → "6".
    return `+${Number.isInteger(value) ? value : value.toFixed(1)} HP/s`
  }
  return `+${(def.perLevelFlat ?? 0) * level} HP`
}

const valueLabel = (id: SlimeUpgradeId, level: number) =>
  formatValueAtLevel(id, level)

const nextValueLabel = (id: SlimeUpgradeId) => {
  const lvl = effectiveLevel(id) + 1
  return `Lv ${lvl} · ${formatValueAtLevel(id, lvl)}`
}

const titleFor = (id: SlimeUpgradeId): string => {
  switch (id) {
    case 'damage': return 'Sticky Damage'
    case 'fireRate': return 'Quick Splat'
    case 'critRate': return 'Lucky Goop'
    case 'critDamage': return 'Crit Crush'
    case 'maxHp': return 'Bigger Belly'
    case 'defense': return 'Tough Skin'
    case 'autoRegen': return 'Slime Regrowth'
    case 'moveSpeed': return 'Slick Glide'
    case 'evade': return 'Slippery'
    case 'splash': return 'Splat Burst'
    case 'fireDot': return 'Plague Goo'
  }
}

const descriptionFor = (id: SlimeUpgradeId): string => {
  switch (id) {
    case 'damage': return 'Each shot hits harder. Permanent.'
    case 'fireRate': return 'Splat enemies faster. Permanent.'
    case 'critRate': return 'More chance for sparkly crits.'
    case 'critDamage': return 'Crits leave a much bigger mark.'
    case 'maxHp': return 'A juicier slime takes more hits.'
    case 'defense': return 'Take less damage from every source.'
    case 'autoRegen': return 'Slowly regenerate HP over time.'
    case 'moveSpeed': return 'Glide across the arena faster.'
    case 'evade': return 'Chance to dodge a hit completely.'
    case 'splash': return 'Bullets splash damage in a forward cone.'
    case 'fireDot': return 'Bullets ignite enemies. Burn spreads. Max Lv 2.'
  }
}

const pick = (id: SlimeUpgradeId) => {
  emit('choose', id)
  emit('update:modelValue', false)
}

const cardStyle = (id: SlimeUpgradeId) => {
  const def = UPGRADE_DEFS[id]
  return {
    backgroundImage: `linear-gradient(to bottom, ${def.colorFrom}, ${def.colorTo})`,
    boxShadow: `0 6px 0 ${def.shadowColor}`
  }
}
</script>

<template lang="pug">
  Teleport(to="body")
    Transition(name="fade")
      div(
        v-if="modelValue"
        class="upgrade-choice-overlay fixed inset-0 z-[120] flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm"
        :style="{\
          paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))',\
          paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))',\
          paddingLeft: 'calc(0.75rem + env(safe-area-inset-left, 0px))',\
          paddingRight: 'calc(0.75rem + env(safe-area-inset-right, 0px))'\
        }"
      )
        div(class="text-center mb-4")
          div(class="text-amber-300 font-black uppercase tracking-widest game-text text-sm sm:text-base") LEVEL UP
          div(class="text-white font-black uppercase italic game-text text-2xl sm:text-3xl mt-1") Pick One

        div(class="upgrade-cards flex gap-3 flex-wrap justify-center items-stretch w-full max-w-3xl")
          button(
            v-for="id in choices"
            :key="id"
            :style="cardStyle(id)"
            class="upgrade-card relative cursor-pointer transition-transform text-left flex-1 hover:scale-[103%] active:scale-95 rounded-2xl border-[3px] border-[#0f1a30] p-4 min-w-[140px] max-w-[230px] basis-[28%]"
            @click="pick(id)"
          )
            div(class="absolute inset-x-0 top-0 h-1/2 bg-white/25 rounded-t-2xl pointer-events-none")
            div(class="relative flex flex-col gap-2 h-full")
              div(class="font-black uppercase italic text-white game-text text-base sm:text-lg leading-tight") {{ titleFor(id) }}
              div(class="text-white/95 text-xs sm:text-sm font-bold leading-tight") {{ descriptionFor(id) }}
              div(class="mt-auto pt-2 flex justify-between items-center")
                div(class="bg-black/40 text-white font-black rounded-md px-2 py-1 text-xs sm:text-sm game-text") {{ nextValueLabel(id) }}
                div(class="text-white/90 text-[10px] sm:text-xs font-bold") {{ valueLabel(id, upgrades.levelOf(id)) || 'Lv 0' }}
</template>

<style scoped lang="sass">
.fade-enter-active, .fade-leave-active
  transition: opacity 0.25s ease
.fade-enter-from, .fade-leave-to
  opacity: 0

.upgrade-card
  // Reserve some height even when content is short so cards line up.
  min-height: 9rem

  @media (orientation: landscape) and (max-height: 500px)
    min-height: 7rem
    padding: 0.6rem 0.75rem

  // Avoid the scale-110/120 quirks we want to clean up — let flex
  // do the responsive work instead.
</style>
