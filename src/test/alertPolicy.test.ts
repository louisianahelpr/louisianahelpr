/**
 * The #ops-alerts severity policy (supabase/functions/_shared/alertPolicy.ts).
 *
 * 2026-09-14: every admin push fell back to Slack as "Admin alert undeliverable
 * — no push token", once per admin, and every error_logs row posted too. The
 * replacement rule is "critical posts, the rest is the daily digest" — which is
 * only safe if nothing that puts money or security at risk can land in the
 * digest. These tests pin that, from the edge functions' own source.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  CRITICAL_ERROR_LOG_SOURCES,
  CRITICAL_KINDS,
  adminPushEventKey,
  adminPushSeverity,
  effectiveSeverity,
  normalizeSeverity,
  postsImmediately,
  utcDayStartIso,
} from "../../supabase/functions/_shared/alertPolicy";

// ALERT_POLICY_FUNCTIONS_DIR lets the red run point at a pre-fix checkout.
const FUNCTIONS = process.env.ALERT_POLICY_FUNCTIONS_DIR ?? join(process.cwd(), "supabase", "functions");

type Call = { file: string; line: number; kind: string | null; severity: string | null; title: string };

/** Every `postSlackOpsAlert({...})` call site, with its literal kind/severity/title. */
export function slackAlertCallSites(read: (file: string) => string, files: string[]): Call[] {
  const out: Call[] = [];
  for (const file of files) {
    const s = read(file);
    for (const m of s.matchAll(/postSlackOpsAlert\(\{/g)) {
      let depth = 1;
      let j = m.index! + m[0].length;
      while (depth && j < s.length) {
        if (s[j] === "{") depth++;
        else if (s[j] === "}") depth--;
        j++;
      }
      const body = s.slice(m.index! + m[0].length, j);
      const lit = (key: string) => new RegExp(`${key}:\\s*["']([\\w_]+)["']`).exec(body)?.[1] ?? null;
      out.push({
        file,
        line: s.slice(0, m.index!).split("\n").length,
        kind: lit("kind"),
        severity: lit("severity"),
        title: (/title:\s*([^\n]+)/.exec(body)?.[1] ?? "").trim(),
      });
    }
  }
  return out;
}

function tsFiles(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) {
      if (e !== "_shared" && e !== "node_modules") tsFiles(full, acc);
    } else if (e.endsWith(".ts")) acc.push(full);
  }
  return acc;
}

/**
 * Money and security alerts the 2026-09-14 review found would have been demoted
 * to the digest by their call-site `severity: 'warning'`. Matched on title so a
 * renamed kind cannot hide one; each must resolve critical.
 */
const MUST_PAGE = [
  /Helpr payout failed/,
  /Helpr payout canceled/,
  /Helpr payout reversed/,
  /Refund ledger write failed/,
  /payment_refunds ledger write failed/,
  /Partial refund ledger write failed/,
  /Dispute refund aborted/,
  /General refund aborted/,
  /Dispute split aborted/,
  /Dispute split refund ledger write failed/,
  /Dispute settled but its record stayed open/,
  /Admin money action left no audit trail/,
  /escrow remainder unallocated/,
  /Money reconciliation (found|ran degraded)/,
  /Subscription reconciliation (found|ran degraded)/,
  /Banned identity attempted to re-verify/,
  /Instant-payout fee NOT collected/,
  /Cancellation-fee payout could not read helper account/,
];

describe("alertPolicy", () => {
  it("only critical (and the digest itself) posts immediately", () => {
    expect(postsImmediately("critical")).toBe(true);
    expect(postsImmediately("warning")).toBe(false);
    expect(postsImmediately("info")).toBe(false);
    expect(postsImmediately("info", "digest")).toBe(true);
  });

  it("keeps the SQL watchers' 'error' critical, and a missing severity is a warning", () => {
    expect(normalizeSeverity("error")).toBe("critical");
    expect(normalizeSeverity("bogus")).toBe("critical");
    expect(normalizeSeverity(undefined)).toBe("warning");
    expect(normalizeSeverity("info")).toBe("info");
  });

  it("kind floor: every money/security kind is critical whatever severity the call passes", () => {
    for (const kind of CRITICAL_KINDS) {
      for (const sev of ["info", "warning", undefined]) {
        expect(effectiveSeverity(kind, sev), `${kind} + ${String(sev)}`).toBe("critical");
      }
    }
    expect(effectiveSeverity("dispute_won", "info")).toBe("info");
    expect(effectiveSeverity("custom", "warning")).toBe("warning");
  });

  it("every reviewed money/security alert call site pages (static, from source)", () => {
    const calls = slackAlertCallSites((f) => readFileSync(f, "utf8"), tsFiles(FUNCTIONS));
    const demoted: string[] = [];
    for (const re of MUST_PAGE) {
      const hits = calls.filter((c) => re.test(c.title));
      expect(hits.length, `no call site found for ${re}`).toBeGreaterThan(0);
      for (const c of hits) {
        // A dynamic severity (e.g. `severity: worst`) is read as warning: it counts only if the kind floors it.
        const sev = effectiveSeverity(c.kind ?? undefined, c.severity ?? "warning");
        if (sev !== "critical") demoted.push(`${c.file.replace(FUNCTIONS, "")}:${c.line} ${c.title}`);
      }
    }
    expect(demoted).toEqual([]);
  });

  it("the SQL trigger's critical sources equal CRITICAL_ERROR_LOG_SOURCES", () => {
    const dir = join(process.cwd(), "supabase", "migrations");
    const latest = readdirSync(dir)
      .filter((f) => readFileSync(join(dir, f), "utf8").includes("FUNCTION public.notify_slack_on_error_log()"))
      .sort()
      .pop()!;
    const sql = readFileSync(join(dir, latest), "utf8");
    const fn = sql.slice(sql.indexOf("FUNCTION public.notify_slack_on_error_log()"));
    const arr = fn.slice(fn.indexOf("ARRAY["), fn.indexOf("];"));
    const sqlSources = [...arr.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    expect(sqlSources).toEqual([...CRITICAL_ERROR_LOG_SOURCES].sort());
  });

  it("the BEFORE-INSERT stamp guards the same sources the trigger pages on", () => {
    // Three copies of one list (TS policy, notify trigger, origin stamp). The
    // stamp is what stops a browser writing one of these sources; if it drifts
    // from the trigger's list, a forged row starts paging again.
    const dir = join(process.cwd(), "supabase", "migrations");
    const latest = readdirSync(dir)
      .filter((f) => readFileSync(join(dir, f), "utf8").includes("FUNCTION public.stamp_error_log_origin()"))
      .sort()
      .pop()!;
    const sql = readFileSync(join(dir, latest), "utf8");
    const fn = sql.slice(sql.indexOf("FUNCTION public.stamp_error_log_origin()"));
    const arr = fn.slice(fn.indexOf("ARRAY["), fn.indexOf("];"));
    const stampSources = [...arr.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    expect(stampSources).toEqual([...CRITICAL_ERROR_LOG_SOURCES].sort());
    // And it must stay SECURITY INVOKER: a definer function reads its own
    // owner from current_user and would stamp every row 'server'.
    const header = fn.slice(0, fn.indexOf("AS $fn$"));
    expect(header).not.toMatch(/SECURITY DEFINER/);
  });

  it("admin fallbacks are critical unless known informational", () => {
    expect(adminPushSeverity("Dispute split did not settle")).toBe("critical");
    expect(adminPushSeverity("Payout blocked — charge not captured")).toBe("critical");
    expect(adminPushSeverity("Something nobody classified")).toBe("critical");
    expect(adminPushSeverity("New member joined")).toBe("info");
    expect(adminPushSeverity("Dispute auto-resolved")).toBe("info");
  });

  it("admin fallback dedupe is per EVENT: one fan-out is one key, two jobs are two", () => {
    const toAdminA = { title: "Dispute split did not settle", link: "/admin?view=disputes&job=bb2c3732" };
    const toAdminB = { ...toAdminA };
    const otherJob = { ...toAdminA, link: "/admin?view=disputes&job=84f1c545" };
    expect(adminPushEventKey(toAdminA)).toBe(adminPushEventKey(toAdminB));
    expect(adminPushEventKey(toAdminA)).not.toBe(adminPushEventKey(otherJob));
  });

  it("the once-per-day window starts at UTC midnight", () => {
    expect(utcDayStartIso(new Date("2026-09-14T23:59:00-05:00"))).toBe("2026-09-15T00:00:00.000Z");
  });
});
