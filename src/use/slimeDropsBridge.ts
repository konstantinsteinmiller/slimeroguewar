/**
 * One-way bridge from the legacy `useSpinnerConfig.addCoins` path to
 * the new `useSlimeDrops` reactive ref.
 *
 * Why this exists: chaos-arena's HUD components (TreasureChest,
 * AdRewardButton, DailyRewards, BattlePass) call `addCoins` to credit
 * the player. The slime-rogue-war HUD reads the balance via
 * `useSlimeDrops().drops`. Both composables persist to the same
 * localStorage key, but their in-memory Refs are independent — without
 * a bridge, `drops` wouldn't update until the next save-hydrate cycle.
 *
 * Putting the bridge in its own module dodges the import cycle between
 * `useSpinnerConfig` and `useSlimeDrops`. Both subscribe here at import
 * time; the only contract is "when one writes, the other catches up".
 */

type Listener = (amount: number) => void

const listeners: Listener[] = []

export const onLegacyDropChange = (listener: Listener): (() => void) => {
  listeners.push(listener)
  return () => {
    const i = listeners.indexOf(listener)
    if (i >= 0) listeners.splice(i, 1)
  }
}

export const notifyLegacyDropChange = (amount: number): void => {
  for (const fn of listeners) fn(amount)
}
