/**
 * Push routing for Declutter notices (owner 2026-10-28 via the lead: in-app +
 * push for Declutter; migration 20261028162048).
 *
 * A Declutter notice reaches the phone through fan_out_push_on_notification ->
 * send-push-notification. Two things decide what the member gets:
 *
 *   1. WHETHER it is pushed: the trigger looks the notice's type up in
 *      notification_type_pref_map and reads that column of the member's
 *      notification_preferences. Each declutter_* type must route to its OWN
 *      column (the Declutter group's switch), never a jobs column. Proven on a
 *      real database in src/test/pglite/declutterNoticeKinds.pglite.mjs; this
 *      file pins the routing source the trigger reads.
 *   2. WHAT buttons it carries: send-push-notification infers an APNs category
 *      from the link. A Declutter sale must not arrive with a job's Apply/Save
 *      or Message/View buttons.
 */
// @mutate supabase/functions/send-push-notification/category.ts |   if (path.startsWith('/posts') \|\| path.startsWith('/jobs')) { |   if (path.startsWith('/posts') \|\| path.startsWith('/jobs') \|\| path.startsWith('/declutter')) {
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs";
import { blankSqlComments } from "../helpers/blankNonCode";

const CATEGORY_PATH = "../../../supabase/functions/send-push-notification/category.ts";
const { inferCategoryFromLink } = (await import(/* @vite-ignore */ CATEGORY_PATH)) as {
  inferCategoryFromLink(link: string | null | undefined): string | undefined;
};

const MIGRATIONS = resolve(__dirname, "../../../supabase/migrations");
const DEFS = effectiveDefs(MIGRATIONS);
const KINDS = ["declutter_listings", "declutter_offers", "declutter_sales", "declutter_pickups",
  "declutter_refunds", "declutter_price_drops", "declutter_wanted"];

/** Every literal Declutter link a declutter_notify caller writes (the push's `link`). */
function declutterLinks(): string[] {
  const out = new Set<string>();
  for (const [fn, def] of DEFS) {
    if (fn === "declutter_notify") continue;
    const code = blankSqlComments(def.stmt);
    if (!/declutter_notify\s*\(|declutter_wanted_notify\s*\(|INSERT\s+INTO\s+public\.notifications/i.test(code)) continue;
    for (const m of code.matchAll(/'(\/declutter[^' ]*)'/g)) out.add(m[1]);
  }
  return [...out].sort();
}

describe("Declutter push routing", () => {
  const links = declutterLinks();

  it("reads the links the notices really carry (floor)", () => {
    expect(links.length).toBeGreaterThan(8);
    expect(links).toContain("/declutter?view=cart");
    expect(links).toContain("/declutter/item/");
  });

  it("a Declutter push carries no job action buttons", () => {
    for (const l of links) expect(inferCategoryFromLink(l), l).toBeUndefined();
    expect(inferCategoryFromLink("/declutter?tab=selling")).toBeUndefined();
  });

  it("the push gate reads each notice's switch from the type map, with no type hard-coded past it", () => {
    const fan = blankSqlComments(DEFS.get("fan_out_push_on_notification")?.stmt ?? "");
    expect(fan).toMatch(/FROM\s+public\.notification_type_pref_map\s+WHERE\s+type\s*=\s*NEW\.type/i);
    expect(fan).toMatch(/push_enabled\s+IS\s+NOT\s+TRUE/i);
    expect(fan).not.toMatch(/declutter/i);
  });

  it("each Declutter kind is gated by its own Declutter column, in the migration that defines it", () => {
    const src = blankSqlComments(DEFS.get("declutter_notice_type")?.stmt ?? "");
    expect(src.length).toBeGreaterThan(500);
    for (const k of KINDS) expect(src, k).toContain(`'${k}'`);
  });
});
