/** Types for src/lib/declutterFirstPhotos.mjs (imported by api/share.ts and its tests). */
export const DECLUTTER_FIRST_PHOTO_COUNT: number;
export function declutterGuestPreviewUrl(supabaseUrl: string): string;
export function usablePhotoPath(path: unknown): path is string;
export function firstPhotoPaths(preview: unknown): string[] | null;
export const CARD_SIZES: string;
export const FIRST_ROW: number;
export function cardPhotoUrls(supabaseUrl: string, path: string): { href: string; srcset: string };
export function declutterPhotoPreloadHeader(supabaseUrl: string, paths: readonly string[] | null): string | null;
