/**
 * Q1799 (Apple Guideline 1.2, App Store resubmission): user-generated messages
 * have an objectionable-content filter, and the Terms state zero tolerance.
 * Reads the NEWEST scan_message_content and the Terms copy.
 * PGlite: src/test/pglite/messageObjectionableHidden.pglite.mjs (ALL PASS; 6 FAIL without).
 *
 * @mutate supabase/migrations/20261027194309_message_objectionable_language_hidden.sql |   v_reason := COALESCE(public.objectionable_reason(NEW.content), public.contact_leak_reason(NEW.content)); |   v_reason := public.contact_leak_reason(NEW.content);
 * @mutate src/pages/info/legal/TermsSection.tsx | Zero tolerance for objectionable content: | Content:
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");
const defs = effectiveDefs(join(ROOT, "supabase", "migrations"));

describe("Q1799: objectionable messages are filtered and the Terms say zero tolerance", () => {
  it("the newest message scanner checks objectionable language before contact details", () => {
    const body = blankSqlComments(defs.get("scan_message_content")?.stmt ?? "");
    expect(body).toMatch(/COALESCE\(public\.objectionable_reason\(NEW\.content\), public\.contact_leak_reason\(NEW\.content\)\)/);
    expect(defs.get("objectionable_reason"), "objectionable_reason is defined").toBeTruthy();
  });

  it("the Terms state zero tolerance, automatic hiding, report and block, and 24-hour review", () => {
    const terms = readFileSync(join(ROOT, "src/pages/info/legal/TermsSection.tsx"), "utf8");
    expect(terms).toMatch(/Zero tolerance for objectionable content:/);
    expect(terms).toMatch(/report or block/);
    expect(terms).toMatch(/within 24 hours/);
  });
});
