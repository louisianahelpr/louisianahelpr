/**
 * 25 Days of Louisiana Giveaways: the page's and the admin's data layer.
 *
 * Every read and write goes through a server function; no sponsor table is
 * readable or writable by a browser (migration 20261109*_sponsor_25days):
 *   sponsor_public_state(p_ref)      anyone: on/off, the greeting brand for a
 *                                    matching ref, per-day COUNTS, the wall,
 *                                    approved testimonials, stats.
 *   sponsor_log_visit(...)           anyone: insert-only, rate limited.
 *   sponsor-25days (edge function)   anyone: the sign-up (validated, honeypot,
 *                                    rate limit, per-day cap) + the emails; and
 *                                    GET ?logo=<id> / ?photo=founder images.
 *   sponsor_admin_*                  admins only.
 *
 * DEV ONLY: `?demo=1` on a local dev server answers every call from made-up
 * sample data (sponsorDemoBackend.ts) so the page can be screenshotted before
 * its tables exist. `import.meta.env.DEV` is false in every built bundle, so
 * the demo module is never in a production build and no real visitor can
 * reach it.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import type {
  SponsorAdminData,
  SponsorAdminSettings,
  SponsorAdminSignup,
  SponsorPublicState,
  SponsorSignupPayload,
  SponsorStatus,
  SponsorSubmitResult,
} from "./types";

export interface SponsorBackend {
  publicState(ref: string | null): Promise<SponsorPublicState>;
  logVisit(ref: string | null, referrer: string | null, device: string): Promise<void>;
  submit(payload: SponsorSignupPayload, logo: File | null): Promise<SponsorSubmitResult>;
  logoUrl(signupId: string): string;
  founderPhotoUrl(): string;
  admin: {
    overview(): Promise<SponsorAdminData>;
    setStatus(id: string, status: SponsorStatus): Promise<void>;
    moveDay(id: string, fromDay: number | null, toDay: number): Promise<void>;
    setWall(id: string, show: boolean): Promise<void>;
    addInvite(brand: string, email: string | null): Promise<string>;
    deleteInvite(id: string): Promise<void>;
    addSignup(row: Omit<SponsorAdminSignup, "id" | "created_at" | "logo_path" | "ref_code" | "source">): Promise<string>;
    saveSettings(s: Omit<SponsorAdminSettings, "founder_photo_path">): Promise<void>;
    saveTestimonial(t: { id: string | null; quote: string; name: string; brand: string | null; approved: boolean }): Promise<void>;
    deleteTestimonial(id: string): Promise<void>;
    /** An object URL for the logo file (admins only). */
    logoDownloadUrl(signupId: string): Promise<string>;
    uploadFounderPhoto(file: File): Promise<void>;
  };
}

const FUNCTION = "sponsor-25days";
const functionsBase = `${String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "")}/functions/v1/${FUNCTION}`;

function asState(data: unknown): SponsorPublicState {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const counts: Record<number, number> = {};
  const rawCounts = (d.day_counts && typeof d.day_counts === "object" ? d.day_counts : {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(rawCounts)) {
    const day = Number(k);
    if (Number.isInteger(day) && typeof v === "number") counts[day] = v;
  }
  const stats = (d.stats && typeof d.stats === "object" ? d.stats : {}) as SponsorPublicState["stats"];
  return {
    on: d.on === true,
    greetingBrand: typeof d.greeting_brand === "string" && d.greeting_brand ? d.greeting_brand : null,
    dayCounts: counts,
    maxPerDay: typeof d.max_per_day === "number" ? d.max_per_day : null,
    wall: Array.isArray(d.wall) ? (d.wall as SponsorPublicState["wall"]) : [],
    testimonials: Array.isArray(d.testimonials) ? (d.testimonials as SponsorPublicState["testimonials"]) : [],
    stats,
    hasFounderPhoto: d.has_founder_photo === true,
  };
}

type LooseRpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  // The sponsor_* functions are new and not in the generated Database types yet.
  const res = await (supabase as unknown as LooseRpc).rpc(name, args);
  return unwrap(res as Parameters<typeof unwrap>[0]) as T;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const key = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "");
  return { apikey: key, Authorization: `Bearer ${token ?? key}` };
}

const realBackend: SponsorBackend = {
  async publicState(ref) {
    return asState(await rpc("sponsor_public_state", { p_ref: ref }));
  },
  async logVisit(ref, referrer, device) {
    await rpc("sponsor_log_visit", { p_ref: ref, p_referrer: referrer, p_device: device });
  },
  async submit(payload, logo) {
    const form = new FormData();
    form.append("payload", JSON.stringify(payload));
    if (logo) form.append("logo", logo, logo.name);
    const { data, error } = await supabase.functions.invoke(FUNCTION, { body: form });
    if (!error && data && (data as { ok?: boolean }).ok === true) {
      const d = data as { days?: number[]; any_day?: boolean };
      return { ok: true, days: Array.isArray(d.days) ? d.days : payload.days, anyDay: d.any_day === true };
    }
    // A FunctionsHttpError carries the response: read our own error shape from it.
    let body: Record<string, unknown> | null = null;
    const ctx = (error as { context?: Response } | null)?.context;
    if (ctx && typeof ctx.json === "function") {
      body = await ctx.json().catch(() => null);
    }
    const status = ctx?.status ?? 0;
    if (status === 429) return { ok: false, kind: "rateLimited" };
    if (body?.error === "full" && Array.isArray(body.full_days)) return { ok: false, kind: "full", fullDays: body.full_days as number[] };
    if (body?.error === "invalid" && body.fields && typeof body.fields === "object") {
      return { ok: false, kind: "invalid", errors: body.fields as Record<string, never> };
    }
    return { ok: false, kind: "error" };
  },
  logoUrl(signupId) {
    return `${functionsBase}?logo=${encodeURIComponent(signupId)}`;
  },
  founderPhotoUrl() {
    return `${functionsBase}?photo=founder`;
  },
  admin: {
    async overview() {
      return (await rpc("sponsor_admin_overview")) as SponsorAdminData;
    },
    async setStatus(id, status) {
      await rpc("sponsor_admin_set_status", { p_signup_id: id, p_status: status });
    },
    async moveDay(id, fromDay, toDay) {
      await rpc("sponsor_admin_move_day", { p_signup_id: id, p_from_day: fromDay, p_to_day: toDay });
    },
    async setWall(id, show) {
      await rpc("sponsor_admin_set_wall", { p_signup_id: id, p_show: show });
    },
    async addInvite(brand, email) {
      return (await rpc("sponsor_admin_add_invite", { p_brand: brand, p_email: email })) as string;
    },
    async deleteInvite(id) {
      await rpc("sponsor_admin_delete_invite", { p_invite_id: id });
    },
    async addSignup(row) {
      return (await rpc("sponsor_admin_add_signup", { p_signup: row })) as string;
    },
    async saveSettings(s) {
      await rpc("sponsor_admin_save_settings", {
        p_max_per_day: s.max_per_day,
        p_group_members: s.group_members,
        p_page_followers: s.page_followers,
        p_monthly_visitors: s.monthly_visitors,
      });
    },
    async saveTestimonial(t) {
      await rpc("sponsor_admin_save_testimonial", { p_id: t.id, p_quote: t.quote, p_name: t.name, p_brand: t.brand, p_approved: t.approved });
    },
    async deleteTestimonial(id) {
      await rpc("sponsor_admin_delete_testimonial", { p_id: id });
    },
    async logoDownloadUrl(signupId) {
      // The bucket is private with no storage policy: the function checks the admin role and sends the file.
      const res = await fetch(`${functionsBase}?logo=${encodeURIComponent(signupId)}&admin=1`, { headers: await authHeaders() });
      if (!res.ok) throw new Error(`logo download failed (${res.status})`);
      return URL.createObjectURL(await res.blob());
    },
    async uploadFounderPhoto(file) {
      const form = new FormData();
      form.append("photo", file, file.name);
      const res = await fetch(`${functionsBase}?action=founder_photo`, { method: "POST", headers: await authHeaders(), body: form });
      if (!res.ok) throw new Error(`photo upload failed (${res.status})`);
    },
  },
};

let demoPromise: Promise<SponsorBackend> | null = null;

/** The backend for this page load: the real one, or (local dev server + ?demo=1 only) the sample one. */
export async function sponsorBackend(): Promise<SponsorBackend> {
  if (import.meta.env.DEV && typeof window !== "undefined" && new URLSearchParams(window.location.search).has("demo")) {
    demoPromise ??= import("./sponsorDemoBackend").then((m) => m.createDemoBackend());
    return demoPromise;
  }
  return realBackend;
}

/** Coarse device type only (no fingerprinting): phone, tablet or desktop. */
export function coarseDevice(ua: string): "phone" | "tablet" | "desktop" {
  if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua)) return "tablet";
  if (/Mobi|iPhone|iPod|Android|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return "phone";
  return "desktop";
}

/** The referring site's origin only (no path or query, which can carry personal data). */
export function coarseReferrer(referrer: string): string | null {
  if (!referrer) return null;
  try {
    const u = new URL(referrer);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin.slice(0, 200);
  } catch {
    // Unparseable referrer: record none rather than a raw string.
    return null;
  }
}
