import type { I18n } from 'vue-i18n'
import { LANGUAGES } from '@/utils/enums'

/**
 * Locale loader — lazy, code-split, cache-safe.
 *
 * Every file under `./locales/*.ts` is registered with Vite as a
 * dynamic import, which makes each locale its own chunk. The selected
 * locale is fetched on demand; the rest stay out of the critical path.
 *
 * The `{ import: 'default' }` option tells Vite to unwrap the module's
 * default export automatically so callers get the raw messages object.
 */
const localeLoaders = import.meta.glob<Record<string, unknown>>(
  './locales/*.ts',
  { import: 'default' }
)

/** In-memory cache so repeat `loadLocale` calls don't re-import. */
const localeCache = new Map<string, Record<string, unknown>>()
/** Shared in-flight promises so concurrent calls coalesce. */
const localeInFlight = new Map<string, Promise<Record<string, unknown>>>()

const pathFor = (code: string) => `./locales/${code}.ts`

export const isSupportedLocale = (code: string | null | undefined): code is string =>
  !!code && LANGUAGES.includes(code)

/**
 * Dynamically load a single locale's message bundle. Safe to call for
 * already-loaded locales (returns the cached object immediately).
 * Throws if the locale file is missing so callers can fall back to `en`.
 */
export const loadLocaleMessages = async (
  code: string
): Promise<Record<string, unknown>> => {
  const cached = localeCache.get(code)
  if (cached) return cached

  const inflight = localeInFlight.get(code)
  if (inflight) return inflight

  const loader = localeLoaders[pathFor(code)]
  if (!loader) throw new Error(`[i18n] no locale file for "${code}"`)

  const promise = loader().then((msgs) => {
    const resolved = (msgs ?? {}) as Record<string, unknown>
    localeCache.set(code, resolved)
    localeInFlight.delete(code)
    return resolved
  })
  localeInFlight.set(code, promise)
  return promise
}

/**
 * Ensure a locale is registered with the given i18n instance and switch to
 * it. Designed to be called from UI code (OptionsModal language dropdown,
 * CrazyGames locale sync, etc.) — it will no-op if the locale is already
 * the active one and messages are already present.
 *
 * On load failure, the promise resolves *without* switching so the UI
 * keeps rendering the previously active locale.
 */
export const setI18nLocale = async (
  i18n: I18n<any, any, any, string, false>,
  code: string
): Promise<void> => {
  const target = isSupportedLocale(code) ? code : 'en'
  const g: any = i18n.global
  // Already-loaded locales can switch synchronously.
  if (g.availableLocales.includes(target)) {
    g.locale.value = target
    return
  }
  try {
    const msgs = await loadLocaleMessages(target)
    g.setLocaleMessage(target, msgs)
    g.locale.value = target
  } catch (e) {
    console.error(`[i18n] failed to load locale "${target}"`, e)
  }
}

/**
 * Resolve the locale we should boot with, synchronously, before creating
 * the i18n instance so the first dynamic import targets only the right
 * locale file. Resolution order:
 *
 *   1. sessionStorage hint — written by main.ts when the CrazyGames SDK
 *      reports a supported locale, AND re-written by useUser on every
 *      language change (see `setSettingValue('language', ...)`). This is
 *      the hot path on repeat loads in the same tab.
 *   2. navigator.language short code — best guess for first-ever load
 *      before any user interaction.
 *   3. 'en' fallback.
 *
 * The IndexedDB-persisted preference (from useUser / OptionsModal) can't
 * be read synchronously. main.ts watches `isDbInitialized` and calls
 * `setI18nLocale` again once hydration completes, which swaps the locale
 * on-the-fly without blocking first paint.
 */
export const resolveInitialLocale = (sessionHintKey: string): string => {
  try {
    const sess = sessionStorage.getItem(sessionHintKey)
    if (isSupportedLocale(sess)) return sess
  } catch { /* ignore */
  }
  const nav = typeof navigator !== 'undefined'
    ? navigator.language?.split('-')[0]
    : undefined
  if (isSupportedLocale(nav)) return nav
  return 'en'
}
