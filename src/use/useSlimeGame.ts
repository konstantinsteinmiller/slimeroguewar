import { computed, ref, shallowRef } from 'vue'
import type { Ref } from 'vue'
import { BULLET_IMG_PATH, drawSlime, drawSlimeDrop, type SlimeKind } from '@/use/useSlimeRenderer'
import { getCachedImage } from '@/use/useAssets'
import useSlimeUpgrades, { UPGRADE_DEFS, UPGRADE_IDS, type SlimeUpgradeId } from '@/use/useSlimeUpgrades'

// ─── Module-level: per-stage temporary upgrade levels ───────────────
//
// Hoisted out of the `useSlimeGame` closure so other components
// (UpgradeChoiceModal especially) can read the *effective* level
// (perm + temp) without prop-drilling. Module-scope means there's one
// shared instance for the whole app — slime-rogue-war runs a single
// arena at a time, so a singleton here matches the single-source-of
// -truth pattern useSlimeUpgrades already uses for permanent levels.
const _tempLevels: Ref<Record<SlimeUpgradeId, number>> = (() => {
  const out = {} as Record<SlimeUpgradeId, number>
  for (const id of UPGRADE_IDS) out[id] = 0
  return ref(out)
})()

/** Read-only accessor for outside callers (modals, tests). */
export const getTempLevel = (id: SlimeUpgradeId): number => _tempLevels.value[id] ?? 0
export const tempLevelsRef = _tempLevels
import useSlimeDrops from '@/use/useSlimeDrops'
import useSlimeCampaign, { type SlimeStageConfig } from '@/use/useSlimeCampaign'

/**
 * Slime Rogue War game-state composable.
 *
 * Drives a single canvas-rendered arena: meteor intro → spawn waves →
 * stage clear → reward. The state object lives outside Vue's reactive
 * tracker (the `world` shallowRef holds plain mutable arrays) because
 * the per-frame mutation rate is too high for fine-grained reactivity
 * to keep up — only the small handful of HUD signals (player HP, XP,
 * stage progress, level-up flag, game-over flag) are wrapped in `ref`.
 *
 * Phases:
 *   - 'intro'      — 3..2..1 + meteor shower; player visible but no spawns
 *   - 'battle'     — full gameplay
 *   - 'levelup'    — paused; UpgradeChoiceModal is showing
 *   - 'cleared'    — paused; StageClear/FReward is showing
 *   - 'gameover'   — paused; lost dialog is showing
 *   - 'idle'       — between stages, off-battle HUD visible
 */

export type SlimePhase = 'idle' | 'intro' | 'battle' | 'levelup' | 'cleared' | 'gameover'

export interface Vec2 { x: number; y: number }

/**
 * Three enemy AI archetypes:
 *   • melee   — default chase, contact damage. Existing chaos-arena
 *               behavior, no ability.
 *   • ranged  — kite at a preferred distance, fire slow projectiles
 *               at the player. -30% HP vs melee (tradeoff for the
 *               longer attack range).
 *   • jumper  — charge for 0.75s (telegraphed visually), then lunge
 *               toward the locked target at high speed for 0.4s,
 *               then recover for ~0.5s before the next charge.
 *
 * Bosses keep their own dedicated AI via `bossKind` and ignore this
 * field — the archetype dispatch in `stepEnemy` skips bosses.
 */
export type SlimeArchetype = 'melee' | 'ranged' | 'jumper'

/** Jumper ability state machine. */
export type JumperState = 'idle' | 'charging' | 'lunging' | 'recovery'

export interface SlimeEntity {
  id: number
  kind: SlimeKind
  pos: Vec2
  vel: Vec2
  radius: number
  hp: number
  maxHp: number
  damage: number
  speed: number
  hitFlash: number
  /** Tick of the last contact damage to the player, in ms. */
  lastHit: number
  /** Drops dropped on death (or 0 for player). */
  dropValue: number
  /** XP awarded toward player level on kill. */
  xpValue: number
  isBoss?: boolean
  /** Boss modifier flag; gameplay branches on this. */
  bossKind?: SlimeStageConfig['bossKind']
  /** Outstanding tasks the boss can perform (heal, summon, lightning). */
  cooldown: number
  /** Slimes spawned by a splitter inherit a smaller-spawn flag so they don't split again. */
  isSpawnedAdd?: boolean
  /** Enemy archetype — melee/ranged/jumper. Bosses set this to 'melee' but it's never read for them. */
  archetype: SlimeArchetype
  /** Ranged: cooldown until the next shot. Jumper: countdown for the
   *  current ability state's timer. Initialized to a small random
   *  delay so newly spawned enemies don't all fire on the same frame. */
  abilityCooldown: number
  /** Jumper's sub-state. Only meaningful when `archetype === 'jumper'`. */
  jumperState?: JumperState
  /** Boss artillery state: 'idle' | 'telegraph'. Independent from
   *  bossKind specials (heal/summon/lightning) — runs on its own
   *  cooldown so big bosses do *both* their unique trick AND lob a
   *  cluster volley at the player every few seconds. */
  artilleryState?: 'idle' | 'telegraph'
  /** Seconds until the boss starts its next artillery cast. */
  artilleryCooldown?: number
  /** Seconds remaining in the current state (telegraph countdown). */
  artilleryStateTimer?: number
  /** Disease/fire DoT applied by the player's `fireDot` upgrade. The
   *  HP-per-second tick is `totalDamage / totalDuration`; the spread
   *  cooldown gates how often a burning slime ignites neighbors. */
  burning?: {
    remaining: number
    totalDuration: number
    totalDamage: number
    spreadCd: number
  }
}

/**
 * Cluster-munition impact marker. Lives in the world array — once its
 * `ttl` hits zero we apply the AoE damage and switch to a brief
 * `explosionTtl` window for the impact VFX, then remove. Marker
 * positions are decided at cast-time (no homing) so the player can
 * read the danger zones and step out before the timer runs out.
 */
export interface ArtilleryMarker {
  id: number
  pos: Vec2
  /** Seconds until impact. While >0 the warning indicator is drawn. */
  ttl: number
  /** Original ttl, so the renderer can compute a blink-rate that
   *  accelerates as impact approaches. */
  maxTtl: number
  damage: number
  blastRadius: number
  /** Set true when the ttl-based impact has fired. The marker stays in
   *  the array for `explosionTtl` more seconds so the burst VFX renders. */
  exploded: boolean
  explosionTtl: number
}

export interface Projectile {
  id: number
  pos: Vec2
  vel: Vec2
  damage: number
  /** Crit flag — gives a slightly bigger projectile + brighter color. */
  isCrit: boolean
  /** Time-to-live in ms. */
  ttl: number
  /** True for player-fired bullets (collide with enemies); false for
   *  enemy-fired bullets (collide with the player). The collision
   *  loop dispatches on this flag instead of running two parallel
   *  arrays — keeps allocations and iteration order simple. */
  friendly: boolean
}

export interface DropPickup {
  id: number
  pos: Vec2
  /** Bobbing phase offset so adjacent drops aren't synchronized. */
  phase: number
  value: number
}

export interface Particle {
  id: number
  pos: Vec2
  vel: Vec2
  ttl: number
  maxTtl: number
  color: string
  size: number
  kind: 'spark' | 'meteor' | 'shockwave' | 'damage'
  text?: string
}

interface GameWorld {
  player: SlimeEntity
  enemies: SlimeEntity[]
  projectiles: Projectile[]
  drops: DropPickup[]
  particles: Particle[]
  /** Boss artillery markers — separate from particles because they
   *  carry damage payload + per-marker AoE state, not just visuals. */
  artilleryMarkers: ArtilleryMarker[]
  spawned: number
  killed: number
  width: number
  height: number
  fireCooldown: number
  spawnCooldown: number
  cameraShake: number
  joystick: Vec2
  joyActive: boolean
  /** Increasing id counter so every entity has a unique key. */
  nextId: number
  /** Accumulated time for breath/jiggle. */
  t: number
}

const DEFAULT_PROJECTILE_SPEED = 480
const PROJECTILE_TTL = 1.4
const PLAYER_HIT_INVULN_MS = 350

const makePlayer = (radius: number, maxHp: number): SlimeEntity => ({
  id: 0,
  kind: 'player',
  pos: { x: 0, y: 0 },
  vel: { x: 0, y: 0 },
  radius,
  hp: maxHp,
  maxHp,
  damage: 0,
  speed: 200,
  hitFlash: 0,
  lastHit: 0,
  dropValue: 0,
  xpValue: 0,
  cooldown: 0,
  // Player has no AI archetype but the field is non-optional on
  // SlimeEntity. Defaulting to 'melee' is a no-op — only enemies route
  // through `stepEnemy`'s archetype dispatch.
  archetype: 'melee',
  abilityCooldown: 0
})

export const useSlimeGame = () => {
  const upgrades = useSlimeUpgrades()
  const { addDrops } = useSlimeDrops()
  const { currentStage, advanceStage, stageId } = useSlimeCampaign()

  const phase: Ref<SlimePhase> = ref('idle')

  const playerHp: Ref<number> = ref(0)
  const playerMaxHp: Ref<number> = ref(0)
  const playerLevel: Ref<number> = ref(1)
  const playerXp: Ref<number> = ref(0)
  /** XP threshold for the next level (resets on level-up). */
  const playerXpNext: Ref<number> = ref(8)
  const dropsCollectedThisStage: Ref<number> = ref(0)

  /**
   * Per-stage temporary upgrade levels. Picked from the in-battle
   * level-up modal, applied for the rest of the current stage only.
   * The Item Shop owns permanent progression — temp upgrades reset on
   * every `resetForStage()` so they can't snowball across stages.
   * Combat reads `effectiveLevel(id) = perm + temp`.
   *
   * Module-scoped (`_tempLevels`) so the level-up modal can read it
   * without a prop chain. Reset by `resetForStage()`.
   */
  const tempLevels = _tempLevels
  const resetTempLevels = () => {
    for (const id of UPGRADE_IDS) tempLevels.value[id] = 0
  }

  const effectiveLevel = (id: SlimeUpgradeId): number =>
    upgrades.levelOf(id) + (tempLevels.value[id] ?? 0)

  // Effective multipliers / values combining perm (shop) + temp
  // (in-battle) levels. Combat code reads these instead of the
  // shop-only `upgrades.*` computeds so temp levels actually move the
  // numbers during a stage.
  const effectiveDamageMul = computed(() =>
    1 + (UPGRADE_DEFS.damage.perLevelPct ?? 0) * effectiveLevel('damage')
  )
  const effectiveFireRateMul = computed(() =>
    1 + (UPGRADE_DEFS.fireRate.perLevelPct ?? 0) * effectiveLevel('fireRate')
  )
  const effectiveCritRate = computed(() =>
    Math.min(0.95, (UPGRADE_DEFS.critRate.perLevelPct ?? 0) * effectiveLevel('critRate'))
  )
  const effectiveCritDmgMul = computed(() =>
    1.5 + (UPGRADE_DEFS.critDamage.perLevelPct ?? 0) * effectiveLevel('critDamage')
  )
  const effectiveMaxHp = computed(() =>
    30 + (UPGRADE_DEFS.maxHp.perLevelFlat ?? 0) * effectiveLevel('maxHp')
  )

  // Temp-only effective values (no permanent perm component, but the
  // shape mirrors the perm-stat computeds for consistency).
  const effectiveDefenseMul = computed(() => {
    const def = UPGRADE_DEFS.defense
    const reduction = Math.min(def.pctCap ?? 1, (def.perLevelPct ?? 0) * effectiveLevel('defense'))
    return 1 - reduction
  })
  const effectiveRegenPerSec = computed(() =>
    (UPGRADE_DEFS.autoRegen.perLevelFlat ?? 0) * effectiveLevel('autoRegen')
  )
  const effectiveMoveSpeedMul = computed(() =>
    1 + (UPGRADE_DEFS.moveSpeed.perLevelPct ?? 0) * effectiveLevel('moveSpeed')
  )
  const effectiveEvadeChance = computed(() => {
    const def = UPGRADE_DEFS.evade
    return Math.min(def.pctCap ?? 1, (def.perLevelPct ?? 0) * effectiveLevel('evade'))
  })
  const effectiveSplashPct = computed(() =>
    (UPGRADE_DEFS.splash.perLevelPct ?? 0) * effectiveLevel('splash')
  )
  const effectiveFireDotPct = computed(() =>
    (UPGRADE_DEFS.fireDot.perLevelPct ?? 0) * effectiveLevel('fireDot')
  )

  /** Stage progress 0..1 — backs the StageBadge progress bar. */
  const stageProgress = computed(() => {
    const total = currentStage.value.enemyCount
    if (total <= 0) return 0
    return Math.max(0, Math.min(1, world.value.killed / total))
  })

  /** Number of enemies spawned this stage / total. */
  const stageSpawned = computed(() => world.value.spawned)

  const introCountdown: Ref<string | null> = ref(null)
  const stageClearReward: Ref<{ drops: number; xp: number } | null> = ref(null)

  /**
   * The world is held in a shallowRef to opt-out of deep reactivity —
   * Vue won't re-trigger every time a single entity moves a pixel.
   */
  const world = shallowRef<GameWorld>(makeWorld(0, 0))

  function makeWorld(w: number, h: number): GameWorld {
    return {
      player: makePlayer(28, upgrades.maxHp.value),
      enemies: [],
      projectiles: [],
      drops: [],
      particles: [],
      artilleryMarkers: [],
      spawned: 0,
      killed: 0,
      width: w,
      height: h,
      fireCooldown: 0,
      spawnCooldown: 0,
      cameraShake: 0,
      joystick: { x: 0, y: 0 },
      joyActive: false,
      nextId: 1,
      t: 0
    }
  }

  const setViewport = (w: number, h: number) => {
    world.value.width = w
    world.value.height = h
    world.value.player.pos.x = w / 2
    world.value.player.pos.y = h / 2
  }

  /** Reset the whole world to a fresh stage. Preserves PERMANENT
   *  upgrades (shop purchases) but wipes the in-battle temporary
   *  upgrade levels — temp levels are explicitly per-stage so each
   *  stage starts the player at Lv 1 with shop stats only. */
  const resetForStage = () => {
    const w = world.value.width
    const h = world.value.height
    const fresh = makeWorld(w, h)
    // Clear temp levels FIRST so effectiveMaxHp returns the perm-only
    // value when we seed the player's HP below.
    resetTempLevels()
    fresh.player.maxHp = effectiveMaxHp.value
    fresh.player.hp = fresh.player.maxHp
    fresh.player.pos.x = w / 2
    fresh.player.pos.y = h / 2
    world.value = fresh
    playerHp.value = fresh.player.hp
    playerMaxHp.value = fresh.player.maxHp
    playerLevel.value = 1
    playerXp.value = 0
    playerXpNext.value = 8
    dropsCollectedThisStage.value = 0
  }

  const startIntro = () => {
    phase.value = 'intro'
    resetForStage()
    spawnMeteorShower()
    let step = 0
    const labels = ['3', '2', '1', 'GO!']
    const tick = () => {
      if (phase.value !== 'intro') return
      introCountdown.value = labels[step] ?? null
      step++
      if (step <= labels.length) {
        setTimeout(tick, 420)
      } else {
        introCountdown.value = null
        phase.value = 'battle'
      }
    }
    tick()
  }

  const beginStage = () => {
    if (phase.value === 'battle') return
    startIntro()
  }

  const surrender = () => {
    phase.value = 'gameover'
  }

  const acceptUpgradeChoice = (id: SlimeUpgradeId) => {
    // Temporary — applies to the current stage only. Permanent
    // upgrades come from the off-battle Item Shop. Bump the temp
    // counter; combat reads `effectiveLevel(id)` which combines
    // perm + temp at the call site. The shallow-clone reassignment
    // is required so module-scoped consumers (UpgradeChoiceModal)
    // see the change — the Ref's value object is mutated, but the
    // reactive system also tracks the wrapper.
    tempLevels.value = { ...tempLevels.value, [id]: (tempLevels.value[id] ?? 0) + 1 }
    if (id === 'maxHp') {
      // HP is special — increase the cap immediately and heal the
      // delta so the pick feels rewarding right now rather than next
      // tick. Going past max-after-temp is fine; clamp on next damage.
      const before = world.value.player.maxHp
      world.value.player.maxHp = effectiveMaxHp.value
      world.value.player.hp += world.value.player.maxHp - before
      playerMaxHp.value = world.value.player.maxHp
      playerHp.value = world.value.player.hp
    }
    phase.value = 'battle'
  }

  /** Apply a stage-clear → reward → next-stage transition. */
  const continueAfterClear = () => {
    advanceStage()
    stageClearReward.value = null
    phase.value = 'idle'
  }

  const continueAfterDefeat = () => {
    stageClearReward.value = null
    phase.value = 'idle'
    // Player keeps drops earned, but stage stays at the same level so
    // the loss doesn't punitively wipe their progress.
  }

  // ─── Spawn helpers ───────────────────────────────────────────────────

  const spawnMeteorShower = () => {
    const w = world.value
    for (let i = 0; i < 24; i++) {
      const startX = Math.random() * w.width
      const startY = -40 - Math.random() * 200
      const targetX = startX + (Math.random() - 0.5) * 220
      const targetY = w.height + 40
      const dx = targetX - startX
      const dy = targetY - startY
      const len = Math.hypot(dx, dy) || 1
      const speed = 380 + Math.random() * 220
      w.particles.push({
        id: w.nextId++,
        pos: { x: startX, y: startY },
        vel: { x: (dx / len) * speed, y: (dy / len) * speed },
        ttl: 1.6,
        maxTtl: 1.6,
        color: ['#ffce4a', '#ff9a3a', '#ffe28a'][Math.floor(Math.random() * 3)]!,
        size: 3 + Math.random() * 4,
        kind: 'meteor'
      })
    }
  }

  /**
   * Pick an archetype for a freshly-spawned mob.
   *   • Stages 1..3   — pure melee, no surprises for the rookie tier.
   *   • Stages 4+     — introduce ranged (5% per stage past 3, capped at 30%).
   *   • Stages 6+     — introduce jumpers (4% per stage past 5, capped at 25%).
   * The two odds are mutually exclusive (rolled in sequence on a single
   * uniform `r`) so a stage with high ranged + jumper odds still leaves
   * a chunk of pure melee enemies to keep the spread varied.
   */
  const rollArchetype = (stageId: number): SlimeArchetype => {
    if (stageId <= 3) return 'melee'
    const rangedChance = Math.min(0.3, (stageId - 3) * 0.05)
    const jumperChance = stageId >= 6 ? Math.min(0.25, (stageId - 5) * 0.04) : 0
    const r = Math.random()
    if (r < rangedChance) return 'ranged'
    if (r < rangedChance + jumperChance) return 'jumper'
    return 'melee'
  }

  const spawnEnemy = (stage: SlimeStageConfig, override?: Partial<SlimeEntity>) => {
    const w = world.value
    const edge = Math.floor(Math.random() * 4)
    const margin = 40
    let pos: Vec2
    switch (edge) {
      case 0: pos = { x: Math.random() * w.width, y: -margin }; break
      case 1: pos = { x: w.width + margin, y: Math.random() * w.height }; break
      case 2: pos = { x: Math.random() * w.width, y: w.height + margin }; break
      default: pos = { x: -margin, y: Math.random() * w.height }
    }
    const variance = 0.85 + Math.random() * 0.3
    // Bosses bypass the archetype roll and keep boss kind. Adds spawned
    // mid-stage (splitter children, summoner minions) come through with
    // an explicit override.kind and we honor the override here too.
    const archetype: SlimeArchetype = stage.isBoss ? 'melee' : rollArchetype(stage.id)
    // Visual differentiation per archetype: ranged → purple, jumper →
    // red, melee → random palette. Players learn the colors as a
    // shorthand for "watch out for kiting" / "watch out for lunge".
    const meleeColors: SlimeKind[] = ['green', 'blue', 'red', 'purple']
    const kind: SlimeKind = stage.isBoss
      ? 'boss'
      : archetype === 'ranged'
        ? 'purple'
        : archetype === 'jumper'
          ? 'red'
          : meleeColors[Math.floor(Math.random() * meleeColors.length)]!

    // Ranged slimes pay for their kite advantage with -30% HP.
    const baseHp = Math.round(stage.enemyHp * variance)
    const archetypeHpMul = archetype === 'ranged' ? 0.7 : 1
    const hp = Math.max(1, Math.round(baseHp * archetypeHpMul))

    const enemy: SlimeEntity = {
      id: w.nextId++,
      kind,
      pos,
      vel: { x: 0, y: 0 },
      radius: stage.enemyRadius * variance,
      hp,
      maxHp: hp,
      damage: stage.enemyDamage,
      speed: stage.enemySpeed * (0.85 + Math.random() * 0.3),
      hitFlash: 0,
      lastHit: 0,
      dropValue: stage.dropsPerKill,
      xpValue: stage.xpPerKill,
      isBoss: stage.isBoss,
      bossKind: stage.bossKind,
      cooldown: stage.isBoss ? 3 : 0,
      // Boss-only artillery state. Mob enemies leave these undefined
      // and the boss step is gated by isBoss anyway.
      artilleryState: stage.isBoss ? 'idle' : undefined,
      // First volley fires ~5s after the boss appears so the player
      // gets a beat to learn the boss before having to dodge a
      // cluster strike.
      artilleryCooldown: stage.isBoss ? 5 : undefined,
      artilleryStateTimer: 0,
      archetype,
      // Stagger the first ability tick so a fresh wave doesn't fire in
      // unison. Ranged: 0.6-1.4s before first shot. Jumper: kicks in
      // when the slime gets within range, so we just initialize to 0.
      abilityCooldown: archetype === 'ranged' ? 0.6 + Math.random() * 0.8 : 0,
      jumperState: archetype === 'jumper' ? 'idle' : undefined,
      ...override
    }
    w.enemies.push(enemy)
    w.spawned++
  }

  // ─── Update loop ─────────────────────────────────────────────────────

  /**
   * Advance the simulation by `dt` seconds. Caller (component) is in
   * charge of rAF timing — the composable just owns state.
   */
  const update = (dt: number) => {
    const w = world.value
    w.t += dt
    if (phase.value === 'idle' || phase.value === 'levelup' || phase.value === 'cleared' || phase.value === 'gameover') {
      // Particles still tick during pause states so the meteor intro
      // cleanup looks right when an FReward dialog opens.
      stepParticles(dt)
      return
    }

    if (phase.value === 'intro') {
      stepParticles(dt)
      return
    }

    const stage = currentStage.value

    // ── Player movement
    movePlayer(dt)

    // ── Auto-aim firing
    w.fireCooldown -= dt
    // base 0.55s between shots, accelerated by perm + temp fire-rate stacks.
    const fireInterval = 0.55 / effectiveFireRateMul.value
    if (w.fireCooldown <= 0 && w.enemies.length > 0) {
      const nearest = nearestEnemy(w)
      if (nearest) {
        fireProjectile(w, nearest)
        w.fireCooldown = fireInterval
      }
    }

    // ── Spawn loop
    if (w.spawned < stage.enemyCount) {
      w.spawnCooldown -= dt
      if (w.spawnCooldown <= 0) {
        spawnEnemy(stage)
        w.spawnCooldown = stage.spawnInterval / 1000
      }
    }

    // ── Enemy AI
    for (const enemy of w.enemies) {
      stepEnemy(enemy, dt, stage)
    }
    // ── Separation: keep slimes from stacking on a single pixel.
    //    Allows mild overlap (designers asked for it — feels swarmier
    //    than a strict no-touch policy) but pushes deep overlaps
    //    apart so the player can read individual silhouettes.
    separateEnemies(w)

    // ── Artillery markers tick (boss cluster munition). Independent
    //    of enemy AI — markers may outlive the boss that spawned
    //    them so we step them in the world loop, not the boss loop.
    stepArtillery(dt)

    // ── Disease/fire DoT tick on burning enemies (player upgrade).
    tickBurningEnemies(dt)

    // ── Projectiles
    for (const p of w.projectiles) {
      p.pos.x += p.vel.x * dt
      p.pos.y += p.vel.y * dt
      p.ttl -= dt
    }
    w.projectiles = w.projectiles.filter(p => p.ttl > 0 && p.pos.x > -100 && p.pos.x < w.width + 100 && p.pos.y > -100 && p.pos.y < w.height + 100)

    // ── Projectile collisions
    //    Friendly bullets (player auto-aim) → vs enemies.
    //    Hostile bullets (ranged-slime shots) → vs the player.
    //    One pass over the array; dispatch on the `friendly` flag so
    //    we don't iterate twice or maintain two arrays.
    const playerNow = performance.now()
    for (const p of w.projectiles) {
      if (p.ttl <= 0) continue
      if (p.friendly) {
        for (const e of w.enemies) {
          if (e.hp <= 0) continue
          const dx = p.pos.x - e.pos.x
          const dy = p.pos.y - e.pos.y
          if (dx * dx + dy * dy <= e.radius * e.radius) {
            applyDamage(e, p.damage, p.isCrit)
            spawnHitParticles(e.pos.x, e.pos.y, p.isCrit)

            // Splash cone — forward of the bullet's velocity vector,
            // 90° total, 60 px range. Uses the bullet's *primary*
            // damage as the splash base so a crit splashes harder.
            const splashPct = effectiveSplashPct.value
            if (splashPct > 0) applySplashCone(p, e, splashPct)

            // Disease/fire DoT — applies a burning state to the
            // direct hit. The DoT then spreads to neighbors during
            // the per-frame burning tick.
            const dotPct = effectiveFireDotPct.value
            if (dotPct > 0) igniteEnemy(e, p.damage * dotPct)

            p.ttl = 0
            break
          }
        }
      } else {
        // Hostile — only collides with the player. The unified helper
        // routes through invuln + evade + defense; we tack on the
        // VFX hooks the helper deliberately doesn't own.
        const dx = p.pos.x - w.player.pos.x
        const dy = p.pos.y - w.player.pos.y
        const r = w.player.radius
        if (dx * dx + dy * dy <= r * r) {
          if (applyPlayerDamage(p.damage, playerNow)) {
            w.cameraShake = Math.min(10, w.cameraShake + 3)
            spawnHitParticles(w.player.pos.x, w.player.pos.y, false)
          }
          p.ttl = 0
        }
      }
    }

    // ── Enemy vs player (contact damage)
    const player = w.player
    const now = performance.now()
    for (const e of w.enemies) {
      if (e.hp <= 0) continue
      const dx = player.pos.x - e.pos.x
      const dy = player.pos.y - e.pos.y
      const r = (player.radius + e.radius) * 0.85
      if (dx * dx + dy * dy <= r * r) {
        if (applyPlayerDamage(e.damage, now)) {
          w.cameraShake = Math.min(12, w.cameraShake + 4)
          if (player.hp <= 0) {
            phase.value = 'gameover'
            stageClearReward.value = null
            break
          }
        }
      }
    }

    // ── Hit flash decay
    if (player.hitFlash > 0) player.hitFlash = Math.max(0, player.hitFlash - dt * 4)
    for (const e of w.enemies) if (e.hitFlash > 0) e.hitFlash = Math.max(0, e.hitFlash - dt * 6)
    if (w.cameraShake > 0) w.cameraShake = Math.max(0, w.cameraShake - dt * 30)

    // ── Reap dead enemies; spawn drops
    if (w.enemies.some(e => e.hp <= 0)) {
      for (const e of w.enemies) {
        if (e.hp > 0) continue
        if (e.isBoss && e.bossKind === 'splitter' && !e.isSpawnedAdd) {
          // Splitter spawns 3 mini adds on death.
          for (let i = 0; i < 3; i++) {
            const angle = Math.random() * Math.PI * 2
            const dist = e.radius * 0.6
            spawnEnemy(stage, {
              radius: e.radius * 0.45,
              hp: Math.round(e.maxHp * 0.18),
              maxHp: Math.round(e.maxHp * 0.18),
              kind: 'red',
              pos: { x: e.pos.x + Math.cos(angle) * dist, y: e.pos.y + Math.sin(angle) * dist },
              isBoss: false,
              bossKind: undefined,
              dropValue: 4,
              xpValue: 3,
              isSpawnedAdd: true
            })
          }
        }
        spawnDrop(e.pos.x, e.pos.y, e.dropValue)
        spawnDeathParticles(e.pos.x, e.pos.y, e.kind)
        playerXp.value += e.xpValue
        // Only count "primary" deaths toward the stage clear quota.
        // Splitter babies + summoner minions carry isSpawnedAdd=true
        // — counting them too caused boss stages to end early when a
        // single summoner-minion died on the same frame as the boss.
        if (!e.isSpawnedAdd) w.killed++
      }
      w.enemies = w.enemies.filter(e => e.hp > 0)
    }

    // ── Level-up
    if (playerXp.value >= playerXpNext.value) {
      playerXp.value = playerXp.value - playerXpNext.value
      playerLevel.value += 1
      playerXpNext.value = Math.round(playerXpNext.value * 1.45 + 4)
      phase.value = 'levelup'
      return
    }

    // ── Drop magnetism + collection
    const mag = upgrades.collectRadius.value
    for (const drop of w.drops) {
      const dx = player.pos.x - drop.pos.x
      const dy = player.pos.y - drop.pos.y
      const dist = Math.hypot(dx, dy)
      if (dist < mag) {
        const pull = (1 - dist / mag) * 320 * dt
        drop.pos.x += (dx / (dist || 1)) * pull
        drop.pos.y += (dy / (dist || 1)) * pull
      }
      if (dist < player.radius * 0.85) {
        addDrops(drop.value)
        dropsCollectedThisStage.value += drop.value
        drop.value = 0
      }
    }
    w.drops = w.drops.filter(d => d.value > 0)

    // ── Stage cleared check.
    //
    // Two conditions must both hold:
    //   1. Every primary spawn has died (kill counter hits the stage
    //      quota — only non-`isSpawnedAdd` enemies count, see the
    //      death loop above).
    //   2. No live enemies remain on screen — covers the edge case
    //      where a splitter / summoner died last frame and left adds
    //      alive. Without this gate the player would see "Stage Clear"
    //      while a healer-spawned minion was still ranging at them.
    if (w.killed >= stage.enemyCount && w.enemies.length === 0) {
      stageClearReward.value = {
        drops: dropsCollectedThisStage.value,
        xp: playerXp.value
      }
      phase.value = 'cleared'
      return
    }

    // ── Particle step (sparks, damage numbers, etc.)
    stepParticles(dt)

    // ── Sync HUD-bound refs with the world after this tick.
    playerHp.value = player.hp
    playerMaxHp.value = player.maxHp
  }

  // ─── Sub-steps ───────────────────────────────────────────────────────

  const movePlayer = (dt: number) => {
    const w = world.value
    const p = w.player
    let dx = w.joystick.x
    let dy = w.joystick.y
    const len = Math.hypot(dx, dy)
    // Effective speed includes the move-speed temp upgrade.
    const speed = p.speed * effectiveMoveSpeedMul.value
    if (len > 0.01) {
      dx /= len
      dy /= len
      p.vel.x = dx * speed
      p.vel.y = dy * speed
    } else {
      p.vel.x *= 0.6
      p.vel.y *= 0.6
    }
    p.pos.x = Math.max(p.radius, Math.min(w.width - p.radius, p.pos.x + p.vel.x * dt))
    p.pos.y = Math.max(p.radius, Math.min(w.height - p.radius, p.pos.y + p.vel.y * dt))

    // Passive auto-regen — only ticks while the player is below max
    // HP. Slow enough that it doesn't replace HP upgrades but real
    // enough that the player feels rewarded across a long stage.
    const regenRate = effectiveRegenPerSec.value
    if (regenRate > 0 && p.hp < p.maxHp) {
      p.hp = Math.min(p.maxHp, p.hp + regenRate * dt)
    }
  }

  const stepEnemy = (e: SlimeEntity, dt: number, stage: SlimeStageConfig) => {
    const w = world.value
    const dx = w.player.pos.x - e.pos.x
    const dy = w.player.pos.y - e.pos.y
    const dist = Math.hypot(dx, dy) || 1

    // ── Per-archetype movement (only for non-boss enemies). Bosses
    //    keep the simple chase path below + their `bossKind` special.
    if (!e.isBoss) {
      if (e.archetype === 'ranged') {
        stepRanged(e, dx, dy, dist, dt)
      } else if (e.archetype === 'jumper') {
        stepJumper(e, dx, dy, dist, dt)
      } else {
        // Melee — chase straight at the player.
        e.vel.x = (dx / dist) * e.speed
        e.vel.y = (dy / dist) * e.speed
        e.pos.x += e.vel.x * dt
        e.pos.y += e.vel.y * dt
      }
      return
    }

    // Boss path: keep the legacy chase + bossKind dispatch.
    // Telegraph state freezes the boss in place — the player should
    // read the windup as a beat to reposition for the incoming
    // cluster strike, not to chase the boss across the arena.
    if (e.artilleryState === 'telegraph') {
      e.vel.x *= 0.85
      e.vel.y *= 0.85
    } else {
      e.vel.x = (dx / dist) * e.speed
      e.vel.y = (dy / dist) * e.speed
      e.pos.x += e.vel.x * dt
      e.pos.y += e.vel.y * dt
    }

    // Artillery cycle is independent of bossKind specials so a
    // healer/summoner/lightning boss still rains down cluster shots.
    stepBossArtillery(e, dt)

    if (!e.bossKind) return
    e.cooldown -= dt
    if (e.cooldown > 0) return
    if (e.bossKind === 'healer') {
      e.hp = Math.min(e.maxHp, e.hp + Math.round(e.maxHp * 0.04))
      e.cooldown = 1.5
    } else if (e.bossKind === 'summoner' && w.enemies.length < 12) {
      spawnEnemy(stage, {
        radius: 14,
        hp: Math.max(8, Math.round(e.maxHp * 0.05)),
        maxHp: Math.max(8, Math.round(e.maxHp * 0.05)),
        kind: 'purple',
        pos: { x: e.pos.x, y: e.pos.y },
        isBoss: false,
        bossKind: undefined,
        dropValue: 2,
        xpValue: 2,
        isSpawnedAdd: true
      })
      e.cooldown = 4
    } else if (e.bossKind === 'lightning') {
      // Drop a shockwave at the player position; small instant damage.
      const target = { x: w.player.pos.x, y: w.player.pos.y }
      w.particles.push({
        id: w.nextId++,
        pos: target,
        vel: { x: 0, y: 0 },
        ttl: 0.4,
        maxTtl: 0.4,
        color: '#ffe97a',
        size: 8,
        kind: 'shockwave'
      })
      const r2 = 70 * 70
      const ddx = target.x - w.player.pos.x
      const ddy = target.y - w.player.pos.y
      if (ddx * ddx + ddy * ddy < r2) {
        applyPlayerDamage(e.damage * 1.5, performance.now())
      }
      e.cooldown = 4.5
    } else {
      e.cooldown = 5
    }
  }

  // ── Archetype helpers ───────────────────────────────────────────────

  /** Ranged slime: kite at a preferred standoff distance and shoot. */
  const RANGED_PREFERRED_DIST = 220
  const RANGED_DEAD_ZONE = 40         // tolerance — don't dither inside ±40px
  const RANGED_FIRE_DIST = 320        // max distance at which a shot is allowed
  const ENEMY_PROJECTILE_SPEED = 220
  const ENEMY_PROJECTILE_TTL = 3.0

  const stepRanged = (e: SlimeEntity, dx: number, dy: number, dist: number, dt: number) => {
    const w = world.value
    const nx = dx / dist
    const ny = dy / dist
    let moveDir = 0
    if (dist > RANGED_PREFERRED_DIST + RANGED_DEAD_ZONE) moveDir = 1   // approach
    else if (dist < RANGED_PREFERRED_DIST - RANGED_DEAD_ZONE) moveDir = -1 // retreat
    e.vel.x = nx * e.speed * moveDir
    e.vel.y = ny * e.speed * moveDir
    e.pos.x += e.vel.x * dt
    e.pos.y += e.vel.y * dt

    // Shoot toward the player if close enough and the cooldown is up.
    e.abilityCooldown -= dt
    if (e.abilityCooldown <= 0 && dist < RANGED_FIRE_DIST) {
      fireEnemyProjectile(w, e)
      e.abilityCooldown = 1.6 + Math.random() * 0.6
    }
  }

  /** Jumper slime: chase → charge 0.75s → lunge 0.4s → recover 0.5s. */
  const JUMPER_CHARGE_TIME = 0.75
  const JUMPER_LUNGE_TIME = 0.4
  const JUMPER_RECOVERY_TIME = 0.5
  // +25% lunge speed over the previous tuning (was 520 → 650). The
  // total dash range is `LUNGE_SPEED * LUNGE_TIME` ≈ 260px, so the
  // jumper now closes about 65px more ground per lunge — turns
  // "easy to outrun" into a real positioning threat.
  const JUMPER_LUNGE_SPEED = 650
  const JUMPER_TRIGGER_RANGE = 320      // start charging within this radius
  const JUMPER_MIN_TRIGGER_RANGE = 90   // don't lunge from point-blank

  const stepJumper = (e: SlimeEntity, dx: number, dy: number, dist: number, dt: number) => {
    const w = world.value
    const nx = dx / dist
    const ny = dy / dist
    const state = e.jumperState ?? 'idle'

    if (state === 'idle') {
      // Normal chase, slightly slower than melee so the lunge reads as
      // the dangerous part of the move set rather than a bonus.
      e.vel.x = nx * e.speed * 0.8
      e.vel.y = ny * e.speed * 0.8
      e.pos.x += e.vel.x * dt
      e.pos.y += e.vel.y * dt
      if (dist < JUMPER_TRIGGER_RANGE && dist > JUMPER_MIN_TRIGGER_RANGE) {
        e.jumperState = 'charging'
        e.abilityCooldown = JUMPER_CHARGE_TIME
      }
    } else if (state === 'charging') {
      // Stand still — the visual squash + telegraph ring (see render
      // path) sells the windup. Damp velocity so the slime visually
      // settles rather than sliding forward.
      e.vel.x *= 0.85
      e.vel.y *= 0.85
      e.abilityCooldown -= dt
      // Emit charge sparks pointing inward — the jumper is "winding
      // up" energy. A handful per frame is plenty without flooding
      // the particle layer.
      if (Math.random() < 0.5) {
        const sparkAngle = Math.random() * Math.PI * 2
        const sparkR = e.radius * (1.3 + Math.random() * 0.4)
        const sx = e.pos.x + Math.cos(sparkAngle) * sparkR
        const sy = e.pos.y + Math.sin(sparkAngle) * sparkR
        // Inward velocity — sparks rush toward the slime as it charges.
        const inDx = e.pos.x - sx
        const inDy = e.pos.y - sy
        const inLen = Math.hypot(inDx, inDy) || 1
        w.particles.push({
          id: w.nextId++,
          pos: { x: sx, y: sy },
          vel: { x: (inDx / inLen) * 220, y: (inDy / inLen) * 220 },
          ttl: 0.25 + Math.random() * 0.15,
          maxTtl: 0.4,
          color: '#ffe07a',
          size: 2 + Math.random() * 2,
          kind: 'spark'
        })
      }
      if (e.abilityCooldown <= 0) {
        // Lock the lunge target at the moment of release. We aim at
        // the *current* player position — the lunge is dodgeable for
        // a player who keeps moving.
        const tdx = w.player.pos.x - e.pos.x
        const tdy = w.player.pos.y - e.pos.y
        const len = Math.hypot(tdx, tdy) || 1
        e.vel.x = (tdx / len) * JUMPER_LUNGE_SPEED
        e.vel.y = (tdy / len) * JUMPER_LUNGE_SPEED
        e.jumperState = 'lunging'
        e.abilityCooldown = JUMPER_LUNGE_TIME
      }
    } else if (state === 'lunging') {
      // Move at lunge velocity locked in at charge-end. Don't re-aim
      // mid-lunge so a strafing player can dodge.
      e.pos.x += e.vel.x * dt
      e.pos.y += e.vel.y * dt
      e.abilityCooldown -= dt
      if (e.abilityCooldown <= 0) {
        e.jumperState = 'recovery'
        e.abilityCooldown = JUMPER_RECOVERY_TIME
      }
    } else if (state === 'recovery') {
      // Brief gathering-yourself state. Slow movement, no chase. After
      // recovery the jumper goes back to 'idle' and can charge again.
      e.vel.x *= 0.7
      e.vel.y *= 0.7
      e.pos.x += e.vel.x * dt
      e.pos.y += e.vel.y * dt
      e.abilityCooldown -= dt
      if (e.abilityCooldown <= 0) e.jumperState = 'idle'
    }
  }

  const fireEnemyProjectile = (w: GameWorld, e: SlimeEntity) => {
    const tdx = w.player.pos.x - e.pos.x
    const tdy = w.player.pos.y - e.pos.y
    const len = Math.hypot(tdx, tdy) || 1
    w.projectiles.push({
      id: w.nextId++,
      pos: { x: e.pos.x, y: e.pos.y },
      vel: { x: (tdx / len) * ENEMY_PROJECTILE_SPEED, y: (tdy / len) * ENEMY_PROJECTILE_SPEED },
      damage: Math.max(2, Math.round(e.damage * 0.85)),
      isCrit: false,
      ttl: ENEMY_PROJECTILE_TTL,
      friendly: false
    })
  }

  // ── Boss artillery (cluster munition) ───────────────────────────────
  //
  // Cycle:
  //   idle      → cooldown counts down (ARTILLERY_COOLDOWN ≈ 7s)
  //   telegraph → 1.0s buildup, boss freezes + glows orange
  //   (impact placement happens at telegraph end)
  //   markers   → live in `world.artilleryMarkers` for ARTILLERY_WARNING_DURATION
  //   impact    → on ttl=0, AoE damage + explosion VFX, then 0.4s post-FX, then removed
  //
  // The player's read on the ability is:
  //   1. orange ring on the boss → "something's coming"
  //   2. blinking ground markers → "step out of these"
  //   3. burst at the marker positions → damage applies
  const ARTILLERY_TELEGRAPH_TIME = 1.0
  const ARTILLERY_COOLDOWN = 7.0
  const ARTILLERY_WARNING_DURATION = 1.4
  const ARTILLERY_IMPACT_DISPLAY_TIME = 0.4
  const ARTILLERY_BLAST_RADIUS = 64
  const ARTILLERY_CLUSTER_COUNT = 6
  const ARTILLERY_CLUSTER_SPREAD = 110
  /** First cluster targets the player, the rest spread around it. */
  const stepBossArtillery = (e: SlimeEntity, dt: number) => {
    if (e.artilleryState === undefined) return
    if (e.artilleryState === 'idle') {
      e.artilleryCooldown = (e.artilleryCooldown ?? 0) - dt
      if (e.artilleryCooldown <= 0) {
        e.artilleryState = 'telegraph'
        e.artilleryStateTimer = ARTILLERY_TELEGRAPH_TIME
      }
    } else if (e.artilleryState === 'telegraph') {
      e.artilleryStateTimer = (e.artilleryStateTimer ?? 0) - dt
      if (e.artilleryStateTimer <= 0) {
        spawnArtilleryCluster(e)
        e.artilleryState = 'idle'
        e.artilleryCooldown = ARTILLERY_COOLDOWN
      }
    }
  }

  /** Drop ARTILLERY_CLUSTER_COUNT markers in a hex-ish ring around the
   *  player's *current* position. The first marker is centered on the
   *  player; the others are scattered at a random angle each so the
   *  pattern feels natural rather than a perfect compass rose. */
  const spawnArtilleryCluster = (boss: SlimeEntity) => {
    const w = world.value
    const cx = w.player.pos.x
    const cy = w.player.pos.y
    const damagePerHit = Math.max(4, Math.round(boss.damage * 1.4))

    // Center marker (locked to player position at cast time — moves the
    // dodge from "see the markers" to "react fast enough").
    pushMarker(w, cx, cy, damagePerHit)

    // Outer ring — 5 markers (or whatever ARTILLERY_CLUSTER_COUNT - 1)
    // spread around the center. Random angle offset on each cast so
    // repeat casts don't feel mechanical.
    const angleOffset = Math.random() * Math.PI * 2
    for (let i = 1; i < ARTILLERY_CLUSTER_COUNT; i++) {
      const angle = angleOffset + ((i - 1) / (ARTILLERY_CLUSTER_COUNT - 1)) * Math.PI * 2
      const dist = ARTILLERY_CLUSTER_SPREAD * (0.6 + Math.random() * 0.5)
      const px = cx + Math.cos(angle) * dist
      const py = cy + Math.sin(angle) * dist
      // Per-marker ttl jitter so the cluster lands as a brief drumroll
      // instead of a single thunderclap — easier to read individual
      // impacts on screen.
      const jitter = (i - 1) * 0.07 + Math.random() * 0.08
      pushMarker(w, px, py, damagePerHit, ARTILLERY_WARNING_DURATION + jitter)
    }
  }

  const pushMarker = (
    w: GameWorld,
    x: number,
    y: number,
    damage: number,
    ttl = ARTILLERY_WARNING_DURATION
  ) => {
    w.artilleryMarkers.push({
      id: w.nextId++,
      pos: { x, y },
      ttl,
      maxTtl: ttl,
      damage,
      blastRadius: ARTILLERY_BLAST_RADIUS,
      exploded: false,
      explosionTtl: 0
    })
  }

  /** Advance every marker. On ttl→0 we apply AoE damage to the player
   *  if they're within blastRadius, spawn explosion sparks, and start
   *  the post-impact display window. After that window the marker is
   *  removed from the array. */
  const stepArtillery = (dt: number) => {
    const w = world.value
    if (w.artilleryMarkers.length === 0) return
    const now = performance.now()
    for (const m of w.artilleryMarkers) {
      if (!m.exploded) {
        m.ttl -= dt
        if (m.ttl <= 0) {
          m.exploded = true
          m.explosionTtl = ARTILLERY_IMPACT_DISPLAY_TIME
          // Damage check at impact — single test against the player's
          // current position. Routes through `applyPlayerDamage` so
          // evade / defense / invuln all apply uniformly.
          const dx = w.player.pos.x - m.pos.x
          const dy = w.player.pos.y - m.pos.y
          if (dx * dx + dy * dy <= m.blastRadius * m.blastRadius) {
            if (applyPlayerDamage(m.damage, now)) {
              w.cameraShake = Math.min(14, w.cameraShake + 6)
            }
          }
          // Explosion sparks — reuse the particle layer so they fade
          // alongside other VFX.
          spawnArtilleryImpactParticles(m.pos.x, m.pos.y)
        }
      } else {
        m.explosionTtl -= dt
      }
    }
    w.artilleryMarkers = w.artilleryMarkers.filter(m => !m.exploded || m.explosionTtl > 0)
  }

  const spawnArtilleryImpactParticles = (x: number, y: number) => {
    const w = world.value
    for (let i = 0; i < 18; i++) {
      const angle = Math.random() * Math.PI * 2
      const speed = 120 + Math.random() * 280
      w.particles.push({
        id: w.nextId++,
        pos: { x, y },
        vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
        ttl: 0.4 + Math.random() * 0.3,
        maxTtl: 0.7,
        color: i % 3 === 0 ? '#fff394' : '#ffa53a',
        size: 3 + Math.random() * 3,
        kind: 'spark'
      })
    }
    // Big shockwave ring.
    w.particles.push({
      id: w.nextId++,
      pos: { x, y },
      vel: { x: 0, y: 0 },
      ttl: ARTILLERY_IMPACT_DISPLAY_TIME,
      maxTtl: ARTILLERY_IMPACT_DISPLAY_TIME,
      color: '#ffce4a',
      size: ARTILLERY_BLAST_RADIUS,
      kind: 'shockwave'
    })
  }

  /**
   * Push overlapping slimes apart so they don't stack on a single pixel.
   * O(n²) — acceptable up to a few hundred enemies; bigger waves would
   * need a spatial hash. Exclusions:
   *   • dead slimes (hp ≤ 0) — about to be reaped
   *   • lunging jumpers — they need to commit to their attack vector
   * Mass weighting (radius²) means a boss barely budges while smaller
   * slimes get displaced around it.
   */
  const separateEnemies = (w: GameWorld) => {
    const en = w.enemies
    for (let i = 0; i < en.length; i++) {
      const a = en[i]!
      if (a.hp <= 0) continue
      if (a.archetype === 'jumper' && a.jumperState === 'lunging') continue
      for (let j = i + 1; j < en.length; j++) {
        const b = en[j]!
        if (b.hp <= 0) continue
        if (b.archetype === 'jumper' && b.jumperState === 'lunging') continue
        const dx = b.pos.x - a.pos.x
        const dy = b.pos.y - a.pos.y
        // 0.92 lets two slimes overlap by ~8% of their combined radii
        // before we push — designers asked for "ok if they overlap a
        // bit". Tighter than 1.0 (no-touch) but loose enough to keep
        // the swarm feeling busy.
        const minDist = (a.radius + b.radius) * 0.92
        const distSq = dx * dx + dy * dy
        if (distSq <= 0.0001) {
          // Exactly co-located (e.g. two enemies spawned on the same
          // edge tile). Nudge horizontally so the next frame can run
          // a proper resolution.
          a.pos.x -= 1
          b.pos.x += 1
          continue
        }
        if (distSq < minDist * minDist) {
          const dist = Math.sqrt(distSq)
          const overlap = minDist - dist
          const nx = dx / dist
          const ny = dy / dist
          const mA = a.radius * a.radius
          const mB = b.radius * b.radius
          const total = mA + mB
          a.pos.x -= nx * overlap * (mB / total)
          a.pos.y -= ny * overlap * (mB / total)
          b.pos.x += nx * overlap * (mA / total)
          b.pos.y += ny * overlap * (mA / total)
        }
      }
    }
  }

  // ── Unified player-damage helper ────────────────────────────────────
  //
  // Centralizes the (1) invuln window, (2) evade roll, and (3) defense
  // damage reduction for every source of player damage. Returns true
  // when damage was applied, false when the hit was eaten (invuln,
  // evade roll). Call sites still own their own VFX (camera shake,
  // hit particles) so the call surface stays small.
  const applyPlayerDamage = (rawAmount: number, now: number): boolean => {
    const w = world.value
    if (now - w.player.lastHit <= PLAYER_HIT_INVULN_MS) return false
    if (Math.random() < effectiveEvadeChance.value) {
      // Evade — no damage, brief invuln so a bullet stack doesn't
      // re-roll on every overlapping projectile in the same frame.
      // Floating "EVADE" tag drawn via the existing damage-number
      // particle path so it inherits the same fade-up animation.
      w.particles.push({
        id: w.nextId++,
        pos: { x: w.player.pos.x, y: w.player.pos.y - w.player.radius },
        vel: { x: 0, y: -90 },
        ttl: 0.7,
        maxTtl: 0.7,
        color: '#5ee9ff',
        size: 14,
        kind: 'damage',
        text: 'EVADE'
      })
      w.player.lastHit = now
      return false
    }
    const reduced = Math.max(0, rawAmount) * effectiveDefenseMul.value
    w.player.hp -= reduced
    w.player.hitFlash = 1
    w.player.lastHit = now
    return true
  }

  const nearestEnemy = (w: GameWorld): SlimeEntity | null => {
    let best: SlimeEntity | null = null
    let bestD = Infinity
    const px = w.player.pos.x
    const py = w.player.pos.y
    for (const e of w.enemies) {
      if (e.hp <= 0) continue
      const dx = px - e.pos.x
      const dy = py - e.pos.y
      const d = dx * dx + dy * dy
      if (d < bestD) {
        bestD = d
        best = e
      }
    }
    return best
  }

  const fireProjectile = (w: GameWorld, target: SlimeEntity) => {
    const dx = target.pos.x - w.player.pos.x
    const dy = target.pos.y - w.player.pos.y
    const len = Math.hypot(dx, dy) || 1
    const isCrit = Math.random() < effectiveCritRate.value
    const dmgBase = 6 * effectiveDamageMul.value
    const damage = Math.round(dmgBase * (isCrit ? effectiveCritDmgMul.value : 1))
    w.projectiles.push({
      id: w.nextId++,
      pos: { x: w.player.pos.x, y: w.player.pos.y },
      vel: { x: (dx / len) * DEFAULT_PROJECTILE_SPEED, y: (dy / len) * DEFAULT_PROJECTILE_SPEED },
      damage,
      isCrit,
      ttl: PROJECTILE_TTL,
      friendly: true
    })
  }

  const applyDamage = (target: SlimeEntity, amount: number, isCrit: boolean) => {
    target.hp -= amount
    target.hitFlash = 1
    spawnDamageNumber(target.pos.x, target.pos.y - target.radius, amount, isCrit)
  }

  /** Splash cone: damage every other enemy in a 90° forward arc from
   *  the impact point, out to 60 px. Uses the bullet's velocity as the
   *  cone axis so the spread reads as "shrapnel forward of the hit". */
  const SPLASH_CONE_RANGE = 60
  const SPLASH_CONE_HALF_ANGLE = Math.PI / 4 // 90° total
  const applySplashCone = (p: Projectile, primaryHit: SlimeEntity, splashPct: number) => {
    const w = world.value
    const speed = Math.hypot(p.vel.x, p.vel.y) || 1
    const ax = p.vel.x / speed
    const ay = p.vel.y / speed
    const splashDmg = p.damage * splashPct
    const cosThreshold = Math.cos(SPLASH_CONE_HALF_ANGLE)
    for (const other of w.enemies) {
      if (other === primaryHit || other.hp <= 0) continue
      const odx = other.pos.x - p.pos.x
      const ody = other.pos.y - p.pos.y
      const odist = Math.hypot(odx, ody)
      if (odist < 1 || odist > SPLASH_CONE_RANGE) continue
      const dot = (odx * ax + ody * ay) / odist
      if (dot < cosThreshold) continue
      applyDamage(other, splashDmg, false)
    }
    // Brief fan-shaped flash at the hit point so the player can see
    // the splash actually triggered. Cheaper than a sprite — a few
    // outward sparks aligned with the cone axis.
    for (let i = 0; i < 4; i++) {
      const angle = Math.atan2(ay, ax) + (Math.random() - 0.5) * SPLASH_CONE_HALF_ANGLE * 2
      const spd = 200 + Math.random() * 160
      w.particles.push({
        id: w.nextId++,
        pos: { x: p.pos.x, y: p.pos.y },
        vel: { x: Math.cos(angle) * spd, y: Math.sin(angle) * spd },
        ttl: 0.22 + Math.random() * 0.12,
        maxTtl: 0.34,
        color: '#ffb060',
        size: 3 + Math.random() * 2,
        kind: 'spark'
      })
    }
  }

  /** Ignite or refresh a burning DoT on an enemy. The fire DoT lasts
   *  3 seconds; total damage is `bulletDamage * (level === 1 ? 0.15 :
   *  0.30)`. Refreshing an already-burning enemy keeps whichever
   *  remaining damage is higher so quick chains stack reasonably. */
  const FIRE_DOT_DURATION = 3.0
  const FIRE_DOT_SPREAD_RADIUS = 70
  const FIRE_DOT_SPREAD_INTERVAL = 0.6
  const FIRE_DOT_SPREAD_DECAY = 0.8
  const igniteEnemy = (e: SlimeEntity, totalDamage: number) => {
    const incoming = {
      remaining: FIRE_DOT_DURATION,
      totalDuration: FIRE_DOT_DURATION,
      totalDamage,
      spreadCd: FIRE_DOT_SPREAD_INTERVAL
    }
    if (!e.burning || incoming.totalDamage > e.burning.totalDamage) {
      e.burning = incoming
    } else {
      // Same enemy, weaker incoming — just refresh the timer.
      e.burning.remaining = FIRE_DOT_DURATION
    }
  }

  /** Per-frame burning tick: drains HP, decays remaining duration,
   *  and periodically tries to spread fire to nearby unburned enemies
   *  (with damage decay so cascades self-attenuate rather than
   *  exploding into a screen-clearing inferno). */
  const tickBurningEnemies = (dt: number) => {
    const w = world.value
    if (w.enemies.length === 0) return
    for (const e of w.enemies) {
      const b = e.burning
      if (!b || e.hp <= 0) continue
      const dmgPerSec = b.totalDamage / b.totalDuration
      e.hp -= dmgPerSec * dt
      b.remaining -= dt
      // Spread cooldown.
      b.spreadCd -= dt
      if (b.spreadCd <= 0) {
        b.spreadCd = FIRE_DOT_SPREAD_INTERVAL
        for (const other of w.enemies) {
          if (other === e || other.hp <= 0 || other.burning) continue
          const dx = other.pos.x - e.pos.x
          const dy = other.pos.y - e.pos.y
          if (dx * dx + dy * dy <= FIRE_DOT_SPREAD_RADIUS * FIRE_DOT_SPREAD_RADIUS) {
            other.burning = {
              remaining: FIRE_DOT_DURATION,
              totalDuration: FIRE_DOT_DURATION,
              totalDamage: b.totalDamage * FIRE_DOT_SPREAD_DECAY,
              spreadCd: FIRE_DOT_SPREAD_INTERVAL
            }
          }
        }
      }
      if (b.remaining <= 0) e.burning = undefined
      // Sparse flame particle so the burn reads visually without
      // flooding the particle layer (one per frame per burning slime
      // at most, gated by chance).
      if (Math.random() < 0.35) {
        w.particles.push({
          id: w.nextId++,
          pos: {
            x: e.pos.x + (Math.random() - 0.5) * e.radius * 0.8,
            y: e.pos.y - e.radius * 0.4
          },
          vel: { x: (Math.random() - 0.5) * 30, y: -50 - Math.random() * 30 },
          ttl: 0.32 + Math.random() * 0.12,
          maxTtl: 0.44,
          color: Math.random() < 0.5 ? '#ff8030' : '#ffd060',
          size: 2 + Math.random() * 2,
          kind: 'spark'
        })
      }
    }
  }

  const spawnDrop = (x: number, y: number, value: number) => {
    if (value <= 0) return
    world.value.drops.push({
      id: world.value.nextId++,
      pos: { x, y },
      phase: Math.random() * Math.PI * 2,
      value
    })
  }

  const spawnHitParticles = (x: number, y: number, isCrit: boolean) => {
    const w = world.value
    const count = isCrit ? 10 : 4
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2
      const speed = 80 + Math.random() * 160
      w.particles.push({
        id: w.nextId++,
        pos: { x, y },
        vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
        ttl: 0.35 + Math.random() * 0.2,
        maxTtl: 0.55,
        color: isCrit ? '#fff7a0' : '#ffd084',
        size: 2 + Math.random() * 2,
        kind: 'spark'
      })
    }
  }

  const spawnDeathParticles = (x: number, y: number, kind: SlimeKind) => {
    const w = world.value
    const colorMap: Partial<Record<SlimeKind, string>> = {
      green: '#9bbf3a', blue: '#4ea7ff', red: '#ff5f5f',
      purple: '#c779ff', gold: '#ffd84a', boss: '#ff3a4e',
      player: '#7cd957'
    }
    const color = colorMap[kind] ?? '#9bbf3a'
    for (let i = 0; i < 12; i++) {
      const angle = Math.random() * Math.PI * 2
      const speed = 60 + Math.random() * 200
      w.particles.push({
        id: w.nextId++,
        pos: { x, y },
        vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
        ttl: 0.5 + Math.random() * 0.3,
        maxTtl: 0.8,
        color,
        size: 3 + Math.random() * 3,
        kind: 'spark'
      })
    }
  }

  const spawnDamageNumber = (x: number, y: number, amount: number, isCrit: boolean) => {
    world.value.particles.push({
      id: world.value.nextId++,
      pos: { x, y },
      vel: { x: (Math.random() - 0.5) * 40, y: -90 - Math.random() * 30 },
      ttl: 0.7,
      maxTtl: 0.7,
      color: isCrit ? '#fff394' : '#ffffff',
      size: isCrit ? 18 : 14,
      kind: 'damage',
      text: String(Math.round(amount)) + (isCrit ? '!' : '')
    })
  }

  const stepParticles = (dt: number) => {
    const w = world.value
    for (const p of w.particles) {
      p.pos.x += p.vel.x * dt
      p.pos.y += p.vel.y * dt
      // Damage numbers float upward then fade.
      if (p.kind === 'damage') {
        p.vel.y += 90 * dt // mild gravity-bounce
      } else if (p.kind === 'spark') {
        p.vel.x *= 0.94
        p.vel.y *= 0.94
        p.vel.y += 220 * dt
      }
      p.ttl -= dt
    }
    w.particles = w.particles.filter(p => p.ttl > 0)
  }

  // ─── Render ──────────────────────────────────────────────────────────

  const render = (ctx: CanvasRenderingContext2D) => {
    const w = world.value
    const t = w.t

    ctx.save()

    // Camera shake offset.
    if (w.cameraShake > 0) {
      ctx.translate((Math.random() - 0.5) * w.cameraShake, (Math.random() - 0.5) * w.cameraShake)
    }

    // Tile background — soft grid pattern; intentionally cheap.
    drawArenaBackground(ctx, w)

    // Drops first so slimes stomp on top.
    for (const d of w.drops) {
      drawSlimeDrop(ctx, d.pos.x, d.pos.y, 9, t + d.phase)
    }

    // Player aim points to nearest enemy.
    const aim = (() => {
      const target = nearestEnemy(w)
      if (!target) return 0
      return Math.atan2(target.pos.y - w.player.pos.y, target.pos.x - w.player.pos.x)
    })()
    drawSlime({
      ctx, kind: 'player', x: w.player.pos.x, y: w.player.pos.y,
      radius: w.player.radius, t, aim,
      hitFlash: w.player.hitFlash,
      hpRatio: w.player.maxHp > 0 ? w.player.hp / w.player.maxHp : 1
    })

    // Player attack-collection radius hint when stationary (subtle).
    drawCollectRing(ctx, w, upgrades.collectRadius.value)

    // Artillery markers — drawn UNDER enemies (beneath the boss) so
    // the warning indicator reads as a ground decal rather than a
    // floating UI element. Pre-impact = blinking marker, post-impact
    // = bright burst flash with a quick expanding ring.
    for (const m of w.artilleryMarkers) {
      drawArtilleryMarker(ctx, m, t)
    }

    // Enemies.
    for (const e of w.enemies) {
      const enemyAim = Math.atan2(w.player.pos.y - e.pos.y, w.player.pos.x - e.pos.x)

      // Boss telegraph aura — pulses orange/yellow during the 1s
      // artillery windup so the player reads "incoming cluster strike".
      if (e.isBoss && e.artilleryState === 'telegraph') {
        drawBossArtilleryTelegraph(ctx, e, t)
      }

      // Charging jumpers squash down + pulse a yellow telegraph ring
      // and project a directional ground stripe toward the player so
      // the lunge axis is readable a beat before it fires. Lunging
      // jumpers leave a brief streak (drawn before the slime body so
      // the trail sits behind it).
      if (e.archetype === 'jumper' && e.jumperState === 'charging') {
        drawJumperLungeAxis(ctx, e, w.player.pos.x, w.player.pos.y)
        drawJumperTelegraph(ctx, e, t)
      } else if (e.archetype === 'jumper' && e.jumperState === 'lunging') {
        drawLungeTrail(ctx, e)
      }

      // Squash multiplier for the charging slime — visually compresses
      // before the burst forward. Nothing else changes per archetype;
      // the kind already encodes the color.
      const drawRadius = (e.archetype === 'jumper' && e.jumperState === 'charging')
        ? e.radius * (0.85 + Math.sin(t * 14) * 0.04)
        : e.radius

      drawSlime({
        ctx, kind: e.kind, x: e.pos.x, y: e.pos.y,
        radius: drawRadius, t, aim: enemyAim,
        hitFlash: e.hitFlash,
        hpRatio: e.maxHp > 0 ? e.hp / e.maxHp : 1
      })

      // Burning overlay — flickering orange ring on slimes affected
      // by the player's fire DoT. Reads as plague/fire across the
      // swarm without a per-frame sprite cost.
      if (e.burning) drawBurningOverlay(ctx, e, t)
    }

    // Projectiles.
    for (const p of w.projectiles) {
      drawProjectile(ctx, p)
    }

    // Particles + damage numbers + meteor trails.
    for (const p of w.particles) {
      drawParticle(ctx, p)
    }

    ctx.restore()
  }

  // ─── Input ───────────────────────────────────────────────────────────

  const setJoystick = (dx: number, dy: number, active: boolean) => {
    const w = world.value
    w.joystick.x = dx
    w.joystick.y = dy
    w.joyActive = active
  }

  return {
    // state
    phase,
    playerHp,
    playerMaxHp,
    playerLevel,
    playerXp,
    playerXpNext,
    stageId,
    currentStage,
    stageProgress,
    stageSpawned,
    introCountdown,
    stageClearReward,
    world,
    // mutators
    setViewport,
    beginStage,
    update,
    render,
    setJoystick,
    surrender,
    acceptUpgradeChoice,
    continueAfterClear,
    continueAfterDefeat,
    upgrades
  }
}

// ─── Draw helpers (kept outside the composable) ────────────────────────

/** Cached repeat-pattern derived from the bg sprite. We keep the
 *  pattern across frames because re-creating it per-tick would
 *  needlessly thrash the GPU; we invalidate the cache when the
 *  underlying image identity changes (e.g. on hot reload). */
const ARENA_BG_IMG = '/images/bg/bg_1024x1024.webp'
let _bgPattern: CanvasPattern | null = null
let _bgPatternSource: HTMLImageElement | null = null

const drawArenaBackground = (ctx: CanvasRenderingContext2D, w: GameWorld) => {
  const sprite = getCachedImage(ARENA_BG_IMG)
  if (sprite && sprite.complete && sprite.naturalWidth > 0) {
    // Build (or refresh) the repeat-pattern. createPattern needs to be
    // called from the same context family — fine here because the
    // arena's canvas context never changes after mount, but we still
    // re-compute if the sprite identity flipped (handles HMR cleanly).
    if (_bgPatternSource !== sprite || _bgPattern === null) {
      _bgPattern = ctx.createPattern(sprite, 'repeat')
      _bgPatternSource = sprite
    }
    if (_bgPattern) {
      ctx.save()
      ctx.fillStyle = _bgPattern
      ctx.fillRect(0, 0, w.width, w.height)
      // Subtle dark vignette overlay to keep slime + bullet contrast
      // readable on top of a textured tile. 0.18 alpha is enough to
      // unify the playfield without making the bg look murky.
      ctx.fillStyle = 'rgba(13, 29, 40, 0.18)'
      ctx.fillRect(0, 0, w.width, w.height)
      ctx.restore()
      return
    }
  }
  // Procedural fallback — flat dark fill + thin grid. Used until the
  // bg sprite decodes (typically <1 frame because it's preloaded) and
  // whenever the asset is missing entirely.
  const step = w.width < 600 ? 40 : 60
  ctx.save()
  ctx.fillStyle = '#0d1d28'
  ctx.fillRect(0, 0, w.width, w.height)
  ctx.fillStyle = 'rgba(124, 217, 87, 0.025)'
  ctx.fillRect(0, 0, w.width, w.height)
  ctx.strokeStyle = 'rgba(255,255,255,0.05)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = step; x < w.width; x += step) {
    ctx.moveTo(x, 0)
    ctx.lineTo(x, w.height)
  }
  for (let y = step; y < w.height; y += step) {
    ctx.moveTo(0, y)
    ctx.lineTo(w.width, y)
  }
  ctx.stroke()
  ctx.restore()
}

const drawCollectRing = (ctx: CanvasRenderingContext2D, w: GameWorld, radius: number) => {
  ctx.save()
  ctx.strokeStyle = 'rgba(189,242,100,0.18)'
  ctx.setLineDash([4, 6])
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(w.player.pos.x, w.player.pos.y, radius, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

const drawProjectile = (ctx: CanvasRenderingContext2D, p: Projectile) => {
  ctx.save()
  ctx.translate(p.pos.x, p.pos.y)
  // The bullet sprite is north-oriented (the tip points up in the
  // source image), so rotate to (velocity-angle + 90°) so "up in the
  // sprite" maps onto "forward in flight". atan2 returns the angle
  // east-of-zero (0 = right, π/2 = down); adding π/2 turns "up" into
  // "right" and from there the math works out to forward-facing.
  ctx.rotate(Math.atan2(p.vel.y, p.vel.x) + Math.PI / 2)
  const r = p.isCrit ? 9 : p.friendly ? 7 : 6

  const sprite = getCachedImage(BULLET_IMG_PATH)
  if (sprite && sprite.complete && sprite.naturalWidth > 0) {
    const d = r * 2.2
    if (p.friendly) {
      if (p.isCrit) {
        ctx.shadowColor = '#fff394'
        ctx.shadowBlur = 8
      }
      ctx.drawImage(sprite, -d / 2, -d / 2, d, d)
    } else {
      // Hostile (enemy-fired) bullet — draw the same sprite but
      // multiply-tint it red so the player can immediately tell which
      // way damage flows. Soft red glow underlines the threat.
      ctx.shadowColor = '#ff3a3a'
      ctx.shadowBlur = 10
      ctx.drawImage(sprite, -d / 2, -d / 2, d, d)
      ctx.globalCompositeOperation = 'multiply'
      ctx.fillStyle = '#ff3a3a'
      ctx.beginPath()
      ctx.arc(0, 0, d / 2, 0, Math.PI * 2)
      ctx.fill()
    }
  } else {
    // Procedural fallback (kept for the case where the file is missing
    // or hasn't loaded yet).
    const grad = ctx.createRadialGradient(0, 0, 1, 0, 0, r)
    if (!p.friendly) {
      grad.addColorStop(0, '#ffb0b0')
      grad.addColorStop(1, '#a00000')
    } else if (p.isCrit) {
      grad.addColorStop(0, '#fffae0')
      grad.addColorStop(1, '#ff9a3a')
    } else {
      grad.addColorStop(0, '#e6ffb0')
      grad.addColorStop(1, '#3d6f00')
    }
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(0, 0, r, 0, Math.PI * 2)
    ctx.fill()
    // Trailing afterimage.
    ctx.globalAlpha = 0.4
    ctx.beginPath()
    ctx.arc(-r * 0.5, 0, r * 0.7, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/** Pulsing yellow telegraph ring around a charging jumper. Reads as
 *  "this slime is about to do something" without an explicit text cue. */
const drawJumperTelegraph = (ctx: CanvasRenderingContext2D, e: SlimeEntity, t: number) => {
  const pulse = 0.55 + Math.sin(t * 18) * 0.45
  ctx.save()
  ctx.translate(e.pos.x, e.pos.y)
  ctx.lineWidth = Math.max(2, e.radius * 0.18)
  ctx.strokeStyle = `rgba(255, 220, 80, ${0.4 + pulse * 0.4})`
  ctx.beginPath()
  ctx.arc(0, 0, e.radius * 1.25, 0, Math.PI * 2)
  ctx.stroke()
  // Outer faint ring expands as the charge progresses.
  const expansion = (1 - Math.max(0, e.abilityCooldown) / 0.75)
  ctx.strokeStyle = `rgba(255, 220, 80, ${0.25 * (1 - expansion)})`
  ctx.lineWidth = Math.max(1, e.radius * 0.1)
  ctx.beginPath()
  ctx.arc(0, 0, e.radius * (1.4 + expansion * 0.6), 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

/**
 * Boss artillery warning marker — a blinking ground decal that flags
 * an incoming cluster impact site. Pre-impact: small pulsing red dot
 * with a thin expanding ring (blink rate accelerates as ttl drops).
 * Post-impact: bright yellow-white flash + quick expanding ring.
 *
 * Image override path (drop a sprite in to replace the procedural
 * draw): `/public/images/vfx/artillery-marker_64x64.webp`.
 */
const drawArtilleryMarker = (ctx: CanvasRenderingContext2D, m: ArtilleryMarker, t: number) => {
  const sprite = getCachedImage(ARTILLERY_MARKER_IMG)
  ctx.save()
  ctx.translate(m.pos.x, m.pos.y)

  if (!m.exploded) {
    // Blink rate scales from ~3 Hz at full ttl to ~10 Hz at impact.
    const progress = 1 - m.ttl / m.maxTtl
    const blinkHz = 3 + progress * 7
    const blink = 0.5 + 0.5 * Math.sin(t * blinkHz * Math.PI * 2)
    const alpha = 0.45 + blink * 0.45

    if (sprite && sprite.complete && sprite.naturalWidth > 0) {
      const d = m.blastRadius * 1.6
      ctx.globalAlpha = alpha
      ctx.drawImage(sprite, -d / 2, -d / 2, d, d)
    } else {
      // Outer ring — danger zone footprint.
      ctx.strokeStyle = `rgba(255, 70, 70, ${alpha * 0.6})`
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(0, 0, m.blastRadius, 0, Math.PI * 2)
      ctx.stroke()
      // Inner pulsing dot.
      ctx.fillStyle = `rgba(255, 50, 50, ${alpha})`
      ctx.beginPath()
      ctx.arc(0, 0, 5 + progress * 3, 0, Math.PI * 2)
      ctx.fill()
      // Crosshair tick marks at cardinal directions for extra read.
      ctx.strokeStyle = `rgba(255, 100, 100, ${alpha * 0.7})`
      ctx.lineWidth = 1.5
      const tick = 6
      ctx.beginPath()
      ctx.moveTo(-m.blastRadius, 0); ctx.lineTo(-m.blastRadius + tick, 0)
      ctx.moveTo(m.blastRadius - tick, 0); ctx.lineTo(m.blastRadius, 0)
      ctx.moveTo(0, -m.blastRadius); ctx.lineTo(0, -m.blastRadius + tick)
      ctx.moveTo(0, m.blastRadius - tick); ctx.lineTo(0, m.blastRadius)
      ctx.stroke()
    }
  } else {
    // Post-impact flash. Single frame is fine — the particle layer
    // owns the long-tail sparks; the marker only needs to draw the
    // bright initial pop and a quick expanding ring.
    const explosionSprite = getCachedImage(ARTILLERY_IMPACT_IMG)
    const progress = 1 - m.explosionTtl / 0.4
    const radius = m.blastRadius * (0.6 + progress * 0.7)
    const alpha = 1 - progress

    if (explosionSprite && explosionSprite.complete && explosionSprite.naturalWidth > 0) {
      const d = radius * 2.4
      ctx.globalAlpha = alpha
      ctx.drawImage(explosionSprite, -d / 2, -d / 2, d, d)
    } else {
      const grad = ctx.createRadialGradient(0, 0, 4, 0, 0, radius)
      grad.addColorStop(0, `rgba(255, 255, 240, ${alpha})`)
      grad.addColorStop(0.4, `rgba(255, 200, 70, ${alpha * 0.8})`)
      grad.addColorStop(1, `rgba(180, 60, 0, 0)`)
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(0, 0, radius, 0, Math.PI * 2)
      ctx.fill()
      // Bright outline ring.
      ctx.strokeStyle = `rgba(255, 230, 130, ${alpha * 0.9})`
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(0, 0, radius * 0.95, 0, Math.PI * 2)
      ctx.stroke()
    }
  }
  ctx.restore()
}

/**
 * Boss artillery telegraph — pulsing orange aura around the boss
 * during the 1s windup. Distinct from the jumper telegraph (yellow,
 * tighter ring) so a player encountering both at once can tell them
 * apart.
 *
 * Image override path: `/public/images/vfx/boss-cast-aura_256x256.webp`.
 */
const drawBossArtilleryTelegraph = (ctx: CanvasRenderingContext2D, e: SlimeEntity, t: number) => {
  const sprite = getCachedImage(BOSS_CAST_AURA_IMG)
  ctx.save()
  ctx.translate(e.pos.x, e.pos.y)
  if (sprite && sprite.complete && sprite.naturalWidth > 0) {
    const d = e.radius * 3
    const pulse = 0.7 + 0.3 * Math.sin(t * 12)
    ctx.globalAlpha = 0.6 * pulse
    ctx.drawImage(sprite, -d / 2, -d / 2, d, d)
  } else {
    const pulse = 0.55 + 0.45 * Math.sin(t * 12)
    ctx.lineWidth = Math.max(3, e.radius * 0.16)
    ctx.strokeStyle = `rgba(255, 170, 50, ${0.55 + pulse * 0.4})`
    ctx.beginPath()
    ctx.arc(0, 0, e.radius * 1.3, 0, Math.PI * 2)
    ctx.stroke()
    // Outer expanding shock ring — fades as charge progresses so the
    // player can read "almost done" by the size of the outer halo.
    const expansion = 1 - (e.artilleryStateTimer ?? 0) / 1.0
    ctx.lineWidth = Math.max(1.5, e.radius * 0.08)
    ctx.strokeStyle = `rgba(255, 200, 80, ${0.3 * (1 - expansion)})`
    ctx.beginPath()
    ctx.arc(0, 0, e.radius * (1.5 + expansion * 0.8), 0, Math.PI * 2)
    ctx.stroke()
    // Pulsing fill for extra heat. Drawn last so the rings stay
    // readable on top.
    ctx.fillStyle = `rgba(255, 130, 30, ${0.18 * pulse})`
    ctx.beginPath()
    ctx.arc(0, 0, e.radius * 1.2, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

// ── Image-override paths for the boss artillery FX ───────────────────
//
// Drop matching files into `/public/images/vfx/` to replace the
// procedural draws above. Sprites are demand-loaded via the shared
// `getCachedImage`; until they exist, the procedural path is used
// (no console errors). Names listed alongside the implementation so
// the artist swap is a single search-and-replace away.
const ARTILLERY_MARKER_IMG = '/images/vfx/artillery-marker_64x64.webp'
const ARTILLERY_IMPACT_IMG = '/images/vfx/artillery-impact_256x256.webp'
const BOSS_CAST_AURA_IMG = '/images/vfx/boss-cast-aura_256x256.webp'

/** Ground stripe from a charging jumper toward the player — shows the
 *  predicted lunge axis so the player can side-step out of the line.
 *  Reads as a tapering yellow tongue that fades into the distance.
 *  Image override path: `/public/images/vfx/jumper-charge-stripe_256x64.webp`. */
const drawJumperLungeAxis = (
  ctx: CanvasRenderingContext2D,
  e: SlimeEntity,
  targetX: number,
  targetY: number
) => {
  const sprite = getCachedImage(JUMPER_CHARGE_STRIPE_IMG)
  const dx = targetX - e.pos.x
  const dy = targetY - e.pos.y
  const dist = Math.hypot(dx, dy) || 1
  const angle = Math.atan2(dy, dx)
  // Length: roughly the dash distance (lunge speed × lunge time).
  const stripeLen = Math.min(dist, 260)
  const stripeWidth = e.radius * 1.6
  ctx.save()
  ctx.translate(e.pos.x, e.pos.y)
  ctx.rotate(angle)
  if (sprite && sprite.complete && sprite.naturalWidth > 0) {
    ctx.globalAlpha = 0.7
    ctx.drawImage(sprite, e.radius * 0.6, -stripeWidth / 2, stripeLen, stripeWidth)
  } else {
    // Tapered triangle — wide near the slime, narrow at the predicted
    // lunge endpoint. Yellow gradient with a soft edge.
    const grad = ctx.createLinearGradient(e.radius * 0.6, 0, e.radius * 0.6 + stripeLen, 0)
    grad.addColorStop(0, 'rgba(255, 220, 80, 0.55)')
    grad.addColorStop(0.6, 'rgba(255, 180, 40, 0.3)')
    grad.addColorStop(1, 'rgba(255, 140, 0, 0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.moveTo(e.radius * 0.6, -stripeWidth / 2)
    ctx.lineTo(e.radius * 0.6 + stripeLen, -stripeWidth * 0.18)
    ctx.lineTo(e.radius * 0.6 + stripeLen, stripeWidth * 0.18)
    ctx.lineTo(e.radius * 0.6, stripeWidth / 2)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

const JUMPER_CHARGE_STRIPE_IMG = '/images/vfx/jumper-charge-stripe_256x64.webp'

/**
 * Burning overlay drawn on enemies under the player's fire DoT.
 * Image override path: `/public/images/vfx/burning-flame_64x64.webp`.
 * Procedural fallback: a flickering orange ring + a couple of upward
 * flame licks on top of the slime body.
 */
const drawBurningOverlay = (ctx: CanvasRenderingContext2D, e: SlimeEntity, t: number) => {
  const sprite = getCachedImage(BURNING_FLAME_IMG)
  ctx.save()
  ctx.translate(e.pos.x, e.pos.y)
  if (sprite && sprite.complete && sprite.naturalWidth > 0) {
    const d = e.radius * 2.2
    const flicker = 0.7 + 0.3 * Math.sin(t * 24 + e.id)
    ctx.globalAlpha = 0.55 * flicker
    ctx.drawImage(sprite, -d / 2, -d / 2, d, d)
  } else {
    const flicker = 0.55 + 0.45 * Math.sin(t * 22 + e.id)
    ctx.lineWidth = Math.max(2, e.radius * 0.12)
    ctx.strokeStyle = `rgba(255, 130, 30, ${0.55 * flicker})`
    ctx.beginPath()
    ctx.arc(0, 0, e.radius * 1.15, 0, Math.PI * 2)
    ctx.stroke()
    // Two licking flames on top of the slime — short tear-drop shapes.
    ctx.fillStyle = `rgba(255, 180, 40, ${0.6 * flicker})`
    for (let i = 0; i < 3; i++) {
      const lx = (i - 1) * e.radius * 0.45
      const ly = -e.radius * 0.85 - Math.sin(t * 16 + i) * 4
      ctx.beginPath()
      ctx.moveTo(lx, ly + 6)
      ctx.quadraticCurveTo(lx + 3, ly - 4, lx, ly - 8)
      ctx.quadraticCurveTo(lx - 3, ly - 4, lx, ly + 6)
      ctx.fill()
    }
  }
  ctx.restore()
}

const BURNING_FLAME_IMG = '/images/vfx/burning-flame_64x64.webp'

/** Brief streak behind a lunging jumper for motion-blur readability. */
const drawLungeTrail = (ctx: CanvasRenderingContext2D, e: SlimeEntity) => {
  const speed = Math.hypot(e.vel.x, e.vel.y)
  if (speed < 1) return
  const ux = -e.vel.x / speed
  const uy = -e.vel.y / speed
  ctx.save()
  for (let i = 1; i <= 3; i++) {
    const back = i * 0.06
    const a = 0.22 - i * 0.05
    ctx.fillStyle = `rgba(255, 80, 80, ${a})`
    ctx.beginPath()
    ctx.arc(e.pos.x + ux * speed * back, e.pos.y + uy * speed * back, e.radius * (1 - i * 0.18), 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

const drawParticle = (ctx: CanvasRenderingContext2D, p: Particle) => {
  const alpha = Math.max(0, p.ttl / p.maxTtl)
  ctx.save()
  ctx.globalAlpha = alpha
  if (p.kind === 'damage' && p.text) {
    ctx.font = `bold ${p.size}px Angry, sans-serif`
    ctx.fillStyle = p.color
    ctx.strokeStyle = '#000'
    ctx.lineWidth = 3
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.strokeText(p.text, p.pos.x, p.pos.y)
    ctx.fillText(p.text, p.pos.x, p.pos.y)
  } else if (p.kind === 'meteor') {
    ctx.fillStyle = p.color
    ctx.beginPath()
    ctx.arc(p.pos.x, p.pos.y, p.size, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = alpha * 0.6
    ctx.beginPath()
    ctx.arc(p.pos.x - p.vel.x * 0.04, p.pos.y - p.vel.y * 0.04, p.size * 0.8, 0, Math.PI * 2)
    ctx.fill()
  } else if (p.kind === 'shockwave') {
    ctx.strokeStyle = p.color
    ctx.lineWidth = 4
    const r = (1 - alpha) * 70
    ctx.beginPath()
    ctx.arc(p.pos.x, p.pos.y, r, 0, Math.PI * 2)
    ctx.stroke()
  } else {
    ctx.fillStyle = p.color
    ctx.beginPath()
    ctx.arc(p.pos.x, p.pos.y, p.size, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

export default useSlimeGame
