import type { MesocycleType } from "@/lib/taxonomy";

/**
 * The annotation that makes the jump chart honest.
 *
 * Vertical jump is *expected* to fall inside a hard accumulation block; the
 * back-off afterwards is what produces the supercompensation. A chart that leaves
 * the reader to interpret that dip invites the one reaction that ruins the block,
 * which is to abandon it. So the dip is found and labelled rather than left to be
 * noticed, and it is only labelled when it is both real and inside a block where
 * it is the expected outcome.
 *
 * Pure, and separate from anything that draws, because this is the claim the
 * chart makes and a claim should be testable.
 */

export type Reading = { day: string; value: number };

/** A block a dip inside is expected rather than alarming. */
const HARD_TYPES: MesocycleType[] = ["accumulation", "transmutation"];

export type BlockSpan = {
  type: MesocycleType;
  startDay: string;
  /** Exclusive. */
  endDay: string;
  label: string;
};

export function blockAt(blocks: BlockSpan[], day: string) {
  return blocks.find((block) => day >= block.startDay && day < block.endDay) ?? null;
}

export type Dip = {
  reading: Reading;
  /** How far below the best reading before it, in the series' own unit. */
  drop: number;
  block: BlockSpan;
  expected: boolean;
};

/**
 * The deepest real drop from a previous best, and the block it happened in.
 *
 * "Real" means larger than the measurement noise floor: two attempts at the same
 * jump give two numbers, and calling that a dip would put a label on nothing.
 * When no noise floor is computable yet, any drop counts, which is the
 * conservative direction - it labels a dip that might be noise rather than
 * staying silent about one that is not.
 */
export function deepestDip(
  readings: Reading[],
  blocks: BlockSpan[],
  noiseFloor: number | null,
): Dip | null {
  const threshold = noiseFloor ?? 0;
  let best: number | null = null;
  let found: Dip | null = null;

  for (const reading of readings) {
    if (best !== null) {
      const drop = best - reading.value;
      const block = blockAt(blocks, reading.day);
      if (drop > threshold && block && (!found || drop > found.drop)) {
        found = {
          reading,
          drop,
          block,
          expected: HARD_TYPES.includes(block.type),
        };
      }
    }
    best = best === null ? reading.value : Math.max(best, reading.value);
  }

  return found;
}
