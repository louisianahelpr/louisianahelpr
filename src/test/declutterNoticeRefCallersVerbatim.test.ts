/**
 * Q2659: the actionable Declutter notices carry what they are about (notifications.declutter_ref), so the bell stops
 * counting them once that cart line, order or offer moves on (migration 20261102113853, PGlite proof
 * src/test/pglite/declutterNoticesRetire.pglite.mjs).
 *
 * Two checks over the migrations (newest definition of each function, any dollar-quote tag, comments blanked for the
 * class check):
 *   1. VERBATIM: each function that migration restates equals its previous newest definition once its Q2659 lines
 *      are taken out (the callers' "PERFORM public.declutter_notice_ref(<id>); -- Q2659" lines; the writers' marked
 *      hunks). A restate that dropped or changed anything else is red.
 *   2. CLASS: in the NEWEST definition of every function, each notice with an actionable title is preceded by its
 *      declutter_notice_ref line, and declutter_notify_strict still stores declutter_ref, so a later restate from an
 *      older base cannot quietly bring back notices that never retire.
 *
 * @mutate supabase/migrations/20261103202118_declutter_porch_got_it_waits_for_photo.sql |     PERFORM public.declutter_notice_ref(p_order_id); -- Q2659\n    PERFORM public.declutter_notify(o.buyer_id, 'declutter_pickups', 'It''s on the porch |     PERFORM public.declutter_notify(o.buyer_id, 'declutter_pickups', 'It''s on the porch
 * @mutate supabase/migrations/20261102113853_declutter_notices_retire_when_their_subject_moves_on.sql |   INSERT INTO public.notifications (user_id, type, title, declutter_ref, message, link) |   INSERT INTO public.notifications (user_id, type, title, job_id, message, link)
 * @mutate supabase/migrations/20261102113853_declutter_notices_retire_when_their_subject_moves_on.sql |      WHERE item_id = p_item_id AND status = 'open'\n    RETURNING id, buyer_id |      WHERE item_id = p_item_id\n    RETURNING id, buyer_id
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "@/test/helpers/blankNonCode";

const DIR = join(process.cwd(), "supabase/migrations");
const NEW = "20261102113853_declutter_notices_retire_when_their_subject_moves_on.sql";
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

/** Every CREATE FUNCTION public.<name> in `sql`, in order, as raw text up to its closing dollar tag. */
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
const newSql = readFileSync(join(DIR, NEW), "utf8");
const CALLERS = ["declutter_take_item", "declutter_book_porch_day", "declutter_porch_photo", "declutter_make_offer", "declutter_respond_offer"];

describe("the Q2659 restates are verbatim apart from the ref", () => {
  it.each(CALLERS)("%s", (fn) => {
    const mine = definitions(newSql, fn);
    expect(mine).toHaveLength(1);
    const prev = newestBefore(fn, NEW);
    expect(prev).not.toBeNull();
    const back = mine[0].replace(/\n[ \t]*PERFORM public\.declutter_notice_ref\([a-z_]+\); -- Q2659(?=\n)/g, "");
    expect(back).not.toBe(mine[0]);
    expect(back.replace(/\$function\$|\$fn\$/g, "$$")).toBe(prev!.replace(/\$function\$|\$fn\$/g, "$$"));
  });

  it("declutter_notify_strict", () => {
    const mine = definitions(newSql, "declutter_notify_strict");
    expect(mine).toHaveLength(1);
    const back = mine[0]
      .replace(/ {2}-- Q2659: set by declutter_notice_ref[^\n]*\n {2}v_ref text := [^\n]*\n/, "")
      .replace("  PERFORM set_config('declutter.notice_ref', '', true); -- Q2659: one notice only, whatever happens below\n", "")
      .replace(/ {2}-- Q2659: the cart line, order or offer[^\n]*\n {2}-- the notice stops[^\n]*\n/, "")
      .replace("(user_id, type, title, declutter_ref, message, link)", "(user_id, type, title, message, link)")
      .replace(/ p_title,\n\s+CASE WHEN v_ref ~ [^\n]* END,\n/, " p_title,\n");
    expect(back).not.toBe(mine[0]);
    expect(back).toBe(newestBefore("declutter_notify_strict", NEW));
  });

  it("declutter_notify", () => {
    const mine = definitions(newSql, "declutter_notify");
    expect(mine).toHaveLength(1);
    const back = mine[0].replace(/ {2}-- Q2659: a failed notice[^\n]*\n {2}PERFORM set_config\('declutter\.notice_ref', '', true\);\n/, "");
    expect(back).not.toBe(mine[0]);
    expect(back).toBe(newestBefore("declutter_notify", NEW));
  });
});

const ACTIONABLE = [
  "Reserved for you: check out within", "Sold: waiting for the buyer to pay", "It''s yours: pick a pickup within 48 hours",
  "Porch pickup day booked", "It''s on the porch: pick it up today", "'New offer'", "'New counteroffer'",
];

/** The newest definition of every public function across all migrations, comments blanked. */
function newestAll(): Map<string, string> {
  const map = new Map<string, string>();
  const head = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.([a-z0-9_]+)\s*\(/gi;
  for (const f of FILES) {
    const sql = blankSqlComments(readFileSync(join(DIR, f), "utf8"));
    for (const m of sql.matchAll(head)) {
      const d = definitions(sql.slice(m.index), m[1])[0];
      if (d) map.set(m[1], d);
    }
  }
  return map;
}

describe("every actionable Declutter notice carries its ref (class)", () => {
  const all = newestAll();
  it("reads the inventory", () => expect(all.size).toBeGreaterThan(1000));

  it("each actionable notice call, in the newest definitions, is preceded by its declutter_notice_ref line", () => {
    const bad: string[] = [];
    let seen = 0;
    for (const [fn, body] of all) {
      const re = /PERFORM public\.declutter_notify(?:_strict)?\(/g;
      for (const m of body.matchAll(re)) {
        const head = body.slice(m.index, m.index + 400).split(/;\s*\n/)[0];
        if (!ACTIONABLE.some((t) => head.includes(t))) continue;
        seen++;
        const before = body.slice(0, m.index).trimEnd();
        if (!/PERFORM public\.declutter_notice_ref\([a-z_.]+\);$/.test(before)) bad.push(`${fn}: ${head.slice(0, 120).replace(/\s+/g, " ")}`);
      }
    }
    expect(seen).toBeGreaterThanOrEqual(10);
    expect(bad).toEqual([]);
  });

  it("declutter_notify_strict stores declutter_ref", () => {
    expect(all.get("declutter_notify_strict")).toMatch(/INSERT INTO public\.notifications \([^)]*\bdeclutter_ref\b[^)]*\)/);
  });
});
