/**
 * Q1931 class guard: every row kind admin_payouts_held_for_review lists is a kind the Payouts held for review card
 * knows (KIND_LABEL in src/components/admin/adminPayoutBatches/HeldForReview.tsx), and the other way round.
 *
 * Why: the card keeps only rows whose kind is in KIND_LABEL (fetchHeld's filter), so a kind added in SQL and not in
 * the card is dropped silently: the money the row stands for (a gave-up refund ops must settle by hand) never shows.
 * Exact, two-way. The SQL side is the NEWEST definition (effectiveDefs: any dollar tag, later rewrites applied), with
 * comments blanked; kinds are the string literals in the first column of each listed SELECT (`SELECT '<kind>', ` or
 * `SELECT '<kind>' AS kind, `) inside the held-rows sub-select.
 *
 * @mutate src/components/admin/adminPayoutBatches/HeldForReview.tsx |   raise_refund: "Delivery pay-raise refund",\n |
 * @mutate supabase/migrations/20261102150413_declutter_manager_admin_held_after_gave_up.sql |       SELECT 'raise_refund', g.id, | SELECT 'raise_refnd', g.id,
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");

function sqlKinds(): Set<string> {
  const def = effectiveDefs(resolve(ROOT, "supabase/migrations")).get("admin_payouts_held_for_review");
  if (!def) throw new Error("admin_payouts_held_for_review has no definition");
  const body = blankSqlComments(def.stmt);
  // The held rows: from the inner `SELECT to_jsonb(x) AS h FROM (` to the end (the sibling_refs sub-select comes before it).
  const start = body.indexOf("SELECT to_jsonb(x) AS h FROM (");
  if (start < 0) throw new Error("held-rows sub-select not found");
  const kinds = new Set<string>();
  for (const m of body.slice(start).matchAll(/\bSELECT\s+'([a-z_]+)'(?:\s+AS\s+kind)?\s*,/gi)) kinds.add(m[1]);
  return kinds;
}

function cardKinds(): Set<string> {
  const src = blankComments(readFileSync(resolve(ROOT, "src/components/admin/adminPayoutBatches/HeldForReview.tsx"), "utf8"));
  const m = /const KIND_LABEL[^=]*=\s*\{([\s\S]*?)\n\};/.exec(src);
  if (!m) throw new Error("KIND_LABEL not found");
  return new Set([...m[1].matchAll(/^\s*([a-z_]+)\s*:/gm)].map((x) => x[1]));
}

describe("Payouts held for review: SQL kinds == card kinds (Q1931)", () => {
  it("every listed kind has a card label, and every label is a listed kind", () => {
    const sql = sqlKinds();
    const card = cardKinds();
    expect(sql.size).toBeGreaterThan(6);
    expect([...sql].filter((k) => !card.has(k)).sort(), "listed by SQL, dropped by the card").toEqual([]);
    expect([...card].filter((k) => !sql.has(k)).sort(), "a card label no SQL row has").toEqual([]);
  });
});
