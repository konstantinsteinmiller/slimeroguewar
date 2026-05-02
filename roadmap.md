# Slime Rogue War — Engagement & Conversion Roadmap

A living checklist of features that move the dials we actually care about:
**D1 retention, average session length, easy-to-pickup-hard-to-put-down feel,
and conversion of new players into committed ones**. Every entry has the
problem it solves, the implementation hook it should plug into, and the
sniff-test metric that proves it worked.

> Sequence is loosely ordered by ROI per dev-day; ship the cheap, high-leverage
> items first, and keep the heavy systems (multi-weapon, classes, leagues)
> behind a flag until the smaller hooks have actually moved the metric.

---

## 1. Sticky-progress reward chain on session start (D1)

**Problem.** Every fresh app open lands the player on the same dead arena
view — there's no "thing happened while you were gone" signal pulling them
toward a battle.

**Implementation.** On boot, check `Date.now() - lastSessionEndAt` and
animate a chained reward popover: daily bonus → idle slime-drop pile (capped
at ~10 mins of stage 1 yield) → "Your slimes ate the gold while you were
gone" tap-to-collect. Persist `lastSessionEndAt` in `pagehide` (already
hooked in `main.ts` for SaveManager).

**Metric.** D1 retention ↑3-6%; "first action after session start = battle"
share ↑.

---

## 2. Run-streak counter + multiplier (D1, session length)

**Problem.** Players who lose stage 7 in a row currently get nothing extra
for grinding it down. Streak feedback gives them a reason to stay.

**Implementation.** Add `winStreak` to localStorage. After each stage clear
+1; after a death, reset. Multiplier on slime-drop yield:
`1 + min(streak * 0.05, 0.5)` — capped 50%. Show a flame icon next to
the StageBadge that grows with streak; pulses red on the 5th, 10th, 20th.

**Metric.** Average run length ↑ (number of consecutive battle starts in
one session); D1 ↑1-3%.

---

## 3. "Comeback" rescue (forgiveness loop)

**Problem.** A death erases the run; first-time players who die in stage 4-5
churn before ever buying an upgrade.

**Implementation.** On death, show a `Continue?` modal with two CTAs:
- "Watch ad" → revives at 50% HP at the player position, enemies pushed back
- "Spend N drops" → same revive, cost `15 + currentStage * 5`

Track lifetime revives, gate the offer to once per stage to avoid grind-revive
abuse. Hooks: `phase === 'gameover'` in `useSlimeGame`, intercept before the
FReward fires.

**Metric.** D1 ↑5-10%; ad-impression / DAU ↑.

---

## 4. Daily challenge stage (session frequency)

**Problem.** Replaying the same campaign stages all day caps fun. A
once-a-day reason to come back is the cheapest re-engagement hook in the
genre.

**Implementation.** A second route `/daily` that loads a procedurally
seeded stage (seed = YYYYMMDD). Single attempt per day, fixed loadout
(no shop upgrades), leaderboard scope = all players (faked from a server
or `useLeaderboard.ts` ghosts). Top reward: 5x normal yield + cosmetic.

**Metric.** Day-2 / Day-7 return ↑; reduce session-gap from 3+ days to ≤1.

---

## 5. Random run modifiers ("Slime of the Day")

**Problem.** The 4th run of stage 12 is identical to the 1st, regardless
of upgrades. Procedural variety per-run keeps every fight novel.

**Implementation.** A pool of 20 modifiers (e.g., "Bouncy Walls",
"Slow-Mo Crits", "Sticky Drops", "Tiny Slimes Spawn Twins"). Roll one
per battle and surface it during the 3-2-1 intro overlay. Modifiers
are pure flags consumed by `useSlimeGame.update`.

**Metric.** Average runs / session ↑; "screenshot of a wild moment"
shareability ↑ (drives organic discovery).

---

## 6. Weapon variety (3-5 starter weapons)

**Problem.** "Auto-aim, single bullet" is fun for ~2 hours. After the
first arc, players want a second toy.

**Implementation.** Refactor the projectile path in `useSlimeGame.ts`
into a `WeaponStrategy` interface; keep "Splat Pistol" as the default.
Ship 4 more (Spread, Bouncing, Piercing, Aura), unlock through the
campaign or via an in-shop purchase. Each weapon owns its own visual
+ sound.

**Metric.** Average run length and stage-clear count ↑; D1 ↑ on first
post-launch update (anchor for "new content!" push).

---

## 7. In-battle ammo/cooldown crystal pickups

**Problem.** Mid-battle pacing is flat — drops fly to the player but
nothing else happens between kills. Tactical pickups give a reason to
move toward something other than the nearest enemy.

**Implementation.** Three short-window pickups dropped by ~10% of
non-boss kills:
- Frost orb (slows nearby enemies 60% for 5s)
- Fury orb (+200% fire rate for 4s)
- Heal orb (restores 25% max HP)

Render as small bobbing icons; player picks them up on touch (no auto-
collect). Hooks: `world.particles` + a new `world.pickups` array.

**Metric.** Session length ↑; "skill-based escape" stories on Discord ↑.

---

## 8. End-of-stage choice (push or cash out)

**Problem.** Stage clears feel automatic — "tap to continue" is the only
choice. A real decision creates the gambling-loop feel that VS-likes
thrive on.

**Implementation.** On stage clear, FReward shows two CTAs:
- "Push Deeper" — next stage immediately, +25% yield bonus this session
- "Cash Out" — return to off-battle HUD, full drop yield banked

Compounds with the streak multiplier (#2). Hook: replace the single
`continueAfterClear` button with a 2-button row in `SlimeArena.vue`.

**Metric.** Average stage depth per session ↑15-30%.

---

## 9. Slime classes / starter deck (commitment device)

**Problem.** The player has no in-game identity until they've grinded
upgrades. A class pick at session start gives a "this is my run" feel
day-1.

**Implementation.** 3 starter slimes — Tank (more HP, slower), Hunter
(crit-focused), Mage (faster fire rate, lower HP). Each is a preset of
upgrade levels + a unique passive (e.g. Tank: 10% damage reflect).
Show class picker on first launch and on every "New Run" reset.

**Metric.** First-session retention ↑; Discord persona-art shares ↑.

---

## 10. Visible "next reward" gates on the campaign track

**Problem.** Players don't know there's a boss in 3 stages, so they
quit to grind a different game's progression bar. Surface the rewards.

**Implementation.** Above the stage badge, a horizontal mini-track of
the next 5 stages with thumbnails — boss icon at stage 5/10/15,
weapon-unlock icon at the right stage, etc. Reuse the BattlePass scroll
strip pattern. Tap → preview modal.

**Metric.** Stop-after-stage-2 churn ↓; "another one" mentality ↑.

---

## 11. Cosmetic skin shop (conversion)

**Problem.** Slime drops have nothing to spend on past upgrade Lv 20.
Cosmetics are evergreen sinks and the genre's primary IAP driver.

**Implementation.** A "Slime Wardrobe" modal accessible from the
off-battle HUD. 20-30 skins on launch — purchasable with drops or
premium currency (added at the same time, see #12). Reuse the chaos-arena
`useModels` infrastructure, but point sprite paths to slime artwork
(player can drop into `/public/images/models/slimes/<id>.webp`).

**Metric.** ARPDAU ↑ once #12 ships; drop-sink elasticity makes
deep-game farmers comfortable spending in the upgrade shop too.

---

## 12. Premium currency ("Royal Goo") with one IAP entry

**Problem.** Without a premium currency, the only monetization is ads
and the only ad is the rewarded video. Conversion to paying users is
~0.

**Implementation.** Single non-consumable IAP: "Slime Pack — 500 Goo,
remove banner ads, +1 daily challenge attempt". Keep IAPs minimal day-1;
the platform-specific store hooks for CrazyGames/itch/etc. already exist
as dev-stubs in `src/platforms/`.

**Metric.** ARPPU baseline. Even 0.5% conversion at $4.99 swings the
unit economics.

---

## 13. Push-style notifications via web push / native (re-engagement)

**Problem.** Outside the tab, players forget the game exists. Web push
on web builds + Tauri notifications on native lets us nudge.

**Implementation.** Service worker registration on Web; permission
prompt deferred until after the player wins their first 3 stages
(post-victory CTAs convert way better than first-page prompts). One
push/day max — "Your daily challenge is ready" or "Treasure chest is
full".

**Metric.** Day-3/7 retention ↑; "session per day" ↑.

---

## 14. Friend code / async ghost runs

**Problem.** No social loop = no organic growth, no comeback hook.

**Implementation.** Each player gets a 6-char friend code. Sharing it
seeds a "ghost run" of your best stage — friends fight that ghost as a
non-blocking parallel slime in their next stage. Saved to localStorage,
synced via the existing PeerJS infra in `usePVP.ts` if/when we want
real multiplayer back. Reward both sides on a beat-the-ghost win.

**Metric.** K-factor (invites sent / DAU); D7 retention ↑.

---

## 15. "Almost died!" celebration moments

**Problem.** Wins feel mechanical. A small dose of drama on near-death
runs makes them memorable.

**Implementation.** When the player kills the last enemy of a stage with
≤10% HP, fire a slow-mo (0.6× game speed) for 1.5s + a screen flash
+ "CLUTCH!" text. Track this in `useSlimeGame` and emit a cleared event
flag the FReward overlay reads.

**Metric.** Hard-to-quantify, but plays into "screenshot moments" and
voluntary retries.

---

## 16. Auto-save run + "Resume Battle" on relaunch

**Problem.** Mobile players close the tab mid-stage and lose their
progress. The game already saves drops/upgrades but not the in-flight
battle.

**Implementation.** Snapshot `world` (positions, HP, kill counter) every
5 seconds during battle to a memory-only key, flushed via the existing
`pagehide` SaveManager hook. On boot, if a snapshot exists and is
younger than 30 minutes, show a "Resume Battle" CTA before the off-battle
HUD.

**Metric.** D1 retention ↑ for mobile sessions; less rage-quit churn.

---

## 17. Achievement / mastery system

**Problem.** Players who max all upgrades plateau. Achievements give
them new objectives without us building new content.

**Implementation.** 30 achievements on launch — "Win without taking
damage", "Kill 1000 slimes", "Crit a boss to death", "Reach stage 25".
Reuse battle-pass-style claim button pattern. Awards drops + a profile
flair (visible on leaderboard ghosts).

**Metric.** Average session length ↑ for level-30+ players; reduces
content-cliff churn.

---

## 18. Telemetry and event funnel

**Problem.** None of the above can be tuned without data. Right now
we ship blind.

**Implementation.** A tiny `track(event, payload)` helper that batches
events to `/tmp/track.json` (PostHog/Mixpanel/own beacon, configurable).
Top 20 events to ship: session_start, stage_start, stage_clear,
stage_died, level_up, upgrade_purchased, ad_shown, ad_dismissed,
roulette_spun, daily_collected, treasure_collected, run_streak_X,
revive_offered, revive_accepted, modifier_seen, weapon_unlocked,
classes_picked, friend_invited, achievement_claimed, iap_attempted.

**Metric.** Without it the rest of this list is intuition; with it,
every change gets an A/B before-and-after.

---

## Already-shipped baselines (sanity check)

These are running today; future tweaks should *not* regress them:

- Rookie tier (stages 1-4) is short, slow, and forgiving (`tests/slime/campaign.test.ts`).
- First upgrade costs 25 drops; reaching upgrade Lv 5 costs exactly 375 drops (`tests/slime/upgrades.test.ts`).
- Drops collected during a stage persist immediately (`tests/slime/drops.test.ts`).
- Auto-aim picks the nearest live enemy each fire tick (`useSlimeGame.nearestEnemy`).
- Stage progress bar fills with `enemiesKilled / stage.enemyCount`; bossing every 5th stage.
- 3-2-1-GO + meteor shower intro plays at every stage start; battle music auto-fades in/out.
- All HUD elements respect `env(safe-area-inset-*)` and don't paint under the iPhone notch.
