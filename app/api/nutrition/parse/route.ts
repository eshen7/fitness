import { NextResponse } from "next/server";
import { logMeal } from "@/lib/nutrition/actions";

/**
 * Logs a sentence of food over HTTP.
 *
 * The same action the form calls, so one code path resolves a meal however it
 * arrives: the caches, the cap and the ledger cannot differ between the screen and a
 * script. Behind the passcode gate like every other route here, which is why an
 * unauthenticated call gets `401 {"error":"locked"}` rather than a redirect.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const result = await logMeal(body);
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
