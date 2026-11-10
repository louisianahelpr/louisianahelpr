/** 25 Days of Louisiana Giveaways: shapes the page and admin read and write. */
import type { SponsorFieldError, SponsorShipTo } from "../../../supabase/functions/_shared/sponsorSignup";

export type SponsorStatKey = "group_members" | "page_followers" | "monthly_visitors";

/** What sponsor_public_state() returns to anyone (anon included). Never another brand's sign-up details. */
export interface SponsorPublicState {
  /** False while the sponsor_25days switch is off for this visitor: the page shows Not found. */
  on: boolean;
  /** The brand name for a ?ref= that matches an invite, else null. Never the invite's email. */
  greetingBrand: string | null;
  /** Sign-ups per day (1-25): counts only, never names. */
  dayCounts: Record<number, number>;
  /** Per-day cap; null = unlimited. */
  maxPerDay: number | null;
  /** Sponsors marked Confirmed AND OK to show on the wall. */
  wall: Array<{ id: string; brand: string; website: string | null; hasLogo: boolean }>;
  /** Approved testimonials only. */
  testimonials: Array<{ id: string; quote: string; name: string; brand: string | null }>;
  stats: Partial<Record<SponsorStatKey, number | null>>;
  hasFounderPhoto: boolean;
}

export interface SponsorSignupPayload {
  brandName: string;
  contactName: string;
  email: string;
  phone: string;
  website: string;
  instagram: string;
  facebook: string;
  tiktok: string;
  prizeDescription: string;
  /** No longer asked on the form (owner 11-10); the validator and server accept it absent. */
  prizeValue?: string;
  shipTo: SponsorShipTo | "";
  notes: string;
  days: number[];
  anyDay: boolean;
  agree: boolean;
  showOnWall: boolean;
  ref: string | null;
  /** Honeypot: a real person never sees or fills it. */
  company_fax: string;
}

export type SponsorSubmitResult =
  | { ok: true; days: number[]; anyDay: boolean }
  | { ok: false; kind: "invalid"; errors: Partial<Record<string, SponsorFieldError | "logoType" | "logoSize">> }
  | { ok: false; kind: "full"; fullDays: number[] }
  | { ok: false; kind: "rateLimited" }
  | { ok: false; kind: "closed" }
  | { ok: false; kind: "error" };

export type SponsorStatus = "pending" | "confirmed" | "prize_received" | "posted";

export interface SponsorAdminSignup {
  id: string;
  created_at: string;
  brand_name: string;
  contact_name: string;
  email: string;
  phone: string | null;
  website: string | null;
  instagram: string | null;
  facebook: string | null;
  tiktok: string | null;
  prize_description: string;
  /** NULL when not given (20261110171648, owner 11-10). */
  prize_value: number | null;
  ship_to: SponsorShipTo | null;
  notes: string | null;
  any_day: boolean;
  status: SponsorStatus;
  show_on_wall: boolean;
  wall_ok: boolean;
  logo_path: string | null;
  ref_code: string | null;
  source: "form" | "admin";
  days: number[];
}

interface SponsorAdminInvite {
  id: string;
  brand: string;
  email: string | null;
  ref_code: string;
  created_at: string;
  visits: number;
  first_visit: string | null;
  last_visit: string | null;
  signed_up: boolean;
}

interface SponsorAdminTestimonial {
  id: string;
  quote: string;
  name: string;
  brand: string | null;
  approved: boolean;
  created_at: string;
}

export interface SponsorAdminSettings {
  max_per_day: number | null;
  group_members: number | null;
  page_followers: number | null;
  monthly_visitors: number | null;
  founder_photo_path: string | null;
}

export interface SponsorAdminData {
  signups: SponsorAdminSignup[];
  invites: SponsorAdminInvite[];
  testimonials: SponsorAdminTestimonial[];
  settings: SponsorAdminSettings;
  directVisits: number;
}
