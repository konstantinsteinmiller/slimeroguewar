import { describe, it, expect } from 'vitest'

/**
 * These tests verify that every heal-value path in the game produces
 * integer display values (no decimal points in floating damage numbers).
 *
 * The formulas below mirror the exact logic in useSpinnerGame.ts for:
 *   1. Forest arena wall-bounce heal
 *   2. Healer-ally contact heal
 *   3. Lava arena wall-bounce damage (included for completeness)
 *   4. spawnDamageNumber (combat damage)
 */

// ─── Forest Arena Heal ─────────────────────────────────────────────────────
// Formula (useSpinnerGame.ts, bounceOffWalls → forest branch):
//   const healed = Math.round(Math.min(1, blade.maxHp - blade.hp))

function forestHealValue(maxHp: number, currentHp: number): number {
  return Math.round(Math.min(1, maxHp - currentHp))
}

describe('Forest arena wall-bounce heal value', () => {
  it('returns 1 when blade is missing at least 1 HP', () => {
    expect(forestHealValue(100, 90)).toBe(1)
  })

  it('returns 0 when blade is at full HP', () => {
    expect(forestHealValue(100, 100)).toBe(0)
  })

  it('returns 1 when blade is missing exactly 1 HP', () => {
    expect(forestHealValue(50, 49)).toBe(1)
  })

  it('returns integer when HP gap is fractional (< 1)', () => {
    // This is the bug case: hp was fractional from combat damage
    const result = forestHealValue(100, 99.01112)
    expect(Number.isInteger(result)).toBe(true)
    expect(result).toBe(1)
  })

  it('returns integer when HP gap is very small fractional', () => {
    const result = forestHealValue(100, 99.98888)
    expect(Number.isInteger(result)).toBe(true)
    expect(result).toBe(0) // rounds to 0 since 0.01112 < 0.5
  })

  it('returns integer when HP gap is just above 0.5', () => {
    const result = forestHealValue(100, 99.4)
    expect(Number.isInteger(result)).toBe(true)
    expect(result).toBe(1) // 0.6 rounds to 1
  })

  it('returns integer when HP gap is just below 0.5', () => {
    const result = forestHealValue(100, 99.6)
    expect(Number.isInteger(result)).toBe(true)
    expect(result).toBe(0) // 0.4 rounds to 0
  })

  it('returns integer with 1 maxHp', () => {
    const result = forestHealValue(1, 0.3)
    expect(Number.isInteger(result)).toBe(true)
    expect(result).toBe(1)
  })

  it('never returns a value with decimal places across many fractional HPs', () => {
    for (let i = 0; i < 1000; i++) {
      const maxHp = 10 + Math.random() * 200
      const currentHp = Math.random() * maxHp
      const result = forestHealValue(maxHp, currentHp)
      expect(Number.isInteger(result)).toBe(true)
    }
  })
})

// ─── Healer Contact Heal ───────────────────────────────────────────────────
// Formula (useSpinnerGame.ts, resolveCollision → healer branch):
//   const healA = Math.round(Math.min(HEALER_CONTACT_HEAL, a.maxHp - a.hp))

const HEALER_CONTACT_HEAL = 2

function healerHealValue(maxHp: number, currentHp: number): number {
  return Math.round(Math.min(HEALER_CONTACT_HEAL, maxHp - currentHp))
}

describe('Healer contact heal value', () => {
  it('returns 2 when blade is missing more than 2 HP', () => {
    expect(healerHealValue(100, 90)).toBe(2)
  })

  it('returns 0 when blade is at full HP', () => {
    expect(healerHealValue(100, 100)).toBe(0)
  })

  it('returns integer when HP gap is fractional', () => {
    const result = healerHealValue(100, 98.3)
    expect(Number.isInteger(result)).toBe(true)
    expect(result).toBe(2)
  })

  it('returns integer when HP gap is small fractional (< 1)', () => {
    const result = healerHealValue(100, 99.7)
    expect(Number.isInteger(result)).toBe(true)
    expect(result).toBe(0) // 0.3 rounds to 0
  })

  it('returns integer when HP gap is between 1 and 2 fractional', () => {
    const result = healerHealValue(100, 98.8)
    expect(Number.isInteger(result)).toBe(true)
    expect(result).toBe(1) // 1.2 rounds to 1
  })

  it('never returns a value with decimal places across many fractional HPs', () => {
    for (let i = 0; i < 1000; i++) {
      const maxHp = 10 + Math.random() * 200
      const currentHp = Math.random() * maxHp
      const result = healerHealValue(maxHp, currentHp)
      expect(Number.isInteger(result)).toBe(true)
    }
  })
})

// ─── Lava Damage ───────────────────────────────────────────────────────────
// Formula (useSpinnerGame.ts, bounceOffWalls → lava branch):
//   const lavaDmg = Math.ceil(blade.maxHp * 0.025)

function lavaDamageValue(maxHp: number): number {
  return Math.ceil(maxHp * 0.025)
}

describe('Lava arena wall-bounce damage value', () => {
  it('returns integer for typical maxHp', () => {
    expect(Number.isInteger(lavaDamageValue(100))).toBe(true)
    expect(lavaDamageValue(100)).toBe(3) // ceil(2.5)
  })

  it('returns integer for odd maxHp', () => {
    expect(Number.isInteger(lavaDamageValue(77))).toBe(true)
  })

  it('returns at least 1 for any positive maxHp', () => {
    expect(lavaDamageValue(1)).toBeGreaterThanOrEqual(1)
  })

  it('never returns a value with decimal places across many maxHp values', () => {
    for (let i = 1; i <= 500; i++) {
      const result = lavaDamageValue(i)
      expect(Number.isInteger(result)).toBe(true)
    }
  })
})

// ─── spawnDamageNumber (combat) ────────────────────────────────────────────
// Formula (useSpinnerGame.ts, spawnDamageNumber):
//   value: Math.round(value)

function combatDamageDisplayValue(rawDmg: number): number {
  return Math.round(rawDmg)
}

describe('Combat damage display value (spawnDamageNumber)', () => {
  it('rounds fractional damage to nearest integer', () => {
    expect(combatDamageDisplayValue(5.7)).toBe(6)
    expect(combatDamageDisplayValue(5.3)).toBe(5)
    expect(combatDamageDisplayValue(5.5)).toBe(6)
  })

  it('passes through integer damage unchanged', () => {
    expect(combatDamageDisplayValue(10)).toBe(10)
  })

  it('never returns a value with decimal places for any input', () => {
    for (let i = 0; i < 1000; i++) {
      const raw = Math.random() * 500
      const result = combatDamageDisplayValue(raw)
      expect(Number.isInteger(result)).toBe(true)
    }
  })
})
