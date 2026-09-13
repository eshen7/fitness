"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { checkPasscode } from "@/lib/auth/passcode";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
  signSession,
} from "@/lib/auth/session";

export type UnlockState = { error?: string };

/** Only local paths, so a crafted `next` cannot bounce the owner off-site. */
function safeNext(next: FormDataEntryValue | null): string {
  if (typeof next !== "string") return "/today";
  if (!next.startsWith("/") || next.startsWith("//")) return "/today";
  return next;
}

export async function unlock(
  _prev: UnlockState,
  formData: FormData,
): Promise<UnlockState> {
  const passcode = String(formData.get("passcode") ?? "");
  if (!passcode) return { error: "Enter the passcode." };

  if (!(await checkPasscode(passcode))) {
    return { error: "That is not it." };
  }

  const store = await cookies();
  store.set(SESSION_COOKIE, await signSession(), sessionCookieOptions());
  redirect(safeNext(formData.get("next")));
}
