import OpenAI from "openai";
import { zodResponsesFunction, zodTextFormat } from "openai/helpers/zod";
import type {
  Response,
  ResponseFunctionToolCall,
  ResponseInputItem,
} from "openai/resources/responses/responses";
import type * as z from "zod";

/**
 * The one place the OpenAI SDK is called.
 *
 * Everything above this file talks to `AiClient`, which is a single method over a
 * Zod-typed structured output. That seam exists for two reasons. Tests run the
 * whole pipeline - context assembly, the repair loop, the fallback, persistence,
 * the review UI - against a scripted client with no key and no network, which is
 * the only way the loop's behaviour can be asserted rather than hoped for. And
 * the key is read from the environment inside `propose`, at call time, so
 * importing this module never requires one: Next imports every route module
 * while collecting build output, and a client constructed at import time would
 * turn a missing build-time secret into a failed build.
 */

/**
 * Generation, repair, and reflection all run on the same model, named here once
 * so the choice is one edit.
 *
 * `gpt-6-luna` is the light tier of the newest family and the cheapest model the
 * account can reach (USD 0.10 / 0.01 cached / 0.50 per million tokens), and it
 * supports everything the pipeline needs: strict structured output, strict
 * function tools, and automatic prefix caching.
 */
export const GENERATION_MODEL = "gpt-6-luna";

/** Low, per the brief: this is structured planning, not open-ended reasoning. */
const REASONING_EFFORT = "low" as const;

/**
 * A week of sessions is a few thousand tokens of JSON; the ceiling exists to
 * turn a runaway generation into a reported failure rather than a bill.
 */
const MAX_OUTPUT_TOKENS = 32_000;

/** Tool round trips before the loop gives up. Generous: every tool is a read. */
const MAX_TOOL_TURNS = 8;

export type AiUsage = {
  inputTokens: number;
  outputTokens: number;
  /** Nonzero from the second call onward, and the caching exit criterion. */
  cachedInputTokens: number;
  reasoningTokens: number;
};

/** A tool the model called, recorded so the proposal shows what it looked up. */
export type AiToolCall = { name: string; input: unknown };

/**
 * A read-only lookup the model may call. `run` receives arguments already
 * validated against `parameters`, so a tool body never parses its own input.
 */
export type AiTool = {
  name: string;
  description: string;
  // The schema's own output type is the tool body's concern, not the client's.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parameters: z.ZodType<any>;
  run: (args: never) => Promise<unknown>;
};

/** One conversational turn: the ask, and then each repair round. */
export type AiTurn = { role: "user" | "assistant"; content: string };

export type AiCall<T> = {
  /**
   * Content that is identical across calls - system prompt, domain rules, the
   * exercise directory, the athlete profile. Sent first so the provider's
   * automatic prefix cache can hit it.
   */
  stable: string;
  /**
   * Content that changes per request - readiness, tendon pain, schedule,
   * equipment. Always after `stable`, because anything volatile ahead of the
   * stable text would invalidate the prefix on every call.
   */
  volatile: string;
  turns: AiTurn[];
  tools: AiTool[];
  schema: z.ZodType<T>;
  /** Groups calls that share a prefix for cache routing. */
  cacheKey: string;
  /** Names the call in errors. */
  label: string;
};

export type AiResult<T> = {
  output: T;
  model: string;
  usage: AiUsage;
  toolCalls: AiToolCall[];
};

export interface AiClient {
  propose<T>(call: AiCall<T>): Promise<AiResult<T>>;
}

/**
 * A call that produced no usable plan.
 *
 * Separate from a transport failure because the repair loop treats it as one
 * more failed attempt with a message the model can act on, rather than as an
 * outage. A truncated or refused response is a bad attempt, not a broken app.
 */
export class AiOutputError extends Error {
  constructor(
    readonly reason: "unparseable" | "refused" | "truncated" | "empty" | "tool-loop",
    message: string,
  ) {
    super(message);
    this.name = "AiOutputError";
  }
}

const EMPTY_USAGE: AiUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  reasoningTokens: 0,
};

function addUsage(total: AiUsage, usage: Response["usage"]): AiUsage {
  if (!usage) return total;
  return {
    inputTokens: total.inputTokens + usage.input_tokens,
    outputTokens: total.outputTokens + usage.output_tokens,
    cachedInputTokens:
      total.cachedInputTokens + (usage.input_tokens_details?.cached_tokens ?? 0),
    reasoningTokens:
      total.reasoningTokens + (usage.output_tokens_details?.reasoning_tokens ?? 0),
  };
}

/** Whether a live call is possible at all, so callers can say so rather than throw. */
export function hasApiKey() {
  return Boolean(process.env.OPENAI_API_KEY);
}

/**
 * Reads the key at call time and never logs it. A missing key is a plain error
 * naming the variable, because the alternative is a 401 from inside the SDK.
 */
function sdk() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set, so generation cannot run. Set it in the environment; it is never read from anywhere else.",
    );
  }
  return new OpenAI({ apiKey });
}

/**
 * The input array for one round trip.
 *
 * Rebuilt from scratch each round rather than threaded through
 * `previous_response_id`, because the cache is keyed on the literal prefix and
 * only a full input array guarantees the stable text is still at the front.
 */
function inputOf<T>(call: AiCall<T>, history: ResponseInputItem[]): ResponseInputItem[] {
  return [
    { role: "system", content: call.stable },
    { role: "system", content: call.volatile },
    ...call.turns.map((turn) => ({ role: turn.role, content: turn.content })),
    ...history,
  ];
}

function functionCallsOf(response: Response): ResponseFunctionToolCall[] {
  return response.output.filter(
    (item): item is ResponseFunctionToolCall => item.type === "function_call",
  );
}

function refusalOf(response: Response): string | null {
  for (const item of response.output) {
    if (item.type !== "message") continue;
    for (const part of item.content) {
      if (part.type === "refusal") return part.refusal;
    }
  }
  return null;
}

/**
 * The live client.
 *
 * `responses.parse` gives the strict JSON schema and the validated
 * `output_parsed` in one call; the tool loop around it is ours to run, because
 * parsing a response deliberately does not execute tool callbacks.
 */
export const openaiClient: AiClient = {
  async propose<T>(call: AiCall<T>): Promise<AiResult<T>> {
    const client = sdk();
    const tools = call.tools.map((tool) =>
      zodResponsesFunction({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }),
    );
    const format = zodTextFormat(call.schema, "plan");
    const byName = new Map(call.tools.map((tool) => [tool.name, tool]));

    const history: ResponseInputItem[] = [];
    const toolCalls: AiToolCall[] = [];
    let usage = EMPTY_USAGE;

    for (let turn = 0; turn <= MAX_TOOL_TURNS; turn += 1) {
      const response = await client.responses.parse({
        model: GENERATION_MODEL,
        input: inputOf(call, history),
        tools,
        text: { format },
        reasoning: { effort: REASONING_EFFORT },
        max_output_tokens: MAX_OUTPUT_TOKENS,
        prompt_cache_key: call.cacheKey,
      });
      usage = addUsage(usage, response.usage);

      // Checked before any content is read: a truncated plan parses as often as
      // not, and a half-written week is worse than a reported failure.
      if (response.status === "incomplete") {
        throw new AiOutputError(
          "truncated",
          `${call.label}: the response stopped early (${response.incomplete_details?.reason ?? "unknown reason"}).`,
        );
      }
      const refusal = refusalOf(response);
      if (refusal) {
        throw new AiOutputError("refused", `${call.label}: the model declined. ${refusal}`);
      }

      const calls = functionCallsOf(response);
      if (calls.length === 0) {
        if (response.output_parsed === null || response.output_parsed === undefined) {
          throw new AiOutputError(
            "empty",
            `${call.label}: the response carried neither a tool call nor a plan.`,
          );
        }
        return {
          output: response.output_parsed,
          model: response.model,
          usage,
          toolCalls,
        };
      }

      for (const item of calls) {
        // Rebuilt field by field rather than spread: the SDK decorates the call
        // with `parsed_arguments`, which the API rejects on the way back in.
        history.push({
          type: "function_call",
          call_id: item.call_id,
          name: item.name,
          arguments: item.arguments,
        });
        toolCalls.push({ name: item.name, input: safeJson(item.arguments) });
        history.push({
          type: "function_call_output",
          call_id: item.call_id,
          output: await runTool(byName.get(item.name), item),
        });
      }
    }

    throw new AiOutputError(
      "tool-loop",
      `${call.label}: the model was still calling tools after ${MAX_TOOL_TURNS} rounds.`,
    );
  },
};

/**
 * Runs one tool call and returns what the model sees.
 *
 * A bad call is reported back to the model as an error string instead of
 * throwing, because the model can recover from "no such tool" on the next turn
 * and cannot recover from a 500.
 */
async function runTool(
  tool: AiTool | undefined,
  item: ResponseFunctionToolCall,
): Promise<string> {
  if (!tool) return JSON.stringify({ error: `No tool named ${item.name}.` });
  const parsed = tool.parameters.safeParse(safeJson(item.arguments));
  if (!parsed.success) {
    return JSON.stringify({
      error: `Arguments for ${item.name} did not match its schema.`,
      issues: parsed.error.issues.slice(0, 4).map((issue) => issue.message),
    });
  }
  try {
    return JSON.stringify(await tool.run(parsed.data as never));
  } catch (error) {
    return JSON.stringify({
      error: `${item.name} failed: ${error instanceof Error ? error.message : "unknown error"}`,
    });
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------

let override: AiClient | null = null;

/**
 * Swaps the client for a test. Returns the restore function, so a test that
 * forgets to clean up cannot leak a fake into the next one.
 */
export function setAiClient(client: AiClient | null) {
  const previous = override;
  override = client;
  return () => {
    override = previous;
  };
}

export function getAiClient(): AiClient {
  return override ?? openaiClient;
}
