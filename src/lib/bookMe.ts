/**
 * "Book me on Helpr" (owner-approved growth item, B59, 2026-10-29).
 *
 * Every Helpr has a personal link, /book/<user id>. It opens a public page
 * (signed out is fine) with what the public profile gate already shows: the
 * masked "First L." name, photo and counts (get_safe_profiles +
 * get_public_profile_stats, both already granted to anon). "Book <First>"
 * opens Post a job with a direct offer to that Helpr set (?offerTo=); a
 * visitor who is not signed up goes through signup and comes back to the same
 * offer (signupUrlFor -> rememberSignupRedirect).
 *
 * Which Helpr brought a new poster is recorded by record_booking_source
 * (migration 20261030013347): self only, set once, new posters only. It pays
 * nothing; it is not the referral program.
 */
import { supabase } from "@/integrations/supabase/client";
import { shareNative, type ShareOutcome } from "@/lib/nativeShare";
import { signupUrlFor } from "@/lib/jobIntent";
import { safeStorage, trackKey } from "@/lib/safeStorage";
import { report } from "@/lib/errorLogger";

/** Built from this constant, never window.location: a native build's origin is capacitor://localhost. */
const BOOK_LINK_ORIGIN = "https://www.louisianahelpr.com";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isBookId(value: string | null | undefined): value is string {
  return !!value && UUID_RE.test(value);
}

/** The Helpr's personal share link. */
export function bookMeLink(userId: string): string {
  return `${BOOK_LINK_ORIGIN}/book/${encodeURIComponent(userId)}`;
}

/** Post a job with a direct offer to this Helpr already set. */
function bookOfferPath(userId: string): string {
  return `/post-job?offerTo=${encodeURIComponent(userId)}`;
}

/**
 * Where "Book <First>" goes: straight to the offer when signed in, else
 * through signup and back to the same offer.
 */
export function bookCtaHref(userId: string, signedIn: boolean): string {
  return signedIn ? bookOfferPath(userId) : signupUrlFor(bookOfferPath(userId));
}

/** The first name shown on the CTA ("Book Marie"). Masked names are "First L.". */
export function firstNameOf(displayName: string | null | undefined): string {
  const first = (displayName ?? "").trim().split(/\s+/)[0] ?? "";
  return first || "this Helpr";
}

function shareText(firstName: string): string {
  return `Need a hand? Book ${firstName} on Louisiana Helpr. Payment is held safely until the work is done.`;
}

/** The OS share sheet / Web Share, else the link is copied with a confirmation. */
export function shareBookMe(userId: string, firstName: string): Promise<ShareOutcome> {
  return shareNative({
    title: `Book ${firstName} on Louisiana Helpr`,
    text: shareText(firstName),
    url: bookMeLink(userId),
    dialogTitle: "Share your booking link",
  });
}

/* ---------------- the public card ---------------- */

export interface BookCard {
  userId: string;
  /** Masked by the server for anyone but the owner/admin: "First L.". */
  name: string;
  avatarUrl: string | null;
  town: string | null;
  skills: string[];
  isIdVerified: boolean;
  jobsDone: number;
  reviewCount: number;
  avgRating: number | null;
}

/**
 * The public card: the two reads the public profile gate already gives anon
 * (get_safe_profiles: masked name, avatar, town, skills; get_public_profile_stats:
 * counts). null = no such public Helpr (banned, deleted, unverified, hidden test account).
 */
export async function fetchBookCard(userId: string): Promise<BookCard | null> {
  if (!isBookId(userId)) return null;
  const [profile, stats] = await Promise.all([
    supabase.rpc("get_safe_profiles", { user_ids: [userId] }),
    supabase.rpc("get_public_profile_stats", { p_user_ids: [userId] }),
  ]);
  if (profile.error) throw profile.error;
  const p = (profile.data ?? [])[0];
  if (!p) return null;
  // Stats are a nicety: a failed stats read still shows the Helpr, with no numbers.
  const s = stats.error ? undefined : (stats.data ?? [])[0];
  return {
    userId: p.user_id,
    name: p.full_name || "A Helpr",
    avatarUrl: p.avatar_url || null,
    town: (p.location ?? "").trim() || null,
    skills: (p.skills ?? "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 6),
    isIdVerified: p.is_id_verified === true,
    jobsDone: Number(s?.completed_jobs_as_helper ?? 0) || 0,
    reviewCount: Number(s?.review_count ?? 0) || 0,
    avgRating: s?.avg_rating == null ? null : Number(s.avg_rating),
  };
}

/* ---------------- which Helpr brought this poster ---------------- */

const SOURCE_KEY = "helpr.bookingSource";
trackKey(SOURCE_KEY);

/** Remembered when a visitor taps "Book <First>", so it survives the signup round trip. */
export function rememberBookingSource(helprId: string): void {
  if (!isBookId(helprId)) return;
  safeStorage.setItem(SOURCE_KEY, helprId);
}

/** Read and clear. Destructive on purpose: one landing records at most once. */
function takeBookingSource(): string | null {
  const raw = safeStorage.getItem(SOURCE_KEY);
  if (raw !== null) safeStorage.removeItem(SOURCE_KEY);
  return isBookId(raw) ? raw : null;
}

/**
 * Record it on the server once the visitor is signed in and on Post a job
 * with that same Helpr's offer. Only records when the remembered Helpr is the
 * one being offered the job, so an unrelated later post never claims a source.
 * Errors are reported, never thrown: a failed attribution must not block posting.
 */
export async function recordBookingSourceFor(offerTo: string | null): Promise<"recorded" | "skipped" | "none"> {
  if (!isBookId(offerTo)) return "none";
  const remembered = safeStorage.getItem(SOURCE_KEY);
  if (remembered !== offerTo) return "none";
  takeBookingSource();
  const { data, error } = await supabase.rpc("record_booking_source", { p_helpr_id: offerTo });
  if (error) {
    // PGRST202: the function is not deployed yet (migrations land on merge). Nothing to record.
    if ((error as { code?: string }).code !== "PGRST202") {
      report(error, { severity: "warning", tags: { source: "bookMe.recordBookingSource" }, context: { helpr_id: offerTo } });
    }
    return "skipped";
  }
  return data === "recorded" ? "recorded" : "skipped";
}
