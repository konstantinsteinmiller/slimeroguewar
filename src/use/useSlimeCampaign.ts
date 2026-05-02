import { computed, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { saveDataVersion } from '@/use/useSaveStatus'

/**
 * Stage progression + difficulty curve for the slime campaign.
 *
 * Design pillars:
 *   • Levels 1..5 are the "rookie tier" — short waves (~12-22 enemies),
 *     soft enemies, generous slime-drop yield. The goal is for a
 *     first-time player to see at least three Stage Cleared screens in
 *     their first session.
 *   • Level 5 is the first boss (a big slime with much more HP, no
 *     adds). After that the difficulty ramps via:
 *       - more enemies per stage (linear)
 *       - bigger slimes with more HP (linear with sqrt smoothing)
 *       - faster spawn cadence
 *       - bosses every 5 stages, each with a unique modifier (split,
 *         heal, summon, lightning).
 *   • Stage names are pulled from i18n if a key exists; otherwise we
 *     fall back to the procedural name (e.g. "Slime Forest 12").
 *
 * Persistence: the campaign stage id is saved under `STAGE_KEY`
 * ('spinner_campaign_stage') — same key chaos-arena used, so save
 * merge policy already handles it.
 */

import { STAGE_KEY } from '@/keys'

export type SlimeBiome = 'meadow' | 'cave' | 'tundra' | 'swamp' | 'volcano'

export interface SlimeStageConfig {
  id: number
  name: string
  biome: SlimeBiome
  isBoss: boolean
  /** Total enemies that must be defeated to clear the stage. */
  enemyCount: number
  /** Average enemy HP — actual enemies vary ±20%. */
  enemyHp: number
  /** Average enemy radius in CSS px. Bigger slimes look heavier. */
  enemyRadius: number
  /** Average enemy speed in px/sec. */
  enemySpeed: number
  /** Average damage per contact tick. */
  enemyDamage: number
  /** Slime drops dropped per kill. */
  dropsPerKill: number
  /** XP awarded per kill toward player level-up. */
  xpPerKill: number
  /** Spawn interval in ms — capped so screen never freezes. */
  spawnInterval: number
  /** Optional boss modifier descriptor (cosmetic + behavioral). */
  bossKind?: 'tank' | 'splitter' | 'summoner' | 'healer' | 'lightning'
}

const BIOME_ORDER: SlimeBiome[] = ['meadow', 'cave', 'tundra', 'swamp', 'volcano']
const BIOME_BY_STAGE = (id: number): SlimeBiome => BIOME_ORDER[Math.floor((id - 1) / 5) % BIOME_ORDER.length]!

/** Built-in name table for stages 1..50; beyond that we fall back to
 *  `${biome} ${id}`. The table is intentionally short — past stage 50
 *  the player has already settled into the loop and procedural names
 *  feel right for the endless tail.
 */
const STAGE_NAME_TABLE: Record<number, string> = {
  1: 'Sprout Meadow',
  2: 'Dewy Hollow',
  3: 'Mossy Path',
  4: 'Sunny Glade',
  5: 'Big Greenie',
  6: 'Hollow Cave',
  7: 'Drip Tunnel',
  8: 'Glow Cavern',
  9: 'Echo Pit',
  10: 'Cave Tyrant',
  11: 'Frost Plain',
  12: 'Snowy Hollow',
  13: 'Icicle Valley',
  14: 'Frozen Lake',
  15: 'Ice Behemoth',
  16: 'Murky Bog',
  17: 'Sluggy Marsh',
  18: 'Toxic Pool',
  19: 'Mud Field',
  20: 'Swamp Sovereign',
  21: 'Ash Plain',
  22: 'Smoldering Cave',
  23: 'Lava Run',
  24: 'Magma Brink',
  25: 'Volcano King',
  26: 'Verdant Meadow',
  27: 'Wild Glade',
  28: 'Bramble Hollow',
  29: 'Spore Field',
  30: 'Spore Mother',
  31: 'Crystal Cave',
  32: 'Glimmer Tunnel',
  33: 'Quartz Pit',
  34: 'Geode Hall',
  35: 'Crystal Behemoth',
  36: 'Glacial Drift',
  37: 'Hailstone Field',
  38: 'Cold Hollow',
  39: 'Frozen Spire',
  40: 'Hailstorm Tyrant',
  41: 'Sunken Marsh',
  42: 'Festering Bog',
  43: 'Acid Pool',
  44: 'Sulfur Field',
  45: 'Plague King',
  46: 'Cinder Plain',
  47: 'Charcoal Cave',
  48: 'Magma River',
  49: 'Inferno Brink',
  50: 'Magma Sovereign'
}

const stageName = (id: number): string => {
  const named = STAGE_NAME_TABLE[id]
  if (named) return named
  const biome = BIOME_BY_STAGE(id)
  return `${biome} ${id}`
}

const isBossStage = (id: number): boolean => id % 5 === 0

const bossKindFor = (id: number): SlimeStageConfig['bossKind'] => {
  // Cycles through five boss flavors so the player sees a different
  // mechanic each boss attempt without us hand-authoring 50+ bosses.
  const kinds: NonNullable<SlimeStageConfig['bossKind']>[] = ['tank', 'splitter', 'summoner', 'healer', 'lightning']
  return kinds[Math.floor((id / 5 - 1) % kinds.length)]!
}

export const buildStageConfig = (id: number): SlimeStageConfig => {
  const boss = isBossStage(id)
  const biome = BIOME_BY_STAGE(id)

  // Rookie tier: stages 1..4 are intentionally short and slow.
  const rookie = id <= 4

  // Non-boss enemy count: 24 → ~160 across 50 stages. Doubled from
  // the chaos-arena seed (12 → 80) so a stage takes long enough that
  // mid-fight upgrades are felt — earlier curve was too short for the
  // level-up upgrade picks to matter to the outcome.
  const enemyCount = boss
    ? 1 + Math.max(0, Math.floor((id - 5) / 10)) // boss alone, sometimes with adds
    : Math.round(24 + (id - 1) * 2.8)

  // HP / damage / speed scale — quadratic at first, smoothed with sqrt
  // afterwards so the curve doesn't asymptote out of reach.
  const tier = id <= 5 ? 0 : Math.sqrt(id - 5)
  const enemyHp = boss
    ? Math.round(140 + (id) * 35 + tier * 80)
    : Math.round(8 + id * 2.4 + tier * 6)
  const enemyDamage = Math.round(2 + id * 0.55 + tier * 1.1)
  const enemySpeed = Math.min(rookie ? 60 : 95, 50 + id * 1.6)
  const enemyRadius = boss
    ? 56 + Math.min(28, id * 0.6)
    : Math.min(28, 14 + Math.floor(id / 4))

  return {
    id,
    name: stageName(id),
    biome,
    isBoss: boss,
    enemyCount,
    enemyHp,
    enemyRadius,
    enemySpeed,
    enemyDamage,
    dropsPerKill: boss ? 18 + Math.floor(id / 5) * 3 : 1 + Math.floor(id / 6),
    xpPerKill: boss ? 12 + Math.floor(id / 5) : 1 + Math.floor(id / 8),
    spawnInterval: Math.max(220, rookie ? 1300 - id * 60 : 1000 - id * 14),
    bossKind: boss ? bossKindFor(id) : undefined
  }
}

const loadStageId = (): number => {
  try {
    const raw = localStorage.getItem(STAGE_KEY)
    if (raw) {
      const parsed = parseInt(raw, 10)
      if (Number.isFinite(parsed) && parsed >= 1) return parsed
    }
  } catch { /* fall through */ }
  return 1
}

const stageId: Ref<number> = ref(loadStageId())

watch(saveDataVersion, () => {
  stageId.value = loadStageId()
})

const persist = () => {
  localStorage.setItem(STAGE_KEY, stageId.value.toString())
}

export const useSlimeCampaign = () => {
  const currentStage = computed(() => buildStageConfig(stageId.value))

  const advanceStage = (): SlimeStageConfig => {
    stageId.value += 1
    persist()
    return currentStage.value
  }

  const setStage = (id: number): SlimeStageConfig => {
    stageId.value = Math.max(1, Math.floor(id))
    persist()
    return currentStage.value
  }

  return {
    stageId,
    currentStage,
    advanceStage,
    setStage
  }
}

export default useSlimeCampaign
