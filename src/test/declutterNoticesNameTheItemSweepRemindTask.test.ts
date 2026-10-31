/**
 * Declutter notices name the item: the three senders Builder 13 found still unnamed on prod (AUD31-17/34, 2026-10-31),
 * fixed in 20261031181404_declutter_notices_name_the_item_sweep_remind_task (backend proof:
 * src/test/pglite/declutterNoticesNameTheItemSweepRemindTask.pglite.mjs, 44 PASS; NEW_MIGRATION=skip 7 FAIL).
 *
 * THE CLASS, read from the EFFECTIVE definition of each function (helpers/effectiveFunctionDefs):
 *   1. every notice the handover sweep sends is written after its own loop locked the order (declutter_lock_order
 *      records the order the item name is read from); a loop that notifies without locking named another order's
 *      item or none ("Delivery coming up");
 *   2. the pickup reminder's email carries the same named message the bell row does;
 *   3. the Helpr's "Delivery cancelled" names the task's item and opens Deliver (?tab=deliver);
 *   4. "Refund request withdrawn" (AUD31-33) no longer promises the 24-hour rule the owner replaced on 10-30;
 *   5. (AUD31-22) a notice whose title is built at run time (CASE, format, a variable) still files under a Declutter
 *      kind: its kind is a Declutter one, job_match on purpose, or one declutter_notice_type's kind fallback maps.
 *
 * @mutate supabase/migrations/20261031181404_declutter_notices_name_the_item_sweep_remind_task.sql |       o := public.declutter_lock_order(r.order_id); |       SELECT * INTO o FROM public.declutter_orders WHERE id = r.order_id;
 * @mutate supabase/migrations/20261031181404_declutter_notices_name_the_item_sweep_remind_task.sql |         'message', public.declutter_price_words(public.declutter_notice_names_item(p_user, p_other, p_link, p_message)), |         'message', p_message,
 * @mutate supabase/migrations/20261031181404_declutter_notices_name_the_item_sweep_remind_task.sql | format('The delivery of "%s" was cancelled. You do not need to go.', t.title), '/declutter?tab=deliver', | 'A delivery you took was cancelled. You do not need to go.', '/declutter?tab=deliver',
 * @mutate supabase/migrations/20261031181404_declutter_notices_name_the_item_sweep_remind_task.sql | t.title), '/declutter?tab=deliver', t.customer_id); | t.title), '/declutter?view=deliver', t.customer_id);
 * @mutate supabase/migrations/20261031181404_declutter_notices_name_the_item_sweep_remind_task.sql |     'The buyer took back their refund request. Your payout goes ahead as usual.', |     'The buyer took back their refund request. You''re paid when the sale is final, 24 hours after the handover.',
 * @mutate supabase/migrations/20261030170443_declutter_question_kind.sql |     WHEN p_type IN ('payment', 'financial_alerts') THEN 'declutter_sales' |     WHEN p_type IN ('financial_alerts') THEN 'declutter_sales'
 */
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const code = (fn: string): string => {
  const def = DEFS.get(fn);
  expect(def, `${fn} has a definition`).toBeTruthy();
  return blankSqlComments(def!.stmt);
};
/** The top-level arguments of the call whose "(" is at `open` (quoted text and nested calls respected). */
function topArgs(src: string, open: number): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = open + 1; i < src.length; i++) {
    const c = src[i];
    if (c === "'") {
      let j = i + 1;
      while (j < src.length && !(src[j] === "'" && src[j + 1] !== "'")) j += src[j] === "'" ? 2 : 1;
      cur += src.slice(i, j + 1);
      i = j;
      continue;
    }
    if (c === "(") depth++;
    if (c === ")") {
      if (depth === 0) { out.push(cur.trim()); return out; }
      depth--;
    }
    if (c === "," && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  return out;
}


describe("Declutter notices name the item: the sweep, the pickup email, the Helpr's cancel (20261031181404)", () => {
  it("every notice the handover sweep sends follows its own loop's lock of the order", () => {
    const sw = code("declutter_handover_sweep");
    const calls = [...sw.matchAll(/public\.declutter_notify(?:_strict)?\(/g)].map((m) => m.index!);
    // Inventory floor: the sweep's reminders, nudges and the admin hand-off all notify.
    expect(calls.length).toBeGreaterThan(4);
    const unlocked = calls.filter((at) => {
      const loopStart = sw.lastIndexOf("FOR r IN", at);
      expect(loopStart).toBeGreaterThan(-1);
      return !/public\.declutter_lock_order\(r\.(?:id|order_id)\)/.test(sw.slice(loopStart, at));
    }).map((at) => sw.slice(at, at + 90).replace(/\s+/g, " "));
    expect(unlocked).toEqual([]);
  });

  it("the pickup reminder's email sends the bell's named message, not the raw one", () => {
    const pr = code("declutter_pickup_remind");
    const body = pr.slice(pr.indexOf("net.http_post"));
    expect(body.length).toBeGreaterThan(100);
    expect(body).toMatch(/'message',\s*public\.declutter_price_words\(public\.declutter_notice_names_item\(p_user, p_other, p_link, p_message\)\)/);
  });

  it("the Helpr's Delivery cancelled names the task's item and opens Deliver", () => {
    const tc = code("helpr_task_close");
    const at = tc.indexOf("'Delivery cancelled'");
    expect(at).toBeGreaterThan(0);
    const call = tc.slice(at, tc.indexOf(";", at));
    expect(call).toMatch(/t\.title/);
    expect(call).toMatch(/'\/declutter\?tab=deliver'/);
    expect(call).not.toMatch(/\?view=/);
  });

  it("Refund request withdrawn no longer promises the replaced 24-hour rule (AUD31-33)", () => {
    const wr = code("declutter_withdraw_refund");
    const at = wr.indexOf("'Refund request withdrawn'");
    expect(at).toBeGreaterThan(0);
    const call = wr.slice(at, wr.indexOf(";", at));
    expect(call).not.toMatch(/24 hours after the handover|sale is final/);
    expect(call).toMatch(/'\/declutter\?tab=selling'/);
  });

  it("a notice whose title is built at run time still files under a Declutter kind (AUD31-22)", () => {
    // The kind fallback in declutter_notice_type: the generic kinds a Declutter link is filed under, whatever the title.
    const nt = code("declutter_notice_type");
    const mapped = new Set<string>();
    for (const m of nt.matchAll(/WHEN p_type IN \(([^)]*)\) THEN 'declutter_\w+'/g)) {
      for (const k of m[1].matchAll(/'(\w+)'/g)) mapped.add(k[1]);
    }
    expect(mapped.size).toBeGreaterThan(5);
    // Every sender whose title is not one literal: its kind is a Declutter kind, job_match (saved-search alerts follow
    // the member's job-match switch on purpose), or one the fallback maps.
    const runTime: string[] = [];
    for (const [fn, def] of DEFS) {
      if (fn === "declutter_notify" || fn === "declutter_notify_strict" || fn === "declutter_pickup_remind") continue;
      const body = blankSqlComments(def.stmt);
      for (const m of body.matchAll(/public\.declutter_notify(?:_strict)?\(/g)) {
        const [, kindArg = "", title = ""] = topArgs(body, m.index! + m[0].length - 1);
        if (/^'(?:[^']|'')*'$/.test(title)) continue;
        const kind = kindArg.replace(/^'|'$/g, "");
        runTime.push(`${fn}: ${kind}`);
        expect(kind.startsWith("declutter_") || kind === "job_match" || mapped.has(kind), `${fn} sends kind ${kindArg} with a run-time title`).toBe(true);
      }
    }
    expect(runTime.length).toBeGreaterThan(5);
  });
});
