/**
 * Q289: App Store reviews that report a problem reach the ops alert ledger.
 *
 * Before: nothing read App Store Connect customer reviews, so a 1-star "it
 * crashes when I pay" sat in App Store Connect where nobody looks.
 * scripts/check-store-reviews.mjs (quota-monitor.yml, daily) now records every
 * review rated 3 stars or lower as a `user-report` ledger item, once, and
 * fails closed on every read it depends on.
 *
 * Proven here against a stub App Store Connect API and a stub Management API
 * (the ledger writes land on the stub): which reviews are recorded, that each
 * is recorded once (the cursor), that review text never reaches the public
 * log, and that every failure is a red run for its own reason.
 */
// @mutate scripts/lib/storeReviews.mjs |     if (r.rating <= REVIEW_MAX_RATING) out.push(r); |     out.push(r);
// @mutate scripts/lib/storeReviews.mjs |     if (t <= since.getTime()) continue; |     if (false) continue;
// @mutate scripts/check-store-reviews.mjs |   if (refused.length) return fail( |   if (false) return fail(
// @mutate scripts/check-store-reviews.mjs |   if (!appId) return fail( |   if (false) return fail(
// @mutate .github/workflows/quota-monitor.yml |         run: node scripts/check-store-reviews.mjs |         run: echo skipped
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LOOKBACK_DAYS, ledgerItem, reportable, sinceFrom, toReview, type StoreReview } from "../../scripts/lib/storeReviews.mjs";

const ROOT = join(__dirname, "..", "..");
const APP_ID = "6400000000";
const SECRET = "the card screen froze after I paid";

const rv = (id: string, rating: number, created: string, title = `t${id}`, body = SECRET): StoreReview =>
  ({ id, rating, title, body, nickname: "nick", territory: "USA", created });

describe("which reviews are reports", () => {
  const since = new Date("2026-09-20T00:00:00Z");
  it("rated 3 or lower, strictly after the cursor, oldest first", () => {
    const { reviews, unreadable } = reportable([
      rv("a", 1, "2026-09-22T10:00:00Z"), rv("b", 5, "2026-09-22T09:00:00Z"), rv("c", 3, "2026-09-21T10:00:00Z"),
      rv("d", 4, "2026-09-21T09:00:00Z"), rv("e", 2, "2026-09-20T00:00:00Z"), rv("f", 1, "2026-09-19T00:00:00Z"),
    ], since);
    expect(reviews.map((r) => r.id)).toEqual(["c", "a"]);
    expect(unreadable).toEqual([]);
  });
  it("a review with no readable rating or date is unreadable, never dropped", () => {
    const { unreadable } = reportable([rv("x", Number.NaN, "2026-09-22T00:00:00Z"), rv("y", 2, "not a date"), rv("", 1, "2026-09-22T00:00:00Z")], since);
    expect(unreadable).toHaveLength(3);
  });
  it("the cursor, else a 14-day lookback", () => {
    const now = new Date("2026-09-23T00:00:00Z");
    expect(sinceFrom("2026-09-21T05:00:00Z", now).toISOString()).toBe("2026-09-21T05:00:00.000Z");
    expect(sinceFrom(null, now).getTime()).toBe(now.getTime() - LOOKBACK_DAYS * 86_400_000);
  });
  it("the ledger item: a user-report the owner closes by hand, carrying the review's date as the cursor", () => {
    const low = ledgerItem(rv("a", 1, "2026-09-22T10:00:00Z", "Crashes"), APP_ID);
    expect(low).toMatchObject({ sourceKind: "user-report", source: "app-store-review", severity: "error", verifyKind: "manual", seenAt: "2026-09-22T10:00:00Z" });
    expect(low.title).toBe("App Store review, low rating: Crashes");
    expect(low.sampleRef).toMatchObject({ review_id: "a", rating: 1, review_created: "2026-09-22T10:00:00Z" });
    expect(low.sampleRef.link).toContain(APP_ID);
    expect(low.sample).toContain(SECRET);
    expect(ledgerItem(rv("c", 3, "2026-09-22T10:00:00Z"), APP_ID).severity).toBe("warning");
    expect(toReview({ id: "9", attributes: { rating: 2, title: "T", body: "B", reviewerNickname: "N", territory: "USA", createdDate: "2026-09-22T00:00:00-07:00" } }))
      .toEqual({ id: "9", rating: 2, title: "T", body: "B", nickname: "N", territory: "USA", created: "2026-09-22T00:00:00-07:00" });
  });
});

// ── the CLI against stub App Store Connect + Management API ─────────────────
type Mode = { apps: "ok" | "none" | "fail"; reviews: "ok" | "403" | "fail"; cursor: string | null | "fail" | "empty"; record: "ok" | "fail" };
let mode: Mode;
let recorded: Array<{ query: string }> = [];
let server: Server;
let base = "";
const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const REVIEWS = {
  data: [
    { id: "r5", type: "customerReviews", attributes: { rating: 5, title: "Love it", body: "great", reviewerNickname: "n5", territory: "USA", createdDate: "2026-09-22T12:00:00Z" } },
    { id: "r1", type: "customerReviews", attributes: { rating: 1, title: "Crashes", body: SECRET, reviewerNickname: "n1", territory: "USA", createdDate: "2026-09-22T11:00:00Z" } },
    { id: "r3", type: "customerReviews", attributes: { rating: 3, title: "Slow", body: SECRET, reviewerNickname: "n3", territory: "USA", createdDate: "2026-09-21T11:00:00Z" } },
    { id: "old", type: "customerReviews", attributes: { rating: 1, title: "Old", body: SECRET, reviewerNickname: "n0", territory: "USA", createdDate: "2026-09-20T11:00:00Z" } },
  ],
  links: { next: null },
};

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      const url = req.url ?? "";
      const send = (code: number, json: unknown) => { res.statusCode = code; res.end(JSON.stringify(json)); };
      if (url.startsWith("/v1/apps?")) {
        if (mode.apps === "fail") return send(500, { errors: [{ title: "stub", detail: "down" }] });
        return send(200, { data: mode.apps === "ok" ? [{ id: APP_ID, type: "apps", attributes: { name: "Helpr" } }] : [] });
      }
      if (url.startsWith(`/v1/apps/${APP_ID}/customerReviews`)) {
        if (mode.reviews === "403") return send(403, { errors: [{ title: "Forbidden", detail: "not allowed" }] });
        if (mode.reviews === "fail") return send(500, { errors: [{ title: "stub", detail: "down" }] });
        return send(200, REVIEWS);
      }
      if (url.includes("/database/query")) {
        const { query } = JSON.parse(body || "{}") as { query: string };
        if (/ops_alert_record\(/.test(query)) {
          if (mode.record === "fail") return send(500, { message: "stub" });
          recorded.push({ query });
          return send(200, [{ id: "00000000-0000-0000-0000-000000000001" }]);
        }
        if (mode.cursor === "fail") return send(500, { message: "stub" });
        if (mode.cursor === "empty") return send(200, []);
        return send(200, [{ cursor: mode.cursor }]);
      }
      send(404, {});
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

function runCli(m: Partial<Mode>): Promise<{ code: number; out: string }> {
  mode = { apps: "ok", reviews: "ok", cursor: "2026-09-21T00:00:00Z", record: "ok", ...m };
  recorded = [];
  const env = {
    PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "/tmp",
    ASC_KEY_ID: "STUBKEY", ASC_ISSUER_ID: "stub-issuer", ASC_KEY_CONTENT: key, LH_ASC_API_BASE: base,
    SUPABASE_ACCESS_TOKEN: "stub", SUPABASE_PROJECT_REF: "stub", LH_SUPABASE_API_BASE: base,
  };
  return new Promise((done) => {
    execFile(process.execPath, ["scripts/check-store-reviews.mjs"], { cwd: ROOT, env, timeout: 60_000 }, (err, stdout, stderr) => {
      done({ code: err ? Number((err as NodeJS.ErrnoException).code ?? 1) : 0, out: `${stdout}\n${stderr}` });
    });
  });
}

const recordedReviewIds = () => recorded.map((r) => /"review_id":"([^"]+)"/.exec(r.query)?.[1]).filter(Boolean);

describe("check-store-reviews.mjs (stub App Store Connect + Management API)", () => {
  it("records each low-rated review newer than the cursor, once, as a user-report; exit 0", async () => {
    const { code, out } = await runCli({});
    expect(code, out).toBe(0);
    expect(recordedReviewIds()).toEqual(["r3", "r1"]);
    expect(recorded[0].query).toContain("'user-report', 'app-store-review'");
    expect(out).toMatch(/2 rated 3 stars or lower -> 2 recorded/);
  }, 60_000);
  it("never prints review text to the (public) log", async () => {
    const { out } = await runCli({});
    expect(out).not.toContain(SECRET);
    expect(out).not.toMatch(/Crashes|Slow|n1\b/);
  }, 60_000);
  it("a run after the newest review records nothing and is green (a true zero)", async () => {
    const { code, out } = await runCli({ cursor: "2026-09-22T11:00:00Z" });
    expect(code, out).toBe(0);
    expect(recordedReviewIds()).toEqual([]);
  }, 60_000);
  it("first run (no cursor) looks back 14 days", async () => {
    const { code } = await runCli({ cursor: null });
    expect(code).toBe(0);
    // All three low-rated stub reviews are within 14 days of the run only if the
    // run is near them; assert the rule, not the calendar: nothing older than the lookback.
    const since = Date.now() - LOOKBACK_DAYS * 86_400_000;
    const expected = REVIEWS.data.filter((r) => r.attributes.rating <= 3 && Date.parse(r.attributes.createdDate) > since).map((r) => r.id).reverse();
    expect(recordedReviewIds()).toEqual(expected);
  }, 60_000);
  it("the key cannot read reviews (403) -> red, naming the owner step", async () => {
    const { code, out } = await runCli({ reviews: "403" });
    expect(code).toBe(1);
    expect(out).toMatch(/could not read App Store reviews: .*403.*OWNER STEP: .*Customer Reviews access/);
  }, 60_000);
  it("App Store Connect down -> red", async () => {
    const { code, out } = await runCli({ apps: "fail" });
    expect(code).toBe(1);
    expect(out).toMatch(/could not read App Store reviews: ASC GET .* 500/);
  }, 60_000);
  it("no app for the bundle id -> red, not a quiet zero", async () => {
    const { code, out } = await runCli({ apps: "none" });
    expect(code).toBe(1);
    expect(out).toMatch(/no App Store app for bundle id com\.Helpr — refusing to report clean/);
  }, 60_000);
  it("cursor unreadable or empty -> red (it could re-record or skip reviews)", async () => {
    for (const cursor of ["fail", "empty"] as const) {
      const { code, out } = await runCli({ cursor });
      expect(code, cursor).toBe(1);
      expect(out).toMatch(/could not read the review cursor from the ops alert ledger/);
    }
  }, 60_000);
  it("a ledger write refused -> red, naming the review", async () => {
    const { code, out } = await runCli({ record: "fail" });
    expect(code).toBe(1);
    expect(out).toMatch(/2 App Store review\(s\) were NOT recorded in the ledger: r3, r1/);
  }, 60_000);
});

describe("quota-monitor.yml runs the review ingest daily with the ASC key", () => {
  it("store_reviews job, its secrets, and the notify status", () => {
    const wf = readFileSync(join(ROOT, ".github/workflows/quota-monitor.yml"), "utf8").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    expect(wf).toMatch(/-\s*cron:\s*"\d+ \d+ \* \* \*"/);
    expect(wf).toMatch(/run: node scripts\/check-store-reviews\.mjs\s*$/m);
    for (const s of ["ASC_KEY_ID", "ASC_ISSUER_ID", "ASC_KEY_CONTENT", "ASC_KEY_BASE64", "SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF"]) {
      expect(wf).toContain(`${s}: \${{ secrets.${s} }}`);
    }
    expect(wf).toMatch(/needs: \[[^\]]*store_reviews[^\]]*\]/);
    expect(wf).toMatch(/needs\.store_reviews\.result == 'success'/);
  });
});
