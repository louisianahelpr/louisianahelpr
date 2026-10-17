/**
 * complete-signup's profiles writes, told apart (Q?signup-one-shot-atomic).
 *
 * A no-session call now writes `profiles` up to three times: the one-shot CLAIM
 * (`terms_accepted_at` only, filtered `terms_accepted_at IS NULL`), the
 * COMPLETION (every form field plus the consent stamps; it always carries
 * `terms_version_accepted`), and, when the call does not finish, the RELEASE
 * (`terms_accepted_at: null`, keyed on the claim's own stamp). A test that
 * means "the completion" must not pick up the claim by being the first
 * `profiles` update, so it reads these instead.
 */
import { scenario, type RecordedFilter } from "./supabase";

type Write = (typeof scenario.writes)[number];
type Row = Record<string, unknown>;

const profileUpdates = (): Write[] => scenario.writes.filter((w) => w.table === "profiles" && w.op === "update");
const payloadOf = (w: Write): Row => (w.payload ?? {}) as Row;

/** The payload of a completion write (the consent stamp is in every one). */
const isCompletionPayload = (p: Row): boolean => "terms_version_accepted" in p;

/** The UPDATE that records the completion, or undefined when none ran. */
export function completionUpdate(): Write | undefined {
  return profileUpdates().find((w) => isCompletionPayload(payloadOf(w)));
}

/** The no-session claims: `terms_accepted_at` set WHERE it IS NULL. */
export function claimUpdates(): Write[] {
  return profileUpdates().filter(
    (w) => w.filters.some((f) => f.op === "is" && f.column === "terms_accepted_at" && f.value === null),
  );
}

/** The releases: `terms_accepted_at` put back to NULL. */
export function releaseUpdates(): Write[] {
  return profileUpdates().filter((w) => {
    const p = payloadOf(w);
    return "terms_accepted_at" in p && p.terms_accepted_at === null && !isCompletionPayload(p);
  });
}

/** Force only the COMPLETION update to answer zero rows (the claim still lands). */
export function completionUpdateMatchesNoRow(): void {
  (scenario.writeOverrides ??= []).push({
    table: "profiles",
    op: "update",
    when: (p) => isCompletionPayload(p),
    rows: [],
  });
}

/** Force only the COMPLETION update to fail (the claim still lands). */
export function completionUpdateFails(error: { message: string; code?: string }): void {
  (scenario.writeOverrides ??= []).push({
    table: "profiles",
    op: "update",
    when: (p) => isCompletionPayload(p),
    error,
  });
}

function rowMatches(row: Row, f: RecordedFilter): boolean {
  if (f.op === "eq") return row[f.column] === f.value;
  if (f.op === "is" && f.value === null) return row[f.column] === null || row[f.column] === undefined;
  // Loud, never a silent "matched": a filter this model cannot evaluate would
  // make the race below prove nothing.
  throw new Error(`profiles row model cannot evaluate filter ${f.op} on ${f.column}`);
}

/**
 * ONE live profiles row, the way Postgres holds it: every read returns this
 * object (so a value written mid-run is what the next read sees), and every
 * UPDATE is applied only when its WHERE matches the row AT THAT MOMENT, else
 * it answers zero rows. A single UPDATE is atomic here exactly as a row lock
 * makes it in Postgres (no await inside), so two overlapping calls that both
 * read NULL cannot both win a `terms_accepted_at IS NULL` claim, and two that
 * write without one both "succeed".
 */
export function liveProfileRow(initial: Row): Row {
  const row: Row = { ...initial };
  scenario.reads.profiles = { rows: [row] };
  scenario.writeSelectRows.profiles = [{ user_id: row.user_id }];
  (scenario.writeOverrides ??= []).push({
    table: "profiles",
    op: "update",
    when: (payload, filters) => {
      const hit = filters.every((f) => rowMatches(row, f));
      if (hit) Object.assign(row, payload);
      // A miss answers zero rows. A hit falls through to the NEXT override, then
      // writeSelectRows, so an override pushed after this one (completionUpdateFails)
      // models "the write landed and its answer was an error" (committed, answer lost).
      return !hit;
    },
    rows: [],
  });
  return row;
}
