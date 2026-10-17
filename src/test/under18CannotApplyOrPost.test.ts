/**
 * Q1586(c) CLASS GUARD (owner, 2026-10-12: "Grey out the button until the age
 * is 18 or over").
 *
 * The class: every way into applying for or posting a job. A member whose
 * SAVED birthday makes them under 18 sees each one greyed out with a plain line
 * (or a tap that says why), and the server refuses the same member, so a direct
 * API call cannot get around the grey-out. Before this change nothing read
 * profiles.date_of_birth outside sign-up, so every part below was RED.
 *
 *   1. CLIENT INVENTORY, built from src/ itself: every non-test file whose CODE
 *      (comments blanked) names the /post-job route, renders "Apply Now", or
 *      calls apply_to_job / respond_to_direct_offer / claim_series_dates must
 *      read the gate: useAgeGate() for an entry point, isUnder18Refusal /
 *      the under_18 copy for a call site. The exceptions are an EXACT list with
 *      a reason each (route tables, the landing page, the steps inside the
 *      /post-job flow whose own form is gated), and an exception that no
 *      longer names the route fails too.
 *   2. SERVER, read from the migrations (comments blanked, any dollar-quote
 *      tag, the definitions the migrations actually leave): apply_to_job
 *      refuses 'under_18' before its rate ladder; BEFORE INSERT triggers on
 *      jobs, applications and job_accept_pending run refuse_under_18_member;
 *      a saved under-18 birthday is locked against the member's own rewrite;
 *      member_under_18 reads Louisiana's date, adds 18 years, and is REVOKEd
 *      from PUBLIC, anon and authenticated (it would tell anyone a member's age).
 *   3. The date rule (src/lib/ageGate.ts): 18 on the 18th birthday, never a day
 *      early from a UTC parse, 29 February turning 18 on 28 February, and no
 *      birthday saved meaning no gate.
 *
 * Behaviour (live apply_to_job, real roles, migration applied 3x):
 *   node src/test/pglite/under18CannotApplyOrPost.pglite.mjs                     (37 PASS)
 *   NEW_MIGRATION=skip node src/test/pglite/under18CannotApplyOrPost.pglite.mjs  (17 FAIL)
 *
 * @mutate src/components/dashboard/jobDetailDialog/JobDetailFooter.tsx |   const { gate, gatedProps } = useAgeGate(); |   const gate = (_k: string, go: () => void) => go; const gatedProps = (_k: string) => ({});
 * @mutate src/components/MobileNav.tsx |   const { underAge, explain: explainAgeGate, gatedProps: ageGatedProps } = useAgeGate(); |   const underAge = false; const explainAgeGate = (_k: string) => {}; const ageGatedProps = (_k: string) => ({});
 * @mutate src/pages/post-job/useJobSubmit.ts |           : isUnder18Refusal(error) |           : false
 * @mutate src/lib/seriesDates.ts | ?? (isUnder18Refusal(error) ? UNDER_18_APPLY_COPY : null) | ?? null
 * @mutate supabase/migrations/20261013010621_under_18_cannot_apply_or_post.sql |   IF public.member_under_18(auth.uid()) THEN\n    RAISE EXCEPTION 'under_18' |   IF false THEN\n    RAISE EXCEPTION 'under_18'
 * @mutate supabase/migrations/20261013010621_under_18_cannot_apply_or_post.sql |       BEFORE INSERT ON public.applications | AFTER INSERT ON public.applications
 * @mutate supabase/migrations/20261013010621_under_18_cannot_apply_or_post.sql |     CREATE TRIGGER trg_job_accept_pending_refuse_under_18 |     CREATE TRIGGER trg_job_accept_pending_refuse_under_18_off
 * @mutate supabase/migrations/20261013010621_under_18_cannot_apply_or_post.sql |       BEFORE INSERT ON public.series_visit_holds | AFTER INSERT ON public.series_visit_holds
 * @mutate supabase/migrations/20261013010621_under_18_cannot_apply_or_post.sql |       BEFORE INSERT OR UPDATE OF helper_id, helper_confirmed_at ON public.jobs |       BEFORE INSERT ON public.jobs
 * @mutate supabase/functions/complete-signup/index.ts |  && savedBirthdayUnder18(savedDob)) { |  && false) {
 * @mutate supabase/migrations/20261013010621_under_18_cannot_apply_or_post.sql | REVOKE ALL ON FUNCTION public.member_under_18(uuid) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.member_under_18(uuid) FROM PUBLIC, anon;
 * @mutate supabase/migrations/20261013010621_under_18_cannot_apply_or_post.sql | (now() AT TIME ZONE 'America/Chicago')::date\n       FROM public.profiles p | current_date\n       FROM public.profiles p
 * @mutate src/lib/ageGate.ts |   return localDateKey(now) < turns18; |   return localDateKey(now) <= turns18;
 * @mutate src/lib/ageGate.ts |   return `${year}-${pad(month)}-${pad(Math.min(day, lastDay))}`; |   return `${year}-${pad(month)}-${pad(day)}`;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { walkSource } from "./helpers/walkSource";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { bodyOf, triggerInventory, triggersOn } from "./helpers/migrationTriggers";
import { eighteenthBirthday, isUnder18, isUnder18Refusal } from "@/lib/ageGate";
import { RPC_ERROR_COPY } from "@/lib/lifecycleErrors";

const ROOT = process.cwd();
const MIG = join(ROOT, "supabase", "migrations");

// ── 1. the client inventory ─────────────────────────────────────────────────

const isTest = (rel: string) => /\.(test|spec)\.tsx?$/.test(rel) || rel.startsWith("src/test/") || rel.endsWith(".d.ts");

/** Code that names the Post a Job route as a destination (a string, template or href). */
const POST_ROUTE = /["'`]\/post-job(?=[?"'`$/])/;
/** The Apply entry: the visible "Apply Now" label, or the RPCs that take on work. */
const APPLY_ENTRY = />\s*Apply Now\s*<|"Apply Now"/;
const WORK_RPC = /\.rpc\(\s*["'](apply_to_job|respond_to_direct_offer|claim_series_dates)["']/;

/** Files that name /post-job but are not an entry a member taps, with why. EXACT: each must still name the route. */
const NOT_AN_ENTRY: Record<string, string> = {
  "src/App.tsx": "the route table; the page's own form is gated (FormStep)",
  "src/boot/routePreload.ts": "chunk preloading, not a control",
  "src/lib/routePrefetch.ts": "chunk prefetching, not a control",
  "src/lib/declutter/haulAwayLink.ts": "builds the Declutter haul-away link; its only callers are the seller's Declutter screens (selling needs 18+, row 53) and Post a Job's own form is gated (FormStep)",
  "src/lib/desktopNavRoutes.ts": "which routes show the desktop rail",
  "src/components/mobileNav/mobileNavHelpers.ts": "which routes are signed-in pages",
  "src/lib/cppRouting.ts": "App Store custom-product-page landing map; lands on the gated form",
  "src/lib/nativeLaunchRoute.ts": "cold-launch route restore; lands on the gated form",
  "src/components/landing/HeroSection.tsx": "the signed-out landing page (hero LOCKED); a signed-in tap lands on the gated form",
  "src/pages/post-job/EntryChoice.tsx": "a step INSIDE /post-job; the form it opens is gated",
  "src/pages/post-job/OfferToSavedHelpr.tsx": "a step INSIDE /post-job; the form it opens is gated",
  // Secondary links inside god components held by componentSizeRatchet: each
  // opens the /post-job form, whose top line and greyed button say why. The
  // nav's Post button, the empty states and the job sheet's Apply are greyed.
  "src/components/NotificationPanel.tsx": "the Repost pill on an expired/cancelled job's notification; opens the gated form",
  "src/components/profile/ScheduleTab.tsx": "Post a Job beside Browse on an empty calendar; opens the gated form",
  "src/pages/posts/PostedJobCard.tsx": "Re-Post This Job on an expired card; opens the gated form",
  "src/pages/profile/GiftCard.tsx": "Use a received gift on a new job; opens the gated form",
  "src/pages/user/UserProfile.tsx": "Offer a Job Directly in a profile's menu; opens the gated form",
};

/** Call sites that only need the server's refusal in words (no button of their own). */
const REFUSAL_READERS: Record<string, RegExp> = {
  "src/pages/home/useApplyFlow.ts": /rpcErrorMessage\(\s*"apply_to_job"/,
  "src/components/job-card/activityActions/useOfferHandlers.ts": /isUnder18Refusal\(/,
  "src/lib/seriesDates.ts": /isUnder18Refusal\(/,
};

const sources = walkSource([join(ROOT, "src")])
  .map((abs) => ({ rel: relative(ROOT, abs), code: blankComments(readFileSync(abs, "utf8")) }))
  .filter((f) => !isTest(f.rel));

describe("Q1586(c) every Apply / Post a Job entry reads the under-18 gate", () => {
  const postEntries = sources.filter((f) => POST_ROUTE.test(f.code));
  const applyEntries = sources.filter((f) => APPLY_ENTRY.test(f.code));
  const workCalls = sources.filter((f) => WORK_RPC.test(f.code));

  it("the inventory is real (floors)", () => {
    expect(postEntries.length).toBeGreaterThan(20);
    expect(applyEntries.length).toBeGreaterThan(1);
    expect(workCalls.length).toBeGreaterThan(2);
  });

  it("every file that sends a member to /post-job greys it out under 18 (or is an exact, explained exception)", () => {
    const ungated = postEntries
      .filter((f) => !NOT_AN_ENTRY[f.rel])
      .filter((f) => !/\buseAgeGate\(\)/.test(f.code))
      .map((f) => f.rel);
    expect(ungated).toEqual([]);
  });

  it("every exception still names the route (the list is exact, both ways)", () => {
    const stale = Object.keys(NOT_AN_ENTRY).filter((rel) => !postEntries.some((f) => f.rel === rel));
    expect(stale).toEqual([]);
  });

  it("every Apply Now greys out under 18", () => {
    const ungated = applyEntries.filter((f) => !/\buseAgeGate\(\)/.test(f.code)).map((f) => f.rel);
    expect(ungated).toEqual([]);
  });

  it("every call that takes on work turns the server's under_18 refusal into words", () => {
    const unread = workCalls
      .filter((f) => !(REFUSAL_READERS[f.rel]?.test(f.code)))
      .map((f) => f.rel);
    expect(unread).toEqual([]);
    expect(Object.keys(REFUSAL_READERS).filter((rel) => !workCalls.some((f) => f.rel === rel))).toEqual([]);
    expect((RPC_ERROR_COPY.apply_to_job as Record<string, string>).under_18).toMatch(/18 or older/);
  });

  it("the job post's insert error names the age refusal", () => {
    const submit = sources.find((f) => f.rel === "src/pages/post-job/useJobSubmit.ts");
    expect(submit?.code).toMatch(/isUnder18Refusal\(error\)\s*\?\s*UNDER_18_POST_COPY/);
  });
});

// ── 2. the server ───────────────────────────────────────────────────────────

const files = migrationFiles(MIG);
const sqlOf = (f: string) => readFileSync(join(MIG, f), "utf8");
const defs = effectiveDefs(MIG);
const code = (fn: string) => {
  const d = defs.get(fn);
  if (!d) throw new Error(`no migration leaves public.${fn}`);
  return blankSqlComments(bodyOf(d.stmt));
};
const triggers = triggerInventory(files.map((name) => ({ name, sql: sqlOf(name) })));

describe("Q1586(c) the server refuses an under-18 member too", () => {
  it("apply_to_job refuses 'under_18' before its rate ladder", () => {
    const body = code("apply_to_job");
    const refuse = body.search(/IF\s+public\.member_under_18\(\s*auth\.uid\(\)\s*\)\s+THEN\s+RAISE\s+EXCEPTION\s+'under_18'/i);
    const lock = body.search(/pg_advisory_xact_lock/i);
    expect(refuse).toBeGreaterThan(-1);
    expect(refuse).toBeLessThan(lock);
  });

  it.each(["jobs", "applications", "job_accept_pending", "series_visit_holds", "group_job_helpers"])("a BEFORE INSERT trigger on %s runs refuse_under_18_member", (table) => {
    const t = triggersOn(triggers, table).filter((x) => x.fn === "refuse_under_18_member");
    expect(t.length).toBe(1);
    expect(t[0].timing.toUpperCase()).toBe("BEFORE");
    expect(t[0].events.toUpperCase()).toMatch(/\bINSERT\b/);
  });

  it("refuse_under_18_member judges the poster's own post and every Helpr taking work, telling only the member their age", () => {
    const body = code("refuse_under_18_member");
    expect(body).toMatch(/auth\.uid\(\)\s*=\s*NEW\.customer_id\s+AND\s+public\.member_under_18\(\s*NEW\.customer_id\s*\)/i);
    expect(body).toMatch(/public\.member_under_18\(\s*NEW\.helper_id\s*\)/i);
    expect(body.match(/RAISE\s+EXCEPTION\s+'under_18'/gi)?.length).toBe(2);
    expect(body).toMatch(/auth\.uid\(\)\s+IS\s+NOT\s+DISTINCT\s+FROM\s+NEW\.helper_id\s+THEN\s+RAISE\s+EXCEPTION\s+'under_18'/i);
    expect(body).toMatch(/RAISE\s+EXCEPTION\s+'helper_unavailable'/i);
  });

  it("a booking (helper_id set, or the Helpr's first confirm) is judged on jobs and crew-seat UPDATE", () => {
    const t = triggersOn(triggers, "jobs").filter((x) => x.fn === "refuse_under_18_member");
    expect(t[0].events).toMatch(/UPDATE\s+OF\s+helper_id\s*,\s*helper_confirmed_at/i);
    const crew = triggersOn(triggers, "group_job_helpers").filter((x) => x.fn === "refuse_under_18_member");
    expect(crew[0].events).toMatch(/UPDATE\s+OF\s+helper_confirmed_at/i);
    expect(code("refuse_under_18_member")).toMatch(/OLD\.helper_confirmed_at\s+IS\s+NULL\s+AND\s+NEW\.helper_confirmed_at\s+IS\s+NOT\s+NULL/i);
  });

  it("complete-signup (a service-role write) refuses to replace a saved under-18 birthday", () => {
    const fn = blankComments(readFileSync(join(ROOT, "supabase/functions/complete-signup/index.ts"), "utf8"));
    expect(fn).toMatch(/savedDob\s*&&\s*dateOfBirth\s*&&\s*dateOfBirth\s*!==\s*savedDob\s*&&\s*savedBirthdayUnder18\(savedDob\)/);
    // Louisiana's date, from the one shared formatter (louisianaDateClass).
    expect(fn).toMatch(/louisianaToday\(\) < turns18/);
  });

  it("a saved under-18 birthday is locked against the member's own rewrite", () => {
    const t = triggersOn(triggers, "profiles").filter((x) => x.fn === "lock_under_18_birthday");
    expect(t.length).toBe(1);
    expect(t[0].timing.toUpperCase()).toBe("BEFORE");
    expect(t[0].events).toMatch(/UPDATE\s+OF\s+date_of_birth/i);
    expect(code("lock_under_18_birthday")).toMatch(/auth\.uid\(\)\s*=\s*OLD\.user_id/i);
  });

  it("member_under_18 is Louisiana's date + 18 years, and nobody but the server can call it", () => {
    const body = code("member_under_18");
    expect(body).toMatch(/date_of_birth\s*\+\s*interval\s*'18 years'\s*\)\s*>\s*\(now\(\)\s+AT\s+TIME\s+ZONE\s+'America\/Chicago'\)::date/i);
    const d = defs.get("member_under_18")!;
    const revoke = blankSqlComments(sqlOf(d.file)).match(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.member_under_18\(uuid\)\s+FROM\s+([^;]+);/i);
    expect(revoke?.[1].replace(/\s+/g, " ").trim()).toBe("PUBLIC, anon, authenticated");
  });
});

// ── 3. the date rule ────────────────────────────────────────────────────────

describe("Q1586(c) the 18th birthday", () => {
  const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0, 0);

  it("no birthday saved is no gate", () => {
    expect(isUnder18(null, at(2026, 10, 12))).toBe(false);
    expect(isUnder18("", at(2026, 10, 12))).toBe(false);
  });

  it("available on the day they turn 18, not the day before", () => {
    expect(isUnder18("2008-10-12", at(2026, 10, 12, 0))).toBe(false);
    expect(isUnder18("2008-10-13", at(2026, 10, 12, 23))).toBe(true);
    expect(isUnder18("2008-10-13", at(2026, 10, 13, 0))).toBe(false);
    expect(isUnder18("1990-01-01", at(2026, 10, 12))).toBe(false);
    expect(isUnder18("2010-06-01", at(2026, 10, 12))).toBe(true);
  });

  it("a 29 February birthday turns 18 on 28 February, like the server", () => {
    expect(eighteenthBirthday("2008-02-29")).toBe("2026-02-28");
    expect(isUnder18("2008-02-29", at(2026, 2, 27))).toBe(true);
    expect(isUnder18("2008-02-29", at(2026, 2, 28))).toBe(false);
  });

  it("the server's refusal is recognised, and only it", () => {
    expect(isUnder18Refusal({ message: "under_18" })).toBe(true);
    expect(isUnder18Refusal("ERROR: under_18")).toBe(true);
    expect(isUnder18Refusal({ message: "under_18_birthday_locked" })).toBe(false);
    expect(isUnder18Refusal({ message: "rate_limit_minute" })).toBe(false);
  });
});
