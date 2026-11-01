/**
 * A SENTENCE THAT ENDS ON A "FIRST L." NAME HAS ONE PERIOD (lead, 2026-10-23, seen on the Approve sheet: "the $25 job
 * price is released to Hallie H.. If something isn't right ...").
 *
 * formatName / member_display_name write a member as "First L.", so a sentence that puts its own period after the
 * name prints two. The one shared place is endSentence() (src/lib/utils.ts): it adds the period only when the text
 * does not already end in one. The class: in every non-test .ts/.tsx under src, an interpolation of a person's name
 * ({...name...}, ${...name...}, helper / poster / first / other variables) followed directly by a literal "." must go
 * through endSentence, or be listed below with why its value can never end in a period (an admin's full name, a
 * file name). The list is EXACT, both ways.
 *
 * @mutate src/pages/posts/CompletionChoiceSheet.tsx | released to {endSentence(groupJob ? "your Helprs" : helperName)} Their | released to {groupJob ? "your Helprs" : helperName}. Their
 * @mutate src/lib/utils.ts |   return /[.!?]$/.test(t) ? t : `${t}.`; |   return `${t}.`;
 */
import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { readdirSync } from "./helpers/trackedFiles";
import { endSentence, formatName } from "@/lib/utils";

const ROOT = join(__dirname, "..", "..");

/** Interpolations whose value can never end in "." (so a literal period after them is the only one). EXACT. */
const NEVER_ENDS_IN_A_PERIOD: Record<string, string> = {
  "src/components/declutter/DeclutterNoShowAnswer.tsx::{delivery ? \"it wasn't delivered\" : \"the seller didn't show\"}.": "fixed words, no name",
  "src/components/admin/AdminPayoutBatches.tsx::${batch.helper_name}.": "an admin view; helper_name is the Helpr's full legal name from the payout row, not First L.",
  "src/components/admin/AdminSettings.tsx::${confirmRemove?.name || \"this user\"}.": "an admin's full name from the admin list (admins see full names, Q2365)",
  "src/components/admin/AdminReports.tsx::{messageTarget?.name}.": "an admin view; the reported member's full name",
  "src/components/admin/BanDialog.tsx::${profile.full_name || \"user\"}.": "an admin view; profiles.full_name, the full name",
  "src/components/profile/profileEditForm/usePortfolio.ts::${file.name}.": "a file name, not a person",
  "src/components/admin/adminJobs/RemoveJobDialog.tsx::{detailJob?.helper_id ? \" and assigned Helpr\" : \"\"}.": "two string literals, neither ends in a period",
  "src/components/dashboard/BrowseTasksFeed.tsx::${helprActivity.parish}.": "a parish name (the member's profile parish, e.g. \"Lafayette Parish\"), never a person's First L. name, so it never ends in its own period",
  "src/components/declutter/DeclutterBundleRow.tsx::{b.firstName}.": "the seller's FIRST name only (formatName(...).split(\" \")[0]) or \"this seller\"",
  "src/components/refund/RefundRequestDialog.tsx::${first}.": "firstNameOf(): the first name only",
  "src/lib/jobSystemEvents.ts::${who === \"poster\" ? \"the person who posted it\" : \"the Helpr\"}.": "two string literals, neither ends in a period",
  "src/pages/auth/Unsubscribe.tsx::${who}.": "an email address or \"this address\"",
};

function walk(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(join(ROOT, p)).isDirectory()) return walk(p);
    return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) && !/\.d\.ts$/.test(n) ? [p] : [];
  });
}

/** A variable that holds a person: name / *Name, helper*, helpr*, poster*, first, other*, seller*, buyer*, who. */
const PERSON = /\b(?:name|\w+Name|full_name|helper\w*|helpr\w*|poster\w*|first|other\w*|seller\w*|buyer\w*|who)\b/;
const SITE = /(\$?\{[^{}\n]*\})\.(?=[\s<"'`]|$)/gm;

function sites(file: string): string[] {
  const src = readFileSync(join(ROOT, file), "utf8");
  const out: string[] = [];
  for (const m of src.matchAll(SITE)) {
    const expr = m[1];
    if (!PERSON.test(expr) || /endSentence\(/.test(expr)) continue;
    // A comment, or a member access the period belongs to (`{a.b}.c` never matches the lookahead).
    out.push(`${file}::${expr}.`);
  }
  return out;
}

describe("a sentence ending on a First L. name has one period", () => {
  const files = walk("src").filter((f) => !f.startsWith("src/test/"));

  it("reads the real source (floor: 1500 files on 2026-10-23)", () => {
    expect(files.length).toBeGreaterThan(1500);
  });

  it("endSentence adds a period only when the text has none", () => {
    expect(endSentence(formatName("Hallie Harper"))).toBe("Hallie H.");
    expect(endSentence("your Helprs")).toBe("your Helprs.");
    expect(endSentence("Done!")).toBe("Done!");
  });

  it("every name that ends a sentence goes through endSentence, or is listed with why it never ends in a period", () => {
    const found = files.flatMap(sites).sort();
    expect(found).toEqual(Object.keys(NEVER_ENDS_IN_A_PERIOD).sort());
  });
});
