// A-002: the model's tool-call output is untrusted. The tool schema's enum and
// additionalProperties are a request to the model, not a constraint it honours,
// and the client applies the result with a bare cast (useJobEntry). Rebuild the
// object from the declared fields only, each type-checked and bounded.

const JOB_CATEGORIES = [
  "cleaning", "yard_work", "moving", "errands", "handyman", "painting",
  "delivery", "pet_care", "assembly", "storm_prep", "events", "other",
] as const;

const TITLE_MAX = 32;
const DESCRIPTION_MAX = 4000;
const REQUIREMENTS_MAX = 1000;
const MAX_HOURS = 200;
const MAX_BUDGET = 100_000;
const MAX_HELPERS = 20;

function str(v: unknown, max: number): string | undefined {
  return typeof v === "string" ? v.slice(0, max).trimEnd() : undefined;
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
  let min = num(r.budget_min, 0, MAX_BUDGET);
  let max = num(r.budget_max, 0, MAX_BUDGET);
  if (min !== undefined && max !== undefined && min > max) [min, max] = [max, min];
  if (min !== undefined) out.budget_min = min;
  if (max !== undefined) out.budget_max = max;
  const reqs = str(r.special_requirements, REQUIREMENTS_MAX);
  if (reqs !== undefined) out.special_requirements = reqs;
  if (typeof r.is_group_job === "boolean") out.is_group_job = r.is_group_job;
  const helpers = num(r.helpers_needed, 1, MAX_HELPERS);
  if (helpers !== undefined) out.helpers_needed = Math.round(helpers);
  return out;
}
