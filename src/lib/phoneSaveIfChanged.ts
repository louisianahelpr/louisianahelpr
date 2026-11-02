import type { PhoneSaveResult } from "@/lib/phoneSave";

/**
 * Saves the member's phone through save_my_phone (Q1586(a)) only when it
 * changed, and loads src/lib/phoneSave.ts only then: it pulls in the RPC copy
 * table (lifecycleErrors), which put /profile over its critical-path budget
 * (416 KB gz vs 380, bundle-size run 41413009940) when imported eagerly.
 * Resolves null when nothing changed.
 */
export async function savePhoneIfChanged(userId: string, next: string, prev: string): Promise<PhoneSaveResult | null> {
  if (next === prev) return null;
  const { saveMyPhone } = await import("@/lib/phoneSave");
  return saveMyPhone(userId, next);
}
