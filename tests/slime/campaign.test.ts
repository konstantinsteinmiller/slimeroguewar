/**
 * Stage progression curve.
 *
 * Locks in the rookie-friendly opening (stages 1..4 short and slow) and
 * the boss cadence (every 5 stages). Surface-level tests — they don't
 * try to assert balance numbers exactly, only the directional invariants
 * a designer would want to keep stable.
 */

import { describe, expect, it } from 'vitest'
import { buildStageConfig } from '@/use/useSlimeCampaign'

describe('buildStageConfig — rookie tier (stages 1..4)', () => {
  it('stage 1 wave length is in the rookie band (24..32 enemies)', () => {
    // Curve was doubled from chaos-arena's seed so mid-fight upgrade
    // picks have time to matter to the outcome — but stage 1 still
    // has to feel beatable to a first-timer. Window keeps the
    // designer honest if either bound moves.
    const s1 = buildStageConfig(1)
    expect(s1.enemyCount).toBeGreaterThanOrEqual(24)
    expect(s1.enemyCount).toBeLessThanOrEqual(32)
  })
  it('keeps enemy speed below 65 px/s in the rookie tier', () => {
    for (const id of [1, 2, 3, 4]) {
      expect(buildStageConfig(id).enemySpeed).toBeLessThanOrEqual(65)
    }
  })
  it('flags none of stages 1..4 as a boss stage', () => {
    for (const id of [1, 2, 3, 4]) {
      expect(buildStageConfig(id).isBoss).toBe(false)
    }
  })
})

describe('buildStageConfig — bosses', () => {
  it('flags every fifth stage as a boss', () => {
    for (const id of [5, 10, 15, 20, 25, 50, 100]) {
      expect(buildStageConfig(id).isBoss).toBe(true)
    }
  })
  it('flags non-fifth stages as non-boss', () => {
    for (const id of [1, 2, 3, 4, 6, 7, 9, 11, 99]) {
      expect(buildStageConfig(id).isBoss).toBe(false)
    }
  })
  it('boss stages have far more HP than the surrounding mob stages', () => {
    const before = buildStageConfig(9)
    const boss = buildStageConfig(10)
    expect(boss.enemyHp).toBeGreaterThan(before.enemyHp * 4)
  })
  it('boss stages award meaningfully more drops on kill', () => {
    const boss = buildStageConfig(15)
    const mob = buildStageConfig(14)
    expect(boss.dropsPerKill).toBeGreaterThan(mob.dropsPerKill * 4)
  })
  it('cycles through five distinct boss kinds', () => {
    const kinds = new Set<string>()
    for (const id of [5, 10, 15, 20, 25]) {
      const c = buildStageConfig(id)
      if (c.bossKind) kinds.add(c.bossKind)
    }
    expect(kinds.size).toBe(5)
  })
})

describe('buildStageConfig — long-term curve', () => {
  it('enemy count grows roughly monotonically across non-boss stages', () => {
    const stages = [1, 6, 11, 16, 21, 31].map(id => buildStageConfig(id).enemyCount)
    for (let i = 0; i < stages.length - 1; i++) {
      expect(stages[i + 1]!).toBeGreaterThan(stages[i]!)
    }
  })
  it('enemy HP grows monotonically across non-boss stages', () => {
    const stages = [1, 6, 11, 21, 41, 61].map(id => buildStageConfig(id).enemyHp)
    for (let i = 0; i < stages.length - 1; i++) {
      expect(stages[i + 1]!).toBeGreaterThan(stages[i]!)
    }
  })
  it('spawn interval shortens as stages progress', () => {
    expect(buildStageConfig(1).spawnInterval)
      .toBeGreaterThan(buildStageConfig(20).spawnInterval)
  })
  it('biome cycles through 5 archetypes on a 5-stage cadence', () => {
    expect(buildStageConfig(1).biome).toBe('meadow')
    expect(buildStageConfig(6).biome).toBe('cave')
    expect(buildStageConfig(11).biome).toBe('tundra')
    expect(buildStageConfig(16).biome).toBe('swamp')
    expect(buildStageConfig(21).biome).toBe('volcano')
    expect(buildStageConfig(26).biome).toBe('meadow')
  })
})
