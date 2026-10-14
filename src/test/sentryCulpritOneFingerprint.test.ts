// @mutate scripts/lib/sentryLedgerSync.mjs | source: `sentry:${sentryCulpritKey(i?.culprit)}`.slice(0, 120), | source: `sentry:${i?.culprit ?? "unknown"}`.slice(0, 120),
// @mutate scripts/lib/sentryLedgerSync.mjs |   if (!hashed) return raw; |   return raw;
// @mutate scripts/lib/sentryLedgerSync.mjs | const HASHED_BUNDLE = /^(.*\/)?([^/]*)-(?=[A-Za-z0-9_-]{0,7}[A-Z0-9_-])[A-Za-z0-9_-]{8}(\.m?js)?$/; | const HASHED_BUNDLE = /^(.*\/)?([^/]*)-[A-Za-z0-9_-]{8}(\.m?js)?$/;
// @mutate supabase/migrations/20261014184909_sentry_alerts_fold_bundle_hashes.sql | ([^/]*)-(?=[A-Za-z0-9_-]{0,7}[A-Z0-9_-])[A-Za-z0-9_-]{8}(\.m?js)?$'); | ([^/]*)-[A-Za-z0-9_-]{8}(\.m?js)?$');
/*
 * GUARD (owner 2026-10-14: the docs/OPEN.md FEEDS list kept refilling with
 * copies of one problem): ONE SENTRY ERROR IS ONE LEDGER ROW.
 *
 * ops_alert_apply keys a row on md5(source_kind|source|title). The Sentry sync
 * used Sentry's culprit as the source, and a culprit carries the Vite bundle's
 * content hash plus a minified function name, both new on every deploy.
 * Measured on prod ops_alert_ledger 2026-10-14 (58 sentry rows, 40 open):
 * "permission denied for table profiles" 5 rows under 5 sources
 * (`cu(assets/app-shared-DUoNbpYC)` ... `Ku(assets/app-shared-CkIDj-oG)`),
 * "...table jobs" 5, "session lost on a signed-in screen" 3, and each became
 * its own OPEN.md item (Q1596/Q1811, Q1636/Q1812, Q1610/Q1700).
 *
 * Red when: two culprits that differ only by bundle hash or minified function
 * give two sources (so two fingerprints); or the SQL twin that folded the old
 * rows (public.ops_alert_sentry_source, newest definition) stops using the
 * same three patterns. PGlite run 2026-10-14 on the 58 prod rows: 58 -> 34
 * rows (40 -> 19 open), 251 occurrences kept, 0 JS/SQL mismatches over 65
 * sources, 3 applications identical (replay-safe).
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { SENTRY_CULPRIT_PATTERNS, sentryCulpritKey, sentryIssueToAlert } from "../../scripts/lib/sentryLedgerSync.mjs";

const REPO = resolve(__dirname, "..", "..");
/** ops_alert_apply's key (supabase/migrations/20260923050059 section 4); the title is already normalised by the caller here. */
const fingerprint = (a: { sourceKind: string; source: string; title: string }) =>
  createHash("md5").update(`${a.sourceKind}|${a.source}|${a.title.toLowerCase()}`).digest("hex");
const issue = (culprit: string, title = "permission denied for table profiles") =>
  sentryIssueToAlert({ id: "1", shortId: "JAVASCRIPT-2Q", title, culprit, level: "error", status: "unresolved", lastSeen: "2026-10-13T23:01:36Z", permalink: "https://x" });

describe("one Sentry error is one ledger fingerprint", () => {
  it("two deploys of one error (bundle hash and minified name differ) give ONE source and ONE fingerprint", () => {
    const a = issue("cu(assets/app-shared-DUoNbpYC)");
    const b = issue("Ku(assets/app-shared-CkIDj-oG)");
    const c = issue("bu(assets/app-shared-D-Rq5FZy)");
    expect(a.source).toBe("sentry:assets/app-shared");
    expect(new Set([a, b, c].map(fingerprint)).size).toBe(1);
  });

  it("the minified function name alone does not split an error (JAVASCRIPT-1Q was `?` and `f.<anonymous>`)", () => {
    expect(issue("?(assets/supabase-B9flpjD6)").source).toBe(issue("f.<anonymous>(assets/supabase-B9flpjD6)").source);
    expect(issue("?(assets/ProtectedRoute-CAbqOrT0)").source).toBe(issue("?(assets/ProtectedRoute-BOkAU22A)").source);
  });

  it("keeps what tells two errors apart: the bundle name, and any culprit that is not a hashed bundle", () => {
    expect(issue("cu(assets/app-shared-DUoNbpYC)").source).not.toBe(issue("cn(assets/Dashboard-Fh8VHeDN)").source);
    expect(sentryCulpritKey("sendDataToNative(iabjs://navigation_performance_logger_android)")).toBe("sendDataToNative(iabjs://navigation_performance_logger_android)");
    expect(sentryCulpritKey("src/lib/foo-bar")).toBe("src/lib/foo-bar");
    expect(sentryCulpritKey("fn(assets/no-hash)")).toBe("fn(assets/no-hash)");
    expect(sentryCulpritKey("/assets/app-shared-CkIDj-oG.js")).toBe("assets/app-shared");
    expect(sentryCulpritKey(undefined)).toBe("unknown");
    expect(sentryCulpritKey("  ")).toBe("unknown");
  });

  it("is idempotent: a lower-case word after a dash is a NAME, not a hash (assets/tiktok-provider)", () => {
    expect(sentryCulpritKey("x(assets/tiktok-provider-CkIDj-oG)")).toBe("assets/tiktok-provider");
    expect(sentryCulpritKey("assets/tiktok-provider")).toBe("assets/tiktok-provider");
    const culprits = ["cu(assets/app-shared-DUoNbpYC)", "?(assets/ProtectedRoute-BOkAU22A)", "x(assets/tiktok-provider-AbCdEf12)",
      "/assets/app-shared-CkIDj-oG.js", "sendDataToNative(iabjs://navigation_performance_logger_android)", "fn(assets/no-hash)"];
    expect(culprits.length).toBeGreaterThan(5);
    for (const c of culprits) expect(sentryCulpritKey(sentryCulpritKey(c)), c).toBe(sentryCulpritKey(c));
  });

  it("the SQL twin that folded the old rows uses the same three patterns (newest definition)", () => {
    const def = effectiveDefs(join(REPO, "supabase", "migrations")).get("ops_alert_sentry_source");
    expect(def, "public.ops_alert_sentry_source is defined by a migration").toBeTruthy();
    const body = blankSqlComments(def!.stmt);
    const patterns = Object.values(SENTRY_CULPRIT_PATTERNS) as RegExp[];
    expect(patterns.length).toBeGreaterThan(2);
    for (const re of patterns) {
      // A JS literal escapes `/`; a SQL string does not.
      const sql = re.source.replace(/\\\//g, "/");
      expect(body, `SQL twin lacks the pattern ${sql}`).toContain(`'${sql}'`);
    }
    // The JS drops a leading "/" from the bundle path; so must the SQL.
    expect(body).toContain("regexp_replace(coalesce(v_hashed[1], ''), '^/', '')");
  });
});
