/**
 * DEV-ONLY sample backend for the 25 Days page and admin (loaded by
 * sponsorBackend() only when import.meta.env.DEV and ?demo=1). Every brand,
 * name and number here is MADE UP for local screenshots before the tables
 * exist; none of it is shown to a real visitor and none of it is real.
 *
 * URL switches (dev server only):
 *   ?demo=1               sample sign-ups, nothing filled in that the owner has not given
 *   &ref=cajun-candle-co  a ref that matches a sample invite (greeting)
 *   &fill=1               also fills the stats, wall and a testimonial, to show those sections
 *   &cap=1                a per-day cap of 1 (days with a sign-up show "Full")
 *   &fail=full|rate|error the next submit fails that way
 */
import type { SponsorBackend } from "./api";
import type { SponsorAdminBackend } from "@/pages/admin/sponsors/sponsorAdminApi";
import type { SponsorAdminData, SponsorAdminSignup, SponsorPublicState } from "./types";

const params = () => new URLSearchParams(window.location.search);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const LOGO_SVG = (letter: string, bg: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><circle cx="60" cy="60" r="58" fill="${bg}"/><text x="60" y="78" font-family="Arial" font-size="56" font-weight="700" fill="#fff" text-anchor="middle">${letter}</text></svg>`,
  )}`;

function sampleSignups(): SponsorAdminSignup[] {
  const base = {
    phone: null, instagram: null, facebook: null, tiktok: null, notes: null, logo_path: null, ref_code: null,
    source: "form" as const, any_day: false, wall_ok: true,
  };
  return [
    { ...base, id: "s1", created_at: "2026-11-09T15:02:00Z", brand_name: "Cajun Candle Co (sample)", contact_name: "Sample Person A", email: "a@example.com", website: "https://example.com", prize_description: "Holiday candle trio", prize_value: 60, ship_to: "winner", status: "confirmed", show_on_wall: true, logo_path: "demo/a.svg", ref_code: "cajun-candle-co", days: [3, 12] },
    { ...base, id: "s2", created_at: "2026-11-09T16:40:00Z", brand_name: "Bayou Bloom Boutique (sample)", contact_name: "Sample Person B", email: "b@example.com", website: null, prize_description: "$50 gift card", prize_value: 50, ship_to: "helpr", status: "pending", show_on_wall: false, days: [3] },
    { ...base, id: "s3", created_at: "2026-11-10T09:15:00Z", brand_name: "Magnolia Coffee (sample)", contact_name: "Sample Person C", email: "c@example.com", website: "https://example.com", prize_description: "Coffee lover's bundle", prize_value: 75, ship_to: "winner", status: "prize_received", show_on_wall: true, logo_path: "demo/c.svg", days: [7] },
    { ...base, id: "s4", created_at: "2026-11-10T12:00:00Z", brand_name: "Teche Tees (sample)", contact_name: "Sample Person D", email: "d@example.com", website: null, prize_description: "Two holiday t-shirts", prize_value: null, ship_to: null, status: "pending", show_on_wall: false, any_day: true, wall_ok: false, days: [] },
  ];
}

const signups = sampleSignups();

export function createDemoBackend(): SponsorBackend {
  let failNext = params().get("fail");
  const fill = params().has("fill");
  const cap = params().has("cap") ? 1 : null;

  const counts = (): Record<number, number> => {
    const c: Record<number, number> = {};
    for (const s of signups) for (const d of s.days) c[d] = (c[d] ?? 0) + 1;
    return c;
  };

  const backend: SponsorBackend = {
    async publicState(ref): Promise<SponsorPublicState> {
      await wait(150);
      return {
        on: true,
        greetingBrand: ref === "cajun-candle-co" ? "Cajun Candle Co" : null,
        dayCounts: counts(),
        maxPerDay: cap,
        wall: fill
          ? [
              { id: "s1", brand: "Cajun Candle Co (sample)", website: "https://example.com", hasLogo: true },
              { id: "s3", brand: "Magnolia Coffee (sample)", website: "https://example.com", hasLogo: true },
              { id: "s5", brand: "Sample Brand Without Logo", website: null, hasLogo: false },
            ]
          : [],
        testimonials: fill ? [{ id: "t1", quote: "SAMPLE testimonial text for the layout preview only.", name: "Sample Name", brand: "Sample Brand" }] : [],
        stats: fill ? { group_members: 1234, page_followers: 5678, monthly_visitors: 9012 } : {},
        hasFounderPhoto: false,
      };
    },
    async logVisit() {
      await wait(10);
    },
    async submit(payload) {
      await wait(500);
      const f = failNext;
      failNext = null;
      if (f === "full") return { ok: false, kind: "full", fullDays: payload.days.slice(0, 1) };
      if (f === "rate") return { ok: false, kind: "rateLimited" };
      if (f === "closed") return { ok: false, kind: "closed" };
      if (f === "error") return { ok: false, kind: "error" };
      if (cap !== null) {
        const c = counts();
        const full = payload.days.filter((d) => (c[d] ?? 0) >= cap);
        if (full.length) return { ok: false, kind: "full", fullDays: full };
      }
      signups.push({
        id: `s${signups.length + 1}`, created_at: new Date().toISOString(), brand_name: payload.brandName, contact_name: payload.contactName,
        email: payload.email, phone: null, website: null, instagram: null, facebook: null, tiktok: null,
        prize_description: payload.prizeDescription, prize_value: payload.prizeValue ? Number(payload.prizeValue) || null : null, ship_to: payload.shipTo || null,
        notes: null, any_day: payload.anyDay, status: "pending", show_on_wall: payload.showOnWall, wall_ok: payload.showOnWall,
        logo_path: null, ref_code: payload.ref, source: "form", days: payload.days,
      });
      return { ok: true, days: payload.days, anyDay: payload.anyDay && payload.days.length === 0 };
    },
    logoUrl(id) {
      return id === "s1" ? LOGO_SVG("C", "#C8102E") : LOGO_SVG("M", "#1E8E3E");
    },
    founderPhotoUrl() {
      return "";
    },
  };
  return backend;
}

/** The admin half of the sample backend (same sample sign-ups as the page). */
export function createDemoAdminBackend(): SponsorAdminBackend {
  return {
      async overview(): Promise<SponsorAdminData> {
        await wait(150);
        return {
          signups,
          invites: [
            { id: "i1", brand: "Cajun Candle Co (sample)", email: "a@example.com", ref_code: "cajun-candle-co", created_at: "2026-11-08T14:00:00Z", visits: 4, first_visit: "2026-11-09T14:58:00Z", last_visit: "2026-11-09T15:01:00Z", signed_up: true },
            { id: "i2", brand: "Pelican Pralines (sample)", email: "p@example.com", ref_code: "pelican-pralines", created_at: "2026-11-08T14:05:00Z", visits: 1, first_visit: "2026-11-10T08:00:00Z", last_visit: "2026-11-10T08:00:00Z", signed_up: false },
            { id: "i3", brand: "Crawfish Crafts (sample)", email: null, ref_code: "crawfish-crafts", created_at: "2026-11-08T14:06:00Z", visits: 0, first_visit: null, last_visit: null, signed_up: false },
          ],
          testimonials: [],
          settings: { max_per_day: null, group_members: null, page_followers: null, monthly_visitors: null, founder_photo_path: null },
          directVisits: 12,
        };
      },
      async setStatus(id, status) { const s = signups.find((x) => x.id === id); if (s) s.status = status; },
      async moveDay(id, fromDay, toDay) {
        const s = signups.find((x) => x.id === id);
        if (!s) return;
        s.days = [...new Set([...s.days.filter((d) => d !== fromDay), toDay])].sort((a, b) => a - b);
        s.any_day = false;
      },
      async setWall(id, show) { const s = signups.find((x) => x.id === id); if (s) s.show_on_wall = show; },
      async addInvite() { return "new-brand"; },
      async deleteInvite() { /* sample only */ },
      async addSignup() { return "s-new"; },
      async saveSettings() { /* sample only */ },
      async saveTestimonial() { /* sample only */ },
      async deleteTestimonial() { /* sample only */ },
      async logoDownloadUrl() { return LOGO_SVG("C", "#C8102E"); },
      async uploadFounderPhoto() { /* sample only */ },
    
  };
}
