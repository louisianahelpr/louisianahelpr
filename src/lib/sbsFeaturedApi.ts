/**
 * Small Business Saturday "Featured local" (owner 2026-11-20): free listings for Louisiana businesses taking part in
 * Small Business Saturday, reviewed by an admin before they show. Migration 20261120152039_sbs_featured_local; no
 * browser reads or writes the table itself:
 *   sbs_public_featured()        anyone: APPROVED listings only, never the contact email.
 *   sbs-featured (edge function) anyone: the request (validated, link checked, rate limited) and approved logos.
 *   sbs_admin_list / sbs_admin_review: admins only (src/pages/admin/sponsors/SbsReviewPanel.tsx).
 * The Supabase client loads only when the page asks (loadModule), never on page load.
 */
import { loadModule } from "@/lib/loadModule";
import type { SbsFieldError } from "../../supabase/functions/_shared/sbsSubmission";

const FUNCTION = "sbs-featured";
const functionsBase = `${String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "")}/functions/v1/${FUNCTION}`;

export interface SbsListing {
  id: string;
  name: string;
  town: string;
  category: string;
  link: string;
  deal: string | null;
  has_logo: boolean;
}

type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
const client = async (): Promise<{ rpc: Rpc } | null> => {
  const m = await loadModule(() => import("@/integrations/supabase/client"));
  return m ? (m.supabase as unknown as { rpc: Rpc }) : null;
};

const isListing = (v: unknown): v is SbsListing => {
  const r = v as SbsListing;
  return !!r && typeof r.id === "string" && typeof r.name === "string" && typeof r.link === "string" && /^https:\/\//.test(r.link);
};

/** The approved listings, oldest approval first. Throws on a failed read (the page shows nothing extra then). */
export async function listFeaturedLocal(): Promise<SbsListing[]> {
  const sb = await client();
  if (!sb) return [];
  const { data, error } = await sb.rpc("sbs_public_featured");
  if (error) throw new Error(error.message ?? "sbs_public_featured failed");
  return Array.isArray(data) ? data.filter(isListing) : [];
}

/** An approved listing's logo (served by the edge function from a private bucket). */
export const sbsLogoUrl = (id: string) => `${functionsBase}?logo=${encodeURIComponent(id)}`;

export interface SbsSubmitPayload {
  businessName: string;
  town: string;
  category: string;
  link: string;
  deal: string;
  contactEmail: string;
  participating: boolean;
  /** This browser's random id, for the per-device rate limit. */
  device: string;
}

export type SbsSubmitResult =
  | { ok: true }
  | { ok: false; kind: "invalid"; fields: Partial<Record<string, SbsFieldError | "dead" | "logoType" | "logoSize">> }
  | { ok: false; kind: "duplicate" | "rate_limited" | "server" };

export async function submitFeaturedLocal(payload: SbsSubmitPayload, logo: File | null): Promise<SbsSubmitResult> {
  const form = new FormData();
  form.append("payload", JSON.stringify(payload));
  if (logo) form.append("logo", logo, logo.name);
  const key = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "");
  let res: Response;
  try {
    res = await fetch(functionsBase, { method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}` }, body: form });
  } catch {
    // Offline or blocked: the form says "try again".
    return { ok: false, kind: "server" };
  }
  if (res.ok) return { ok: true };
  const body = (await res.json().catch(() => ({}))) as { error?: string; fields?: Record<string, SbsFieldError> };
  if (res.status === 400 && body.error === "invalid") return { ok: false, kind: "invalid", fields: body.fields ?? {} };
  if (res.status === 409) return { ok: false, kind: "duplicate" };
  if (res.status === 429) return { ok: false, kind: "rate_limited" };
  return { ok: false, kind: "server" };
}

/** A random id kept in this browser (per-device rate limit only; never tied to a person). */
export function sbsDeviceId(): string {
  const make = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
  try {
    const have = localStorage.getItem("lh-sbs-device");
    if (have && /^[a-f0-9]{24}$/.test(have)) return have;
    const id = make();
    localStorage.setItem("lh-sbs-device", id);
    return id;
  } catch {
    // Storage blocked (private mode): a fresh id each time; the per-address limit still applies.
    return make();
  }
}
