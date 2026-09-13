import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb, schema } from "@/lib/db";
import { whoopConfigured, whoopCredentials } from "@/lib/whoop/config";
import {
  ingestCycle,
  ingestRecoveryForSleep,
  ingestSleep,
  ingestWorkout,
  markDeleted,
} from "@/lib/whoop/ingest";
import { projectPending } from "@/lib/whoop/project";
import {
  WHOOP_SIGNATURE_HEADER,
  WHOOP_TIMESTAMP_HEADER,
  parseWhoopEventType,
  verifyWhoopSignature,
  whoopWebhookPayload,
} from "@/lib/whoop/webhook";

/**
 * The WHOOP webhook receiver.
 *
 * The one route with no session in front of it, so the signature is the whole of
 * its authentication and it is checked against the raw body before the body is
 * parsed. Reading the body as text first is not incidental: re-serializing parsed
 * JSON changes the bytes, and the signature is over the bytes.
 *
 * Deliveries are acknowledged as soon as they are recorded. A fetch that fails is
 * left on the receipt as an error rather than answered with a 500, because WHOOP
 * would then redeliver an event whose problem is not delivery.
 */
export async function POST(request: NextRequest) {
  // Without a client secret there is nothing to verify a signature against, and
  // an unverifiable delivery must not be treated as authentic. 501 rather than
  // 401 so the answer distinguishes "this app has no WHOOP" from "that was not
  // signed by WHOOP".
  if (!whoopConfigured()) {
    return NextResponse.json({ error: "whoop not configured" }, { status: 501 });
  }

  const rawBody = await request.text();

  const verdict = verifyWhoopSignature({
    signature: request.headers.get(WHOOP_SIGNATURE_HEADER),
    timestamp: request.headers.get(WHOOP_TIMESTAMP_HEADER),
    rawBody,
    clientSecret: whoopCredentials().clientSecret,
  });
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.reason }, { status: 401 });
  }

  const parsed = whoopWebhookPayload.safeParse(JSON.parse(rawBody));
  if (!parsed.success) {
    return NextResponse.json({ error: "unrecognised payload" }, { status: 400 });
  }
  const event = parsed.data;

  const [receipt] = await getDb()
    .insert(schema.whoopWebhookEvents)
    .values({
      eventType: event.type,
      whoopId: event.id,
      traceId: event.trace_id ?? null,
    })
    .returning({ id: schema.whoopWebhookEvents.id });

  const kind = parseWhoopEventType(event.type);
  if (!kind) {
    await getDb()
      .update(schema.whoopWebhookEvents)
      .set({ handledAt: new Date(), error: "event type not handled" })
      .where(eq(schema.whoopWebhookEvents.id, receipt.id));
    return NextResponse.json({ ok: true, handled: false });
  }

  try {
    if (kind.deleted) {
      // A v2 recovery event names its sleep, so a deleted recovery is keyed by the
      // same id the record was stored under.
      await markDeleted(kind.record, event.id);
    } else if (kind.record === "sleep") {
      await ingestSleep(event.id);
    } else if (kind.record === "recovery") {
      await ingestRecoveryForSleep(event.id);
    } else if (kind.record === "workout") {
      await ingestWorkout(event.id);
    } else {
      await ingestCycle(event.id);
    }
    await projectPending();
    await getDb()
      .update(schema.whoopWebhookEvents)
      .set({ handledAt: new Date() })
      .where(eq(schema.whoopWebhookEvents.id, receipt.id));
  } catch (cause) {
    await getDb()
      .update(schema.whoopWebhookEvents)
      .set({
        handledAt: new Date(),
        error: cause instanceof Error ? cause.message : String(cause),
      })
      .where(eq(schema.whoopWebhookEvents.id, receipt.id));
    return NextResponse.json({ ok: true, handled: false });
  }

  return NextResponse.json({ ok: true, handled: true });
}
