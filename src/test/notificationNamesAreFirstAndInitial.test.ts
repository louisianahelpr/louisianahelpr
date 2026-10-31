/**
 * Q2292 (owner rule 2026-10-21): a notification one member reads never carries ANOTHER member's last name,
 * only its first letter ("Andre L."). The bell, the push and the email all carry the notification row's own
 * title and message, so the rule lives where the row is written:
 *  - every SQL producer (the EFFECTIVE definition the migrations leave, rewrites included) reads a name only
 *    through public.member_display_name(...), unless it is listed below with why (staff-only fan-outs keep
 *    full names; a recipient's own name; first name only);
 *  - every edge-function producer that touches a name field is listed with why, or passes it through
 *    memberDisplayName (supabase/functions/_shared/memberDisplayName.ts);
 *  - the SQL helper, the edge helper and formatName are the same rule.
 * Behaviour (helper cases, two producers, the backfill of stored rows, 3x replay): src/test/pglite/memberDisplayName.pglite.mjs.
 * @mutate supabase/migrations/20261029160717_autostart_notice_never_claims_arrival.sql | SELECT public.member_display_name(full_name, 'Your Helpr') INTO v_helper_name | SELECT COALESCE(full_name, 'Your Helpr') INTO v_helper_name
 * @mutate supabase/migrations/20261021061341_member_display_name.sql | SELECT public.member_display_name(full_name, 'Someone') INTO v_reviewer_name | SELECT COALESCE(full_name, 'Someone') INTO v_reviewer_name
 * @mutate supabase/functions/create-notification/index.ts | facts.posterFirstName = memberDisplayName(prof?.full_name, "").split(" ")[0] \|\| null; | facts.posterFirstName = (prof?.full_name ?? "").split(" ")[0] \|\| null;
 * @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts | const donorName = memberDisplayName((session.metadata as any)?.donor_name as string \| undefined, "Someone"); | const donorName = ((session.metadata as any)?.donor_name as string \| undefined)?.trim() \|\| "Someone";
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { sqlProducers, edgeProducers } from "./helpers/notificationProducers";
import { formatName } from "@/lib/utils";
import { memberDisplayName } from "../../supabase/functions/_shared/memberDisplayName";

const ROOT = process.cwd();

/** SQL producers that may read profiles.full_name raw. name -> why. Exact and two-way. */
const SQL_RAW_NAME_OK: Record<string, string> = {
  apply_consequence_ladder: "staff only: the ban-review notice fans out to user_roles admin",
  apply_low_rating_flag: "staff only: admin fan-out with an /admin link",
  auto_escalate_reports: "staff only: admin fan-out with an /admin link",
  auto_restrict_repeat_violators: "staff only: admin fan-out with an /admin link",
  detect_stuck_payments: "staff only: admin fan-out with an /admin link",
  sweep_expired_auto_bans: "the label is for the cron's own log; the member notice names nobody",
  notify_on_application: "the recipient's OWN name, for their email greeting",
  // nudge_confirm and notify_message_recipient left this list in 20261021131322: their own split on ' '
  // let a tab or no-break space keep the surname attached, so both now read member_display_name.
};

/** Edge producers whose source touches a name field without memberDisplayName. path -> why. Exact and two-way. */
const EDGE_RAW_NAME_OK: Record<string, string> = {
  "admin-support-reply": "the member's OWN first name in their email greeting; no other member is named",
  "admin-user-actions": "the member's OWN name in their email greeting, and staff audit details",
  "execute-dispute-split": "selects the payee's own profile for Stripe; no name in any notice",
  "expire-subscriptions": "the member's own profile; no other member is named",
  "instant-payout": "the member's own profile for Stripe; no other member is named",
  "release-payout": "the Helpr's own profile for Stripe; no other member is named",
  "saved-helper-availability-push": "the saved Helpr's first name only (first word)",
  "stripe-connect": "the member's OWN name, split for their Stripe account",
  "stripe-idv-webhook": "the member's OWN ID-document name, sent to the verification RPC; no notice names it",
  "stripe-webhook/handlers/accountUpdated": "the member's own profile; no other member is named",
  "weekly-helper-report": "the member's OWN name in their own report",
};

/** Blank every member_display_name(...) call, balanced parentheses, so what is left reads names raw. */
function withoutHelperCalls(body: string): string {
  let out = body;
  for (;;) {
    const m = /\bmember_display_name\s*\(/i.exec(out);
    if (!m) return out;
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < out.length; i++) {
      if (out[i] === "(") depth++;
      else if (out[i] === ")" && --depth === 0) break;
    }
    out = out.slice(0, m.index) + " ".repeat(i + 1 - m.index) + out.slice(i + 1);
  }
}

const defs = effectiveDefs(join(ROOT, "supabase", "migrations"));
const producers = sqlProducers(ROOT);
const rawSql = (name: string) => /\bfull_name\b/i.test(withoutHelperCalls(blankSqlComments(defs.get(name)!.stmt)));

function edgeFile(key: string): string {
  const a = join(ROOT, "supabase", "functions", `${key}.ts`);
  return existsSync(a) ? a : join(ROOT, "supabase", "functions", key, "index.ts");
}
const edge = edgeProducers(ROOT);
const edgeCode = (key: string) => blankComments(readFileSync(edgeFile(key), "utf8"));
const NAME_FIELD = /\b(full_name|donor_name|first_name|last_name|display_name|sender_name|poster_name|helper_name|buyer_name|seller_name|reviewer_name)\b|user_metadata\??\.(full_)?name\b/;

describe("notifications name other members as 'First L.' (Q2292)", () => {
  it("reads the producer inventories", () => {
    expect(producers.length).toBeGreaterThan(40);
    expect(edge.length).toBeGreaterThan(30);
  });

  it("the checker strips a helper call and still sees a raw read", () => {
    expect(/full_name/.test(withoutHelperCalls("SELECT public.member_display_name(p.full_name, 'x') INTO v"))).toBe(false);
    expect(/full_name/.test(withoutHelperCalls("SELECT COALESCE(full_name, 'x') INTO v"))).toBe(true);
    expect(/full_name/.test(withoutHelperCalls("member_display_name(btrim(p.full_name), 'x') || full_name"))).toBe(true);
  });

  it("every SQL producer reads a member's name only through member_display_name (or is listed with why)", () => {
    const bad = producers.filter((p) => !(p in SQL_RAW_NAME_OK) && rawSql(p));
    expect(bad).toEqual([]);
  });

  it("every SQL exception is still a producer that reads full_name raw (two-way)", () => {
    for (const p of Object.keys(SQL_RAW_NAME_OK)) {
      expect(producers, p).toContain(p);
      expect(rawSql(p), p).toBe(true);
    }
  });

  it("the restated member-facing producers call the helper", () => {
    for (const p of [
      "claim_series_dates", "complete_job_accept", "complete_pending_accepts_on_setup", "complete_pending_crew_confirms_on_setup",
      "job_access_notes_changed", "notify_helper_on_direct_offer", "notify_poster_on_status_change", "notify_user_on_review",
    ]) {
      expect(blankSqlComments(defs.get(p)!.stmt), p).toMatch(/public\.member_display_name\(/);
    }
  });

  it("every edge producer that touches a name field uses memberDisplayName (or is listed with why)", () => {
    const bad = edge.filter((k) => NAME_FIELD.test(edgeCode(k)) && !/\bmemberDisplayName\s*\(/.test(edgeCode(k)) && !(k in EDGE_RAW_NAME_OK));
    expect(bad).toEqual([]);
  });

  it("every edge exception is still a producer that touches a name field without the helper (two-way)", () => {
    for (const k of Object.keys(EDGE_RAW_NAME_OK)) {
      expect(edge, k).toContain(k);
      expect(NAME_FIELD.test(edgeCode(k)) && !/\bmemberDisplayName\s*\(/.test(edgeCode(k)), k).toBe(true);
    }
  });

  it("the gift-card notice and email name the donor through memberDisplayName", () => {
    expect(edgeCode("stripe-webhook/handlers/checkoutSessionCompleted")).toMatch(
      /const donorName = memberDisplayName\(\(session\.metadata as any\)\?\.donor_name as string \| undefined, "Someone"\);/,
    );
    expect(blankComments(readFileSync(edgeFile("create-gift-card-checkout"), "utf8"))).not.toMatch(/email\.split\("@"\)/);
  });

  it("the edge helper and formatName are the same rule", () => {
    for (const s of ["Andre Landry", "  Andre   Jean  Landry ", "Madonna", "", "   ", null, undefined, "Mary-Kate O'Neil"]) {
      expect(memberDisplayName(s, "X"), String(s)).toBe(formatName(s, "X"));
    }
  });

  it("the SQL helper is defined once, on the same rule (first word + last word's initial + '.')", () => {
    const def = defs.get("member_display_name");
    // Restated in 20261021131322 with formatName's exact whitespace set (src/test/memberNamesMaskedInResponses.test.ts).
    expect(def?.file).toBe("20261021131322_member_names_first_and_initial.sql");
    expect(def!.stmt).toMatch(/v\.parts\[1\] \|\| ' ' \|\| left\(v\.parts\[array_length\(v\.parts, 1\)\], 1\) \|\| '\.'/);
  });
});
