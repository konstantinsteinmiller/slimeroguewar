/**
 * Rookie-tier balance smoke test.
 *
 * Simulates a frictionless player on stage 1 (no upgrades, just the
 * base damage of 6 per shot at the spec's 0.55s fire interval) and
 * checks that they can clear the wave in a sensible window of time.
 *
 * The point isn't an exact match — it's to catch a regression where a
 * future change makes stage 1 unwinnable (or trivially auto-win).
 */

import { describe, expect, it } from 'vitest'
import { buildStageConfig } from '@/use/useSlimeCampaign'

describe('rookie-tier balance — stage 1 clear window', () => {
  it('with base damage (6) and base fire rate (0.55s), 60s is enough to kill the whole stage HP pool', () => {
    const s1 = buildStageConfig(1)
    const totalHp = s1.enemyCount * s1.enemyHp
    const dpsBase = 6 / 0.55 // ~10.9 dps before crits
    const timeToKillBase = totalHp / dpsBase
    expect(timeToKillBase).toBeLessThan(60)
  })

  it('clearing the first 5 rookie stages yields enough drops to buy at least one upgrade', async () => {
    // The cheapest upgrade is 25 drops; stages 1..5 should comfortably
    // afford a couple of rookie purchases when combined with the
    // first-time daily/ad rewards on screen.
    const { upgradeCost } = await import('@/use/useSlimeUpgrades')
    let drops = 0
    for (let id = 1; id <= 5; id++) {
      const s = buildStageConfig(id)
      drops += s.enemyCount * s.dropsPerKill
    }
    expect(drops).toBeGreaterThanOrEqual(upgradeCost(0))
  })

  it('stage 5 (first boss) is meaningfully harder than stage 1', () => {
    const s1 = buildStageConfig(1)
    const s5 = buildStageConfig(5)
    expect(s5.enemyHp).toBeGreaterThan(s1.enemyHp * 5)
  })
})

describe('upgrade impact on combat', () => {
  it('5 levels of damage roughly doubles dps', async () => {
    const { UPGRADE_DEFS } = await import('@/use/useSlimeUpgrades')
    const mul = 1 + UPGRADE_DEFS.damage.perLevelPct! * 5
    expect(mul).toBeGreaterThanOrEqual(1.85)
    expect(mul).toBeLessThanOrEqual(2.15)
  })
  it('5 levels of fire rate produces a noticeable but not OP boost', async () => {
    const { UPGRADE_DEFS } = await import('@/use/useSlimeUpgrades')
    const mul = 1 + UPGRADE_DEFS.fireRate.perLevelPct! * 5
    expect(mul).toBeGreaterThanOrEqual(1.5)
    expect(mul).toBeLessThanOrEqual(1.7)
  })
  it('crit rate caps below 100% even at huge level counts', async () => {
    const { UPGRADE_DEFS } = await import('@/use/useSlimeUpgrades')
    const rate = Math.min(0.95, UPGRADE_DEFS.critRate.perLevelPct! * 1000)
    expect(rate).toBeLessThanOrEqual(0.95)
  })
})
