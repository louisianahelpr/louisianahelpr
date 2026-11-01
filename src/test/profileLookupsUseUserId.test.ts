// @mutate supabase/migrations/20261101040158_profile_lookups_by_user_id.sql |                     WHERE p.user_id = v_uid AND nullif | WHERE p.id = v_uid AND nullif
// @mutate supabase/migrations/20261101040158_profile_lookups_by_user_id.sql | FROM public.profiles p WHERE p.user_id = v_uid) | FROM public.profiles p WHERE p.id = v_uid)
// @mutate supabase/migrations/20261101174857_free_ask_picks_a_pickup_time.sql | LEFT JOIN public.profiles p ON p.user_id = r.requester_id | LEFT JOIN public.profiles p ON p.id = r.requester_id
//
// Lead 10-31: three live lookups read a member's profile by profiles.id = <the member's auth id>. A member's id is
// profiles.user_id (handle_new_user inserts user_id = auth.users.id; profiles.id is the row's own generated uuid), so
// each never matched: members with a phone never got the text-alerts prompt, and a free item's giver was told "A
// neighbor asked" with no names on the list. Fixed in 20261101040158_profile_lookups_by_user_id.sql.
//
// The CLASS: in the NEWEST definition of every function, a profiles alias compared by `.id` to a value is a bug
// unless the same statement also compares that alias's `.user_id` to the same value (the deliberate either-id lookups:
// get_public_profile_stats, get_public_profile_reviews, get_safe_profiles' callers' deep links,
// get_thread_counterparty_deleted). Behaviour proof: src/test/pglite/profileLookupsByUserId.pglite.mjs.
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const NOT_ALIAS = /^(where|on|join|left|inner|set|using|group|order|limit|as)$/i;

/** Every function whose newest body reads public.profiles, with its `<alias>.id = <value>` lookups that have no
 *  matching `<alias>.user_id = <value>` in the same body. */
function inventory() {
  const readers: string[] = [];
  const bad: string[] = [];
  for (const [name, def] of DEFS) {
    const sql = blankSqlComments(def.stmt);
    if (!/\bprofiles\b/i.test(sql)) continue;
    readers.push(name);
    for (const m of sql.matchAll(/\bprofiles\s+(?:AS\s+)?(\w+)\b/gi)) {
      const a = m[1];
      if (NOT_ALIAS.test(a)) continue;
      // The statement the alias lives in (an alias like p is reused for other tables in the same body).
      const end = sql.indexOf(";", m.index);
      const stmt = sql.slice(sql.lastIndexOf(";", m.index) + 1, end < 0 ? undefined : end);
      for (const k of stmt.matchAll(new RegExp(`\\b${a}\\.id\\s*=\\s*([\\w.]+)`, "gi"))) {
        const v = k[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (!new RegExp(`\\b${a}\\.user_id\\s*=\\s*${v}\\b`, "i").test(stmt)) bad.push(`${name} (${def.file}): ${a}.id = ${k[1]}`);
      }
    }
    for (const k of sql.matchAll(/\bprofiles\s+WHERE\s+id\s*=\s*([\w.]+)/gi)) bad.push(`${name} (${def.file}): profiles WHERE id = ${k[1]}`);
  }
  return { readers, bad: [...new Set(bad)] };
}

describe("a member's profile is looked up by profiles.user_id", () => {
  it("no newest function compares profiles.id to a member id without also asking user_id", () => {
    const { readers, bad } = inventory();
    expect(readers.length).toBeGreaterThan(50);
    expect(bad).toEqual([]);
  });
});
