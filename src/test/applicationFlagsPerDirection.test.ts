/**
 * Q1206 — a flagged application text is withheld from the reader's client,
 * and each direction carries its own flag.
 *
 * WHAT WAS BROKEN (read live 2026-10-04): scan_application_contact_info set
 * ONE flag (flagged_hidden) when either the applicant's note or the poster's
 * offer message leaked contact details and left both texts readable, so the
 * words reached the other party's client under a "hidden" notice, and a
 * flagged note also hid a clean offer (and the other way round).
 *
 * THE CLASS, three layers:
 *   1. DB: the effective scan judges each direction on its own and moves a
 *      flagged text into a server-only column, NULLing the readable one.
 *   2. Grants: the withheld columns are private (applicationFlagWithheld.test.ts
 *      replays the grants and pins APPLICATION_PRIVATE_COLUMNS two-way).
 *   3. Client: the offer card honours the offer's own flag
 *      (applicationContactLeakHidden.test.ts).
 * Behaviour, red then green: src/test/pglite/applicationFlagsPerDirection.pglite.mjs
 * (applied 3x: ALL PASS; NEW_MIGRATION=skip: 9 FAILED).
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";
import { APPLICATION_PRIVATE_COLUMNS, APPLICATION_READABLE_COLUMN_LIST } from "@/lib/applicationColumns";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");

describe("Q1206: each direction is flagged on its own, and its text withheld", () => {
  const body = blankSqlComments(effectiveDefs(join(ROOT, "supabase/migrations")).get("scan_application_contact_info")?.stmt ?? "").replace(/\s+/g, " ");

  it("a flagged note moves to message_withheld and sets only the note's flag", () => {
    expect(body).toContain("IF v_dir IN ('both', 'note') THEN r_note := public.contact_leak_reason(NEW.message); IF r_note IS NOT NULL THEN NEW.flagged_hidden := true; NEW.message_withheld := NEW.message; NEW.message := NULL;");
  });

  it("a flagged offer moves to offer_message_withheld and sets only the offer's flag", () => {
    expect(body).toContain("IF v_dir IN ('both', 'offer') THEN r_offer := public.contact_leak_reason(NEW.offer_message); IF r_offer IS NOT NULL THEN NEW.offer_message_flagged_hidden := true; NEW.offer_message_withheld := NEW.offer_message; NEW.offer_message := NULL;");
  });

  it("an unflagged write (an explicit NULL included) clears that direction's withheld copy", () => {
    expect(body).toContain("ELSE NEW.flagged_hidden := false; NEW.message_withheld := NULL; END IF;");
    expect(body).toContain("ELSE NEW.offer_message_flagged_hidden := false; NEW.offer_message_withheld := NULL; END IF;");
  });

  it("each direction is judged only by the trigger for its own column (one per write path)", () => {
    const state = new Map<string, string | null>();
    for (const f of migrationFiles(MIG_DIR)) {
      const sql = blankSqlComments(readFileSync(join(MIG_DIR, f), "utf8"));
      for (const m of sql.matchAll(/(create\s+trigger\s+(applications_scan_contact_info\w*)\s+([^;]*?)\s+on\s+(?:public\.)?applications\s+for each row execute function (?:public\.)?scan_application_contact_info\(([^)]*)\))|(drop\s+trigger\s+(?:if\s+exists\s+)?(applications_scan_contact_info\w*)\s+on\s+(?:public\.)?applications)/gi)) {
        if (m[1]) state.set(m[2].toLowerCase(), `${m[3]} ${m[4]}`.replace(/\s+/g, " ").toLowerCase());
        else state.set(m[6].toLowerCase(), null);
      }
    }
    expect(migrationFiles(MIG_DIR).length).toBeGreaterThan(400);
    const live = [...state].filter(([, v]) => v !== null);
    expect(Object.fromEntries(live)).toEqual({
      applications_scan_contact_info: "before insert 'both'",
      applications_scan_contact_info_note: "before update of message 'note'",
      applications_scan_contact_info_offer: "before update of offer_message 'offer'",
    });
  });

  it("the withheld texts are private and the offer's flag is readable", () => {
    expect(APPLICATION_PRIVATE_COLUMNS).toContain("message_withheld");
    expect(APPLICATION_PRIVATE_COLUMNS).toContain("offer_message_withheld");
    expect(APPLICATION_READABLE_COLUMN_LIST).toContain("offer_message_flagged_hidden");
  });
});

// @mutate supabase/migrations/20261004192410_application_flags_per_direction.sql |     NEW.message          := NULL;\n |
// @mutate supabase/migrations/20261004192410_application_flags_per_direction.sql |     NEW.offer_message                := NULL;\n |
// @mutate supabase/migrations/20261004192410_application_flags_per_direction.sql |     NEW.offer_message_flagged_hidden := true; |     NEW.flagged_hidden := true;
// @mutate supabase/migrations/20261004192410_application_flags_per_direction.sql |   BEFORE UPDATE OF message ON public.applications | BEFORE UPDATE OF message, offer_message ON public.applications
// @mutate supabase/migrations/20261004192410_application_flags_per_direction.sql |       NEW.flagged_hidden   := false;\n      NEW.message_withheld := NULL;\n |       NEW.flagged_hidden   := false;\n
