import { describe, expect, it } from "vitest";
import type { AiUsage } from "./client";
import {
  MODEL_PRICES,
  SPEND_CAP_USD,
  SpendMeter,
  costOf,
  formatUsd,
  priceOf,
} from "./pricing";

/**
 * The spend meter is the only thing standing between a fifty-generation batch and
 * an overrun, so its arithmetic is asserted rather than eyeballed.
 */

function usage(overrides: Partial<AiUsage> = {}): AiUsage {
  return {
    inputTokens: 10_000,
    outputTokens: 2_000,
    cachedInputTokens: 0,
    reasoningTokens: 400,
    ...overrides,
  };
}

describe("priceOf", () => {
  it("prices a dated alias as its base model", () => {
    expect(priceOf("gpt-6-luna-2026-09-01")).toEqual(MODEL_PRICES["gpt-6-luna"]);
  });

  it("prefers the longest matching base, so a suffix cannot pick a shorter name", () => {
    expect(priceOf("gpt-5.4-mini-2026-03-17")).toEqual(MODEL_PRICES["gpt-5.4-mini"]);
  });

  it("charges an unknown model at the dearest rate in the table", () => {
    const worst = MODEL_PRICES["gpt-6-astra"];
    // Erring cheap would let a batch run past the cap silently, which is the exact
    // failure the cap exists to prevent.
    expect(priceOf("some-model-nobody-priced")).toEqual(worst);
    expect(costOf("some-model-nobody-priced", usage())).toBeGreaterThan(
      costOf("gpt-6-luna", usage()),
    );
  });
});

describe("costOf", () => {
  it("prices fresh input, cached input and output separately", () => {
    // 9000 fresh at 0.10, 1000 cached at 0.01, 2000 out at 0.50, per million.
    expect(costOf("gpt-6-luna", usage({ cachedInputTokens: 1_000 }))).toBeCloseTo(
      (9_000 * 0.1 + 1_000 * 0.01 + 2_000 * 0.5) / 1_000_000,
      12,
    );
  });

  it("never bills the cached part twice", () => {
    const fresh = costOf("gpt-6-luna", usage());
    const cached = costOf("gpt-6-luna", usage({ cachedInputTokens: 10_000 }));
    expect(cached).toBeLessThan(fresh);
    expect(cached).toBeCloseTo((10_000 * 0.01 + 2_000 * 0.5) / 1_000_000, 12);
  });

  it("clamps a cached count larger than the input it belongs to", () => {
    // The API reports the whole input including the cached part, so cached can only
    // exceed it if something upstream is confused; the answer must stay a price.
    expect(costOf("gpt-6-luna", usage({ cachedInputTokens: 99_000 }))).toBeCloseTo(
      (10_000 * 0.01 + 2_000 * 0.5) / 1_000_000,
      12,
    );
  });

  it("costs nothing for a call that reported no usage", () => {
    expect(
      costOf("gpt-6-luna", {
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        reasoningTokens: 0,
      }),
    ).toBe(0);
  });
});

describe("SpendMeter", () => {
  it("accumulates the total, the usage and the dearest call", () => {
    const meter = new SpendMeter(1);
    const first = meter.record("week 1", "gpt-6-luna", usage());
    const second = meter.record("week 2", "gpt-6-luna", usage({ outputTokens: 8_000 }));

    expect(second).toBeGreaterThan(first);
    expect(meter.totalUsd).toBeCloseTo(first + second, 12);
    expect(meter.worstUsd).toBe(second);
    expect(meter.remainingUsd).toBeCloseTo(1 - first - second, 12);
    expect(meter.totalUsage).toEqual({
      inputTokens: 20_000,
      outputTokens: 10_000,
      cachedInputTokens: 0,
      reasoningTokens: 800,
    });
    expect(meter.entries.map((entry) => entry.label)).toEqual(["week 1", "week 2"]);
  });

  it("stops one generation short of the cap rather than after passing it", () => {
    const meter = new SpendMeter(0.01);
    // A call of exactly the remaining budget is affordable; the next one is not.
    const oneCall = costOf("gpt-6-luna", usage());
    while (meter.canAfford(oneCall)) meter.record("run", "gpt-6-luna", usage());

    expect(meter.totalUsd).toBeLessThanOrEqual(0.01);
    expect(meter.totalUsd + oneCall).toBeGreaterThan(0.01);
  });

  it("assumes the worst call so far when asked with no estimate", () => {
    const meter = new SpendMeter(0.001);
    meter.record("cheap", "gpt-6-luna", usage({ inputTokens: 100, outputTokens: 10 }));
    expect(meter.canAfford()).toBe(true);

    meter.record("dear", "gpt-6-luna", usage({ inputTokens: 900_000, outputTokens: 900_000 }));
    expect(meter.canAfford()).toBe(false);
    expect(meter.remainingUsd).toBe(0);
  });

  it("defaults to the owner's cap", () => {
    expect(new SpendMeter().capUsd).toBe(SPEND_CAP_USD);
    expect(SPEND_CAP_USD).toBe(10);
  });
});

describe("formatUsd", () => {
  it("keeps four decimals below a dollar, because a generation costs well under a cent", () => {
    expect(formatUsd(0.00123)).toBe("$0.0012");
    expect(formatUsd(0)).toBe("$0.0000");
  });

  it("shows cents from a dollar up, where the fourth place is noise", () => {
    expect(formatUsd(1)).toBe("$1.00");
    expect(formatUsd(10)).toBe("$10.00");
  });
});
