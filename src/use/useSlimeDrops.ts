import { ref, watch } from 'vue'
import type { Ref } from 'vue'
import { COINS_KEY } from '@/keys'
import { saveDataVersion } from '@/use/useSaveStatus'
import { onLegacyDropChange } from '@/use/slimeDropsBridge'

// ─── Slime Drops currency ──────────────────────────────────────────────────
//
// Single source of truth for the player's drop balance. The localStorage
// key (`spinner_coins`) is reused intentionally — it's already wired
// through the SaveManager + SaveMergePolicy code paths. Keeping the key
// preserves players' balances if they had ever played the previous
// chaos-arena build and avoids us re-implementing the bonus-coin
// merge logic for a freshly named currency.
//
// All HUD components that previously read `useSpinnerConfig().coins`
// should switch to `useSlimeDrops().drops`. Backward-compat shims are
// not added here on purpose: the slime build replaces the spinner
// build, no co-existence.

const loadStoredDrops = (): number => {
  try {
    const raw = localStorage.getItem(COINS_KEY)
    if (raw) return parseInt(raw, 10) || 0
  } catch {
    /* fall through */
  }
  return 0
}

const drops: Ref<number> = ref(loadStoredDrops())

// Re-read when the cloud strategy bumps the hydrate generation. Same
// pattern used by useUser, useSpinnerConfig, useSpinnerCampaign — the
// blob may finish hydrating after this module evaluates.
watch(saveDataVersion, () => {
  drops.value = loadStoredDrops()
})

// Mirror legacy `useSpinnerConfig.addCoins` writes (BattlePass,
// TreasureChest, AdRewardButton, DailyRewards). The bridge passes the
// delta; we read the persisted value back so we stay strictly in sync
// even if the legacy path mutated localStorage non-reactively.
onLegacyDropChange(() => {
  drops.value = loadStoredDrops()
})

const addDrops = (amount: number): number => {
  if (amount <= 0) return drops.value
  drops.value += amount
  localStorage.setItem(COINS_KEY, drops.value.toString())
  return drops.value
}

const spendDrops = (amount: number): boolean => {
  if (amount <= 0) return true
  if (drops.value < amount) return false
  drops.value -= amount
  localStorage.setItem(COINS_KEY, drops.value.toString())
  return true
}

const useSlimeDrops = () => ({
  drops,
  addDrops,
  spendDrops
})

export default useSlimeDrops
