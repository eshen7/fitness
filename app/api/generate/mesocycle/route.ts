import { NextResponse } from "next/server";
import { declareBlock } from "@/lib/ai/actions";

/**
 * Declares a block over HTTP, for a scheduled trigger or a script.
 *
 * The same action the review screen calls, so there is one code path and one place
 * the proposal row is written. Behind the passcode gate like every other route
 * here, which is why an unauthenticated call gets `401 {"error":"locked"}` rather
 * than a redirect.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const result = await declareBlock(body);
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
