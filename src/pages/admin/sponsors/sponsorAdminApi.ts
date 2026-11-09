/**
 * /admin/sponsors' data layer: the sponsor_admin_* functions (each refuses anyone without the admin role, and
 * everything while the sponsor_25days switch is off for the admin) and the sponsor-25days function's admin paths
 * (logo download, founder photo upload). Lives beside the admin page so its words for each refusal
 * (ADMIN_RPC_ERROR_COPY) never ride into the public sponsor page's chunk.
 *
 * DEV ONLY: ?demo=1 on a local dev server answers from the sample backend (src/lib/sponsor/sponsorDemoBackend.ts);
 * import.meta.env.DEV is false in every built bundle.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { rpcErrorMessage } from "@/components/admin/adminRpcErrorCopy";
import { authHeaders, functionsBase } from "@/lib/sponsor/api";
import type { SponsorAdminData, SponsorAdminSettings, SponsorAdminSignup, SponsorStatus } from "@/lib/sponsor/types";

export interface SponsorAdminBackend {
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
  /** An object URL for the logo file. */
  logoDownloadUrl(signupId: string): Promise<string>;
  uploadFounderPhoto(file: File): Promise<void>;
}

type LooseRpc = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };
// The sponsor_* functions are not in the generated Database types yet; each call names its function as a literal.
const sb = supabase as unknown as LooseRpc;

/** The result's data, or an Error carrying the plain words for the refusal (ADMIN_RPC_ERROR_COPY) when there are some. */
function read<T>(res: { data: unknown; error: unknown }, words: string | null): T {
  if (res.error && words) throw new Error(words);
  return unwrap(res as Parameters<typeof unwrap>[0]) as T;
}

const realAdmin: SponsorAdminBackend = {
  async overview() {
    const res = await sb.rpc("sponsor_admin_overview");
    return read<SponsorAdminData>(res, rpcErrorMessage("sponsor_admin_overview", res.error));
  },
  async setStatus(id, status) {
    const res = await sb.rpc("sponsor_admin_set_status", { p_signup_id: id, p_status: status });
    read(res, rpcErrorMessage("sponsor_admin_set_status", res.error));
  },
  async moveDay(id, fromDay, toDay) {
    const res = await sb.rpc("sponsor_admin_move_day", { p_signup_id: id, p_from_day: fromDay, p_to_day: toDay });
    read(res, rpcErrorMessage("sponsor_admin_move_day", res.error));
  },
  async setWall(id, show) {
    const res = await sb.rpc("sponsor_admin_set_wall", { p_signup_id: id, p_show: show });
    read(res, rpcErrorMessage("sponsor_admin_set_wall", res.error));
  },
  async addInvite(brand, email) {
    const res = await sb.rpc("sponsor_admin_add_invite", { p_brand: brand, p_email: email });
    return read<string>(res, rpcErrorMessage("sponsor_admin_add_invite", res.error));
  },
  async deleteInvite(id) {
    const res = await sb.rpc("sponsor_admin_delete_invite", { p_invite_id: id });
    read(res, rpcErrorMessage("sponsor_admin_delete_invite", res.error));
  },
  async addSignup(row) {
    const res = await sb.rpc("sponsor_admin_add_signup", { p_signup: row });
    return read<string>(res, rpcErrorMessage("sponsor_admin_add_signup", res.error));
  },
  async saveSettings(s) {
    const res = await sb.rpc("sponsor_admin_save_settings", {
      p_max_per_day: s.max_per_day,
      p_group_members: s.group_members,
      p_page_followers: s.page_followers,
      p_monthly_visitors: s.monthly_visitors,
    });
    read(res, rpcErrorMessage("sponsor_admin_save_settings", res.error));
  },
  async saveTestimonial(t) {
    const res = await sb.rpc("sponsor_admin_save_testimonial", { p_id: t.id, p_quote: t.quote, p_name: t.name, p_brand: t.brand, p_approved: t.approved });
    read(res, rpcErrorMessage("sponsor_admin_save_testimonial", res.error));
  },
  async deleteTestimonial(id) {
    const res = await sb.rpc("sponsor_admin_delete_testimonial", { p_id: id });
    read(res, rpcErrorMessage("sponsor_admin_delete_testimonial", res.error));
  },
  async logoDownloadUrl(signupId) {
    // The bucket is private with no storage policy: the function checks the admin role and sends the file.
    const res = await fetch(`${functionsBase}?logo=${encodeURIComponent(signupId)}&admin=1`, { headers: await authHeaders() });
    if (!res.ok) throw new Error(`The logo could not be downloaded (${res.status}).`);
    return URL.createObjectURL(await res.blob());
  },
  async uploadFounderPhoto(file) {
    const form = new FormData();
    form.append("photo", file, file.name);
    const res = await fetch(`${functionsBase}?action=founder_photo`, { method: "POST", headers: await authHeaders(), body: form });
    if (!res.ok) throw new Error(`The photo was not saved (${res.status}). Use a PNG or JPG under 5 MB.`);
  },
};

let demo: Promise<SponsorAdminBackend> | null = null;

export async function sponsorAdminBackend(): Promise<SponsorAdminBackend> {
  if (import.meta.env.DEV && typeof window !== "undefined" && new URLSearchParams(window.location.search).has("demo")) {
    demo ??= import("@/lib/sponsor/sponsorDemoBackend").then((m) => m.createDemoAdminBackend());
    return demo;
  }
  return realAdmin;
}
