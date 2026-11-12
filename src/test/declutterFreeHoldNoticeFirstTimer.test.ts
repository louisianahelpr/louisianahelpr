/**
 * 11-07 free-claim trace (lead lexilombas-de): the notice a member gets when a giver picks them for a free item said
 * "Nothing is charged." though, with the ID check on, a first-timer is next asked for the one-time fee and the ID check
 * (declutter_free_claim_gate). 20261107185819 restates declutter_take_item VERBATIM with only that sentence changed to
 * declutter_free_hold_charge_words(p_buyer), which follows the gate's own rule. Behaviour:
 * src/test/pglite/declutterFreeHoldNoticeFirstTimer.pglite.mjs (applied 3x; red with NEW_MIGRATION=skip).
 *
 * @mutate supabase/migrations/20261112023602_declutter_reserved_notice_says_who_accepted.sql | it goes back up. %s',\n               v_title, public.declutter_free_hold_charge_words(p_buyer)), | it goes back up. Nothing is charged.',\n               v_title),
 * @mutate supabase/migrations/20261107185819_declutter_free_pick_notice_first_timer.sql |       OR (public.declutter_setup_fee_due_cents(p_buyer) = 0 AND public.is_identity_verified(p_buyer))\n |       OR true\n
 * @mutate supabase/migrations/20261112023602_declutter_reserved_notice_says_who_accepted.sql |   v_seller uuid;\n  v_title text; |   v_seller uuid;\n  v_title text;\n  v_unused integer;
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankSqlComments } from "./helpers/blankNonCode";
import { newestFunction } from "./helpers/parityReaders";

const DIR = join(process.cwd(), "supabase/migrations");
const NEW = "20261107185819_declutter_free_pick_notice_first_timer.sql";
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

function definitions(sql: string, name: string): string[] {
  const out: string[] = [];
  const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
  for (const m of sql.matchAll(head)) {
    const rest = sql.slice(m.index);
    const tag = /\bAS\s+(\$\w*\$)/i.exec(rest);
    if (!tag) continue;
    const end = rest.indexOf(tag[1], tag.index + tag[0].length);
    out.push(rest.slice(0, end + tag[1].length));
  }
  return out;
}
function newestBefore(name: string, before: string): string | null {
  let last: string | null = null;
  for (const f of FILES.filter((x) => x < before)) {
    const d = definitions(readFileSync(join(DIR, f), "utf8"), name);
    if (d.length) last = d[d.length - 1];
  }
  return last;
}

describe("the free hold notice tells a first-timer about the ID check (11-07)", () => {
  const mine = definitions(readFileSync(join(DIR, NEW), "utf8"), "declutter_take_item");

  it("declutter_take_item is restated verbatim apart from that one sentence", () => {
    expect(mine).toHaveLength(1);
    const prev = newestBefore("declutter_take_item", NEW);
    expect(prev).not.toBeNull();
    const back = mine[0].replace(
      "it goes back up. %s',\n               v_title, public.declutter_free_hold_charge_words(p_buyer)),",
      "it goes back up. Nothing is charged.',\n               v_title),",
    );
    expect(back).not.toBe(mine[0]);
    expect(back).toBe(prev);
  });

  it("the newest take_item is this one, and its free notice uses the helper", () => {
    // 20261108202546 (Declutter buy audit 11-08, M1) restates take_item; its free branch is unchanged.
    // 20261110205345 (audit 11-10 F508) restates it with shorter push titles only; the free branch is unchanged.
    // 20261110223800 (audit 11-10 F481) names the checkout deadline in the paid buyer notice only; the free branch is unchanged.
    // 20261112004748 (F356 follow-up) names the buyer in the SELLER's notices only; the buyer's free notice is unchanged.
    // 20261112010200 (Wanted / block / ban anonymity) leaves the buyer's free notice unchanged too.
    expect([NEW, "20261108202546_declutter_notices_email_and_honest_sold.sql", "20261110205345_push_titles_fit_lock_screen.sql", "20261110223800_declutter_reserved_notice_names_the_deadline.sql", "20261112004748_declutter_seller_notices_name_the_buyer.sql", "20261112010200_declutter_wanted_reserved_notice_keeps_seller_anonymous.sql", "20261112022921_declutter_wanted_reserved_notice_names_seller_again.sql", "20261112023602_declutter_reserved_notice_says_who_accepted.sql"]).toContain(newestFunction("declutter_take_item").file);
    const body = blankSqlComments(newestFunction("declutter_take_item").body);
    const free = body.slice(body.indexOf("IF p_price = 0 THEN"), body.indexOf("ELSIF p_source = 'buy' THEN"));
    expect(free.length).toBeGreaterThan(200);
    expect(free).toContain("public.declutter_free_hold_charge_words(p_buyer)");
    expect(free).not.toContain("Nothing is charged.");
  });

  it("the helper follows declutter_free_claim_gate: admin, exempt, or fee paid AND verified -> nothing charged", () => {
    const h = blankSqlComments(newestFunction("declutter_free_hold_charge_words").body).replace(/\s+/g, " ");
    expect(h).toContain("EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p_buyer AND ur.role = 'admin')");
    expect(h).toContain("OR public.identity_check_exempt(p_buyer)");
    expect(h).toContain("OR (public.declutter_setup_fee_due_cents(p_buyer) = 0 AND public.is_identity_verified(p_buyer))");
    expect(h).toContain("THEN 'Nothing is charged.'");
    // The gate itself checks the same three facts.
    const gate = blankSqlComments(newestFunction("declutter_free_claim_gate").body);
    for (const fact of ["identity_check_exempt(p_member)", "declutter_setup_fee_due_cents(p_member) > 0", "is_identity_verified(p_member)"]) {
      expect(gate, fact).toContain(fact);
    }
    const sql = blankSqlComments(readFileSync(join(DIR, NEW), "utf8"));
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.declutter_free_hold_charge_words(uuid) FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.declutter_take_item(uuid, uuid, integer, text, uuid) FROM PUBLIC, anon, authenticated;");
  });
});
