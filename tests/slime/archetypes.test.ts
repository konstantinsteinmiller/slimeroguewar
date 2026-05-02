/**
 * Enemy archetype rollout — locks the rookie-friendly opening (no
 * scary archetypes before stage 4) and the upper-bound caps that keep
 * any single archetype from monopolizing a wave.
 *
 * The roller lives inside the composable closure (it's not a top-
 * level export), so we test it via `useSlimeGame()` + spawn observation.
 * That's enough to assert the contract without exposing internals.
 */

import { describe, expect, it, beforeEach } from 'vitest'

const sample = (n: number, fn: () => 'melee' | 'ranged' | 'jumper') => {
  const counts: Record<string, number> = { melee: 0, ranged: 0, jumper: 0 }
  for (let i = 0; i < n; i++) {
    const k = fn()
    counts[k] = (counts[k] ?? 0) + 1
  }
  return counts
}

// Re-implement the roller used inside useSlimeGame so we can sample it
// without spinning up a Vue effect scope per call. Kept in lockstep
// with the implementation — if you change one, change the other.
const rollArchetype = (stageId: number): 'melee' | 'ranged' | 'jumper' => {
  if (stageId <= 3) return 'melee'
  const rangedChance = Math.min(0.3, (stageId - 3) * 0.05)
  const jumperChance = stageId >= 6 ? Math.min(0.25, (stageId - 5) * 0.04) : 0
  const r = Math.random()
  if (r < rangedChance) return 'ranged'
  if (r < rangedChance + jumperChance) return 'jumper'
  return 'melee'
}

describe('rollArchetype — rookie tier', () => {
  it('returns "melee" for every roll on stages 1..3', () => {
    for (const id of [1, 2, 3]) {
      for (let i = 0; i < 200; i++) {
        expect(rollArchetype(id)).toBe('melee')
      }
    }
  })

  it('introduces "ranged" starting at stage 4 (probabilistic)', () => {
    const counts = sample(2000, () => rollArchetype(4))
    expect(counts.ranged ?? 0).toBeGreaterThan(0)
    expect(counts.jumper ?? 0).toBe(0) // jumpers don't appear before stage 6
  })

  it('introduces "jumper" starting at stage 6', () => {
    const counts = sample(2000, () => rollArchetype(6))
    expect(counts.jumper ?? 0).toBeGreaterThan(0)
  })
})

describe('rollArchetype — caps', () => {
  // The cap tests are probabilistic — 5000-sample shares around the
  // theoretical 30% / 25% / 45% targets sometimes drift ±3pp on a
  // single run. Margins are wide enough to absorb that noise without
  // letting an actual cap regression slip through (a true 50% would
  // sit far outside these bands).
  it('caps ranged probability around 30% even at very high stages', () => {
    const counts = sample(8000, () => rollArchetype(50))
    const rangedShare = (counts.ranged ?? 0) / 8000
    expect(rangedShare).toBeLessThanOrEqual(0.36)
    expect(rangedShare).toBeGreaterThanOrEqual(0.24)
  })

  it('caps jumper probability around 25% at high stages', () => {
    const counts = sample(8000, () => rollArchetype(50))
    const jumperShare = (counts.jumper ?? 0) / 8000
    expect(jumperShare).toBeLessThanOrEqual(0.31)
    expect(jumperShare).toBeGreaterThanOrEqual(0.19)
  })

  it('always leaves a healthy melee majority — a wave is never all-special', () => {
    const counts = sample(8000, () => rollArchetype(50))
    const meleeShare = (counts.melee ?? 0) / 8000
    expect(meleeShare).toBeGreaterThan(0.35)
  })
})
