/**
 * The phase 5 exit criteria, measured against the live model.
 *
 * Three numbers decide whether the generator is good enough to ship, and none of
 * them can be faked: the share of generations the gate accepts on the first
 * attempt, the distribution of repair attempts behind that, and whether the
 * provider is actually reading the stable prefix back out of its cache. This
 * script measures all three over a batch of real generations and prints what they
 * cost.
 *
 * It generates the way the app does - declare a block, then generate its weeks one
 * at a time with each accepted week becoming context for the next - because a
 * pass rate measured on the same single prompt fifty times says nothing about a
 * block that drifts as it fills up. Nothing is written: no proposal rows, no
 * sessions. It reads the database for context only.
 *
 * Spend is capped twice over. The meter refuses a generation it cannot afford
 * within `--budget`, and the budget itself is clamped to what is left of
 * `SPEND_CAP_USD` after everything the app has already spent.
 *
 * Usage, with the key sourced into the shell rather than copied anywhere:
 *
 *     set -a; . ../fitness/.env.local; set +a
 *     npx tsx scripts/bench-generation.ts --runs 50 --budget 4 --out bench.json
 *
 * Exits nonzero when a criterion fails, so it can gate a phase rather than just
 * report on one.
 */
import { writeFileSync } from "node:fs";
import { config } from "dotenv";
import { getDb } from "../lib/db";
import { GENERATION_MODEL, hasApiKey, type AiUsage } from "../lib/ai/client";
import { loadContext, type GenerationContext } from "../lib/ai/context";
import {
  generateDeclaration,
  generateWeek,
  repairAttemptsOf,
  type DeclarationRun,
  type WeekRun,
} from "../lib/ai/generate";
import { nextBlockOrdinal, totalSpendUsd } from "../lib/ai/proposals";
import { SPEND_CAP_USD, SpendMeter, formatUsd, priceOf } from "../lib/ai/pricing";
import type { BlockState } from "../lib/ai/queries";
import type { MesocycleDeclaration, MicrocyclePlan } from "../lib/engine/types";
import { addDays } from "../lib/days";

config({ path: [".env.local", ".env"], quiet: true });

/** The plan's exit criterion: below this, fix the prompt or the normalizer. */
const FIRST_ATTEMPT_TARGET = 0.8;

/** What a generation is assumed to cost before any has been measured. */
const FIRST_ESTIMATE_USD = 0.02;

type Measurement = {
  n: number;
  scope: "mesocycle" | "microcycle";
  ordinal: number;
  passed: boolean;
  /** True when the gate accepted the very first proposal. */
  firstAttempt: boolean;
  repairs: number;
  fallback: boolean;
  callErrors: string[];
  violations: string[];
  usage: AiUsage;
  usd: number;
};

function flag(name: string): string | null {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? null : (process.argv[at + 1] ?? null);
}

function number(name: string, fallback: number): number {
  const raw = flag(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`--${name} must be a positive number, got "${raw}".`);
  }
  return value;
}

/** The violations a run ended on, deduplicated, as rule ids. */
function unresolved(run: DeclarationRun | WeekRun): string[] {
  const last = run.attempts.at(-1);
  return [...new Set((last?.violations ?? []).map((violation) => violation.rule))];
}

function measure(
  n: number,
  scope: Measurement["scope"],
  ordinal: number,
  run: DeclarationRun | WeekRun,
  usd: number,
): Measurement {
  return {
    n,
    scope,
    ordinal,
    passed: run.passed,
    firstAttempt: run.attempts[0]?.passed === true,
    repairs: repairAttemptsOf(run),
    fallback: "fallback" in run && run.fallback !== null,
    callErrors: run.attempts
      .map((attempt) => attempt.error)
      .filter((error): error is string => error !== null),
    violations: unresolved(run),
    usage: run.usage,
    usd,
  };
}

function report(measurement: Measurement) {
  const { usage } = measurement;
  const cachedShare = usage.inputTokens
    ? Math.round((usage.cachedInputTokens / usage.inputTokens) * 100)
    : 0;
  console.log(
    [
      `${String(measurement.n).padStart(3)} ${measurement.scope === "mesocycle" ? "block" : `week ${measurement.ordinal}`}`.padEnd(
        14,
      ),
      measurement.passed ? "pass" : measurement.fallback ? "FALLBACK" : "FAIL",
      `${measurement.repairs} repair${measurement.repairs === 1 ? " " : "s"}`,
      `in ${usage.inputTokens} (${cachedShare}% cached)`,
      `out ${usage.outputTokens}`,
      formatUsd(measurement.usd),
      measurement.violations.length ? measurement.violations.join(",") : "",
      measurement.callErrors.length ? `[${measurement.callErrors.length} call errors]` : "",
    ]
      .filter(Boolean)
      .join("  "),
  );
}

/**
 * The block as the weekly generator sees it: the declaration just generated, plus
 * the weeks accepted so far in this bench. Assembled in memory because the bench
 * writes nothing, and a week generated without the weeks before it is not the
 * prompt the app sends.
 */
function blockState(input: {
  declaration: MesocycleDeclaration;
  startDate: string;
  ordinal: number;
  priorWeeks: MicrocyclePlan[];
}): BlockState {
  const lastWeek = input.priorWeeks.at(-1);
  return {
    mesocycleId: 0,
    macrocycleId: 0,
    startDate: input.startDate,
    ordinal: input.ordinal,
    declaration: input.declaration,
    priorWeeks: input.priorWeeks,
    priorSession: lastWeek?.sessions.at(-1) ?? null,
  };
}

async function main() {
  const runs = Math.round(number("runs", 50));
  const asOf = new Date();

  if (!hasApiKey()) {
    console.error(
      "OPENAI_API_KEY is not set, so there is nothing to measure. Source it into the shell; this script never reads it from anywhere but the environment.",
    );
    process.exit(2);
  }

  const db = getDb();
  const alreadySpent = await totalSpendUsd(db);
  const budget = Math.min(number("budget", 4), SPEND_CAP_USD - alreadySpent);
  if (budget <= 0) {
    console.error(
      `The ${formatUsd(SPEND_CAP_USD)} cap is already spent (${formatUsd(alreadySpent)}), so this run would exceed it.`,
    );
    process.exit(2);
  }

  const price = priceOf(GENERATION_MODEL);
  console.log(
    `${GENERATION_MODEL} at $${price.input}/$${price.cachedInput} cached/$${price.output} per 1M tokens. Budget ${formatUsd(budget)} of the ${formatUsd(SPEND_CAP_USD)} cap, ${formatUsd(alreadySpent)} already spent by the app.\n`,
  );

  const meter = new SpendMeter(budget);
  const base = await loadContext({ db, asOf });
  const measurements: Measurement[] = [];
  let stopped: string | null = null;
  let consecutiveErrors = 0;
  let blockOrdinal = await nextBlockOrdinal(db);
  let startDate = base.block
    ? addDays(base.block.priorWeeks.at(-1)?.startDate ?? base.block.startDate, 7)
    : asOf.toISOString().slice(0, 10);

  while (measurements.length < runs && !stopped) {
    const estimate = meter.worstUsd || FIRST_ESTIMATE_USD;
    if (!meter.canAfford(estimate)) {
      stopped = `budget: ${formatUsd(meter.totalUsd)} spent of ${formatUsd(budget)}, and the next generation is worth about ${formatUsd(estimate)}`;
      break;
    }

    // One block, then its weeks. A pass rate measured on one prompt repeated
    // fifty times would not see the drift that fills a block up.
    const declarationRun = await tryRun(() =>
      generateDeclaration({
        context: base,
        ordinal: blockOrdinal,
        startDate,
        weeks: 4,
        db,
      }),
    );
    if (!declarationRun) {
      consecutiveErrors += 1;
      if (consecutiveErrors >= 3) {
        stopped = "three consecutive transport failures";
        break;
      }
      continue;
    }
    consecutiveErrors = 0;
    measurements.push(
      measure(
        measurements.length + 1,
        "mesocycle",
        blockOrdinal,
        declarationRun,
        meter.record(`block ${blockOrdinal}`, declarationRun.model ?? GENERATION_MODEL, declarationRun.usage),
      ),
    );
    report(measurements.at(-1)!);

    const declaration = declarationRun.declaration;
    if (declaration) {
      const priorWeeks: MicrocyclePlan[] = [];
      for (let ordinal = 1; ordinal <= declaration.plannedMicrocycles; ordinal += 1) {
        if (measurements.length >= runs) break;
        const nextEstimate = meter.worstUsd || FIRST_ESTIMATE_USD;
        if (!meter.canAfford(nextEstimate)) {
          stopped = `budget: ${formatUsd(meter.totalUsd)} spent of ${formatUsd(budget)}`;
          break;
        }
        const weekStart = addDays(startDate, (ordinal - 1) * 7);
        const context: GenerationContext = {
          ...base,
          block: blockState({ declaration, startDate, ordinal: blockOrdinal, priorWeeks }),
        };
        const weekRun = await tryRun(() =>
          generateWeek({
            context,
            declaration,
            ordinal,
            startDate: weekStart,
            priorWeeks,
            priorSession: priorWeeks.at(-1)?.sessions.at(-1) ?? null,
            db,
          }),
        );
        if (!weekRun) {
          consecutiveErrors += 1;
          if (consecutiveErrors >= 3) {
            stopped = "three consecutive transport failures";
            break;
          }
          continue;
        }
        consecutiveErrors = 0;
        measurements.push(
          measure(
            measurements.length + 1,
            "microcycle",
            ordinal,
            weekRun,
            meter.record(`week ${ordinal}`, weekRun.model ?? GENERATION_MODEL, weekRun.usage),
          ),
        );
        report(measurements.at(-1)!);
        // Only a week the gate accepted becomes context for the next one, the
        // same as the app, where an unaccepted week is never written.
        const shipped = weekRun.passed ? weekRun.week : weekRun.fallback;
        if (shipped) priorWeeks.push(shipped);
      }
      startDate = addDays(startDate, declaration.plannedMicrocycles * 7);
    } else {
      // A block nobody could declare has no weeks to generate; move the clock on
      // so the next attempt is not the identical request.
      startDate = addDays(startDate, 28);
    }
    blockOrdinal += 1;
  }

  summarize(measurements, meter, stopped);

  const out = flag("out");
  if (out) {
    writeFileSync(
      out,
      `${JSON.stringify(
        {
          model: GENERATION_MODEL,
          price,
          asOf: asOf.toISOString(),
          budgetUsd: budget,
          totalUsd: meter.totalUsd,
          totalUsage: meter.totalUsage,
          stopped,
          measurements,
        },
        null,
        2,
      )}\n`,
    );
    console.log(`\nWrote ${out}.`);
  }

  process.exit(criteriaFailed(measurements) ? 1 : 0);
}

/**
 * Runs one generation, treating a transport failure as a skipped measurement.
 *
 * A refused or truncated response is already an attempt inside the run and is
 * measured as one. This is for the other kind: a 500 or a dropped connection,
 * which says nothing about the prompt and should not be counted against it.
 */
async function tryRun<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    console.error(`  call failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function distribution(measurements: readonly Measurement[]) {
  const counts = new Map<number, number>();
  for (const measurement of measurements) {
    counts.set(measurement.repairs, (counts.get(measurement.repairs) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => a[0] - b[0]);
}

function summarize(
  measurements: readonly Measurement[],
  meter: SpendMeter,
  stopped: string | null,
) {
  const total = measurements.length;
  console.log(`\n${"-".repeat(72)}`);
  if (total === 0) {
    console.log("No generations ran.");
    return;
  }

  const firstAttempt = measurements.filter((m) => m.firstAttempt).length;
  const passed = measurements.filter((m) => m.passed).length;
  const fallbacks = measurements.filter((m) => m.fallback).length;
  const usage = meter.totalUsage;
  const cachedCalls = measurements.filter((m) => m.usage.cachedInputTokens > 0).length;

  console.log(`Generations: ${total}${stopped ? ` (stopped early - ${stopped})` : ""}`);
  console.log(
    `First-attempt pass rate: ${firstAttempt}/${total} = ${(firstAttempt / total * 100).toFixed(1)}% (target ${FIRST_ATTEMPT_TARGET * 100}%)`,
  );
  console.log(`Accepted within the repair loop: ${passed}/${total}`);
  console.log(`Shipped as a fallback: ${fallbacks}`);
  console.log("Repair attempts:");
  for (const [repairs, count] of distribution(measurements)) {
    console.log(
      `  ${repairs} ${"#".repeat(count)} ${count} (${((count / total) * 100).toFixed(0)}%)`,
    );
  }

  const rules = new Map<string, number>();
  for (const measurement of measurements) {
    for (const rule of measurement.violations) rules.set(rule, (rules.get(rule) ?? 0) + 1);
  }
  if (rules.size) {
    console.log("Rules still unresolved at the end of a loop:");
    for (const [rule, count] of [...rules].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${rule}: ${count}`);
    }
  }

  console.log(
    `Cached input tokens: ${usage.cachedInputTokens} of ${usage.inputTokens} (${((usage.cachedInputTokens / Math.max(1, usage.inputTokens)) * 100).toFixed(1)}%), in ${cachedCalls}/${total} generations`,
  );
  console.log(
    `Spend: ${formatUsd(meter.totalUsd)} total, ${formatUsd(meter.totalUsd / total)} per generation, dearest ${formatUsd(meter.worstUsd)}`,
  );

  for (const failure of failures(measurements)) console.log(`FAILED: ${failure}`);
}

function failures(measurements: readonly Measurement[]): string[] {
  const total = measurements.length;
  if (total === 0) return ["no generations ran"];
  const problems: string[] = [];
  const rate = measurements.filter((m) => m.firstAttempt).length / total;
  if (rate < FIRST_ATTEMPT_TARGET) {
    problems.push(
      `first-attempt pass rate ${(rate * 100).toFixed(1)}% is under ${FIRST_ATTEMPT_TARGET * 100}%. Fix the prompt or the normalizer, not the rules.`,
    );
  }
  // Nonzero cached tokens is the caching criterion. The first generation cannot
  // hit a cache, so it is only a failure once there has been a second.
  if (total > 1 && measurements.slice(1).every((m) => m.usage.cachedInputTokens === 0)) {
    problems.push(
      "no generation after the first read any cached input tokens, so the stable prefix is not being cached.",
    );
  }
  return problems;
}

function criteriaFailed(measurements: readonly Measurement[]) {
  return failures(measurements).length > 0;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
