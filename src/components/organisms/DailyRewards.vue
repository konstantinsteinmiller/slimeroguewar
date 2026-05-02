<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import FModal from '@/components/molecules/FModal.vue'
import FIconButton from '@/components/atoms/FIconButton.vue'
import IconSlimeDrop from '@/components/icons/IconSlimeDrop.vue'
import useSpinnerConfig from '@/use/useSpinnerConfig'
import useSounds from '@/use/useSound.ts'
import { stopGameplay } from '@/use/useCrazyGames'

const emit = defineEmits<{
  (e: 'coins-awarded', sourceEl: HTMLElement): void
}>()

const { addCoins } = useSpinnerConfig()
const { t } = useI18n()
const dailyBtnRef = ref<HTMLElement | null>(null)

// ─── Daily Rewards Config ────────────────────────────────────────────────────
//
// Slime build runs on slime drops only — no skins yet. Days that used
// to grant a skin in chaos-arena now grant a fat bonus drop pile
// instead, which keeps the 7-day curve climbing toward the day-7 prize
// without requiring a skin catalog.

const DAILY_REWARDS = [100, 200, 300, 400, 500, 750, 1000]
const BONUS_REWARD_DAYS = new Set<number>([2, 4, 6])
const BONUS_DROPS = 250
const STORAGE_KEY = 'spinner_daily_rewards'

const isBonusDay = (dayIndex: number) => BONUS_REWARD_DAYS.has(dayIndex)

interface DailyState {
  /** Index of the next reward to collect (0-6) */
  currentDay: number
  /** ISO date string of the last collection */
  lastCollected: string | null
}

const loadState = (): DailyState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (typeof parsed.currentDay === 'number') {
        return { currentDay: parsed.currentDay, lastCollected: parsed.lastCollected ?? null }
      }
    }
  } catch { /* fall through */
  }
  return { currentDay: 0, lastCollected: null }
}

const saveState = (state: DailyState) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

const todayStr = () => new Date().toISOString().slice(0, 10)

const yesterdayStr = () => {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

// ─── Reactive State ──────────────────────────────────────────────────────────

const state = ref<DailyState>(loadState())
const isModalOpen = ref(false)

// Explicit CrazyGames `gameplayStop` on every Daily Rewards open.
// Mirrors the arena's reactive watcher but makes the call-site visible
// per the CG QA request. `stopGameplay()` is idempotent (no-op when
// SDK inactive or already stopped).
watch(isModalOpen, (open) => {
  if (open) stopGameplay()
})

// Re-evaluate streak break whenever the modal opens
watch(isModalOpen, (open) => {
  if (!open) return
  const s = loadState()
  const today = todayStr()
  const yesterday = yesterdayStr()

  if (s.lastCollected && s.lastCollected !== today && s.lastCollected !== yesterday) {
    // Missed a day — reset streak.
    s.currentDay = 0
    s.lastCollected = null
    saveState(s)
  }
  state.value = s
})

const collectedToday = computed(() => state.value.lastCollected === todayStr())

/** Total drops awarded on a given day (base + bonus on bonus days). */
const totalRewardForDay = (dayIndex: number): number =>
  DAILY_REWARDS[dayIndex]! + (isBonusDay(dayIndex) ? BONUS_DROPS : 0)

const hasDailyRewardReady = computed(() => !collectedToday.value)

const collect = (dayIndex: number) => {
  if (dayIndex !== state.value.currentDay) return
  if (collectedToday.value) return

  addCoins(totalRewardForDay(dayIndex))
  if (dailyBtnRef.value) emit('coins-awarded', dailyBtnRef.value)

  const { playSound } = useSounds()
  playSound('happy')

  const nextDay = dayIndex + 1 >= DAILY_REWARDS.length ? 0 : dayIndex + 1
  state.value = {
    ...state.value,
    currentDay: nextDay,
    lastCollected: todayStr()
  }
  saveState(state.value)
}
</script>

<template lang="pug">
  //- Open-modal button (positioned by parent flex row in SpinnerArena)
  div.daily-rewards
    button.group.cursor-pointer.z-10.transition-transform(
      ref="dailyBtnRef"
      class="hover:scale-[103%] active:scale-90 scale-80 sm:scale-110"
      :class="{ 'hint-bounce': hasDailyRewardReady }"
      @click="isModalOpen = true"
    )
      div.relative
        div.absolute.inset-0.translate-y-1.rounded-lg(class="bg-[#1a2b4b]")
        div.relative.rounded-lg.border-2.text-white.font-bold.flex.flex-col.items-center.px-3.py-1(
          class="bg-gradient-to-b from-[#ffcd00] to-[#f7a000] border-[#0f1a30] pt-2 sm:pt-1"
        )
          span.font-black.game-text.leading-tight(class="text-[10px] sm:text-xs") +{{ totalRewardForDay(state.currentDay) }}
          IconSlimeDrop(class="w-5 h-5")

  //- Daily Rewards Modal
  FModal(
    v-model="isModalOpen"
    :is-closable="true"
    :title="t('dailyRewards')"
  )
    div(class="space-y-3 px-1 sm:px-3 py-2")
      div.grid.grid-cols-7.gap-1(class="sm:gap-2")
        div(
          v-for="(reward, i) in DAILY_REWARDS"
          :key="i"
          class="flex flex-col items-center rounded-xl p-1 sm:p-2 border-2 transition-all"
          :class="[\
            i < state.currentDay \
              ? 'bg-green-900/40 border-green-500/50' \
              : i === state.currentDay \
                ? (isBonusDay(i) ? 'bg-emerald-900/40 border-emerald-300' : 'bg-yellow-900/40 border-yellow-400') \
                : (isBonusDay(i) ? 'bg-emerald-900/20 border-emerald-700/60' : 'bg-slate-700/50 border-slate-600')\
          ]"
        )
          //- Day label
          div.text-gray-300.font-bold.uppercase(class="text-[8px] sm:text-[10px]") D{{ i + 1 }}

          //- Slime-drop icon for every day; bonus days just get a bigger pile.
          IconSlimeDrop(class="w-5 h-5 sm:w-6 sm:h-6 my-0.5")

          //- "BONUS!" tag for the larger-payout days
          div.font-black.game-text.text-emerald-300.uppercase.tracking-wider.leading-tight(
            v-if="isBonusDay(i)"
            class="text-[8px] sm:text-[10px]"
          ) Bonus

          //- Slime-drop reward amount
          div.text-yellow-400.font-black.game-text.leading-tight(class="text-[9px] sm:text-xs") +{{ totalRewardForDay(i) }}

          //- Status
          div(class="mt-0.5 text-[8px] sm:text-[10px] font-bold")
            span.text-green-400(v-if="i < state.currentDay") ✓
            template(v-else-if="i === state.currentDay")
              FIconButton(
                v-if="!collectedToday"
                type="primary"
                size="sm"
                icon="right"
                @click="collect(i)"
              )
              span.text-yellow-300(v-else) ✓
            span.text-slate-500(v-else) —

      //- Footer info
      div.text-center(class="text-[10px] sm:text-xs text-slate-400")
        template(v-if="collectedToday")
          | {{ t('comeBackTomorrow') }}
        template(v-else)
          | {{ t('collectTodaysReward') }}
</template>

<style scoped lang="sass">
// Soft whiteish halo that sits behind skin thumbnails so dark models
// (snake, scorpion, shell, etc.) stay readable on the dark modal background.
.skin-thumb-halo
  background: radial-gradient(circle at center, rgba(255, 255, 255, 0.55) 0%, rgba(255, 255, 255, 0.28) 35%, rgba(255, 255, 255, 0) 75%)
  filter: blur(4px)
  transform: scale(1.15)
</style>

<i18n>
en:
  dailyRewards: "Daily Rewards"
  comeBackTomorrow: "Come back tomorrow for your next reward!"
  collectTodaysReward: "Collect today's reward! Don't miss a day or progress resets."
de:
  dailyRewards: "Tägliche Belohnungen"
  comeBackTomorrow: "Komm morgen für deine nächste Belohnung wieder!"
  collectTodaysReward: "Hol dir deine heutige Belohnung! Verpasse keinen Tag, sonst beginnt der Fortschritt von vorn."
fr:
  dailyRewards: "Récompenses quotidiennes"
  comeBackTomorrow: "Reviens demain pour ta prochaine récompense !"
  collectTodaysReward: "Récupère ta récompense du jour ! Ne manque pas un jour ou la progression repart à zéro."
es:
  dailyRewards: "Recompensas diarias"
  comeBackTomorrow: "¡Vuelve mañana por tu próxima recompensa!"
  collectTodaysReward: "¡Reclama la recompensa de hoy! No te pierdas un día o el progreso se reinicia."
jp:
  dailyRewards: "デイリー報酬"
  comeBackTomorrow: "明日また来て次の報酬を受け取ろう！"
  collectTodaysReward: "今日の報酬を受け取ろう！1日でも逃すと進行がリセットされます。"
kr:
  dailyRewards: "일일 보상"
  comeBackTomorrow: "내일 다시 와서 다음 보상을 받으세요!"
  collectTodaysReward: "오늘의 보상을 받으세요! 하루라도 놓치면 진행이 초기화됩니다."
zh:
  dailyRewards: "每日奖励"
  comeBackTomorrow: "明天回来领取下一个奖励！"
  collectTodaysReward: "领取今日奖励！错过一天进度将重置。"
ru:
  dailyRewards: "Ежедневные награды"
  comeBackTomorrow: "Возвращайтесь завтра за следующей наградой!"
  collectTodaysReward: "Заберите сегодняшнюю награду! Пропустите день — прогресс сбросится."
</i18n>
