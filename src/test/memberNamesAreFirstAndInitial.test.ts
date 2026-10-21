/**
 * Owner rule (2026-10-21): we NEVER show a member's last name to another member, only its first letter
 * ("Andre L."), through formatName (src/lib/utils.ts). This scans every member-facing source file for a raw
 * name field (full_name, quoter_name, sender_name, ...) rendered as text, in a JSX child or a template
 * string, that does not pass through formatName. Admin screens (staff see full names) and a member's own
 * name are the exceptions, each listed below with its reason.
 * Server-built notification text is a separate item (Q2292).
 * @mutate src/pages/quotes/QuoteRequestPage.tsx | {formatName(quote.quoter_name, "A member")}</p> | {quote.quoter_name \|\| "A member"}</p>
 * @mutate src/components/job-card/ActivityDialogs.tsx | helperName={formatName(props.deadlineDialogApp.profiles?.full_name, "Helpr")} | helperName={props.deadlineDialogApp.profiles?.full_name ?? "Helpr"}
 * @mutate src/pages/user/ReviewsSection.tsx | Response from {formatName(profileFullName, "the Helpr")} | Response from {profileFullName}
 */
import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { readdirSync } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";

const FIELDS = "full_name|quoter_name|sender_name|poster_name|helper_name|seller_name|buyer_name|reviewer_name|profileFullName";
/** A member's OWN name, shown to themselves: allowed in full. file -> reason. */
const OWN_NAME: Record<string, string> = {
  "src/pages/info/Support.tsx": "the signed-in member's own account name on their support form",
  "src/pages/profile/WorkRecord.tsx": "the member's own work record",
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(tsx|ts)$/.test(name) && !name.includes(".test.") && !name.endsWith(".d.ts") ? [p] : [];
  });
}

const STAFF = /^src\/(components|pages)\/admin\//;
const SKIP = /^src\/(__preview|test|integrations)\//;

export function rawNameRenders(src: string, jsx = true): string[] {
  const out: string[] = [];
  const rx = [
    ...(jsx ? [new RegExp(`>[^<{}=]*\\{([^{}]*\\b(?:${FIELDS})\\b[^{}]*)\\}`, "g")] : []),
    new RegExp(`\\$\\{([^{}]*\\b(?:${FIELDS})\\b[^{}]*)\\}`, "g"),
  ];
  for (const r of rx) {
    for (const m of src.matchAll(r)) {
      if (/formatName|firstName|first\b|\.split\(|initial|\.length|\?\s*\(|key|id\b/.test(m[1])) continue;
      out.push(m[1].trim());
    }
  }
  return out;
}

const files = walk("src").filter((f) => !STAFF.test(f) && !SKIP.test(f));

describe("members see other members as 'First L.' (owner 2026-10-21)", () => {
  it("the checker catches a raw full name in a JSX child and a template, and passes formatName", () => {
    expect(rawNameRenders(`<p>{quote.quoter_name || "A member"}</p>`)).toEqual([`quote.quoter_name || "A member"`]);
    expect(rawNameRenders("`with ${p.full_name}`")).toEqual(["p.full_name"]);
    expect(rawNameRenders(`<p>{formatName(p.full_name)}</p>`)).toEqual([]);
  });

  it("scans the member-facing source", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it("no member-facing file renders another member's raw full name", () => {
    const bad = files
      .filter((f) => !(f in OWN_NAME))
      .flatMap((f) => rawNameRenders(blankComments(readFileSync(f, "utf8")), f.endsWith(".tsx")).map((x) => `${f}: ${x}`));
    expect(bad).toEqual([]);
  });

  it("every own-name exception is still a real render (two-way)", () => {
    for (const f of Object.keys(OWN_NAME)) expect(rawNameRenders(blankComments(readFileSync(f, "utf8"))).length, f).toBeGreaterThan(0);
  });

  it("the hire sheet gets 'First L.' from its mount (board 29)", () => {
    expect(readFileSync("src/components/job-card/ActivityDialogs.tsx", "utf8")).toMatch(/helperName=\{formatName\(props\.deadlineDialogApp\.profiles\?\.full_name, "Helpr"\)\}/);
  });
});
