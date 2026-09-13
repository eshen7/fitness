"use server";

import { revalidatePath } from "next/cache";
import { backfill } from "./ingest";
import { projectPending } from "./project";
import { disconnect } from "./tokens";

/**
 * The two WHOOP actions the app itself takes. Everything else happens on a
 * webhook or on the schedule.
 */

export async function disconnectWhoop() {
  await disconnect();
  revalidatePath("/log/readiness");
}

/**
 * A sync on demand, for the case where the schedule has not run yet or a delivery
 * was missed while the app was down. Widening the window is free, since every
 * write upserts on WHOOP's own id.
 */
export async function syncWhoop(days = 7) {
  try {
    const counts = await backfill(days);
    const projection = await projectPending();
    revalidatePath("/log/readiness");
    return { ok: true as const, counts, projection };
  } catch (cause) {
    return {
      ok: false as const,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}
