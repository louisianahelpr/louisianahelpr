/**
 * The four abuse limits an admin can set, and the rules for reading what they
 * typed into them.
 *
 * Pure, and separate from the screen, for one reason: an admin session is not
 * mintable by an agent, so this control cannot be driven by eye during a
 * change. What CAN be proved is that the parse, the stored value, and the
 * sentence shown back are all the same answer — that is what the unit test
 * beside this file does, and it is the substitute for the screenshot.
 *
 * EVERY ONE OF THESE DEFAULTS TO OFF. Owner decision 2026-09-07: "there should
 * not be an application cap, nor a sign-up cap." The mechanisms are wired and
 * unlimited, not deleted, so an operator working an abuse wave has a lever.
 *
 * WHY BLANK AND ZERO BOTH MEAN OFF. The database normalises NULL, 0 and
 * negatives to "no cap" (`application_cap()`, migration
 * 20260907230038), and the edge function mirrors it. An admin who clears the
 * field and an admin who types 0 have plainly asked for the same thing, and a
 * UI that stored those as different values would be the place the two halves
 * of this change start to disagree.
 */

export type AbuseLimitKey =
  | "application_cap_per_minute"
  | "application_cap_per_hour"
  | "daily_application_cap"
  | "signup_rate_limit_per_hour";

export const ABUSE_LIMITS: {
  key: AbuseLimitKey;
  label: string;
  /** What the cap counts, singular, for the "N per …" sentence. */
  unit: string;
  window: string;
  description: string;
}[] = [
  {
    key: "application_cap_per_minute",
    label: "Applications per minute",
    unit: "application",
    window: "minute",
    description:
      "Per Helpr. Enforced by apply_to_job, which refuses before the application row is written.",
  },
  {
    key: "application_cap_per_hour",
    label: "Applications per hour",
    unit: "application",
    window: "hour",
    description: "Per Helpr. Same engine as the per-minute cap.",
  },
  {
    key: "daily_application_cap",
    label: "Applications per day",
    unit: "application",
    window: "rolling 24 hours",
    description:
      "Per Helpr. The only one of the four with a second enforcer behind it: a BEFORE INSERT trigger on applications, so it also holds for any write that does not go through apply_to_job.",
  },
  {
    key: "signup_rate_limit_per_hour",
    label: "Signup completions per hour",
    unit: "signup completion",
    window: "hour",
    description:
      "Per account and per address, in the complete-signup function. Each call uploads ID, license, insurance and portfolio files, so this is a storage-quota lever as much as a spam one. Does not touch Supabase's own auth rate limits, which are platform settings and cannot be changed from here.",
  },
];

export type ParsedCap =
  | { ok: true; value: number | null }
  | { ok: false; error: string };

/** Read one field. Blank, 0 and negatives all resolve to `null` — unlimited. */
export function parseCapInput(raw: string): ParsedCap {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (!/^-?\d+$/.test(trimmed)) {
    return { ok: false, error: "Enter a whole number, or leave it blank for no limit." };
  }
  const n = Number(trimmed);
  if (!Number.isSafeInteger(n)) {
    return { ok: false, error: "That number is too large." };
  }
  if (n <= 0) return { ok: true, value: null };
  if (n > 100_000) {
    return { ok: false, error: "Cap must be 100,000 or less — anything higher is not a limit." };
  }
  return { ok: true, value: n };
}

/** The field's text for a stored value. `null` is an empty field, not "0". */
export function capInputValue(stored: number | null | undefined): string {
  if (typeof stored !== "number" || !Number.isFinite(stored) || stored <= 0) return "";
  return String(Math.floor(stored));
}

/**
 * What the operator is told the save DID. Says the behaviour, not "saved" —
 * this is a control whose off state removes a protection, and an operator
 * turning one off deserves to read that back in a sentence.
 */
export function describeCap(key: AbuseLimitKey, value: number | null): string {
  const spec = ABUSE_LIMITS.find((l) => l.key === key);
  if (!spec) return value === null ? "No limit." : `Limit set to ${value}.`;
  if (value === null) {
    return `${spec.label}: NO LIMIT — nothing is being enforced.`;
  }
  const plural = value === 1 ? spec.unit : `${spec.unit}s`;
  return `${spec.label}: ${value} ${plural} per ${spec.window}.`;
}

/** True when not one of the four is enforcing anything. */
export function allCapsOff(values: Partial<Record<AbuseLimitKey, number | null>>): boolean {
  return ABUSE_LIMITS.every((l) => {
    const v = values[l.key];
    return typeof v !== "number" || !Number.isFinite(v) || v <= 0;
  });
}
