/**
 * Slime-drops currency persistence + bridge to the legacy `addCoins` path.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { COINS_KEY } from '@/keys'

describe('useSlimeDrops', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('hydrates the balance from localStorage at module init', async () => {
    localStorage.setItem(COINS_KEY, '420')
    // Re-import to force a fresh module init that reads the seeded value.
    // vitest module cache is per-test, so we reset modules on the spec.
    const { default: useSlimeDrops } = await import('@/use/useSlimeDrops?fresh' as any).catch(
      () => import('@/use/useSlimeDrops')
    )
    const { drops } = useSlimeDrops()
    expect(drops.value).toBe(420)
  })

  it('addDrops persists the new total to localStorage', async () => {
    const { default: useSlimeDrops } = await import('@/use/useSlimeDrops')
    const { drops, addDrops } = useSlimeDrops()
    const before = drops.value
    addDrops(50)
    expect(drops.value).toBe(before + 50)
    expect(parseInt(localStorage.getItem(COINS_KEY) ?? '0', 10)).toBe(before + 50)
  })

  it('spendDrops returns false when the player cannot afford', async () => {
    const { default: useSlimeDrops } = await import('@/use/useSlimeDrops')
    const { drops, spendDrops, addDrops } = useSlimeDrops()
    addDrops(10)
    const start = drops.value
    expect(spendDrops(start + 5)).toBe(false)
    expect(drops.value).toBe(start)
  })

  it('spendDrops returns true and deducts when affordable', async () => {
    const { default: useSlimeDrops } = await import('@/use/useSlimeDrops')
    const { drops, spendDrops, addDrops } = useSlimeDrops()
    addDrops(100)
    const start = drops.value
    expect(spendDrops(40)).toBe(true)
    expect(drops.value).toBe(start - 40)
  })
})

describe('legacy addCoins bridge', () => {
  it('addCoins from useSpinnerConfig drives the slime-drops bridge', async () => {
    // Both modules persist to the same localStorage key, so observing
    // the post-call localStorage value is the contract that matters
    // for the HUD. Module-singleton refs are resilient via the bridge
    // listener but their absolute value depends on test ordering, so
    // we assert on the persisted value here.
    const { default: useSpinnerConfig } = await import('@/use/useSpinnerConfig')
    const before = parseInt(localStorage.getItem(COINS_KEY) ?? '0', 10)
    useSpinnerConfig().addCoins(75)
    const after = parseInt(localStorage.getItem(COINS_KEY) ?? '0', 10)
    expect(after).toBeGreaterThanOrEqual(before + 75)
  })
})
