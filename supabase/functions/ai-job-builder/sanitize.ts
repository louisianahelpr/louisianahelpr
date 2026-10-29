// A-002: the model's tool-call output is untrusted. The tool schema's enum and
// additionalProperties are a request to the model, not a constraint it honours,
// and the client applies the result with a bare cast (useJobEntry). Rebuild the
// object from the declared fields only, each type-checked and bounded.

const JOB_CATEGORIES = [
  "cleaning", "yard_work", "moving", "errands", "handyman", "painting",
  "delivery", "pet_care", "assembly", "storm_prep", "events",
  "electrical", "plumbing", "hvac", "roofing", "welding", "carpentry", "auto_repair",
  "appliance_repair", "flooring", "concrete_masonry", "fencing", "pressure_washing", "declutter_help", "other",
] as const;

// The post-job form's own bounds (Q782, owner 2026-09-27): the output is poured
// into that form verbatim, and the DB CHECKs jobs_title_length (32) and
// jobs_description_length (1000) refuse anything longer. Budget [10, 1000] is
// _shared/jobBudgetLimits.ts; helpers [2, 10] and requirements 500 are
// LogisticsSection. src/test/aiJobBuilderBoundsParity.test.ts keeps them equal.
const TITLE_MAX = 32;
const DESCRIPTION_MAX = 1000;
const REQUIREMENTS_MAX = 500;
const MAX_HOURS = 200;
const MAX_BUDGET = 1000;
const MAX_HELPERS = 10;

function str(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  // Cut at max UTF-16 units (the form counts .length, and that is never less
  // than Postgres char_length), but never inside a code point: slice() alone
  // can halve an emoji and leave a lone surrogate.
  let out = "";
  for (const ch of v) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out.trimEnd();
}

function num(v: unknown, lo: number, hi: number): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined;
}

export function sanitizeJob(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const title = str(r.title, TITLE_MAX);
  const description = str(r.description, DESCRIPTION_MAX);
  if (!title || !description) return null;
  const out: Record<string, unknown> = {
    title,
    description,
    category: (JOB_CATEGORIES as readonly unknown[]).includes(r.category) ? r.category : "other",
  };
  const hours = num(r.estimated_hours, 0, MAX_HOURS);
  if (hours !== undefined) out.estimated_hours = hours;
  let min = num(r.budget_min, 10, MAX_BUDGET);
  let max = num(r.budget_max, 10, MAX_BUDGET);
  if (min !== undefined && max !== undefined && min > max) [min, max] = [max, min];
  if (min !== undefined) out.budget_min = min;
  if (max !== undefined) out.budget_max = max;
  const reqs = str(r.special_requirements, REQUIREMENTS_MAX);
  if (reqs !== undefined) out.special_requirements = reqs;
  if (typeof r.is_group_job === "boolean") out.is_group_job = r.is_group_job;
  const helpers = num(r.helpers_needed, 2, MAX_HELPERS);
  if (helpers !== undefined) out.helpers_needed = Math.round(helpers);
  return out;
}

/**
 * A2-C25 (app audit 2026-10-28): the builder turned a stated "$40" into $60 on
 * a second run and ignored "Saturday morning around 9". What the poster SAID
 * wins over what the model wrote, so these read the poster's own words.
 */
export const JOB_DAYS = ["today", "tomorrow", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
type JobDay = (typeof JOB_DAYS)[number];

/** The one price the poster named ("$40", "40 dollars", "40 bucks"), or null if none or several. */
export function statedPrice(text: string): number | null {
  const found = new Set<number>();
  for (const m of text.matchAll(/\$\s?(\d{1,4}(?:\.\d{1,2})?)(?!\d)|\b(\d{1,4}(?:\.\d{1,2})?)\s?(?:dollars|bucks|usd)\b/gi)) {
    const n = Number(m[1] ?? m[2]);
    if (Number.isFinite(n)) found.add(n);
  }
  if (found.size !== 1) return null;
  const [n] = found;
  return n >= 10 && n <= MAX_BUDGET ? Math.round(n) : null;
}

/** The one day the poster named (a weekday, today or tomorrow), or null if none or several. */
export function statedDay(text: string): JobDay | null {
  const lower = text.toLowerCase();
  const hits = JOB_DAYS.filter((d) => new RegExp(`\\b${d}s?\\b`).test(lower) || (d === "today" && /\btonight\b/.test(lower)));
  return hits.length === 1 ? hits[0] : null;
}

/**
 * The start time the poster named, as "HH:MM" (24 h), or null. Only when the
 * words make the half of the day plain: "9am", "9:30 pm", or an hour with
 * "morning" / "afternoon" / "evening" / "tonight" ("Saturday morning around 9").
 */
export function statedTime(text: string): string | null {
  const lower = text.toLowerCase();
  const hhmm = (h: number, m: number) => (h >= 0 && h < 24 && m >= 0 && m < 60 ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` : null);
  const explicit = [...lower.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s?(a\.?m\.?|p\.?m\.?)(?![a-z])/g)];
  if (explicit.length === 1) {
    const [, h, m, ap] = explicit[0];
    const hour = Number(h) % 12 + (ap.startsWith("p") ? 12 : 0);
    return Number(h) >= 1 && Number(h) <= 12 ? hhmm(hour, Number(m ?? 0)) : null;
  }
  if (explicit.length > 1) return null;
  const bare = [...lower.matchAll(/\b(?:at|around|about|by|from|after)\s+(\d{1,2})(?::(\d{2}))?(?!\s?(?:\d|%|hours?|hrs?|minutes?|mins?|dollars|bucks|days?|weeks?))\b/g)];
  if (bare.length !== 1) return null;
  const morning = /\bmorning\b/.test(lower);
  const later = /\b(afternoon|evening|tonight)\b/.test(lower);
  if (morning === later) return null;
  const h = Number(bare[0][1]);
  if (h < 1 || h > 12) return null;
  return hhmm(morning ? h % 12 : (h % 12) + 12, Number(bare[0][2] ?? 0));
}

/**
 * The model's day and time, checked (a JOB_DAYS value; "HH:MM"), then
 * overridden by what the poster stated; the stated price sets both ends of the
 * budget. `userText` is the poster's own turns only.
 */
export function keepStatedFacts(job: Record<string, unknown>, raw: unknown, userText: string): Record<string, unknown> {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const out = { ...job };
  const price = statedPrice(userText);
  if (price !== null) {
    out.budget_min = price;
    out.budget_max = price;
  }
  const day = statedDay(userText) ?? ((JOB_DAYS as readonly unknown[]).includes(r.preferred_day) ? (r.preferred_day as JobDay) : null);
  if (day) out.preferred_day = day;
  const modelTime = typeof r.start_time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(r.start_time) ? r.start_time : null;
  const time = statedTime(userText) ?? modelTime;
  if (time) out.start_time = time;
  return out;
}
