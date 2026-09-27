import { EMBEDDING_DIMENSIONS } from "@/lib/db/schema/memory";
import {
  AiOutputError,
  type AiCall,
  type AiClient,
  type AiEmbedCall,
  type AiEmbedResult,
  type AiResult,
  type AiToolCall,
  type AiUsage,
} from "./client";

/**
 * A scripted `AiClient`, so the whole pipeline runs with no key and no network.
 *
 * The repair loop, the fallback, the persistence and the review UI are all
 * behaviour that only shows up over a *sequence* of model replies: a first attempt
 * that violates a rule, a second that fixes one of two, a third that gives up. A
 * client that can be handed that exact sequence is the only way to assert any of
 * it, which is why the seam in `client.ts` exists at all.
 *
 * Two deliberate strictnesses. Every scripted output is parsed against the call's
 * own schema, so a fixture that has drifted from the schema fails the test that
 * uses it rather than the assertion three lines later. And running off the end of
 * the script throws, because a loop that asked for one more reply than the test
 * expected is the bug the test was written to catch.
 */

/** One scripted reply: a plan, or a failure the repair loop should absorb. */
export type FakeStep =
  | { output: unknown; usage?: Partial<AiUsage>; toolCalls?: AiToolCall[] }
  | { error: AiOutputError };

export type FakeAiClient = AiClient & {
  /** Every call as it was sent, for asserting on prompt content and ordering. */
  readonly calls: readonly AiCall<unknown>[];
  /** How many scripted steps have been used. */
  readonly used: number;
  /** Every embedding batch as it was sent, for asserting nothing was embedded twice. */
  readonly embedCalls: readonly AiEmbedCall[];
};

/**
 * A deterministic stand-in for a real embedding: character trigrams hashed into
 * the vector's buckets, then L2 normalised.
 *
 * Random vectors would make every retrieval test a tautology, and a constant
 * vector would make near-duplicate detection untestable. Trigram overlap is not
 * semantics, but it has the one property the tests need: two phrasings of the
 * same fact land close together and two unrelated facts do not, so the
 * supersession threshold and the ranking can both be asserted.
 */
export function fakeEmbedding(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const normalized = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  for (let i = 0; i + 3 <= normalized.length; i += 1) {
    // FNV-1a over the trigram, which spreads adjacent trigrams across buckets
    // instead of clustering them the way a sum of character codes would.
    let hash = 0x811c9dc5;
    for (let j = i; j < i + 3; j += 1) {
      hash ^= normalized.charCodeAt(j);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    vector[hash % EMBEDDING_DIMENSIONS] += 1;
  }
  const length = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return length === 0 ? vector : vector.map((value) => value / length);
}

/**
 * Simulated caching. The first call reads nothing; every later one reads the
 * stable prefix back, which is what the live provider does and what the caching
 * assertion in the tests is about.
 */
function defaultUsage(call: AiCall<unknown>, index: number): AiUsage {
  const stable = Math.ceil(call.stable.length / 4);
  const volatile = Math.ceil(call.volatile.length / 4);
  return {
    inputTokens: stable + volatile,
    outputTokens: 500,
    cachedInputTokens: index === 0 ? 0 : stable,
    reasoningTokens: 64,
  };
}

/**
 * @param script Either a fixed list of replies, consumed in order, or a function
 *   of the call and its zero-based index for tests that want to react to what the
 *   repair request actually said.
 * @param options.embed Replaces the deterministic embedder, for the tests that are
 *   about an embedding call failing rather than about what it returned.
 */
export function fakeAiClient(
  script: readonly FakeStep[] | ((call: AiCall<unknown>, index: number) => FakeStep),
  options: { embed?: (call: AiEmbedCall) => Promise<AiEmbedResult> } = {},
): FakeAiClient {
  const calls: AiCall<unknown>[] = [];
  const embedCalls: AiEmbedCall[] = [];

  const client: FakeAiClient = {
    get calls() {
      return calls;
    },
    get used() {
      return calls.length;
    },
    get embedCalls() {
      return embedCalls;
    },
    async embed(call: AiEmbedCall): Promise<AiEmbedResult> {
      embedCalls.push({ ...call, texts: [...call.texts] });
      if (options.embed) return options.embed(call);
      return {
        vectors: call.texts.map(fakeEmbedding),
        model: "fake-embedding",
        usage: {
          // Roughly a token per four characters, like the propose side, so a test
          // asserting that embedding spend reached the ledger has a number to see.
          inputTokens: call.texts.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0),
          outputTokens: 0,
          cachedInputTokens: 0,
          reasoningTokens: 0,
        },
      };
    },
    async propose<T>(call: AiCall<T>): Promise<AiResult<T>> {
      const index = calls.length;
      // Snapshotted rather than recorded by reference: the repair loop appends to
      // one call object across attempts, so keeping the object itself would make
      // every recorded call show the final conversation instead of the one sent.
      calls.push({ ...(call as AiCall<unknown>), turns: [...call.turns] });

      const step =
        typeof script === "function" ? script(call as AiCall<unknown>, index) : script[index];
      if (!step) {
        throw new Error(
          `The fake client ran out of script: call ${index + 1} (${call.label}) has no reply.`,
        );
      }
      if ("error" in step) throw step.error;

      const parsed = call.schema.safeParse(step.output);
      if (!parsed.success) {
        throw new Error(
          `Scripted output for call ${index + 1} (${call.label}) does not match the call's schema: ${parsed.error.issues
            .slice(0, 3)
            .map((issue) => `${issue.path.join(".")} ${issue.message}`)
            .join("; ")}`,
        );
      }

      return {
        output: parsed.data,
        model: "fake",
        usage: { ...defaultUsage(call as AiCall<unknown>, index), ...step.usage },
        toolCalls: step.toolCalls ?? [],
      };
    },
  };
  return client;
}

/** A step that fails the way a truncated response does. */
export function truncated(label = "fake"): FakeStep {
  return {
    error: new AiOutputError(
      "truncated",
      `${label}: the response stopped early (max_output_tokens).`,
      { inputTokens: 4000, outputTokens: 32_000, cachedInputTokens: 0, reasoningTokens: 0 },
    ),
  };
}

/** A step that fails the way a refusal does. */
export function refused(label = "fake"): FakeStep {
  return { error: new AiOutputError("refused", `${label}: the model declined.`) };
}
