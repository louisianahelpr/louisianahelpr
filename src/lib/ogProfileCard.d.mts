/** Types for src/lib/ogProfileCard.mjs (shared by api/share.ts and api/og-profile.ts). */
export interface OgProfileCard {
  handle?: string | null;
  name?: string | null;
  photo_url?: string | null;
  town?: string | null;
  skills?: string | null;
  stats?: { review_count?: number | null; avg_rating?: number | null } | null;
  helpr?: { jobs_done?: number | null } | null;
  listing_count?: number | null;
  listings?: unknown[] | null;
}

export interface OgProfileLines {
  name: string;
  town: string;
  rating: string;
  facts: string;
  skills: string;
}

export const OG_PROFILE_WIDTH: number;
export const OG_PROFILE_HEIGHT: number;
export const OG_PROFILE_PATH: string;
export function ogProfileLines(card: OgProfileCard | null | undefined): OgProfileLines;
export function ogProfilePhotoUrl(avatarUrl: string | null | undefined, supabaseUrl: string): string | null;
export const OG_PROFILE_STYLE: string;
export function ogProfileVersion(card: OgProfileCard | null | undefined): string;
export function ogProfileImageUrl(siteOrigin: string, handle: string, card: OgProfileCard | null | undefined): string;
