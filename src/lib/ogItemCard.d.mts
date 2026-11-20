export const OG_ITEM_WIDTH: 1200;
export const OG_ITEM_HEIGHT: 630;
export const OG_ITEM_PATH: "/api/og-item";
export const OG_ITEM_STYLE: string;
export function isUuid(value: unknown): value is string;
export function ogItemImageUrl(siteOrigin: string, itemId: string, photoId: string): string | null;
export function ogItemPhotoUrl(supabaseUrl: string, photoId: string): string | null;
