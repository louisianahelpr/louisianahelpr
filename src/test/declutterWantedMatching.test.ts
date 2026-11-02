/**
 * Declutter posting audit 10-30, on the EFFECTIVE definitions (effectiveDefs replays every migration, so a later
 * restatement that drops a rule turns this red). Behaviour is proven in
 * src/test/pglite/declutterWantedMatchManage.pglite.mjs (red without the migration).
 *   #4: a post matches on any meaningful word and on near categories, not every word in the identical category.
 *   #5: the seller's alert opens the answer on that post with that listing.
 *   #9: edit, post again and remove each check who is asking first, and a removed post leaves the list.
 *   #11: the client and the server allow the same characters.
 *
 * @mutate supabase/migrations/20261030221255_declutter_wanted_match_and_manage.sql |      AND to_tsvector('english', i.title \|\| ' ' \|\| i.description) @@ public.declutter_wanted_tsquery(w.what) |      AND to_tsvector('english', i.title \|\| ' ' \|\| i.description) @@ plainto_tsquery('english', w.what)
 * @mutate supabase/migrations/20261030221255_declutter_wanted_match_and_manage.sql |       ON public.declutter_wanted_category_near(i.category) && public.declutter_wanted_category_near(w.category) |       ON i.category = w.category
 * @mutate supabase/migrations/20261030221255_declutter_wanted_match_and_manage.sql |     WHEN 'bikes' THEN ARRAY['outdoors', 'kids'] |     WHEN 'bikes' THEN ARRAY['kids']
 * @mutate supabase/migrations/20261030221255_declutter_wanted_match_and_manage.sql |       '/declutter?tab=wanted&answer=' \|\| w.id::text \|\| '&item=' \|\| i.id::text); |       '/declutter/item/' \|\| i.id::text);
 * @mutate supabase/migrations/20261030221255_declutter_wanted_match_and_manage.sql |   SELECT * INTO v_w FROM public.declutter_wanted WHERE id = p_wanted_id AND user_id = v_uid AND removed_at IS NULL FOR UPDATE;\n  IF NOT FOUND THEN\n    RAISE EXCEPTION 'wanted_not_found' USING ERRCODE = 'P0002';\n  END IF;\n  IF v_w.status <> 'open' |   SELECT * INTO v_w FROM public.declutter_wanted WHERE id = p_wanted_id AND removed_at IS NULL FOR UPDATE;\n  IF NOT FOUND THEN\n    RAISE EXCEPTION 'wanted_not_found' USING ERRCODE = 'P0002';\n  END IF;\n  IF v_w.status <> 'open'
 * @mutate supabase/migrations/20261102013814_declutter_my_wanted_reply_deadlines.sql |     WHERE w.user_id = v_uid\n       AND w.removed_at IS NULL\n |     WHERE w.user_id = v_uid\n
 * @mutate src/lib/declutter/wanted.ts | const LETTER = "A-Za-zÀ-ÖØ-öø-ÿĀ-ſ"; | const LETTER = "A-Za-z";
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";
import { CATEGORIES } from "@/lib/declutter/categoryIcons";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const ROOT = join(__dirname, "../..");
const defs = effectiveDefs(join(ROOT, "supabase/migrations"));
const body = (name: string) => blankSqlComments(defs.get(name)?.stmt ?? "");
const TAG: Record<string, string> = { Home: "home", Outdoors: "outdoors", Family: "family", "Hobbies and fun": "fun", Other: "misc" };

describe("Wanted matching and managing a post (posting audit 10-30)", () => {
  it("#4: pairs match on any meaningful word and near categories", () => {
    const pairs = body("declutter_wanted_pairs");
    expect(pairs.length).toBeGreaterThan(800);
    expect(pairs).toContain("public.declutter_wanted_tsquery(w.what)");
    expect(pairs).not.toContain("plainto_tsquery('english', w.what)");
    expect(pairs).toMatch(/declutter_wanted_category_near\(i\.category\)\s*&&\s*public\.declutter_wanted_category_near\(w\.category\)/);
    expect(pairs).not.toMatch(/i\.category\s*=\s*w\.category/);
  });

  it("#4: every category on the picker is listed under its own heading, and Other is near all of them", () => {
    const near = body("declutter_wanted_category_near");
    expect(CATEGORIES.length).toBeGreaterThan(30);
    for (const c of CATEGORIES) {
      const row = near.match(new RegExp(`WHEN '${c.key}' THEN ARRAY\\[([^\\]]*)\\]`));
      expect(row, c.key).not.toBeNull();
      if (c.key !== "other") expect(row![1], c.key).toContain(`'${TAG[c.group]}'`);
    }
    const other = near.match(/WHEN 'other' THEN ARRAY\[([^\]]*)\]/)![1];
    for (const tag of Object.values(TAG)) expect(other).toContain(`'${tag}'`);
  });

  it("#5: the seller's alert links to the answer; the poster's still links to the listing", () => {
    const m = body("declutter_wanted_record_match");
    expect(m).toContain("'/declutter?tab=wanted&answer=' || w.id::text || '&item=' || i.id::text");
    expect(m).toContain("'/declutter/item/' || i.id::text");
  });

  it("#9: each new way to change a post is the caller's own post only, behind both switches", () => {
    for (const name of ["declutter_update_wanted", "declutter_reopen_wanted", "declutter_remove_wanted"]) {
      const b = body(name);
      expect(b, name).toContain("require_feature('declutter_wanted')");
      expect(b, name).toContain("is_caller_banned()");
      expect(b, name).toMatch(/WHERE id = p_wanted_id AND user_id = v_uid AND removed_at IS NULL FOR UPDATE/);
    }
    expect(body("declutter_my_wanted")).toContain("w.removed_at IS NULL");
  });

  it("#11: the client allows the same letters and marks as the server", () => {
    const server = body("declutter_wanted_text_problem");
    const client = readFileSync(join(ROOT, "src/lib/declutter/wanted.ts"), "utf8");
    const letters = client.match(/const LETTER = "([^"]+)"/)![1];
    expect(letters.length).toBeGreaterThan(8);
    expect(server).toContain(`[${letters}0-9 .,''’&()/#+"“”-]`);
    expect(client).toContain(`0-9 .,'’&()/#+"“”-]`);
    expect(body("declutter_create_wanted")).toContain("declutter_wanted_text_problem(v_what)");
    expect(body("declutter_update_wanted")).toContain("declutter_wanted_text_problem(v_what)");
  });
});
