import type { AiUsage } from "./client";

/**
 * What a call costs, and a meter that stops a batch before it overspends.
 *
 * The owner set a hard ceiling on API spend, and a ceiling nobody measures is a
 * wish. So every response's usage is priced here from a pinned table and
 * accumulated, and the batch runner asks the meter whether it can afford the
 * next generation before making it rather than after.
 */

export type ModelPrice = {
  /** USD per million tokens. */
  input: number;
  cachedInput: number;
  output: number;
};

/**
 * Prices as published on developers.openai.com/api/docs/pricing, standard tier,
 * fetched 2026-09-26. Pinned rather than looked up: the models endpoint does not
 * report prices, and a spend cap computed from a guess is not a cap.
 */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  "gpt-6-luna": { input: 0.1, cachedInput: 0.01, output: 0.5 },
  "gpt-6-sol": { input: 2, cachedInput: 0.2, output: 10 },
  "gpt-6-astra": { input: 10, cachedInput: 1, output: 50 },
  "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, output: 1.2 },
  "gpt-5.6-terra": { input: 2, cachedInput: 0.2, output: 12 },
  "gpt-5.6-sol": { input: 4, cachedInput: 0.4, output: 20 },
  "gpt-5.4-nano": { input: 0.2, cachedInput: 0.02, output: 1.25 },
  "gpt-5.4-mini": { input: 0.75, cachedInput: 0.075, output: 4.5 },
  "gpt-5.4": { input: 2.5, cachedInput: 0.25, output: 15 },
  "gpt-5.5": { input: 5, cachedInput: 0.5, output: 30 },
  /**
   * Embeddings. There is no prompt cache and no output on this endpoint, so the
   * cached rate is the input rate and the output rate is zero; writing them that
   * way lets `costOf` stay one function rather than branching on the kind of call.
   */
  "text-embedding-3-small": { input: 0.02, cachedInput: 0.02, output: 0 },
  "text-embedding-3-large": { input: 0.13, cachedInput: 0.13, output: 0 },
};

/** The owner's ceiling on total spend across every live call, experiments included. */
export const SPEND_CAP_USD = 10;

const PER_MILLION = 1_000_000;

/**
 * The price for a model, or the most expensive one in the table when the model
 * is unknown.
 *
 * Erring expensive is the only safe direction: an unpriced model that costs zero
 * would let a batch run past the cap silently, which is the exact failure the
 * cap exists to prevent.
 */
export function priceOf(model: string): ModelPrice {
  const exact = MODEL_PRICES[model];
  if (exact) return exact;
  // Dated aliases such as `gpt-5.4-mini-2026-03-17` price as their base model.
  const base = Object.keys(MODEL_PRICES)
    .filter((key) => model.startsWith(`${key}-`))
    .sort((a, b) => b.length - a.length)[0];
  if (base) return MODEL_PRICES[base];
  return Object.values(MODEL_PRICES).reduce((worst, price) =>
    price.input + price.output > worst.input + worst.output ? price : worst,
  );
}

/**
 * USD for one call's usage.
 *
 * `inputTokens` from the Responses API is the whole input including the cached
 * part, so the cached tokens are subtracted out before the uncached rate applies
 * rather than being billed twice.
 */
export function costOf(model: string, usage: AiUsage): number {
  const price = priceOf(model);
  const cached = Math.min(usage.cachedInputTokens, usage.inputTokens);
  const fresh = usage.inputTokens - cached;
  return (
    (fresh * price.input + cached * price.cachedInput + usage.outputTokens * price.output) /
    PER_MILLION
  );
}

export type SpendEntry = { label: string; model: string; usd: number; usage: AiUsage };

/**
 * Running total against a cap.
 *
 * `canAfford` is the point of the class: a batch asks before each generation
 * using the worst cost it has seen so far, so the run stops one generation short
 * of the cap instead of discovering it has passed the cap afterwards.
 */
export class SpendMeter {
  readonly entries: SpendEntry[] = [];

  constructor(readonly capUsd: number = SPEND_CAP_USD) {}

  record(label: string, model: string, usage: AiUsage): number {
    const usd = costOf(model, usage);
    this.entries.push({ label, model, usd, usage });
    return usd;
  }

  get totalUsd(): number {
    return this.entries.reduce((sum, entry) => sum + entry.usd, 0);
  }

  get remainingUsd(): number {
    return Math.max(0, this.capUsd - this.totalUsd);
  }

  /** The dearest call so far, which is the honest estimate for the next one. */
  get worstUsd(): number {
    return this.entries.reduce((worst, entry) => Math.max(worst, entry.usd), 0);
  }

  canAfford(estimateUsd = this.worstUsd): boolean {
    return this.totalUsd + estimateUsd <= this.capUsd;
  }

  get totalUsage(): AiUsage {
    return this.entries.reduce<AiUsage>(
      (total, entry) => ({
        inputTokens: total.inputTokens + entry.usage.inputTokens,
        outputTokens: total.outputTokens + entry.usage.outputTokens,
        cachedInputTokens: total.cachedInputTokens + entry.usage.cachedInputTokens,
        reasoningTokens: total.reasoningTokens + entry.usage.reasoningTokens,
      }),
      { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0 },
    );
  }
}

/** Four decimal places, because a single generation costs well under a cent. */
export function formatUsd(usd: number): string {
  return `$${usd.toFixed(4)}`;
}
