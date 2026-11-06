/**
 * Shops variants: option list names and choices pass the item word check (20261106194243_shops_option_words_checked.sql,
 * Builder 4, 11-06; recommendation logged in OWNER-DECISIONS, owner may override). Owner rule: content goes live at
 * once and only a failed automatic check goes to an admin. So a live item whose options fail shop_item_text_flag waits
 * for an admin, as a live title edit does, and a draft's options are checked when it is listed.
 *
 * Behaviour proof: src/test/pglite/shopsItemVariants.pglite.mjs section 8b (64 PASS; WORDS_MIGRATION=skip 5 FAIL;
 * 5 planted defects RED, measured 11-06) and section 8c, the review follow-ups in
 * 20261106201659_shops_option_words_hold_like_edits.sql (77 PASS; FOLLOWUP_MIGRATION=skip 7 FAIL, measured 11-06).
 * This file keeps the newest bodies wired the same way.
 */
// @mutate supabase/migrations/20261106201659_shops_option_words_hold_like_edits.sql |   IF v_words_changed THEN | IF true THEN
// @mutate supabase/migrations/20261106201659_shops_option_words_hold_like_edits.sql |            live_at = CASE WHEN v_status = 'live' THEN live_at END | live_at = live_at
// @mutate supabase/migrations/20261106201659_shops_option_words_hold_like_edits.sql |            submitted_at = CASE WHEN v_status = 'pending_review' AND v_item.status = 'live' THEN now() ELSE submitted_at END, | submitted_at = submitted_at,
// @mutate supabase/migrations/20261106201659_shops_option_words_hold_like_edits.sql |        SET ai_checked_at = CASE WHEN v_item.status = 'pending_review' THEN ai_checked_at END, |        SET ai_checked_at = ai_checked_at,
// @mutate supabase/migrations/20261106201659_shops_option_words_hold_like_edits.sql |                                    WHEN v_item.status = 'pending_review' THEN COALESCE(v_flag, text_flag_reason) |                                    WHEN v_item.status = 'pending_review' THEN v_flag
// @mutate supabase/migrations/20261106201659_shops_option_words_hold_like_edits.sql |            ai_flag_reason = CASE WHEN v_item.status = 'pending_review' THEN ai_flag_reason END, |            ai_flag_reason = NULL,
// @mutate supabase/migrations/20261106194243_shops_option_words_checked.sql |   v_text_flag := public.shop_item_text_flag(v_item.kind, v_item.title,\n                   COALESCE(v_item.description, '') \|\| ' ' \|\| public.shop_item_option_words(v_item.id)); |   v_text_flag := public.shop_item_text_flag(v_item.kind, v_item.title,\n                   v_item.description);
// @mutate supabase/migrations/20261106201659_shops_option_words_hold_like_edits.sql |                 COALESCE(v_item.description, '') \|\| ' ' \|\| public.shop_item_option_words(v_item.id));\n    IF v_item.status = 'live' | v_item.description);\n    IF v_item.status = 'live'
// @mutate supabase/migrations/20261106194243_shops_option_words_checked.sql | REVOKE ALL ON FUNCTION public.shop_item_option_words(uuid) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.shop_item_option_words(uuid) FROM anon;
// @mutate supabase/migrations/20261106194243_shops_option_words_checked.sql |                WHERE v.item_id = p_item_id AND v.active), '')); |                WHERE v.item_id = p_item_id), ''));
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const MIG_DIR = join(process.cwd(), "supabase/migrations");
const DEFS = effectiveDefs(MIG_DIR);
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "");
const WORD_CHECK = /shop_item_text_flag\(\s*v_item\.kind,\s*v_item\.title,\s*COALESCE\(v_item\.description,\s*''\)\s*\|\|\s*' '\s*\|\|\s*public\.shop_item_option_words\(v_item\.id\)\s*\)/i;

describe("Shops option words pass the item word check (20261106194243)", () => {
  it("reads a real inventory (floors)", () => {
    for (const fn of ["shop_item_option_words", "shops_set_item_variants", "shops_publish_item", "shop_item_text_flag"]) {
      expect(DEFS.has(fn), fn).toBe(true);
    }
    expect(body("shops_set_item_variants").length).toBeGreaterThan(2000);
  });

  it("the helper reads the list names and only the offered choices, and is closed to members", () => {
    const words = body("shop_item_option_words");
    expect(words).toMatch(/array_to_string\(i\.option_names,\s*' '\)/i);
    expect(words).toMatch(/WHERE\s+v\.item_id\s*=\s*p_item_id\s+AND\s+v\.active\)/i);
    const mig = blankSqlComments(readFileSync(join(MIG_DIR, "20261106194243_shops_option_words_checked.sql"), "utf8"));
    expect(mig).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.shop_item_option_words\(uuid\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated;/i);
    expect(mig).not.toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.shop_item_option_words\(uuid\)\s+TO\s+[^;]*authenticated/i);
  });

  it("setting options on a live item checks NEW words and holds a failed one the way a live title edit does", () => {
    const set = body("shops_set_item_variants");
    expect(set).toMatch(WORD_CHECK);
    // Follow-up 2: the words before the save are read before anything is written, and only changed words re-check.
    const before = set.search(/v_old_words\s*:=\s*public\.shop_item_option_words\(v_item\.id\);/i);
    const firstWrite = set.search(/UPDATE\s+public\.shop_items\s+SET\s+option_names/i);
    expect(before).toBeGreaterThan(0);
    expect(before).toBeLessThan(firstWrite);
    expect(set).toMatch(/v_words_changed\s*:=\s*v_old_words\s+IS\s+DISTINCT\s+FROM\s+public\.shop_item_option_words\(v_item\.id\);/i);
    expect(set).toMatch(/IF\s+v_words_changed\s+THEN\s+v_flag\s*:=/i);
    // Follow-up 1: as shops_update_item does.
    expect(set).toMatch(/SET\s+ai_checked_at\s*=\s*CASE\s+WHEN\s+v_item\.status\s*=\s*'pending_review'\s+THEN\s+ai_checked_at\s+END,/i);
    expect(set).toMatch(/ai_flag_reason\s*=\s*CASE\s+WHEN\s+v_item\.status\s*=\s*'pending_review'\s+THEN\s+ai_flag_reason\s+END,/i);
    // Lead nit (11-06): an item already waiting keeps the reasons it was held for.
    expect(set).toMatch(/WHEN\s+v_item\.status\s*=\s*'pending_review'\s+THEN\s+COALESCE\(v_flag,\s*text_flag_reason\)/i);
    expect(set).toMatch(/admin_approved_at\s*=\s*NULL,/i);
    expect(set).toMatch(/submitted_at\s*=\s*CASE\s+WHEN\s+v_status\s*=\s*'pending_review'\s+AND\s+v_item\.status\s*=\s*'live'\s+THEN\s+now\(\)/i);
    expect(set).toMatch(/live_at\s*=\s*CASE\s+WHEN\s+v_status\s*=\s*'live'\s+THEN\s+live_at\s+END/i);
    expect(set).toMatch(/'held_for_review',\s*v_item\.status\s*=\s*'live'\s+AND\s+v_status\s*=\s*'pending_review'/i);
  });

  it("listing a draft checks its options with the title and description", () => {
    expect(body("shops_publish_item")).toMatch(/v_text_flag\s*:=\s*public\.shop_item_text_flag\(\s*v_item\.kind,\s*v_item\.title,\s*COALESCE\(v_item\.description,\s*''\)\s*\|\|\s*' '\s*\|\|\s*public\.shop_item_option_words\(v_item\.id\)\s*\)/i);
  });
});
