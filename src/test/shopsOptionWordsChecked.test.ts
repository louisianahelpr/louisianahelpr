/**
 * Shops variants: option list names and choices pass the item word check (20261106194243_shops_option_words_checked.sql,
 * Builder 4, 11-06; recommendation logged in OWNER-DECISIONS, owner may override). Owner rule: content goes live at
 * once and only a failed automatic check goes to an admin. So a live item whose options fail shop_item_text_flag waits
 * for an admin, as a live title edit does, and a draft's options are checked when it is listed.
 *
 * Behaviour proof: src/test/pglite/shopsItemVariants.pglite.mjs section 8b (64 PASS; WORDS_MIGRATION=skip 5 FAIL;
 * 5 planted defects RED, measured 11-06). This file keeps the newest bodies wired the same way.
 */
// @mutate supabase/migrations/20261106194243_shops_option_words_checked.sql |       UPDATE public.shop_items SET status = 'pending_review', admin_approved_at = NULL WHERE id = v_item.id; |       NULL;
// @mutate supabase/migrations/20261106194243_shops_option_words_checked.sql |   v_text_flag := public.shop_item_text_flag(v_item.kind, v_item.title,\n                   COALESCE(v_item.description, '') \|\| ' ' \|\| public.shop_item_option_words(v_item.id)); |   v_text_flag := public.shop_item_text_flag(v_item.kind, v_item.title, v_item.description);
// @mutate supabase/migrations/20261106194243_shops_option_words_checked.sql |   v_flag := public.shop_item_text_flag(v_item.kind, v_item.title,\n              COALESCE(v_item.description, '') \|\| ' ' \|\| public.shop_item_option_words(v_item.id)); |   v_flag := public.shop_item_text_flag(v_item.kind, v_item.title, v_item.description);
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

  it("setting options on a live item checks the words and holds a failed one for an admin", () => {
    const set = body("shops_set_item_variants");
    expect(set).toMatch(WORD_CHECK);
    expect(set).toMatch(/IF\s+v_flag\s+IS\s+NOT\s+NULL\s+AND\s+v_item\.status\s+IN\s*\(\s*'live',\s*'pending_review'\s*\)/i);
    expect(set).toMatch(/UPDATE\s+public\.shop_items\s+SET\s+status\s*=\s*'pending_review',\s*admin_approved_at\s*=\s*NULL\s+WHERE\s+id\s*=\s*v_item\.id;/i);
    expect(set).toMatch(/SET\s+text_flag_reason\s*=\s*v_flag/i);
  });

  it("listing a draft checks its options with the title and description", () => {
    expect(body("shops_publish_item")).toMatch(/v_text_flag\s*:=\s*public\.shop_item_text_flag\(\s*v_item\.kind,\s*v_item\.title,\s*COALESCE\(v_item\.description,\s*''\)\s*\|\|\s*' '\s*\|\|\s*public\.shop_item_option_words\(v_item\.id\)\s*\)/i);
  });
});
