import { NextResponse } from "next/server";
import { generateNextWeek } from "@/lib/ai/actions";
import { loadOpenBlock } from "@/lib/ai/queries";
import { getDb } from "@/lib/db";

/**
 * Generates the next week of the open block, or regenerates one.
 *
 * `mesocycleId` may be omitted, in which case the open block is used: a weekly
 * trigger knows it wants "the next week" and should not have to know which block
 * that is. A generation that the gate refused still returns its proposal id with a
 * 422, because the stored violations are the useful part of that outcome.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) ?? {};
  const input = body as Record<string, unknown>;

  let mesocycleId = input.mesocycleId;
  if (mesocycleId == null) {
    const block = await loadOpenBlock(getDb());
    if (!block) {
      return NextResponse.json(
        { ok: false, message: "No block is open. Declare one first." },
        { status: 409 },
      );
    }
    mesocycleId = block.mesocycleId;
  }

  const result = await generateNextWeek({ ...input, mesocycleId });
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
