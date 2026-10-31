/**
 * Both sides hear Louisiana Helpr's decision on a reported problem (Declutter audit 2, 2026-10-28: SH2-5 / A2-14;
 * migration 20261028223738). After an admin decided, neither side was told the outcome except on one path; the
 * seller of a sale decided "Damaged in delivery" heard only "Handover done".
 *
 * THE CLASS: every declutter_admin_decide_* function (EXACT list, both ways, from the effective definitions) writes
 * a "Louisiana Helpr decided" notice to the order's buyer AND its seller, each opening the recipient's own tab, and
 * no member notice in them carries the admin's note (p_note / admin_note): it was written as an internal note.
 * Paths are proven in PGlite: src/test/pglite/declutterProblemDecisionNotices.pglite.mjs (prod's bodies md5-checked,
 * every path told once, 3x replay; RED before it and on 5 planted defects).
 */
// @mutate supabase/migrations/20261031231150_helpr_delivery_cant_finish.sql |     PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Louisiana Helpr decided',\n      format('We looked at both sides of the problem with %s. %s' |     PERFORM public.declutter_notify(v_task.helpr_id, 'payment', 'Louisiana Helpr decided',\n      format('We looked at both sides of the problem with %s. %s'
// @mutate supabase/migrations/20261031184929_declutter_damage_notices_name_the_item.sql |   PERFORM public.declutter_notify(o.seller_id, 'payment', 'Louisiana Helpr decided',\n    format( |   PERFORM public.declutter_notify(v_task.helpr_id, 'payment', 'Louisiana Helpr decided',\n    format(
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));

/** declutter_notify calls in a body: [recipient, title, message, link]. */
function notices(fn: string): { to: string; title: string; message: string; link: string }[] {
  const src = blankSqlComments(DEFS.get(fn)?.stmt ?? "");
  const out: { to: string; title: string; message: string; link: string }[] = [];
  for (const m of src.matchAll(/declutter_notify(?:_strict)?\s*\(/g)) {
    const args: string[] = [];
    let depth = 0, cur = "";
    for (let i = m.index! + m[0].length; i < src.length; i++) {
      const c = src[i];
      if (c === "'") { let j = i + 1; while (j < src.length && !(src[j] === "'" && src[j + 1] !== "'")) j += src[j] === "'" ? 2 : 1; cur += src.slice(i, j + 1); i = j; continue; }
      if (c === "(") depth++;
      if (c === ")") { if (depth === 0) { args.push(cur.trim()); break; } depth--; }
      if (c === "," && depth === 0) { args.push(cur.trim()); cur = ""; continue; }
      cur += c;
    }
    out.push({ to: args[0], title: args[2] ?? "", message: (args[3] ?? "").replace(/\s+/g, " "), link: args[4] ?? "" });
  }
  return out;
}

const DECIDERS = [...DEFS.keys()].filter((fn) => fn.startsWith("declutter_admin_decide_")).sort();

describe("both sides hear the admin's decision on a reported problem", () => {
  it("knows every decision function (exact)", () => {
    expect(DECIDERS).toEqual(["declutter_admin_decide_delivery_damage", "declutter_admin_decide_problem"]);
  });

  it.each(DECIDERS)("%s tells the buyer and the seller, each on their own tab", (fn) => {
    const decided = notices(fn).filter((n) => n.title === "'Louisiana Helpr decided'");
    expect(decided.filter((n) => n.to === "o.buyer_id").map((n) => n.link)).toContain("'/declutter?tab=buying'");
    expect(decided.filter((n) => n.to === "o.seller_id").map((n) => n.link)).toContain("'/declutter?tab=selling'");
  });

  it.each(DECIDERS)("%s never puts the admin's note in a member's notice", (fn) => {
    const leaks = notices(fn).filter((n) => /\bp_note\b|admin_note/.test(n.message));
    expect(leaks).toEqual([]);
  });
});
