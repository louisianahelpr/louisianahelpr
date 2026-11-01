/**
 * A2-B6 (app audit 2026-10-28): the post-job scope video is uploaded to the job-photos bucket and its URL stored in
 * jobs.scope_video_url, but it showed nowhere: the browse view never carried the column (so the browse sheet's
 * <video>, already written, never drew), the job page never read it, and the Review step never showed the clip.
 *
 * THE CLASS: a job's scope video travels with its photos.
 *   (A) the newest open_jobs_browse projects scope_video_url (proof of the view itself:
 *       src/test/pglite/browseCarriesScopeVideo.pglite.mjs);
 *   (B) every client column list that carries a job's photos for the sheet or the page (names `photos` and
 *       `helper_fee_percent`) names scope_video_url, and a browse read made before db-deploy lands drops it on 42703;
 *   (C) one player: <video controls playsinline preload="metadata">, nothing for no video or a non-https/blob URL;
 *   (D) the Review step plays the picked clip; the browse sheet and the job page draw the shared player
 *       (the job page's render test is in src/pages/jobs/jobPage/JobPage.test.tsx).
 *
 * @mutate supabase/migrations/20261031000945_guests_get_no_poster_id_or_street.sql |     helper_fee_percent,\n    scope_video_url\n   FROM jobs |     helper_fee_percent\n   FROM jobs
 * @mutate src/lib/jobColumns.ts | ["helper_fee_percent", "scope_video_url"] as const; | ["helper_fee_percent"] as const;
 * @mutate src/hooks/useDashboardData.ts | "id, title, description, scope_video_url, | "id, title, description,
 * @mutate src/pages/jobs/jobPage/useJobPage.ts | const BASE_COLUMNS =\n  "id, title, description, scope_video_url, | const BASE_COLUMNS =\n  "id, title, description,
 * @mutate src/lib/scopeVideo.ts | return protocol === "https:" \|\| protocol === "blob:" ? url : null; | return url;
 * @mutate src/components/jobs/ScopeVideo.tsx | preload="metadata" | preload="none"
 * @mutate src/components/postjob/CheckoutStep.tsx | <ReviewMediaRows imagePreviews={imagePreviews} scopeVideoUrl={scopeVideoUrl} /> | <ReviewMediaRows imagePreviews={imagePreviews} />
 * @mutate src/pages/post-job/CheckoutStepView.tsx |         scopeVideoUrl={form.scopeVideoPreviewUrl}\n |
 * @mutate src/components/dashboard/JobDetailDialog.tsx |             <ScopeVideo url={job.scope_video_url} /> |
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { readdirSync, trackedFiles } from "./helpers/trackedFiles";
import { BROWSE_VIEW_COLUMNS_AHEAD_OF_DB, readJobsAheadOfDb } from "@/lib/jobColumns";
import { ScopeVideo } from "@/components/jobs/ScopeVideo";
import { CheckoutStepView } from "@/pages/post-job/CheckoutStepView";
import type { usePostJobForm } from "@/pages/post-job/usePostJobForm";

vi.mock("@/hooks/useStripeSalesTax", () => ({
  useStripeSalesTax: () => ({ salesTax: 0, loading: false, jurisdiction: null }),
}));

const ROOT = resolve(__dirname, "../..");
const MIG = join(ROOT, "supabase/migrations");
const VIDEO = "https://fncmgoasalhdgfwzhsqa.supabase.co/storage/v1/object/public/job-photos/x/scope-video.mp4";

describe("A2-B6: a job's scope video travels with its photos", () => {
  it("(A) the newest open_jobs_browse projects scope_video_url", () => {
    let newest = "";
    let body = "";
    for (const f of readdirSync(MIG).filter((x) => x.endsWith(".sql")).sort()) {
      const sql = blankSqlComments(readFileSync(join(MIG, f), "utf8"));
      // The LAST definition in a file wins (a file may restate it twice).
      for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+public\.open_jobs_browse\b([\s\S]*?)\n\s*FROM\s+jobs\b/gi)) {
        newest = f;
        body = m[1];
      }
    }
    expect(newest, "a migration defines the view").not.toBe("");
    expect(body, newest).toMatch(/\bscope_video_url\b/);
  });

  const files = trackedFiles("src")
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/(^|\/)test\//.test(f) && !/\.test\.tsx?$/.test(f) && !f.endsWith(".d.ts") && !f.endsWith("/types.ts"))
    .map((f) => ({ file: f, code: blankComments(readFileSync(join(ROOT, f), "utf8")) }));

  it("(B) every column list carrying a job's photos for the sheet or the page names scope_video_url", () => {
    const lists: { file: string; text: string }[] = [];
    for (const { file, code } of files) {
      for (const m of code.matchAll(/(["'`])((?:[a-z_][a-z0-9_]*\s*,\s*)+[a-z_][a-z0-9_]*)\1/g)) {
        if (/\bphotos\b/.test(m[2]) && /\bhelper_fee_percent\b/.test(m[2])) lists.push({ file, text: m[2] });
      }
    }
    // useDashboardData, fetchJobForPin, QuickApplyHandler, guestJobsQuery, guestJobsPrefetch, useJobPage x2.
    // (JobDetail left 10-31, JOBS-29: a guest's shared-link read is title, category, budget and town only.)
    expect(lists.length, "photo-carrying job lists").toBeGreaterThan(6);
    expect(lists.filter((l) => !/\bscope_video_url\b/.test(l.text)).map((l) => `${l.file}: ${l.text.slice(0, 50)}`)).toEqual([]);
  });

  it("(B) a browse read before db-deploy lands drops scope_video_url on 42703 and keeps working", async () => {
    expect(BROWSE_VIEW_COLUMNS_AHEAD_OF_DB).toContain("scope_video_url");
    const seen: string[] = [];
    const res = await readJobsAheadOfDb("id, photos, scope_video_url", async (cols) => {
      seen.push(cols);
      return cols.includes("scope_video_url") ? { error: { code: "42703" } } : { error: null };
    }, { browseView: true });
    expect(res.error).toBeNull();
    expect(seen).toEqual(["id, photos, scope_video_url", "id, photos"]);
  });

  it("(C) one player: controls, inline, metadata only; nothing for no video or an unplayable URL", () => {
    const { container, unmount } = render(<ScopeVideo url={VIDEO} />);
    const v = container.querySelector("video");
    expect(v?.getAttribute("src")).toBe(VIDEO);
    expect(v?.hasAttribute("controls")).toBe(true);
    expect(v?.hasAttribute("playsinline")).toBe(true);
    expect(v?.getAttribute("preload")).toBe("metadata");
    unmount();
    for (const url of [null, undefined, "", "javascript:alert(1)", "http://example.test/v.mp4", "not a url"]) {
      const r = render(<ScopeVideo url={url} />);
      expect(r.container.querySelector("video"), String(url)).toBeNull();
      r.unmount();
    }
  });

  function form(scopeVideoPreviewUrl: string | null): ReturnType<typeof usePostJobForm> {
    return {
      setStep: vi.fn(), setFormPage: vi.fn(), setCategoryGroup: vi.fn(),
      title: "Mow front yard", description: "Front yard about a quarter acre.", categoryLabel: "Yard work", category: "yard_work",
      imagePreviews: [], scopeVideoPreviewUrl, streetAddress: "4412 Highland Rd", city: "Baton Rouge", addrState: "LA", zipCode: "70808",
      dateNeeded: "2026-10-31", startTime: "09:00", estimatedHours: "", isFlexibleSchedule: false, specialRequirements: "",
      isRecurring: false, recurrenceInterval: "", recurrenceEndDate: "", recurrenceDays: [], recurrenceWeeks: 0,
      isUrgent: false, urgentFeeNum: 0, budgetNum: 40, helprActivity: null, customerFeeAmount: 0, onboardingFeeAmount: 0,
      totalCharge: 40, hasGift: false, giftAppliedAmount: 0, giftCreditAmount: 0, giftLoading: false, giftUnavailable: false,
      confirmed: false, setConfirmed: vi.fn(), saveCardForFuture: false, setSaveCardForFuture: vi.fn(),
      saving: false, redirecting: false, uploading: false, uploadProgress: null, handleSubmit: vi.fn(), parish: "East Baton Rouge",
    } as unknown as ReturnType<typeof usePostJobForm>;
  }

  it("(D) the Review step plays the picked clip, and shows no player without one", () => {
    const blob = "blob:http://localhost/1b2c3d4e-0000-4000-8000-000000000000";
    const { container, unmount } = render(<CheckoutStepView form={form(blob)} />);
    expect(container.querySelector("video[data-scope-video]")?.getAttribute("src")).toBe(blob);
    unmount();
    const none = render(<CheckoutStepView form={form(null)} />);
    expect(none.container.querySelector("video")).toBeNull();
  });

  it("(D) the browse sheet draws the shared player from the job's scope_video_url", () => {
    const dialog = blankComments(readFileSync(join(ROOT, "src/components/dashboard/JobDetailDialog.tsx"), "utf8"));
    expect(dialog).toMatch(/<ScopeVideo url=\{job\.scope_video_url\} \/>/);
    // Only the shared player draws a scope video: no second hand-rolled <video> in the sheet.
    expect(dialog.match(/<video\b/g) ?? []).toEqual([]);
  });
});
