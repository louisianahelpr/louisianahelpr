export const REVIEW_MAX_RATING: number;
export const LOOKBACK_DAYS: number;
export const SOURCE: string;
export const BUNDLE_ID_DEFAULT: string;
export const CURSOR_SQL: string;
export type StoreReview = {
  id: string; rating: number; title: string; body: string; nickname: string; territory: string; created: string;
};
export function toReview(r: unknown): StoreReview;
export function sinceFrom(cursor: string | null | undefined, now?: Date): Date;
export function reportable(reviews: StoreReview[], since: Date): { reviews: StoreReview[]; unreadable: StoreReview[] };
export function ledgerItem(r: StoreReview, appId: string | null): {
  sourceKind: "user-report"; source: string; title: string; severity: "error" | "warning"; sample: string;
  sampleRef: { review_id: string; rating: number; territory: string; review_created: string; link: string | null };
  verifyKind: "manual"; seenAt: string;
};
