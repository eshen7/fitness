import { SignJWT, jwtVerify } from "jose";
import { env } from "@/lib/env";

export const SESSION_COOKIE = "fitness_session";

/** Long-lived on purpose: this is a single-user app used mid-workout. */
const SESSION_DAYS = 90;

function key(): Uint8Array {
  return new TextEncoder().encode(env().SESSION_SECRET);
}

export async function signSession(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ sub: "owner" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + SESSION_DAYS * 24 * 60 * 60)
    .sign(key());
}

export async function verifySession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    return payload.sub === "owner";
  } catch {
    return false;
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env().NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  };
}
