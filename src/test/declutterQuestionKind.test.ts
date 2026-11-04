/**
 * Question notices have their own kind, so muting Offers never mutes them (Q2488; migration 20261030170443).
 *
 * The bug: "New question" and "The seller answered" were written as declutter_offers. This holds the newest definition
 * of both functions, the push map's row, and that the switch exists on the screen under its own label with no fake email
 * switch. Backend proof with the real trigger, writer and push gate: src/test/pglite/declutterQuestionKind.pglite.mjs
 * (3x; red without the migration and on its planted defects). notificationTypeRegistries.test.ts keeps the six
 * type registries agreeing, so a missing create-notification or email-table entry fails there.
 */
// @mutate supabase/migrations/20261030170443_declutter_question_kind.sql | public.declutter_notify(v_item.seller_id, 'declutter_questions', 'New question', | public.declutter_notify(v_item.seller_id, 'declutter_offers', 'New question',
// @mutate supabase/migrations/20261030170443_declutter_question_kind.sql | public.declutter_notify(NEW.asker_id, 'declutter_questions', 'The seller answered', | public.declutter_notify(NEW.asker_id, 'declutter_offers', 'The seller answered',
// @mutate supabase/migrations/20261104123305_bundle_request_export_and_notice_kinds.sql | WHEN p_title IN ('New question', 'The seller answered') | WHEN p_title IN ('The seller answered')
// @mutate supabase/migrations/20261030170443_declutter_question_kind.sql | ('declutter_questions', 'declutter_questions', 'Declutter: | ('declutter_questions', 'declutter_offers', 'Declutter:
// @mutate src/components/notificationPreferences/constants.tsx | { key: "declutter_questions", emailKey: "email_declutter_questions", label: "Questions", description: "Questions on your listings, and sellers' answers to yours.", icon: <MessageCircleQuestion className="w-3.5 h-3.5" />, noEmailSwitch: NO_EMAIL }, |
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readdirSync } from "./helpers/trackedFiles";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";
import { declutterRows } from "@/components/notificationPreferences/constants";

// The push-map row and the one-time copy of the Offers switches are data statements, not function bodies; they live in
// 20261030170443 and no later migration redefines them. Read from every migration, so no file is pinned by name
// (declutter_notice_type, also in that file, was restated by 20261102103524 and is read through effectiveDefs above).
const ALL_MIGRATIONS = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort()
  .map((f) => readFileSync(join("supabase/migrations", f), "utf8")).join("\n");
const code = (fn: string) => blankSqlComments(effectiveDefs("supabase/migrations").get(fn)?.stmt ?? "");

describe("question notices have their own kind", () => {
  it("the trigger sends both notices as declutter_questions", () => {
    const sent = [...code("declutter_question_notice").matchAll(/declutter_notify\(\s*[^,]+,\s*'(\w+)',\s*'([^']+)'/g)].map((m) => [m[2], m[1]]);
    expect(sent.length).toBeGreaterThan(1);
    expect(Object.fromEntries(sent)).toEqual({ "New question": "declutter_questions", "The seller answered": "declutter_questions" });
  });

  it("the writer files the two titles under the new kind and nowhere else", () => {
    const def = code("declutter_notice_type");
    const lists = [...def.matchAll(/p_title\s+IN\s*\(([\s\S]*?)\)\s*THEN\s+'(declutter_\w+)'/g)];
    expect(lists.length).toBeGreaterThan(5);
    const holding = (title: string) => lists.filter((l) => l[1].includes(`'${title}'`)).map((l) => l[2]);
    expect(holding("New question")).toEqual(["declutter_questions"]);
    expect(holding("The seller answered")).toEqual(["declutter_questions"]);
    expect(holding("New offer")).toEqual(["declutter_offers"]);
    expect(def).toMatch(/WHEN p_type IN \([^)]*'declutter_questions'[^)]*\) THEN p_type/);
  });

  it("the push map gates the kind on its own column", () => {
    const sql = blankSqlComments(ALL_MIGRATIONS);
    expect(sql).toContain("('declutter_questions', 'declutter_questions', 'Declutter:");
    expect(sql).toContain("SET declutter_questions = declutter_offers WHERE declutter_offers IS FALSE");
    expect(sql).toContain("SET email_declutter_questions = email_declutter_offers WHERE email_declutter_offers IS FALSE");
  });

  it("Settings shows the switch, with a dash for email because no question email is sent", () => {
    const row = declutterRows.find((r) => r.key === "declutter_questions");
    expect(row?.label).toBe("Questions");
    expect(row?.emailKey).toBe("email_declutter_questions");
    expect(row?.noEmailSwitch).toBeTruthy();
  });
});
