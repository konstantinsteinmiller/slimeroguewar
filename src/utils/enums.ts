import type { ENUM } from '@/types'

export const DIFFICULTY = {
  EASY: 'easy',
  MEDIUM: 'medium',
  HARD: 'hard'
} as const

export type Difficulties = (typeof DIFFICULTY)[keyof typeof DIFFICULTY]

export const ELEMENTS = {
  NATURE: 'nature',
  AIR: 'air',
  WATER: 'water',
  LIGHT: 'light',
  ENERGY: 'energy',
  PSI: 'psi',
  EARTH: 'earth',
  ICE: 'ice',
  FIRE: 'fire',
  DARK: 'dark',
  METAL: 'metal',
  NEUTRAL: 'neutral'
} as const

export type Element = (typeof ELEMENTS)[keyof typeof ELEMENTS]

export const LANGUAGES: Array<string> = [
  'en',
  'de',
  'es',
  'fr',
  'jp',
  'kr',
  'ru',
  'zh'
]