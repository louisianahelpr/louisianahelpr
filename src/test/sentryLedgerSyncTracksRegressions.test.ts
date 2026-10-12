import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import {
  SENTRY_SYNC_QUERY,
  realOccurrenceAt,
  sentryIssueTagUrl,
  sentryIssueToAlert,
  sentryIssuesUrl,
  sentryReadToken,
} from "../../scripts/lib/sentryLedgerSync.mjs";

/**
 * docs/OPEN.md Q11: Sentry issues read "resolved" while they keep firing.
 *
 * MEASURED 2026-09-23: Sentry resolves every helpr-4m issue one hour after its
 * last event (`set_resolved_by_age`, age 1, by system) and reopens it on the
 * next (`set_regression`): JAVASCRIPT-1H, "socket closed: 1005", 66 events,
 * cycled 20 times 09-11..09-23 and read "resolved" 16h after its last event.
 * The ledger sync asked for `is:unresolved` only, with the upload token, which
 * answered 403 on every hourly run (prod-errors run 35895960717), so NOTHING
 * from Sentry reached the ledger, and even a working token would have missed
 * every issue Sentry had already auto-resolved.
 *
 * The sync now reads with SENTRY_READ_TOKEN and takes every issue with an
 * event in the window WHATEVER its Sentry status, at its real lastSeen; the
 * ledger reopens a closed item on any occurrence newer than the close (pinned
 * by src/test/pglite/opsAlertLedger.pglite.mjs, "a new occurrence reopens a
 * closed item"), so a Sentry regression reopens the ledger item.
 */
// @mutate scripts/lib/sentryLedgerSync.mjs | export const SENTRY_SYNC_QUERY = "lastSeen:-25h"; | export const SENTRY_SYNC_QUERY = "is:unresolved lastSeen:-25h";
// @mutate scripts/lib/sentryLedgerSync.mjs |   return env.SENTRY_READ_TOKEN \|\| env.SENTRY_AUTH_TOKEN \|\| ""; |   return env.SENTRY_AUTH_TOKEN \|\| "";
// @mutate scripts/lib/sentryLedgerSync.mjs |     seenAt: i?.lastSeen, |     seenAt: undefined,
// @mutate scripts/ops-alert-ledger.mjs |       const res = await fetch(sentryIssuesUrl(so, sp), { |       const res = await fetch(`https://sentry.io/api/0/projects/${so}/${sp}/issues/?query=is:unresolved`, {
// Q1604: an automated browser's event must never become the occurrence.
// @mutate scripts/lib/sentryLedgerSync.mjs |     if (String(v?.value) === "true") continue; |     if (String(v?.value) === "never") continue;
// @mutate scripts/ops-alert-ledger.mjs |         if (seenAt === null) { automatedOnly++; continue; } |         if (seenAt === "never") { automatedOnly++; continue; }
// @mutate scripts/ops-alert-ledger.mjs |         await recordOpsAlert({ ...sentryIssueToAlert(i), seenAt }); |         await recordOpsAlert(sentryIssueToAlert(i));
// @mutate .github/workflows/prod-errors.yml |           SENTRY_READ_TOKEN: ${{ secrets.SENTRY_READ_TOKEN }} |           SENTRY_READ_TOKEN: ""

const ROOT = join(__dirname, "..", "..");

// The shape of JAVASCRIPT-1H as the issues API returned it on 2026-09-23.
const AUTO_RESOLVED_BUT_FIRING = {
  id: "6602326865",
  shortId: "JAVASCRIPT-1H",
  title: "Error: socket closed: 1005",
  culprit: "nt(assets/supabase-C95ey7pF)",
  level: "error",
  status: "resolved",
  substatus: null,
  lastSeen: "2026-09-23T02:35:54Z",
  permalink: "https://helpr-4m.sentry.io/issues/JAVASCRIPT-1H/",
};

describe("Sentry -> ledger sync tracks regressions from Sentry's own status (Q11)", () => {
  it("asks for every status, never only is:unresolved", () => {
    expect(SENTRY_SYNC_QUERY).toMatch(/lastSeen:-\d+h/);
    expect(SENTRY_SYNC_QUERY).not.toMatch(/\bis:/);
    const url = sentryIssuesUrl("org", "proj");
    expect(decodeURIComponent(url)).not.toMatch(/is:unresolved/);
    expect(decodeURIComponent(url)).toContain(SENTRY_SYNC_QUERY);
  });

  it("an issue Sentry auto-resolved still becomes an occurrence at its real last event", () => {
    const a = sentryIssueToAlert(AUTO_RESOLVED_BUT_FIRING);
    expect(a.sourceKind).toBe("sentry");
    expect(a.title).toBe("Error: socket closed: 1005");
    expect(a.seenAt).toBe("2026-09-23T02:35:54Z");
    expect(a.sampleRef.sentry_status).toBe("resolved");
    expect(a.sample).toContain("resolved in Sentry");
    const reg = sentryIssueToAlert({ ...AUTO_RESOLVED_BUT_FIRING, status: "unresolved", substatus: "regressed" });
    expect(reg.sampleRef.sentry_substatus).toBe("regressed");
    expect(reg.sample).toContain("unresolved/regressed");
  });

  it("reads with the read token, not the release-upload token", () => {
    expect(sentryReadToken({ SENTRY_READ_TOKEN: "read", SENTRY_AUTH_TOKEN: "upload" })).toBe("read");
    expect(sentryReadToken({ SENTRY_AUTH_TOKEN: "upload" })).toBe("upload");
    expect(sentryReadToken({})).toBe("");
  });

  it("the sync uses these helpers, and the workflow hands it the read token", () => {
    const sync = blankComments(readFileSync(join(ROOT, "scripts/ops-alert-ledger.mjs"), "utf8"));
    expect(sync.match(/sentry/gi)?.length ?? 0).toBeGreaterThan(3);
    expect(sync).not.toMatch(/is:unresolved/);
    for (const fn of ["sentryReadToken(process.env)", "sentryIssuesUrl(so, sp)", "realOccurrenceAt(tag, i.lastSeen)", "sentryIssueTagUrl(so, i.id)", "recordOpsAlert({ ...sentryIssueToAlert(i), seenAt })", "if (seenAt === null) { automatedOnly++; continue; }"]) {
      expect(sync, fn).toContain(fn);
    }
    const wf = readFileSync(join(ROOT, ".github/workflows/prod-errors.yml"), "utf8")
      .split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    const step = wf.slice(wf.indexOf("- name: Sync, verify, list"));
    expect(step.slice(0, step.indexOf("run:"))).toMatch(/SENTRY_READ_TOKEN:\s*\$\{\{\s*secrets\.SENTRY_READ_TOKEN\s*\}\}/);
  });
});

// JAVASCRIPT-1V's `automated` tag as Sentry answered it on 2026-10-12 (the
// Sentry MCP's get_issue_tag_values): 39 untagged events from the 09-13
// journeys, 4 automated ZIP 99999 posts, 1 real guest typing 40560 at signup.
const JAVASCRIPT_1V_AUTOMATED = {
  key: "automated",
  totalValues: 44,
  topValues: [
    { value: "", count: 39, lastSeen: "2026-09-13T05:09:28Z" },
    { value: "true", count: 4, lastSeen: "2026-10-09T02:07:27Z" },
    { value: "false", count: 1, lastSeen: "2026-10-09T00:55:36Z" },
  ],
};

describe("an automated browser never reopens a ledger item (Q1604)", () => {
  it("the occurrence is the newest NON-automated event, not the issue's lastSeen", () => {
    expect(realOccurrenceAt(JAVASCRIPT_1V_AUTOMATED, "2026-10-09T02:07:27Z")).toBe("2026-10-09T00:55:36Z");
  });

  it("an issue only automated browsers sent is not an occurrence at all", () => {
    const onlyBots = { topValues: [{ value: "true", count: 4, lastSeen: "2026-10-09T02:07:27Z" }] };
    expect(realOccurrenceAt(onlyBots, "2026-10-09T02:07:27Z")).toBeNull();
  });

  it("untagged events (from before the tag existed) count as real", () => {
    const old = { topValues: [{ value: "", count: 3, lastSeen: "2026-09-13T05:09:28Z" }, { value: "true", count: 1, lastSeen: "2026-10-09T02:07:27Z" }] };
    expect(realOccurrenceAt(old, "2026-10-09T02:07:27Z")).toBe("2026-09-13T05:09:28Z");
  });

  it("an unreadable tag answer never hides an alert: the issue's own lastSeen stands", () => {
    for (const bad of [null, undefined, {}, { topValues: [] }, { topValues: [{ value: "false" }] }]) {
      expect(realOccurrenceAt(bad as never, "2026-10-09T02:07:27Z")).toBe("2026-10-09T02:07:27Z");
    }
  });

  it("asks the issue's own tag endpoint", () => {
    expect(sentryIssueTagUrl("helpr-4m", "6602326865")).toBe("https://sentry.io/api/0/organizations/helpr-4m/issues/6602326865/tags/automated/");
  });
});
