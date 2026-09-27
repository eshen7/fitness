# AGENTS.md

Guidance for agents working in this repository.
`CLAUDE.md` imports this file; edit this one.

## Project

A single-user app for the owner's own vertical jump, athleticism, and upper body training: nutrition, an exercise directory, AI-generated workouts, and progress tracking.
The domain reference below, distilled from `thp.pdf` (THP Jump Training Ebook, thpstrength.com), is the specification the data model and the rule engine encode.
The build plan lives at `~/.claude/plans/splendid-munching-map.md`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on `:3000` |
| `npm run build` | Production build, includes a type check |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest over `lib/**/*.test.ts` |
| `npm run db:generate` | Emit a migration from the schema |
| `npm run db:migrate` | Apply migrations, and create the `vector` extension |
| `npm run db:seed` | Idempotent seed |
| `npm run db:seed:history -- --replace` | Replace training history with a deterministic twenty-week dev fixture (destructive, local only) |
| `npm run passcode` | Print a fresh `PASSCODE_HASH` and `SESSION_SECRET` |
| `npm run bench:generation -- --runs 50 --budget 1` | Measure the generation exit criteria against the live model (needs `OPENAI_API_KEY`, spends real money, writes only its spend to `spend_ledger`) |

`npm run lint` and `npm run typecheck` are expected clean at every phase boundary, not deferred.

The `ci` job in `.github/workflows/ci.yml` runs lint, typecheck, test and build on every pull request and on pushes to `main`, on the Node version pinned in `.nvmrc`.
It supplies placeholder values for the variables `lib/env.ts` requires and starts no database, so a test or a build that needs real infrastructure has to bring its own service container.

## Stack and layout

Next.js 16 App Router with Turbopack, TypeScript, Tailwind v4, Drizzle over Postgres via postgres.js, installable as a PWA, deployed to Vercel and Neon.
Local Postgres is 17 with pgvector 0.8.6, matching Neon.

```
app/(auth)/unlock/   passcode gate
app/(app)/           today, log, progress, nutrition, plan, library
app/api/             health, generation, set logging, WHOOP, nutrition parsing, insights, reflection
lib/db/schema/       one file per domain area
lib/whoop/           OAuth, signed webhook, ingest, and projection into readiness
lib/engine/          prefilter, normalize, gate (validate.ts), advisories (pure TS, no LLM)
lib/ai/              OpenAI client and seam, prompts, schemas, cached context, spend meter
lib/nutrition/       food parse resolution and caches, targets, weight trend
lib/analytics/       trend math and derived insights (pure functions)
lib/memory/          remembered facts, embeddings, post-session reflection
```

## Conventions that are easy to get wrong

- **`proxy.ts`, not `middleware.ts`.** Next 16 deprecated the middleware convention. API routes behind the gate return `401 {"error":"locked"}` rather than a redirect, so the offline queue can distinguish being locked out from being offline.
- **`getDb()`, never a module-scope `db`.** Next imports every route module while collecting build output, so a connection opened at import time turns a missing build-time secret into a failed build.
- **No `$` in any env value.** Dotenv expands `$VAR` inside values. That is why the passcode hash is scrypt encoded as `scrypt:N:r:p:salt:key` rather than bcrypt, whose `$2b$...` form silently collapses to an empty string.
- **Icons live in `public/icons/`,** not via the `app/icon.*` convention, because the proxy matcher excludes that directory and an icon behind the gate is one the OS cannot fetch.
- **The generator never invents an exercise.** The directory is a closed set; unavailable entries are filtered out before the prompt is built, and the model files a suggested addition instead.
- **Tendon safety is enforced by construction, not by validation.** A site in protocol phase 1 or 2 removes every exercise loading it from the candidate set, so the rule cannot be violated rather than merely being checked.
  The one exemption is the protocol's own prescriptions: `exercises.protocol_phase` tags them, and a site in phase p keeps an exercise tagged p or lower.
  Tag by hand rather than deriving from attributes, because a slow heavy calf raise and a standing calf raise look identical.
- **Equipment is `equipment` all together plus one of `equipment_any_of`.** `none` is always satisfied, and an empty available list means bodyweight only.
- **Every rule message is pinned.** `lib/engine/fixtures/invalid.ts` holds one invalid plan per rule with its exact messages, checked against the stock seed, so rewording a message or re-tagging a stock exercise means updating the fixture in the same change.
- **`export const dynamic = "force-dynamic"` in `app/(app)/layout.tsx` covers the whole segment.** Without it every database-backed page prerenders at build time and production serves a snapshot of whatever the database held during the build, which looks like a working app right up to the moment it stops updating.
- **Numerics cross the driver as strings.** Convert at every boundary: `.toFixed(n)` on the way in, `Number()` on the way out. Selecting a column that does not exist is worse than a type error - drizzle treats the `undefined` field as a nested object and throws `Cannot convert undefined or null to object` from inside `orderSelectedFields`.
- **A timestamp becomes a day through `dayOf`, never `toISOString().slice(0, 10)`.** Vercel's clock is UTC and a training day is the owner's, so the shortcut labels anything written after 8pm eastern with tomorrow's date - on the screen of the person who was there when it happened. `lib/time.ts` reads `APP_TIMEZONE`, which makes any module using it server-only.
- **The WHOOP signature is over the raw bytes.** Read `request.text()` before parsing; re-serializing parsed JSON changes the bytes and every delivery then fails verification.
- **A WHOOP refresh rotates both tokens.** The old access token dies with the old refresh token, so the pair is one row written in one statement; a partial write silently kills the connection and the only repair is re-authorizing. `scope=offline` must be sent on the refresh too.
- **A v2 recovery event names its *sleep*, not its cycle.** Recovery rows are keyed by `sleep_id` and dated from the stored sleep, so a recovery arriving before its sleep is deferred rather than guessed at.
- **The nightly sync in `vercel.json` runs at 09:20 UTC** (about 05:20 ET): late enough that WHOOP has scored the night, early enough to be there before a morning check-in. The insight recompute at 09:40 must stay after it, so the night just scored is in what the suite reads. JSON cannot hold that comment, which is why it is here.
- **Every rule in `app/globals.css` belongs inside a cascade layer.** Tailwind v4 ships its utilities in `@layer utilities`, and unlayered CSS beats every layered rule regardless of specificity. An element default written at the top level therefore silently defeats the utility for it everywhere: a bare `:where(svg) { height: auto }` cost an afternoon by making every chart render at its viewBox aspect ratio instead of `h-full`. Element defaults go in `@layer base`, class rules a utility should be able to override go in `@layer components`.
- **A percentage height needs a parent with a definite one.** The chart primitives position every mark as a percentage, so a wrapper sized only by its contents collapses its children to nothing rather than erroring. `Columns` is `inset-y-0` with the bar bottom-aligned inside it for exactly this reason.
- **A `w-*` handed to `Input`, `Select` or `Textarea` is a coin toss.** `FIELD` in `components/ui.tsx` already carries `w-full`, and two utilities of equal specificity are resolved by their order in the generated stylesheet rather than by the order of the `className` string. Size the wrapper, or let the field flex and mark its siblings `shrink-0`.
- **`border-line` is decoration, `border-line-strong` is a control.** WCAG 1.4.11 asks 3:1 of any boundary a person has to find in order to use it, and `--color-line` sits below that on purpose so a divider inside a card does not shout. Picking the quieter token for the edge of an input, a select, a tab or a toggle fails the check while looking perfectly deliberate on screen, which is why the distinction is in the token name rather than left to judgement. The same reasoning sizes touch targets with `min-w-11`/`min-h-11` plus a negative margin: 44px of hit area without 44px of row height.
- **The export names every column once, in `archiveRow`.** Drizzle hands a selected row back under its camelCase property while the database, the CSV header and every migration say `load_kg`, so `lib/export/archive.ts` renames on the way out and both the JSON archive and the CSV are written from the same `ExportColumn.name`. Read a row anywhere else and the two exports drift apart silently, each internally consistent. The table list is derived from the schema for the same reason - a table added later leaves with the archive instead of being quietly dropped - and `/offline` has to stay in `PUBLIC_PATHS` in `proxy.ts`, because a fallback page behind the gate is one the service worker cannot serve when there is nothing to authenticate against.
- **`.tnum` carries `white-space: nowrap`,** not just tabular figures. It is right on a readout that must never reflow and wrong on a sentence: on a paragraph it produces one long line that runs off the side of the card instead of wrapping, with no overflow anywhere to make it visible. Put `tnum` on the figure spans and leave the paragraph unstyled; a detail line built from `A · B · C` then breaks only at the separators.
- **The cap and the key are checked in `lib/ai/guards.ts`,** shared by generation and food parsing (the bench checks the same total itself), because `SPEND_CAP_USD` is one ceiling over the whole account rather than one per feature. It is a separate module because a `"use server"` file may only export async functions.
- **The model never sees the clock in the cached half of the prompt.** `lib/ai/context.ts` splits the request into a stable prefix, ordered first, and a volatile suffix; today's date, tendon state and readiness live in the suffix. Moving anything that changes daily into the prefix drops the cache hit rate to zero and multiplies the input cost by ten, silently.
- **The generator is reached through a seam, never the SDK directly.** `getAiClient()` in `lib/ai/client.ts` returns the override `setAiClient` installed or the real OpenAI client, so `lib/ai/generate.test.ts` drives the whole pipeline - repairs, refusals, truncation, the fallback - with no key and no database. The key is read from the environment at call time and belongs in no file in this repository.
- **Every live call goes on the meter.** `SpendMeter` in `lib/ai/pricing.ts` prices usage against `MODEL_PRICES`, an unknown model is charged at the dearest rate in the table rather than the cheapest, and `SPEND_CAP_USD` is the owner's hard ceiling. `totalSpendUsd` sums proposal rows and `spend_ledger`, which holds spend with no proposal behind it: bench runs and generations that died in transport as a `BilledFailure`. `npm run bench:generation` refuses a generation it cannot afford twice over: against its own `--budget` and against everything already spent.

## Domain reference: jump training

Five pillars: strength training, plyometrics, periodization, managing tendon pain, jump technique.
Any data model or programming logic should map back to them.

Two framing facts that constrain app design:

- Vertical jump is expected to **drop** during hard training blocks; planned back-off produces supercompensation. A tracker that treats every downward data point as failure contradicts the model.
- Each biomotor capacity has its own fatigue/supercompensation curve, so fatigue cannot be modeled as a single number.

### Training principles that change decisions

- **Overload.** Adaptation requires load above the habitual level, via more intensity/volume or via a change of exercise.
- **Accommodation.** A constant stimulus decays in effect, so programs must vary.
- **Specificity.** The closer the stimulus to jumping, the more it transfers.
- **Individualization.** Defaults should be conservative and per-athlete tunable.

Load types: **stimulating** (drives adaptation), **retaining** (maintenance), **detraining** (performance drops).
More advanced athletes detrain more easily and need higher loads just to maintain.

**Relative strength is what matters for jumping**, not absolute strength; correct weight management can raise it.
Compound movements transfer better because jumping is intermuscularly complex.
Transfer is asymmetric: max strength helps power, power does not help max strength.

**Explosive strength deficit.** Time to peak force is 0.3-0.4 s isometrically, but takeoffs finish far sooner, so some strength potential always goes unused.

| Motion | Time (s) |
| --- | --- |
| Sprint takeoff | 0.08-0.10 |
| Long jump takeoff | 0.11-0.12 |
| High jump takeoff | 0.17-0.18 |

Improve it two ways: raise max force (best for novices), or raise rate of force development (matters more as you advance).
Deeper positions demand more torque, and longer limbs demand more torque for the same force; more torque applied means a higher jump.

### Plyometrics

The stretch shortening cycle is an eccentric phase followed immediately by a concentric phase, which raises force and power output while lowering energy cost.
It works through an isometric transition that dodges the velocity penalty, extra time for force development, elastic energy stored mostly in the tendon in trained athletes, the stretch reflex, and progressive inhibition of the Golgi tendon reflex so high landing forces can be tolerated.

Practical consequences:

- High jump-rep volume is crucial.
- Beginners improve the SSC through weight training alone; advanced athletes need very specific plyos.
- Plyos self-intensify as you improve, so years of progress on jumping alone is possible.
- Plyos are the hardest part to get right and can make some athletes jump *lower*. Use conservative defaults.

**Overload variables.** Resistive (drop height, incline, external load), spatial (much wider or much shorter range of motion, standstill instead of approach, plane of motion), temporal (more intent and speed, more impulse).

**Coupling time.** Short SSC under 250 ms, long SSC over 250 ms.
Above 0.15 s on high-impact high-RFD drills it is no longer shock-method plyometrics.

**Dosage.** Reps 8-12; sets 3-6 (Russian guidance) up to 6-10 (Eastern European).
Rest 1-2 min for typical SSC work, 30-60 s for low intensity, 2-3 min for shock work.
Frequency 2-3 days per week, inverse to intensity.
Order dynamic and intense work first.
Complex training pairs a strength exercise with a plyo of similar movement pattern.

**Response types.** Single response (one intense effort), multi response (successive efforts, emphasizing elasticity and coordination), and multi response with pauses.
Both single and multi response are needed.

**Intensity** is force at impact plus intent.
Rate of stretch matters more than magnitude, and only well-executed reps count toward adaptation.

**Jump types.** Squat jump (static start), countermovement jump, depth/drop jump, bounds (leg to leg), hopping (same leg), leaps, skips, ricochet.

**Choosing depth jump height.** Test standing vertical, start from a low box, raise progressively until measured vertical drops below the standing jump, then work at the height where depth jump matches standing jump.

### Periodization

**Units.** Session, day, microcycle (~1 week), mesocycle (~4 weeks, range 2-6), macrocycle (one season).
Mesocycle types: **accumulative** (build potential), **transmutative** (convert general fitness to specific), **realizational** (peak).
Transmutation plus realization is **tapering**.

**Number of targets.** Gains drop when several abilities are trained at once.
Optimum is 1-2 motor abilities per mesocycle plus one technical feature, with 70-80% of mesocycle work on those targets (35-40% each).
Never more than 2-3 main targets per microcycle or mesocycle.
Sequencing targets across mesocycles beats training them together.

**Fatigue specificity.** Fatigue is specific to the type of muscular work, so an athlete too tired to repeat one drill can still do another well.
Sequence drills to allow more total work; two similar sessions back to back superpose their fatigue.

**Session design.** Do as much work as possible while staying as fresh as possible.

- Highest-value, most coordination-demanding, highest-intensity work first while rested.
- Main sport exercises before assistance; dynamic-power before slow; large muscle groups before small.
- Rest 4-5 min with large weights. The most intense THP sessions run about 20 sets.

**Microcycle rules.**

- Vary **load**, not the exercise complex, within a micro- or mesocycle.
- One stable complex of about ten exercises runs through a mesocycle, each exercise at least twice per week.
- **Rule of 60%:** the lightest day's volume should be 60% of the heaviest day's.
- Back-to-back sessions should not train the same muscle groups or repeat the same coordination patterns.
- Smaller muscles recover faster and can be trained more often.
- To increase strength, heavy resistance training at least 3x per week; to retain it, 2 sessions of ~30 min per week.

**Medium term.** Adaptation is realized when a retaining or detraining load follows a stimulating load, and that easy period lengthens as accumulated fatigue grows.
Residuals persist after training stops, and the longer an adaptation took to build the longer it takes to lose.
Across a macrocycle, exercises get progressively more specific and methods progress from submaximal effort toward maximal effort.
Expect a performance dip right after changing exercises, then improvement.
In season, hold strength with two 30-40 min heavy sessions per week.

**Periodization types.** Sequential (one goal at a time), concurrent (all goals at once, optionally with one emphasized), conjugate sequence (all goals with rotating emphasis).
Long means goals change week to week; short means session to session.
Linear runs high volume to high intensity; undulating waves volume and intensity inversely within the cycle.

### Jump technique

Two variables dominate both one and two foot jumps.

- **How low you are** at touchdown of the plant foot, meaning knee and hip bend.
- **How fast you are**, both center-of-mass velocity and stride *frequency* (rhythm) into takeoff.

Being low lengthens the time to generate force, which is impulse, but too low buckles the leg.
*When* you lower matters as much: lowering late creates high negative vertical velocity that costs energy to arrest.
**Rule of thumb: get low 2-3 steps before takeoff and hold that position.**
Low and fast only pays off if you are strong enough to convert horizontal momentum vertically.

#### Two foot jump

**Approach.** Maximum horizontal speed plus a lowered center of gravity.
Maintain or accelerate throughout; the worst error is slowing mid-approach, and the most common error is not lowering enough during the lead-up steps.
Rhythm starts slow and builds.
A slight curve is recommended because it lowers you more than a straight approach.
More elastic athletes handle more approach speed.

**Penultimate step** largely determines the jump; it is where the center of mass is lowest and horizontal velocity highest.

- Contact slightly in front of the hips: too far under causes falling forward, too far in front brakes excessively.
- After contact the knee rolls forward and down, holding the low position into the plant. Long and fluid, not rushed and jerky.
- As the penultimate foot leaves the ground, kick the plant leg out relatively straight, knee first then extending, foot rotated slightly outward.
- Do not chase stride length; it follows from being low and fast.

**Arm swing.** Arms start forward and up as the block foot moves forward; the block foot lands as the hands pass just in front of the hips.
Cue: strike the ground when the arms feel heaviest.
**Pendulum** swing (hands clap forward, then swing back with the penultimate step) maximizes vertical contribution but interrupts horizontal momentum.
**Circular** swing mirrors running, opposite hand to opposite knee, and carries more horizontal momentum in.

**Plant foot.** The aggressive outward kick that brakes horizontal momentum.
Aim for a **long split** between penultimate toe-off and plant touchdown.
Keep the torso vertical during the flight phase to avoid rotating forward.
A more acute shin angle gives more braking, so lift the knee and kick the foot up and outward; it should feel like throwing yourself into the plant foot.
Slight external rotation plus inward movement recruits the lateral hip and creates the **whip and flail**: a straight plant leg rotates the pelvis back and up, which drives the block leg into the floor.

**Block foot.** The final contact, acting like a whip moving with the arms, forward and down.
Faster approach means contact farther in front.
Turn the foot toward the midline and slide it into the ground rather than setting it down, like sliding into a flip flop.
If the pelvis does not rotate forward, you are not planting across the body enough, running too slow, or bending the plant leg early.

**Takeoff.** Almost everything is already determined.
Actively extend hip, knee, and ankle through the whole jump, and drive the arms as high as possible.
Once airborne the trajectory is fixed.

#### One foot jump

Propulsion is mostly **dynamic leg strength**: force over very short ranges during an SSC.
A third variable joins low and fast: **synchronization**, turning muscles on and off in the right order and amount.

**Approach.** Dunkers get roughly 3-5 steps total, versus a high jumper's long run-up, so momentum must build fast.
Lower via a slight inward-leaning curve and slight bend at hip, knee, ankle during the final steps, then hold that position until the takeoff leg strikes.
Cadence accelerates from the first step through takeoff.
Chasing raw speed makes athletes default to sprint mechanics and lose the low position.
Rhythm, meaning stride frequency, may be the single greatest determinant of success and is learned by practice.

**Penultimate step.** The most important step; prior energy is either preserved or dissipated here.

- Maintain the low position or push slightly upward; do not keep lowering, and do not jump into this step.
- Minimize braking: roll the foot with the shin relatively vertical at touchdown.
- The knee moves down and rolls toward the ground; from mid support to toe off, push through the ground with hips forward and shoulders back.
- It should feel like a low walking lunge with shoulders tall or back.
- The takeoff leg sweeps forward low to the ground.

**Arm swing** must match the leg action in amplitude and velocity; mismatched pairs jump lower.
**Running action** (arms opposing legs) creates a fast takeoff with short ground contact, suiting speed jumping.
**Pendulum** swing is slower but the strongest for vertical lift and is used by most power jumpers, at the cost of braking during the penultimate step.
At deepest knee flexion the knees stack and the hands sit just in front of the drive knee.

**Speed versus power jumping** is set by the free leg during knee drive, not by run-up speed.
Foot low with a large moment of inertia is the stronger drive for vertical lift; foot recovering toward the butt is faster and better for high jump.
Both work.
For an experienced jumper the strategy is already set, and forcing a switch is not advised; experiment on the other leg instead.
Drive the knee in unison with the arms and do not overemphasize knee drive height.

**Takeoff leg.** Toe off with torso upright, hips forward, arms back, then plant in front of and slightly across the body, leaning slightly in and back, landing on the side of the foot or outside of the heel.
Farther in front means more braking.
Speed jumpers cue the punchiest possible takeoff; power jumpers cue a smooth long draw on the ground.
Find the cue by trial and error using jump height as the guide.
**Do not focus on how much to bend the knee** - it slows takeoff and disrupts coordination. Knee bend follows from strength, tendon properties, and skill.

**Alignment.** A straight line from takeoff heel through the same-side shoulder is the goal, but pursue it indirectly: a fast rolling penultimate step reaching peak hip extension, with shoulders staying tall or slightly back.
Shoulders forward is fine during lead-in steps, but as you roll through the penultimate step the shoulders must move behind the hips.

### Managing tendon pain

Tendons are biological springs, **viscoelastic** and governed by Force = kx, so stiffness depends on how much load is applied and how fast.
Healthy tendons do not tear.
Load is set by reps, speed, and joint angle, so more explosive athletes get more tendon issues.
Sprinting loads a leg up to 6x bodyweight; one-foot jumping up to 14x.

**Pain continuum** (Cook): normal tendon, reactive tendinopathy (short-term overload spike), disrepair (reversible structural change), degenerative (permanent cell death, but strong tendon can still be built around it).
**Structure does not equal pain.**
Track function and pain, never imply structural damage.

**What does not work:** stretching the tendon, anti-inflammatories, random eccentrics, icing.
Most tendon issues are not inflammatory.

**What works** is load management: reduce pain, progressively rebuild capacity, then reintroduce sprinting and jumping slowly.
The goal is function, not structure.

| Phase | What it is | Prescription |
| --- | --- | --- |
| 1. Isometric loading | Load without changing muscle length | 5 x 45 s at 70% max voluntary contraction, 3x/day, every 6 hours |
| 2. Slow heavy strength | Slow eccentric and concentric | 3-4 x 6-8 reps, 4 s down and 4 s up, every other day |
| 3. Energy storage | Depth landings, low heights progressing higher | 4 x 6-8 drops |
| 4. Storage and release | Standing, box, short and long approach jumps | ~20 jumps per session, intensity before duration |

Phase 1 isometrics are analgesic for up to 90 minutes and restore activation patterns inhibited by pain, loading the tendon while avoiding speed and length.
Phase 2 raises tendon stiffness and capacity; add 5-20 lb per session.
Phase 3 trains rapid force absorption and is where enough capacity to play sports develops.
Phase 4 restores storage and release together.

## Source

`thp.pdf`, "THP Jump Training Ebook" (69 pages), thpstrength.com.
Promotional inserts and the discount code are omitted.
Prescriptions are general-population guidance from one coaching methodology, not individualized medical advice.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
