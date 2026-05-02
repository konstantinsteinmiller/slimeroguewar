/**
 * Slime upgrade economy.
 *
 * The values below ARE the rookie-tier feel. If a refactor changes them
 * the test fails so the change is intentional and visible in review.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  collectRadiusCost,
  upgradeCost,
  UPGRADE_DEFS,
  UPGRADE_IDS
} from '@/use/useSlimeUpgrades'

describe('upgradeCost — rookie tier (levels 0..4)', () => {
  it('starts at 25 drops for the very first upgrade', () => {
    expect(upgradeCost(0)).toBe(25)
  })
  it('grows by exactly 25 drops per level for the rookie tier', () => {
    expect(upgradeCost(1)).toBe(50)
    expect(upgradeCost(2)).toBe(75)
    expect(upgradeCost(3)).toBe(100)
    expect(upgradeCost(4)).toBe(125)
  })
  it('is monotonically increasing in the rookie tier', () => {
    for (let lvl = 0; lvl < 4; lvl++) {
      expect(upgradeCost(lvl)).toBeLessThan(upgradeCost(lvl + 1))
    }
  })
  it('total cost to reach level 5 is exactly 375 drops', () => {
    let total = 0
    for (let lvl = 0; lvl < 5; lvl++) total += upgradeCost(lvl)
    expect(total).toBe(375)
  })
})

describe('upgradeCost — endgame curve (level 5+)', () => {
  it('jumps to ≥150 at level 5 (the post-rookie cliff)', () => {
    expect(upgradeCost(5)).toBeGreaterThanOrEqual(150)
  })
  it('is still monotonically increasing past level 5', () => {
    for (let lvl = 5; lvl < 30; lvl++) {
      expect(upgradeCost(lvl)).toBeLessThan(upgradeCost(lvl + 1))
    }
  })
  it('is a finite, sensible number even at level 100', () => {
    const c = upgradeCost(100)
    expect(Number.isFinite(c)).toBe(true)
    // Lock the absolute ceiling at 200k drops — reachable in a long
    // session but never an exponential blow-up.
    expect(c).toBeLessThan(200_000)
  })
})

describe('collectRadiusCost', () => {
  it('starts at 75 drops for level-0 → level-1', () => {
    expect(collectRadiusCost(0)).toBe(75)
  })
  it('is monotonically increasing', () => {
    for (let lvl = 0; lvl < 20; lvl++) {
      expect(collectRadiusCost(lvl)).toBeLessThan(collectRadiusCost(lvl + 1))
    }
  })
})

describe('UPGRADE_DEFS — schema', () => {
  it('contains the five permanent stats from the original spec', () => {
    const PERM = new Set(['damage', 'fireRate', 'critRate', 'critDamage', 'maxHp'])
    for (const id of PERM) expect(UPGRADE_IDS).toContain(id)
  })

  it('contains the temp-only level-up upgrades introduced post-launch', () => {
    const TEMP = new Set(['defense', 'autoRegen', 'moveSpeed', 'evade', 'splash', 'fireDot'])
    for (const id of TEMP) expect(UPGRADE_IDS).toContain(id)
  })

  it('marks every temp-only upgrade with `tempOnly: true`', () => {
    const TEMP = ['defense', 'autoRegen', 'moveSpeed', 'evade', 'splash', 'fireDot'] as const
    for (const id of TEMP) {
      expect(UPGRADE_DEFS[id].tempOnly).toBe(true)
    }
  })

  it('caps fire DoT at level 2 per the spec', () => {
    expect(UPGRADE_DEFS.fireDot.maxLevel).toBe(2)
  })
  it('every percentage upgrade has perLevelPct, every flat upgrade has perLevelFlat', () => {
    for (const id of UPGRADE_IDS) {
      const def = UPGRADE_DEFS[id]
      if (def.unit === '%') expect(def.perLevelPct).toBeGreaterThan(0)
      else expect(def.perLevelFlat).toBeGreaterThan(0)
    }
  })
  it('every upgrade has a non-empty color theme so cards never render blank', () => {
    for (const id of UPGRADE_IDS) {
      const def = UPGRADE_DEFS[id]
      expect(def.colorFrom).toMatch(/^#[0-9a-f]{6}$/i)
      expect(def.colorTo).toMatch(/^#[0-9a-f]{6}$/i)
      expect(def.shadowColor).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })
})
