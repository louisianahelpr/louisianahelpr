/**
 * AUD31-44 (audit 10-31, Admin > Reports at 375 and 1440): a report's seven actions sat on one non-wrapping,
 * sideways-scrolling row under a fade. At 1440 "Dismiss" was cut under the fade; at 375 only "View Profile" and
 * "Assign to Me" showed and Resolve / Dismiss were off screen. The row now wraps, and the header's date never
 * splits "Oct" / "30" across lines.
 *
 * @mutate src/components/admin/AdminReports.tsx | <div data-report-actions className="flex flex-wrap gap-2 pt-1 [&>button]:shrink-0"> | <div data-report-actions className="flex flex-nowrap gap-2 pt-1 overflow-x-auto [&>button]:shrink-0">
 * AUD31-48 (audit 10-31, 375): the credential row cut "Dana Ri…" / "dana@ex…" beside a fixed business-name column,
 * and the Users search placeholder was cut ("Search name, email, phone o"). The business name now sits on its own
 * line inside the name column, and the placeholder is short enough for a phone.
 * @mutate src/components/admin/AdminCredentialQueue.tsx | className="text-ds-11 font-semibold [overflow-wrap:anywhere]" | className="text-ds-11 font-semibold shrink-0 max-w-[10rem] truncate"
 * @mutate src/components/admin/AdminUsers.tsx | placeholder="Name, email, phone, job ID" | placeholder="Search name, email, phone or job ID…"
 * @mutate src/components/admin/AdminReports.tsx | {" · "}<span className="whitespace-nowrap">{formatShortDate(report.created_at)}</span> | {" · "}{formatShortDate(report.created_at)}
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "@/test/helpers/blankNonCode";

const reports = () => blankComments(readFileSync("src/components/admin/AdminReports.tsx", "utf8"));

/** The className of the element carrying `marker`, read from the source. */
function classOf(src: string, marker: string): string {
  const at = src.indexOf(marker);
  expect(at, `${marker} is gone from AdminReports.tsx`).toBeGreaterThan(-1);
  // The class list itself holds a ">" ("[&>button]"), so read the quoted className after the marker.
  return /className="([^"]*)"/.exec(src.slice(at))?.[1] ?? "";
}

describe("AUD31-44: a report's actions are all on screen", () => {
  it("the action row wraps instead of scrolling sideways under a fade", () => {
    const cls = classOf(reports(), "data-report-actions");
    expect(cls.split(/\s+/)).toContain("flex-wrap");
    expect(cls).not.toMatch(/flex-nowrap|overflow-x-(auto|scroll)|mask-image/);
  });

  it("the report's date stays on one line", () => {
    expect(reports()).toMatch(/<span className="whitespace-nowrap">\{formatShortDate\(report\.created_at\)\}<\/span>/);
  });
});

describe("AUD31-48: admin rows and boxes are not cut at 375", () => {
  it("the credential row's business name is on its own line in the name column, never a fixed squeezing column", () => {
    const src = blankComments(readFileSync("src/components/admin/AdminCredentialQueue.tsx", "utf8"));
    const cls = classOf(src, "data-credential-business");
    expect(cls).not.toMatch(/shrink-0|max-w-|truncate/);
    // Inside the flex-1 name column: after the email line and before that column closes.
    const email = src.indexOf("{r.email}</p>");
    const biz = src.indexOf("data-credential-business");
    expect(email).toBeGreaterThan(-1);
    expect(biz).toBeGreaterThan(email);
    expect(src.slice(email, biz)).not.toMatch(/<\/div>/);
  });

  it("the Users search placeholder fits a phone (30 characters or fewer)", () => {
    const src = blankComments(readFileSync("src/components/admin/AdminUsers.tsx", "utf8"));
    const placeholders = [...src.matchAll(/placeholder="([^"]*)"/g)].map((m) => m[1]);
    expect(placeholders.length).toBeGreaterThan(0);
    expect(placeholders.filter((p) => p.length > 30)).toEqual([]);
  });
});
