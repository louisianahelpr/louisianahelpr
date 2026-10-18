/**
 * An accepted Terms version never moves BACKWARD (Q?schedule-double-modal).
 *
 * ─── WHAT HAPPENED (prod, 2026-10-17) ──────────────────────────────────────
 *
 * press-every-control run 39014836855 leg 2 could not press day "28" on
 * /profile?tab=schedule as poster-e2e: "covered: <div data-state=open
 * aria-hidden=true ... backdrop-blur-[24px]>". That aria-hidden overlay looked
 * like a second modal under a first, but Radix portals a Dialog's overlay and
 * content SEPARATELY (node_modules/@radix-ui/react-dialog DialogPortal maps
 * each child into its own Portal) and hideOthers(content) then marks the
 * dialog's own overlay aria-hidden. The failure screenshot shows ONE modal:
 * "Please Take a Moment to Re-Agree" (TermsReconsentDialog).
 *
 * Why it opened: at 09:13:20Z a node script run from a checkout still on
 * "Sep 2026" PATCHed poster-e2e's profiles.terms_version_accepted from
 * "Oct 2026" back to "Sep 2026" (edge_logs PATCH 200, ua node; legal_acceptances
 * row "Sep 2026" at 09:13:20.48Z; "Oct 2026" again at 09:14:09Z). Every current
 * build then showed the non-dismissible dialog. An older app build does the
 * same to a real member: it compared with `!==`, prompted on a NEWER
 * acceptance, and its I Agree wrote its own older version.
 *
 * ─── THE CLASS AND ITS TWO GUARDS ──────────────────────────────────────────
 *
 * Any writer older than the member's last acceptance. Writers already shipped
 * cannot be changed, so:
 *   1. the database keeps the newer version: tr_keep_newest_terms_acceptance
 *      (BEFORE UPDATE OF terms_version_accepted on profiles) restores OLD when
 *      NEW ranks lower, read here from the NEWEST migration that defines it.
 *      Behaviour, red without the migration, 3x replay:
 *      src/test/pglite/termsAcceptanceNeverDowngrades.pglite.mjs (D1, D2 FAIL).
 *   2. from the next build on, the dialog treats a newer acceptance as current
 *      (termsAcceptanceIsCurrent); behaviour in termsReconsentOnBump.test.tsx.
 *   3. the database also refuses a FUTURE version (later than the current UTC
 *      month), because a member holds UPDATE on their own column and with (2)
 *      a self-written "Dec 2099" would opt them out of every later re-consent
 *      (lh-authz-rls review of ea33dff87, finding 1). So LATEST_TERMS_VERSION
 *      may never be a future month either (checked below).
 *   And the ranks agree: src/lib/consent.ts termsVersionRank, the harness's
 *   scripts/lib/acceptCurrentTerms.mjs versionRank, and the migration's month
 *   list.
 *
 * @mutate supabase/migrations/20261017115618_terms_acceptance_never_downgrades.sql |   IF new_rank < old_rank THEN | IF new_rank > old_rank THEN
 * @mutate supabase/migrations/20261017115618_terms_acceptance_never_downgrades.sql |   BEFORE UPDATE OF terms_version_accepted ON public.profiles | BEFORE UPDATE OF bio ON public.profiles
 * @mutate src/lib/consent.ts |   return held !== null && ours !== null && held >= ours; |   return false;
 * @mutate supabase/migrations/20261017115618_terms_acceptance_never_downgrades.sql |   IF new_rank > now_rank THEN | IF new_rank > now_rank + 999999 THEN
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { bodyOf, triggerInventory } from "./helpers/migrationTriggers";
import { LATEST_TERMS_VERSION, termsAcceptanceIsCurrent, termsVersionRank } from "@/lib/consent";
import { versionRank } from "../../scripts/lib/acceptCurrentTerms.mjs";

const ROOT = resolve(__dirname, "../..");
const MIG = join(ROOT, "supabase", "migrations");
const files = migrationFiles(MIG);
const sqlOf = (name: string) => readFileSync(join(MIG, name), "utf8");

describe("the database keeps the newer accepted Terms version", () => {
  const inv = triggerInventory(files.map((name) => ({ name, sql: sqlOf(name) })));

  it("profiles has a BEFORE UPDATE OF terms_version_accepted trigger running keep_newest_terms_acceptance", () => {
    expect(files.length).toBeGreaterThan(1000); // 1124 migrations on 2026-10-17 (inventory floor)
    const trg = inv.get("profiles.tr_keep_newest_terms_acceptance");
    expect(trg, "trigger missing from the migrations").toBeTruthy();
    expect(trg!.fn).toBe("keep_newest_terms_acceptance");
    expect(trg!.timing.toUpperCase()).toBe("BEFORE");
    expect(trg!.events.toLowerCase()).toMatch(/update\s+of\s+terms_version_accepted/);
  });

  it("the newest definition restores OLD when NEW ranks lower, and ranks Mon YYYY in calendar order", () => {
    const def = effectiveDefs(MIG).get("keep_newest_terms_acceptance");
    expect(def, "function missing").toBeTruthy();
    const body = bodyOf(def!.stmt);
    expect(body).toMatch(/IF\s+new_rank\s*<\s*old_rank\s+THEN\s+NEW\.terms_version_accepted\s*:=\s*OLD\.terms_version_accepted;\s*NEW\.terms_accepted_at\s*:=\s*OLD\.terms_accepted_at;/);
    const months = /ARRAY\[([^\]]+)\]/.exec(body)?.[1].split(",").map((m) => m.trim().replace(/'/g, ""));
    expect(months).toEqual(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
    expect(body).toMatch(/\[2\]::int\s*\*\s*100\s*\+\s*array_position\(months,\s*old_m\[1\]\)/);
    // A future version is kept at OLD too, against the current UTC month.
    expect(body).toMatch(/now_rank\s+int\s*:=\s*extract\(year FROM now\(\) AT TIME ZONE 'UTC'\)::int\s*\*\s*100\s*\+\s*extract\(month FROM now\(\) AT TIME ZONE 'UTC'\)::int;/i);
    expect(body).toMatch(/IF\s+new_rank\s*>\s*now_rank\s+THEN\s+NEW\.terms_version_accepted\s*:=\s*OLD\.terms_version_accepted;\s*NEW\.terms_accepted_at\s*:=\s*OLD\.terms_accepted_at;\s*RETURN NEW;/);
    // It must not RAISE: an older app build's I Agree has to succeed (its
    // `.select("user_id")` gets the row back) or the member is stuck behind a
    // non-dismissible dialog on that device.
    expect(body).not.toMatch(/\bRAISE\b/i);
  });

  it("the trigger function is not callable by members (REVOKE FROM PUBLIC, anon, authenticated)", () => {
    const defining = files.filter((f) => /keep_newest_terms_acceptance/.test(sqlOf(f)));
    const sql = sqlOf(defining[defining.length - 1]);
    expect(sql).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.keep_newest_terms_acceptance\(\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i);
  });
});

describe("one ranking of Terms versions", () => {
  const SAMPLES = ["Jun 2026", "Sep 2026", "Oct 2026", "Dec 2026", "Jan 2027", "", "1", "v2", "oct 2026", "Foo 2026"];

  it("the live Terms version is not a future month, or the database would refuse every acceptance of it", () => {
    const d = new Date();
    const nowRank = d.getUTCFullYear() * 100 + d.getUTCMonth() + 1;
    expect(termsVersionRank(LATEST_TERMS_VERSION)!).toBeLessThanOrEqual(nowRank);
  });

  it("the app and the harness rank every sample the same", () => {
    for (const v of SAMPLES) expect(termsVersionRank(v), v).toBe(versionRank(v));
    expect(termsVersionRank(LATEST_TERMS_VERSION)).not.toBeNull();
  });

  it("a newer acceptance is current; an older or unranked one is not", () => {
    expect(termsAcceptanceIsCurrent("Oct 2026", "Oct 2026")).toBe(true);
    expect(termsAcceptanceIsCurrent("Nov 2026", "Oct 2026")).toBe(true);
    expect(termsAcceptanceIsCurrent("Jan 2027", "Dec 2026")).toBe(true);
    expect(termsAcceptanceIsCurrent("Sep 2026", "Oct 2026")).toBe(false);
    expect(termsAcceptanceIsCurrent("Dec 2026", "Jan 2027")).toBe(false);
    expect(termsAcceptanceIsCurrent("", "Oct 2026")).toBe(false);
    expect(termsAcceptanceIsCurrent(null, "Oct 2026")).toBe(false);
    expect(termsAcceptanceIsCurrent("1", "Oct 2026")).toBe(false);
  });
});
