/**
 * STANDARD PAY 3 DAYS after the job is done (docs/OPEN.md Q202, owner decision
 * 2026-09-23; it was ~48h: a 24h auto-complete, then now + 24h at every release
 * write). The wait is the card-dispute buffer: money still on the platform can
 * be held when the cardholder disputes. The paid instant payout is unchanged.
 *
 * Held here:
 *   1. the rule (_shared/escrowTiming.ts standardPayoutAtIso): done + 72h,
 *      never before now, "done" = helper_completed_at (else now);
 *   2. INVENTORY of every edge write of jobs.payout_scheduled_at (live SQL had
 *      none, measured 2026-09-23 with a pg_proc scan): each standard-path
 *      writer calls standardPayoutAtIso. The one allowed exception is
 *      auto-resolve-disputes (a dispute settlement, not the standard path);
 *   3. behaviour on the REAL auto-release-payment through the edge harness:
 *      the scheduled time is helper_completed_at + 72h;
 *   4. COPY: no edge notification promises "in 24 hours" for a payout, and the
 *      client sites that state the standard timing interpolate
 *      STANDARD_PAYOUT_PHRASE.
 *
 * @mutate supabase/functions/_shared/escrowTiming.ts | export const STANDARD_PAYOUT_DAYS_AFTER_DONE = 3; | export const STANDARD_PAYOUT_DAYS_AFTER_DONE = 2;
 * @mutate supabase/functions/auto-release-payment/index.ts | const payoutTime = standardPayoutAtIso(job.helper_completed_at); | const payoutTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
 * @mutate supabase/functions/create-payment/index.ts | const payoutTime = standardPayoutAtIso(isHelper ? null : job.helper_completed_at); | const payoutTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
 * @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts | updateData.payout_scheduled_at = standardPayoutAtIso(null); | updateData.payout_scheduled_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
 * @mutate supabase/functions/auto-release-payment/index.ts | will be sent to your account ${STANDARD_PAYOUT_PHRASE}.`\n            : `"${job.title}" was auto-completed | will be transferred to your account in 24 hours.`\n            : `"${job.title}" was auto-completed
 * @mutate src/components/profile/earningsTab/EarningsSummaryCard.tsx | `Approved — sent ${STANDARD_PAYOUT_PHRASE}` | `Approved — releases 24 hours after approval`
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  STANDARD_PAYOUT_DAYS_AFTER_DONE,
  STANDARD_PAYOUT_HOURS_AFTER_DONE,
  STANDARD_PAYOUT_PHRASE,
  standardPayoutAtIso,
} from "../../supabase/functions/_shared/escrowTiming";
import { blankComments } from "./helpers/blankNonCode";
import { loadEdgeFunction } from "./edge/harness";
import { setEnv, resetEnv } from "./edge/mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./edge/mocks/stripe";
import { scenario, resetSupabaseMock } from "./edge/mocks/supabase";
import { resetSharedMocks } from "./edge/mocks/shared";

const ROOT = resolve(__dirname, "../..");
const FN_DIR = join(ROOT, "supabase/functions");
const H = 3_600_000;

function edgeFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (e.endsWith(".ts") && !e.includes(".test.")) out.push(p);
    }
  };
  walk(FN_DIR);
  return out;
}

describe("standard pay: 3 days after the job is done (Q202)", () => {
  it("the rule: done + 72h, never before now", () => {
    expect(STANDARD_PAYOUT_DAYS_AFTER_DONE).toBe(3);
    expect(STANDARD_PAYOUT_HOURS_AFTER_DONE).toBe(72);
    expect(STANDARD_PAYOUT_PHRASE).toBe("3 days after the job is marked done");
    const now = Date.parse("2026-09-23T12:00:00.000Z");
    const iso = (ms: number) => new Date(ms).toISOString();
    expect(standardPayoutAtIso(iso(now - 10 * H), now)).toBe(iso(now + 62 * H));
    expect(standardPayoutAtIso(iso(now - 24 * H), now)).toBe(iso(now + 48 * H)); // auto-complete path
    expect(standardPayoutAtIso(iso(now - 100 * H), now)).toBe(iso(now));
    expect(standardPayoutAtIso(null, now)).toBe(iso(now + 72 * H));
    expect(standardPayoutAtIso("not a date", now)).toBe(iso(now + 72 * H));
    // A done stamp in the future (clock skew) never shortens the wait below 72h from now.
    expect(standardPayoutAtIso(iso(now + 5 * H), now)).toBe(iso(now + 72 * H));
  });

  it("every standard-path write of payout_scheduled_at uses standardPayoutAtIso", () => {
    // @two-way src/test/standardPayoutThreeDays.test.ts:const staleAllowed =
    const ALLOWED: Record<string, string> = {
      // Dispute settlement, not the standard path: a decided dispute pays 24h
      // after it resolves (unchanged by Q202; the job was done days before).
      "supabase/functions/auto-resolve-disputes/index.ts": "new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()",
    };
    const writes: Array<{ file: string; value: string }> = [];
    for (const f of edgeFiles()) {
      const src = blankComments(readFileSync(f, "utf8"));
      const rel = f.slice(ROOT.length + 1);
      for (const m of src.matchAll(/payout_scheduled_at\s*(?::|=(?!=))\s*([^,;\n)}]+(?:\([^)]*\))?[^,;\n}]*)/g)) {
        let value = m[1].trim();
        if (value.startsWith("job.payout_scheduled_at")) continue; // a read copied into a report row
        if (value === "null") continue;
        const ident = value.match(/^([A-Za-z_]\w*)$/)?.[1];
        if (ident) {
          const def = src.match(new RegExp(`const ${ident}\\s*=\\s*([^;]+);`));
          value = def ? def[1].trim() : value;
        }
        writes.push({ file: rel, value });
      }
    }
    expect(writes.length, "inventory of payout_scheduled_at writers").toBeGreaterThanOrEqual(4);
    const bad = writes.filter((w) => !/^standardPayoutAtIso\(/.test(w.value) && ALLOWED[w.file] !== w.value);
    expect(bad, JSON.stringify(bad, null, 2)).toEqual([]);
    // Two-way: an ALLOWED entry whose write no longer exists is stale.
    const staleAllowed = Object.entries(ALLOWED).filter(([f, v]) => !writes.some((w) => w.file === f && w.value === v));
    expect(staleAllowed, "stale ALLOWED entry — remove it").toEqual([]);
    const files = new Set(writes.map((w) => w.file));
    for (const f of [
      "supabase/functions/auto-release-payment/index.ts",
      "supabase/functions/create-payment/index.ts",
      "supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts",
    ]) expect(files.has(f), f).toBe(true);
  });

  it("no edge notification promises a payout 'in 24 hours'", () => {
    const offenders: string[] = [];
    for (const f of edgeFiles()) {
      const src = blankComments(readFileSync(f, "utf8"));
      for (const line of src.split("\n")) {
        if (/(paid|transferred|sent)[^`"'\n]{0,60}\bin (24|48) hours/i.test(line)) offenders.push(`${f.slice(ROOT.length + 1)}: ${line.trim().slice(0, 120)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the client sites that state the standard timing interpolate the shared phrase", () => {
    const sites = [
      "src/pages/jobs/appliedJobCard/steps/SubmittedStep.tsx",
      "src/components/profile/earningsTab/EarningsSummaryCard.tsx",
      "src/pages/info/helpCenter/helpCenterContent.ts",
      "src/pages/info/legal/TermsSection.tsx",
    ];
    for (const s of sites) {
      const src = blankComments(readFileSync(join(ROOT, s), "utf8"));
      expect(src, s).toMatch(/STANDARD_PAYOUT_PHRASE/);
      expect(src, s).not.toMatch(/hours after (approval|dual confirmation)/);
    }
    const history = blankComments(readFileSync(join(ROOT, "src/components/profile/earningsTab/EarningHistory.tsx"), "utf8"));
    expect(history).toMatch(/\$\{STANDARD_PAYOUT_DAYS_AFTER_DONE\} days after done/);
  });
});

describe("auto-release-payment schedules the payout 3 days after done (edge harness)", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  it("helper marked done 25h ago → payout_scheduled_at = done + 72h", async () => {
    setEnv({
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-key",
      STRIPE_SECRET_KEY: "sk_test_abc",
      CRON_SECRET: "cron-secret",
      RELEASE_PAYOUT_AUTO: "0",
    });
    const fn = await loadEdgeFunction("auto-release-payment");
    const doneAt = new Date(Date.now() - 25 * H).toISOString();
    scenario.reads.jobs = {
      selectOverrides: [{ includes: "revision_acceptance_deadline", result: { rows: [] } }],
      rows: [{
        id: "job-1", title: "Deep clean", helper_id: "helper-1", customer_id: "poster-1", budget: 200,
        platform_fee_amount: 16, urgent_fee: 0, poster_completed_at: null, helper_completed_at: doneAt,
        stripe_session_id: "cs_1", stripe_payment_intent_id: "pi_1", status: "in_progress",
        is_group_job: false, helpers_needed: 1, helper_fee_percent: 8,
      }],
    };
    scenario.reads.gift_cards = { rows: [] };
    scenario.reads.profiles = { rows: [] };
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_1", status: "succeeded" });
    await fn.fetch(fn.request({ method: "POST", headers: { Authorization: "Bearer cron-secret" }, url: "https://edge.test/auto-release-payment" }));
    const release = scenario.writes.find(
      (w) => w.table === "jobs" && w.op === "update" && (w.payload as Record<string, unknown>).payment_status === "payout_pending",
    );
    expect(release, "auto-release never scheduled the payout").toBeDefined();
    const at = Date.parse(String((release!.payload as Record<string, unknown>).payout_scheduled_at));
    expect(Math.abs(at - (Date.parse(doneAt) + 72 * H))).toBeLessThan(60_000);
  });
});
