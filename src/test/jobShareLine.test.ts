/**
 * F269a (owner 11-11): a shared job link carries ONE description everywhere, with category, parish, day and price:
 * "Cleaning · Iberia Parish · Sun, Nov 29 · $116". Before, api/share.ts served "Cleaning job in New Iberia · needed
 * Sun, Nov 29 · $130. Payment is held..." (the poster's budget) and the page's usePageMeta then wrote "Cleaning ·
 * Iberia Parish · $116" (the guest's take-home, no date) over og:*: two prices for one job by app. The price is the
 * one the public job page shows a guest ("You'd earn after fees", guestTakeHome). The job's own first photo is
 * og:image/twitter:image, else the shell's Helpr mark (sharedLinksOwnPhoto.test.ts holds the photo URL shape).
 *
 * @mutate api/share.ts |     description: clean(jobShareDescription(job), 200), |     description: clean(`${jobShareDescription(job)}. Payment is held safely until the work is confirmed done.`, 200),
 * @mutate src/lib/jobShareLine.mjs |   const net = shellTakeHomeDollars(job); |   const net = Number(job.budget) \|\| null;
 * @mutate src/lib/jobShareLine.mjs |   const parts = [categoryLabel(job.category), areaLabel(job.parish, job.location), jobShareDay(job.date_needed, job.date_window_end)]; |   const parts = [categoryLabel(job.category), areaLabel(job.parish, job.location)];
 * @mutate src/pages/jobs/JobDetail.tsx |   const jobLine = job ? jobShareDescription(job) : ""; |   const jobLine = job ? `${job.category} · ${job.location}` : "";
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { ensureOgShellSnapshot } from "./helpers/ogShellSnapshot";
import { jobShareDay, jobShareDescription } from "@/lib/jobShareLine.mjs";
import { guestTakeHome, type GuestJob } from "@/components/dashboard/GuestJobPreview";
import { jobDayLabel } from "@/lib/jobDateWindow";

const SB = "https://example.supabase.co";
const JOB = "3f2a1b0c-1111-4222-8333-444455556666";
const POSTER = "0a0b0c0d-1111-4222-8333-444455556666";
// 2037: a fixed far-out day (jobDayFixtureTimezone); 2037-11-29 is a Sunday.
const row = (over: Record<string, unknown> = {}) => ({
  id: JOB, title: "Clean the kitchen", category: "cleaning", budget: 130, location: "New Iberia, LA", parish: "Iberia",
  date_needed: "2037-11-29", date_window_end: null, pricing_mode: "set_price", expires_at: null, photos: null,
  urgent_fee: 0, is_group_job: false, helpers_needed: 1, helper_fee_flat_cents: null, helper_fee_percent: null, ...over,
});

describe("F269a: one share line for a job (jobShareLine.mjs)", () => {
  it("is category · parish · day · the guest page's price", () => {
    const r = row();
    const net = guestTakeHome(r as unknown as GuestJob);
    expect(net).not.toBeNull();
    expect(net).not.toBe(130); // the take-home, never the poster's budget
    expect(jobShareDescription(r)).toBe(`Cleaning · Iberia Parish · Sun, Nov 29 · $${Math.floor(net!)}`);
  });

  it("the day reads like the app's (jobDayLabel), windows included; empty facts drop out", () => {
    for (const [a, b] of [["2037-11-29", null], ["2037-11-04", "2037-11-10"], ["2037-10-30", "2037-11-05"]] as const) {
      expect(jobShareDay(a, b)).toBe(jobDayLabel({ date_needed: a, date_window_end: b }));
    }
    expect(jobShareDescription(row({ parish: null, location: "Lafayette, LA", date_needed: null, budget: null }))).toBe("Cleaning · Lafayette");
  });
});

describe("F269a: api/share.ts and the page say the same words", () => {
  let handler: { fetch: (req: Request) => Promise<Response> };
  let jobRows: unknown[] = [];
  let lastSelect = "";
  beforeAll(async () => {
    vi.stubEnv("VITE_SUPABASE_URL", SB);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");
    vi.stubGlobal("fetch", async (url: string) => {
      const u = String(url);
      if (!u.includes("/rest/v1/open_jobs_browse?")) throw new Error(`unexpected fetch ${u}`);
      lastSelect = decodeURIComponent(new URL(u).searchParams.get("select") ?? "");
      return new Response(JSON.stringify(jobRows), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    ensureOgShellSnapshot(resolve("."));
    const sharePath = ["..", "..", "api", "share"].join("/");
    handler = (await import(/* @vite-ignore */ sharePath)).default;
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  const html = async () => (await handler.fetch(new Request(`https://www.louisianahelpr.com/api/share?_og=job&_id=${JOB}`))).text();
  const meta = (h: string, attr: string, key: string) =>
    h.match(new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`))?.[1]?.replace(/&middot;/g, "·").replace(/&#183;/g, "·");

  it("og:description, twitter:description and description are all the one line", async () => {
    jobRows = [row()];
    const h = await html();
    const want = jobShareDescription(row());
    expect(meta(h, "property", "og:description")).toBe(want);
    expect(meta(h, "name", "twitter:description")).toBe(want);
    expect(meta(h, "name", "description")).toBe(want);
    // The take-home's inputs are read; the free text, the poster and coordinates are not.
    for (const col of ["parish", "date_window_end", "urgent_fee", "is_group_job", "helpers_needed", "helper_fee_flat_cents", "helper_fee_percent"]) {
      expect(lastSelect.split(",")).toContain(col);
    }
    for (const col of ["description", "customer_id", "latitude", "longitude", "address"]) expect(lastSelect.split(",")).not.toContain(col);
  });

  it("og:image/twitter:image is the job's own first photo, else the shell's Helpr mark", async () => {
    jobRows = [row({ photos: [`${SB}/storage/v1/object/public/job-photos/${POSTER}/jobs/a.jpg`] })];
    const withPhoto = await html();
    expect(meta(withPhoto, "property", "og:image")).toBe(`${SB}/functions/v1/shop-photo?id=${JOB}&amp;kind=job&amp;w=1200&amp;og=1`);
    expect(meta(withPhoto, "name", "twitter:image")).toBe(`${SB}/functions/v1/shop-photo?id=${JOB}&amp;kind=job&amp;w=1200&amp;og=1`);
    expect(withPhoto).not.toContain(POSTER);
    jobRows = [row({ photos: [] })];
    const none = await html();
    expect(meta(none, "property", "og:image")).toMatch(/^https:\/\/www\.louisianahelpr\.com\/og-image\.png/);
  });

  it("the page's usePageMeta reads the same function (JobDetail.tsx) for description and og/twitter", () => {
    const src = blankComments(readFileSync(resolve("src/pages/jobs/JobDetail.tsx"), "utf8"));
    expect(src).toMatch(/const jobLine = job \? jobShareDescription\(job\) : ""/);
    expect(src).toMatch(/description: jobDescription,[\s\S]{0,200}ogDescription: jobDescription/);
    expect(src).toContain("expires_at, parish\"");
  });
});
