import { computed, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { saveDataVersion } from '@/use/useSaveStatus'

/**
 * Player-stat upgrades. Five stats, every level adds a percentage (or
 * a flat HP amount). Stored as a level-per-stat dictionary in
 * localStorage so a refresh / cloud-hydrate restores the player's
 * progression.
 *
 * Two purchase paths:
 *   1. **Shop (off-battle).** Open the UpgradesButton menu and spend
 *      slime drops directly. Cost scales with current level.
 *   2. **Level-up choice (in-battle).** Every player-level grants a
 *      free 1-of-3 random pick from the same upgrade pool. The shop
 *      cost is bypassed for the picked upgrade.
 *
 * Shared "level" pointer means the in-battle pick stacks on top of the
 * shop purchases — a player who farmed shop levels 1..5 of damage and
 * gets damage from the level-up dialog ends up at level 6, not level 1.
 *
 * Balance numbers below are tuned for "rookie levels" 1..5 to feel
 * generous (cheap, big steps) and gradually plateau into a flatter
 * curve so endgame upgrades cost more but still progress.
 */

export type SlimeUpgradeId =
  | 'damage'
  | 'fireRate'
  | 'critRate'
  | 'critDamage'
  | 'maxHp'
  // ── Temp-only upgrades (in-battle level-up pool, never sold in the shop)
  | 'defense'
  | 'autoRegen'
  | 'moveSpeed'
  | 'evade'
  | 'splash'
  | 'fireDot'

export interface SlimeUpgradeDef {
  id: SlimeUpgradeId
  /** i18n key under `upgrades.{id}.label`. */
  label: string
  /** i18n key under `upgrades.{id}.desc`. */
  desc: string
  /** Tailwind gradient (from/to) for the card background. */
  colorFrom: string
  colorTo: string
  shadowColor: string
  /** Per-level percentage gain (e.g. 0.15 → +15% per level). */
  perLevelPct?: number
  /** Per-level flat gain (HP for maxHp, HP/s for autoRegen). */
  perLevelFlat?: number
  /** Display unit for the value. */
  unit: '%' | 'HP' | 'HP/s'
  /** Base value at level 0. */
  base: number
  /** Soft cap on the percentage scaler (for diminishing-return upgrades
   *  like defense or evade). Applied at the call site that reads the
   *  effective multiplier — kept here so the cap travels with the def. */
  pctCap?: number
  /** When true, the upgrade only appears in the in-battle level-up
   *  modal (per-stage temp progression). The shop modal filters these
   *  out — the shop is the only source of permanent stat purchases. */
  tempOnly?: boolean
  /** Hard ceiling on how many times this upgrade can be picked in a
   *  single stage. The level-up roller filters out maxed upgrades so
   *  the player never sees them after the cap is hit. Undefined = no cap. */
  maxLevel?: number
}

export const UPGRADE_DEFS: Record<SlimeUpgradeId, SlimeUpgradeDef> = {
  damage: {
    id: 'damage',
    label: 'damage',
    desc: 'damage',
    colorFrom: '#ff7a3a',
    colorTo: '#c12a00',
    shadowColor: '#5a0e00',
    perLevelPct: 0.18,
    unit: '%',
    base: 0
  },
  fireRate: {
    id: 'fireRate',
    label: 'fireRate',
    desc: 'fireRate',
    colorFrom: '#ffcd00',
    colorTo: '#f7a000',
    shadowColor: '#5a3a00',
    perLevelPct: 0.12,
    unit: '%',
    base: 0
  },
  critRate: {
    id: 'critRate',
    label: 'critRate',
    desc: 'critRate',
    colorFrom: '#c779ff',
    colorTo: '#7d2cd1',
    shadowColor: '#3a0d63',
    perLevelPct: 0.05,
    unit: '%',
    base: 0
  },
  critDamage: {
    id: 'critDamage',
    label: 'critDamage',
    desc: 'critDamage',
    colorFrom: '#ff5fa3',
    colorTo: '#c1006b',
    shadowColor: '#5a002e',
    perLevelPct: 0.25,
    unit: '%',
    base: 0
  },
  maxHp: {
    id: 'maxHp',
    label: 'maxHp',
    desc: 'maxHp',
    colorFrom: '#7cd957',
    colorTo: '#3d6f00',
    shadowColor: '#1a3300',
    perLevelFlat: 8,
    unit: 'HP',
    base: 0
  },
  // ── Temp-only upgrades (level-up modal pool only) ──────────────────
  // Defense — flat damage reduction. Capped at 75% so a stack of defense
  // can't make the player invincible in late-game stages.
  defense: {
    id: 'defense',
    label: 'defense',
    desc: 'defense',
    colorFrom: '#4ea7ff',
    colorTo: '#15467a',
    shadowColor: '#062a52',
    perLevelPct: 0.08,
    unit: '%',
    base: 0,
    pctCap: 0.75,
    tempOnly: true
  },
  // Auto-regen — passive HP/s. Slow enough that it doesn't replace HP
  // upgrades, fast enough to feel like a real reward over a stage.
  autoRegen: {
    id: 'autoRegen',
    label: 'autoRegen',
    desc: 'autoRegen',
    colorFrom: '#5cd6a0',
    colorTo: '#1e8a5c',
    shadowColor: '#094030',
    perLevelFlat: 1.5,
    unit: 'HP/s',
    base: 0,
    tempOnly: true
  },
  // Move speed — multiplicative scaler on the player's chase velocity.
  // Stacks well with evade for a "kite the swarm" build.
  moveSpeed: {
    id: 'moveSpeed',
    label: 'moveSpeed',
    desc: 'moveSpeed',
    colorFrom: '#6be0ff',
    colorTo: '#228eb8',
    shadowColor: '#074a66',
    perLevelPct: 0.12,
    unit: '%',
    base: 0,
    tempOnly: true
  },
  // Evade — chance to ignore a hit entirely. Capped at 60% so a max-evade
  // build still has to dodge eventually. Applied to every player damage
  // source: contact, hostile projectile, boss lightning, artillery.
  evade: {
    id: 'evade',
    label: 'evade',
    desc: 'evade',
    colorFrom: '#ffb938',
    colorTo: '#c47700',
    shadowColor: '#5c3700',
    perLevelPct: 0.05,
    unit: '%',
    base: 0,
    pctCap: 0.6,
    tempOnly: true
  },
  // Splash — bullets do an AoE in a forward cone on impact. The cone
  // is centered on the bullet's velocity direction (90° total angle,
  // 60 px range). Splash damage scales as a fraction of the bullet's
  // primary damage and stacks across crit + base damage rolls.
  splash: {
    id: 'splash',
    label: 'splash',
    desc: 'splash',
    colorFrom: '#ff7a3a',
    colorTo: '#a13000',
    shadowColor: '#481000',
    perLevelPct: 0.25,
    unit: '%',
    base: 0,
    maxLevel: 3,
    tempOnly: true
  },
  // Disease/fire DoT — applies a burn that ticks down over 3 seconds
  // and spreads to nearby enemies. Capped at level 2: level 1 = 15% of
  // bullet damage total, level 2 = 30% total. Spread to neighbors uses
  // 80% of the source's total damage so the cascade self-attenuates.
  fireDot: {
    id: 'fireDot',
    label: 'fireDot',
    desc: 'fireDot',
    colorFrom: '#ff5050',
    colorTo: '#7a1010',
    shadowColor: '#3a0000',
    perLevelPct: 0.15,
    unit: '%',
    base: 0,
    maxLevel: 2,
    tempOnly: true
  }
}

export const UPGRADE_IDS = Object.keys(UPGRADE_DEFS) as SlimeUpgradeId[]

const LEVELS_KEY = 'slime_upgrade_levels'
const COLLECT_RADIUS_KEY = 'slime_collect_radius_level'

const loadLevels = (): Record<SlimeUpgradeId, number> => {
  try {
    const raw = localStorage.getItem(LEVELS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, number>
      const out = {} as Record<SlimeUpgradeId, number>
      for (const id of UPGRADE_IDS) out[id] = Math.max(0, parsed[id] ?? 0)
      return out
    }
  } catch {
    /* fall through */
  }
  const def = {} as Record<SlimeUpgradeId, number>
  for (const id of UPGRADE_IDS) def[id] = 0
  return def
}

const loadCollectLevel = (): number => {
  try {
    const raw = localStorage.getItem(COLLECT_RADIUS_KEY)
    if (raw) return Math.max(0, parseInt(raw, 10) || 0)
  } catch {
    /* fall through */
  }
  return 0
}

const upgradeLevels: Ref<Record<SlimeUpgradeId, number>> = ref(loadLevels())
const collectRadiusLevel: Ref<number> = ref(loadCollectLevel())

watch(saveDataVersion, () => {
  upgradeLevels.value = loadLevels()
  collectRadiusLevel.value = loadCollectLevel()
})

const persistLevels = () => {
  localStorage.setItem(LEVELS_KEY, JSON.stringify(upgradeLevels.value))
}
const persistCollect = () => {
  localStorage.setItem(COLLECT_RADIUS_KEY, String(collectRadiusLevel.value))
}

export const upgradeCost = (level: number): number => {
  // Rookie tier (levels 0..4) is intentionally cheap so the first
  // session gives the player ~5 upgrades for free-ish. After that the
  // cost ramps quadratically and then linearly so endgame stays
  // affordable but feels meaningful.
  if (level < 5) return 25 + level * 25 // 25, 50, 75, 100, 125
  return Math.round(150 + Math.pow(level - 4, 1.65) * 60)
}

export const collectRadiusCost = (level: number): number => {
  if (level < 3) return 75 + level * 75
  return Math.round(300 + Math.pow(level - 2, 1.5) * 120)
}

export const useSlimeUpgrades = () => {
  const reset = () => {
    for (const id of UPGRADE_IDS) upgradeLevels.value[id] = 0
    collectRadiusLevel.value = 0
    persistLevels()
    persistCollect()
  }

  const levelOf = (id: SlimeUpgradeId): number => upgradeLevels.value[id] ?? 0

  const incrementLevel = (id: SlimeUpgradeId, amount = 1): number => {
    upgradeLevels.value[id] = (upgradeLevels.value[id] ?? 0) + amount
    persistLevels()
    return upgradeLevels.value[id]!
  }

  const incrementCollectLevel = (): number => {
    collectRadiusLevel.value++
    persistCollect()
    return collectRadiusLevel.value
  }

  /** Computed multipliers that the gameplay layer reads each tick. */
  const damageMul = computed(() => 1 + UPGRADE_DEFS.damage.perLevelPct! * levelOf('damage'))
  const fireRateMul = computed(() => 1 + UPGRADE_DEFS.fireRate.perLevelPct! * levelOf('fireRate'))
  const critRate = computed(() => Math.min(0.95, UPGRADE_DEFS.critRate.perLevelPct! * levelOf('critRate')))
  const critDmgMul = computed(() => 1.5 + UPGRADE_DEFS.critDamage.perLevelPct! * levelOf('critDamage'))
  const maxHp = computed(() => 30 + UPGRADE_DEFS.maxHp.perLevelFlat! * levelOf('maxHp'))
  const collectRadius = computed(() => 70 + collectRadiusLevel.value * 18)

  return {
    upgradeLevels,
    collectRadiusLevel,
    levelOf,
    incrementLevel,
    incrementCollectLevel,
    reset,
    damageMul,
    fireRateMul,
    critRate,
    critDmgMul,
    maxHp,
    collectRadius
  }
}

export default useSlimeUpgrades
